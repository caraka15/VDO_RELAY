<script lang="ts">
  import {
    Activity,
    AlertCircle,
    Camera,
    Check,
    CircleHelp,
    HardDrive,
    Mic,
    Radio,
    RefreshCw,
    ShieldCheck,
    Video,
  } from "@lucide/svelte";
  import type { StartStreamInput } from "../lib/api";
  import type { AudioCapability, VideoCapability } from "../lib/media";

  export let codecs: VideoCapability[] = [];
  export let audioCodecs: AudioCapability[] = [];
  export let devices: MediaDeviceInfo[] = [];
  export let microphoneDevices: MediaDeviceInfo[] = [];
  export let microphonePermission: "unknown" | "granted" | "denied" = "unknown";
  export let microphoneChecking = false;
  export let microphoneError = "";
  export let selectedCodec: "h264" | "h265" = "h265";
  export let detecting = false;
  export let starting = false;
  export let error = "";
  export let onDetect: () => void;
  export let onCheckMicrophone: () => void;
  export let onStart: (input: StartStreamInput & { deviceId?: string; audioDeviceId?: string }) => void;
  export let onBack: () => void;

  const resolutions = [
    { label: "1920 × 1080", width: 1920, height: 1080 },
    { label: "1280 × 720", width: 1280, height: 720 },
    { label: "854 × 480", width: 854, height: 480 },
  ];
  const fpsOptions = [24, 30, 60];
  let resolution = resolutions[0];
  let fps = 60;
  let maxBitrateKbps = 4000;
  let portraitMode = false;
  let audioEnabled = true;
  let record = false;
  let deviceId = "";
  let audioDeviceId = "";

  $: selectedCapability = codecs.find((codec) => codec.key === selectedCodec);
  $: h264 = codecs.find((codec) => codec.key === "h264");
  $: h265 = codecs.find((codec) => codec.key === "h265");
  $: audioReady = audioCodecs.some((codec) => codec.supported);
  $: estimatedHourlyGB = ((maxBitrateKbps * 1000) / 8 * 3600) / 1024 ** 3;

  function chooseCodec(codec: "h264" | "h265") {
    const capability = codecs.find((item) => item.key === codec);
    if (!capability?.supported) return;
    selectedCodec = codec;
    if (codec === "h265" && maxBitrateKbps === 7000) maxBitrateKbps = 4000;
    if (codec === "h264" && maxBitrateKbps === 4000) maxBitrateKbps = 7000;
  }

  function submit() {
    if (!selectedCapability?.supported) return;
    onStart({
      codec: selectedCodec,
      width: resolution.width,
      height: resolution.height,
      fps,
      maxBitrateKbps,
      portraitMode,
      audioEnabled: audioEnabled && audioReady,
      record,
      deviceId: deviceId || undefined,
      audioDeviceId: audioDeviceId || undefined,
    });
  }
</script>

<svelte:head>
  <title>Setup stream · VDO Relay</title>
</svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
  <header class="mb-7 flex flex-wrap items-start justify-between gap-4">
    <div>
      <p class="mono mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">NEW STREAM / 01</p>
      <h1 class="text-3xl font-extrabold tracking-tight sm:text-4xl">Siapkan output</h1>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">Pilih profile encoder di perangkat. Server hanya menerima hasil encode dan merelay ke OBS.</p>
    </div>
    <button class="button-quiet flex items-center gap-2" type="button" on:click={() => onBack()}>
      <span>Dashboard</span>
    </button>
  </header>

  {#if error}
    <div class="mb-5 flex gap-3 border border-[#844a52] bg-[#321c22] p-4 text-sm text-[var(--danger)]" role="alert">
      <AlertCircle size={19} class="mt-0.5 shrink-0" />
      <span>{error}</span>
    </div>
  {/if}

  <div class="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
    <section class="panel p-5 sm:p-6" aria-labelledby="capture-heading">
      <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div class="mb-2 flex items-center gap-2 text-[var(--accent)]"><Camera size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">Capture</span></div>
          <h2 id="capture-heading" class="text-xl font-extrabold">Sumber dan framing</h2>
        </div>
        <button class="button-secondary flex items-center gap-2" type="button" on:click={onDetect} disabled={detecting}>
          <RefreshCw size={17} class={detecting ? "animate-spin" : ""} />
          <span>{detecting ? "Mendeteksi..." : "Deteksi perangkat"}</span>
        </button>
      </div>

      <div class="space-y-5">
        <div>
          <label for="camera-device" class="mb-2 block text-sm font-bold">Kamera</label>
          <select id="camera-device" class="field w-full px-3" bind:value={deviceId}>
            {#if devices.length === 0}
              <option value="">Kamera default browser</option>
            {:else}
              {#each devices as device, index}
                <option value={device.deviceId}>{device.label || `Kamera ${index + 1}`}</option>
              {/each}
            {/if}
          </select>
          <p class="mt-2 text-xs font-semibold text-[var(--faint)]">Resolusi kamera divalidasi ulang saat Start; tidak ada fallback diam-diam.</p>
        </div>

        <fieldset>
          <legend class="mb-2 block text-sm font-bold">Mode konten</legend>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="flex min-h-[72px] cursor-pointer items-center gap-3 border p-3 transition-colors" class:border-[var(--accent)]={!portraitMode} class:bg-[var(--surface-strong)]={!portraitMode} class:border-[var(--border)]={portraitMode}>
              <input class="sr-only" type="radio" name="orientation" checked={!portraitMode} on:change={() => (portraitMode = false)} />
              <span class="flex size-9 items-center justify-center border border-[var(--border-strong)] bg-[var(--surface)]"><Video size={18} /></span>
              <span><span class="block font-bold">Landscape</span><span class="block text-xs text-[var(--muted)]">Isi frame 16:9</span></span>
              {#if !portraitMode}<Check size={17} class="ml-auto text-[var(--accent)]" />{/if}
            </label>
            <label class="flex min-h-[72px] cursor-pointer items-center gap-3 border p-3 transition-colors" class:border-[var(--accent)]={portraitMode} class:bg-[var(--surface-strong)]={portraitMode} class:border-[var(--border)]={!portraitMode}>
              <input class="sr-only" type="radio" name="orientation" checked={portraitMode} on:change={() => (portraitMode = true)} />
              <span class="flex size-9 items-center justify-center border border-[var(--border-strong)] bg-[var(--surface)]"><Activity size={18} /></span>
              <span><span class="block font-bold">Portrait content</span><span class="block text-xs text-[var(--muted)]">16:9 + bar hitam</span></span>
              {#if portraitMode}<Check size={17} class="ml-auto text-[var(--accent)]" />{/if}
            </label>
          </div>
          <p class="mt-2 text-xs font-semibold text-[var(--faint)]">Output selalu landscape 16:9. Portrait tidak memutar layout halaman dan tidak mengunci orientasi layar.</p>
        </fieldset>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label for="resolution" class="mb-2 block text-sm font-bold">Resolusi output</label>
            <select id="resolution" class="field w-full px-3" bind:value={resolution}>
              {#each resolutions as option}
                <option value={option}>{option.label}</option>
              {/each}
            </select>
          </div>
          <div>
            <label for="fps" class="mb-2 block text-sm font-bold">Frame rate</label>
            <select id="fps" class="field w-full px-3" bind:value={fps}>
              {#each fpsOptions as option}
                <option value={option}>{option} FPS</option>
              {/each}
            </select>
          </div>
        </div>
      </div>
    </section>

    <aside class="space-y-5">
      <section class="panel p-5 sm:p-6" aria-labelledby="encoder-heading">
        <div class="mb-5 flex items-center gap-2 text-[var(--accent)]"><ShieldCheck size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">Encoder</span></div>
        <h2 id="encoder-heading" class="text-xl font-extrabold">Codec untuk SRT</h2>
        <p class="mt-2 text-sm leading-6 text-[var(--muted)]">Deteksi browser menampilkan semua codec. Hanya H.264 dan H.265 yang bisa dipilih untuk output SRT v1.</p>

        <div class="mt-5 grid grid-cols-2 gap-3">
          <button class="min-h-[74px] border p-3 text-left transition-colors" class:border-[var(--accent)]={selectedCodec === "h264"} class:bg-[var(--surface-strong)]={selectedCodec === "h264"} class:border-[var(--border)]={selectedCodec !== "h264"} type="button" on:click={() => chooseCodec("h264")} disabled={!h264?.supported}>
            <span class="mono block text-sm font-extrabold">H.264</span>
            <span class="mt-1 block text-xs font-semibold" class:text-[var(--success)]={h264?.supported} class:text-[var(--faint)]={!h264?.supported}>{h264?.supported ? "tersedia" : "tidak tersedia"}</span>
          </button>
          <button class="min-h-[74px] border p-3 text-left transition-colors" class:border-[var(--accent)]={selectedCodec === "h265"} class:bg-[var(--surface-strong)]={selectedCodec === "h265"} class:border-[var(--border)]={selectedCodec !== "h265"} type="button" on:click={() => chooseCodec("h265")} disabled={!h265?.supported}>
            <span class="mono block text-sm font-extrabold">H.265</span>
            <span class="mt-1 block text-xs font-semibold" class:text-[var(--success)]={h265?.supported} class:text-[var(--faint)]={!h265?.supported}>{h265?.supported ? "tersedia" : "tidak tersedia"}</span>
          </button>
        </div>

        <div class="mt-5 border-t border-[var(--border)] pt-4">
          <p class="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-[var(--faint)]">Capability terdeteksi</p>
          <div class="flex flex-wrap gap-2">
            {#each codecs as codec}
              <span class="inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs font-bold" class:border-[#3c7154]={codec.supported} class:bg-[#1b3026]={codec.supported} class:text-[var(--success)]={codec.supported} class:border-[var(--border)]={!codec.supported} class:text-[var(--faint)]={!codec.supported}>
                {#if codec.supported}<Check size={13} />{/if}{codec.label}
              </span>
            {/each}
            {#if codecs.length === 0}<span class="text-xs font-semibold text-[var(--faint)]">Klik deteksi untuk membaca capability browser.</span>{/if}
          </div>
        </div>
      </section>

      <section class="panel p-5 sm:p-6" aria-labelledby="delivery-heading">
        <div class="mb-5 flex items-center gap-2 text-[var(--accent)]"><Radio size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">Delivery</span></div>
        <h2 id="delivery-heading" class="text-xl font-extrabold">Bitrate dan audio</h2>
        <div class="mt-5 space-y-4">
          <div>
            <label for="max-bitrate" class="mb-2 flex items-center justify-between text-sm font-bold"><span>Max bitrate</span><span class="mono text-[var(--accent)]">{maxBitrateKbps} kbps</span></label>
            <input id="max-bitrate" class="field w-full px-3" type="number" min="500" max="12000" step="100" bind:value={maxBitrateKbps} aria-describedby="bitrate-help" />
            <p id="bitrate-help" class="mt-2 text-xs font-semibold text-[var(--faint)]">Target mulai dari nilai ini. Adaptive bitrate hanya mengubah target, bukan codec, FPS, atau resolusi.</p>
          </div>

          <div>
            <div class="flex flex-col gap-2 sm:flex-row">
              <label class="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 border border-[var(--border)] bg-[var(--surface-raised)] px-3">
                <input class="size-5 accent-[var(--accent)]" type="checkbox" bind:checked={audioEnabled} disabled={!audioReady} />
                <span class="flex min-w-0 items-center gap-2"><Mic size={17} class="shrink-0" /><span class="min-w-0"><span class="block text-sm font-bold">Audio</span><span class="block truncate text-xs text-[var(--muted)]">
                  {#if !audioReady}
                    Encoder audio belum tersedia
                  {:else if microphonePermission === "granted"}
                    Mikrofon diizinkan · {microphoneDevices.length} input
                  {:else if microphonePermission === "denied"}
                    Izin mikrofon diblokir
                  {:else}
                    Mikrofon belum dicek · AAC/Opus sesuai browser
                  {/if}
                </span></span></span>
              </label>
              <button class="button-secondary min-h-[52px] shrink-0" type="button" on:click={onCheckMicrophone} disabled={microphoneChecking || detecting || starting}>
                {microphoneChecking ? "Mengecek..." : microphonePermission === "granted" ? "Cek lagi" : "Cek mic"}
              </button>
            </div>
            {#if microphoneError}
              <p class="mt-2 border border-[#844a52] bg-[#321c22] p-3 text-xs font-semibold leading-5 text-[var(--danger)]" role="alert">{microphoneError}</p>
            {:else}
              <p class="mt-2 text-xs font-semibold text-[var(--faint)]">Cek mic hanya meminta izin sebentar lalu menghentikan track; audio belum dikirim sebelum Start stream.</p>
            {/if}
            {#if microphoneDevices.length > 0}
              <div class="mt-3">
                <label for="microphone-device" class="mb-2 block text-sm font-bold">Mikrofon</label>
                <select id="microphone-device" class="field w-full px-3" bind:value={audioDeviceId}>
                  <option value="">Mikrofon default browser</option>
                  {#each microphoneDevices as device, index}
                    <option value={device.deviceId}>{device.label || `Mikrofon ${index + 1}`}</option>
                  {/each}
                </select>
              </div>
            {/if}
          </div>

          <label class="flex min-h-[52px] items-center gap-3 border border-[var(--border)] bg-[var(--surface-raised)] px-3">
            <input class="size-5 accent-[var(--accent)]" type="checkbox" bind:checked={record} />
            <span class="flex items-center gap-2"><HardDrive size={17} /><span><span class="block text-sm font-bold">Record di server</span><span class="block text-xs text-[var(--muted)]">fMP4 · segment 10 menit · retensi 24 jam</span></span></span>
          </label>
        </div>
      </section>

      <section class="border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-sm">
        <div class="flex gap-3"><CircleHelp size={18} class="mt-0.5 shrink-0 text-[var(--warning)]" /><p class="leading-6 text-[var(--muted)]">Estimasi record saat max bitrate: <strong class="mono text-[var(--text)]">{estimatedHourlyGB.toFixed(2)} GB/jam</strong>. Ukuran aktual bergantung pada isi gambar.</p></div>
      </section>
    </aside>
  </div>

  <div class="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
    <button class="button-secondary" type="button" on:click={() => onBack()}>Batalkan</button>
    <button class="button-primary flex items-center justify-center gap-2 sm:min-w-[190px]" type="button" on:click={submit} disabled={starting || detecting || !selectedCapability?.supported || (audioEnabled && !audioReady)}>
      {#if starting}
        <RefreshCw size={17} class="animate-spin" /><span>Menyiapkan...</span>
      {:else}
        <Radio size={17} /><span>Start stream</span>
      {/if}
    </button>
  </div>
</div>
