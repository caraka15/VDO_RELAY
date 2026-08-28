<script lang="ts">
  import { onMount } from "svelte";
  import { AlertCircle, LoaderCircle } from "@lucide/svelte";
  import {
    APIError,
    changePassword,
    createStream,
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
    startAdaptiveBitrate,
    startMoqPublisher,
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
  import ResultView from "./components/ResultView.svelte";
  import SetupView from "./components/SetupView.svelte";

  type Page = "login" | "password" | "dashboard" | "setup" | "live" | "result";
  type PreparedStreamInput = StartStreamInput & { deviceId?: string; audioDeviceId?: string };
  type PublisherStatus = "ready" | "connecting" | "live" | "error";
  type VerifiedProfile = Pick<CaptureSession, "actualWidth" | "actualHeight" | "actualFps">;

  let page: Page = "login";
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
  let stopAdaptive: (() => void) | null = null;
  let statsTimer: number | null = null;
  let liveStats: StreamStats | null = null;
  let publisherStatus: PublisherStatus = "ready";
  let publisherError = "";
  let targetBitrateKbps = 0;
  let copied = false;
  let verifiedProfile: VerifiedProfile | null = null;

  onMount(() => {
    void bootstrap();
    return cleanupLive;
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

  async function handleCreate(input: PreparedStreamInput) {
    createBusy = true;
    setupError = "";
    try {
      const outputProbe = await probeVideoCodecs(input.width, input.height, input.fps);
      const outputCapability = outputProbe.find((item) => item.key === input.codec && item.supported && item.srtCompatible);
      if (!outputCapability) {
        throw new Error(`Encoder ${input.codec.toUpperCase()} tidak mendukung output ${input.width} x ${input.height} pada ${input.fps} FPS. Pilih profile atau codec lain.`);
      }
      if (input.audioEnabled && !audioCodecs.some((item) => item.key === input.audioCodec && item.supported)) {
        throw new Error(`Encoder audio ${input.audioCodec.toUpperCase()} tidak tersedia di browser.`);
      }
      const { deviceId: _deviceId, audioDeviceId: _audioDeviceId, ...streamInput } = input;
      liveStream = await createStream(streamInput);
      preparedInput = input;
      captureSession = null;
      verifiedProfile = null;
      targetBitrateKbps = input.maxBitrateKbps;
      publisherStatus = "ready";
      publisherError = "";
      liveStats = null;
      page = "live";
      await handlePublishStart();
    } catch (error) {
      setupError = errorMessage(error, "Job stream belum bisa dibuat.");
    } finally {
      createBusy = false;
    }
  }

  async function openValidatedCapture(input: PreparedStreamInput) {
    const finalProbe = await probeVideoCodecs(input.width, input.height, input.fps);
    const capability = finalProbe.find((item) => item.key === input.codec && item.supported && item.srtCompatible);
    if (!capability) {
      throw new Error(`Encoder ${input.codec.toUpperCase()} tidak mendukung ${input.width}×${input.height} pada ${input.fps} FPS. Pilih profile lebih rendah.`);
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
      if (!stream.publishUrl || !stream.publishToken || !stream.srtUrl) {
        throw new Error("Job ini sudah ditutup dan tidak dapat digunakan lagi.");
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
      targetBitrateKbps = stream.maxBitrateKbps;
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
      if (!stream.publishUrl || !stream.publishToken) {
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
      startedPublisher = await startMoqPublisher({
        publishUrl: updatedStream.publishUrl!,
        fingerprintUrl: updatedStream.fingerprintUrl || `${updatedStream.publishUrl}/fingerprint`,
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
      stopAdaptive = startAdaptiveBitrate(publisher, input.maxBitrateKbps, {
        onTarget: (target) => (targetBitrateKbps = target),
        onFailure: () => {
          publisherStatus = "error";
          publisherError = "Transport tetap tertekan pada technical floor. Stop lalu cek jaringan atau profile.";
        },
      });
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

  function setPortraitMode(portraitMode: boolean) {
    if (!preparedInput || !liveStream || publishBusy) return;
    preparedInput = { ...preparedInput, portraitMode };
    liveStream = { ...liveStream, portraitMode };
    captureSession?.setPortraitMode(portraitMode);
    if (!captureSession) {
      verifiedProfile = null;
      publisherStatus = "ready";
      publisherError = "";
    }
  }

  function setProfile(width: number, height: number, fps: number) {
    if (!preparedInput || !liveStream || publishBusy || publisher || captureSession) return;
    preparedInput = { ...preparedInput, width, height, fps };
    liveStream = { ...liveStream, width, height, fps };
    verifiedProfile = null;
    publisherStatus = "ready";
    publisherError = "";
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

  function stopRelay() {
    if (statsTimer !== null) window.clearInterval(statsTimer);
    statsTimer = null;
    stopAdaptive?.();
    stopAdaptive = null;
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
    targetBitrateKbps = preparedInput?.maxBitrateKbps || 0;
    publishBusy = false;
  }

  async function closeJob() {
    if (!liveStream || !window.confirm("Tutup job ini? URL OBS dan token akan dicabut permanen.")) return;
    const id = liveStream?.id;
    cleanupLive();
    page = "dashboard";
    if (id) {
      try {
        await stopStream(id);
      } catch (error) {
        dashboardError = errorMessage(error, "Relay lokal berhenti, tetapi job server belum berhasil ditutup.");
      }
    }
    await refreshDashboard();
  }

  function cleanupLive() {
    stopRelay();
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

  async function handleLogout() {
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
{:else if !session}
  <LoginView busy={loginBusy} error={loginError} onSubmit={handleLogin} />
{:else if page === "password"}
  <PasswordView busy={passwordBusy} error={passwordError} onSubmit={handlePasswordChange} />
{:else if page === "setup"}
  <SetupView codecs={codecs} audioCodecs={audioCodecs} devices={cameraDevices} {microphoneDevices} {microphonePermission} {microphoneChecking} {microphoneError} bind:selectedCodec detecting={detecting} creating={createBusy} error={setupError} onDetect={detectDevices} onCheckMicrophone={checkMicrophoneInput} onCreate={handleCreate} onBack={showDashboard} />
{:else if page === "result" && liveStream}
  <ResultView stream={liveStream} stats={liveStats} {publisherStatus} {targetBitrateKbps} onBack={() => (page = "live")} onStop={stopRelay} />
{:else if page === "live" && liveStream}
  <LiveView stream={liveStream} capture={captureSession} {verifiedProfile} {cameraDevices} {microphoneDevices} deviceId={preparedInput?.deviceId || ""} audioDeviceId={preparedInput?.audioDeviceId || ""} stats={liveStats} {publisherStatus} {publisherError} {targetBitrateKbps} {copied} starting={publishBusy} onStart={handlePublishStart} onProfile={setProfile} onPortraitMode={setPortraitMode} onSource={setSource} onCopy={handleCopy} onResult={openResult} onStopRelay={stopRelay} onCloseJob={closeJob} />
{:else}
  <DashboardView session={session} {streams} {recordings} {recordingsLoading} {refreshing} error={dashboardError} onNewStream={openSetup} onOpenStream={handleOpenStream} onRefresh={refreshDashboard} onLogout={handleLogout} onPassword={() => (page = "password")} onDeleteRecording={handleDeleteRecording} />
{/if}
