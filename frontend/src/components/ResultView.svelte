<script lang="ts">
  import { ArrowLeft, Check, CircleStop, Code2, Copy, ExternalLink, Info, Radio, Wifi } from "@lucide/svelte";
  import type { Stream, StreamStats } from "../lib/api";
  import { formatBitrate } from "../lib/format";

  export let stream: Stream;
  export let stats: StreamStats | null = null;
  export let targetBitrateKbps = 0;
  export let publisherStatus: "connecting" | "live" | "error" = "connecting";
  export let onBack: () => void;
  export let onStop: () => void;

  type CopyTarget = "srt" | "player" | "embed" | "";
  let copied: CopyTarget = "";
  let copyError = "";

  $: playerUrl = stream.playerUrl || "";
  $: embedCode = playerUrl
    ? `<iframe src="${playerUrl}" title="VDO Relay player" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`
    : "";
  $: statusLabel = publisherStatus === "live" ? "LIVE" : publisherStatus === "error" ? "ERROR" : "CONNECTING";

  async function copyValue(value: string, target: CopyTarget) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      copied = target;
      copyError = "";
      window.setTimeout(() => {
        if (copied === target) copied = "";
      }, 2_500);
    } catch {
      copyError = "Clipboard diblokir browser. Salin teks dari kotak secara manual.";
    }
  }
</script>

<svelte:head>
  <title>Result · {stream.path} · VDO Relay</title>
</svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
  <header class="mb-7 flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
    <div>
      <p class="mono mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">RESULT / {stream.id}</p>
      <h1 class="text-3xl font-extrabold tracking-tight sm:text-4xl">Hasil stream</h1>
      <p class="mt-2 text-sm leading-6 text-[var(--muted)]">Player live, URL OBS, dan kode embed untuk output yang sama.</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <button class="button-secondary flex items-center gap-2" type="button" on:click={onBack}>
        <ArrowLeft size={17} /><span>Live monitor</span>
      </button>
      <button class="button-danger flex items-center gap-2" type="button" on:click={onStop}>
        <CircleStop size={18} /><span>Stop</span>
      </button>
    </div>
  </header>

  <div class="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
    <section class="panel overflow-hidden" aria-labelledby="player-heading">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <h2 id="player-heading" class="flex items-center gap-2 text-sm font-extrabold"><Radio size={17} class="text-[var(--accent)]" /> Player output</h2>
        <span class="mono text-xs font-bold text-[var(--muted)]">{statusLabel} · {stream.codec.toUpperCase()}</span>
      </div>
      <div class="aspect-video w-full bg-black">
        {#if playerUrl}
          <iframe
            class="h-full w-full border-0"
            src={playerUrl}
            title={`Player ${stream.path}`}
            allow="autoplay; fullscreen; picture-in-picture"
            allowfullscreen
          ></iframe>
        {:else}
          <div class="flex h-full items-center justify-center px-6 text-center text-sm font-bold text-[var(--muted)]">Player URL belum tersedia.</div>
        {/if}
      </div>
      <div class="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
        <span>{stream.width}×{stream.height} / {stream.fps} FPS</span>
        <span>Target {formatBitrate(targetBitrateKbps)}</span>
        <span>Diterima {formatBitrate(stats?.receivedBitrateKbps)}</span>
        <span class="inline-flex items-center gap-2"><span class="status-dot text-[var(--success)]"></span> Tanpa transcoding</span>
      </div>
    </section>

    <aside class="space-y-5">
      <section class="panel p-5" aria-labelledby="obs-heading">
        <div class="mb-5 flex items-center gap-2 text-[var(--accent)]"><Wifi size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">OBS INPUT</span></div>
        <h2 id="obs-heading" class="text-xl font-extrabold">Pasang ke OBS</h2>
        <ol class="mt-4 space-y-3 text-sm leading-6 text-[var(--muted)]">
          <li><strong class="text-[var(--text)]">1.</strong> Tambah source <strong class="text-[var(--text)]">Media Source</strong>.</li>
          <li><strong class="text-[var(--text)]">2.</strong> Matikan <strong class="text-[var(--text)]">Local File</strong>, lalu masukkan URL SRT di bawah.</li>
          <li><strong class="text-[var(--text)]">3.</strong> Gunakan input format <strong class="text-[var(--text)]">mpegts</strong> dan latency sekitar 2 detik.</li>
        </ol>
        <label class="mt-5 block text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]" for="result-srt-url">SRT read URL</label>
        <textarea id="result-srt-url" class="field mono mt-2 min-h-[108px] w-full resize-y p-3 text-xs leading-5" readonly>{stream.srtUrl || "URL belum tersedia"}</textarea>
        <button class="button-secondary mt-3 flex w-full items-center justify-center gap-2" type="button" on:click={() => copyValue(stream.srtUrl || "", "srt")} disabled={!stream.srtUrl}>
          {#if copied === "srt"}<Check size={17} class="text-[var(--success)]" /><span>SRT tersalin</span>{:else}<Copy size={17} /><span>Copy SRT URL</span>{/if}
        </button>
      </section>

      <section class="panel p-5" aria-labelledby="embed-heading">
        <div class="mb-5 flex items-center gap-2 text-[var(--accent)]"><Code2 size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">EMBED PLAYER</span></div>
        <h2 id="embed-heading" class="text-xl font-extrabold">Bagikan player</h2>
        <p class="mt-2 text-sm leading-6 text-[var(--muted)]">Link ini membuka player MediaMTX. Token berada di URL dan otomatis tidak berlaku setelah stream di-stop.</p>
        <label class="mt-5 block text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]" for="player-url">Player link</label>
        <textarea id="player-url" class="field mono mt-2 min-h-[86px] w-full resize-y p-3 text-xs leading-5" readonly>{playerUrl || "Link belum tersedia"}</textarea>
        <div class="mt-3 grid gap-2 sm:grid-cols-2">
          <button class="button-secondary flex items-center justify-center gap-2" type="button" on:click={() => copyValue(playerUrl, "player")} disabled={!playerUrl}>
            {#if copied === "player"}<Check size={17} class="text-[var(--success)]" /><span>Tersalin</span>{:else}<Copy size={17} /><span>Copy link</span>{/if}
          </button>
          <a class="button-secondary inline-flex items-center justify-center gap-2" href={playerUrl || undefined} target="_blank" rel="noreferrer" aria-disabled={!playerUrl}>
            <ExternalLink size={17} /><span>Buka player</span>
          </a>
        </div>

        <label class="mt-5 block text-xs font-bold uppercase tracking-[0.1em] text-[var(--faint)]" for="embed-code">HTML embed</label>
        <textarea id="embed-code" class="field mono mt-2 min-h-[118px] w-full resize-y p-3 text-xs leading-5" readonly>{embedCode || "Embed code belum tersedia"}</textarea>
        <button class="button-secondary mt-3 flex w-full items-center justify-center gap-2" type="button" on:click={() => copyValue(embedCode, "embed")} disabled={!embedCode}>
          {#if copied === "embed"}<Check size={17} class="text-[var(--success)]" /><span>Embed code tersalin</span>{:else}<Copy size={17} /><span>Copy embed code</span>{/if}
        </button>
        {#if copyError}
          <p class="mt-3 text-xs font-semibold text-[var(--danger)]" role="alert">{copyError}</p>
        {/if}
        <p class="mt-4 flex gap-2 text-xs font-semibold leading-5 text-[var(--faint)]"><Info size={15} class="mt-0.5 shrink-0" />H.265 mengikuti dukungan decoder browser yang membuka player. Chrome biasanya lebih aman dengan H.264.</p>
      </section>
    </aside>
  </div>
</div>
