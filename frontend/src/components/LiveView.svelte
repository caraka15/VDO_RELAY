<script lang="ts">
  import { afterUpdate, onDestroy } from "svelte";
  import { Activity, AlertCircle, Camera, Check, CircleStop, Copy, ExternalLink, HardDrive, Play, Radio, Smartphone, Video, Wifi } from "@lucide/svelte";
  import type { Stream, StreamStats } from "../lib/api";
  import type { CaptureSession } from "../lib/media";
  import { formatBitrate } from "../lib/format";

  export let stream: Stream;
  export let capture: CaptureSession | null = null;
  export let stats: StreamStats | null = null;
  export let publisherStatus: "ready" | "connecting" | "live" | "error" = "ready";
  export let publisherError = "";
  export let targetBitrateKbps: number;
  export let copied = false;
  export let starting = false;
  export let onStart: () => void;
  export let onPortraitMode: (portraitMode: boolean) => void;
  export let onCopy: () => void;
  export let onResult: () => void;
  export let onStop: () => void;

  let previewHost: HTMLDivElement;

  afterUpdate(() => {
    if (capture?.canvas && previewHost && capture.canvas.parentElement !== previewHost) {
      previewHost.appendChild(capture.canvas);
    }
  });

  onDestroy(() => {
    capture?.canvas?.remove();
  });

  $: statusLabel = publisherStatus === "ready" ? "READY" : publisherStatus === "live" ? "LIVE" : publisherStatus === "error" ? "ERROR" : "CONNECTING";
  $: statusColor = publisherStatus === "ready" ? "var(--accent)" : publisherStatus === "live" ? "var(--success)" : publisherStatus === "error" ? "var(--danger)" : "var(--warning)";
  $: pageTitle = publisherStatus === "ready" ? "Job stream siap" : publisherStatus === "live" ? "Output sedang berjalan" : publisherStatus === "error" ? "Start belum berhasil" : "Menyiapkan output";
  $: pageDescription = publisherStatus === "ready" || publisherStatus === "error"
    ? "Link OBS sudah dibuat. Atur framing lalu mulai kamera dan relay."
    : "Preview di bawah adalah frame final yang dikirim ke server.";
</script>

<svelte:head>
  <title>{stream.path} · VDO Relay</title>
</svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
  <header class="mb-7 flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
    <div>
      <p class="mono mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">STREAM / {stream.id}</p>
      <h1 class="text-3xl font-extrabold tracking-tight sm:text-4xl">{pageTitle}</h1>
      <p class="mt-2 text-sm leading-6 text-[var(--muted)]">{pageDescription}</p>
    </div>
    <div class="flex flex-wrap items-center justify-end gap-2">
      <span class="inline-flex min-h-[44px] items-center gap-2 border px-3 text-sm font-extrabold" style={`border-color:${statusColor};color:${statusColor}`} aria-live="polite">
        <span class="status-dot" aria-hidden="true"></span>{statusLabel}
      </span>
      <button class="button-secondary flex items-center gap-2" type="button" on:click={onResult}>
        <ExternalLink size={17} /><span>Result</span>
      </button>
    </div>
  </header>

  {#if publisherError}
    <div class="mb-5 flex gap-3 border border-[#844a52] bg-[#321c22] p-4 text-sm text-[var(--danger)]" role="alert">
      <AlertCircle size={19} class="mt-0.5 shrink-0" />
      <div><strong>Start stream bermasalah.</strong><p class="mt-1 text-[var(--danger)]">{publisherError}</p></div>
    </div>
  {/if}

  <div class="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
    <section class="panel overflow-hidden" aria-labelledby="preview-heading">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <h2 id="preview-heading" class="flex min-w-0 items-center gap-2 text-sm font-extrabold"><Activity size={17} class="shrink-0 text-[var(--accent)]" /> Preview output</h2>
        <span class="mono text-right text-xs font-bold text-[var(--muted)]">{stream.width}×{stream.height} / {stream.fps} FPS</span>
      </div>
      <div class="relative aspect-video w-full bg-black">
        <div bind:this={previewHost} class="h-full w-full"></div>
        {#if !capture}
          <div class="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <Camera size={30} class="mb-3 text-[var(--accent)]" aria-hidden="true" />
            <p class="font-extrabold">Kamera belum aktif</p>
            <p class="mt-1 max-w-sm text-sm leading-6 text-[var(--muted)]">Job dan URL sudah tersedia. Tekan Start camera &amp; relay setelah framing sesuai.</p>
          </div>
        {/if}
      </div>
      <div class="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
        <span class="inline-flex items-center gap-2"><span class="status-dot" style={`color:${capture ? "var(--success)" : "var(--faint)"}`}></span>{capture ? "Canvas final aktif" : "Preview standby"}</span>
        <span>{capture ? `Input aktual ${capture.actualWidth}×${capture.actualHeight} / ${Math.round(capture.actualFps * 10) / 10} FPS` : "Profile kamera belum diuji"}</span>
        <span>{stream.portraitMode ? "Portrait + bar hitam" : "Landscape fill"}</span>
        <span>{stream.audioEnabled ? "Audio aktif" : "Audio off"}</span>
      </div>
      <div class="border-t border-[var(--border)] p-4 sm:p-5">
        <fieldset disabled={Boolean(capture) || starting} aria-describedby="framing-help">
          <legend class="mb-2 text-sm font-extrabold">Framing output</legend>
          <div class="grid gap-2 min-[420px]:grid-cols-2">
            <button class="flex min-h-[52px] items-center gap-3 border px-3 text-left" class:border-[var(--accent)]={!stream.portraitMode} class:bg-[var(--surface-strong)]={!stream.portraitMode} class:border-[var(--border)]={stream.portraitMode} type="button" aria-pressed={!stream.portraitMode} on:click={() => onPortraitMode(false)}>
              <Video size={18} class="shrink-0" /><span><strong class="block">Landscape</strong><span class="block text-xs text-[var(--muted)]">Isi frame 16:9</span></span>
            </button>
            <button class="flex min-h-[52px] items-center gap-3 border px-3 text-left" class:border-[var(--accent)]={stream.portraitMode} class:bg-[var(--surface-strong)]={stream.portraitMode} class:border-[var(--border)]={!stream.portraitMode} type="button" aria-pressed={stream.portraitMode} on:click={() => onPortraitMode(true)}>
              <Smartphone size={18} class="shrink-0" /><span><strong class="block">Portrait</strong><span class="block text-xs text-[var(--muted)]">Bar hitam kiri-kanan</span></span>
            </button>
          </div>
          <p id="framing-help" class="mt-2 text-xs font-semibold text-[var(--faint)]">Framing dikunci setelah kamera dimulai.</p>
        </fieldset>

        <div class="mt-4 flex flex-col gap-2 sm:flex-row">
          <button class="button-primary flex flex-1 items-center justify-center gap-2" type="button" on:click={onStart} disabled={starting || Boolean(capture)}>
            {#if starting}
              <Activity size={18} class="animate-pulse" /><span>Membuka kamera...</span>
            {:else if capture}
              <Check size={18} /><span>Kamera dan relay aktif</span>
            {:else}
              <Play size={18} /><span>Start camera &amp; relay</span>
            {/if}
          </button>
          <button class="button-danger flex items-center justify-center gap-2" type="button" on:click={onStop}>
            <CircleStop size={18} /><span>Stop job</span>
          </button>
        </div>
      </div>
    </section>

    <aside class="space-y-5">
      <section class="panel p-5" aria-labelledby="stats-heading">
        <div class="mb-5 flex items-center gap-2 text-[var(--accent)]"><Wifi size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">Telemetry</span></div>
        <h2 id="stats-heading" class="text-xl font-extrabold">Stream stats</h2>
        <dl class="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
          <div><dt class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Target</dt><dd class="mono mt-1 text-lg font-extrabold">{formatBitrate(targetBitrateKbps)}</dd></div>
          <div><dt class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Max</dt><dd class="mono mt-1 text-lg font-extrabold">{formatBitrate(stream.maxBitrateKbps)}</dd></div>
          <div><dt class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">Diterima</dt><dd class="mono mt-1 text-lg font-extrabold">{formatBitrate(stats?.receivedBitrateKbps)}</dd></div>
          <div><dt class="text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]">SRT reader</dt><dd class="mono mt-1 text-lg font-extrabold">{stats?.srtReaders ?? 0} / 1</dd></div>
        </dl>
        <div class="mt-5 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted)]">
          <p class="flex items-center justify-between gap-3"><span>Codec</span><strong class="mono text-[var(--text)]">{stream.codec.toUpperCase()}</strong></p>
          <p class="mt-2 flex items-center justify-between gap-3"><span>Recording</span><strong class="inline-flex items-center gap-1.5 text-[var(--text)]"><HardDrive size={15} />{(stats?.recording ?? stream.record) ? "server on" : "off"}</strong></p>
        </div>
      </section>

      <section class="panel p-5" aria-labelledby="srt-heading">
        <div class="mb-5 flex items-center gap-2 text-[var(--accent)]"><Radio size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">OBS input</span></div>
        <h2 id="srt-heading" class="text-xl font-extrabold">SRT read URL</h2>
        <p class="mt-2 text-sm leading-6 text-[var(--muted)]">Tempel sebagai input MPEG-TS di OBS. URL ini mengandung token rahasia.</p>
        <textarea class="field mono mt-4 min-h-[108px] w-full resize-y p-3 text-xs leading-5" readonly aria-label="SRT read URL">{stream.srtUrl || "URL tersedia setelah stream dibuat"}</textarea>
        <button class="button-secondary mt-3 flex w-full items-center justify-center gap-2" type="button" on:click={onCopy} disabled={!stream.srtUrl}>
          {#if copied}<Check size={17} class="text-[var(--success)]" /><span>Tersalin</span>{:else}<Copy size={17} /><span>Copy SRT URL</span>{/if}
        </button>
        <p class="mt-3 text-xs font-semibold text-[var(--faint)]">Token dicabut saat Stop. Jangan bagikan screenshot URL ini.</p>
      </section>
    </aside>
  </div>
</div>
