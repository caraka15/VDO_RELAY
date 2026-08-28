"use strict";

// Small WHEP reader for the public player. It mirrors the WHIP handshake used
// by the publisher, so the player can send the read token as an Authorization
// header instead of leaking it to MediaMTX's built-in HTML page.

class MediaMTXWebRTCReader {
  static #RETRY_PAUSE = 2000;

  #conf;
  #state = "running";
  #restartTimeout = null;
  #pc = null;
  #offerData = null;
  #sessionUrl = null;
  #queuedCandidates = [];
  #remoteStream = null;

  constructor(conf) {
    this.#conf = conf;
    this.#start();
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

  #authHeader() {
    if (this.#conf.token) return { Authorization: `Bearer ${this.#conf.token}` };
    return {};
  }

  #closePeerConnection() {
    if (this.#pc !== null) {
      this.#pc.close();
      this.#pc = null;
    }
    this.#offerData = null;
    this.#queuedCandidates = [];
    this.#remoteStream = null;
  }

  #deleteSession() {
    if (this.#sessionUrl === null) return;
    const sessionUrl = this.#sessionUrl;
    this.#sessionUrl = null;
    void fetch(sessionUrl, { method: "DELETE", headers: this.#authHeader() }).catch(() => undefined);
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
        server.username = MediaMTXWebRTCReader.#unquoteCredential(match[3]);
        server.credential = MediaMTXWebRTCReader.#unquoteCredential(match[4]);
        server.credentialType = "password";
      }
      return [server];
    });
  }

  static #parseOffer(offer) {
    const result = { iceUfrag: "", icePwd: "", medias: [] };
    for (const line of offer.split("\r\n")) {
      if (line.startsWith("m=")) result.medias.push(line.slice(2));
      else if (!result.iceUfrag && line.startsWith("a=ice-ufrag:")) result.iceUfrag = line.slice(12);
      else if (!result.icePwd && line.startsWith("a=ice-pwd:")) result.icePwd = line.slice(10);
    }
    return result;
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
      this.#conf.onError?.(`Player ditolak MediaMTX: ${message}`);
      return;
    }
    this.#state = "restarting";
    this.#closePeerConnection();
    this.#deleteSession();
    this.#conf.onError?.(`${message}, mencoba ulang dalam beberapa detik`);
    this.#restartTimeout = window.setTimeout(() => {
      this.#restartTimeout = null;
      this.#state = "running";
      this.#start();
    }, MediaMTXWebRTCReader.#RETRY_PAUSE);
  }

  async #requestICEServers() {
    const response = await fetch(this.#conf.url, { method: "OPTIONS", headers: this.#authHeader() });
    if (!response.ok) throw new Error(`WHEP OPTIONS gagal (${response.status})`);
    return MediaMTXWebRTCReader.#linkToIceServers(response.headers.get("Link"));
  }

  #setupPeerConnection(iceServers) {
    if (this.#state !== "running") throw new Error("player ditutup");
    if (typeof RTCPeerConnection === "undefined") throw new Error("Browser tidak menyediakan WebRTC player");
    this.#pc = new RTCPeerConnection({ iceServers, sdpSemantics: "unified-plan" });
    this.#pc.onicecandidate = (event) => this.#onLocalCandidate(event);
    this.#pc.onconnectionstatechange = () => this.#onConnectionState();
    this.#remoteStream = new MediaStream();
    this.#pc.ontrack = (event) => {
      const tracks = event.streams[0]?.getTracks() || [event.track];
      for (const track of tracks) {
        if (!this.#remoteStream?.getTrackById(track.id)) this.#remoteStream?.addTrack(track);
      }
      if (this.#remoteStream) this.#conf.onTrack?.(this.#remoteStream);
    };
    this.#pc.addTransceiver("video", { direction: "recvonly" });
    this.#pc.addTransceiver("audio", { direction: "recvonly" });
    return this.#pc.createOffer().then((offer) => {
      this.#offerData = MediaMTXWebRTCReader.#parseOffer(offer.sdp);
      return this.#pc.setLocalDescription(offer).then(() => offer.sdp);
    });
  }

  async #sendOffer(offer) {
    if (this.#state !== "running") throw new Error("player ditutup");
    const response = await fetch(this.#conf.url, {
      method: "POST",
      headers: { ...this.#authHeader(), Accept: "application/sdp", "Content-Type": "application/sdp" },
      body: offer,
    });
    if (response.status === 404) throw new Error("stream belum live (404)");
    if (response.status === 400) {
      let detail = "WHEP offer ditolak";
      try {
        detail = (await response.json()).error || detail;
      } catch {}
      throw new Error(detail);
    }
    if (response.status !== 201) throw new Error(`WHEP POST gagal (${response.status})`);
    const location = response.headers.get("Location");
    if (!location) throw new Error("WHEP tidak mengembalikan session Location");
    this.#sessionUrl = new URL(location, this.#conf.url).toString();
    return response.text();
  }

  async #setAnswer(answer) {
    if (this.#state !== "running" || this.#pc === null) throw new Error("player ditutup");
    await this.#pc.setRemoteDescription({ type: "answer", sdp: answer });
    if (this.#queuedCandidates.length > 0) {
      const candidates = this.#queuedCandidates;
      this.#queuedCandidates = [];
      await this.#sendLocalCandidates(candidates);
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
      body: MediaMTXWebRTCReader.#generateSdpFragment(this.#offerData, candidates),
    });
    if (response.status !== 204) throw new Error(`WHEP ICE update gagal (${response.status})`);
  }

  #onConnectionState() {
    if (this.#state !== "running" || this.#pc === null) return;
    if (this.#pc.connectionState === "failed" || this.#pc.connectionState === "closed") {
      this.#handleError("peer connection WHEP tertutup");
    } else if (this.#pc.connectionState === "connected") {
      this.#conf.onConnected?.();
    }
  }
}

export { MediaMTXWebRTCReader };
