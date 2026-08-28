# VDO Relay — Product Requirements Document

Status: v1 implementation baseline

## 1. Ringkasan

VDO Relay adalah layanan web untuk mengirim kamera HP atau desktop ke server,
lalu menyediakan hasilnya sebagai input SRT untuk OBS.

Alur v1:

```text
Android Chrome / Desktop Chrome
  -> getUserMedia + WebCodecs
  -> output canvas 16:9
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
- Mempertahankan resolusi, FPS, codec, dan framing selama adaptive bitrate.
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
- Resolusi, FPS, codec, bitrate maksimum, microphone, dan framing.
- Adaptive bitrate tanpa perubahan resolusi atau FPS.
- SRT output dengan token.
- Halaman Result dengan player live, panduan OBS, SRT URL, dan HTML embed link.
- Recording fMP4 di server.
- Maksimal 8 stream aktif.

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
2. Browser meminta izin kamera dan microphone.
3. Browser mengecek dukungan codec dan konfigurasi encoder.
4. Operator memilih kamera, microphone, codec, resolusi, FPS, bitrate maksimum,
   mode portrait, dan recording.
5. Browser menjalankan preflight encode singkat dengan konfigurasi tersebut.
6. Backend membuat path MediaMTX dan token stream.
7. Browser mulai mengirim encoded media ke MediaMTX.
8. Dashboard menampilkan status dan SRT URL untuk OBS.

Kegagalan capability atau preflight harus menghentikan proses dengan pesan
yang menjelaskan penyebab dan tindakan perbaikan. Tidak boleh ada fallback
diam-diam ke resolusi, FPS, atau codec lain.

### 4.3 Live stream

Dashboard menampilkan:

- Status: `connecting`, `live`, `degraded`, `reconnecting`, atau `failed`.
- Codec, resolusi, dan FPS yang terkunci.
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

### 4.4 Menghentikan stream

1. Operator menekan `Stop`.
2. Browser menutup encoder, publisher, kamera, dan microphone.
3. Backend mencabut token.
4. Backend menghapus path MediaMTX setelah recording segment terakhir selesai.
5. SRT URL lama tidak lagi dapat digunakan.

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

`isConfigSupported()` dianggap sebagai pre-check, bukan jaminan performa.
Browser tetap harus melakukan preflight encode menggunakan kamera yang dipilih.

VP8, VP9, dan AV1 dapat ditampilkan sebagai informasi capability, tetapi tidak
dapat dipilih untuk profile SRT v1 karena output SRT MediaMTX difokuskan pada
H.264/H.265. [MoQ codecs](https://mediamtx.org/docs/publish/moq-clients) · [SRT codecs](https://mediamtx.org/docs/read/srt)

### FR-03 — Encoder settings

Pilihan v1:

- Resolusi: `1920x1080`, `1280x720`, `854x480`.
- FPS: `24`, `30`, `60`.
- Codec: H.264 atau H.265 jika preflight lulus.
- Maximum bitrate: `500–12000 kbps`.
- Audio: aktif/nonaktif.
- Audio default: AAC jika didukung, otherwise Opus.

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

### FR-05 — Framing dan orientation

- Output encoder selalu 16:9.
- Mode default adalah landscape.
- Tombol `Portrait content` mengubah framing, bukan dimensi output.
- Video portrait di-fit ke canvas 16:9 dengan black bar kiri dan kanan.
- Preview menampilkan hasil canvas final.
- Sistem tidak bergantung pada `screen.orientation.lock()`.

### FR-06 — Relay ke OBS

Setiap stream memiliki SRT read URL dengan:

- path unik;
- token random;
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
- Dashboard dapat menampilkan, men-download, dan menghapus recording.
- Jika disk hampir penuh, recording dihentikan tanpa mematikan live relay.

Recording adalah encoded master dari HP, bukan RAW sensor. MediaMTX merekam
stream ke fMP4 atau MPEG-TS tanpa kebutuhan transcoding. [MediaMTX recording](https://mediamtx.org/docs/features/record)

### FR-08 — Capacity guard

- Maksimal 8 stream aktif.
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

- Kamera atau microphone ditolak: minta permission lalu retry.
- HTTPS tidak tersedia: tampilkan instruksi domain/certificate.
- Codec tidak didukung: pilih codec atau profile lain.
- Resolusi/FPS tidak tersedia: pilih profile yang lebih rendah secara manual.
- Encoder overload: turunkan maximum bitrate atau profile secara manual.
- Transport congestion: tampilkan target bitrate yang turun.
- Transport putus: tampilkan reconnect tanpa mengubah resolusi/FPS.
- Disk hampir penuh: hentikan recording dan pertahankan relay.
- Token salah/kedaluwarsa: minta buat stream baru.
- Limit stream tercapai: tampilkan jumlah stream aktif dan stop salah satu.

## 8. Acceptance criteria

- Login default berhasil dan password wajib diganti pada login pertama.
- Password baru bertahan setelah container restart.
- Pengguna anonim tidak dapat membuat stream atau membaca SRT.
- H.264/H.265 yang lolos preflight dapat live ke MediaMTX.
- VP8/VP9/AV1 dapat dideteksi dan diberi status kompatibilitas yang benar.
- Resolusi, FPS, dan codec tidak berubah ketika adaptive bitrate aktif.
- Portrait content menghasilkan output landscape dengan black bar kiri-kanan.
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
  dicabut saat stream berhenti.
