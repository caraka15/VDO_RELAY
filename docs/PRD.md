# PRD — VDO Relay

## 1. Tujuan

Menyediakan satu dashboard private untuk membuka kamera HP/desktop dari
Chrome, mengirim video dan audio ke server, lalu memberi URL SRT yang dapat
langsung dipakai OBS. Server hanya menerima, merelay, merekam bila diminta,
dan mengeluarkan SRT. Server tidak mentranscode video.

## 2. Keputusan transport

```text
getUserMedia
  -> MediaStream track native
  -> WebRTC / WHIP
  -> MediaMTX
  -> SRT read / OBS
```

WHIP dipilih untuk browser karena browser sudah menyediakan negotiation codec,
ICE, congestion control, packetization, dan koneksi WebRTC. Client frontend
melakukan retry session bila koneksi WHIP putus. V1 tidak memakai MoQ,
WebTransport, WebCodecs, canvas capture, atau framing protokol custom.

Referensi: [MediaMTX WebRTC clients](https://mediamtx.org/docs/publish/webrtc-clients),
[MediaMTX SRT](https://mediamtx.org/docs/read/srt).

## 3. Pengguna dan akses

- Target browser: Android Chrome dan desktop Chrome.
- iPhone Safari belum menjadi target terjamin.
- Satu akun awal `admin/admin`; login pertama wajib mengganti password.
- Session cookie `HttpOnly`, `Secure`, `SameSite=Strict`.
- Dashboard hanya untuk operator terautentikasi.
- Maksimum awal 8 job open.
- Satu job maksimum 10 reader gabungan, termasuk OBS melalui SRT dan player
  browser melalui WHEP.

## 4. Alur UX

### Membuat job

1. Operator memilih orientasi capture: landscape atau portrait.
2. Operator menekan Deteksi dan memberi izin kamera serta mikrofon.
3. Sistem menampilkan kamera yang ditemukan, kemampuan maksimum, zoom, dan
   torch bila dilaporkan browser.
4. Sistem menguji kombinasi resolusi/FPS dengan constraint `exact` pada kamera
   yang dipilih.
5. Hanya kombinasi yang benar-benar berhasil dibuka yang ditampilkan.
6. Operator memilih codec WebRTC yang tersedia, audio Opus, max bitrate, dan
   optional recording.
7. `Create stream` membuat job/path/token saja; kamera belum dimulai.

### Menjalankan job

1. Halaman live menampilkan preview standby.
2. Operator menekan `Start`.
3. Browser membuka kamera/mikrofon lagi dengan profile exact yang tersimpan.
4. `getSettings()` diverifikasi agar ukuran/FPS aktual cocok; tidak ada
   fallback, resize, rotate, atau canvas.
5. Browser membuat peer connection dan mengirim SDP WHIP ke MediaMTX.
6. Setelah WebRTC connected, MediaMTX path menjadi live.
7. `Stop` menghentikan track dan sesi WHIP, tetapi job tetap tersedia di Home.
8. Start ulang memakai path, token, dan SRT URL yang sama.
9. `Delete` menghapus job dan mencabut akses token secara permanen.

### Live mobile

- Satu halaman tanpa scroll.
- Preview memenuhi layar dengan stage portrait seperti aplikasi kamera.
- Bottom navigation: mute, Start/Stop, Settings.
- Status LIVE/READY, orientasi source, orientasi lock, dan status mikrofon
  berada di dalam stage.
- Track landscape dapat diputar dengan CSS untuk kenyamanan melihat layar HP;
  transform preview tidak pernah masuk ke media yang dikirim.
- Pada desktop stage selalu landscape 16:9. Video portrait akan memiliki ruang
  hitam di kiri/kanan hanya di preview desktop, bukan di file.

## 5. Media profile

### Video

- Resolusi dan FPS adalah mode capture kamera serta dimensi final encoded track.
- Probe memulai dari 1920×1080, 1280×720, dan 854×480 pada FPS 24/30/60,
  lalu menambahkan ukuran/FPS default dan maksimum yang dilaporkan kamera.
- Preset diuji dengan constraint `exact`; detector juga membuka satu stream
  native dengan `resizeMode: none` pada ukuran maksimum/default yang dilaporkan.
  Hanya mode yang menghasilkan ukuran/FPS aktual yang jelas dari
  `getSettings()` yang ditampilkan. Karena itu mode native seperti 2304×1728
  juga dapat dipilih bila memang tersedia.
- Portrait mencoba pasangan dimensi portrait, tetapi jika kamera hanya
  menyediakan sensor native landscape, mode native tersebut tetap dipakai dan
  ditampilkan. Tidak ada rotate atau canvas baru.
- Nilai bitrate di UI adalah batas maksimum encoder WebRTC.
- WebRTC boleh mengirim bitrate aktual lebih rendah karena scene atau network;
  aplikasi tidak menjalankan adaptive controller buatan sendiri.
- Resolusi, FPS, dan codec tidak turun diam-diam.

### Codec

- Capability probe memakai `RTCRtpSender.getCapabilities("video")`.
- Hasil probe berarti codec tersedia pada browser/WebRTC, bukan bukti bahwa
  browser pasti memakai hardware encoder.
- Browser tidak memiliki API standar untuk membuktikan hardware-only.
- Bila hardware encoder wajib dijamin, produk harus memakai aplikasi native
  Android Camera2/MediaCodec.
- V1 SRT memilih H.264 atau H.265. VP8/VP9/AV1 dapat ditampilkan sebagai
  capability browser tetapi tidak dipakai untuk output SRT v1.
- H.265 bergantung pada browser, OS, dan GPU yang kompatibel.

### Audio

- Browser publisher menggunakan audio track native dan codec Opus WebRTC.
- Tombol mute hanya menonaktifkan track audio lokal.
- Preview menampilkan indikator audio track live dan meter input.
- Jika mikrofon tidak menghasilkan track, Start gagal dengan pesan jelas.

## 6. Output

### SRT

Format output:

```text
srt://<media-host>:8890?streamid=read:<path>:user:<read-token>&latency=2000000&pkt_size=1316
```

OBS memakai Media Source, Local File dimatikan, format `mpegts`, dan latency
sekitar 2 detik.

### Player

- Result menampilkan live player, link player, link SRT, dan HTML embed.
- Link player adalah `/player?url=<WHEP>&token=<read-token>` pada aplikasi.
- Player memakai WHEP dengan Bearer header sehingga tidak bergantung pada
  iframe player bawaan MediaMTX atau endpoint fingerprint.
- Player hanya aktif ketika status path benar-benar live.

## 7. Recording

- Default `off`.
- Recording dilakukan MediaMTX, bukan browser.
- Format fMP4, part 1 detik, segment 10 menit, retention default 24 jam.
- File ditulis ke `/data/recordings` dan di-bind mount ke `./data/recordings`.
- Recording tidak dibuat jika `record=false`.
- Jika disk hampir penuh, live tetap berjalan dan recording dihentikan.
- Dashboard menyediakan list, download, dan delete recording.

## 8. API

```text
GET  /healthz

POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/session
POST /api/auth/password

POST   /api/streams
GET    /api/streams
GET    /api/streams/:id
PATCH  /api/streams/:id
POST   /api/streams/:id/stop
DELETE /api/streams/:id
GET    /api/streams/:id/stats

GET    /api/recordings
GET    /api/recordings/:id/download
DELETE /api/recordings/:id
```

Input create/update:

```json
{
  "codec": "h265",
  "audioCodec": "opus",
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "maxBitrateKbps": 4000,
  "portraitMode": false,
  "audioEnabled": true,
  "record": false
}
```

Private stream response memuat `whipUrl`, `publishToken`, `srtUrl`, dan
`playerUrl`. Token read/publish diturunkan dari secret HMAC di `/data/token.key`;
database hanya menyimpan hash token.

## 9. Domain dan environment

Prefix domain tidak diwajibkan. Contoh:

```dotenv
VDO_PUBLIC_ORIGIN=https://example.com
VDO_WEBRTC_PUBLIC_BASE_URL=https://media.example.com
VDO_SRT_PUBLIC_HOST=media.example.com
```

`example.com` dan `media.example.com` harus tercakup certificate yang sama.
Nginx mem-proxy app dan handshake WHIP/WHEP melalui HTTPS. UDP 8189 untuk ICE
dan UDP 8890 untuk SRT tetap direct.

## 10. Non-goals v1

- Server-side transcoding.
- Browser direct SRT publish.
- Guarantee hardware-only encoding dari browser.
- Downgrade resolution/FPS otomatis.
- iPhone Safari support penuh.
- RTMP, RTSP, HLS, multi-user, dan multi-reader.

## 11. Acceptance criteria

- `go test ./...` lulus.
- `npm run check`, `npm run build`, dan `npm run test:flow` lulus.
- Browser hanya menampilkan kamera profile yang lolos exact preflight.
- Start gagal jelas bila kamera, audio, codec, atau WHIP tidak tersedia.
- Create tidak meminta kamera live; Start yang membuka kamera.
- Stop lalu buka ulang dari dashboard memakai URL SRT yang sama.
- Token salah untuk WHIP/WHEP/SRT ditolak.
- Tidak ada canvas, WebCodecs, WebTransport, atau MoQ di pipeline browser.
- Recording off tidak membuat file; recording on menghasilkan fMP4 yang dapat
  di-download dan dihapus.
- 8 job tetap menjadi limit awal dan setiap job memiliki maksimum 10 reader
  gabungan, termasuk SRT/OBS dan player WHEP.
