export type Session = {
  authenticated: boolean;
  username?: string;
  mustChangePassword?: boolean;
};

export type Stream = {
  id: string;
  path: string;
  status: "connecting" | "live" | "stopped" | "failed";
  codec: "h264" | "h265";
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
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    ...init,
  });
  if (response.status === 204) {
    return undefined as T;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new APIError(payload.error || "Request failed", payload.code, response.status);
  }
  return payload as T;
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

export const listStreams = () => request<Stream[]>("/api/streams");

export const createStream = (input: StartStreamInput) =>
  request<Stream>("/api/streams", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const getStreamStats = (id: string) =>
  request<StreamStats>(`/api/streams/${encodeURIComponent(id)}/stats`);

export const stopStream = (id: string) =>
  request<Stream>(`/api/streams/${encodeURIComponent(id)}/stop`, { method: "POST" });

export const listRecordings = () => request<Recording[]>("/api/recordings");

export const deleteRecording = (id: string) =>
  request<void>(`/api/recordings/${encodeURIComponent(id)}`, { method: "DELETE" });
