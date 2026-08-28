<script lang="ts">
  import { Download, HardDrive, Trash2 } from "@lucide/svelte";
  import type { Recording } from "../lib/api";
  import { formatBytes, formatDate } from "../lib/format";

  export let recordings: Recording[] = [];
  export let loading = false;
  export let onDelete: (recording: Recording) => void;
</script>

<section class="panel" aria-labelledby="recordings-heading">
  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4 sm:px-6">
    <div>
      <div class="mb-1 flex items-center gap-2 text-[var(--accent)]"><HardDrive size={17} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">Archive</span></div>
      <h2 id="recordings-heading" class="text-xl font-extrabold">Recordings</h2>
    </div>
    <span class="mono text-xs font-bold text-[var(--muted)]">{recordings.length} file</span>
  </div>

  {#if loading}
    <p class="px-5 py-7 text-sm font-semibold text-[var(--muted)] sm:px-6">Memuat file...</p>
  {:else if recordings.length === 0}
    <div class="px-5 py-8 sm:px-6">
      <p class="font-bold">Belum ada recording.</p>
      <p class="mt-1 text-sm text-[var(--muted)]">Aktifkan “Record di server” sebelum memulai stream.</p>
    </div>
  {:else}
    <div class="divide-y divide-[var(--border)]">
      {#each recordings as recording}
        <div class="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div class="min-w-0">
            <p class="mono truncate text-sm font-bold text-[var(--text)]">{recording.name}</p>
            <p class="mt-1 text-xs font-semibold text-[var(--muted)]">{formatBytes(recording.sizeBytes)} · {formatDate(recording.updatedAt)}</p>
          </div>
          <div class="flex shrink-0 gap-2">
            <a class="button-secondary inline-flex items-center gap-2" href={recording.downloadUrl} download>
              <Download size={16} /><span>Download</span>
            </a>
            <button class="button-danger inline-flex items-center gap-2" type="button" on:click={() => onDelete(recording)} aria-label={`Hapus ${recording.name}`}>
              <Trash2 size={16} /><span class="sr-only sm:not-sr-only">Hapus</span>
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>
