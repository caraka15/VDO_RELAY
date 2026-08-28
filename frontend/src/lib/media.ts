import type { StartStreamInput } from "./api";

export type VideoCapability = {
  key: string;
  label: string;
  codec: string;
  supported: boolean;
  srtCompatible: boolean;
};

export type AudioCapability = {
  key: "aac" | "opus";
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
};

export type CaptureSession = {
  sourceStream: MediaStream;
  stream: MediaStream;
  canvas: HTMLCanvasElement;
  actualWidth: number;
  actualHeight: number;
  actualFps: number;
  audioTrack: MediaStreamTrack | null;
  getAudioLevel: () => number;
  setPortraitMode: (portraitMode: boolean) => void;
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
      const facingMode = Array.isArray(capabilities.facingMode) ? capabilities.facingMode[0] || "" : String(capabilities.facingMode || settings.facingMode || "");
      result.push({ deviceId: device.deviceId, label: device.label || `Kamera ${result.length + 1}`, facingMode, maxWidth, maxHeight, maxFps, zoom });
    } catch {
      result.push({ deviceId: device.deviceId, label: device.label || `Kamera ${result.length + 1}`, facingMode: "", maxWidth: 0, maxHeight: 0, maxFps: 0, zoom: null });
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }
  return result;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

const videoCandidates = [
  { key: "av1", label: "AV1", codecs: ["av01.0.04M.08"], srtCompatible: false },
  { key: "vp9", label: "VP9", codecs: ["vp09.00.10.08"], srtCompatible: false },
  { key: "vp8", label: "VP8", codecs: ["vp8"], srtCompatible: false },
  { key: "h264", label: "H.264", codecs: ["avc3.640028", "avc1.640028", "avc1.4D4028", "avc1.4D401F"], srtCompatible: true },
  { key: "h265", label: "H.265", codecs: ["hev1.1.6.L93.B0", "hvc1.1.6.L93.B0"], srtCompatible: true },
] as const;

export async function probeVideoCodecs(width = 1280, height = 720, fps = 30): Promise<VideoCapability[]> {
  const encoder = (globalThis as any).VideoEncoder;
  if (!encoder?.isConfigSupported) return [];
  return Promise.all(
    videoCandidates.map(async (candidate) => {
      for (const codec of candidate.codecs) {
        try {
          const result = await encoder.isConfigSupported({
            codec,
            width,
            height,
            bitrate: 5_000_000,
            framerate: fps,
            latencyMode: "realtime",
          });
          if (result.supported === true) return { key: candidate.key, label: candidate.label, codec, srtCompatible: candidate.srtCompatible, supported: true };
        } catch {
          // Try the next browser-specific codec string.
        }
      }
      return { key: candidate.key, label: candidate.label, codec: candidate.codecs[0], srtCompatible: candidate.srtCompatible, supported: false };
    }),
  );
}

export async function probeAudioCodecs(): Promise<AudioCapability[]> {
  const encoder = (globalThis as any).AudioEncoder;
  if (!encoder?.isConfigSupported) return [];
  const candidates = [
    { key: "aac" as const, label: "AAC", codec: "mp4a.40.2" },
    { key: "opus" as const, label: "Opus", codec: "opus" },
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

export async function openCapture(
  input: Pick<StartStreamInput, "width" | "height" | "fps" | "audioEnabled" | "portraitMode"> & { deviceId?: string; audioDeviceId?: string },
): Promise<CaptureSession> {
  assertBrowserMediaSupport(input.audioEnabled);
  const videoConstraints: MediaTrackConstraints = {};
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
      video: input.deviceId ? videoConstraints : true,
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

  const actualWidth = video.videoWidth || settings.width || 0;
  const actualHeight = video.videoHeight || settings.height || 0;
  if (!actualWidth || !actualHeight) {
    sourceStream.getTracks().forEach((track) => track.stop());
    video.pause();
    video.srcObject = null;
    video.remove();
    throw new Error("Browser tidak melaporkan resolusi kamera aktual.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = input.width;
  canvas.height = input.height;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `Preview output ${input.width} kali ${input.height}`);
  canvas.style.display = "block";
  canvas.style.width = "auto";
  canvas.style.height = "auto";
  canvas.style.maxWidth = "100%";
  canvas.style.maxHeight = "100%";
  const context = canvas.getContext("2d");
  if (!context || !(canvas as any).captureStream) {
    sourceStream.getTracks().forEach((track) => track.stop());
    video.remove();
    throw new Error("Canvas capture tidak tersedia di browser ini.");
  }

  let running = true;
  let portraitMode = input.portraitMode;
  let animationFrame = 0;
  let lastDraw = -Infinity;
  const frameInterval = 1000 / input.fps;
  const draw = (timestamp: number) => {
    if (!running) return;
    if (timestamp - lastDraw >= frameInterval - 1) {
      lastDraw = timestamp;
      const sourceWidth = video.videoWidth || actualWidth;
      const sourceHeight = video.videoHeight || actualHeight;
      const outputPortrait = canvas.height > canvas.width;
      const contain = portraitMode !== outputPortrait;
      const rotate = (sourceHeight > sourceWidth) !== portraitMode;
      const contentWidth = rotate ? sourceHeight : sourceWidth;
      const contentHeight = rotate ? sourceWidth : sourceHeight;
      const scale = contain
        ? Math.min(canvas.width / contentWidth, canvas.height / contentHeight)
        : Math.max(canvas.width / contentWidth, canvas.height / contentHeight);
      context.fillStyle = "#000000";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.translate(canvas.width / 2, canvas.height / 2);
      if (rotate) context.rotate(Math.PI / 2);
      context.drawImage(video, -(sourceWidth * scale) / 2, -(sourceHeight * scale) / 2, sourceWidth * scale, sourceHeight * scale);
      context.restore();
    }
    animationFrame = requestAnimationFrame(draw);
  };
  animationFrame = requestAnimationFrame(draw);

  const outputStream = (canvas as any).captureStream(input.fps) as MediaStream;
  const audioTracks = input.audioEnabled ? sourceStream.getAudioTracks() : [];
  if (input.audioEnabled && audioTracks.length === 0) {
    sourceStream.getTracks().forEach((track) => track.stop());
    outputStream.getTracks().forEach((track) => track.stop());
    video.pause();
    video.srcObject = null;
    video.remove();
    canvas.remove();
    throw new Error("Mikrofon tidak menghasilkan audio track. Pilih input audio lain atau matikan audio.");
  }
  const stream = new MediaStream([...outputStream.getVideoTracks(), ...audioTracks]);

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
    canvas,
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
    setPortraitMode: (next) => {
      portraitMode = next;
    },
    stop: () => {
      running = false;
      cancelAnimationFrame(animationFrame);
      stream.getTracks().forEach((track) => track.stop());
      outputStream.getTracks().forEach((track) => track.stop());
      sourceStream.getTracks().forEach((track) => track.stop());
      video.pause();
      video.srcObject = null;
      video.remove();
      void audioContext?.close();
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
