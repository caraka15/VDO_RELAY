# VDO Relay — Product Requirements Document

Status: v1 implementation baseline

## 1. Ringkasan

VDO Relay adalah layanan web untuk mengirim kamera HP atau desktop ke server,
lalu menyediakan hasilnya sebagai input SRT untuk OBS.

Alur v1:

```text
Android Chrome / Desktop Chrome
  -> getUserMedia + WebCodecs
  -> direct camera track dengan orientasi/resolusi/FPS exact
  -> Media-over-QUIC/WebTransport
  -> MediaMTX
  -> SRT read URL
  -> OBS
```

Browser tidak mengirim SRT langsung. SRT adalah output server untuk OBS.
Server menerima video yang sudah encoded dari perangkat dan tidak melakukan
video transcoding.

MediaMTX dipilih karena sudah menyediakan Media-over-QUIC, SRT, recording,
authentication, dan Control API. [MediaMTX overview](https://mediamtx.org/docs/kickoff/introduction)

## 2. Tujuan

- Mengirim beberapa sumber kamera ke OBS melalui jaringan internet.
- Menjalankan seluruh encoding kamera di HP atau desktop.
- Mempertahankan resolusi, FPS, codec, dan orientasi selama adaptive bitrate.
- Menyediakan SRT dengan latency default sekitar 2 detik.
- Mencegah penggunaan server oleh pihak yang tidak login.
- Menyediakan recording server yang opsional dan default-nya nonaktif.
- Menjalankan seluruh aplikasi dalam satu Docker container.

## 3. Batas scope v1

Termasuk:

- Satu akun operator.
- Android Chrome dan desktop Chrome.
- H.264 dan H.265 sebagai codec video yang dapat dipakai untuk output SRT.
- Deteksi H.264, H.265, VP8, VP9, dan AV1.
- Orientasi, resolusi, FPS, codec, bitrate maksimum, microphone, dan pilihan kamera.
- Adaptive bitrate tanpa perubahan resolusi atau FPS.
- SRT output dengan token.
- Halaman Result dengan player live, panduan OBS, SRT URL, dan HTML embed link.
- Recording fMP4 di server.
- Maksimal 8 job terbuka.

Tidak termasuk:

- Aplikasi Android/iOS native.
- Direct SRT publishing dari browser.
- iPhone Safari sebagai target yang dijamin.
- Server-side video transcoding.
- Multi-user, billing, CDN, dan public registration.
- RTSP, RTMP, HLS, dan WebRTC output pada UI v1.

Jika direct SRT dari HP menjadi syarat, scope harus berubah menjadi client
native. Browser tidak memiliki akses UDP/SRT mentah.

## 4. Pengguna dan alur utama

### 4.1 Login pertama

1. Operator membuka URL HTTPS.
2. Operator login dengan akun awal `admin/admin`.
3. Sistem memaksa operator mengganti password.
4. Password baru disimpan sebagai hash Argon2id di SQLite.

### 4.2 Membuat stream

1. Operator memilih `New stream`.
2. Browser meminta izin kamera/mikrofon dan mengecek dukungan encoder video/audio.
3. Operator memilih orientasi, kamera, codec video/audio, resolusi/FPS kamera,
   bitrate maksimum, dan recording. Resolusi/FPS hanya berisi mode kamera yang
   lulus uji exact.
4. Tombol `Create stream` melakukan preflight encoder dan kamera sebelum backend
   membuat path, token, SRT URL, dan job berstatus `ready`.
5. Setelah job berhasil dibuat, halaman kontrol menampilkan kamera standby.
   Tombol Start baru membuka kamera/microphone dan memulai publisher. Jika input
   gagal dibuka, job tetap ada dan tombol Start dapat dicoba lagi.
6. Halaman kontrol menampilkan preview kamera langsung, status track audio,
   level audio, kontrol kamera yang didukung perangkat, dan telemetry.

Kegagalan capability atau preflight harus menghentikan proses dengan pesan
yang menjelaskan penyebab dan tindakan perbaikan. Tidak boleh ada fallback
diam-diam ke resolusi, FPS, atau codec lain.

### 4.3 Live stream

Dashboard menampilkan:

- Status: `ready`, `connecting`, `live`, `reconnecting`, atau `failed`.
- Codec, resolusi, dan FPS sesi saat ini.
- Bitrate maksimum yang dipilih.
- Target bitrate saat ini.
- Bitrate yang diterima server.
- Jumlah reader SRT.
- Status recording.
- Estimasi ukuran recording.
- Tombol copy SRT URL.

Jika jaringan menurun, target bitrate boleh turun bertahap. Resolusi, FPS, dan
codec tetap sama. Jika transport gagal, preview dan output OBS boleh freeze atau
terputus, lalu UI menunjukkan reconnect/error.

### 4.4 Stop relay, keluar, dan hapus job

1. `Stop relay` menutup encoder, publisher, kamera, dan microphone lokal,
   menandai job `stopped`, dan melepas path aktif di MediaMTX. Token server
   tetap dipertahankan agar job dapat dipakai lagi.
2. Profile resolusi/FPS tidak diubah dari halaman live. Untuk mode berbeda,
   operator membuat job baru; job lama tetap dapat dipakai lagi.
3. Tombol `Kembali ke Home` hanya meninggalkan halaman live setelah relay
   dihentikan; job tetap tersimpan dan dapat dibuka kembali dari dashboard.
4. `Delete` adalah satu-satunya aksi permanen: menghapus job, mencabut token,
   dan menghapus path MediaMTX. Recording yang sudah ada tetap dikelola dari
   halaman recording.

## 5. Persyaratan fungsional

### FR-01 — Authentication

- Semua route dashboard membutuhkan session cookie.
- Session cookie harus `HttpOnly`, `Secure`, dan `SameSite=Strict`.
- Password tidak boleh disimpan plaintext.
- Login gagal harus memiliki rate limit sederhana.
- Hanya satu akun operator pada v1.

### FR-02 — Capability detection

Browser mengecek dukungan `VideoEncoder.isConfigSupported()` untuk:

- H.265;
- H.264;
- VP9;
- VP8;
- AV1.

`isConfigSupported()` dianggap sebagai probe encoder umum, bukan daftar profile
kamera, jaminan hardware encoder, atau jaminan performa. UI harus menyebut
resolusi/FPS yang dipakai probe dan tidak boleh melabeli seluruh profile kamera
sebagai tersedia.

Create dan setiap Start harus memeriksa konfigurasi encoder pilihan dengan ukuran
dan FPS kamera yang sebenarnya. Preflight Create menguji kombinasi kamera exact
dengan `resizeMode: none`, lalu membandingkan `getSettings()` dengan profile yang
dipilih. Start mengulang validasi tersebut sebelum publisher berjalan. Tidak ada
canvas, resize, rotate, pacing, atau fallback diam-diam pada jalur video.
Kegagalan preflight Create tidak boleh mengirim `POST /api/streams`.

VP8, VP9, dan AV1 dapat ditampilkan sebagai informasi capability, tetapi tidak
dapat dipilih untuk profile SRT v1 karena output SRT MediaMTX difokuskan pada
H.264/H.265. [MoQ codecs](https://mediamtx.org/docs/publish/moq-clients) · [SRT codecs](https://mediamtx.org/docs/read/srt)

### FR-03 — Encoder settings

Pilihan v1:

- Resolusi output landscape: `1920x1080`, `1280x720`, `854x480`.
- Resolusi output portrait: pasangan terbalik dari profile di atas.
- FPS: `24`, `30`, `60`.
- Codec: H.264 atau H.265 jika preflight lulus.
- Audio codec: AAC atau Opus jika preflight lulus.
- Maximum bitrate: `500–12000 kbps`.
- Audio: aktif/nonaktif.
- Audio default: Opus jika didukung, atau AAC sebagai fallback.

Default profile:

- H.265: 1920x1080, 60 FPS, 4000 kbps.
- H.264: 1920x1080, 60 FPS, 7000 kbps.

Nilai maximum bitrate adalah target awal dan batas policy aplikasi, bukan
garansi hard CBR pada setiap frame. WebCodecs menerima satu bitrate target,
bukan pasangan minimum/maksimum. [WebCodecs configuration](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder/isConfigSupported_static)

### FR-04 — Adaptive bitrate

- Target awal sama dengan maximum bitrate.
- Tekanan encoder atau transport selama beberapa detik menurunkan target 20%.
- Kondisi stabil menaikkan target perlahan sampai maximum.
- Floor teknis internal: `max(256 kbps, 25% dari maximum)`.
- Ketika floor tetap tidak cukup, status menjadi `reconnecting` atau `failed`.
- Tidak ada penurunan resolusi, FPS, atau codec otomatis.
- Bitrate rendah karena scene sederhana tidak otomatis dianggap koneksi gagal.

### FR-05 — Orientasi dan layout kamera

- Orientasi awal (landscape atau portrait) dikunci ketika job dibuat.
- Resolusi dan FPS harus berasal dari mode kamera exact yang sesuai orientasi.
- Desktop selalu menggunakan box preview landscape 16:9. Jika source portrait,
  ruang hitam kiri/kanan hanya berada di preview desktop dan tidak masuk encode.
- Tidak ada tombol rotate, framing, black bar output, canvas, atau gyro auto-rotate
  pada v1.
- Mobile live page tidak scroll: preview memenuhi layar dan bottom navigation
  selalu berada di bawah safe area.
- Preview mobile boleh memakai CSS rotate untuk membuat source landscape tampil
  seperti aplikasi kamera dengan sisi kanan berada di atas. CSS ini hanya preview,
  tidak mengubah frame yang dikirim ke encoder.
- Status publisher, kamera, microphone, dan orientasi locked ditampilkan di dua
  sudut atas preview.
- Settings mobile berbentuk panel solid dan berisi kamera, mikrofon, flash/torch,
  zoom bila didukung, profile read-only, Result, dan Home.

### FR-06 — Relay ke OBS

Setiap stream memiliki SRT read URL dengan:

- path unik;
- token stabil per job yang diturunkan dari secret server;
- latency `2000000` microseconds;
- `pkt_size=1316`.

Contoh format:

```text
srt://host:8890?streamid=read:<path>:user:<token>&latency=2000000&pkt_size=1316
```

OBS menggunakan URL tersebut sebagai input MPEG-TS/SRT. [OBS SRT guide](https://obsproject.com/kb/srt-protocol-streaming-guide)

### FR-07 — Recording

- Toggle recording berada di form sebelum Start.
- Default recording adalah `off`.
- Recording dilakukan MediaMTX di server.
- Format default adalah fMP4.
- Segment duration: 10 menit.
- Part duration: 1 detik.
- Retention default: 24 jam.
- Recording aktif hanya untuk stream yang dipilih operator.
- Nama segment memakai `%Y-%m-%d_%H-%M-%S-%f`, sehingga setiap sesi/reconnect
  menghasilkan file bertimestamp dan tidak menimpa file sebelumnya.
- Dashboard dapat menampilkan, men-download, dan menghapus recording.
- Jika disk hampir penuh, recording dihentikan tanpa mematikan live relay.

Recording adalah encoded master dari HP, bukan RAW sensor. MediaMTX merekam
stream ke fMP4 atau MPEG-TS tanpa kebutuhan transcoding. [MediaMTX recording](https://mediamtx.org/docs/features/record)

### FR-08 — Capacity guard

- Maksimal 8 job terbuka (`ready` atau `live`).
- Setiap stream maksimal satu SRT reader.
- Request stream ke-9 ditolak dengan error yang jelas.
- Kapasitas dapat dinaikkan setelah stress test, bukan otomatis saat runtime.

Limit awal mengikuti server 2 vCPU/2 GB dengan asumsi satu output SRT per
stream. Jumlah reader menambah outbound bandwidth dan dapat menurunkan jumlah
stream yang aman. MediaMTX menyatakan relay tanpa re-encoding umumnya lebih
dibatasi bandwidth daripada CPU/RAM, tetapi kapasitas akhir harus diuji pada
infrastruktur nyata. [MediaMTX scalability](https://mediamtx.org/docs/features/scalability)

## 6. Persyaratan UI/UX

Gaya visual: flat dark operator console.

- Background dan panel harus solid, tanpa semi-transparansi.
- Tidak memakai glassmorphism, gradient dekoratif, atau blur dekoratif.
- Border tipis dengan warna muted.
- Heading tebal, body text jelas, angka dan URL memakai monospace.
- Satu primary action per layar.
- Tidak memakai emoji sebagai icon; gunakan package icon konsisten (`@lucide/svelte`).
- Mobile-first, tetapi dashboard tetap nyaman pada desktop.
- Tidak boleh ada horizontal scroll pada lebar 375px.
- Semua tombol dan input minimal 44px.
- Form memiliki label terlihat, helper text, validasi inline, dan error dekat field.
- Focus keyboard harus terlihat.
- Status tidak boleh disampaikan melalui warna saja; gunakan label/icon/text.
- Gunakan `min-height: 100dvh`, safe-area padding, dan dukungan reduced motion.
- Animasi hanya untuk feedback state, 150–300ms, dan tidak boleh menggeser layout.

## 7. Error dan recovery

Pesan error harus menyebutkan penyebab dan tindakan:

- Kamera atau microphone ditolak: minta permission lalu retry dari halaman live.
- Tombol `Cek mic` harus membuka permission microphone secara langsung,
  menampilkan input audio yang terdeteksi, dan memberi instruksi izin Chrome.
- HTTPS tidak tersedia: tampilkan instruksi domain/certificate.
- Codec tidak didukung: pilih codec atau profile lain.
- Output encoder tidak tersedia: pilih codec, resolusi, atau FPS yang didukung.
- Encoder overload: turunkan maximum bitrate atau profile secara manual.
- Transport congestion: tampilkan target bitrate yang turun.
- Transport putus: tampilkan reconnect tanpa mengubah resolusi/FPS.
- Disk hampir penuh: hentikan recording dan pertahankan relay.
- Token salah/kedaluwarsa: buka job yang valid atau buat job baru.
- Limit stream tercapai: tampilkan jumlah job aktif dan sarankan Stop salah satu.

## 8. Acceptance criteria

- Login default berhasil dan password wajib diganti pada login pertama.
- Password baru bertahan setelah container restart.
- SQLite dan recording tetap ada setelah image/container di-rebuild karena
  `/data` di-bind mount ke folder host.
- Pengguna anonim tidak dapat membuat stream atau membaca SRT.
- `Create stream` menguji konfigurasi output encoder sebelum API membuat job;
  profile yang gagal tidak meninggalkan job server.
- Stop/Start relay mempertahankan path, token read, profile, dan SRT URL yang sama.
- Job stopped maupun aktif dapat dibuka kembali dari dashboard setelah refresh/
  backend restart.
- Delete menghapus job dan membuat token/SRT URL lama tidak valid; Stop dan
  Kembali ke Home tidak menghapus job.
- H.264/H.265 yang lolos preflight dapat live ke MediaMTX.
- VP8/VP9/AV1 dapat dideteksi dan diberi status kompatibilitas yang benar.
- Resolusi, FPS, dan codec tidak berubah ketika adaptive bitrate aktif.
- Preview desktop portrait pada box landscape memiliki ruang hitam kiri-kanan;
  ruang tersebut tidak masuk ke encoded output.
- Preview mobile mengikuti layout kamera dan CSS rotate hanya untuk tampilan.
- Capability tiap kamera menampilkan ukuran maksimum, FPS maksimum, dan status
  zoom API bila browser melaporkannya.
- Audio track yang benar-benar aktif terlihat sebagai status dan level meter di
  halaman live.
- Mode kamera yang tidak lulus uji exact tidak muncul sebagai pilihan resolusi/FPS.
- Tidak ada pembuatan canvas atau `canvas.captureStream()` pada bundle frontend.
- SRT token valid dapat dibaca OBS dengan latency sekitar 2 detik.
- SRT token salah ditolak.
- Record off tidak membuat file.
- Record on membuat fMP4 dan file dapat di-download.
- Mengaktifkan recording per stream tidak me-restart MediaMTX.
- Delapan stream dengan satu SRT reader per stream dapat diuji tanpa disconnect
  selama 10 menit pada profile target.
- UI lulus pemeriksaan 375px portrait, portrait device, dan desktop landscape.

## 9. Asumsi dan risiko

- HTTPS dengan domain valid adalah prasyarat produksi.
- H.265 tidak selalu tersedia atau efisien pada semua perangkat Chrome.
- Browser dapat melaporkan codec supported tetapi tetap gagal saat panas,
  battery saver, atau konfigurasi aktual perangkat.
- 0,5 MB/s kira-kira 4 Mbps dan harus mencakup audio serta overhead transport.
- Recording 4 Mbps menghabiskan kira-kira 1,8 GB per jam per stream.
- SRT URL mengandung bearer token; token hanya ditampilkan setelah login dan
  dicabut saat job dihapus permanen, bukan saat relay di-Stop atau halaman
  ditutup.
