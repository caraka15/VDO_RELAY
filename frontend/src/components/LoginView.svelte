<script lang="ts">
  import { AlertCircle, ArrowRight, LockKeyhole, Radio } from "@lucide/svelte";

  export let busy = false;
  export let error = "";
  export let onSubmit: (username: string, password: string) => void;

  let username = "admin";
  let password = "";
</script>

<svelte:head>
  <title>Masuk · VDO Relay</title>
</svelte:head>

<main class="flex min-h-dvh items-center justify-center px-5 py-10">
  <section class="w-full max-w-md">
    <div class="mb-8 flex items-center gap-3">
      <div class="flex size-11 items-center justify-center border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--accent)]" aria-hidden="true">
        <Radio size={22} strokeWidth={2.4} />
      </div>
      <div>
        <p class="mono text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">VDO / RELAY</p>
        <p class="text-sm font-semibold text-[var(--muted)]">Camera to OBS, direct path</p>
      </div>
    </div>

    <div class="panel p-6 sm:p-8">
      <div class="mb-7">
        <p class="mb-2 text-sm font-bold uppercase tracking-[0.14em] text-[var(--faint)]">Private console</p>
        <h1 class="text-3xl font-extrabold tracking-tight text-[var(--text)]">Masuk ke relay</h1>
        <p class="mt-3 text-sm leading-6 text-[var(--muted)]">Gunakan akun admin untuk membuat stream dan mengambil URL input OBS.</p>
      </div>

      {#if error}
        <div class="mb-5 flex gap-3 border border-[#844a52] bg-[#321c22] p-3 text-sm text-[var(--danger)]" role="alert">
          <AlertCircle size={18} class="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      {/if}

      <form class="space-y-5" on:submit|preventDefault={() => onSubmit(username, password)}>
        <div>
          <label for="login-username" class="mb-2 block text-sm font-bold text-[var(--text)]">Username</label>
          <input id="login-username" class="field w-full px-3" bind:value={username} autocomplete="username" required disabled={busy} />
        </div>

        <div>
          <label for="login-password" class="mb-2 block text-sm font-bold text-[var(--text)]">Password</label>
          <input id="login-password" class="field w-full px-3" type="password" bind:value={password} autocomplete="current-password" required disabled={busy} />
        </div>

        <button class="button-primary flex w-full items-center justify-center gap-2" type="submit" disabled={busy || !username || !password}>
          {#if busy}
            <span class="mono text-sm">Memeriksa...</span>
          {:else}
            <span>Masuk</span>
            <ArrowRight size={18} />
          {/if}
        </button>
      </form>
    </div>

    <p class="mt-5 flex items-center justify-center gap-2 text-center text-xs font-semibold text-[var(--faint)]">
      <LockKeyhole size={14} /> Session cookie aman · satu akun privat
    </p>
  </section>
</main>
