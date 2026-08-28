<script lang="ts">
  import { onMount } from "svelte";
  import { AlertCircle, LoaderCircle } from "@lucide/svelte";
  import {
    APIError,
    changePassword,
    createStream,
    deleteRecording,
    getSession,
    getStreamStats,
    listRecordings,
    listStreams,
    login,
    logout,
    stopStream,
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
    probeAudioCodecs,
    probeVideoCodecs,
    startAdaptiveBitrate,
    startMoqPublisher,
    type AudioCapability,
    type CaptureSession,
    type Publisher,
    type VideoCapability,
  } from "./lib/media";
  import DashboardView from "./components/DashboardView.svelte";
  import LiveView from "./components/LiveView.svelte";
  import LoginView from "./components/LoginView.svelte";
  import PasswordView from "./components/PasswordView.svelte";
  import ResultView from "./components/ResultView.svelte";
  import SetupView from "./components/SetupView.svelte";

  type Page = "login" | "password" | "dashboard" | "setup" | "live" | "result";

  let page: Page = "login";
  let session: Session | null = null;
  let booting = true;
  let loginBusy = false;
  let passwordBusy = false;
  let startBusy = false;
  let refreshing = false;
  let detecting = false;
  let loginError = "";
  let passwordError = "";
  let setupError = "";
  let dashboardError = "";

  let codecs: VideoCapability[] = [];
  let audioCodecs: AudioCapability[] = [];
  let cameraDevices: MediaDeviceInfo[] = [];
  let microphoneDevices: MediaDeviceInfo[] = [];
  let microphonePermission: "unknown" | "granted" | "denied" = "unknown";
  let microphoneChecking = false;
  let microphoneError = "";
  let selectedCodec: "h264" | "h265" = "h265";
  let streams: Stream[] = [];
  let recordings: Recording[] = [];
  let recordingsLoading = false;

  let liveStream: Stream | null = null;
  let captureSession: CaptureSession | null = null;
  let publisher: Publisher | null = null;
  let stopAdaptive: (() => void) | null = null;
  let statsTimer: number | null = null;
  let liveStats: StreamStats | null = null;
  let publisherStatus: "connecting" | "live" | "error" = "connecting";
  let publisherError = "";
  let targetBitrateKbps = 0;
  let copied = false;

  onMount(() => {
    void bootstrap();
    return () => cleanupLive(true);
  });

  async function bootstrap() {
    try {
      const current = await getSession();
      if (!current.authenticated) {
        page = "login";
        return;
      }
      session = current;
      page = current.mustChangePassword ? "password" : "dashboard";
      if (!current.mustChangePassword) {
        await Promise.all([refreshDashboard(), loadCapabilities()]);
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
      page = session.mustChangePassword ? "password" : "dashboard";
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
      page = "dashboard";
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
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API tidak tersedia. Pastikan halaman dibuka melalui HTTPS.");
      try {
        const temporary = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        temporary.getTracks().forEach((track) => track.stop());
        cameraDevices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
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
  }

  function showDashboard() {
    setupError = "";
    page = "dashboard";
    void refreshDashboard();
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

  async function handleStart(input: StartStreamInput & { deviceId?: string; audioDeviceId?: string }) {
    startBusy = true;
    setupError = "";
    let capture: CaptureSession | null = null;
    let created: Stream | null = null;
    try {
      const capability = codecs.find((item) => item.key === input.codec && item.supported && item.srtCompatible);
      if (!capability) throw new Error(`${input.codec.toUpperCase()} tidak lolos capability check browser.`);
      const finalProbe = await probeVideoCodecs(input.width, input.height, input.fps);
      const finalCapability = finalProbe.find((item) => item.key === input.codec && item.supported);
      if (!finalCapability) throw new Error(`Encoder ${input.codec.toUpperCase()} tidak mendukung ${input.width}×${input.height} pada ${input.fps} FPS.`);

      capture = await openCapture({ ...input });
      const { deviceId: _deviceId, audioDeviceId: _audioDeviceId, ...streamInput } = input;
      created = await createStream(streamInput);
      const selectedAudio = audioCodecs.find((item) => item.supported && item.codec === "mp4a.40.2") || audioCodecs.find((item) => item.supported);

      liveStream = created;
      captureSession = capture;
      targetBitrateKbps = input.maxBitrateKbps;
      publisherStatus = "connecting";
      publisherError = "";
      liveStats = null;
      page = "live";
      publisher = await startMoqPublisher({
        publishUrl: created.publishUrl || "",
        fingerprintUrl: created.fingerprintUrl || `${created.publishUrl}/fingerprint`,
        publishToken: created.publishToken || "",
        capture,
        codec: finalCapability,
        input: streamInput,
        audioCodec: selectedAudio,
        onConnected: () => {
          publisherStatus = "live";
          publisherError = "";
        },
        onError: (message) => {
          publisherStatus = "error";
          publisherError = message;
        },
      });
      stopAdaptive = startAdaptiveBitrate(publisher, input.maxBitrateKbps, {
        onTarget: (target) => (targetBitrateKbps = target),
        onFailure: () => {
          publisherStatus = "error";
          publisherError = "Transport tetap tertekan pada technical floor. Stop lalu cek jaringan atau profile.";
        },
      });
      startStatsPolling();
    } catch (error) {
      publisher?.close();
      publisher = null;
      capture?.stop();
      if (created) {
        try {
          await stopStream(created.id);
        } catch {
          // The dashboard can still revoke/clean this path on the next attempt.
        }
      }
      liveStream = null;
      captureSession = null;
      page = "setup";
      setupError = errorMessage(error, "Stream belum bisa dimulai.");
    } finally {
      startBusy = false;
    }
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

  async function stopLive() {
    const id = liveStream?.id;
    cleanupLive(true);
    page = "dashboard";
    if (id) {
      try {
        await stopStream(id);
      } catch (error) {
        dashboardError = errorMessage(error, "Stream lokal sudah dihentikan, tetapi path server belum terkonfirmasi.");
      }
    }
    await refreshDashboard();
  }

  function cleanupLive(closePublisher: boolean) {
    if (statsTimer !== null) window.clearInterval(statsTimer);
    statsTimer = null;
    stopAdaptive?.();
    stopAdaptive = null;
    if (closePublisher) publisher?.close();
    publisher = null;
    captureSession?.stop();
    captureSession = null;
    liveStream = null;
    liveStats = null;
    publisherStatus = "connecting";
    publisherError = "";
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

  async function handleLogout() {
    cleanupLive(true);
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
{:else if !session}
  <LoginView busy={loginBusy} error={loginError} onSubmit={handleLogin} />
{:else if page === "password"}
  <PasswordView busy={passwordBusy} error={passwordError} onSubmit={handlePasswordChange} />
{:else if page === "setup"}
  <SetupView codecs={codecs} audioCodecs={audioCodecs} devices={cameraDevices} {microphoneDevices} {microphonePermission} {microphoneChecking} {microphoneError} bind:selectedCodec detecting={detecting} starting={startBusy} error={setupError} onDetect={detectDevices} onCheckMicrophone={checkMicrophoneInput} onStart={handleStart} onBack={showDashboard} />
{:else if page === "result" && liveStream}
  <ResultView stream={liveStream} stats={liveStats} {publisherStatus} {targetBitrateKbps} onBack={() => (page = "live")} onStop={stopLive} />
{:else if page === "live" && liveStream && captureSession}
  <LiveView stream={liveStream} capture={captureSession} stats={liveStats} {publisherStatus} {publisherError} {targetBitrateKbps} {copied} onCopy={handleCopy} onResult={openResult} onStop={stopLive} />
{:else}
  <DashboardView session={session} {streams} {recordings} {recordingsLoading} {refreshing} error={dashboardError} onNewStream={openSetup} onRefresh={refreshDashboard} onLogout={handleLogout} onPassword={() => (page = "password")} onDeleteRecording={handleDeleteRecording} />
{/if}
