<script lang="ts">
  import { Activity, ArrowRight, KeyRound, LogOut, Plus, RefreshCw, Server, ShieldCheck, Wifi } from "@lucide/svelte";
  import type { Recording, Session, Stream } from "../lib/api";
  import RecordingsList from "./RecordingsList.svelte";

  export let session: Session;
  export let streams: Stream[] = [];
  export let recordings: Recording[] = [];
  export let recordingsLoading = false;
  export let refreshing = false;
  export let error = "";
  export let onNewStream: () => void;
  export let onOpenStream: (stream: Stream) => void;
  export let onRefresh: () => void;
  export let onLogout: () => void;
  export let onPassword: () => void;
  export let onDeleteRecording: (recording: Recording) => void;

  $: activeStreams = streams.filter((stream) => stream.status === "ready" || stream.status === "connecting" || stream.status === "live");
</script>

<svelte:head>
  <title>Dashboard · VDO Relay</title>
</svelte:head>

<div class="min-h-dvh">
  <header class="border-b border-[var(--border)] bg-[var(--surface)]">
    <div class="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
      <div class="flex min-w-0 items-center gap-3">
        <div class="flex size-10 items-center justify-center border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--accent)]" aria-hidden="true"><Server size={20} /></div>
        <div class="min-w-0"><p class="mono truncate text-xs font-extrabold uppercase tracking-[0.18em] text-[var(--accent)]">VDO / RELAY</p><p class="truncate text-xs font-semibold text-[var(--muted)]">Private streaming console</p></div>
      </div>
      <div class="flex items-center gap-2">
        <span class="hidden text-sm font-bold text-[var(--muted)] sm:inline">{session.username}</span>
        <button class="button-quiet inline-flex items-center gap-2" type="button" on:click={onPassword} aria-label="Ganti password"><KeyRound size={17} /><span class="sr-only sm:not-sr-only">Password</span></button>
        <button class="button-quiet inline-flex items-center gap-2" type="button" on:click={onLogout}><LogOut size={17} /><span class="sr-only sm:not-sr-only">Keluar</span></button>
      </div>
    </div>
  </header>

  <main class="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-8">
    <section class="mb-7 flex flex-col justify-between gap-5 border-b border-[var(--border)] pb-7 sm:flex-row sm:items-end">
      <div>
        <p class="mono mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">CONTROL ROOM</p>
        <h1 class="text-3xl font-extrabold tracking-tight sm:text-4xl">Stream dashboard</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">Satu tempat untuk menyiapkan kamera, memantau relay, dan mengelola file hasil record.</p>
      </div>
      <div class="flex gap-2">
        <button class="button-secondary inline-flex items-center gap-2" type="button" on:click={onRefresh} disabled={refreshing}><RefreshCw size={17} class={refreshing ? "animate-spin" : ""} /><span>Refresh</span></button>
        <button class="button-primary inline-flex items-center gap-2" type="button" on:click={onNewStream}><Plus size={18} /><span>New stream</span></button>
      </div>
    </section>

    {#if error}
      <div class="mb-5 border border-[#844a52] bg-[#321c22] p-4 text-sm font-semibold text-[var(--danger)]" role="alert">{error}</div>
    {/if}

    <section class="mb-7 grid gap-4 sm:grid-cols-3" aria-label="Ringkasan server">
      <div class="panel p-5"><div class="mb-4 flex items-center justify-between"><span class="text-xs font-bold uppercase tracking-[0.12em] text-[var(--faint)]">Open jobs</span><Activity size={18} class="text-[var(--accent)]" /></div><p class="mono text-3xl font-extrabold">{activeStreams.length}<span class="text-base text-[var(--faint)]"> / 8</span></p><p class="mt-2 text-xs font-semibold text-[var(--muted)]">Job ready dan live</p></div>
      <div class="panel p-5"><div class="mb-4 flex items-center justify-between"><span class="text-xs font-bold uppercase tracking-[0.12em] text-[var(--faint)]">Transport</span><Wifi size={18} class="text-[var(--success)]" /></div><p class="text-2xl font-extrabold text-[var(--success)]">MoQ → SRT</p><p class="mt-2 text-xs font-semibold text-[var(--muted)]">No server transcoding</p></div>
      <div class="panel p-5"><div class="mb-4 flex items-center justify-between"><span class="text-xs font-bold uppercase tracking-[0.12em] text-[var(--faint)]">Security</span><ShieldCheck size={18} class="text-[var(--warning)]" /></div><p class="text-2xl font-extrabold">Tokenized</p><p class="mt-2 text-xs font-semibold text-[var(--muted)]">Token dicabut saat job ditutup</p></div>
    </section>

    <section class="panel mb-7" aria-labelledby="streams-heading">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4 sm:px-6"><div><p class="mono mb-1 text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">JOB INVENTORY</p><h2 id="streams-heading" class="text-xl font-extrabold">Streams</h2></div><span class="mono text-xs font-bold text-[var(--muted)]">{streams.length} total</span></div>
      {#if streams.length === 0}
        <div class="px-5 py-8 sm:px-6"><p class="font-bold">Belum ada stream.</p><p class="mt-1 text-sm text-[var(--muted)]">Mulai dari kamera HP atau desktop Chrome.</p></div>
      {:else}
        <div class="divide-y divide-[var(--border)]">
          {#each streams as stream}
            <div class="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center sm:px-6">
              <div class="min-w-0"><p class="mono truncate text-sm font-extrabold">{stream.path}</p><p class="mt-1 text-xs font-semibold text-[var(--muted)]">{stream.codec.toUpperCase()} · {stream.width}×{stream.height} · {stream.fps} FPS · dibuat {new Date(stream.createdAt).toLocaleString("id-ID")}</p></div>
              <span class="inline-flex w-fit items-center gap-2 border px-2.5 py-1 text-xs font-extrabold" class:border-[#3c7154]={stream.status === "live"} class:bg-[#1b3026]={stream.status === "live"} class:text-[var(--success)]={stream.status === "live"} class:border-[#705c31]={stream.status === "connecting"} class:bg-[#332d1d]={stream.status === "connecting"} class:text-[var(--warning)]={stream.status === "connecting"} class:border-[var(--accent)]={stream.status === "ready"} class:text-[var(--accent)]={stream.status === "ready"} class:border-[var(--border)]={stream.status === "stopped" || stream.status === "failed"} class:text-[var(--muted)]={stream.status === "stopped" || stream.status === "failed"}><span class="status-dot"></span>{stream.status.toUpperCase()}</span>
              <span class="mono text-xs font-bold text-[var(--muted)]">{stream.record ? "RECORD ON" : "LIVE ONLY"}</span>
              {#if stream.status === "ready" || stream.status === "connecting" || stream.status === "live"}
                <button class="button-secondary inline-flex items-center justify-center gap-2" type="button" on:click={() => onOpenStream(stream)}><span>Open</span><ArrowRight size={17} /></button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <RecordingsList {recordings} loading={recordingsLoading} onDelete={onDeleteRecording} />
  </main>
</div>
