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

export type NumericRange = {
  min: number | null;
  max: number | null;
  step: number | null;
};

export type TrackSnapshot = {
  width: number;
  height: number;
  aspectRatio: number;
  frameRate: number;
  resizeMode: string;
  facingMode: string;
};

export type CameraCapabilitySnapshot = {
  width: NumericRange | null;
  height: NumericRange | null;
  aspectRatio: NumericRange | null;
  frameRate: NumericRange | null;
  resizeMode: string[];
  facingMode: string[];
  zoom: NumericRange | null;
  torch: boolean | null;
  focusMode: string[];
  exposureMode: string[];
  whiteBalanceMode: string[];
};

export type CameraRatioCheck = {
  label: string;
  targetRatio: number;
  actual: TrackSnapshot | null;
  status: "matched" | "fallback" | "failed";
  error?: string;
};

export type CameraResolutionCheck = {
  label: string;
  targetWidth: number;
  targetHeight: number;
  actual: TrackSnapshot | null;
  status: "exact" | "higher" | "fallback" | "failed";
  error?: string;
};

export type CameraDiagnostic = {
  deviceId: string;
  label: string;
  capabilities: CameraCapabilitySnapshot | null;
  initial: TrackSnapshot | null;
  ratioChecks: CameraRatioCheck[];
  resolutionChecks: CameraResolutionCheck[];
  error?: string;
};

export type AudioCapabilitySnapshot = {
  sampleRate: NumericRange | null;
  sampleSize: NumericRange | null;
  channelCount: NumericRange | null;
  latency: NumericRange | null;
  echoCancellation: string[];
  noiseSuppression: string[];
  autoGainControl: string[];
};

export type AudioTrackSnapshot = {
  sampleRate: number;
  sampleSize: number;
  channelCount: number;
  latency: number;
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
};

export type AudioDiagnostic = {
  devices: { deviceId: string; groupId: string; label: string }[];
  active: AudioTrackSnapshot | null;
  capabilities: AudioCapabilitySnapshot | null;
  senderCodecs: string[];
  receiverCodecs: string[];
  opusSupported: boolean;
  permission: string;
  error?: string;
};

export type CodecEncodingCheck = {
  width: number;
  height: number;
  supported: boolean;
  powerEfficient: boolean | null;
  contentType: string;
};

export type VideoCodecDiagnostic = {
  key: string;
  label: string;
  codec: string;
  srtCompatible: boolean;
  encoderAdvertised: boolean;
  decoderAdvertised: boolean;
  senderCodecs: string[];
  receiverCodecs: string[];
  mediaCapabilitiesAvailable: boolean;
  supported: boolean;
  hardware: boolean;
  powerEfficient: boolean | null;
  checks: CodecEncodingCheck[];
  reason: string;
};

export type BrowserDiagnostic = {
  secureContext: boolean;
  userAgent: string;
  api: Record<string, boolean>;
  permissions: { camera: string; microphone: string };
  supportedConstraints: Record<string, boolean>;
};

export type DeviceCheckReport = {
  checkedAt: string;
  browser: BrowserDiagnostic;
  cameras: CameraDiagnostic[];
  audio: AudioDiagnostic;
  codecs: VideoCodecDiagnostic[];
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

export const DEVICE_CHECK_RESOLUTIONS = [
  { label: "4K UHD portrait", width: 2160, height: 3840 },
  { label: "1440p portrait", width: 1440, height: 2560 },
  { label: "1080p portrait", width: 1080, height: 1920 },
  { label: "720p portrait", width: 720, height: 1280 },
  { label: "480p portrait", width: 480, height: 854 },
] as const;

export const DEVICE_CHECK_RATIOS = [
  { label: "16:9", ratio: 16 / 9 },
  { label: "9:16", ratio: 9 / 16 },
  { label: "4:3", ratio: 4 / 3 },
] as const;

export type CaptureSession = {
  sourceStream: MediaStream;
  stream: MediaStream;
  videoTrack: MediaStreamTrack;
  sourceWidth: number;
  sourceHeight: number;
  sourceFps: number;
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

function isRatioClose(actualRatio: number, targetRatio: number): boolean {
  if (actualRatio <= 0 || targetRatio <= 0) return false;
  return Math.abs(actualRatio - targetRatio) / targetRatio <= 0.03;
}

function isAspectRatioClose(width: number, height: number, targetRatio: number): boolean {
  return isRatioClose(width > 0 && height > 0 ? width / height : 0, targetRatio);
}

const DEFAULT_NATIVE_CAMERA_TARGET = { width: 1280, height: 720 } as const;

type NativeCameraResult = {
  stream: MediaStream;
  track: MediaStreamTrack;
  settings: MediaTrackSettings;
};

function nativeCameraConstraints(
  target: { width: number; height: number },
  fps: number,
  deviceId?: string,
): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    ...(!deviceId ? { facingMode: { ideal: "environment" } } : {}),
    // Match VDO.Ninja: dimensions are preferences, not exact requirements.
    // The browser/camera pipeline decides whether it can crop and scale them.
    width: { ideal: target.width },
    height: { ideal: target.height },
    frameRate: { ideal: fps, max: fps },
  } as MediaTrackConstraints;
}

async function requestNativeCamera(
  deviceId: string | undefined,
  audio: MediaTrackConstraints | false,
  fps: number,
  target: { width: number; height: number } = DEFAULT_NATIVE_CAMERA_TARGET,
): Promise<NativeCameraResult> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: nativeCameraConstraints(target, fps, deviceId),
    audio,
  });
  const track = stream.getVideoTracks()[0];
  if (!track) {
    stream.getTracks().forEach((item) => item.stop());
    throw new Error("Kamera tidak menghasilkan track video.");
  }
  if (track.readyState !== "live") {
    stream.getTracks().forEach((item) => item.stop());
    throw new Error("Track kamera tidak aktif.");
  }
  return { stream, track, settings: track.getSettings() };
}

export function cameraResolutionLabel(width: number, height: number): string {
  const known = CAMERA_RESOLUTIONS.find((resolution) => resolution.width === width && resolution.height === height);
  return known?.label || `${width} × ${height}`;
}

function cameraResolutionCandidates(): { width: number; height: number }[] {
  return CAMERA_RESOLUTIONS.map(({ width, height }) => ({ width, height }));
}

export async function probeCameraProfiles(deviceId: string | undefined, device?: CameraDevice): Promise<CameraProfile[]> {
  const probeFps = device?.maxFps ? Math.min(30, Math.max(1, Math.round(device.maxFps))) : 30;
  const native = await requestNativeCamera(deviceId, false, probeFps, DEFAULT_NATIVE_CAMERA_TARGET);
  const nativeWidth = finiteNumber(native.settings.width) || 0;
  const nativeHeight = finiteNumber(native.settings.height) || 0;
  const nativeFps = finiteNumber(native.settings.frameRate) || 0;
  const maxLongSide = Math.max(
    Math.max(nativeWidth, nativeHeight),
    device?.maxWidth || 0,
    device?.maxHeight || 0,
  );
  const maxFps = Math.max(nativeFps, device?.maxFps || 0, probeFps);
  native.stream.getTracks().forEach((track) => track.stop());

  const fpsCandidates = [...new Set([
    ...CAMERA_FPS_OPTIONS,
    device?.maxFps ? Math.round(device.maxFps) : 0,
    device?.defaultFps ? Math.round(device.defaultFps) : 0,
  ])].filter((fps) => fps > 0 && (!maxFps || fps <= Math.ceil(maxFps))).sort((a, b) => a - b);
  return cameraResolutionCandidates().flatMap((resolution) => {
    const { width, height } = resolution;
    // These are camera preferences. Chrome may return the same profile
    // rotated when the phone is held in portrait.
    if (maxLongSide > 0 && Math.max(width, height) > maxLongSide) return [];
    return fpsCandidates.map((fps) => ({ width, height, fps }));
  });
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
  if (contentTypes.size === 0) contentTypes.add(candidate.mime);
  return [...contentTypes];
}

const CODEC_CHECK_SIZES = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
] as const;

function codecDescription(codec: any): string {
  const mime = codecMime(codec);
  const fmtp = String(codec?.sdpFmtpLine || "").trim();
  return fmtp ? `${mime}; ${fmtp}` : mime;
}

async function inspectVideoCodec(
  candidate: (typeof videoCandidates)[number],
  capabilities: any[],
  decoderCapabilities: any[],
): Promise<VideoCodecDiagnostic> {
  const matches = (codec: any) => candidate.mimes.some((mime) => codecMime(codec).toLowerCase() === mime.toLowerCase());
  const matchedCodecs = capabilities.filter(matches);
  const decoderMatches = decoderCapabilities.filter(matches);
  const senderCodecs = matchedCodecs.map(codecDescription).filter(Boolean);
  const receiverCodecs = decoderMatches.map(codecDescription).filter(Boolean);
  const mediaCapabilities = (navigator as any).mediaCapabilities;
  const mediaCapabilitiesAvailable = typeof mediaCapabilities?.encodingInfo === "function";
  const checks: CodecEncodingCheck[] = [];

  if (matchedCodecs.length > 0 && mediaCapabilitiesAvailable) {
    const bitrate = candidate.key === "h264" ? 7_000_000 : candidate.key === "h265" ? 4_000_000 : 2_000_000;
    for (const size of CODEC_CHECK_SIZES) {
      let best: CodecEncodingCheck | null = null;
      for (const matchedCodec of matchedCodecs) {
        for (const contentType of codecContentTypes(candidate, matchedCodec)) {
          try {
            const result = await mediaCapabilities.encodingInfo({
              type: "webrtc",
              video: {
                contentType,
                width: size.width,
                height: size.height,
                bitrate,
                framerate: 30,
              },
            });
            const check: CodecEncodingCheck = {
              width: size.width,
              height: size.height,
              supported: result?.supported === true,
              powerEfficient: typeof result?.powerEfficient === "boolean" ? result.powerEfficient : null,
              contentType,
            };
            if (!best || (check.supported && !best.supported) || (check.powerEfficient === true && best.powerEfficient !== true)) best = check;
            if (check.supported && check.powerEfficient === true) break;
          } catch {
            // Browser builds differ in accepted MIME parameter spellings.
          }
        }
        if (best?.supported && best.powerEfficient === true) break;
      }
      checks.push(best || {
        width: size.width,
        height: size.height,
        supported: false,
        powerEfficient: null,
        contentType: "",
      });
    }
  }

  const supported = checks.some((check) => check.supported);
  const powerEfficient = checks.some((check) => check.powerEfficient === true)
    ? true
    : checks.some((check) => check.powerEfficient === false)
      ? false
      : null;
  const hardware = powerEfficient === true;
  let reason = "";
  if (matchedCodecs.length === 0) {
    reason = decoderMatches.length > 0
      ? "browser mengekspos codec ini untuk decode, tetapi belum untuk encoder WebRTC"
      : "browser WebRTC tidak mengekspos encoder codec ini";
  } else if (!mediaCapabilitiesAvailable) {
    reason = "MediaCapabilities encodingInfo tidak tersedia";
  } else if (!supported) {
    reason = "MediaCapabilities menolak konfigurasi encoder WebRTC yang diuji";
  } else if (!hardware) {
    reason = "browser mendukung codec, tetapi belum menandainya efisien daya";
  } else if (!candidate.srtCompatible) {
    reason = "encoder hardware terdeteksi, tetapi codec ini belum dipakai untuk output SRT";
  }

  return {
    key: candidate.key,
    label: candidate.label,
    codec: String(matchedCodecs[0]?.mimeType || candidate.mime),
    srtCompatible: candidate.srtCompatible,
    encoderAdvertised: matchedCodecs.length > 0,
    decoderAdvertised: decoderMatches.length > 0,
    senderCodecs,
    receiverCodecs,
    mediaCapabilitiesAvailable,
    supported,
    hardware,
    powerEfficient,
    checks,
    reason,
  };
}

export async function probeVideoCodecDiagnostics(): Promise<VideoCodecDiagnostic[]> {
  const capabilities = (globalThis as any).RTCRtpSender?.getCapabilities?.("video")?.codecs || [];
  const decoderCapabilities = (globalThis as any).RTCRtpReceiver?.getCapabilities?.("video")?.codecs || [];
  return Promise.all(videoCandidates.map((candidate) => inspectVideoCodec(candidate, capabilities, decoderCapabilities)));
}

export async function probeVideoCodecs(): Promise<VideoCapability[]> {
  const diagnostics = await probeVideoCodecDiagnostics();
  return diagnostics.map((diagnostic) => ({
    key: diagnostic.key,
    label: diagnostic.label,
    codec: diagnostic.codec,
    srtCompatible: diagnostic.srtCompatible,
    supported: diagnostic.srtCompatible && diagnostic.hardware,
    hardware: diagnostic.hardware,
    powerEfficient: diagnostic.powerEfficient === true,
    reason: diagnostic.reason,
  }));
}

export async function probeAudioCodecs(): Promise<AudioCapability[]> {
  const capabilities = (globalThis as any).RTCRtpSender?.getCapabilities?.("audio")?.codecs || [];
  const opusSupported = capabilities.some((codec: { mimeType?: string }) => String(codec.mimeType).toLowerCase() === "audio/opus");
  return [{ key: "opus" as const, label: "Opus", codec: "opus", supported: opusSupported }];
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberRange(value: any): NumericRange | null {
  if (!value || typeof value !== "object") return null;
  const range = {
    min: nullableNumber(value.min),
    max: nullableNumber(value.max),
    step: nullableNumber(value.step),
  };
  return range.min === null && range.max === null && range.step === null ? null : range;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  return typeof value === "string" && value ? [value] : [];
}

function snapshotTrack(settings: MediaTrackSettings | undefined): TrackSnapshot {
  const raw = settings as (MediaTrackSettings & { resizeMode?: string }) | undefined;
  const width = finiteNumber(settings?.width) || 0;
  const height = finiteNumber(settings?.height) || 0;
  return {
    width,
    height,
    aspectRatio: width > 0 && height > 0 ? width / height : finiteNumber(settings?.aspectRatio) || 0,
    frameRate: finiteNumber(settings?.frameRate) || 0,
    resizeMode: String(raw?.resizeMode || ""),
    facingMode: String(settings?.facingMode || ""),
  };
}

function snapshotCameraCapabilities(capabilities: any): CameraCapabilitySnapshot {
  return {
    width: numberRange(capabilities?.width),
    height: numberRange(capabilities?.height),
    aspectRatio: numberRange(capabilities?.aspectRatio),
    frameRate: numberRange(capabilities?.frameRate),
    resizeMode: stringList(capabilities?.resizeMode),
    facingMode: stringList(capabilities?.facingMode),
    zoom: numberRange(capabilities?.zoom),
    torch: typeof capabilities?.torch === "boolean" ? capabilities.torch : null,
    focusMode: stringList(capabilities?.focusMode),
    exposureMode: stringList(capabilities?.exposureMode),
    whiteBalanceMode: stringList(capabilities?.whiteBalanceMode),
  };
}

function snapshotAudioCapabilities(capabilities: any): AudioCapabilitySnapshot {
  return {
    sampleRate: numberRange(capabilities?.sampleRate),
    sampleSize: numberRange(capabilities?.sampleSize),
    channelCount: numberRange(capabilities?.channelCount),
    latency: numberRange(capabilities?.latency),
    echoCancellation: stringList(capabilities?.echoCancellation),
    noiseSuppression: stringList(capabilities?.noiseSuppression),
    autoGainControl: stringList(capabilities?.autoGainControl),
  };
}

function snapshotAudioTrack(settings: MediaTrackSettings | undefined): AudioTrackSnapshot {
  const raw = settings as (MediaTrackSettings & { latency?: number }) | undefined;
  return {
    sampleRate: finiteNumber(settings?.sampleRate) || 0,
    sampleSize: finiteNumber(settings?.sampleSize) || 0,
    channelCount: finiteNumber(settings?.channelCount) || 0,
    latency: finiteNumber(raw?.latency) || 0,
    echoCancellation: typeof settings?.echoCancellation === "boolean" ? settings.echoCancellation : null,
    noiseSuppression: typeof settings?.noiseSuppression === "boolean" ? settings.noiseSuppression : null,
    autoGainControl: typeof settings?.autoGainControl === "boolean" ? settings.autoGainControl : null,
  };
}

function cameraVideoConstraints(deviceId: string, extra: MediaTrackConstraints = {}): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    ...extra,
  };
}

async function openDiagnosticCamera(deviceId: string, extra: MediaTrackConstraints = {}): Promise<{ stream: MediaStream; track: MediaStreamTrack }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: cameraVideoConstraints(deviceId, extra),
    audio: false,
  });
  const track = stream.getVideoTracks()[0];
  if (!track) {
    stream.getTracks().forEach((item) => item.stop());
    throw new Error("Kamera tidak menghasilkan track video.");
  }
  return { stream, track };
}

function ratioCheckStatus(actual: TrackSnapshot, targetRatio: number): "matched" | "fallback" {
  return actual.width > 0 && actual.height > 0 && isAspectRatioClose(actual.width, actual.height, targetRatio) ? "matched" : "fallback";
}

function resolutionCheckStatus(actual: TrackSnapshot, width: number, height: number): "exact" | "higher" | "fallback" {
  if (actual.width === width && actual.height === height && isAspectRatioClose(actual.width, actual.height, width / height)) return "exact";
  if (actual.width >= width && actual.height >= height && isAspectRatioClose(actual.width, actual.height, width / height)) return "higher";
  return "fallback";
}

function ratioProbeDimensions(targetRatio: number): { width: number; height: number } {
  const width = targetRatio < 1 ? 720 : targetRatio > 1 ? 1280 : 720;
  return { width, height: Math.round(width / targetRatio) };
}

function constraintDimensionsForTarget(target: { width: number; height: number }): { width: number; height: number }[] {
  const swapped = { width: target.height, height: target.width };
  return target.height > target.width ? [swapped, target] : [target, swapped];
}

async function checkCameraRatio(deviceId: string, label: string, targetRatio: number): Promise<CameraRatioCheck> {
  const target = ratioProbeDimensions(targetRatio);
  let fallback: CameraRatioCheck | null = null;
  let lastError = "Probe rasio gagal.";
  for (const dimensions of constraintDimensionsForTarget(target)) {
    let stream: MediaStream | null = null;
    try {
      const opened = await openDiagnosticCamera(deviceId, {
        width: { ideal: dimensions.width },
        height: { ideal: dimensions.height },
        aspectRatio: { ideal: dimensions.width / dimensions.height },
        resizeMode: { ideal: "crop-and-scale" } as any,
      } as any);
      stream = opened.stream;
      const actual = snapshotTrack(opened.track.getSettings());
      const result = { label, targetRatio, actual, status: ratioCheckStatus(actual, targetRatio) } as CameraRatioCheck;
      if (result.status === "matched") return result;
      fallback ||= result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }
  return fallback || { label, targetRatio, actual: null, status: "failed", error: lastError };
}

async function checkCameraResolution(deviceId: string, target: { label: string; width: number; height: number }): Promise<CameraResolutionCheck> {
  let fallback: CameraResolutionCheck | null = null;
  let lastError = "Probe resolusi gagal.";
  for (const dimensions of constraintDimensionsForTarget(target)) {
    let stream: MediaStream | null = null;
    try {
      const opened = await openDiagnosticCamera(deviceId, {
        width: { ideal: dimensions.width },
        height: { ideal: dimensions.height },
        aspectRatio: { ideal: dimensions.width / dimensions.height },
        resizeMode: { ideal: "crop-and-scale" } as any,
      } as any);
      stream = opened.stream;
      const actual = snapshotTrack(opened.track.getSettings());
      const result = { ...target, targetWidth: target.width, targetHeight: target.height, actual, status: resolutionCheckStatus(actual, target.width, target.height) } as CameraResolutionCheck;
      if (result.status === "exact" || result.status === "higher") return result;
      fallback ||= result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }
  return fallback || { ...target, targetWidth: target.width, targetHeight: target.height, actual: null, status: "failed", error: lastError };
}

async function inspectCamera(device: MediaDeviceInfo): Promise<CameraDiagnostic> {
  let stream: MediaStream | null = null;
  try {
    const opened = await openDiagnosticCamera(device.deviceId);
    stream = opened.stream;
    const capabilities = snapshotCameraCapabilities(opened.track.getCapabilities?.() || {});
    const initial = snapshotTrack(opened.track.getSettings());
    return {
      deviceId: device.deviceId,
      label: device.label || "Kamera tanpa nama",
      capabilities,
      initial,
      ratioChecks: [],
      resolutionChecks: [],
    };
  } catch (error) {
    return {
      deviceId: device.deviceId,
      label: device.label || "Kamera tanpa nama",
      capabilities: null,
      initial: null,
      ratioChecks: [],
      resolutionChecks: [],
      error: error instanceof Error ? error.message : "Kamera tidak bisa dibuka.",
    };
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}

async function inspectCameraWithProbes(device: MediaDeviceInfo): Promise<CameraDiagnostic> {
  const diagnostic = await inspectCamera(device);
  if (diagnostic.error) return diagnostic;
  diagnostic.ratioChecks = [];
  for (const target of DEVICE_CHECK_RATIOS) diagnostic.ratioChecks.push(await checkCameraRatio(device.deviceId, target.label, target.ratio));
  diagnostic.resolutionChecks = [];
  for (const target of DEVICE_CHECK_RESOLUTIONS) diagnostic.resolutionChecks.push(await checkCameraResolution(device.deviceId, target));
  return diagnostic;
}

async function permissionState(name: "camera" | "microphone"): Promise<string> {
  try {
    const permissions = (navigator as any).permissions;
    if (typeof permissions?.query !== "function") return "unknown";
    return String((await permissions.query({ name })).state || "unknown");
  } catch {
    return "unknown";
  }
}

function browserDiagnostic(permissions: { camera: string; microphone: string }): BrowserDiagnostic {
  const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {};
  return {
    secureContext: window.isSecureContext,
    userAgent: navigator.userAgent,
    api: {
      mediaDevices: Boolean(navigator.mediaDevices),
      getUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
      enumerateDevices: Boolean(navigator.mediaDevices?.enumerateDevices),
      getSupportedConstraints: Boolean(navigator.mediaDevices?.getSupportedConstraints),
      trackCapabilities: typeof MediaStreamTrack !== "undefined" && typeof MediaStreamTrack.prototype.getCapabilities === "function",
      trackSettings: typeof MediaStreamTrack !== "undefined" && typeof MediaStreamTrack.prototype.getSettings === "function",
      webRTC: Boolean((globalThis as any).RTCPeerConnection),
      codecCapabilities: Boolean((globalThis as any).RTCRtpSender?.getCapabilities),
      mediaCapabilitiesEncoding: typeof (navigator as any).mediaCapabilities?.encodingInfo === "function",
    },
    permissions,
    supportedConstraints: Object.fromEntries(Object.entries(supported).map(([key, value]) => [key, value === true])),
  };
}

function audioCodecList(kind: "audio" | "video"): string[] {
  const sender = (globalThis as any).RTCRtpSender?.getCapabilities?.(kind)?.codecs || [];
  return sender.map(codecDescription).filter(Boolean);
}

function receiverCodecList(kind: "audio" | "video"): string[] {
  const receiver = (globalThis as any).RTCRtpReceiver?.getCapabilities?.(kind)?.codecs || [];
  return receiver.map(codecDescription).filter(Boolean);
}

export async function runDeviceCheck(onProgress?: (message: string) => void): Promise<DeviceCheckReport> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API tidak tersedia. Buka halaman ini melalui HTTPS atau localhost.");

  onProgress?.("Meminta izin kamera...");
  let cameraPermissionStream: MediaStream | null = null;
  let cameraError = "";
  try {
    cameraPermissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  } catch (error) {
    cameraError = mediaAccessError(error, "camera").message;
  } finally {
    cameraPermissionStream?.getTracks().forEach((track) => track.stop());
  }

  onProgress?.("Meminta izin mikrofon...");
  let audioPermissionStream: MediaStream | null = null;
  let audioError = "";
  try {
    audioPermissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (error) {
    audioError = mediaAccessError(error, "microphone").message;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === "videoinput");
  const microphones = devices.filter((device) => device.kind === "audioinput");
  const cameraDiagnostics: CameraDiagnostic[] = [];
  for (const [index, camera] of cameras.entries()) {
    onProgress?.(`Memeriksa kamera ${index + 1}/${cameras.length}...`);
    cameraDiagnostics.push(await inspectCameraWithProbes(camera));
  }

  let activeAudio: AudioTrackSnapshot | null = null;
  let audioCapabilities: AudioCapabilitySnapshot | null = null;
  const audioTrack = audioPermissionStream?.getAudioTracks()[0];
  if (audioTrack) {
    activeAudio = snapshotAudioTrack(audioTrack.getSettings());
    audioCapabilities = snapshotAudioCapabilities(audioTrack.getCapabilities?.() || {});
  }
  audioPermissionStream?.getTracks().forEach((track) => track.stop());

  onProgress?.("Memeriksa encoder WebRTC...");
  const codecs = await probeVideoCodecDiagnostics();
  const permissions = {
    camera: cameraPermissionStream ? "granted" : await permissionState("camera"),
    microphone: audioPermissionStream ? "granted" : await permissionState("microphone"),
  };
  const audio: AudioDiagnostic = {
    devices: microphones.map((device) => ({ deviceId: device.deviceId, groupId: device.groupId, label: device.label || "Mikrofon tanpa nama" })),
    active: activeAudio,
    capabilities: audioCapabilities,
    senderCodecs: audioCodecList("audio"),
    receiverCodecs: receiverCodecList("audio"),
    opusSupported: audioCodecList("audio").some((codec) => codec.toLowerCase().startsWith("audio/opus")),
    permission: permissions.microphone,
    error: audioError || undefined,
  };
  if (cameraError && cameraDiagnostics.length === 0) {
    cameraDiagnostics.push({
      deviceId: "",
      label: "Kamera tidak bisa diakses",
      capabilities: null,
      initial: null,
      ratioChecks: [],
      resolutionChecks: [],
      error: cameraError,
    });
  }

  return {
    checkedAt: new Date().toISOString(),
    browser: browserDiagnostic(permissions),
    cameras: cameraDiagnostics,
    audio,
    codecs,
  };
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
  let sourceSettings: MediaTrackSettings;
  try {
    const result = await requestNativeCamera(
      input.deviceId,
      input.audioEnabled ? audioConstraints : false,
      input.fps,
      { width: input.width, height: input.height },
    );
    sourceStream = result.stream;
    sourceTrack = result.track;
    sourceSettings = result.settings;
  } catch (error) {
    throw mediaAccessError(error, input.audioEnabled ? "camera-microphone" : "camera");
  }

  const sourceFps = finiteNumber(sourceSettings.frameRate) || 0;
  const sourceWidth = finiteNumber(sourceSettings.width) || 0;
  const sourceHeight = finiteNumber(sourceSettings.height) || 0;

  const audioTracks = input.audioEnabled ? sourceStream.getAudioTracks() : [];
  if (input.audioEnabled && audioTracks.length === 0) {
    sourceStream.getTracks().forEach((track) => track.stop());
    throw new Error("Mikrofon tidak menghasilkan audio track. Pilih input audio lain atau matikan audio.");
  }
  // Keep the camera track intact. Chrome may crop/scale it in the capture
  // pipeline, but this client does not rasterize it through a canvas.
  const stream = sourceStream;
  const outputTrack = sourceTrack;
  const actualWidth = sourceWidth;
  const actualHeight = sourceHeight;
  const actualFps = sourceFps;

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
    sourceWidth,
    sourceHeight,
    sourceFps,
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
      sourceStream.getTracks().forEach((track) => track.stop());
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
