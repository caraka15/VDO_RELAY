import type { StartStreamInput } from "./api";

export type VideoCapability = {
  key: string;
  label: string;
  codec: string;
  supported: boolean;
  srtCompatible: boolean;
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
  setVideoBitrate?: (kbps: number) => void;
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
      result.push({ deviceId: device.deviceId, label: device.label || `Kamera ${result.length + 1}`, facingMode, maxWidth, maxHeight, maxFps, zoom, torch });
    } catch {
      result.push({ deviceId: device.deviceId, label: device.label || `Kamera ${result.length + 1}`, facingMode: "", maxWidth: 0, maxHeight: 0, maxFps: 0, zoom: null, torch: false });
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }
  return result;
}

function exactCameraConstraints(profile: CameraProfile, deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { exact: profile.width },
    height: { exact: profile.height },
    frameRate: { exact: profile.fps },
    resizeMode: { exact: "none" },
  } as MediaTrackConstraints;
}

export async function probeCameraProfiles(deviceId: string | undefined, portrait: boolean, device?: CameraDevice): Promise<CameraProfile[]> {
  const profiles = CAMERA_RESOLUTIONS.flatMap((resolution) => {
    const width = portrait ? resolution.height : resolution.width;
    const height = portrait ? resolution.width : resolution.height;
    return CAMERA_FPS_OPTIONS.map((fps) => ({ width, height, fps }));
  });
  const maxLongSide = device && device.maxWidth && device.maxHeight ? Math.max(device.maxWidth, device.maxHeight) : 0;
  const maxShortSide = device && device.maxWidth && device.maxHeight ? Math.min(device.maxWidth, device.maxHeight) : 0;
  const candidates = profiles.filter((profile) => !maxLongSide || (Math.max(profile.width, profile.height) <= maxLongSide && Math.min(profile.width, profile.height) <= maxShortSide));
  const supported: CameraProfile[] = [];

  for (const profile of candidates) {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: exactCameraConstraints(profile, deviceId), audio: false });
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings();
      const actualWidth = finiteNumber(settings?.width) || 0;
      const actualHeight = finiteNumber(settings?.height) || 0;
      const actualFps = finiteNumber(settings?.frameRate) || 0;
      if (actualWidth === profile.width && actualHeight === profile.height && actualFps + 1 >= profile.fps) supported.push(profile);
    } catch {
      // The exact camera mode is not available; keep it out of the choices.
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
  { key: "av1", label: "AV1", mime: "video/AV1", srtCompatible: false },
  { key: "vp9", label: "VP9", mime: "video/VP9", srtCompatible: false },
  { key: "vp8", label: "VP8", mime: "video/VP8", srtCompatible: false },
  { key: "h264", label: "H.264", mime: "video/H264", srtCompatible: true },
  { key: "h265", label: "H.265", mime: "video/H265", srtCompatible: true },
] as const;

export async function probeVideoCodecs(): Promise<VideoCapability[]> {
  const capabilities = (globalThis as any).RTCRtpSender?.getCapabilities?.("video")?.codecs || [];
  return videoCandidates.map((candidate) => ({
    key: candidate.key,
    label: candidate.label,
    codec: candidate.mime,
    srtCompatible: candidate.srtCompatible,
    supported: capabilities.some((codec: { mimeType?: string }) => String(codec.mimeType).toLowerCase() === candidate.mime.toLowerCase()),
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
  const videoConstraints = exactCameraConstraints({ width: input.width, height: input.height, fps: input.fps }, input.deviceId);
  const audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (input.audioDeviceId) audioConstraints.deviceId = { exact: input.audioDeviceId };

  let sourceStream: MediaStream;
  try {
    sourceStream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: input.audioEnabled ? audioConstraints : false,
    });
  } catch (error) {
    throw mediaAccessError(error, input.audioEnabled ? "camera-microphone" : "camera");
  }

  const sourceTrack = sourceStream.getVideoTracks()[0];
  if (!sourceTrack) {
    sourceStream.getTracks().forEach((track) => track.stop());
    throw new Error("Tidak ada kamera yang tersedia.");
  }
  const settings = sourceTrack.getSettings();
  const actualFps = finiteNumber(settings.frameRate) || 0;
  if (!actualFps || actualFps + 1 < input.fps) {
    sourceStream.getTracks().forEach((track) => track.stop());
    throw new Error(`Kamera hanya menghasilkan ${actualFps ? `${Math.round(actualFps * 10) / 10} FPS` : "FPS yang tidak diketahui"}; profile meminta ${input.fps} FPS. Tidak ada fallback.`);
  }

  const actualWidth = finiteNumber(settings.width) || 0;
  const actualHeight = finiteNumber(settings.height) || 0;
  if (actualWidth !== input.width || actualHeight !== input.height) {
    sourceStream.getTracks().forEach((track) => track.stop());
    throw new Error(`Kamera aktual ${actualWidth || "?"} × ${actualHeight || "?"}, sedangkan profile meminta ${input.width} × ${input.height}. Pilih profile kamera yang sesuai.`);
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
    actualWidth: input.width,
    actualHeight: input.height,
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
