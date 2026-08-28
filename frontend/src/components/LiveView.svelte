<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Activity, AlertCircle, Check, CircleStop, Copy, ExternalLink, HardDrive, Radio, Wifi } from "@lucide/svelte";
  import type { Stream, StreamStats } from "../lib/api";
  import type { CaptureSession } from "../lib/media";
  import { formatBitrate } from "../lib/format";

  export let stream: Stream;
  export let capture: CaptureSession;
  export let stats: StreamStats | null = null;
  export let publisherStatus: "connecting" | "live" | "error" = "connecting";
  export let publisherError = "";
  export let targetBitrateKbps: number;
  export let copied = false;
  export let onCopy: () => void;
  export let onResult: () => void;
  export let onStop: () => void;

  let previewHost: HTMLDivElement;

  onMount(() => {
    if (capture?.canvas && previewHost) {
      previewHost.appendChild(capture.canvas);
    }
  });

  onDestroy(() => {
    capture?.canvas?.remove();
  });

  $: statusLabel = publisherStatus === "live" ? "LIVE" : publisherStatus === "error" ? "ERROR" : "CONNECTING";
  $: statusColor = publisherStatus === "live" ? "var(--success)" : publisherStatus === "error" ? "var(--danger)" : "var(--warning)";
</script>

<svelte:head>
  <title>{stream.path} · VDO Relay</title>
</svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
  <header class="mb-7 flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
    <div>
      <p class="mono mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">STREAM / {stream.id}</p>
      <h1 class="text-3xl font-extrabold tracking-tight sm:text-4xl">Output sedang berjalan</h1>
      <p class="mt-2 text-sm leading-6 text-[var(--muted)]">Preview di bawah adalah frame final yang dikirim ke server.</p>
    </div>
    <div class="flex flex-wrap items-center justify-end gap-2">
      <span class="inline-flex min-h-[44px] items-center gap-2 border px-3 text-sm font-extrabold" style={`border-color:${statusColor};color:${statusColor}`} aria-live="polite">
        <span class="status-dot" aria-hidden="true"></span>{statusLabel}
      </span>
      <button class="button-secondary flex items-center gap-2" type="button" on:click={onResult}>
        <ExternalLink size={17} /><span>Result</span>
      </button>
      <button class="button-danger flex items-center gap-2" type="button" on:click={onStop}>
        <CircleStop size={18} /><span>Stop</span>
      </button>
    </div>
  </header>

  {#if publisherError}
    <div class="mb-5 flex gap-3 border border-[#844a52] bg-[#321c22] p-4 text-sm text-[var(--danger)]" role="alert">
      <AlertCircle size={19} class="mt-0.5 shrink-0" />
      <div><strong>Koneksi publisher bermasalah.</strong><p class="mt-1 text-[var(--danger)]">{publisherError}</p></div>
    </div>
  {/if}

  <div class="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
    <section class="panel overflow-hidden" aria-labelledby="preview-heading">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <h2 id="preview-heading" class="flex min-w-0 items-center gap-2 text-sm font-extrabold"><Activity size={17} class="shrink-0 text-[var(--accent)]" /> Preview output</h2>
        <span class="mono text-right text-xs font-bold text-[var(--muted)]">{stream.width}×{stream.height} / {stream.fps} FPS</span>
      </div>
      <div bind:this={previewHost} class="aspect-video w-full bg-black"></div>
      <div class="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
        <span class="inline-flex items-center gap-2"><span class="status-dot text-[var(--success)]"></span> Canvas final</span>
        <span>{stream.portraitMode ? "Portrait + bar hitam" : "Landscape fill"}</span>
        <span>{stream.audioEnabled ? "Audio aktif" : "Audio off"}</span>
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
