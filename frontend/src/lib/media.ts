import type { StartStreamInput } from "./api";

export type VideoCapability = {
  key: string;
  label: string;
  codec: string;
  supported: boolean;
  srtCompatible: boolean;
  hardware: boolean;
  powerEfficient: boolean;
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

function idealCameraConstraints(profile: CameraProfile, deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    facingMode: { ideal: "environment" },
    width: { ideal: profile.width },
    height: { ideal: profile.height },
    aspectRatio: { ideal: profile.width / profile.height },
    frameRate: { ideal: profile.fps, max: profile.fps },
    resizeMode: { ideal: "crop-and-scale" },
  } as MediaTrackConstraints;
}

function isAspectRatioClose(width: number, height: number, targetRatio: number): boolean {
  if (width <= 0 || height <= 0 || targetRatio <= 0) return false;
  const actualRatio = width / height;
  return Math.abs(actualRatio - targetRatio) / targetRatio <= 0.03;
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

  for (const profile of candidates) {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: idealCameraConstraints(profile, deviceId), audio: false });
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings();
      const actualWidth = finiteNumber(settings?.width) || 0;
      const actualHeight = finiteNumber(settings?.height) || 0;
      if (track?.readyState === "live" && isAspectRatioClose(actualWidth, actualHeight, profile.width / profile.height)) addSupported(profile);
    } catch {
      // Ideal constraints may still fail when the selected device is unavailable.
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  return supported;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

const videoCandidates = [
  { key: "h264", label: "H.264", mime: "video/H264", srtCompatible: true, contentTypes: ["video/H264;profile-level-id=42e01f;packetization-mode=1", "video/H264"] },
  { key: "h265", label: "H.265", mime: "video/H265", srtCompatible: true, contentTypes: ["video/H265;profile-id=1;tier-flag=0;level-id=93", "video/H265"] },
  { key: "av1", label: "AV1", mime: "video/AV1", srtCompatible: false, contentTypes: [] },
  { key: "vp9", label: "VP9", mime: "video/VP9", srtCompatible: false, contentTypes: [] },
  { key: "vp8", label: "VP8", mime: "video/VP8", srtCompatible: false, contentTypes: [] },
] as const;

async function isHardwareCodec(candidate: (typeof videoCandidates)[number], capabilities: any[]): Promise<boolean> {
  if (!candidate.srtCompatible) return false;
  if (!capabilities.some((codec) => String(codec.mimeType).toLowerCase() === candidate.mime.toLowerCase())) return false;

  const mediaCapabilities = (navigator as any).mediaCapabilities;
  if (typeof mediaCapabilities?.encodingInfo !== "function") return false;

  const bitrate = candidate.key === "h264" ? 7_000_000 : 4_000_000;
  for (const contentType of candidate.contentTypes) {
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
      if (result?.supported === true && result?.powerEfficient === true) return true;
    } catch {
      // Try the next MIME spelling; browsers differ in accepted WebRTC codec strings.
    }
  }
  return false;
}

export async function probeVideoCodecs(): Promise<VideoCapability[]> {
  const capabilities = (globalThis as any).RTCRtpSender?.getCapabilities?.("video")?.codecs || [];
  return Promise.all(videoCandidates.map(async (candidate) => {
    const hardware = await isHardwareCodec(candidate, capabilities);
    return {
      key: candidate.key,
      label: candidate.label,
      codec: candidate.mime,
      srtCompatible: candidate.srtCompatible,
      supported: candidate.srtCompatible && hardware,
      hardware,
      powerEfficient: hardware,
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
  const videoConstraints = idealCameraConstraints({ width: input.width, height: input.height, fps: input.fps }, input.deviceId);
  const audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (input.audioDeviceId) audioConstraints.deviceId = { exact: input.audioDeviceId };

  let sourceStream: MediaStream | null = null;
  try {
    sourceStream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: input.audioEnabled ? audioConstraints : false,
    });
  } catch (error) {
    throw mediaAccessError(error, input.audioEnabled ? "camera-microphone" : "camera");
  }

  const sourceTrack = sourceStream?.getVideoTracks()[0];
  if (!sourceStream || !sourceTrack || sourceTrack.readyState !== "live") {
    sourceStream?.getTracks().forEach((track) => track.stop());
    throw new Error("Kamera tidak menghasilkan track aktif.");
  }
  const settings = sourceTrack.getSettings();
  const actualFps = finiteNumber(settings.frameRate) || 0;
  const actualWidth = finiteNumber(settings.width) || 0;
  const actualHeight = finiteNumber(settings.height) || 0;
  if (!isAspectRatioClose(actualWidth, actualHeight, input.width / input.height)) {
    sourceStream.getTracks().forEach((track) => track.stop());
    throw new Error(`Kamera aktif menghasilkan ${actualWidth || "?"} × ${actualHeight || "?"}; rasio tidak mendekati ${input.width}:${input.height}. Pilih kamera atau orientasi lain.`);
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
