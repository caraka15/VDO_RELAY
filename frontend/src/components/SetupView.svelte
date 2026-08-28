<script lang="ts">
  import { Activity, AlertCircle, Camera, Check, CircleHelp, HardDrive, Mic, Radio, RefreshCw, ShieldCheck, Smartphone, Video, X, Zap } from "@lucide/svelte";
  import type { StartStreamInput } from "../lib/api";
  import {
    CAMERA_FPS_OPTIONS,
    CAMERA_RESOLUTIONS,
    probeCameraProfiles,
    probeVideoCodecs,
    type AudioCapability,
    type CameraDevice,
    type CameraProfile,
    type VideoCapability,
  } from "../lib/media";

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

  let selectedDeviceId = "";
  let selectedAudioDeviceId = "";
  let outputOrientation: "landscape" | "portrait" = "landscape";
  let resolutionKey = "";
  let fps = 30;
  let maxBitrateKbps = 4000;
  let audioEnabled = true;
  let audioCodec: "aac" | "opus" = "opus";
  let record = false;
  let cameraProfiles: CameraProfile[] = [];
  let profileChecking = false;
  let profileError = "";
  let lastProfileProbe = "";
  let profileProbeSequence = 0;
  let outputChecking = false;
  let outputSupported: boolean | null = null;
  let lastOutputProbe = "";
  let outputProbeSequence = 0;

  $: h264 = codecs.find((codec) => codec.key === "h264");
  $: h265 = codecs.find((codec) => codec.key === "h265");
  $: audioReady = audioCodecs.some((codec) => codec.supported);
  $: effectiveAudioCodec = audioCodecs.find((codec) => codec.key === audioCodec && codec.supported)?.key || audioCodecs.find((codec) => codec.supported)?.key || audioCodec;
  $: selectedAudioCapability = audioCodecs.find((codec) => codec.key === effectiveAudioCodec);
  $: if (devices.length > 0 && (!selectedDeviceId || !devices.some((device) => device.deviceId === selectedDeviceId))) selectedDeviceId = devices[0].deviceId;
  $: selectedDevice = devices.find((device) => device.deviceId === selectedDeviceId);
  $: availableResolutions = CAMERA_RESOLUTIONS.filter((resolution) => {
    const size = outputDimensions(resolution);
    return cameraProfiles.some((profile) => profile.width === size.width && profile.height === size.height);
  });
  $: if (availableResolutions.length > 0 && !availableResolutions.some((resolution) => resolutionKey === resolutionValue(resolution))) resolutionKey = resolutionValue(availableResolutions[0]);
  $: if (availableResolutions.length === 0) resolutionKey = "";
  $: selectedResolution = CAMERA_RESOLUTIONS.find((resolution) => resolutionValue(resolution) === resolutionKey);
  $: outputSize = selectedResolution ? outputDimensions(selectedResolution) : { width: 0, height: 0 };
  $: availableFps = selectedResolution
    ? CAMERA_FPS_OPTIONS.filter((value) => cameraProfiles.some((profile) => profile.width === outputSize.width && profile.height === outputSize.height && profile.fps === value))
    : [];
  $: if (availableFps.length > 0 && !availableFps.includes(fps as (typeof CAMERA_FPS_OPTIONS)[number])) fps = availableFps[0];
  $: profileSupported = Boolean(selectedResolution && availableFps.includes(fps as (typeof CAMERA_FPS_OPTIONS)[number]));
  $: outputWidth = outputSize.width;
  $: outputHeight = outputSize.height;
  $: estimatedHourlyGB = ((maxBitrateKbps * 1000) / 8 * 3600) / 1024 ** 3;
  $: outputProfileKey = `${selectedCodec}:${outputWidth}x${outputHeight}:${fps}`;
  $: if (outputProfileKey !== lastOutputProbe) {
    lastOutputProbe = outputProfileKey;
    void checkOutputProfile(outputProfileKey, selectedCodec, outputWidth, outputHeight, fps);
  }
  $: profileProbeKey = `${selectedDeviceId || "default"}:${outputOrientation}`;
  $: if (devices.length > 0 && !detecting && profileProbeKey !== lastProfileProbe) {
    lastProfileProbe = profileProbeKey;
    void checkCameraProfiles(profileProbeKey, selectedDeviceId || undefined, outputOrientation === "portrait", selectedDevice);
  }

  function outputDimensions(option: { width: number; height: number }) {
    return outputOrientation === "portrait" ? { width: option.height, height: option.width } : option;
  }

  function resolutionValue(option: { width: number; height: number }) {
    const size = outputDimensions(option);
    return `${size.width}x${size.height}`;
  }

  async function checkCameraProfiles(key: string, deviceId: string | undefined, portrait: boolean, device: CameraDevice | undefined) {
    const sequence = ++profileProbeSequence;
    profileChecking = true;
    profileError = "";
    cameraProfiles = [];
    try {
      const profiles = await probeCameraProfiles(deviceId, portrait, device);
      if (sequence !== profileProbeSequence || key !== profileProbeKey) return;
      cameraProfiles = profiles;
      if (profiles.length === 0) profileError = "Tidak ada kombinasi resolusi/FPS exact yang bisa dibuktikan dari kamera ini. Pilih kamera lain atau ubah orientasi.";
    } catch (probeError) {
      if (sequence === profileProbeSequence && key === profileProbeKey) profileError = probeError instanceof Error ? probeError.message : "Mode kamera belum bisa diperiksa.";
    } finally {
      if (sequence === profileProbeSequence && key === profileProbeKey) profileChecking = false;
    }
  }

  async function checkOutputProfile(key: string, codec: string, width: number, height: number, targetFps: number) {
    const sequence = ++outputProbeSequence;
    if (!width || !height) {
      outputChecking = false;
      outputSupported = null;
      return;
    }
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
    if (!profileSupported || outputChecking || outputSupported !== true || (audioEnabled && !selectedAudioCapability?.supported)) return;
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
      deviceId: selectedDeviceId || undefined,
      audioDeviceId: selectedAudioDeviceId || undefined,
    });
  }

  function cameraSummary(device: CameraDevice) {
    const size = device.maxWidth && device.maxHeight ? `${Math.max(device.maxWidth, device.maxHeight)} × ${Math.min(device.maxWidth, device.maxHeight)}` : "detail terbatas";
    const fpsLabel = device.maxFps ? `hingga ${Math.round(device.maxFps)} FPS` : "FPS tidak dilaporkan";
    const zoom = device.zoom ? `zoom ${device.zoom.min}–${device.zoom.max}×` : "tanpa zoom API";
    return `${size} · ${fpsLabel} · ${zoom}${device.torch ? " · flash tersedia" : ""}`;
  }
</script>

<svelte:head>
  <title>New stream · VDO Relay</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-5 pb-8 sm:px-6 sm:py-7 lg:px-8">
  <header class="mb-6 flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <p class="mono mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">NEW JOB / CAMERA MODE</p>
      <h1 class="text-3xl font-extrabold tracking-tight sm:text-4xl">Buat job stream</h1>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">Pilih orientasi dan mode kamera lebih dulu. Job hanya bisa dibuat dari mode yang benar-benar dibaca kamera; tidak ada canvas, rotate, atau fallback diam-diam.</p>
    </div>
    <button class="button-quiet flex items-center gap-2" type="button" on:click={onBack}>Dashboard</button>
  </header>

  {#if error}
    <div class="mb-5 flex gap-3 border border-[#844a52] bg-[#321c22] p-4 text-sm text-[var(--danger)]" role="alert"><AlertCircle size={19} class="mt-0.5 shrink-0" /><span>{error}</span></div>
  {/if}

  <section class="panel mb-5 p-5 sm:p-6" aria-labelledby="orientation-heading">
    <div class="mb-4 flex items-center gap-2 text-[var(--accent)]"><Video size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">STEP 01 / ORIENTATION</span></div>
    <h2 id="orientation-heading" class="text-xl font-extrabold">Orientasi frame kamera</h2>
    <p class="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">Pilihan ini menentukan ukuran frame yang diminta langsung dari kamera. Saat live orientasi dikunci; putar perangkat hanya mengubah preview, bukan isi output.</p>
    <div class="mt-5 grid gap-3 sm:grid-cols-2">
      <label class="flex min-h-[78px] cursor-pointer items-center gap-3 border p-4" class:border-[var(--accent)]={outputOrientation === "landscape"} class:bg-[var(--surface-strong)]={outputOrientation === "landscape"} class:border-[var(--border)]={outputOrientation !== "landscape"}>
        <input class="sr-only" type="radio" name="output-orientation" value="landscape" bind:group={outputOrientation} />
        <Video size={22} class="shrink-0" /><span><strong class="block text-base">Landscape</strong><span class="block text-sm text-[var(--muted)]">Lebar × tinggi · untuk HP yang dimiringkan</span></span>
      </label>
      <label class="flex min-h-[78px] cursor-pointer items-center gap-3 border p-4" class:border-[var(--accent)]={outputOrientation === "portrait"} class:bg-[var(--surface-strong)]={outputOrientation === "portrait"} class:border-[var(--border)]={outputOrientation !== "portrait"}>
        <input class="sr-only" type="radio" name="output-orientation" value="portrait" bind:group={outputOrientation} />
        <Smartphone size={22} class="shrink-0" /><span><strong class="block text-base">Portrait</strong><span class="block text-sm text-[var(--muted)]">Tinggi × lebar · untuk kamera tegak</span></span>
      </label>
    </div>
  </section>

  <div class="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(290px,0.65fr)]">
    <section class="panel p-5 sm:p-6" aria-labelledby="output-heading">
      <div class="mb-5 flex items-center gap-2 text-[var(--accent)]"><ShieldCheck size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">STEP 02 / OUTPUT</span></div>
      <h2 id="output-heading" class="text-xl font-extrabold">Codec dan mode kamera</h2>
      <p class="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">Resolusi dan FPS di sini adalah mode capture kamera sekaligus ukuran encoder. Kamera harus menghasilkan ukuran yang sama persis; browser tidak mengisi canvas dan tidak melakukan rotate.</p>

      <div class="mt-5 grid grid-cols-2 gap-3">
        <button class="min-h-[74px] border p-3 text-left transition-colors" class:border-[var(--accent)]={selectedCodec === "h264"} class:bg-[var(--surface-strong)]={selectedCodec === "h264"} class:border-[var(--border)]={selectedCodec !== "h264"} type="button" on:click={() => chooseCodec("h264")} disabled={!h264?.supported}><span class="mono block text-sm font-extrabold">H.264</span><span class="mt-1 block text-xs font-semibold" class:text-[var(--success)]={h264?.supported} class:text-[var(--faint)]={!h264?.supported}>{h264?.supported ? "terdeteksi · SRT" : "tidak terdeteksi"}</span></button>
        <button class="min-h-[74px] border p-3 text-left transition-colors" class:border-[var(--accent)]={selectedCodec === "h265"} class:bg-[var(--surface-strong)]={selectedCodec === "h265"} class:border-[var(--border)]={selectedCodec !== "h265"} type="button" on:click={() => chooseCodec("h265")} disabled={!h265?.supported}><span class="mono block text-sm font-extrabold">H.265</span><span class="mt-1 block text-xs font-semibold" class:text-[var(--success)]={h265?.supported} class:text-[var(--faint)]={!h265?.supported}>{h265?.supported ? "terdeteksi · SRT" : "tidak terdeteksi"}</span></button>
      </div>

      <div class="mt-5 grid gap-4 sm:grid-cols-2">
        <div><label for="resolution" class="mb-2 block text-sm font-bold">Resolusi kamera</label><select id="resolution" class="field w-full px-3" bind:value={resolutionKey} disabled={profileChecking || availableResolutions.length === 0}>{#if availableResolutions.length === 0}<option value="">{profileChecking ? "Memeriksa kamera..." : "Tidak ada mode terbukti"}</option>{/if}{#each availableResolutions as option}<option value={resolutionValue(option)}>{resolutionValue(option)} · {option.label}</option>{/each}</select></div>
        <div><label for="fps" class="mb-2 block text-sm font-bold">FPS kamera</label><select id="fps" class="field w-full px-3" bind:value={fps} disabled={profileChecking || availableFps.length === 0}>{#if availableFps.length === 0}<option value={fps}>{profileChecking ? "Memeriksa kamera..." : "Tidak ada FPS terbukti"}</option>{/if}{#each availableFps as option}<option value={option}>{option} FPS</option>{/each}</select></div>
      </div>

      <div class="mt-4 border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <div class="flex items-start gap-3 text-sm font-extrabold"><Camera size={17} class="mt-0.5 shrink-0 text-[var(--accent)]" /><div><p>Input terverifikasi: {outputWidth ? `${outputWidth} × ${outputHeight} · ${fps} FPS` : "belum ada"}</p><p class="mt-1 text-xs font-semibold text-[var(--muted)]">Frame kamera dikirim langsung ke encoder. Black bar desktop hanya milik kotak preview, bukan file dan bukan stream.</p></div></div>
        <div class="mt-3 flex items-start gap-2 border-t border-[var(--border)] pt-3 text-xs font-bold" aria-live="polite">
          {#if profileChecking}<Activity size={15} class="mt-0.5 shrink-0 animate-pulse text-[var(--warning)]" /><span class="text-[var(--warning)]">Menguji kombinasi kamera exact...</span>
          {:else if profileSupported}<Check size={15} class="mt-0.5 shrink-0 text-[var(--success)]" /><span class="text-[var(--success)]">Mode kamera ini terbukti tersedia.</span>
          {:else}<X size={15} class="mt-0.5 shrink-0 text-[var(--danger)]" /><span class="text-[var(--danger)]">Mode kamera belum terbukti. Pilih opsi lain.</span>{/if}
        </div>
        {#if profileError}<p class="mt-3 border border-[#844a52] bg-[#321c22] p-3 text-xs font-semibold leading-5 text-[var(--danger)]" role="alert">{profileError}</p>{/if}
        <div class="mt-3 flex items-start gap-2 border-t border-[var(--border)] pt-3 text-xs font-bold" aria-live="polite">
          {#if outputChecking}<Activity size={15} class="mt-0.5 shrink-0 animate-pulse text-[var(--warning)]" /><span class="text-[var(--warning)]">Memeriksa encoder {selectedCodec.toUpperCase()}...</span>
          {:else if outputSupported}<Check size={15} class="mt-0.5 shrink-0 text-[var(--success)]" /><span class="text-[var(--success)]">Encoder output ini mendukung mode yang dipilih.</span>
          {:else}<X size={15} class="mt-0.5 shrink-0 text-[var(--danger)]" /><span class="text-[var(--danger)]">Encoder tidak mendukung mode ini.</span>{/if}
        </div>
      </div>

      <div class="mt-5"><label for="max-bitrate" class="mb-2 flex items-center justify-between text-sm font-bold"><span>Max bitrate</span><span class="mono text-[var(--accent)]">{maxBitrateKbps} kbps</span></label><input id="max-bitrate" class="field w-full px-3" type="number" min="500" max="12000" step="100" bind:value={maxBitrateKbps} /><p class="mt-2 text-xs font-semibold text-[var(--faint)]">Target mulai dari nilai ini. Adaptive bitrate hanya mengubah bitrate, bukan resolusi, FPS, orientasi, atau codec.</p></div>
    </section>

    <aside class="space-y-5">
      <section class="panel p-5" aria-labelledby="camera-heading">
        <div class="mb-4 flex items-center justify-between gap-3"><div class="flex items-center gap-2 text-[var(--accent)]"><Camera size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">INPUT CHECK</span></div><button class="button-secondary inline-flex shrink-0 items-center gap-2" type="button" on:click={onDetect} disabled={detecting}><RefreshCw size={16} class={detecting ? "animate-spin" : ""} /><span class="hidden sm:inline">{detecting ? "Membaca..." : "Deteksi"}</span></button></div>
        <h2 id="camera-heading" class="text-xl font-extrabold">Kamera</h2>
        {#if devices.length === 0}<p class="mt-3 flex gap-2 border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs font-semibold leading-5 text-[var(--muted)]"><CircleHelp size={16} class="mt-0.5 shrink-0 text-[var(--warning)]" />Tekan Deteksi dan izinkan kamera untuk menguji resolusi/FPS.</p>{:else}<label for="setup-camera" class="mt-4 block text-sm font-bold">Sumber kamera</label><select id="setup-camera" class="field mt-2 w-full px-3" bind:value={selectedDeviceId} disabled={detecting || profileChecking}>{#each devices as device}<option value={device.deviceId}>{device.label}</option>{/each}</select>{#if selectedDevice}<p class="mono mt-2 text-[11px] font-semibold leading-5 text-[var(--muted)]">{cameraSummary(selectedDevice)}</p>{/if}{/if}
        <p class="mt-4 border-t border-[var(--border)] pt-4 text-xs font-semibold leading-5 text-[var(--muted)]">Daftar resolusi/FPS di sebelah kiri berasal dari uji exact kamera ini, bukan perkiraan dari angka maksimum.</p>
      </section>

      <section class="panel p-5" aria-labelledby="audio-heading">
        <div class="mb-4 flex items-center gap-2 text-[var(--accent)]"><Mic size={18} /><span class="mono text-xs font-bold uppercase tracking-[0.14em]">AUDIO</span></div>
        <h2 id="audio-heading" class="text-xl font-extrabold">Encoder dan input audio</h2>
        <div class="mt-4 grid grid-cols-2 gap-2">{#each audioCodecs as codec}<button class="min-h-[60px] border p-3 text-left" class:border-[var(--accent)]={effectiveAudioCodec === codec.key} class:bg-[var(--surface-strong)]={effectiveAudioCodec === codec.key} class:border-[var(--border)]={effectiveAudioCodec !== codec.key} type="button" on:click={() => chooseAudioCodec(codec.key)} disabled={!codec.supported}><span class="mono block text-sm font-extrabold">{codec.label}</span><span class="mt-1 block text-xs font-semibold" class:text-[var(--success)]={codec.supported} class:text-[var(--faint)]={!codec.supported}>{codec.supported ? "tersedia" : "tidak tersedia"}</span></button>{/each}{#if audioCodecs.length === 0}<p class="col-span-2 text-xs font-semibold text-[var(--faint)]">Audio encoder belum dilaporkan browser.</p>{/if}</div>
        <label class="mt-4 flex min-h-[52px] items-center gap-3 border border-[var(--border)] bg-[var(--surface-raised)] px-3"><input class="size-5 accent-[var(--accent)]" type="checkbox" bind:checked={audioEnabled} disabled={!audioReady} /><span><strong class="block text-sm">Kirim audio</strong><span class="block text-xs text-[var(--muted)]">{microphonePermission === "granted" ? `${microphoneDevices.length} input terdeteksi` : "Izin dicek saat tombol deteksi"}</span></span></label>
        {#if microphoneDevices.length > 0}<label for="setup-microphone" class="mt-4 block text-sm font-bold">Mikrofon</label><select id="setup-microphone" class="field mt-2 w-full px-3" bind:value={selectedAudioDeviceId} disabled={!audioEnabled}><option value="">Default mikrofon browser</option>{#each microphoneDevices as device, index}<option value={device.deviceId}>{device.label || `Mikrofon ${index + 1}`}</option>{/each}</select>{/if}
        <button class="button-quiet mt-3 w-full text-sm" type="button" on:click={onCheckMicrophone} disabled={microphoneChecking || detecting || creating}>{microphoneChecking ? "Mengecek mikrofon..." : "Cek mikrofon lagi"}</button>
        {#if microphoneError}<p class="mt-3 border border-[#844a52] bg-[#321c22] p-3 text-xs font-semibold leading-5 text-[var(--danger)]" role="alert">{microphoneError}</p>{/if}
      </section>

      <section class="space-y-4"><label class="flex min-h-[52px] items-center gap-3 border border-[var(--border)] bg-[var(--surface-raised)] px-3"><input class="size-5 accent-[var(--accent)]" type="checkbox" bind:checked={record} /><span class="flex items-center gap-2"><HardDrive size={17} /><span><strong class="block text-sm">Record di server</strong><span class="block text-xs text-[var(--muted)]">fMP4 · timestamp per sesi · retensi 24 jam</span></span></span></label><div class="border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-sm"><p class="flex gap-3 leading-6 text-[var(--muted)]"><Zap size={18} class="mt-0.5 shrink-0 text-[var(--warning)]" />Estimasi record pada max bitrate: <strong class="mono text-[var(--text)]">{estimatedHourlyGB.toFixed(2)} GB/jam</strong>.</p></div></section>
    </aside>
  </div>

  <div class="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button class="button-secondary" type="button" on:click={onBack}>Batalkan</button><button class="button-primary flex items-center justify-center gap-2 sm:min-w-[190px]" type="button" on:click={submit} disabled={creating || detecting || profileChecking || !profileSupported || outputChecking || outputSupported !== true || (audioEnabled && !selectedAudioCapability?.supported)}>{#if creating}<Activity size={17} class="animate-pulse" /><span>Membuat job...</span>{:else}<Radio size={17} /><span>Create stream</span>{/if}</button></div>
</div>
