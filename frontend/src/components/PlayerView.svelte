<script lang="ts">
  import { onMount } from "svelte";
  import { Activity, AlertCircle, Radio } from "@lucide/svelte";

  let video: HTMLVideoElement;
  let status: "connecting" | "live" | "error" = "connecting";
  let error = "";
  let reader: { close: () => void } | null = null;

  onMount(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const url = params.get("url") || "";
    const token = params.get("token") || "";
    async function init() {
      if (!url || !token) {
        status = "error";
        error = "Link player tidak lengkap.";
        return;
      }
      try {
        const parsed = new URL(url);
        if (!parsed.pathname.endsWith("/whep") || !/^https?:$/.test(parsed.protocol)) throw new Error("URL WHEP tidak valid.");
        const { MediaMTXWebRTCReader } = await import("../lib/mediamtx-webrtc-reader.js");
        if (cancelled) return;
        reader = new MediaMTXWebRTCReader({
          url,
          token,
          onTrack: (stream: MediaStream) => {
            video.srcObject = stream;
            void video.play().catch(() => undefined);
          },
          onConnected: () => {
            status = "live";
            error = "";
          },
          onError: (message: string) => {
            status = "error";
            error = message;
          },
        });
      } catch (reason) {
        status = "error";
        error = reason instanceof Error ? reason.message : "Player belum bisa dimulai.";
      }
    }
    void init();
    return () => {
      cancelled = true;
      reader?.close();
      reader = null;
      video?.pause();
      if (video) video.srcObject = null;
    };
  });

  $: statusLabel = status === "live" ? "LIVE" : status === "error" ? "ERROR" : "CONNECTING";
</script>

<svelte:head>
  <title>VDO Relay player</title>
</svelte:head>

<main class="player-page relative flex min-h-dvh items-center justify-center bg-black p-3 sm:p-6">
  <div class="relative aspect-video w-full max-w-6xl overflow-hidden border border-[var(--border)] bg-black">
    <video bind:this={video} class="h-full w-full object-contain" autoplay muted playsinline controls aria-label="VDO Relay live player"></video>
    <div class="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2 sm:inset-x-4 sm:top-4">
      <div class="stage-status-card"><span class="inline-flex items-center gap-1.5"><span class="status-dot" class:text-[var(--success)]={status === "live"} class:text-[var(--warning)]={status === "connecting"} class:text-[var(--danger)]={status === "error"}></span><span class="mono">{statusLabel}</span></span><span class="stage-status-detail">VDO RELAY · WHEP</span></div>
      {#if status === "connecting"}<Activity size={20} class="animate-spin text-white" />{:else}<Radio size={19} class="text-white" />{/if}
    </div>
    {#if error}<div class="absolute inset-x-3 bottom-3 flex items-start gap-2 border border-[#844a52] bg-[#321c22] p-3 text-xs font-bold text-[var(--danger)] sm:inset-x-4 sm:bottom-4" role="alert"><AlertCircle size={17} class="mt-0.5 shrink-0" /><span>{error}</span></div>{/if}
  </div>
</main>
