<script lang="ts">
  import { afterUpdate, onDestroy, onMount } from "svelte";
  import { Activity, AlertCircle, Camera, Check, CircleStop, Copy, ExternalLink, HardDrive, Lock, Mic, Play, Radio, RotateCw, Settings, Smartphone, Trash2, Unlock, Video, Volume2, Wifi } from "@lucide/svelte";
  import type { Stream, StreamStats } from "../lib/api";
  import type { CameraDevice, CaptureSession } from "../lib/media";
  import { formatBitrate } from "../lib/format";

  export let stream: Stream;
  export let capture: CaptureSession | null = null;
  export let verifiedProfile: Pick<CaptureSession, "actualWidth" | "actualHeight" | "actualFps"> | null = null;
  export let cameraDevices: CameraDevice[] = [];
  export let microphoneDevices: MediaDeviceInfo[] = [];
  export let deviceId = "";
  export let audioDeviceId = "";
  export let stats: StreamStats | null = null;
  export let publisherStatus: "ready" | "connecting" | "live" | "error" = "ready";
  export let publisherError = "";
  export let targetBitrateKbps: number;
  export let copied = false;
  export let starting = false;
  export let onStart: () => void;
  export let onProfile: (width: number, height: number, fps: number) => void;
  export let onPortraitMode: (portraitMode: boolean) => void;
  export let onSource: (deviceId: string, audioDeviceId: string) => void;
  export let onCopy: () => void;
  export let onResult: () => void;
  export let onStopRelay: () => void;
  export let onCloseJob: () => void;

  let previewHost: HTMLDivElement;
  let settingsOpen = false;
  let audioLevel = 0;
  let orientationAuto = false;
  let orientationError = "";
  let orientationListener: ((event: DeviceOrientationEvent) => void) | null = null;
  let audioMeterTimer: number | null = null;
  const resolutions = [
    { width: 1920, height: 1080, label: "1080p" },
    { width: 1280, height: 720, label: "720p" },
    { width: 854, height: 480, label: "480p" },
  ];
  const fpsOptions = [24, 30, 60];

  $: outputPortrait = stream.height > stream.width;
  $: outputOrientation = outputPortrait ? "PORTRAIT" : "LANDSCAPE";
  $: framingPortrait = stream.portraitMode;
  $: framingOrientation = framingPortrait ? "PORTRAIT" : "LANDSCAPE";
  $: selectedCamera = cameraDevices.find((device) => device.deviceId === deviceId);
  $: statusLabel = publisherStatus === "ready" ? "READY" : publisherStatus === "live" ? "LIVE" : publisherStatus === "error" ? "ERROR" : "CONNECTING";
  $: statusColor = publisherStatus === "ready" ? "var(--accent)" : publisherStatus === "live" ? "var(--success)" : publisherStatus === "error" ? "var(--danger)" : "var(--warning)";
  $: pageTitle = publisherStatus === "ready" ? "Job siap" : publisherStatus === "live" ? "Output sedang berjalan" : publisherStatus === "error" ? "Start belum berhasil" : "Menyiapkan output";
  $: pageDescription = publisherStatus === "ready" || publisherStatus === "error" ? "Output profile sudah dikunci. Start akan menguji encoder dan membuka input kamera/mikrofon." : "Preview di bawah adalah canvas final yang dikirim ke server.";

  function outputDimensions(option: { width: number; height: number }) {
    return outputPortrait ? { width: option.height, height: option.width } : option;
  }

  function changeResolution(event: Event) {
    const [width, height] = (event.currentTarget as HTMLSelectElement).value.split("x").map(Number);
    onProfile(width, height, stream.fps);
  }

  function changeFPS(event: Event) {
    onProfile(stream.width, stream.height, Number((event.currentTarget as HTMLSelectElement).value));
  }

  function changeSource(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    onSource(value, audioDeviceId);
  }

  function changeAudioSource(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    onSource(deviceId, value);
  }

  function chooseFraming(portrait: boolean) {
    orientationAuto = false;
    removeOrientationListener();
    onPortraitMode(portrait);
  }

  function readDeviceOrientation(event: DeviceOrientationEvent) {
    if (!orientationAuto) return;
    const beta = Math.abs(event.beta || 0);
    const gamma = Math.abs(event.gamma || 0);
    if (beta < 35 && gamma > 35) onPortraitMode(false);
    if (beta > 55 && gamma < 35) onPortraitMode(true);
  }

  async function unlockAutoOrientation() {
    orientationError = "";
    try {
      const permissionApi = (window.DeviceOrientationEvent as any)?.requestPermission;
      if (typeof permissionApi === "function") {
        const permission = await permissionApi();
        if (permission !== "granted") throw new Error("Izin sensor orientasi ditolak.");
      }
      removeOrientationListener();
      orientationAuto = true;
      orientationListener = readDeviceOrientation;
      window.addEventListener("deviceorientation", orientationListener);
    } catch (error) {
      orientationAuto = false;
      orientationError = error instanceof Error ? error.message : "Sensor orientasi belum bisa diaktifkan.";
    }
  }

  function removeOrientationListener() {
    if (orientationListener) window.removeEventListener("deviceorientation", orientationListener);
    orientationListener = null;
  }

  afterUpdate(() => {
    if (capture?.canvas && previewHost && capture.canvas.parentElement !== previewHost) {
      previewHost.appendChild(capture.canvas);
    }
  });

  onMount(() => {
    audioMeterTimer = window.setInterval(() => {
      audioLevel = capture?.getAudioLevel() || 0;
    }, 180);
  });

  onDestroy(() => {
    if (audioMeterTimer !== null) window.clearInterval(audioMeterTimer);
    removeOrientationListener();
    capture?.canvas?.remove();
  });
</script>

<svelte:head>
  <title>{stream.path} · VDO Relay</title>
</svelte:head>

<div class="min-h-dvh pb-24 md:pb-0">
  <div class="mx-auto w-full max-w-6xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
    <header class="mb-5 flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div class="min-w-0">
        <p class="mono mb-1.5 truncate text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">STREAM / {stream.id}</p>
        <h1 class="text-2xl font-extrabold tracking-tight sm:text-4xl">{pageTitle}</h1>
        <p class="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--muted)]">{pageDescription}</p>
      </div>
      <div class="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
        <span class="inline-flex min-h-[42px] items-center gap-2 border px-3 text-xs font-extrabold" style={`border-color:${statusColor};color:${statusColor}`} aria-live="polite"><span class="status-dot" aria-hidden="true"></span>{statusLabel}</span>
        <button class="button-secondary hidden items-center gap-2 md:inline-flex" type="button" on:click={onResult}><ExternalLink size={17} /><span>Result</span></button>
      </div>
    </header>

    {#if publisherError}
      <div class="mb-4 flex gap-3 border border-[#844a52] bg-[#321c22] p-3 text-sm text-[var(--danger)]" role="alert"><AlertCircle size={19} class="mt-0.5 shrink-0" /><div><strong>Start stream bermasalah.</strong><p class="mt-1">{publisherError}</p></div></div>
    {/if}

    <div class="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(290px,0.65fr)]">
      <section class="panel overflow-hidden" aria-labelledby="preview-heading">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5 sm:px-4">
          <h2 id="preview-heading" class="flex min-w-0 items-center gap-2 text-sm font-extrabold"><Activity size={17} class="shrink-0 text-[var(--accent)]" /> Preview output</h2>
          <span class="mono text-right text-xs font-bold text-[var(--muted)]">{stream.width} × {stream.height} / {stream.fps} FPS</span>
        </div>
        <div class="relative aspect-[3/4] w-full bg-black md:aspect-video">
          <div bind:this={previewHost} class="flex h-full w-full items-center justify-center"></div>
          <div class="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2 sm:inset-x-4">
            <div class="border border-white bg-black px-2.5 py-1.5 text-[11px] font-extrabold text-white"><span class="mono">OUTPUT LOCKED</span><span class="mx-1.5 text-white">·</span>{outputOrientation}</div>
            <div class="border border-white bg-black px-2.5 py-1.5 text-[11px] font-extrabold text-white"><span class="mono">FRAME</span><span class="mx-1.5 text-white">·</span>{framingOrientation}</div>
          </div>
          {#if !capture}
            <div class="absolute inset-0 flex flex-col items-center justify-center px-6 text-center"><Camera size={30} class="mb-3 text-[var(--accent)]" aria-hidden="true" /><p class="font-extrabold">Menunggu kamera</p><p class="mt-1 max-w-sm text-sm leading-6 text-[var(--muted)]">Job sudah dibuat. Tekan Start untuk membuka kamera, mikrofon, dan publisher.</p></div>
          {/if}
        </div>
        <div class="border-t border-[var(--border)] px-3 py-2.5 sm:px-4">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-bold text-[var(--muted)]">
            <span class="inline-flex items-center gap-1.5"><span class="status-dot" style={`color:${capture ? "var(--success)" : "var(--faint)"}`}></span>{capture ? "Kamera aktif" : "Kamera standby"}</span>
            <span class="inline-flex items-center gap-1.5"><Mic size={14} class={capture?.audioTrack?.readyState === "live" ? "text-[var(--success)]" : "text-[var(--faint)]"} />{capture?.audioTrack?.readyState === "live" ? "Audio track aktif" : stream.audioEnabled ? "Audio standby" : "Audio off"}</span>
            <span>{capture ? `Input ${capture.actualWidth} × ${capture.actualHeight}${capture.actualFps ? ` · ${Math.round(capture.actualFps * 10) / 10} FPS` : ""}` : verifiedProfile ? `Terakhir diuji ${verifiedProfile.actualWidth} × ${verifiedProfile.actualHeight}` : "Input belum diuji"}</span>
          </div>
          {#if stream.audioEnabled}
            <div class="mt-2 flex items-center gap-2" aria-label={`Level audio ${Math.round(audioLevel * 100)} persen`}><Volume2 size={14} class="shrink-0 text-[var(--muted)]" /><div class="h-2 min-w-0 flex-1 border border-[var(--border-strong)] bg-[var(--surface-raised)]"><div class="h-full bg-[var(--success)] transition-[width] duration-150" style={`width:${Math.max(2, Math.round(audioLevel * 100))}%`}></div></div><span class="mono w-10 text-right text-[10px] font-bold text-[var(--muted)]">{capture?.audioTrack?.readyState === "live" ? `${Math.round(audioLevel * 100)}%` : "—"}</span></div>
          {/if}
        </div>
        <div class="border-t border-[var(--border)] p-3 sm:p-4">
          <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <button class="button-primary flex min-h-[50px] items-center justify-center gap-2" type="button" on:click={onStart} disabled={starting || Boolean(capture)}>{#if starting}<Activity size={18} class="animate-pulse" /><span>Membuka perangkat...</span>{:else if capture}<Check size={18} /><span>Kamera dan relay aktif</span>{:else}<Play size={18} /><span>Start camera &amp; relay</span>{/if}</button>
            <button class="button-secondary hidden min-h-[50px] items-center justify-center gap-2 md:inline-flex" type="button" on:click={onStopRelay} disabled={!capture || starting}><CircleStop size={18} /><span>Stop relay</span></button>
            <button class="button-danger hidden min-h-[50px] items-center justify-center gap-2 md:inline-flex" type="button" on:click={onCloseJob} disabled={starting}><Trash2 size={18} /><span>Close job</span></button>
          </div>
        </div>
      </section>

      <aside class="space-y-4">
        <section class="panel p-4" aria-labelledby="stats-heading">
          <div class="mb-4 flex items-center gap-2 text-[var(--accent)]"><Wifi size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">TELEMETRY</span></div>
          <h2 id="stats-heading" class="text-xl font-extrabold">Stream stats</h2>
          <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3"><div><dt class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Target</dt><dd class="mono mt-1 text-lg font-extrabold">{formatBitrate(targetBitrateKbps)}</dd></div><div><dt class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Max</dt><dd class="mono mt-1 text-lg font-extrabold">{formatBitrate(stream.maxBitrateKbps)}</dd></div><div><dt class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Diterima</dt><dd class="mono mt-1 text-lg font-extrabold">{formatBitrate(stats?.receivedBitrateKbps)}</dd></div><div><dt class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">SRT reader</dt><dd class="mono mt-1 text-lg font-extrabold">{stats?.srtReaders ?? 0} / 1</dd></div></dl>
          <div class="mt-4 border-t border-[var(--border)] pt-3 text-sm text-[var(--muted)]"><p class="flex items-center justify-between gap-3"><span>Video encoder</span><strong class="mono text-[var(--text)]">{stream.codec.toUpperCase()}</strong></p><p class="mt-2 flex items-center justify-between gap-3"><span>Audio encoder</span><strong class="mono text-[var(--text)]">{stream.audioEnabled ? stream.audioCodec.toUpperCase() : "OFF"}</strong></p><p class="mt-2 flex items-center justify-between gap-3"><span>Recording</span><strong class="inline-flex items-center gap-1.5 text-[var(--text)]"><HardDrive size={15} />{(stats?.recording ?? stream.record) ? "server on" : "off"}</strong></p></div>
        </section>

        <section class="panel p-4" aria-labelledby="srt-heading">
          <div class="mb-4 flex items-center gap-2 text-[var(--accent)]"><Radio size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">OBS INPUT</span></div>
          <h2 id="srt-heading" class="text-xl font-extrabold">SRT read URL</h2>
          <p class="mt-1.5 text-sm leading-6 text-[var(--muted)]">URL tetap sama saat relay di-Stop dan Start ulang.</p>
          <textarea class="field mono mt-3 min-h-[100px] w-full resize-y p-3 text-xs leading-5" readonly aria-label="SRT read URL">{stream.srtUrl || "URL belum tersedia"}</textarea>
          <button class="button-secondary mt-2 flex w-full items-center justify-center gap-2" type="button" on:click={onCopy} disabled={!stream.srtUrl}>{#if copied}<Check size={17} class="text-[var(--success)]" /><span>Tersalin</span>{:else}<Copy size={17} /><span>Copy SRT URL</span>{/if}</button>
        </section>
      </aside>
    </div>
  </div>

  <section class={`mobile-settings panel ${settingsOpen ? "fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 block max-h-[78dvh] overflow-y-auto border-[var(--border-strong)] p-4" : "hidden md:block"}`} aria-labelledby="settings-heading">
    <div class="mb-4 flex items-center justify-between gap-3"><h2 id="settings-heading" class="flex items-center gap-2 text-sm font-extrabold"><Settings size={17} class="text-[var(--accent)]" /> Settings cepat</h2><button class="button-quiet min-h-[44px] px-3 text-sm md:hidden" type="button" on:click={() => (settingsOpen = false)}>Tutup</button></div>
    <div class="grid gap-4 md:grid-cols-2">
      <div>
        <p class="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Output profile · locked {outputOrientation}</p>
        <div class="grid grid-cols-2 gap-3">
          <div><label for="live-resolution" class="mb-1.5 block text-sm font-bold">Resolusi encoder</label><select id="live-resolution" class="field w-full px-3" value={`${stream.width}x${stream.height}`} on:change={changeResolution} disabled={Boolean(capture) || starting}>{#each resolutions as option}{@const size = outputDimensions(option)}<option value={`${size.width}x${size.height}`}>{size.width} × {size.height} · {option.label}</option>{/each}</select></div>
          <div><label for="live-fps" class="mb-1.5 block text-sm font-bold">FPS encoder</label><select id="live-fps" class="field w-full px-3" value={stream.fps} on:change={changeFPS} disabled={Boolean(capture) || starting}>{#each fpsOptions as option}<option value={option}>{option} FPS</option>{/each}</select></div>
        </div>
        <p class="mt-2 text-xs font-semibold leading-5 text-[var(--faint)]">Stop relay sebelum mengganti output. Start berikutnya menguji encoder baru; URL OBS tidak berubah.</p>
      </div>
      <div>
        <p class="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Sumber perangkat</p>
        <div class="space-y-3">
          <div><label for="live-camera" class="mb-1.5 block text-sm font-bold">Kamera</label><select id="live-camera" class="field w-full px-3" value={deviceId} on:change={changeSource} disabled={Boolean(capture) || starting}><option value="">Default kamera browser</option>{#each cameraDevices as device}<option value={device.deviceId}>{device.label}</option>{/each}</select>{#if selectedCamera}<p class="mono mt-1.5 text-[11px] font-semibold text-[var(--muted)]">Max {selectedCamera.maxWidth || "?"} × {selectedCamera.maxHeight || "?"} · {selectedCamera.maxFps ? `${Math.round(selectedCamera.maxFps)} FPS` : "FPS ?"} · {selectedCamera.zoom ? `zoom ${selectedCamera.zoom.min}–${selectedCamera.zoom.max}×` : "zoom API tidak ada"}</p>{/if}</div>
          {#if stream.audioEnabled}<div><label for="live-microphone" class="mb-1.5 block text-sm font-bold">Mikrofon</label><select id="live-microphone" class="field w-full px-3" value={audioDeviceId} on:change={changeAudioSource} disabled={Boolean(capture) || starting}><option value="">Default mikrofon browser</option>{#each microphoneDevices as device, index}<option value={device.deviceId}>{device.label || `Mikrofon ${index + 1}`}</option>{/each}</select></div>{/if}
        </div>
      </div>
    </div>
    <div class="mt-4 border-t border-[var(--border)] pt-4">
      <p class="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Framing di dalam output {outputOrientation}</p>
      <div class="grid grid-cols-2 gap-2 sm:max-w-md"><button class="flex min-h-[50px] items-center gap-2 border px-3 text-left" class:border-[var(--accent)]={!framingPortrait} class:bg-[var(--surface-strong)]={!framingPortrait} class:border-[var(--border)]={framingPortrait} type="button" aria-pressed={!framingPortrait} on:click={() => chooseFraming(false)}><Video size={18} class="shrink-0" /><span><strong class="block">Landscape</strong><span class="block text-xs text-[var(--muted)]">Fill jika sesuai</span></span></button><button class="flex min-h-[50px] items-center gap-2 border px-3 text-left" class:border-[var(--accent)]={framingPortrait} class:bg-[var(--surface-strong)]={framingPortrait} class:border-[var(--border)]={!framingPortrait} type="button" aria-pressed={framingPortrait} on:click={() => chooseFraming(true)}><Smartphone size={18} class="shrink-0" /><span><strong class="block">Portrait</strong><span class="block text-xs text-[var(--muted)]">Bar sesuai output</span></span></button></div>
      <p class="mt-2 text-xs font-semibold leading-5 text-[var(--faint)]">{outputPortrait ? "Jika framing Landscape, bar hitam berada di atas dan bawah." : "Jika framing Portrait, bar hitam berada di kiri dan kanan."}</p>
    </div>
    <div class="mt-4 flex flex-wrap gap-2 border-t border-[var(--border)] pt-4"><button class="button-secondary flex items-center gap-2" type="button" on:click={onStopRelay} disabled={!capture || starting}><CircleStop size={18} /><span>Stop relay</span></button><button class="button-danger flex items-center gap-2" type="button" on:click={onCloseJob} disabled={starting}><Trash2 size={18} /><span>Close job</span></button></div>
  </section>

  <div class="mobile-orientation-controls pointer-events-none fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 flex items-center justify-between gap-2 md:hidden">
    <div class="pointer-events-auto flex items-center gap-1.5 border border-white bg-black px-2 py-1.5 text-[11px] font-extrabold text-white"><Lock size={13} /><span>{orientationAuto ? "AUTO" : "LOCKED"} · {framingOrientation}</span></div>
    <div class="pointer-events-auto flex gap-1.5"><button class="flex min-h-[42px] items-center gap-1.5 border border-white bg-black px-2.5 text-[11px] font-extrabold text-white" type="button" on:click={() => chooseFraming(!framingPortrait)} aria-label={framingPortrait ? "Pilih framing landscape" : "Pilih framing portrait"}><RotateCw size={14} />{framingPortrait ? "L" : "P"}</button><button class="flex min-h-[42px] items-center gap-1.5 border border-white bg-black px-2.5 text-[11px] font-extrabold text-white" type="button" on:click={unlockAutoOrientation} aria-label="Aktifkan auto orientasi">{#if orientationAuto}<Unlock size={14} />AUTO{:else}<Lock size={14} />Unlock{/if}</button></div>
  </div>
  {#if orientationError}<p class="fixed bottom-[calc(9.75rem+env(safe-area-inset-bottom))] left-3 right-3 z-40 border border-[#844a52] bg-[#321c22] p-3 text-xs font-bold text-[var(--danger)] md:hidden" role="alert">{orientationError}</p>{/if}

  <nav class="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-[var(--border-strong)] bg-[var(--surface)] md:hidden" aria-label="Kontrol stream">
    <button class="flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-xs font-extrabold text-[var(--muted)]" type="button" on:click={onResult}><ExternalLink size={18} /><span>Result</span></button>
    <button class="flex min-h-[60px] flex-col items-center justify-center gap-0.5 border-x border-[var(--border)] text-xs font-extrabold" class:text-[var(--success)]={capture} class:text-[var(--accent)]={!capture} type="button" on:click={capture ? onStopRelay : onStart} disabled={starting}>{#if capture}<CircleStop size={20} />Stop{:else}<Play size={20} />Start{/if}</button>
    <button class="flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-xs font-extrabold text-[var(--muted)]" class:text-[var(--accent)]={settingsOpen} type="button" on:click={() => (settingsOpen = !settingsOpen)} aria-expanded={settingsOpen}><Settings size={18} /><span>Settings</span></button>
  </nav>
</div>
