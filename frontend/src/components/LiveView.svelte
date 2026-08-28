<script lang="ts">
  import { afterUpdate, onDestroy, onMount } from "svelte";
  import { Activity, AlertCircle, Camera, Check, CircleStop, Copy, ExternalLink, HardDrive, Home, Mic, MicOff, Play, Radio, Settings, Volume2, Wifi, X, Zap } from "@lucide/svelte";
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
  export let copied = false;
  export let starting = false;
  export let onStart: () => void;
  export let onSource: (deviceId: string, audioDeviceId: string) => void;
  export let onCopy: () => void;
  export let onResult: () => void;
  export let onStopRelay: () => void | Promise<boolean>;
  export let onLeaveHome: () => void | Promise<void>;

  let previewVideo: HTMLVideoElement;
  let settingsOpen = false;
  let audioLevel = 0;
  let muted = false;
  let torchOn = false;
  let cameraControlError = "";
  let audioMeterTimer: number | null = null;
  let lastCapture: CaptureSession | null = null;

  $: outputPortrait = stream.height > stream.width;
  $: outputOrientation = outputPortrait ? "PORTRAIT" : "LANDSCAPE";
  $: sourceLandscape = Boolean(capture && capture.actualWidth > capture.actualHeight);
  $: sourcePreviewAspect = capture && capture.actualHeight > 0 ? capture.actualWidth / capture.actualHeight : 16 / 9;
  $: selectedCamera = cameraDevices.find((device) => device.deviceId === deviceId);
  $: statusLabel = publisherStatus === "ready" ? "READY" : publisherStatus === "live" ? "LIVE" : publisherStatus === "error" ? "ERROR" : "CONNECTING";
  $: statusColor = publisherStatus === "ready" ? "var(--accent)" : publisherStatus === "live" ? "var(--success)" : publisherStatus === "error" ? "var(--danger)" : "var(--warning)";
  $: pageTitle = publisherStatus === "ready" ? "Job siap" : publisherStatus === "live" ? "Output sedang berjalan" : publisherStatus === "error" ? "Start belum berhasil" : "Menyiapkan output";
  $: pageDescription = publisherStatus === "ready" || publisherStatus === "error" ? "Tekan Start untuk membuka kamera dan mengirim track native melalui WHIP." : "Preview mengikuti kamera langsung. Orientasi, resolusi, dan FPS tetap terkunci.";
  $: videoCapabilities = capture?.videoTrack?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean; zoom?: { min?: number; max?: number; step?: number } }) | undefined;
  $: torchSupported = videoCapabilities?.torch === true;
  $: zoomCapability = videoCapabilities?.zoom;
  $: zoomMin = zoomCapability?.min ?? selectedCamera?.zoom?.min ?? 1;
  $: zoomMax = zoomCapability?.max ?? selectedCamera?.zoom?.max ?? 1;
  $: zoomStep = zoomCapability?.step ?? selectedCamera?.zoom?.step ?? 0.1;
  $: zoomValue = capture?.videoTrack?.getSettings?.().zoom ?? zoomMin;
  $: audioLive = capture?.audioTrack?.readyState === "live";

  afterUpdate(() => {
    const source = capture?.sourceStream ?? null;
    if (previewVideo && previewVideo.srcObject !== source) {
      previewVideo.srcObject = source;
      if (source) void previewVideo.play().catch(() => undefined);
    }
    if (capture !== lastCapture) {
      lastCapture = capture;
      muted = Boolean(capture?.audioTrack && !capture.audioTrack.enabled);
      torchOn = false;
      cameraControlError = "";
    }
  });

  onMount(() => {
    audioMeterTimer = window.setInterval(() => {
      audioLevel = capture?.getAudioLevel() || 0;
    }, 180);
  });

  onDestroy(() => {
    if (audioMeterTimer !== null) window.clearInterval(audioMeterTimer);
    previewVideo?.pause();
    if (previewVideo) previewVideo.srcObject = null;
  });

  function changeSource(event: Event) {
    onSource((event.currentTarget as HTMLSelectElement).value, audioDeviceId);
  }

  function changeAudioSource(event: Event) {
    onSource(deviceId, (event.currentTarget as HTMLSelectElement).value);
  }

  function toggleMute() {
    const track = capture?.audioTrack;
    if (!track) return;
    track.enabled = !track.enabled;
    muted = !track.enabled;
  }

  async function toggleTorch() {
    const track = capture?.videoTrack;
    if (!track || !torchSupported) return;
    cameraControlError = "";
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] } as unknown as MediaTrackConstraints);
      torchOn = !torchOn;
    } catch (error) {
      cameraControlError = error instanceof Error ? error.message : "Flash tidak bisa diubah pada kamera ini.";
    }
  }

  async function changeZoom(event: Event) {
    const track = capture?.videoTrack;
    if (!track || !zoomCapability) return;
    const next = Number((event.currentTarget as HTMLInputElement).value);
    cameraControlError = "";
    try {
      await track.applyConstraints({ advanced: [{ zoom: next }] } as unknown as MediaTrackConstraints);
    } catch (error) {
      cameraControlError = error instanceof Error ? error.message : "Zoom tidak bisa diubah pada kamera ini.";
    }
  }
</script>

<svelte:head>
  <title>{stream.path} · VDO Relay</title>
</svelte:head>

<div class="live-page min-h-dvh pb-24 md:pb-0">
  <div class="live-shell mx-auto w-full max-w-6xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
    <header class="live-header mb-5 flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div class="min-w-0"><p class="mono mb-1.5 truncate text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">STREAM / {stream.id}</p><h1 class="text-2xl font-extrabold tracking-tight sm:text-4xl">{pageTitle}</h1><p class="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--muted)]">{pageDescription}</p></div>
      <div class="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end"><span class="inline-flex min-h-[42px] items-center gap-2 border px-3 text-xs font-extrabold" style={`border-color:${statusColor};color:${statusColor}`} aria-live="polite"><span class="status-dot" aria-hidden="true"></span>{statusLabel}</span><button class="button-secondary hidden items-center gap-2 md:inline-flex" type="button" on:click={onResult}><ExternalLink size={17} /><span>Result</span></button></div>
    </header>

    {#if publisherError}<div class="live-error mb-4 flex gap-3 border border-[#844a52] bg-[#321c22] p-3 text-sm text-[var(--danger)]" role="alert"><AlertCircle size={19} class="mt-0.5 shrink-0" /><div><strong>Start stream bermasalah.</strong><p class="mt-1">{publisherError}</p></div></div>{/if}

    <div class="live-content-grid grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(290px,0.65fr)]">
      <section class="preview-panel panel overflow-hidden" aria-labelledby="preview-heading">
        <div class="preview-panel-header flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5 sm:px-4"><h2 id="preview-heading" class="flex min-w-0 items-center gap-2 text-sm font-extrabold"><Camera size={17} class="shrink-0 text-[var(--accent)]" /> Preview kamera</h2><span class="mono text-right text-xs font-bold text-[var(--muted)]">{stream.width} × {stream.height} / {stream.fps} FPS</span></div>
        <div class="preview-stage relative w-full bg-black">
          <video bind:this={previewVideo} class="preview-video" class:source-landscape={sourceLandscape} style={`--source-aspect:${sourcePreviewAspect}`} autoplay muted playsinline aria-label="Preview kamera langsung"></video>
          <div class="stage-status pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-2 sm:inset-x-4">
            <div class="stage-status-card"><span class="inline-flex items-center gap-1.5"><span class="status-dot" style={`color:${publisherStatus === "live" ? "var(--success)" : statusColor}`}></span><span class="mono">{statusLabel}</span></span><span class="stage-status-detail">CAMERA {sourceLandscape ? "LANDSCAPE" : "PORTRAIT"} · {capture ? "ACTIVE" : "STANDBY"}</span></div>
            <div class="stage-status-card text-right"><span class="mono">{outputOrientation} · LOCKED</span><span class="stage-status-detail">MIC {audioLive ? (muted ? "MUTED" : "LIVE") : stream.audioEnabled ? "WAIT" : "OFF"}</span></div>
          </div>
          {#if publisherError}<div class="stage-error absolute inset-x-3 top-20 z-10 gap-2 border border-[#844a52] bg-[#321c22] p-3 text-xs font-bold text-[var(--danger)]" role="alert"><AlertCircle size={17} class="mt-0.5 shrink-0" /><span>{publisherError}</span></div>{/if}
          {#if !capture}<div class="no-capture-overlay absolute inset-0 flex flex-col items-center justify-center px-6 text-center"><Camera size={30} class="mb-3 text-[var(--accent)]" aria-hidden="true" /><p class="font-extrabold">Menunggu kamera</p><p class="mt-1 max-w-sm text-sm leading-6 text-[var(--muted)]">Job sudah dibuat. Tekan Start untuk membuka kamera dan mikrofon pada mode yang sudah diverifikasi.</p></div>{/if}
        </div>
        <div class="preview-meta border-t border-[var(--border)] px-3 py-2.5 sm:px-4"><div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-bold text-[var(--muted)]"><span class="inline-flex items-center gap-1.5"><span class="status-dot" style={`color:${capture ? "var(--success)" : "var(--faint)"}`}></span>{capture ? "Kamera aktif" : "Kamera standby"}</span><span class="inline-flex items-center gap-1.5"><Mic size={14} class={audioLive && !muted ? "text-[var(--success)]" : "text-[var(--faint)]"} />{audioLive ? (muted ? "Audio mute" : "Audio track aktif") : stream.audioEnabled ? "Audio standby" : "Audio off"}</span><span>{capture ? `Input ${capture.actualWidth} × ${capture.actualHeight}${capture.actualFps ? ` · ${Math.round(capture.actualFps * 10) / 10} FPS` : ""}` : verifiedProfile ? `Terakhir diuji ${verifiedProfile.actualWidth} × ${verifiedProfile.actualHeight}` : "Input belum diuji"}</span></div>{#if stream.audioEnabled}<div class="mt-2 flex items-center gap-2" aria-label={`Level audio ${Math.round(audioLevel * 100)} persen`}><Volume2 size={14} class="shrink-0 text-[var(--muted)]" /><div class="h-2 min-w-0 flex-1 border border-[var(--border-strong)] bg-[var(--surface-raised)]"><div class="h-full bg-[var(--success)] transition-[width] duration-150" style={`width:${Math.max(2, Math.round(audioLevel * 100))}%`}></div></div><span class="mono w-10 text-right text-[10px] font-bold text-[var(--muted)]">{audioLive && !muted ? `${Math.round(audioLevel * 100)}%` : "—"}</span></div>{/if}</div>
        <div class="preview-controls border-t border-[var(--border)] p-3 sm:p-4"><div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"><button class="button-primary flex min-h-[50px] items-center justify-center gap-2" type="button" on:click={onStart} disabled={starting || Boolean(capture)}>{#if starting}<Activity size={18} class="animate-pulse" /><span>Membuka perangkat...</span>{:else if capture}<Check size={18} /><span>Kamera dan relay aktif</span>{:else}<Play size={18} /><span>Start camera &amp; relay</span>{/if}</button><button class="button-secondary hidden min-h-[50px] items-center justify-center gap-2 md:inline-flex" type="button" on:click={onStopRelay} disabled={!capture || starting}><CircleStop size={18} /><span>Stop relay</span></button><button class="button-secondary hidden min-h-[50px] items-center justify-center gap-2 md:inline-flex" type="button" on:click={onLeaveHome} disabled={starting}><Home size={18} /><span>Kembali ke Home</span></button></div></div>
      </section>

      <aside class="live-sidebar space-y-4"><section class="panel p-4" aria-labelledby="stats-heading"><div class="mb-4 flex items-center gap-2 text-[var(--accent)]"><Wifi size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">TELEMETRY</span></div><h2 id="stats-heading" class="text-xl font-extrabold">Stream stats</h2><dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3"><div><dt class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Max video</dt><dd class="mono mt-1 text-lg font-extrabold">{formatBitrate(stream.maxBitrateKbps)}</dd></div><div><dt class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Transport</dt><dd class="mono mt-1 text-lg font-extrabold">WHIP</dd></div><div><dt class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Diterima</dt><dd class="mono mt-1 text-lg font-extrabold">{formatBitrate(stats?.receivedBitrateKbps)}</dd></div><div><dt class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Readers</dt><dd class="mono mt-1 text-lg font-extrabold">{stats?.srtReaders ?? 0} / 10</dd></div></dl><div class="mt-4 border-t border-[var(--border)] pt-3 text-sm text-[var(--muted)]"><p class="flex items-center justify-between gap-3"><span>Video encoder</span><strong class="mono text-[var(--text)]">{stream.codec.toUpperCase()}</strong></p><p class="mt-2 flex items-center justify-between gap-3"><span>Audio encoder</span><strong class="mono text-[var(--text)]">{stream.audioEnabled ? stream.audioCodec.toUpperCase() : "OFF"}</strong></p><p class="mt-2 flex items-center justify-between gap-3"><span>Recording</span><strong class="inline-flex items-center gap-1.5 text-[var(--text)]"><HardDrive size={15} />{(stats?.recording ?? stream.record) ? "server on" : "off"}</strong></p></div></section><section class="panel p-4" aria-labelledby="srt-heading"><div class="mb-4 flex items-center gap-2 text-[var(--accent)]"><Radio size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">OBS INPUT</span></div><h2 id="srt-heading" class="text-xl font-extrabold">SRT read URL</h2><p class="mt-1.5 text-sm leading-6 text-[var(--muted)]">URL tetap sama saat relay di-Stop dan Start ulang.</p><textarea class="field mono mt-3 min-h-[100px] w-full resize-y p-3 text-xs leading-5" readonly aria-label="SRT read URL">{stream.srtUrl || "URL belum tersedia"}</textarea><button class="button-secondary mt-2 flex w-full items-center justify-center gap-2" type="button" on:click={onCopy} disabled={!stream.srtUrl}>{#if copied}<Check size={17} class="text-[var(--success)]" /><span>Tersalin</span>{:else}<Copy size={17} /><span>Copy SRT URL</span>{/if}</button></section></aside>
    </div>
  </div>

  <section class={`live-settings-panel panel ${settingsOpen ? "mobile-settings-open" : ""}`} aria-labelledby="settings-heading">
    <div class="settings-panel-header"><div><p class="mono text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--accent)]">CAMERA CONTROLS</p><h2 id="settings-heading" class="mt-1 flex items-center gap-2 text-lg font-extrabold"><Settings size={18} class="text-[var(--accent)]" /> Settings</h2></div><button class="button-quiet min-h-[44px] px-3 text-sm md:hidden" type="button" on:click={() => (settingsOpen = false)}>Tutup</button></div>
    <div class="settings-panel-grid">
      <div class="settings-profile"><p class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Profile terkunci</p><p class="mono mt-2 text-sm font-extrabold">{stream.codec.toUpperCase()} · {stream.width} × {stream.height} · {stream.fps} FPS</p><p class="mt-2 text-xs font-semibold leading-5 text-[var(--muted)]">Untuk mengganti profile, kembali ke Home dan buka job baru. Job ini tetap bisa dipakai ulang.</p></div>
      <div class="settings-source"><p class="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Sumber perangkat</p><div class="space-y-3"><div><label for="live-camera" class="mb-1.5 block text-sm font-bold">Kamera</label><select id="live-camera" class="field w-full px-3" value={deviceId} on:change={changeSource} disabled={Boolean(capture) || starting}><option value="">Default kamera browser</option>{#each cameraDevices as device}<option value={device.deviceId}>{device.label}</option>{/each}</select>{#if selectedCamera}<p class="mono mt-1.5 text-[11px] font-semibold text-[var(--muted)]">Max {selectedCamera.maxWidth || "?"} × {selectedCamera.maxHeight || "?"} · {selectedCamera.maxFps ? `${Math.round(selectedCamera.maxFps)} FPS` : "FPS ?"}</p>{/if}</div>{#if stream.audioEnabled}<div><label for="live-microphone" class="mb-1.5 block text-sm font-bold">Mikrofon</label><select id="live-microphone" class="field w-full px-3" value={audioDeviceId} on:change={changeAudioSource} disabled={Boolean(capture) || starting}><option value="">Default mikrofon browser</option>{#each microphoneDevices as device, index}<option value={device.deviceId}>{device.label || `Mikrofon ${index + 1}`}</option>{/each}</select></div>{/if}</div></div>
      <div class="settings-camera"><p class="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Kamera aktif</p><button class="button-secondary flex min-h-[48px] w-full items-center justify-center gap-2" type="button" on:click={toggleTorch} disabled={!capture || !torchSupported || starting} aria-pressed={torchOn}><Zap size={18} class={torchOn ? "text-[var(--warning)]" : ""} />{torchOn ? "Flash menyala" : torchSupported ? "Flash mati" : "Flash tidak tersedia"}</button><label class="mt-4 block text-sm font-bold" for="live-zoom">Zoom {zoomCapability ? `${Number(zoomValue).toFixed(1)}×` : "tidak tersedia"}</label><input id="live-zoom" class="w-full accent-[var(--accent)]" type="range" min={zoomMin} max={zoomMax} step={zoomStep} value={zoomValue} on:input={changeZoom} disabled={!capture || !zoomCapability || starting} /><div class="mono mt-1 flex justify-between text-[11px] font-semibold text-[var(--muted)]"><span>{Number(zoomMin).toFixed(1)}×</span><span>{Number(zoomMax).toFixed(1)}×</span></div>{#if cameraControlError}<p class="mt-3 border border-[#844a52] bg-[#321c22] p-3 text-xs font-semibold text-[var(--danger)]" role="alert">{cameraControlError}</p>{/if}</div>
    </div>
    <div class="settings-actions"><button class="button-secondary flex items-center gap-2" type="button" on:click={onResult}><ExternalLink size={17} />Result / OBS</button><button class="button-secondary flex items-center gap-2" type="button" on:click={onLeaveHome} disabled={starting}><Home size={17} />Kembali ke Home</button></div>
  </section>

  <nav class="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-[var(--border-strong)] bg-[var(--surface)]" aria-label="Kontrol kamera"><button class="flex min-h-[64px] flex-col items-center justify-center gap-0.5 text-xs font-extrabold text-[var(--muted)]" class:text-[var(--danger)]={muted} type="button" on:click={toggleMute} disabled={!capture || !audioLive || starting} aria-pressed={muted}>{#if muted}<MicOff size={20} />Mute{:else}<Mic size={20} />{stream.audioEnabled ? "Mic" : "Audio off"}{/if}</button><button class="mobile-start-button flex min-h-[64px] flex-col items-center justify-center gap-0.5 border-x border-[var(--border)] text-xs font-extrabold" class:text-[var(--success)]={capture} class:text-[var(--accent)]={!capture} type="button" on:click={capture ? onStopRelay : onStart} disabled={starting}>{#if capture}<CircleStop size={23} />Stop{:else}<Play size={23} />Start{/if}</button><button class="flex min-h-[64px] flex-col items-center justify-center gap-0.5 text-xs font-extrabold text-[var(--muted)]" class:text-[var(--accent)]={settingsOpen} type="button" on:click={() => (settingsOpen = !settingsOpen)} aria-expanded={settingsOpen}><Settings size={20} /><span>Settings</span></button></nav>
</div>
