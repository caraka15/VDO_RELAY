"use strict";

// Vendored from MediaMTX v1.20.1's WHIP publisher, kept local so the UI can
// choose the camera and codec without embedding MediaMTX's entire page.
// https://github.com/bluenviron/mediamtx/blob/v1.20.1/internal/servers/webrtc/publisher.js

class MediaMTXWebRTCPublisher {
  static #RETRY_PAUSE = 2000;
  static #ICE_GATHER_TIMEOUT = 2000;
  static #DEFAULT_ICE_SERVERS = [{ urls: ["stun:stun.l.google.com:19302"] }];

  #conf;
  #state = "running";
  #restartTimeout = null;
  #pc = null;
  #offerData = null;
  #sessionUrl = null;
  #queuedCandidates = [];
  #videoSender = null;
  #lastVideoSample = null;

  constructor(conf) {
    this.#conf = conf;
    this.#start();
  }

  setVideoBitrate(kbps) {
    if (!Number.isFinite(kbps) || kbps <= 0) {
      throw new Error("video bitrate must be positive");
    }
    this.#conf.videoBitrate = kbps;
    return this.#applyVideoParameters();
  }

  close() {
    this.#state = "closed";
    if (this.#restartTimeout !== null) {
      clearTimeout(this.#restartTimeout);
      this.#restartTimeout = null;
    }
    this.#closePeerConnection();
    this.#deleteSession();
  }

  #closePeerConnection() {
    if (this.#pc !== null) {
      this.#pc.close();
      this.#pc = null;
    }
    this.#videoSender = null;
    this.#offerData = null;
    this.#queuedCandidates = [];
    this.#lastVideoSample = null;
  }

  #deleteSession() {
    if (this.#sessionUrl === null) return;
    const sessionUrl = this.#sessionUrl;
    this.#sessionUrl = null;
    void fetch(sessionUrl, {
      method: "DELETE",
      headers: this.#authHeader(),
    }).catch(() => undefined);
  }

  #authHeader() {
    if (this.#conf.user) {
      return {
        Authorization: `Basic ${btoa(`${this.#conf.user}:${this.#conf.pass || ""}`)}`,
      };
    }
    if (this.#conf.token) {
      return { Authorization: `Bearer ${this.#conf.token}` };
    }
    return {};
  }

  static #unquoteCredential(value) {
    return JSON.parse(`"${value}"`);
  }

  static #linkToIceServers(links) {
    if (!links) return [];
    return links.split(", ").flatMap((link) => {
      const match = link.match(
        /^<(.+?)>; rel="ice-server"(; username="(.*?)"; credential="(.*?)"; credential-type="password")?/i,
      );
      if (!match) return [];
      const server = { urls: [match[1]] };
      if (match[3] !== undefined) {
        server.username = MediaMTXWebRTCPublisher.#unquoteCredential(match[3]);
        server.credential = MediaMTXWebRTCPublisher.#unquoteCredential(match[4]);
        server.credentialType = "password";
      }
      return [server];
    });
  }

  static #parseOffer(offer) {
    const result = { iceUfrag: "", icePwd: "", medias: [], candidates: new Set() };
    let mediaIndex = -1;
    for (const line of offer.split("\r\n")) {
      if (line.startsWith("m=")) {
        mediaIndex += 1;
        result.medias.push(line.slice(2));
      }
      else if (!result.iceUfrag && line.startsWith("a=ice-ufrag:")) result.iceUfrag = line.slice(12);
      else if (!result.icePwd && line.startsWith("a=ice-pwd:")) result.icePwd = line.slice(10);
      else if (line.startsWith("a=candidate:") && mediaIndex >= 0) result.candidates.add(`${mediaIndex}:${line.slice(2)}`);
    }
    return result;
  }

  static #candidateKey(candidate) {
    return `${candidate.sdpMLineIndex ?? candidate.sdpMid ?? ""}:a=${candidate.candidate}`;
  }

  static #videoCodecsFor(codecCapabilities, codecName) {
    const normalizedName = String(codecName).toLowerCase();
    const primary = codecCapabilities.filter((codec) => String(codec.mimeType).toLowerCase() === normalizedName);
    if (primary.length === 0) return [];

    // setCodecPreferences() treats the supplied list as the complete list.
    // Keep RTX/FEC beside the selected codec; removing them makes a single
    // lost RTP packet turn into a visible block until the next keyframe.
    const payloadTypes = new Set(primary
      .map((codec) => Number(codec.preferredPayloadType ?? codec.payloadType))
      .filter((payloadType) => Number.isInteger(payloadType)));
    const recovery = codecCapabilities.filter((codec) => {
      const mime = String(codec.mimeType || "").toLowerCase();
      if (mime === "video/rtx") {
        const apt = /(?:^|;)\s*apt\s*=\s*(\d+)/i.exec(String(codec.sdpFmtpLine || ""));
        return apt ? payloadTypes.has(Number(apt[1])) : false;
      }
      return mime === "video/red" || mime === "video/ulpfec" || mime === "video/flexfec-03";
    });
    return [...primary, ...recovery];
  }

  static #generateSdpFragment(offerData, candidates) {
    const byMedia = {};
    for (const candidate of candidates) {
      const mediaIndex = candidate.sdpMLineIndex;
      (byMedia[mediaIndex] ||= []).push(candidate);
    }
    let fragment = `a=ice-ufrag:${offerData.iceUfrag}\r\n`;
    fragment += `a=ice-pwd:${offerData.icePwd}\r\n`;
    offerData.medias.forEach((media, index) => {
      if (!byMedia[index]) return;
      fragment += `m=${media}\r\n`;
      fragment += `a=mid:${index}\r\n`;
      for (const candidate of byMedia[index]) fragment += `a=${candidate.candidate}\r\n`;
    });
    return fragment;
  }

  #start() {
    this.#requestICEServers()
      .then((iceServers) => this.#setupPeerConnection(iceServers))
      .then((offer) => this.#sendOffer(offer))
      .then((answer) => this.#setAnswer(answer))
      .catch((error) => this.#handleError(error?.message || String(error)));
  }

  #handleError(error) {
    if (this.#state !== "running") return;
    const message = String(error);
    if (/\b401\b|\b403\b|unauthori[sz]ed|forbidden/i.test(message)) {
      this.#state = "closed";
      this.#closePeerConnection();
      this.#deleteSession();
      this.#conf.onError?.(`MediaMTX menolak autentikasi WHIP: ${message}`);
      return;
    }
    this.#state = "restarting";
    this.#closePeerConnection();
    this.#deleteSession();
    this.#restartTimeout = window.setTimeout(() => {
      this.#restartTimeout = null;
      this.#state = "running";
      this.#start();
    }, MediaMTXWebRTCPublisher.#RETRY_PAUSE);
    this.#conf.onError?.(`${message}, mencoba ulang dalam beberapa detik`);
  }

  async #requestICEServers() {
    const response = await fetch(this.#conf.url, {
      method: "OPTIONS",
      headers: this.#authHeader(),
    });
    if (!response.ok) throw new Error(`WHIP OPTIONS gagal (${response.status})`);
    const advertised = MediaMTXWebRTCPublisher.#linkToIceServers(response.headers.get("Link"));
    // MediaMTX may have no ICE-server Link on a LAN deployment. VDO.Ninja
    // still gives the browser a normal ICE configuration in that case.
    return advertised.length > 0 ? advertised : MediaMTXWebRTCPublisher.#DEFAULT_ICE_SERVERS;
  }

  #codecMime(kind, codec) {
    return codec.includes("/") ? codec : `${kind}/${codec}`;
  }

  #setupPeerConnection(iceServers) {
    if (this.#state !== "running") throw new Error("publisher ditutup");
    if (typeof RTCPeerConnection === "undefined" || typeof RTCRtpSender === "undefined") {
      throw new Error("Browser tidak menyediakan WebRTC publisher");
    }
    this.#pc = new RTCPeerConnection({ iceServers, sdpSemantics: "unified-plan" });
    this.#pc.onicecandidate = (event) => this.#onLocalCandidate(event);
    this.#pc.onconnectionstatechange = () => this.#onConnectionState();

    for (const track of this.#conf.stream.getTracks()) {
      const transceiver = this.#pc.addTransceiver(track, {
        direction: "sendonly",
        streams: [this.#conf.stream],
      });
      const codecName = this.#codecMime(track.kind, track.kind === "video" ? this.#conf.videoCodec : this.#conf.audioCodec);
      const capabilities = RTCRtpSender.getCapabilities?.(track.kind)?.codecs || [];
      const matchedCodecs = track.kind === "video"
        ? MediaMTXWebRTCPublisher.#videoCodecsFor(capabilities, codecName)
        : capabilities.filter((codec) => String(codec.mimeType).toLowerCase() === codecName.toLowerCase());
      if (matchedCodecs.length === 0) throw new Error(`WebRTC tidak menyediakan codec ${codecName}`);
      if (!transceiver.setCodecPreferences) throw new Error("Browser tidak mendukung pemilihan codec WebRTC");
      transceiver.setCodecPreferences(matchedCodecs);
      if (track.kind === "video") this.#videoSender = transceiver.sender;
    }

    return this.#pc.createOffer().then(async (offer) => {
      await this.#pc.setLocalDescription(offer);
      await this.#waitForIceGathering();
      const localDescription = this.#pc.localDescription;
      if (!localDescription?.sdp) throw new Error("WebRTC tidak menghasilkan local SDP");
      this.#offerData = MediaMTXWebRTCPublisher.#parseOffer(localDescription.sdp);
      return localDescription.sdp;
    });
  }

  async #waitForIceGathering() {
    const pc = this.#pc;
    if (pc === null || pc.iceGatheringState === "complete") return;
    await new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", onStateChange);
        resolve();
      };
      const onStateChange = () => {
        if (pc.iceGatheringState === "complete") finish();
      };
      const timer = window.setTimeout(finish, MediaMTXWebRTCPublisher.#ICE_GATHER_TIMEOUT);
      pc.addEventListener("icegatheringstatechange", onStateChange);
      onStateChange();
    });
  }

  async #sendOffer(offer) {
    if (this.#state !== "running") throw new Error("publisher ditutup");
    const response = await fetch(this.#conf.url, {
      method: "POST",
      headers: {
        ...this.#authHeader(),
        Accept: "application/sdp",
        "Content-Type": "application/sdp",
      },
      body: offer,
    });
    if (response.status === 400) {
      let detail = "WHIP offer ditolak";
      try {
        detail = (await response.json()).error || detail;
      } catch {}
      throw new Error(detail);
    }
    if (response.status !== 201) throw new Error(`WHIP POST gagal (${response.status})`);
    const location = response.headers.get("Location");
    if (!location) throw new Error("WHIP tidak mengembalikan session Location");
    this.#sessionUrl = new URL(location, this.#conf.url).toString();
    return response.text();
  }

  async #setAnswer(answer) {
    if (this.#state !== "running" || this.#pc === null) throw new Error("publisher ditutup");
    await this.#pc.setRemoteDescription({ type: "answer", sdp: answer });
    await this.#applyVideoParameters();
    if (this.#queuedCandidates.length > 0) {
      const candidates = this.#queuedCandidates.filter((candidate) => !this.#offerData?.candidates.has(MediaMTXWebRTCPublisher.#candidateKey(candidate)));
      this.#queuedCandidates = [];
      if (candidates.length > 0) await this.#sendLocalCandidates(candidates);
    }
  }

  #onLocalCandidate(event) {
    if (this.#state !== "running" || !event.candidate) return;
    if (this.#sessionUrl === null) this.#queuedCandidates.push(event.candidate);
    else void this.#sendLocalCandidates([event.candidate]).catch((error) => this.#handleError(error?.message || String(error)));
  }

  async #sendLocalCandidates(candidates) {
    if (this.#sessionUrl === null || this.#offerData === null || this.#state !== "running") return;
    const response = await fetch(this.#sessionUrl, {
      method: "PATCH",
      headers: {
        ...this.#authHeader(),
        "Content-Type": "application/trickle-ice-sdpfrag",
        "If-Match": "*",
      },
      body: MediaMTXWebRTCPublisher.#generateSdpFragment(this.#offerData, candidates),
    });
    if (response.status !== 204) throw new Error(`WHIP ICE update gagal (${response.status})`);
  }

  async #applyVideoParameters() {
    if (this.#videoSender === null) return;
    const parameters = this.#videoSender.getParameters();
    if (!parameters.encodings) parameters.encodings = [{}];
    if (parameters.encodings.length === 0) parameters.encodings.push({});
    parameters.encodings[0].maxBitrate = Math.round(this.#conf.videoBitrate * 1000);
    parameters.encodings[0].maxFramerate = this.#conf.videoFramerate;
    await this.#videoSender.setParameters(parameters);
  }

  async getStats() {
    if (this.#pc === null || typeof this.#pc.getStats !== "function") return null;
    const reports = await this.#pc.getStats();
    let outbound = null;
    let remoteInbound = null;
    let transport = null;
    let selectedPair = null;
    for (const report of reports.values()) {
      if (report.type === "outbound-rtp" && (report.kind === "video" || report.mediaType === "video") && !report.isRemote) outbound = report;
      else if (report.type === "remote-inbound-rtp" && (report.kind === "video" || report.mediaType === "video") && (!outbound || report.localId === outbound.id)) remoteInbound = report;
      else if (report.type === "transport" && report.selectedCandidatePairId) transport = report;
      else if (report.type === "candidate-pair" && report.state === "succeeded" && (report.selected || report.nominated)) selectedPair = report;
    }
    if (transport?.selectedCandidatePairId) selectedPair = reports.get(transport.selectedCandidatePairId) || selectedPair;
    const localCandidate = selectedPair?.localCandidateId ? reports.get(selectedPair.localCandidateId) : null;
    const remoteCandidate = selectedPair?.remoteCandidateId ? reports.get(selectedPair.remoteCandidateId) : null;
    const codec = outbound?.codecId ? reports.get(outbound.codecId) : null;
    const now = performance.now();
    let videoBitrateKbps = null;
    if (outbound && this.#lastVideoSample && now > this.#lastVideoSample.at && outbound.bytesSent >= this.#lastVideoSample.bytes) {
      videoBitrateKbps = ((outbound.bytesSent - this.#lastVideoSample.bytes) * 8) / (now - this.#lastVideoSample.at);
    }
    if (outbound) this.#lastVideoSample = { bytes: outbound.bytesSent, at: now };
    return {
      connectionState: this.#pc.connectionState,
      iceConnectionState: this.#pc.iceConnectionState,
      videoBitrateKbps,
      videoBytesSent: outbound?.bytesSent ?? null,
      videoPacketsSent: outbound?.packetsSent ?? null,
      videoPacketsLost: remoteInbound?.packetsLost ?? null,
      framesEncoded: outbound?.framesEncoded ?? null,
      frameWidth: outbound?.frameWidth ?? null,
      frameHeight: outbound?.frameHeight ?? null,
      qualityLimitationReason: outbound?.qualityLimitationReason || "unknown",
      encoderImplementation: codec?.encoderImplementation || codec?.implementation || "unknown",
      availableOutgoingBitrateKbps: selectedPair?.availableOutgoingBitrate ? selectedPair.availableOutgoingBitrate / 1000 : null,
      currentRoundTripTimeMs: selectedPair?.currentRoundTripTime ? selectedPair.currentRoundTripTime * 1000 : null,
      localCandidateType: localCandidate?.candidateType || "unknown",
      remoteCandidateType: remoteCandidate?.candidateType || "unknown",
      protocol: localCandidate?.protocol || remoteCandidate?.protocol || "unknown",
    };
  }

  #onConnectionState() {
    if (this.#state !== "running" || this.#pc === null) return;
    if (this.#pc.connectionState === "failed" || this.#pc.connectionState === "closed") {
      this.#handleError("peer connection WHIP tertutup");
    } else if (this.#pc.connectionState === "connected") {
      this.#conf.onConnected?.();
    }
  }
}

export { MediaMTXWebRTCPublisher };
