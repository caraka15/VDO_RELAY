import type { StartStreamInput } from "./api";

export type VideoCapability = {
  key: string;
  label: string;
  codec: string;
  supported: boolean;
  srtCompatible: boolean;
};

export type AudioCapability = {
  label: string;
  codec: string;
  supported: boolean;
};

export type CaptureSession = {
  sourceStream: MediaStream;
  stream: MediaStream;
  canvas: HTMLCanvasElement;
  actualWidth: number;
  actualHeight: number;
  actualFps: number;
  stop: () => void;
};

export type Publisher = {
  close: () => void;
  setVideoBitrate?: (kbps: number) => void;
  getVideoEncoderQueueSize?: () => number | null;
};

export type MediaDeviceRequest = "camera" | "microphone" | "camera-microphone";

export function mediaAccessError(error: unknown, request: MediaDeviceRequest): Error {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  const device = request === "camera" ? "kamera" : request === "microphone" ? "mikrofon" : "kamera/mikrofon";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new Error(`Izin ${device} ditolak. Tekan ikon di kiri alamat Chrome → Izin situs → izinkan ${device}, lalu muat ulang halaman.`);
  }
  if (name === "OverconstrainedError") {
    const constraint = error && typeof error === "object" && "constraint" in error ? String(error.constraint) : "resolusi/FPS";
    return new Error(`Profile kamera tidak didukung pada ${constraint}. Stop job lalu buat stream baru dengan resolusi atau FPS lebih rendah.`);
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

const videoCandidates = [
  { key: "av1", label: "AV1", codec: "av01.0.04M.08", srtCompatible: false },
  { key: "vp9", label: "VP9", codec: "vp09.00.10.08", srtCompatible: false },
  { key: "vp8", label: "VP8", codec: "vp8", srtCompatible: false },
  { key: "h264", label: "H.264", codec: "avc3.640028", srtCompatible: true },
  { key: "h265", label: "H.265", codec: "hev1.1.6.L93.B0", srtCompatible: true },
] as const;

export async function probeVideoCodecs(
  width = 1280,
  height = 720,
  fps = 30,
): Promise<VideoCapability[]> {
  const encoder = (globalThis as any).VideoEncoder;
  if (!encoder?.isConfigSupported) return [];
  return Promise.all(
    videoCandidates.map(async (candidate) => {
      try {
        const result = await encoder.isConfigSupported({
          codec: candidate.codec,
          width,
          height,
          bitrate: 5_000_000,
          framerate: fps,
          latencyMode: "realtime",
        });
        return { ...candidate, supported: result.supported === true };
      } catch {
        return { ...candidate, supported: false };
      }
    }),
  );
}

export async function probeAudioCodecs(): Promise<AudioCapability[]> {
  const encoder = (globalThis as any).AudioEncoder;
  if (!encoder?.isConfigSupported) return [];
  const candidates = [
    { label: "AAC", codec: "mp4a.40.2" },
    { label: "Opus", codec: "opus" },
  ];
  return Promise.all(
    candidates.map(async (candidate) => {
      try {
        const result = await encoder.isConfigSupported({
          codec: candidate.codec,
          sampleRate: 48_000,
          numberOfChannels: 2,
          bitrate: 128_000,
        });
        return { ...candidate, supported: result.supported === true };
      } catch {
        return { ...candidate, supported: false };
      }
    }),
  );
}

export function assertBrowserMediaSupport(audioEnabled = true): void {
  const missing: string[] = [];
  if (!navigator.mediaDevices?.getUserMedia) missing.push("camera API");
  if (!(globalThis as any).VideoEncoder) missing.push("WebCodecs VideoEncoder");
  if (audioEnabled && !(globalThis as any).AudioEncoder) missing.push("WebCodecs AudioEncoder");
  if (!(globalThis as any).MediaStreamTrackProcessor) missing.push("MediaStreamTrackProcessor");
  if (!(globalThis as any).WebTransport) missing.push("WebTransport");
  if (missing.length > 0) {
    throw new Error(`Browser belum mendukung: ${missing.join(", ")}. Buka dengan Chrome HTTPS terbaru.`);
  }
}

function sortedDimensions(width: number, height: number): [number, number] {
  return [Math.min(width, height), Math.max(width, height)];
}

export async function openCapture(
  input: Pick<StartStreamInput, "width" | "height" | "fps" | "audioEnabled" | "portraitMode"> & { deviceId?: string; audioDeviceId?: string },
): Promise<CaptureSession> {
  assertBrowserMediaSupport(input.audioEnabled);
  const videoConstraints: MediaTrackConstraints = {
    width: { ideal: input.width },
    height: { ideal: input.height },
    frameRate: { exact: input.fps },
  };
  if (input.deviceId) videoConstraints.deviceId = { exact: input.deviceId };
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
      audio: input.audioEnabled
        ? audioConstraints
        : false,
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
  const actualFps = settings.frameRate;
  if (typeof actualFps !== "number" || !Number.isFinite(actualFps)) {
    sourceStream.getTracks().forEach((track) => track.stop());
    throw new Error("Browser tidak melaporkan FPS kamera aktual; profile tidak dapat diverifikasi.");
  }
  if (actualFps + 0.5 < input.fps) {
    sourceStream.getTracks().forEach((track) => track.stop());
    throw new Error(`Kamera hanya berjalan ${actualFps} FPS; profile ${input.fps} FPS tidak didukung.`);
  }

  const video = document.createElement("video");
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("aria-hidden", "true");
  video.style.position = "fixed";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";
  video.srcObject = sourceStream;
  document.body.appendChild(video);

  try {
    await new Promise<void>((resolve, reject) => {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        resolve();
        return;
      }
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Metadata kamera tidak bisa dibaca."));
    });
    await video.play();
  } catch (error) {
    sourceStream.getTracks().forEach((track) => track.stop());
    video.remove();
    throw new Error(`Preview kamera gagal dimulai: ${error instanceof Error ? error.message : String(error)}`);
  }

  const actualWidth = video.videoWidth || settings.width;
  const actualHeight = video.videoHeight || settings.height;
  if (typeof actualWidth !== "number" || !Number.isFinite(actualWidth) || actualWidth <= 0 ||
      typeof actualHeight !== "number" || !Number.isFinite(actualHeight) || actualHeight <= 0) {
    sourceStream.getTracks().forEach((track) => track.stop());
    video.pause();
    video.srcObject = null;
    video.remove();
    throw new Error("Browser tidak melaporkan resolusi kamera aktual; profile tidak dapat diverifikasi.");
  }
  const [actualMin, actualMax] = sortedDimensions(actualWidth, actualHeight);
  const [targetMin, targetMax] = sortedDimensions(input.width, input.height);
  if (actualMin < targetMin || actualMax < targetMax) {
    sourceStream.getTracks().forEach((track) => track.stop());
    video.pause();
    video.srcObject = null;
    video.remove();
    throw new Error(`Kamera hanya memberi ${actualWidth}×${actualHeight}; profile ${input.width}×${input.height} tidak didukung. Pilih resolusi lebih rendah.`);
  }

  const canvas = document.createElement("canvas");
  canvas.width = input.width;
  canvas.height = input.height;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Preview output 16 banding 9");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.objectFit = "contain";
  const context = canvas.getContext("2d");
  if (!context || !(canvas as any).captureStream) {
    sourceStream.getTracks().forEach((track) => track.stop());
    video.remove();
    throw new Error("Canvas capture tidak tersedia di browser ini.");
  }

  let running = true;
  let animationFrame = 0;
  let lastDraw = -Infinity;
  const frameInterval = 1000 / input.fps;
  const draw = (timestamp: number) => {
    if (!running) return;
    if (timestamp - lastDraw >= frameInterval - 1) {
      lastDraw = timestamp;
      const sourceWidth = video.videoWidth || actualWidth;
      const sourceHeight = video.videoHeight || actualHeight;
      const scale = input.portraitMode
        ? Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight)
        : Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight);
      const drawWidth = sourceWidth * scale;
      const drawHeight = sourceHeight * scale;
      const drawX = (canvas.width - drawWidth) / 2;
      const drawY = (canvas.height - drawHeight) / 2;
      context.fillStyle = "#000000";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(video, drawX, drawY, drawWidth, drawHeight);
    }
    animationFrame = requestAnimationFrame(draw);
  };
  animationFrame = requestAnimationFrame(draw);

  const outputStream = (canvas as any).captureStream(input.fps) as MediaStream;
  const audioTracks = input.audioEnabled ? sourceStream.getAudioTracks() : [];
  const stream = new MediaStream([...outputStream.getVideoTracks(), ...audioTracks]);

  return {
    sourceStream,
    stream,
    canvas,
    actualWidth,
    actualHeight,
    actualFps,
    stop: () => {
      running = false;
      cancelAnimationFrame(animationFrame);
      stream.getTracks().forEach((track) => track.stop());
      outputStream.getTracks().forEach((track) => track.stop());
      sourceStream.getTracks().forEach((track) => track.stop());
      video.pause();
      video.srcObject = null;
      video.remove();
      canvas.remove();
    },
  };
}

export async function startMoqPublisher(options: {
  publishUrl: string;
  fingerprintUrl: string;
  publishToken: string;
  capture: CaptureSession;
  codec: VideoCapability;
  input: StartStreamInput;
  audioCodec?: AudioCapability;
  onConnected: () => void;
  onError: (message: string) => void;
}): Promise<Publisher> {
  const { MediaMTXMoQPublisher } = await import("./mediamtx-publisher.js");
  return new (MediaMTXMoQPublisher as any)({
    fingerprintUrl: options.fingerprintUrl,
    url: options.publishUrl,
    token: options.publishToken,
    stream: options.capture.stream,
    videoCodec: options.codec.codec,
    videoBitrate: options.input.maxBitrateKbps,
    videoFramerate: options.input.fps,
    videoKeyframeInterval: options.input.fps * 2,
    videoWidth: options.input.width,
    videoHeight: options.input.height,
    audioCodec: options.audioCodec?.codec || "opus",
    audioBitrate: 128,
    onConnected: options.onConnected,
    onError: options.onError,
  }) as Publisher;
}

export function startAdaptiveBitrate(
  publisher: Publisher,
  maxBitrateKbps: number,
  callbacks: { onTarget: (target: number) => void; onFailure: () => void },
): () => void {
  const floor = Math.max(256, Math.floor(maxBitrateKbps * 0.25));
  let target = maxBitrateKbps;
  let pressureSince = 0;
  let stableSince = 0;
  let stopped = false;
  const applyTarget = (next: number) => {
    try {
      publisher.setVideoBitrate?.(next);
      callbacks.onTarget(next);
      return true;
    } catch {
      callbacks.onFailure();
      stopped = true;
      return false;
    }
  };
  const timer = window.setInterval(() => {
    if (stopped || !publisher.getVideoEncoderQueueSize) return;
    const queueSize = publisher.getVideoEncoderQueueSize();
    const now = Date.now();
    if (queueSize !== null && queueSize > 6) {
      stableSince = 0;
      pressureSince ||= now;
      if (now - pressureSince >= 5_000) {
        if (target <= floor) {
          callbacks.onFailure();
          return;
        }
        target = Math.max(floor, Math.floor((target * 0.8) / 10) * 10);
        if (!applyTarget(target)) return;
        pressureSince = now;
      }
      return;
    }
    pressureSince = 0;
    stableSince ||= now;
    if (now - stableSince >= 15_000 && target < maxBitrateKbps) {
      target = Math.min(maxBitrateKbps, Math.ceil((target * 1.1) / 10) * 10);
      if (!applyTarget(target)) return;
      stableSince = now;
    }
  }, 2_000);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}
