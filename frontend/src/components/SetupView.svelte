<script lang="ts">
  import { Activity, AlertCircle, Camera, Check, CircleHelp, HardDrive, Mic, Radio, RefreshCw, ShieldCheck, Smartphone, Video, X } from "@lucide/svelte";
  import type { StartStreamInput } from "../lib/api";
  import { probeVideoCodecs, type AudioCapability, type CameraDevice, type VideoCapability } from "../lib/media";

  export let codecs: VideoCapability[] = [];
  export let audioCodecs: AudioCapability[] = [];
  export let devices: CameraDevice[] = [];
  export let microphoneDevices: MediaDeviceInfo[] = [];
  export let microphonePermission: "unknown" | "granted" | "denied" = "unknown";
  export let microphoneChecking = false;
  export let microphoneError = "";
  export let selectedCodec: "h264" | "h265" = "h265";
  export let detecting = false;
  export let creating = false;
  export let error = "";
  export let onDetect: () => void;
  export let onCheckMicrophone: () => void;
  export let onCreate: (input: StartStreamInput & { deviceId?: string; audioDeviceId?: string }) => void;
  export let onBack: () => void;

  const resolutions = [
    { label: "1080p", width: 1920, height: 1080 },
    { label: "720p", width: 1280, height: 720 },
    { label: "480p", width: 854, height: 480 },
  ];
  const fpsOptions = [24, 30, 60];
  let resolution = resolutions[0];
  let fps = 60;
  let maxBitrateKbps = 4000;
  let outputOrientation: "landscape" | "portrait" = "landscape";
  let audioEnabled = true;
  let audioCodec: "aac" | "opus" = "opus";
  let record = false;
  let outputChecking = false;
  let outputSupported: boolean | null = null;
  let lastOutputProbe = "";
  let outputProbeSequence = 0;

  $: h264 = codecs.find((codec) => codec.key === "h264");
  $: h265 = codecs.find((codec) => codec.key === "h265");
  $: audioReady = audioCodecs.some((codec) => codec.supported);
  $: effectiveAudioCodec = audioCodecs.find((codec) => codec.key === audioCodec && codec.supported)?.key || audioCodecs.find((codec) => codec.supported)?.key || audioCodec;
  $: selectedAudioCapability = audioCodecs.find((codec) => codec.key === effectiveAudioCodec);
  $: outputWidth = outputOrientation === "portrait" ? resolution.height : resolution.width;
  $: outputHeight = outputOrientation === "portrait" ? resolution.width : resolution.height;
  $: estimatedHourlyGB = ((maxBitrateKbps * 1000) / 8 * 3600) / 1024 ** 3;
  $: outputProfileKey = `${selectedCodec}:${outputWidth}x${outputHeight}:${fps}`;
  $: if (outputProfileKey && outputProfileKey !== lastOutputProbe) {
    lastOutputProbe = outputProfileKey;
    void checkOutputProfile(outputProfileKey, selectedCodec, outputWidth, outputHeight, fps);
  }

  async function checkOutputProfile(key: string, codec: string, width: number, height: number, targetFps: number) {
    const sequence = ++outputProbeSequence;
    outputChecking = true;
    outputSupported = null;
    try {
      const capabilities = await probeVideoCodecs(width, height, targetFps);
      if (sequence !== outputProbeSequence || key !== outputProfileKey) return;
      outputSupported = capabilities.some((item) => item.key === codec && item.supported && item.srtCompatible);
    } catch {
      if (sequence === outputProbeSequence && key === outputProfileKey) outputSupported = false;
    } finally {
      if (sequence === outputProbeSequence && key === outputProfileKey) outputChecking = false;
    }
  }

  function chooseCodec(codec: "h264" | "h265") {
    const capability = codecs.find((item) => item.key === codec);
    if (!capability?.supported) return;
    selectedCodec = codec;
    if (codec === "h265" && maxBitrateKbps === 7000) maxBitrateKbps = 4000;
    if (codec === "h264" && maxBitrateKbps === 4000) maxBitrateKbps = 7000;
  }

  function chooseAudioCodec(codec: "aac" | "opus") {
    if (!audioCodecs.some((item) => item.key === codec && item.supported)) return;
    audioCodec = codec;
  }

  function submit() {
    if (outputChecking || outputSupported !== true || (audioEnabled && !selectedAudioCapability?.supported)) return;
    onCreate({
      codec: selectedCodec,
      audioCodec: effectiveAudioCodec,
      width: outputWidth,
      height: outputHeight,
      fps,
      maxBitrateKbps,
      portraitMode: outputOrientation === "portrait",
      audioEnabled,
      record,
    });
  }

  function cameraSummary(device: CameraDevice) {
    const size = device.maxWidth && device.maxHeight ? `${device.maxWidth} × ${device.maxHeight}` : "detail terbatas";
    const fps = device.maxFps ? `hingga ${Math.round(device.maxFps)} FPS` : "FPS tidak dilaporkan";
    const zoom = device.zoom ? `zoom ${device.zoom.min}–${device.zoom.max}×` : "tanpa zoom API";
    return `${size} · ${fps} · ${zoom}`;
  }
</script>

<svelte:head>
  <title>New stream · VDO Relay</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-5 pb-8 sm:px-6 sm:py-7 lg:px-8">
  <header class="mb-6 flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <p class="mono mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">NEW JOB / OUTPUT</p>
      <h1 class="text-3xl font-extrabold tracking-tight sm:text-4xl">Buat job stream</h1>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">Tentukan hasil encoder terlebih dahulu. Setelah job dibuat, kamera dan mikrofon otomatis dibuka di halaman kontrol.</p>
    </div>
    <button class="button-quiet flex items-center gap-2" type="button" on:click={onBack}>Dashboard</button>
  </header>

  {#if error}
    <div class="mb-5 flex gap-3 border border-[#844a52] bg-[#321c22] p-4 text-sm text-[var(--danger)]" role="alert">
      <AlertCircle size={19} class="mt-0.5 shrink-0" />
      <span>{error}</span>
    </div>
  {/if}

  <div class="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(290px,0.65fr)]">
    <section class="panel p-5 sm:p-6" aria-labelledby="output-heading">
      <div class="mb-5 flex items-center gap-2 text-[var(--accent)]"><ShieldCheck size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">ENCODER OUTPUT</span></div>
      <h2 id="output-heading" class="text-xl font-extrabold">Hasil final yang dikirim</h2>
      <p class="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">Resolusi dan FPS di sini adalah target VideoEncoder final. Kamera boleh memiliki resolusi/FPS berbeda; browser akan mengisi canvas output ke ukuran ini.</p>

      <div class="mt-5 grid grid-cols-2 gap-3">
        <button class="min-h-[74px] border p-3 text-left transition-colors" class:border-[var(--accent)]={selectedCodec === "h264"} class:bg-[var(--surface-strong)]={selectedCodec === "h264"} class:border-[var(--border)]={selectedCodec !== "h264"} type="button" on:click={() => chooseCodec("h264")} disabled={!h264?.supported}>
          <span class="mono block text-sm font-extrabold">H.264</span>
          <span class="mt-1 block text-xs font-semibold" class:text-[var(--success)]={h264?.supported} class:text-[var(--faint)]={!h264?.supported}>{h264?.supported ? "terdeteksi; profile dicek" : "tidak terdeteksi"}</span>
        </button>
        <button class="min-h-[74px] border p-3 text-left transition-colors" class:border-[var(--accent)]={selectedCodec === "h265"} class:bg-[var(--surface-strong)]={selectedCodec === "h265"} class:border-[var(--border)]={selectedCodec !== "h265"} type="button" on:click={() => chooseCodec("h265")} disabled={!h265?.supported}>
          <span class="mono block text-sm font-extrabold">H.265</span>
          <span class="mt-1 block text-xs font-semibold" class:text-[var(--success)]={h265?.supported} class:text-[var(--faint)]={!h265?.supported}>{h265?.supported ? "terdeteksi; profile dicek" : "tidak terdeteksi"}</span>
        </button>
      </div>

      <div class="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label for="resolution" class="mb-2 block text-sm font-bold">Resolusi output</label>
          <select id="resolution" class="field w-full px-3" bind:value={resolution}>
            {#each resolutions as option}
              <option value={option}>{outputOrientation === "portrait" ? `${option.height} × ${option.width}` : `${option.width} × ${option.height}`} · {option.label}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="fps" class="mb-2 block text-sm font-bold">FPS output</label>
          <select id="fps" class="field w-full px-3" bind:value={fps}>
            {#each fpsOptions as option}<option value={option}>{option} FPS</option>{/each}
          </select>
        </div>
      </div>

      <div class="mt-4">
        <label for="max-bitrate" class="mb-2 flex items-center justify-between text-sm font-bold"><span>Max bitrate</span><span class="mono text-[var(--accent)]">{maxBitrateKbps} kbps</span></label>
        <input id="max-bitrate" class="field w-full px-3" type="number" min="500" max="12000" step="100" bind:value={maxBitrateKbps} />
        <p class="mt-2 text-xs font-semibold text-[var(--faint)]">Target mulai dari nilai ini. Adaptive bitrate hanya menurunkan/menaikkan target, bukan resolusi, FPS, atau codec.</p>
      </div>

      <fieldset class="mt-5 md:hidden">
        <legend class="mb-2 block text-sm font-bold">Bentuk output awal</legend>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex min-h-[68px] cursor-pointer items-center gap-3 border p-3" class:border-[var(--accent)]={outputOrientation === "landscape"} class:bg-[var(--surface-strong)]={outputOrientation === "landscape"} class:border-[var(--border)]={outputOrientation !== "landscape"}>
            <input class="sr-only" type="radio" name="output-orientation" value="landscape" bind:group={outputOrientation} />
            <Video size={18} class="shrink-0" /><span><strong class="block">Landscape</strong><span class="block text-xs text-[var(--muted)]">{resolution.width} × {resolution.height}</span></span>
          </label>
          <label class="flex min-h-[68px] cursor-pointer items-center gap-3 border p-3" class:border-[var(--accent)]={outputOrientation === "portrait"} class:bg-[var(--surface-strong)]={outputOrientation === "portrait"} class:border-[var(--border)]={outputOrientation !== "portrait"}>
            <input class="sr-only" type="radio" name="output-orientation" value="portrait" bind:group={outputOrientation} />
            <Smartphone size={18} class="shrink-0" /><span><strong class="block">Portrait</strong><span class="block text-xs text-[var(--muted)]">{resolution.height} × {resolution.width}</span></span>
          </label>
        </div>
      </fieldset>

      <div class="mt-5 border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <p class="flex items-center gap-2 text-sm font-extrabold"><Radio size={17} class="text-[var(--accent)]" /> Output {outputWidth} × {outputHeight} · {fps} FPS</p>
        <p class="mt-1 text-xs font-semibold leading-5 text-[var(--muted)]">{outputOrientation === "portrait" ? "Portrait dikunci sebagai ukuran file. Framing dapat diubah ke landscape dengan bar hitam atas-bawah." : "Landscape dikunci sebagai ukuran file. Framing dapat diubah ke portrait dengan bar hitam kiri-kanan."}</p>
        <div class="mt-3 flex items-start gap-2 border-t border-[var(--border)] pt-3 text-xs font-bold" aria-live="polite">
          {#if outputChecking}
            <Activity size={15} class="mt-0.5 shrink-0 animate-pulse text-[var(--warning)]" /><span class="text-[var(--warning)]">Memeriksa encoder untuk profile ini...</span>
          {:else if outputSupported}
            <Check size={15} class="mt-0.5 shrink-0 text-[var(--success)]" /><span class="text-[var(--success)]">Profile output ini lolos preflight browser.</span>
          {:else}
            <X size={15} class="mt-0.5 shrink-0 text-[var(--danger)]" /><span class="text-[var(--danger)]">Profile ini tidak didukung encoder browser. Pilih codec, resolusi, atau FPS lain.</span>
          {/if}
        </div>
      </div>
    </section>

    <aside class="space-y-5">
      <section class="panel p-5" aria-labelledby="audio-heading">
        <div class="mb-4 flex items-center gap-2 text-[var(--accent)]"><Mic size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">AUDIO</span></div>
        <h2 id="audio-heading" class="text-xl font-extrabold">Encoder dan input audio</h2>
        <div class="mt-4 grid grid-cols-2 gap-2">
          {#each audioCodecs as codec}
            <button class="min-h-[60px] border p-3 text-left" class:border-[var(--accent)]={effectiveAudioCodec === codec.key} class:bg-[var(--surface-strong)]={effectiveAudioCodec === codec.key} class:border-[var(--border)]={effectiveAudioCodec !== codec.key} type="button" on:click={() => chooseAudioCodec(codec.key)} disabled={!codec.supported}>
              <span class="mono block text-sm font-extrabold">{codec.label}</span>
              <span class="mt-1 block text-xs font-semibold" class:text-[var(--success)]={codec.supported} class:text-[var(--faint)]={!codec.supported}>{codec.supported ? "tersedia" : "tidak tersedia"}</span>
            </button>
          {/each}
          {#if audioCodecs.length === 0}<p class="col-span-2 text-xs font-semibold text-[var(--faint)]">Audio encoder belum dilaporkan browser.</p>{/if}
        </div>
        <label class="mt-4 flex min-h-[52px] items-center gap-3 border border-[var(--border)] bg-[var(--surface-raised)] px-3">
          <input class="size-5 accent-[var(--accent)]" type="checkbox" bind:checked={audioEnabled} disabled={!audioReady} />
          <span><strong class="block text-sm">Kirim audio</strong><span class="block text-xs text-[var(--muted)]">{microphonePermission === "granted" ? `${microphoneDevices.length} input terdeteksi` : "Izin dicek saat tombol deteksi"}</span></span>
        </label>
        <p class="mt-3 text-xs font-semibold leading-5 text-[var(--faint)]">Track mikrofon akan dicek ulang setelah job dibuat. Di halaman live tersedia indikator track dan level suara.</p>
      </section>

      <section class="panel p-5" aria-labelledby="inputs-heading">
        <div class="mb-4 flex items-center gap-2 text-[var(--accent)]"><Camera size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">INPUT CHECK</span></div>
        <div class="flex items-start justify-between gap-3">
          <div><h2 id="inputs-heading" class="text-xl font-extrabold">Perangkat tersedia</h2><p class="mt-1 text-xs font-semibold leading-5 text-[var(--muted)]">Ini kemampuan sumber kamera, bukan target output encoder.</p></div>
          <button class="button-secondary inline-flex shrink-0 items-center gap-2" type="button" on:click={onDetect} disabled={detecting}><RefreshCw size={16} class={detecting ? "animate-spin" : ""} /><span class="hidden sm:inline">{detecting ? "Membaca..." : "Deteksi"}</span></button>
        </div>
        {#if devices.length === 0}
          <p class="mt-4 flex gap-2 border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs font-semibold leading-5 text-[var(--muted)]"><CircleHelp size={16} class="mt-0.5 shrink-0 text-[var(--warning)]" />Belum ada kamera yang dibaca. Tekan Deteksi dan izinkan kamera.</p>
        {:else}
          <div class="mt-4 max-h-48 space-y-2 overflow-y-auto pr-1">
            {#each devices as device}
              <div class="border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                <p class="flex items-center gap-2 text-sm font-bold"><Video size={15} class="shrink-0 text-[var(--accent)]" />{device.label}</p>
                <p class="mono mt-1 text-[11px] font-semibold text-[var(--muted)]">{cameraSummary(device)}</p>
              </div>
            {/each}
          </div>
        {/if}
        <div class="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-4 text-xs font-bold"><span class="inline-flex items-center gap-2"><Mic size={15} />Mikrofon</span><span class:text-[var(--success)]={microphonePermission === "granted"} class:text-[var(--danger)]={microphonePermission === "denied"} class="text-[var(--muted)]">{#if microphoneChecking}memeriksa{:else if microphonePermission === "granted"}{microphoneDevices.length} input{:else if microphonePermission === "denied"}ditolak{:else}belum dicek{/if}</span></div>
        <button class="button-quiet mt-3 w-full text-sm" type="button" on:click={onCheckMicrophone} disabled={microphoneChecking || detecting || creating}>{microphoneChecking ? "Mengecek mikrofon..." : "Cek mikrofon lagi"}</button>
        {#if microphoneError}<p class="mt-3 border border-[#844a52] bg-[#321c22] p-3 text-xs font-semibold leading-5 text-[var(--danger)]" role="alert">{microphoneError}</p>{/if}
      </section>

      <section class="space-y-4">
        <label class="flex min-h-[52px] items-center gap-3 border border-[var(--border)] bg-[var(--surface-raised)] px-3">
          <input class="size-5 accent-[var(--accent)]" type="checkbox" bind:checked={record} />
          <span class="flex items-center gap-2"><HardDrive size={17} /><span><strong class="block text-sm">Record di server</strong><span class="block text-xs text-[var(--muted)]">fMP4 · timestamp per sesi · retensi 24 jam</span></span></span>
        </label>
        <div class="border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-sm"><p class="flex gap-3 leading-6 text-[var(--muted)]"><CircleHelp size={18} class="mt-0.5 shrink-0 text-[var(--warning)]" />Estimasi record pada max bitrate: <strong class="mono text-[var(--text)]">{estimatedHourlyGB.toFixed(2)} GB/jam</strong>.</p></div>
      </section>
    </aside>
  </div>

  <div class="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
    <button class="button-secondary" type="button" on:click={onBack}>Batalkan</button>
    <button class="button-primary flex items-center justify-center gap-2 sm:min-w-[190px]" type="button" on:click={submit} disabled={creating || detecting || outputChecking || outputSupported !== true || (audioEnabled && !selectedAudioCapability?.supported)}>
      {#if creating}<Activity size={17} class="animate-pulse" /><span>Membuat job...</span>{:else}<Radio size={17} /><span>Create stream</span>{/if}
    </button>
  </div>
</div>
