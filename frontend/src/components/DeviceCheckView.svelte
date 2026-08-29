<script lang="ts">
  import { Activity, AlertCircle, ArrowLeft, Camera, LoaderCircle, Mic, RefreshCw, Server, ShieldCheck, X, Zap } from "@lucide/svelte";
  import type { Session } from "../lib/api";
  import {
    runDeviceCheck,
    type AudioCapabilitySnapshot,
    type AudioTrackSnapshot,
    type CameraCapabilitySnapshot,
    type CameraDiagnostic,
    type CameraRatioCheck,
    type CameraResolutionCheck,
    type DeviceCheckReport,
    type NumericRange,
    type TrackSnapshot,
    type VideoCodecDiagnostic,
  } from "../lib/media";

  export let session: Session;
  export let onBack: () => void;
  export let onPassword: () => void;
  export let onLogout: () => void;

  let report: DeviceCheckReport | null = null;
  let checking = false;
  let error = "";
  let progress = "";

  async function check() {
    checking = true;
    error = "";
    progress = "Menyiapkan pemeriksaan...";
    try {
      report = await runDeviceCheck((message) => (progress = message));
    } catch (checkError) {
      error = checkError instanceof Error ? checkError.message : "Pemeriksaan perangkat gagal.";
    } finally {
      checking = false;
      progress = "";
    }
  }

  function badgeClass(ok: boolean | null): string {
    if (ok === true) return "border-[#3c7154] bg-[#1b3026] text-[var(--success)]";
    if (ok === false) return "border-[#844a52] bg-[#321c22] text-[var(--danger)]";
    return "border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--muted)]";
  }

  function resultClass(status: string): string {
    if (status === "matched" || status === "exact" || status === "higher") return badgeClass(true);
    if (status === "failed") return badgeClass(false);
    return "border-[#705c31] bg-[#332d1d] text-[var(--warning)]";
  }

  function resultLabel(status: string): string {
    if (status === "matched") return "Rasio cocok";
    if (status === "exact") return "Ukuran cocok";
    if (status === "higher") return "Lebih tinggi";
    if (status === "failed") return "Gagal dibuka";
    return "Fallback";
  }

  function permissionLabel(value: string): string {
    if (value === "granted") return "Diizinkan";
    if (value === "denied") return "Ditolak";
    if (value === "prompt") return "Belum diminta";
    return value || "Tidak diketahui";
  }

  function formatNumber(value: number | null | undefined): string {
    return value === null || value === undefined || value <= 0 ? "-" : String(Math.round(value * 100) / 100);
  }

  function formatRange(range: NumericRange | null): string {
    if (!range) return "Tidak dilaporkan";
    const min = range.min === null ? "-" : formatNumber(range.min);
    const max = range.max === null ? "-" : formatNumber(range.max);
    const step = range.step === null ? "" : `, step ${formatNumber(range.step)}`;
    return `${min} - ${max}${step}`;
  }

  function formatRatio(value: number): string {
    return value > 0 ? value.toFixed(4) : "-";
  }

  function trackSize(track: TrackSnapshot | null): string {
    return track && track.width > 0 && track.height > 0 ? `${track.width} x ${track.height}` : "-";
  }

  function trackFps(track: TrackSnapshot | null): string {
    return track && track.frameRate > 0 ? `${formatNumber(track.frameRate)} FPS` : "-";
  }

  function joinValues(values: string[] | undefined): string {
    return values && values.length > 0 ? values.join(", ") : "Tidak dilaporkan";
  }

  function shortId(value: string): string {
    if (!value) return "-";
    return value.length > 20 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
  }

  function codecStatus(codec: VideoCodecDiagnostic): string {
    if (codec.hardware) return "Hardware terbukti";
    if (codec.encoderAdvertised) return "Encoder terdeteksi, hardware belum terbukti";
    if (codec.decoderAdvertised) return "Hanya decoder terdeteksi";
    return "Tidak diekspos browser";
  }

  function audioValue(value: boolean | null): string {
    return value === true ? "Ya" : value === false ? "Tidak" : "Tidak dilaporkan";
  }

  function cameraFacts(camera: CameraDiagnostic): { label: string; value: string }[] {
    const capabilities = camera.capabilities;
    return [
      { label: "Track awal", value: trackSize(camera.initial) },
      { label: "FPS awal", value: trackFps(camera.initial) },
      { label: "Rasio awal", value: formatRatio(camera.initial?.aspectRatio || 0) },
      { label: "Mode resize", value: joinValues(capabilities?.resizeMode) },
      { label: "Facing mode", value: joinValues(capabilities?.facingMode) },
      { label: "Zoom", value: formatRange(capabilities?.zoom || null) },
      { label: "Torch / flash", value: capabilities?.torch === true ? "Tersedia" : capabilities?.torch === false ? "Tidak tersedia" : "Tidak dilaporkan" },
    ];
  }

  function cameraRanges(capabilities: CameraCapabilitySnapshot): { label: string; value: string }[] {
    return [
      { label: "Width range", value: formatRange(capabilities.width) },
      { label: "Height range", value: formatRange(capabilities.height) },
      { label: "Aspect ratio range", value: formatRange(capabilities.aspectRatio) },
      { label: "Frame rate range", value: formatRange(capabilities.frameRate) },
    ];
  }

  function audioFacts(active: AudioTrackSnapshot): { label: string; value: string }[] {
    return [
      { label: "Sample rate", value: active.sampleRate > 0 ? `${active.sampleRate} Hz` : "-" },
      { label: "Sample size", value: active.sampleSize > 0 ? `${active.sampleSize} bit` : "-" },
      { label: "Channel count", value: active.channelCount > 0 ? String(active.channelCount) : "-" },
      { label: "Latency", value: active.latency > 0 ? `${active.latency} s` : "-" },
      { label: "Echo cancellation", value: audioValue(active.echoCancellation) },
      { label: "Noise suppression", value: audioValue(active.noiseSuppression) },
      { label: "Auto gain control", value: audioValue(active.autoGainControl) },
    ];
  }

  function audioCapabilityFacts(capabilities: AudioCapabilitySnapshot): { label: string; value: string }[] {
    return [
      { label: "Sample rate range", value: formatRange(capabilities.sampleRate) },
      { label: "Sample size range", value: formatRange(capabilities.sampleSize) },
      { label: "Channel range", value: formatRange(capabilities.channelCount) },
      { label: "Latency range", value: formatRange(capabilities.latency) },
      { label: "Echo cancellation", value: joinValues(capabilities.echoCancellation) },
      { label: "Noise suppression", value: joinValues(capabilities.noiseSuppression) },
      { label: "Auto gain control", value: joinValues(capabilities.autoGainControl) },
    ];
  }
</script>

<svelte:head>
  <title>Device Check - VDO Relay</title>
</svelte:head>

<div class="min-h-dvh">
  <header class="border-b border-[var(--border)] bg-[var(--surface)]">
    <div class="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
      <div class="flex min-w-0 items-center gap-3">
        <div class="flex size-10 items-center justify-center border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--accent)]" aria-hidden="true"><Server size={20} /></div>
        <div class="min-w-0"><p class="mono truncate text-xs font-extrabold uppercase tracking-[0.18em] text-[var(--accent)]">VDO / DEVICE CHECK</p><p class="truncate text-xs font-semibold text-[var(--muted)]">Browser capability report</p></div>
      </div>
      <div class="flex items-center gap-2">
        <span class="hidden text-sm font-bold text-[var(--muted)] sm:inline">{session.username}</span>
        <button class="button-quiet inline-flex items-center gap-2" type="button" on:click={onPassword} aria-label="Ganti password"><ShieldCheck size={17} /><span class="sr-only sm:not-sr-only">Password</span></button>
        <button class="button-quiet inline-flex items-center gap-2" type="button" on:click={onLogout}><X size={17} /><span class="sr-only sm:not-sr-only">Keluar</span></button>
      </div>
    </div>
  </header>

  <main class="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-8">
    <section class="mb-7 flex flex-col justify-between gap-5 border-b border-[var(--border)] pb-7 sm:flex-row sm:items-end">
      <div>
        <p class="mono mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">DIAGNOSTICS / LOCAL DEVICE</p>
        <h1 class="text-3xl font-extrabold tracking-tight sm:text-4xl">Device Check</h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">Lihat kemampuan kamera dan browser yang benar-benar terbaca. Range adalah kemampuan yang dilaporkan browser; hasil probe adalah track aktual setelah diminta.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="button-secondary inline-flex items-center gap-2" type="button" on:click={onBack}><ArrowLeft size={17} /> Dashboard</button>
        <button class="button-primary inline-flex items-center gap-2" type="button" on:click={check} disabled={checking}><RefreshCw size={17} class={checking ? "animate-spin" : ""} /> {checking ? "Memeriksa..." : "Periksa perangkat"}</button>
      </div>
    </section>

    {#if error}
      <div class="mb-5 flex gap-3 border border-[#844a52] bg-[#321c22] p-4 text-sm font-semibold text-[var(--danger)]" role="alert"><AlertCircle size={19} class="mt-0.5 shrink-0" /><span>{error}</span></div>
    {/if}

    {#if checking}
      <div class="mb-5 flex items-center gap-3 border border-[var(--border-strong)] bg-[var(--surface)] p-4 text-sm font-bold text-[var(--accent)]" aria-live="polite"><LoaderCircle size={19} class="animate-spin" /> {progress}</div>
    {/if}

    {#if !report && !checking}
      <section class="panel mb-5 p-6" aria-labelledby="start-check-heading">
        <div class="flex items-start gap-4"><Activity size={23} class="mt-1 shrink-0 text-[var(--accent)]" /><div><h2 id="start-check-heading" class="text-xl font-extrabold">Belum ada hasil pemeriksaan</h2><p class="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">Tekan Periksa perangkat untuk meminta izin kamera dan mikrofon, membaca capability range, mencoba rasio 16:9 / 9:16 / 4:3, mencoba beberapa ukuran umum, dan mengecek encoder WebRTC.</p></div></div>
      </section>
    {/if}

    {#if report}
      <section class="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Ringkasan pemeriksaan">
        <div class="panel p-5"><div class="mb-3 flex items-center justify-between"><span class="text-xs font-bold uppercase tracking-[0.12em] text-[var(--faint)]">Secure context</span><ShieldCheck size={18} class="text-[var(--accent)]" /></div><p class="text-xl font-extrabold">{report.browser.secureContext ? "OK" : "Tidak aman"}</p><p class="mt-1 text-xs font-semibold text-[var(--muted)]">HTTPS atau localhost</p></div>
        <div class="panel p-5"><div class="mb-3 flex items-center justify-between"><span class="text-xs font-bold uppercase tracking-[0.12em] text-[var(--faint)]">Camera</span><Camera size={18} class="text-[var(--accent)]" /></div><p class="mono text-xl font-extrabold">{report.cameras.length}</p><p class="mt-1 text-xs font-semibold text-[var(--muted)]">Input terdaftar</p></div>
        <div class="panel p-5"><div class="mb-3 flex items-center justify-between"><span class="text-xs font-bold uppercase tracking-[0.12em] text-[var(--faint)]">Microphone</span><Mic size={18} class="text-[var(--success)]" /></div><p class="mono text-xl font-extrabold">{report.audio.devices.length}</p><p class="mt-1 text-xs font-semibold text-[var(--muted)]">{permissionLabel(report.audio.permission)}</p></div>
        <div class="panel p-5"><div class="mb-3 flex items-center justify-between"><span class="text-xs font-bold uppercase tracking-[0.12em] text-[var(--faint)]">Checked</span><Zap size={18} class="text-[var(--warning)]" /></div><p class="mono text-sm font-extrabold">{new Date(report.checkedAt).toLocaleString("id-ID")}</p><p class="mt-1 text-xs font-semibold text-[var(--muted)]">{report.codecs.filter((codec) => codec.hardware).length} hardware codec</p></div>
      </section>

      <section class="panel mb-5 p-5 sm:p-6" aria-labelledby="browser-heading">
        <div class="mb-5 flex items-center gap-2 text-[var(--accent)]"><Activity size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">BROWSER / API</span></div>
        <h2 id="browser-heading" class="text-xl font-extrabold">API dan permission</h2>
        <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div class="border border-[var(--border)] bg-[var(--surface-raised)] p-4"><p class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Camera permission</p><p class="mt-2 inline-flex border px-2 py-1 text-sm font-bold {badgeClass(report.browser.permissions.camera === "granted")}">{permissionLabel(report.browser.permissions.camera)}</p></div>
          <div class="border border-[var(--border)] bg-[var(--surface-raised)] p-4"><p class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Microphone permission</p><p class="mt-2 inline-flex border px-2 py-1 text-sm font-bold {badgeClass(report.browser.permissions.microphone === "granted")}">{permissionLabel(report.browser.permissions.microphone)}</p></div>
          <div class="border border-[var(--border)] bg-[var(--surface-raised)] p-4"><p class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Browser</p><p class="mono mt-2 break-words text-xs font-semibold text-[var(--muted)]">{report.browser.userAgent}</p></div>
        </div>
        <div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {#each Object.entries(report.browser.api) as item}
            <div class="flex min-w-0 items-center justify-between gap-3 border border-[var(--border)] px-3 py-2 text-sm"><span class="mono break-words text-xs font-bold">{item[0]}</span><span class="shrink-0 border px-2 py-0.5 text-xs font-extrabold {badgeClass(item[1])}">{item[1] ? "OK" : "No"}</span></div>
          {/each}
        </div>
        <details class="mt-4 border border-[var(--border)] bg-[var(--surface-raised)] p-4"><summary class="cursor-pointer text-sm font-bold">Supported constraints yang dilaporkan</summary><div class="mt-3 flex flex-wrap gap-2">{#each Object.entries(report.browser.supportedConstraints) as item}<span class="mono border px-2 py-1 text-xs font-bold {badgeClass(item[1])}">{item[0]}: {item[1] ? "yes" : "no"}</span>{/each}</div></details>
      </section>

      <section class="mb-5" aria-labelledby="codec-heading">
        <div class="mb-4 flex items-end justify-between gap-3"><div><p class="mono mb-1 text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">VIDEO / ENCODER MATRIX</p><h2 id="codec-heading" class="text-xl font-extrabold">Codec WebRTC</h2></div><span class="text-xs font-semibold text-[var(--muted)]">Hardware hanya jika powerEfficient: true</span></div>
        <div class="grid gap-3 lg:grid-cols-2">
          {#each report.codecs as codec}
            <details class="panel min-w-0 p-5" open={codec.hardware || codec.key === "h265"}>
              <summary class="cursor-pointer list-none">
                <div class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="mono text-base font-extrabold">{codec.label}</p><p class="mt-1 text-xs font-semibold text-[var(--muted)]">{codecStatus(codec)}</p></div><span class="shrink-0 border px-2 py-1 text-xs font-extrabold {badgeClass(codec.hardware)}">{codec.hardware ? "HARDWARE" : "CEK DETAIL"}</span></div>
              </summary>
              <div class="mt-4 border-t border-[var(--border)] pt-4">
                <div class="grid gap-2 sm:grid-cols-2">
                  <div><p class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Encoder WebRTC</p><p class="mt-1 text-sm font-bold">{codec.encoderAdvertised ? "Terdaftar" : "Tidak terdaftar"}</p></div>
                  <div><p class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Decoder WebRTC</p><p class="mt-1 text-sm font-bold">{codec.decoderAdvertised ? "Terdaftar" : "Tidak terdaftar"}</p></div>
                  <div><p class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">MediaCapabilities</p><p class="mt-1 text-sm font-bold">{codec.mediaCapabilitiesAvailable ? "Tersedia" : "Tidak tersedia"}</p></div>
                  <div><p class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Output SRT</p><p class="mt-1 text-sm font-bold">{codec.srtCompatible ? "Kompatibel" : "Belum dipakai"}</p></div>
                </div>
                {#if codec.reason}<p class="mt-3 border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs font-semibold leading-5 text-[var(--muted)]">{codec.reason}</p>{/if}
                <div class="mt-4"><p class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Sender codec entries</p><div class="mt-2 grid gap-1">{#each codec.senderCodecs as entry}<p class="mono break-words text-xs text-[var(--muted)]">{entry}</p>{:else}<p class="text-xs text-[var(--muted)]">Tidak ada</p>{/each}</div></div>
                <div class="mt-4"><p class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Receiver codec entries</p><div class="mt-2 grid gap-1">{#each codec.receiverCodecs as entry}<p class="mono break-words text-xs text-[var(--muted)]">{entry}</p>{:else}<p class="text-xs text-[var(--muted)]">Tidak ada</p>{/each}</div></div>
                <div class="mt-4"><p class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">EncodingInfo probe</p><div class="mt-2 grid gap-2 sm:grid-cols-2">{#each codec.checks as probe}<div class="border border-[var(--border)] p-3"><div class="flex items-center justify-between gap-2"><span class="mono text-xs font-bold">{probe.width} x {probe.height}</span><span class="border px-2 py-0.5 text-[0.6875rem] font-extrabold {badgeClass(probe.supported && probe.powerEfficient === true)}">{probe.supported ? (probe.powerEfficient === true ? "hardware" : "software/unknown") : "no"}</span></div><p class="mt-2 text-xs font-semibold text-[var(--muted)]">powerEfficient: {probe.powerEfficient === null ? "unknown" : probe.powerEfficient ? "true" : "false"}</p><p class="mono mt-1 break-words text-[0.6875rem] text-[var(--faint)]">{probe.contentType || "no accepted content type"}</p></div>{:else}<p class="text-xs text-[var(--muted)]">Probe tidak dijalankan.</p>{/each}</div></div>
              </div>
            </details>
          {/each}
        </div>
      </section>

      <section class="mb-5" aria-labelledby="camera-heading">
        <div class="mb-4 flex items-end justify-between gap-3"><div><p class="mono mb-1 text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">CAMERA / TRACK CAPABILITIES</p><h2 id="camera-heading" class="text-xl font-extrabold">Kamera dan crop-and-scale</h2></div><span class="text-xs font-semibold text-[var(--muted)]">Tanpa canvas</span></div>
        <div class="grid gap-4">
          {#each report.cameras as camera, index}
            <article class="panel min-w-0 p-5 sm:p-6">
              <header class="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-4"><div class="flex min-w-0 items-start gap-3"><Camera size={22} class="mt-0.5 shrink-0 text-[var(--accent)]" /><div class="min-w-0"><h3 class="break-words text-lg font-extrabold">{camera.label || `Kamera ${index + 1}`}</h3><p class="mono mt-1 break-all text-xs text-[var(--faint)]">deviceId: {shortId(camera.deviceId)}</p></div></div><span class="border px-2 py-1 text-xs font-extrabold {badgeClass(!camera.error)}">{camera.error ? "ERROR" : "TRACK OK"}</span></header>
              {#if camera.error}
                <div class="mt-4 flex gap-3 border border-[#844a52] bg-[#321c22] p-4 text-sm font-semibold text-[var(--danger)]"><AlertCircle size={18} class="mt-0.5 shrink-0" /><span>{camera.error}</span></div>
              {:else}
                <div class="mt-4 grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                  <div>
                    <h4 class="text-sm font-extrabold">Range capability</h4>
                    <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">{#each cameraRanges(camera.capabilities!) as fact}<div class="border border-[var(--border)] bg-[var(--surface-raised)] p-3"><p class="text-xs font-bold uppercase tracking-[0.08em] text-[var(--faint)]">{fact.label}</p><p class="mono mt-1 break-words text-sm font-bold">{fact.value}</p></div>{/each}</div>
                    <div class="mt-3 flex flex-wrap gap-2 text-xs font-semibold"><span class="border border-[var(--border)] px-2 py-1">resizeMode: {joinValues(camera.capabilities?.resizeMode)}</span><span class="border border-[var(--border)] px-2 py-1">focus: {joinValues(camera.capabilities?.focusMode)}</span><span class="border border-[var(--border)] px-2 py-1">exposure: {joinValues(camera.capabilities?.exposureMode)}</span><span class="border border-[var(--border)] px-2 py-1">white balance: {joinValues(camera.capabilities?.whiteBalanceMode)}</span></div>
                  </div>
                  <div>
                    <h4 class="text-sm font-extrabold">Track awal saat kamera dibuka</h4>
                    <div class="mt-3 grid gap-2 sm:grid-cols-2">{#each cameraFacts(camera) as fact}<div class="border border-[var(--border)] bg-[var(--surface-raised)] p-3"><p class="text-xs font-bold uppercase tracking-[0.08em] text-[var(--faint)]">{fact.label}</p><p class="mono mt-1 break-words text-sm font-bold">{fact.value}</p></div>{/each}</div>
                    <p class="mt-3 text-xs leading-5 text-[var(--muted)]">Range tidak berarti semua kombinasi tersedia. Ukuran dan rasio di bawah diuji dengan constraint <span class="mono">ideal</span>; status menunjukkan hasil track yang benar-benar dikembalikan browser.</p>
                  </div>
                </div>

                <div class="mt-6 border-t border-[var(--border)] pt-5">
                  <h4 class="text-sm font-extrabold">Uji rasio tanpa menentukan resolusi</h4>
                  <div class="mt-3 grid gap-2 sm:grid-cols-3">{#each camera.ratioChecks as probe: CameraRatioCheck}<div class="border border-[var(--border)] p-3"><div class="flex items-start justify-between gap-2"><p class="font-bold">{probe.label}</p><span class="shrink-0 border px-2 py-0.5 text-[0.6875rem] font-extrabold {resultClass(probe.status)}">{resultLabel(probe.status)}</span></div><p class="mono mt-2 text-xs font-bold">{trackSize(probe.actual)} / {trackFps(probe.actual)}</p><p class="mt-1 text-xs text-[var(--muted)]">actual ratio: {formatRatio(probe.actual?.aspectRatio || 0)}</p>{#if probe.error}<p class="mt-2 break-words text-xs text-[var(--danger)]">{probe.error}</p>{/if}</div>{:else}<p class="text-sm text-[var(--muted)]">Uji rasio belum tersedia.</p>{/each}</div>
                </div>

                <div class="mt-6 border-t border-[var(--border)] pt-5">
                  <h4 class="text-sm font-extrabold">Uji ukuran umum dengan crop-and-scale ideal</h4>
                  <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{#each camera.resolutionChecks as probe: CameraResolutionCheck}<div class="border border-[var(--border)] p-3"><div class="flex items-start justify-between gap-2"><p class="font-bold">{probe.label}</p><span class="shrink-0 border px-2 py-0.5 text-[0.6875rem] font-extrabold {resultClass(probe.status)}">{resultLabel(probe.status)}</span></div><p class="mt-1 text-xs text-[var(--muted)]">minta {probe.targetWidth} x {probe.targetHeight}</p><p class="mono mt-2 text-xs font-bold">dapat {trackSize(probe.actual)} / {trackFps(probe.actual)}</p><p class="mt-1 text-xs text-[var(--muted)]">actual ratio: {formatRatio(probe.actual?.aspectRatio || 0)}</p>{#if probe.error}<p class="mt-2 break-words text-xs text-[var(--danger)]">{probe.error}</p>{/if}</div>{:else}<p class="text-sm text-[var(--muted)]">Uji ukuran belum tersedia.</p>{/each}</div>
                  <p class="mt-3 text-xs leading-5 text-[var(--muted)]"><span class="font-bold">Ukuran cocok</span> berarti browser mengembalikan ukuran yang diminta. <span class="font-bold">Lebih tinggi</span> berarti track tetap lebih besar. <span class="font-bold">Fallback</span> berarti browser memilih mode lain; bukan bukti bahwa semua ukuran di capability range bisa dipakai.</p>
                </div>
              {/if}
            </article>
          {:else}
            <div class="panel p-5 text-sm font-semibold text-[var(--muted)]">Tidak ada kamera yang dapat dibaca.</div>
          {/each}
        </div>
      </section>

      <section class="panel mb-5 p-5 sm:p-6" aria-labelledby="audio-heading">
        <div class="mb-5 flex items-center gap-2 text-[var(--success)]"><Mic size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">AUDIO / INPUT CHECK</span></div>
        <div class="flex flex-wrap items-start justify-between gap-3"><div><h2 id="audio-heading" class="text-xl font-extrabold">Mikrofon</h2><p class="mt-1 text-sm text-[var(--muted)]">Track audio ini yang akan masuk ke WebRTC. Level suara tetap diverifikasi saat live.</p></div><span class="border px-2 py-1 text-xs font-extrabold {badgeClass(report.audio.active !== null)}">{report.audio.active ? "TRACK OK" : "TIDAK ADA TRACK"}</span></div>
        {#if report.audio.error}<div class="mt-4 border border-[#844a52] bg-[#321c22] p-4 text-sm font-semibold text-[var(--danger)]">{report.audio.error}</div>{/if}
        {#if report.audio.active}
          <div class="mt-5 grid gap-5 lg:grid-cols-2"><div><h3 class="text-sm font-extrabold">Settings aktual</h3><div class="mt-3 grid gap-2 sm:grid-cols-2">{#each audioFacts(report.audio.active) as fact}<div class="border border-[var(--border)] bg-[var(--surface-raised)] p-3"><p class="text-xs font-bold uppercase tracking-[0.08em] text-[var(--faint)]">{fact.label}</p><p class="mono mt-1 break-words text-sm font-bold">{fact.value}</p></div>{/each}</div></div>{#if report.audio.capabilities}<div><h3 class="text-sm font-extrabold">Capability range</h3><div class="mt-3 grid gap-2 sm:grid-cols-2">{#each audioCapabilityFacts(report.audio.capabilities) as fact}<div class="border border-[var(--border)] bg-[var(--surface-raised)] p-3"><p class="text-xs font-bold uppercase tracking-[0.08em] text-[var(--faint)]">{fact.label}</p><p class="mono mt-1 break-words text-sm font-bold">{fact.value}</p></div>{/each}</div></div>{/if}</div>
        {/if}
        <div class="mt-5 grid gap-5 border-t border-[var(--border)] pt-5 lg:grid-cols-2"><div><h3 class="text-sm font-extrabold">Audio input terdaftar ({report.audio.devices.length})</h3><div class="mt-3 grid gap-2">{#each report.audio.devices as device}<div class="border border-[var(--border)] bg-[var(--surface-raised)] p-3"><p class="break-words text-sm font-bold">{device.label}</p><p class="mono mt-1 break-all text-xs text-[var(--faint)]">{shortId(device.deviceId)}</p></div>{:else}<p class="text-sm text-[var(--muted)]">Tidak ada audio input.</p>{/each}</div></div><div><h3 class="text-sm font-extrabold">Codec audio sender</h3><div class="mt-3 grid gap-1">{#each report.audio.senderCodecs as codec}<p class="mono break-words text-xs text-[var(--muted)]">{codec}</p>{:else}<p class="text-sm text-[var(--muted)]">Tidak ada codec yang dilaporkan.</p>{/each}</div><p class="mt-4 text-xs font-semibold {report.audio.opusSupported ? "text-[var(--success)]" : "text-[var(--danger)]"}">{report.audio.opusSupported ? "Opus tersedia untuk WebRTC." : "Opus tidak terdeteksi."}</p><details class="mt-4 border border-[var(--border)] p-3"><summary class="cursor-pointer text-xs font-bold">Receiver codec entries</summary><div class="mt-2 grid gap-1">{#each report.audio.receiverCodecs as codec}<p class="mono break-words text-xs text-[var(--muted)]">{codec}</p>{:else}<p class="text-xs text-[var(--muted)]">Tidak ada.</p>{/each}</div></details></div></div>
      </section>

      <p class="text-xs leading-5 text-[var(--muted)]">Diperiksa pada {new Date(report.checkedAt).toLocaleString("id-ID")}. `getCapabilities()` hanya memberikan range/opsi yang browser mau ekspos; browser tidak menyediakan daftar lengkap semua mode sensor. Karena itu halaman ini juga mencoba track aktual dan menampilkan ukuran yang benar-benar dikembalikan.</p>
    {/if}
  </main>
</div>
