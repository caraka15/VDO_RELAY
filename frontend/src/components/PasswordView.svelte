<script lang="ts">
  import { AlertCircle, ArrowRight, KeyRound, LockKeyhole } from "@lucide/svelte";

  export let busy = false;
  export let error = "";
  export let onSubmit: (currentPassword: string, newPassword: string) => void;

  let currentPassword = "";
  let newPassword = "";
  let confirmation = "";

  $: valid = newPassword.length >= 10 && newPassword.length <= 128 && newPassword === confirmation;
</script>

<svelte:head>
  <title>Ganti password · VDO Relay</title>
</svelte:head>

<main class="flex min-h-dvh items-center justify-center px-5 py-10">
  <section class="w-full max-w-md">
    <div class="mb-8 flex items-center gap-3">
      <div class="flex size-11 items-center justify-center border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--warning)]" aria-hidden="true">
        <KeyRound size={22} strokeWidth={2.4} />
      </div>
      <div>
        <p class="mono text-xs font-bold uppercase tracking-[0.18em] text-[var(--warning)]">FIRST LOGIN</p>
        <p class="text-sm font-semibold text-[var(--muted)]">Satu langkah keamanan</p>
      </div>
    </div>

    <div class="panel p-6 sm:p-8">
      <div class="mb-7">
        <p class="mb-2 text-sm font-bold uppercase tracking-[0.14em] text-[var(--faint)]">Password default terdeteksi</p>
        <h1 class="text-3xl font-extrabold tracking-tight text-[var(--text)]">Buat password baru</h1>
        <p class="mt-3 text-sm leading-6 text-[var(--muted)]">Password awal hanya untuk bootstrap. Ganti sebelum membuat stream.</p>
      </div>

      {#if error}
        <div class="mb-5 flex gap-3 border border-[#844a52] bg-[#321c22] p-3 text-sm text-[var(--danger)]" role="alert">
          <AlertCircle size={18} class="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      {/if}

      <form class="space-y-5" on:submit|preventDefault={() => onSubmit(currentPassword, newPassword)}>
        <div>
          <label for="current-password" class="mb-2 block text-sm font-bold text-[var(--text)]">Password saat ini</label>
          <input id="current-password" class="field w-full px-3" type="password" bind:value={currentPassword} autocomplete="current-password" required disabled={busy} />
        </div>
        <div>
          <label for="new-password" class="mb-2 block text-sm font-bold text-[var(--text)]">Password baru</label>
          <input id="new-password" class="field w-full px-3" type="password" bind:value={newPassword} minlength="10" maxlength="128" autocomplete="new-password" required disabled={busy} />
          <p class="mt-2 text-xs font-semibold text-[var(--faint)]">10–128 karakter.</p>
        </div>
        <div>
          <label for="confirm-password" class="mb-2 block text-sm font-bold text-[var(--text)]">Ulangi password baru</label>
          <input id="confirm-password" class="field w-full px-3" type="password" bind:value={confirmation} minlength="10" maxlength="128" autocomplete="new-password" required disabled={busy} />
        </div>

        <button class="button-primary flex w-full items-center justify-center gap-2" type="submit" disabled={busy || !currentPassword || !valid}>
          {#if busy}
            <span class="mono text-sm">Menyimpan...</span>
          {:else}
            <span>Simpan dan lanjut</span>
            <ArrowRight size={18} />
          {/if}
        </button>
      </form>
    </div>

    <p class="mt-5 flex items-center justify-center gap-2 text-center text-xs font-semibold text-[var(--faint)]">
      <LockKeyhole size={14} /> Argon2id · HttpOnly · SameSite Strict
    </p>
  </section>
</main>
