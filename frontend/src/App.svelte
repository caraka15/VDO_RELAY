<script lang="ts">
  import { onMount } from "svelte";
  import { AlertCircle, LoaderCircle } from "@lucide/svelte";
  import {
    APIError,
    changePassword,
    createStream,
    deleteStream,
    deleteRecording,
    getSession,
    getStream,
    getStreamStats,
    listRecordings,
    listStreams,
    login,
    logout,
    stopStream,
    updateStream,
    type Recording,
    type Session,
    type StartStreamInput,
    type Stream,
    type StreamStats,
  } from "./lib/api";
  import {
    openCapture,
    checkMicrophone,
    mediaAccessError,
    probeCameraDevices,
    probeAudioCodecs,
    probeVideoCodecs,
    startWhipPublisher,
    type AudioCapability,
    type CameraDevice,
    type CaptureSession,
    type Publisher,
    type VideoCapability,
  } from "./lib/media";
  import DashboardView from "./components/DashboardView.svelte";
  import LiveView from "./components/LiveView.svelte";
  import LoginView from "./components/LoginView.svelte";
  import PasswordView from "./components/PasswordView.svelte";
  import PlayerView from "./components/PlayerView.svelte";
  import ResultView from "./components/ResultView.svelte";
  import SetupView from "./components/SetupView.svelte";
  import DeviceCheckView from "./components/DeviceCheckView.svelte";

  type Page = "login" | "password" | "dashboard" | "device-check" | "setup" | "live" | "result" | "player";
  type AuthLandingPage = "dashboard" | "device-check";
  type PreparedStreamInput = StartStreamInput & { deviceId?: string; audioDeviceId?: string };
  type PublisherStatus = "ready" | "connecting" | "live" | "error";
  type VerifiedProfile = Pick<CaptureSession, "actualWidth" | "actualHeight" | "actualFps">;

  let page: Page = "login";
  let authLandingPage: AuthLandingPage = "dashboard";
  let session: Session | null = null;
  let booting = true;
  let loginBusy = false;
  let passwordBusy = false;
  let createBusy = false;
  let publishBusy = false;
  let refreshing = false;
  let detecting = false;
  let loginError = "";
  let passwordError = "";
  let setupError = "";
  let dashboardError = "";

  let codecs: VideoCapability[] = [];
  let audioCodecs: AudioCapability[] = [];
  let cameraDevices: CameraDevice[] = [];
  let microphoneDevices: MediaDeviceInfo[] = [];
  let microphonePermission: "unknown" | "granted" | "denied" = "unknown";
  let microphoneChecking = false;
  let microphoneError = "";
  let selectedCodec: "h264" | "h265" = "h265";
  let streams: Stream[] = [];
  let recordings: Recording[] = [];
  let recordingsLoading = false;

  let liveStream: Stream | null = null;
  let preparedInput: PreparedStreamInput | null = null;
  let captureSession: CaptureSession | null = null;
  let publisher: Publisher | null = null;
  let statsTimer: number | null = null;
  let liveStats: StreamStats | null = null;
  let publisherStatus: PublisherStatus = "ready";
  let publisherError = "";
  let copied = false;
  let verifiedProfile: VerifiedProfile | null = null;

  onMount(() => {
    void bootstrap();
    return cleanupLive;
  });

  async function bootstrap() {
    if (window.location.pathname === "/player") {
      page = "player";
      booting = false;
      return;
    }
    authLandingPage = window.location.pathname === "/device-check" ? "device-check" : "dashboard";
    try {
      const current = await getSession();
      if (!current.authenticated) {
        page = "login";
        return;
      }
      session = current;
      page = current.mustChangePassword ? "password" : authLandingPage;
      if (!current.mustChangePassword) {
        void Promise.all([refreshDashboard(), loadCapabilities()]).catch((error) => {
          dashboardError = errorMessage(error, "Data awal belum bisa dimuat.");
        });
      }
    } catch (error) {
      loginError = errorMessage(error);
    } finally {
      booting = false;
    }
  }

  async function handleLogin(username: string, password: string) {
    loginBusy = true;
    loginError = "";
    try {
      session = await login(username, password);
      page = session.mustChangePassword ? "password" : authLandingPage;
      if (!session.mustChangePassword) await Promise.all([refreshDashboard(), loadCapabilities()]);
    } catch (error) {
      loginError = errorMessage(error, "Username atau password salah.");
    } finally {
      loginBusy = false;
    }
  }

  async function handlePasswordChange(currentPassword: string, newPassword: string) {
    passwordBusy = true;
    passwordError = "";
    try {
      await changePassword(currentPassword, newPassword);
      if (session) session = { ...session, mustChangePassword: false };
      page = authLandingPage;
      await Promise.all([refreshDashboard(), loadCapabilities()]);
    } catch (error) {
      passwordError = errorMessage(error, "Password belum bisa disimpan.");
    } finally {
      passwordBusy = false;
    }
  }

  async function loadCapabilities() {
    const [video, audio] = await Promise.all([probeVideoCodecs(), probeAudioCodecs()]);
    codecs = video;
    audioCodecs = audio;
    const selectable = video.filter((item) => (item.key === "h264" || item.key === "h265") && item.supported);
    if (!selectable.some((item) => item.key === selectedCodec)) {
      selectedCodec = (selectable.find((item) => item.key === "h265") || selectable[0])?.key as "h264" | "h265" || "h264";
    }
  }

  async function detectDevices() {
    detecting = true;
    setupError = "";
    try {
      await loadCapabilities();
      try {
        cameraDevices = await probeCameraDevices();
      } catch (error) {
        setupError = mediaAccessError(error, "camera").message;
      }
      await checkMicrophoneInput();
    } catch (error) {
      setupError = errorMessage(error, "Perangkat atau encoder belum bisa dideteksi.");
    } finally {
      detecting = false;
    }
  }

  async function checkMicrophoneInput() {
    microphoneChecking = true;
    microphoneError = "";
    try {
      microphoneDevices = await checkMicrophone();
      microphonePermission = "granted";
    } catch (error) {
      microphoneDevices = [];
      microphonePermission = "denied";
      microphoneError = errorMessage(error, "Mikrofon belum bisa dibuka.");
    } finally {
      microphoneChecking = false;
    }
  }

  async function openSetup() {
    setupError = "";
    page = "setup";
    if (codecs.length === 0) {
      try {
        await loadCapabilities();
      } catch (error) {
        setupError = errorMessage(error);
      }
    }
    if (cameraDevices.length === 0 && !detecting) void detectDevices();
  }

  function showDashboard() {
    setupError = "";
    page = "dashboard";
    authLandingPage = "dashboard";
    if (window.location.pathname === "/device-check") window.history.pushState({}, "", "/");
    void refreshDashboard();
  }

  function openDeviceCheck() {
    page = "device-check";
    authLandingPage = "device-check";
    if (window.location.pathname !== "/device-check") window.history.pushState({}, "", "/device-check");
  }

  async function refreshDashboard() {
    refreshing = true;
    dashboardError = "";
    recordingsLoading = true;
    try {
      const [streamResult, recordingResult] = await Promise.all([listStreams(), listRecordings()]);
      streams = streamResult;
      recordings = recordingResult;
    } catch (error) {
      dashboardError = errorMessage(error, "Data dashboard belum bisa dimuat.");
    } finally {
      refreshing = false;
      recordingsLoading = false;
    }
  }

  async function handleCreate(input: PreparedStreamInput) {
    createBusy = true;
    setupError = "";
    try {
      const outputProbe = await probeVideoCodecs();
      const outputCapability = outputProbe.find((item) => item.key === input.codec && item.supported && item.srtCompatible);
      if (!outputCapability) {
        throw new Error(`Codec ${input.codec.toUpperCase()} tidak tersedia untuk WHIP di browser ini. Pilih codec lain.`);
      }
      if (input.audioEnabled && !audioCodecs.some((item) => item.key === input.audioCodec && item.supported)) {
        throw new Error(`Encoder audio ${input.audioCodec.toUpperCase()} tidak tersedia di browser.`);
      }
      const { deviceId: _deviceId, audioDeviceId: _audioDeviceId, ...streamInput } = input;
      liveStream = await createStream(streamInput);
      preparedInput = input;
      captureSession = null;
      verifiedProfile = null;
      publisherStatus = "ready";
      publisherError = "";
      liveStats = null;
      page = "live";
      startStatsPolling();
    } catch (error) {
      setupError = errorMessage(error, "Job stream belum bisa dibuat.");
    } finally {
      createBusy = false;
    }
  }

  async function openValidatedCapture(input: PreparedStreamInput) {
    const finalProbe = await probeVideoCodecs();
    const capability = finalProbe.find((item) => item.key === input.codec && item.supported && item.srtCompatible);
    if (!capability) {
      throw new Error(`Codec ${input.codec.toUpperCase()} tidak tersedia untuk WHIP di browser ini. Pilih codec lain.`);
    }
    if (input.audioEnabled && !audioCodecs.some((item) => item.key === input.audioCodec && item.supported)) {
      throw new Error(`Encoder audio ${input.audioCodec.toUpperCase()} tidak tersedia di browser.`);
    }
    return { capability, capture: await openCapture(input) };
  }

  async function handleOpenStream(summary: Stream) {
    dashboardError = "";
    try {
      if (codecs.length === 0 || audioCodecs.length === 0) await loadCapabilities();
      const stream = await getStream(summary.id);
      if (!stream.whipUrl || !stream.publishToken || !stream.srtUrl) {
        throw new Error("URL job tidak tersedia. Hapus job ini lalu buat job baru.");
      }
      cleanupLive();
      liveStream = stream;
      preparedInput = {
        codec: stream.codec,
        width: stream.width,
        height: stream.height,
        fps: stream.fps,
        maxBitrateKbps: stream.maxBitrateKbps,
        audioCodec: stream.audioCodec || "opus",
        portraitMode: stream.portraitMode,
        audioEnabled: stream.audioEnabled,
        record: stream.record,
      };
      publisherStatus = "ready";
      publisherError = "";
      verifiedProfile = null;
      page = "live";
      startStatsPolling();
    } catch (error) {
      dashboardError = errorMessage(error, "Job stream belum bisa dibuka.");
    }
  }

  async function handlePublishStart() {
    if (!liveStream || !preparedInput || publishBusy || publisher || captureSession) return;
    const stream = liveStream;
    const input = preparedInput;
    publishBusy = true;
    publisherStatus = "connecting";
    publisherError = "";
    let capture: CaptureSession | null = null;
    let startedPublisher: Publisher | null = null;
    try {
      if (!stream.whipUrl || !stream.publishToken) {
        throw new Error("Job stream tidak memiliki URL atau token publish. Buka ulang job dari dashboard.");
      }
      const validated = await openValidatedCapture(input);
      capture = validated.capture;
      if (liveStream?.id !== stream.id) {
        capture.stop();
        return;
      }

      const { deviceId: _deviceId, audioDeviceId: _audioDeviceId, ...streamInput } = input;
      const updatedStream = await updateStream(stream.id, streamInput);
      if (liveStream?.id !== stream.id) {
        capture.stop();
        return;
      }
      liveStream = updatedStream;
      verifiedProfile = { actualWidth: capture.actualWidth, actualHeight: capture.actualHeight, actualFps: capture.actualFps };
      captureSession = capture;
      const selectedAudio = audioCodecs.find((item) => item.key === streamInput.audioCodec && item.supported);
      startedPublisher = await startWhipPublisher({
        whipUrl: updatedStream.whipUrl!,
        publishToken: updatedStream.publishToken!,
        capture,
        codec: validated.capability,
        input: streamInput,
        audioCodec: selectedAudio,
        onConnected: () => {
          if (liveStream?.id !== stream.id) return;
          publisherStatus = "live";
          publisherError = "";
          liveStream = { ...liveStream, status: "live" };
        },
        onError: (message) => {
          if (liveStream?.id !== stream.id) return;
          publisherStatus = "error";
          publisherError = message;
        },
      });
      if (liveStream?.id !== stream.id) {
        startedPublisher.close();
        capture.stop();
        return;
      }
      publisher = startedPublisher;
      startStatsPolling();
    } catch (error) {
      startedPublisher?.close();
      capture?.stop();
      if (liveStream?.id !== stream.id) return;
      publisher = null;
      captureSession = null;
      publisherStatus = "error";
      publisherError = errorMessage(error, "Kamera atau relay belum bisa dimulai. Periksa profile lalu coba lagi.");
    } finally {
      publishBusy = false;
    }
  }

  function setSource(deviceId: string, audioDeviceId: string) {
    if (!preparedInput || !liveStream || publishBusy || publisher || captureSession) return;
    preparedInput = { ...preparedInput, deviceId: deviceId || undefined, audioDeviceId: audioDeviceId || undefined };
    verifiedProfile = null;
    publisherError = "";
  }

  function startStatsPolling() {
    if (statsTimer !== null) window.clearInterval(statsTimer);
    void refreshLiveStats();
    statsTimer = window.setInterval(() => void refreshLiveStats(), 2_000);
  }

  function openResult() {
    page = "result";
  }

  async function refreshLiveStats() {
    if (!liveStream) return;
    try {
      liveStats = await getStreamStats(liveStream.id);
    } catch (error) {
      if (error instanceof APIError && error.status === 401) {
        await handleLogout();
      }
    }
  }

  function stopLocalRelay() {
    if (statsTimer !== null) window.clearInterval(statsTimer);
    statsTimer = null;
    publisher?.close();
    publisher = null;
    if (captureSession) {
      verifiedProfile = { actualWidth: captureSession.actualWidth, actualHeight: captureSession.actualHeight, actualFps: captureSession.actualFps };
      captureSession.stop();
    }
    captureSession = null;
    if (liveStream) liveStream = { ...liveStream, status: "ready" };
    liveStats = null;
    publisherStatus = "ready";
    publisherError = "";
    publishBusy = false;
  }

  async function stopRelay() {
    const id = liveStream?.id;
    stopLocalRelay();
    if (!id) return true;
    try {
      await stopStream(id);
      if (liveStream?.id === id) liveStream = { ...liveStream, status: "stopped" };
      return true;
    } catch (error) {
      publisherStatus = "error";
      publisherError = errorMessage(error, "Relay lokal berhenti, tetapi status server belum berhasil dihentikan.");
      return false;
    }
  }

  async function leaveLive() {
    if (!liveStream) {
      page = "dashboard";
      return;
    }
    if (!(await stopRelay())) return;
    liveStream = null;
    preparedInput = null;
    liveStats = null;
    verifiedProfile = null;
    page = "dashboard";
    await refreshDashboard();
  }

  function cleanupLive() {
    stopLocalRelay();
    liveStream = null;
    preparedInput = null;
    liveStats = null;
    verifiedProfile = null;
  }

  async function handleCopy() {
    if (!liveStream?.srtUrl) return;
    try {
      await navigator.clipboard.writeText(liveStream.srtUrl);
      copied = true;
      window.setTimeout(() => (copied = false), 2_500);
    } catch {
      publisherError = "Clipboard diblokir browser. Salin URL dari kotak secara manual.";
    }
  }

  async function handleDeleteRecording(recording: Recording) {
    if (!window.confirm(`Hapus recording ${recording.name}?`)) return;
    try {
      await deleteRecording(recording.id);
      recordings = recordings.filter((item) => item.id !== recording.id);
    } catch (error) {
      dashboardError = errorMessage(error, "Recording belum bisa dihapus.");
    }
  }

  async function handleDeleteStream(stream: Stream) {
    if (!window.confirm(`Hapus job ${stream.path}? URL OBS dan token akan dicabut permanen. File recording tidak ikut dihapus.`)) return;
    dashboardError = "";
    try {
      await deleteStream(stream.id);
      streams = streams.filter((item) => item.id !== stream.id);
    } catch (error) {
      dashboardError = errorMessage(error, "Job stream belum bisa dihapus.");
    }
  }

  async function handleLogout() {
    if (liveStream) await stopRelay();
    cleanupLive();
    try {
      await logout();
    } finally {
      session = null;
      page = "login";
      codecs = [];
      audioCodecs = [];
      cameraDevices = [];
      microphoneDevices = [];
      microphonePermission = "unknown";
      microphoneError = "";
    }
  }

  function errorMessage(error: unknown, fallback = "Terjadi kesalahan. Coba lagi.") {
    return error instanceof Error && error.message ? error.message : fallback;
  }
</script>

{#if booting}
  <main class="flex min-h-dvh items-center justify-center px-5">
    <div class="flex items-center gap-3 text-sm font-bold text-[var(--muted)]" aria-live="polite"><LoaderCircle size={19} class="animate-spin text-[var(--accent)]" /> Memuat VDO Relay...</div>
  </main>
{:else if page === "player"}
  <PlayerView />
{:else if !session}
  <LoginView busy={loginBusy} error={loginError} onSubmit={handleLogin} />
{:else if page === "password"}
  <PasswordView busy={passwordBusy} error={passwordError} onSubmit={handlePasswordChange} />
{:else if page === "setup"}
  <SetupView codecs={codecs} audioCodecs={audioCodecs} devices={cameraDevices} {microphoneDevices} {microphonePermission} {microphoneChecking} {microphoneError} bind:selectedCodec detecting={detecting} creating={createBusy} error={setupError} onDetect={detectDevices} onCheckMicrophone={checkMicrophoneInput} onCreate={handleCreate} onBack={showDashboard} />
{:else if page === "device-check"}
  <DeviceCheckView session={session} onBack={showDashboard} onPassword={() => (page = "password")} onLogout={handleLogout} />
{:else if page === "result" && liveStream}
  <ResultView stream={liveStream} stats={liveStats} {publisherStatus} onBack={() => (page = "live")} onStop={stopRelay} />
{:else if page === "live" && liveStream}
  <LiveView stream={liveStream} capture={captureSession} {verifiedProfile} {cameraDevices} {microphoneDevices} deviceId={preparedInput?.deviceId || ""} audioDeviceId={preparedInput?.audioDeviceId || ""} stats={liveStats} {publisherStatus} {publisherError} {copied} starting={publishBusy} onStart={handlePublishStart} onSource={setSource} onCopy={handleCopy} onResult={openResult} onStopRelay={stopRelay} onLeaveHome={leaveLive} />
{:else}
  <DashboardView session={session} {streams} {recordings} {recordingsLoading} {refreshing} error={dashboardError} onNewStream={openSetup} onDeviceCheck={openDeviceCheck} onOpenStream={handleOpenStream} onDeleteStream={handleDeleteStream} onRefresh={refreshDashboard} onLogout={handleLogout} onPassword={() => (page = "password")} onDeleteRecording={handleDeleteRecording} />
{/if}
