export type Session = {
  authenticated: boolean;
  username?: string;
  mustChangePassword?: boolean;
};

export type Stream = {
  id: string;
  path: string;
  status: "ready" | "connecting" | "live" | "stopped" | "failed";
  codec: "h264" | "h265";
  audioCodec: "aac" | "opus";
  width: number;
  height: number;
  fps: number;
  maxBitrateKbps: number;
  currentBitrateKbps: number;
  portraitMode: boolean;
  audioEnabled: boolean;
  record: boolean;
  createdAt: string;
  publishUrl?: string;
  fingerprintUrl?: string;
  publishToken?: string;
  srtUrl?: string;
  playerUrl?: string;
  error?: string;
};

export type StreamStats = {
  id: string;
  status: string;
  maxBitrateKbps: number;
  currentBitrateKbps: number;
  receivedBitrateKbps: number | null;
  codec: string;
  width: number;
  height: number;
  fps: number;
  srtReaders: number;
  recording: boolean;
  mediaAvailable: boolean;
};

export type Recording = {
  id: string;
  streamId?: string;
  name: string;
  sizeBytes: number;
  updatedAt: string;
  downloadUrl: string;
};

export type StartStreamInput = {
  codec: "h264" | "h265";
  audioCodec: "aac" | "opus";
  width: number;
  height: number;
  fps: number;
  maxBitrateKbps: number;
  portraitMode: boolean;
  audioEnabled: boolean;
  record: boolean;
};

export class APIError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = "request_failed", status = 0) {
    super(message);
    this.name = "APIError";
    this.code = code;
    this.status = status;
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      ...init,
      signal: controller.signal,
    });
    if (response.status === 204) {
      return undefined as T;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new APIError(payload.error || "Request failed", payload.code, response.status);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new APIError("Server tidak merespons dalam 12 detik. Coba refresh setelah memeriksa koneksi.", "request_timeout", 408);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const getSession = () => request<Session>("/api/auth/session");

export const login = (username: string, password: string) =>
  request<Session>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });

export const logout = () => request<void>("/api/auth/logout", { method: "POST" });

export const changePassword = (currentPassword: string, newPassword: string) =>
  request<{ ok: boolean; mustChangePassword: boolean }>("/api/auth/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });

export const listStreams = async () => (await request<Stream[] | null>("/api/streams")) ?? [];

export const createStream = (input: StartStreamInput) =>
  request<Stream>("/api/streams", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const getStream = (id: string) =>
  request<Stream>(`/api/streams/${encodeURIComponent(id)}`);

export const updateStream = (id: string, input: StartStreamInput) =>
  request<Stream>(`/api/streams/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });

export const getStreamStats = (id: string) =>
  request<StreamStats>(`/api/streams/${encodeURIComponent(id)}/stats`);

export const stopStream = (id: string) =>
  request<Stream>(`/api/streams/${encodeURIComponent(id)}/stop`, { method: "POST" });

export const listRecordings = async () => (await request<Recording[] | null>("/api/recordings")) ?? [];

export const deleteRecording = (id: string) =>
  request<void>(`/api/recordings/${encodeURIComponent(id)}`, { method: "DELETE" });
