import type { StartStreamInput } from "./api";

export type VideoCapability = {
  key: string;
  label: string;
  codec: string;
  supported: boolean;
  srtCompatible: boolean;
  hardware: boolean;
  powerEfficient: boolean;
  reason?: string;
};

export type AudioCapability = {
  key: "opus";
  label: string;
  codec: string;
  supported: boolean;
};

export type CameraDevice = {
  deviceId: string;
  label: string;
  facingMode: string;
  maxWidth: number;
  maxHeight: number;
  maxFps: number;
  defaultWidth: number;
  defaultHeight: number;
  defaultFps: number;
  zoom: { min: number; max: number; step: number } | null;
  torch: boolean;
};

export type CameraProfile = {
  width: number;
  height: number;
  fps: number;
};

export const CAMERA_RESOLUTIONS = [
  { label: "1080p", width: 1920, height: 1080 },
  { label: "720p", width: 1280, height: 720 },
  { label: "480p", width: 854, height: 480 },
] as const;

export const CAMERA_FPS_OPTIONS = [24, 30, 60] as const;

export type CaptureSession = {
  sourceStream: MediaStream;
  stream: MediaStream;
  videoTrack: MediaStreamTrack;
  actualWidth: number;
  actualHeight: number;
  actualFps: number;
  audioTrack: MediaStreamTrack | null;
  getAudioLevel: () => number;
  stop: () => void;
};

export type Publisher = {
  close: () => void;
  setVideoBitrate?: (kbps: number) => Promise<void>;
};

export type MediaDeviceRequest = "camera" | "microphone" | "camera-microphone";

export function mediaAccessError(error: unknown, request: MediaDeviceRequest): Error {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  const device = request === "camera" ? "kamera" : request === "microphone" ? "mikrofon" : "kamera/mikrofon";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new Error(`Izin ${device} ditolak. Tekan ikon di kiri alamat Chrome → Izin situs → izinkan ${device}, lalu muat ulang halaman.`);
  }
  if (name === "OverconstrainedError") {
    const constraint = error && typeof error === "object" && "constraint" in error ? String(error.constraint) : "perangkat";
    return new Error(`${device[0].toUpperCase()}${device.slice(1)} tidak memenuhi pilihan ${constraint}. Pilih input lain lalu coba lagi.`);
  }
  if (name === "NotFoundError") return new Error(`${device[0].toUpperCase()}${device.slice(1)} tidak ditemukan pada perangkat ini.`);
  if (name === "NotReadableError" || name === "TrackStartError") return new Error(`${device[0].toUpperCase()}${device.slice(1)} sedang dipakai aplikasi lain.`);
  if (error instanceof Error && error.message) return new Error(`${device[0].toUpperCase()}${device.slice(1)} tidak bisa dibuka: ${error.message}`);
  return new Error(`${device[0].toUpperCase()}${device.slice(1)} tidak bisa dibuka.`);
}

export async function checkMicrophone(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Audio API tidak tersedia. Pastikan halaman dibuka melalui HTTPS.");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (error) {
    throw mediaAccessError(error, "microphone");
  }
  stream.getTracks().forEach((track) => track.stop());
  return (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
}

export async function probeCameraDevices(): Promise<CameraDevice[]> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API tidak tersedia. Pastikan halaman dibuka melalui HTTPS.");
  let permissionStream: MediaStream;
  try {
    permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  } catch (error) {
    throw mediaAccessError(error, "camera");
  }
  permissionStream.getTracks().forEach((track) => track.stop());

  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
  const result: CameraDevice[] = [];
  for (const device of devices) {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: device.deviceId } }, audio: false });
      const track = stream.getVideoTracks()[0];
      if (!track) continue;
      const capabilities = (track.getCapabilities?.() || {}) as any;
      const settings = track.getSettings();
      const maxWidth = finiteNumber(capabilities.width?.max) || finiteNumber(settings.width) || 0;
      const maxHeight = finiteNumber(capabilities.height?.max) || finiteNumber(settings.height) || 0;
      const maxFps = finiteNumber(capabilities.frameRate?.max) || finiteNumber(settings.frameRate) || 0;
      const zoom = capabilities.zoom && finiteNumber(capabilities.zoom.max) !== null
        ? { min: finiteNumber(capabilities.zoom.min) || 1, max: finiteNumber(capabilities.zoom.max) || 1, step: finiteNumber(capabilities.zoom.step) || 0.1 }
        : null;
      const torch = capabilities.torch === true;
      const facingMode = Array.isArray(capabilities.facingMode) ? capabilities.facingMode[0] || "" : String(capabilities.facingMode || settings.facingMode || "");
      result.push({
        deviceId: device.deviceId,
        label: device.label || `Kamera ${result.length + 1}`,
        facingMode,
        maxWidth,
        maxHeight,
        maxFps,
        defaultWidth: finiteNumber(settings.width) || 0,
        defaultHeight: finiteNumber(settings.height) || 0,
        defaultFps: finiteNumber(settings.frameRate) || 0,
        zoom,
        torch,
      });
    } catch {
      result.push({
        deviceId: device.deviceId,
        label: device.label || `Kamera ${result.length + 1}`,
        facingMode: "",
        maxWidth: 0,
        maxHeight: 0,
        maxFps: 0,
        defaultWidth: 0,
        defaultHeight: 0,
        defaultFps: 0,
        zoom: null,
        torch: false,
      });
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }
  return result;
}

type ResizeModeAttempt = "ideal" | "required" | "native";

function idealCameraConstraints(profile: CameraProfile, deviceId?: string, resizeMode: ResizeModeAttempt = "ideal"): MediaTrackConstraints {
  const portrait = profile.height > profile.width;
  const constraints = {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    ...(!deviceId ? { facingMode: { ideal: "environment" } } : {}),
    // Do not add width/height max constraints here. Android camera HALs can
    // reject crop-and-scale when both dimensions are capped. For portrait,
    // keep height out of the fitness-distance calculation because Android
    // commonly reports the sensor's landscape axes (for example 2304x1728).
    width: { ideal: profile.width },
    ...(portrait ? {} : { height: { ideal: profile.height } }),
    aspectRatio: { ideal: profile.width / profile.height },
    frameRate: { ideal: profile.fps, max: profile.fps },
  } as MediaTrackConstraints & { resizeMode?: string | { ideal: string } };
  if (resizeMode === "ideal") constraints.resizeMode = { ideal: "crop-and-scale" };
  if (resizeMode === "required") constraints.resizeMode = "crop-and-scale";
  return constraints as MediaTrackConstraints;
}

async function applyIdealCameraProfile(track: MediaStreamTrack, profile: CameraProfile, resizeMode: ResizeModeAttempt = "ideal"): Promise<void> {
  const constraints = idealCameraConstraints(profile, undefined, resizeMode) as MediaTrackConstraints & { facingMode?: unknown };
  delete constraints.facingMode;
  await track.applyConstraints(constraints);
}

function isRatioClose(actualRatio: number, targetRatio: number): boolean {
  if (actualRatio <= 0 || targetRatio <= 0) return false;
  return Math.abs(actualRatio - targetRatio) / targetRatio <= 0.03;
}

function isAspectRatioClose(width: number, height: number, targetRatio: number): boolean {
  return isRatioClose(width > 0 && height > 0 ? width / height : 0, targetRatio);
}

function settingsAspectRatio(settings: MediaTrackSettings | undefined): number {
  const width = finiteNumber(settings?.width) || 0;
  const height = finiteNumber(settings?.height) || 0;
  if (width > 0 && height > 0) return width / height;
  return finiteNumber(settings?.aspectRatio) || 0;
}

function profileMatches(track: MediaStreamTrack | undefined, settings: MediaTrackSettings | undefined, profile: CameraProfile): boolean {
  const width = finiteNumber(settings?.width) || 0;
  const height = finiteNumber(settings?.height) || 0;
  const fps = finiteNumber(settings?.frameRate) || 0;
  const ratioMatches = width > 0 && height > 0
    ? isAspectRatioClose(width, height, profile.width / profile.height)
    : isRatioClose(settingsAspectRatio(settings), profile.width / profile.height);
  return Boolean(
    track?.readyState === "live"
      && width >= profile.width
      && height >= profile.height
      && ratioMatches
      && fps + 1 >= profile.fps,
  );
}

function canRetryCameraProfile(error: unknown): boolean {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  return name === "OverconstrainedError" || name === "TypeError";
}

async function requestCameraProfile(
  profile: CameraProfile,
  deviceId: string | undefined,
  audio: MediaTrackConstraints | false,
): Promise<{ stream: MediaStream; track: MediaStreamTrack; settings: MediaTrackSettings }> {
  let lastError: unknown = null;
  for (const resizeMode of ["ideal", "required", "native"] as const) {
    let stream: MediaStream | null = null;
    let accepted = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: idealCameraConstraints(profile, deviceId, resizeMode),
        audio,
      });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("Kamera tidak menghasilkan track video.");
      await applyIdealCameraProfile(track, profile, resizeMode);
      const settings = track.getSettings();
      if (profileMatches(track, settings, profile)) {
        accepted = true;
        return { stream, track, settings };
      }
      lastError = new Error("Kamera tidak menghasilkan target output yang diminta.");
    } catch (error) {
      lastError = error;
      if (!canRetryCameraProfile(error)) throw error;
    } finally {
      if (!accepted) stream?.getTracks().forEach((track) => track.stop());
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Kamera tidak menghasilkan target output yang diminta.");
}

export function cameraResolutionLabel(width: number, height: number): string {
  const known = CAMERA_RESOLUTIONS.find((resolution) => resolution.width === width && resolution.height === height);
  return known?.label || `${width} × ${height}`;
}

function cameraResolutionCandidates(): { width: number; height: number }[] {
  return CAMERA_RESOLUTIONS.map(({ width, height }) => ({ width, height }));
}

export async function probeCameraProfiles(deviceId: string | undefined, portrait: boolean, device?: CameraDevice): Promise<CameraProfile[]> {
  const fpsCandidates = [...new Set([
    ...CAMERA_FPS_OPTIONS,
    device?.maxFps ? Math.round(device.maxFps) : 0,
    device?.defaultFps ? Math.round(device.defaultFps) : 0,
  ])].filter((fps) => fps > 0 && (!device?.maxFps || fps <= Math.ceil(device.maxFps))).sort((a, b) => a - b);
  const profiles = cameraResolutionCandidates().flatMap((resolution) => {
    const width = portrait ? resolution.height : resolution.width;
    const height = portrait ? resolution.width : resolution.height;
    return fpsCandidates.map((fps) => ({ width, height, fps }));
  });
  const maxLongSide = device && device.maxWidth && device.maxHeight ? Math.max(device.maxWidth, device.maxHeight) : 0;
  const maxShortSide = device && device.maxWidth && device.maxHeight ? Math.min(device.maxWidth, device.maxHeight) : 0;
  const candidates = profiles.filter((profile) => !maxLongSide || (Math.max(profile.width, profile.height) <= maxLongSide && Math.min(profile.width, profile.height) <= maxShortSide));
  const supported: CameraProfile[] = [];
  const addSupported = (profile: CameraProfile) => {
    if (!supported.some((item) => item.width === profile.width && item.height === profile.height && item.fps === profile.fps)) supported.push(profile);
  };

  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), facingMode: { ideal: "environment" } },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) return supported;
    for (const profile of candidates) {
      for (const resizeMode of ["ideal", "required", "native"] as const) {
        try {
          await applyIdealCameraProfile(track, profile, resizeMode);
          if (profileMatches(track, track.getSettings(), profile)) {
            addSupported(profile);
            break;
          }
        } catch (error) {
          if (!canRetryCameraProfile(error)) break;
        }
      }
    }
  } catch {
    // Permission and device errors are surfaced by the initial device probe.
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }

  return supported;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

const videoCandidates = [
  { key: "h264", label: "H.264", mime: "video/H264", mimes: ["video/H264"], srtCompatible: true, contentTypes: ["video/H264", "video/H264;profile-level-id=42e01f;packetization-mode=1"] },
  // Chrome's WebRTC name is H265, while some builds expose HEVC spelling.
  { key: "h265", label: "H.265", mime: "video/H265", mimes: ["video/H265", "video/HEVC", "video/hevc"], srtCompatible: true, contentTypes: ["video/H265", "video/H265; profile-id=1; tier-flag=0; level-id=93; tx-mode=SRST", "video/H265;profile-id=1;tier-flag=0;level-id=93;tx-mode=SRST", "video/HEVC", "video/hevc"] },
  { key: "av1", label: "AV1", mime: "video/AV1", mimes: ["video/AV1"], srtCompatible: false, contentTypes: [] },
  { key: "vp9", label: "VP9", mime: "video/VP9", mimes: ["video/VP9"], srtCompatible: false, contentTypes: [] },
  { key: "vp8", label: "VP8", mime: "video/VP8", mimes: ["video/VP8"], srtCompatible: false, contentTypes: [] },
] as const;

type CodecProbe = { hardware: boolean; codec: string; reason: string };

function codecMime(codec: any): string {
  return String(codec?.mimeType || "").split(";", 1)[0].trim();
}

function codecContentTypes(candidate: (typeof videoCandidates)[number], codec: any): string[] {
  const contentTypes = new Set<string>(candidate.contentTypes);
  const mime = codecMime(codec);
  if (mime) {
    contentTypes.add(mime);
    contentTypes.add(mime.toLowerCase());
    if (codec?.sdpFmtpLine) {
      // WebRTC's advertised fmtp string is the most reliable profile and
      // level description. MediaCapabilities examples use a space after ';'.
      contentTypes.add(`${mime}; ${String(codec.sdpFmtpLine)}`);
      contentTypes.add(`${mime.toLowerCase()}; ${String(codec.sdpFmtpLine)}`);
    }
  }
  return [...contentTypes];
}

async function probeHardwareCodec(candidate: (typeof videoCandidates)[number], capabilities: any[], decoderCapabilities: any[]): Promise<CodecProbe> {
  if (!candidate.srtCompatible) return { hardware: false, codec: candidate.mime, reason: "codec ini belum dipakai untuk output SRT" };
  const matches = (codec: any) => candidate.mimes.some((mime) => codecMime(codec).toLowerCase() === mime.toLowerCase());
  const matchedCodecs = capabilities.filter(matches);
  if (matchedCodecs.length === 0) {
    const decoderMatches = decoderCapabilities.filter(matches);
    return {
      hardware: false,
      codec: candidate.mime,
      reason: decoderMatches.length > 0
        ? "browser mengekspos codec ini untuk decode, tetapi belum untuk encoder WebRTC"
        : "browser WebRTC tidak mengekspos encoder codec ini",
    };
  }

  const mediaCapabilities = (navigator as any).mediaCapabilities;
  if (typeof mediaCapabilities?.encodingInfo !== "function") return { hardware: false, codec: String(matchedCodecs[0].mimeType), reason: "MediaCapabilities encodingInfo tidak tersedia" };

  const bitrate = candidate.key === "h264" ? 7_000_000 : 4_000_000;
  let supported = false;
  for (const matchedCodec of matchedCodecs) {
    for (const contentType of codecContentTypes(candidate, matchedCodec)) {
      try {
        const result = await mediaCapabilities.encodingInfo({
          type: "webrtc",
          video: {
            contentType,
            width: 1920,
            height: 1080,
            bitrate,
            framerate: 30,
          },
        });
        if (result?.supported === true) supported = true;
        if (result?.supported === true && result?.powerEfficient === true) {
          return { hardware: true, codec: String(matchedCodec.mimeType), reason: "" };
        }
      } catch {
        // Browser versions differ in accepted MIME parameter spellings.
      }
    }
  }
  return {
    hardware: false,
    codec: String(matchedCodecs[0].mimeType),
    reason: supported ? "browser mendukung codec, tetapi tidak menandainya efisien daya" : "MediaCapabilities menolak konfigurasi encoder WebRTC",
  };
}

export async function probeVideoCodecs(): Promise<VideoCapability[]> {
  const capabilities = (globalThis as any).RTCRtpSender?.getCapabilities?.("video")?.codecs || [];
  const decoderCapabilities = (globalThis as any).RTCRtpReceiver?.getCapabilities?.("video")?.codecs || [];
  return Promise.all(videoCandidates.map(async (candidate) => {
    const probe = await probeHardwareCodec(candidate, capabilities, decoderCapabilities);
    return {
      key: candidate.key,
      label: candidate.label,
      codec: probe.codec,
      srtCompatible: candidate.srtCompatible,
      supported: candidate.srtCompatible && probe.hardware,
      hardware: probe.hardware,
      powerEfficient: probe.hardware,
      reason: probe.reason,
    };
  }));
}

export async function probeAudioCodecs(): Promise<AudioCapability[]> {
  const capabilities = (globalThis as any).RTCRtpSender?.getCapabilities?.("audio")?.codecs || [];
  const opusSupported = capabilities.some((codec: { mimeType?: string }) => String(codec.mimeType).toLowerCase() === "audio/opus");
  return [{ key: "opus" as const, label: "Opus", codec: "opus", supported: opusSupported }];
}

export function assertBrowserMediaSupport(audioEnabled = true): void {
  const missing: string[] = [];
  if (!navigator.mediaDevices?.getUserMedia) missing.push("camera API");
  if (!(globalThis as any).RTCPeerConnection) missing.push("WebRTC");
  if (!(globalThis as any).RTCRtpSender?.getCapabilities) missing.push("WebRTC codec capabilities");
  if (typeof (navigator as any).mediaCapabilities?.encodingInfo !== "function") missing.push("hardware codec detection");
  const audioCodecs = (globalThis as any).RTCRtpSender?.getCapabilities?.("audio")?.codecs || [];
  if (audioEnabled && !audioCodecs.some((codec: { mimeType?: string }) => String(codec.mimeType).toLowerCase() === "audio/opus")) missing.push("WebRTC Opus audio");
  if (missing.length > 0) {
    throw new Error(`Browser belum mendukung: ${missing.join(", ")}. Buka dengan Chrome HTTPS terbaru.`);
  }
}

export async function openCapture(
  input: Pick<StartStreamInput, "width" | "height" | "fps" | "audioEnabled"> & { deviceId?: string; audioDeviceId?: string },
): Promise<CaptureSession> {
  assertBrowserMediaSupport(input.audioEnabled);
  const audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (input.audioDeviceId) audioConstraints.deviceId = { exact: input.audioDeviceId };

  let sourceStream: MediaStream;
  let sourceTrack: MediaStreamTrack;
  let settings: MediaTrackSettings;
  try {
    const result = await requestCameraProfile(
      { width: input.width, height: input.height, fps: input.fps },
      input.deviceId,
      input.audioEnabled ? audioConstraints : false,
    );
    sourceStream = result.stream;
    sourceTrack = result.track;
    settings = result.settings;
  } catch (error) {
    throw mediaAccessError(error, input.audioEnabled ? "camera-microphone" : "camera");
  }

  const actualFps = finiteNumber(settings.frameRate) || 0;
  const actualWidth = finiteNumber(settings.width) || 0;
  const actualHeight = finiteNumber(settings.height) || 0;
  if (!profileMatches(sourceTrack, settings, { width: input.width, height: input.height, fps: input.fps })) {
    sourceStream.getTracks().forEach((track) => track.stop());
    throw new Error(`Kamera aktif menghasilkan ${actualWidth || "?"} × ${actualHeight || "?"} pada ${Math.round(actualFps * 10) / 10 || "?"} FPS; target ${input.width} × ${input.height} / ${input.fps} FPS belum terbukti.`);
  }

  const audioTracks = input.audioEnabled ? sourceStream.getAudioTracks() : [];
  if (input.audioEnabled && audioTracks.length === 0) {
    sourceStream.getTracks().forEach((track) => track.stop());
    throw new Error("Mikrofon tidak menghasilkan audio track. Pilih input audio lain atau matikan audio.");
  }
  const stream = sourceStream;

  let audioContext: AudioContext | null = null;
  let audioAnalyser: AnalyserNode | null = null;
  let audioData: Uint8Array<ArrayBuffer> | null = null;
  if (audioTracks.length > 0) {
    try {
      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(new MediaStream(audioTracks));
      audioAnalyser = audioContext.createAnalyser();
      audioAnalyser.fftSize = 256;
      source.connect(audioAnalyser);
      audioData = new Uint8Array(new ArrayBuffer(audioAnalyser.fftSize));
      void audioContext.resume().catch(() => undefined);
    } catch {
      audioContext = null;
      audioAnalyser = null;
      audioData = null;
    }
  }

  return {
    sourceStream,
    stream,
    videoTrack: sourceTrack,
    actualWidth,
    actualHeight,
    actualFps,
    audioTrack: audioTracks[0] || null,
    getAudioLevel: () => {
      if (!audioAnalyser || !audioData) return 0;
      audioAnalyser.getByteTimeDomainData(audioData);
      let total = 0;
      for (const sample of audioData) {
        const normalized = (sample - 128) / 128;
        total += normalized * normalized;
      }
      return Math.min(1, Math.sqrt(total / audioData.length) * 4);
    },
    stop: () => {
      stream.getTracks().forEach((track) => track.stop());
      void audioContext?.close();
    },
  };
}

export async function startWhipPublisher(options: {
  whipUrl: string;
  publishToken: string;
  capture: CaptureSession;
  codec: VideoCapability;
  input: StartStreamInput;
  audioCodec?: AudioCapability;
  onConnected: () => void;
  onError: (message: string) => void;
}): Promise<Publisher> {
  const { MediaMTXWebRTCPublisher } = await import("./mediamtx-webrtc-publisher.js");
  return new (MediaMTXWebRTCPublisher as any)({
    url: options.whipUrl,
    token: options.publishToken,
    stream: options.capture.stream,
    videoCodec: options.codec.codec,
    videoBitrate: options.input.maxBitrateKbps,
    videoFramerate: options.input.fps,
    audioCodec: options.audioCodec?.codec || "opus",
    audioBitrate: 128,
    onConnected: options.onConnected,
    onError: options.onError,
  }) as Publisher;
}
