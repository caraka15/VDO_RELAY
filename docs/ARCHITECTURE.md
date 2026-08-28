# VDO Relay — Arsitektur Teknis

## 1. Keputusan arsitektur

### Stack

- Frontend: Svelte + Vite + Tailwind.
- Backend: Go `net/http`.
- Database: SQLite di `/data/app.db`.
- Media engine: MediaMTX `v1.20.1`.
- Deployment: satu Docker image dan satu container.
- Frontend dibuild menjadi asset static lalu disajikan backend melalui
  `embed.FS`.

Tidak ada React, FFmpeg, SRS, server-side encoder, atau UI component library
besar pada v1. Frontend memakai package icon `@lucide/svelte`; MediaMTX dipakai
sebagai media router/remuxer, bukan transcoder.

### Domain production

Gunakan dua DNS record ke IP server yang sama:

```text
app.example.com    -> Nginx :443 -> Go HTTPS localhost:8443, Svelte + /api/*
media.example.com  -> MediaMTX :8892 TCP/UDP dan :8890 UDP
```

Frontend dan API sengaja satu origin supaya cookie session tidak memerlukan
CORS. Nama hostname bebas; prefix `app` dan `media` hanya contoh. MediaMTX MoQ
memakai `moqAllowOrigins: ["*"]` agar fingerprint dapat diambil dari alias web
mana pun, sedangkan publish/read tetap diwajibkan membawa token.
`VDO_MOQ_PUBLIC_BASE_URL` dan `VDO_SRT_PUBLIC_HOST` menentukan hostname media.
Nginx hanya menangani domain web dan ACME HTTP challenge. Nginx tidak menjadi
proxy untuk SRT atau WebTransport.

## 2. Diagram komponen

```text
                              public
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
        443/tcp            8892/tcp            8890/udp
        Nginx HTTPS     MoQ HTTP/2          SRT read
             │            8892/udp                 │
             │          WebTransport               │
             ▼                │                    ▼
      ┌────────────┐          │              ┌───────────┐
      │ Go backend │◄─────────┼──────────────│   OBS     │
      │ + Svelte   │          │              │ SRT input │
      └─────┬──────┘          │              └───────────┘
            │                 │
            │ localhost      ▼
            │          ┌────────────┐
            ├─────────►│ MediaMTX   │
            │  API      │ MoQ/SRT   │
            │  metrics  │ recorder  │
            │  playback └─────┬──────┘
            │                 │
            ▼                 ▼
      ┌───────────┐     ┌──────────────┐
      │ SQLite    │     │ /data/       │
      │ app.db    │     │ recordings/  │
      └───────────┘     └──────────────┘
```

Logical components tetap tiga: web app, backend, dan media engine. Secara
deployment semuanya berada dalam satu container.

## 3. Alur media

### 3.1 Browser ke MediaMTX

1. Svelte mengecek `VideoEncoder.isConfigSupported()` dan
   `AudioEncoder.isConfigSupported()` untuk ukuran/FPS output yang dipilih.
2. Hanya jika output preflight lulus, Svelte memanggil `POST /api/streams`;
   backend membuat path, token stabil, SRT URL, dan player URL.
3. Halaman setup meminta izin kamera/microphone dan menguji mode kamera exact
   berdasarkan orientasi, resolusi, dan FPS yang dipilih.
4. Hanya mode kamera yang menghasilkan `getSettings()` sesuai profile yang
   ditampilkan. `resizeMode: none` mencegah crop-and-scale dari track.
5. Setelah job dibuat, halaman kontrol tetap standby sampai operator menekan
   Start. Start meminta kamera/microphone lagi dengan constraint exact.
6. Publisher memakai `MediaStreamTrackProcessor` untuk membaca track kamera
   langsung. Tidak ada canvas, `captureStream()`, rotate pixel, atau black bar
   pada media yang dikirim.
7. Preview desktop memakai `<video>` direct dengan `object-fit: contain` pada
   stage 16:9; ruang hitam preview tidak menjadi bagian encoded media.
8. Preview mobile memakai source video yang sama dan dapat memakai CSS rotate
   untuk tampilan portrait app; transform CSS tidak masuk ke publisher.
9. `VideoEncoder` menghasilkan H.264 atau H.265 pada ukuran/FPS track yang sama.
10. `AudioEncoder` menghasilkan codec audio yang dipilih bila audio aktif.
11. Encoded chunks dikirim melalui publisher Media-over-QUIC yang divendor dari
    release MediaMTX yang dipin.
12. Subgroup encoded pada setiap track ditulis FIFO ke WebTransport supaya group
    ID tidak tiba di MediaMTX secara acak ketika beberapa stream QUIC selesai
    bersamaan.
13. MediaMTX menerima encoded media pada path stream.

Media-over-QUIC membutuhkan HTTPS serta akses TCP dan UDP pada port yang sama.
Browser publishing saat ini diarahkan ke Chrome karena pipeline publishing
membutuhkan `MediaStreamTrackProcessor`. [MediaMTX MoQ requirements](https://mediamtx.org/docs/publish/moq-clients)

### 3.2 MediaMTX ke OBS

MediaMTX membaca path internal dan menyediakan SRT listener pada UDP `8890`.
OBS memakai SRT read URL dengan MPEG-TS. MediaMTX melakukan packet/container
conversion yang diperlukan untuk protokol, tanpa menjalankan video encoder.

Format URL:

```text
srt://<public-host>:8890?streamid=read:<path>:user:<read-token>&latency=2000000&pkt_size=1316
```

MediaMTX mendokumentasikan format token SRT sebagai password pada stream ID.
[MediaMTX authentication](https://mediamtx.org/docs/features/authentication) · [MediaMTX SRT read](https://mediamtx.org/docs/read/srt)

## 4. Backend

### 4.1 Tanggung jawab

- Serve frontend static.
- Login, logout, session, dan password change.
- Menyimpan user serta metadata stream di SQLite.
- Membuat token random dan hanya menyimpan hash token.
- Membuat dan menghapus MediaMTX path melalui Control API.
- Menjalankan endpoint external authentication MediaMTX.
- Membaca stats MediaMTX dan menghitung bitrate dari perubahan byte.
- Menyajikan daftar dan download recording.
- Menjalankan serta memantau child process MediaMTX.
- Menjaga limit 8 job terbuka.

### 4.2 Listener

Backend menggunakan dua listener dalam satu proses:

- `0.0.0.0:8443` HTTPS upstream untuk Nginx.
- `127.0.0.1:8080` HTTP internal untuk callback MediaMTX.

Port app hanya dipublish ke loopback host; port publik `80/443` dimiliki Nginx.

### 4.3 API publik

Semua response error memakai bentuk minimal:

```json
{
  "error": "stream limit reached",
  "code": "stream_limit"
}
```

Endpoint:

```text
GET  /healthz

POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/session
POST /api/auth/password

POST /api/streams
GET  /api/streams
GET  /api/streams/{id}
PATCH /api/streams/{id}
DELETE /api/streams/{id}
GET  /api/streams/{id}/stats
POST /api/streams/{id}/stop

GET  /api/recordings
GET  /api/recordings/{id}/download
DELETE /api/recordings/{id}
```

`POST /api/streams` menerima:

```json
{
  "codec": "h265",
  "audioCodec": "opus",
  "width": 1920,
  "height": 1080,
  "fps": 60,
  "maxBitrateKbps": 4000,
  "portraitMode": false,
  "audioEnabled": true,
  "record": false
}
```

Response mengembalikan:

```json
{
  "id": "stream-id",
  "path": "vdo-stream-id",
  "publishUrl": "https://media.example.com:8892/vdo-stream-id",
  "fingerprintUrl": "https://media.example.com:8892/vdo-stream-id/fingerprint",
  "publishToken": "reusable-job-token",
  "srtUrl": "srt://host:8890?streamid=read:...",
  "playerUrl": "https://media.example.com:8892/vdo-stream-id?token=...&autoplay=true&muted=true",
  "status": "ready",
  "record": false
}
```

`GET /api/streams/{id}` mengembalikan kembali URL/token setiap job yang masih
tersimpan, termasuk status `stopped`, kepada operator terautentikasi. `PATCH /api/streams/{id}`
menyimpan profile baru tanpa mengganti path atau token dan
menyiapkan kembali path MediaMTX. `DELETE /api/streams/{id}` menghapus job
secara permanen. `playerUrl` dapat dipakai langsung sebagai `iframe src`.
Token tidak ditulis ke log dan hanya dicabut oleh Delete.

`GET /api/streams/{id}/stats` mengembalikan:

```json
{
  "status": "live",
  "codec": "h265",
  "width": 1920,
  "height": 1080,
  "fps": 60,
  "maxBitrateKbps": 4000,
  "currentBitrateKbps": 3200,
  "receivedBitrateKbps": 3150,
  "srtReaders": 1,
  "recording": false
}
```

`POST /internal/media-auth` hanya bind loopback dan menerima payload callback
MediaMTX. Endpoint memvalidasi action, protocol, path, token, expiry, dan
status stream. Semua request yang tidak cocok dibalas non-2xx.

MediaMTX versi yang dipin memiliki protocol `moq` pada auth manager, sehingga
publish MoQ dan read SRT dapat divalidasi di callback yang sama. Integration
test wajib memastikan payload MoQ yang dipakai release tersebut.

## 5. Database

SQLite hanya menyimpan data control plane; media dan recording tetap milik
MediaMTX di filesystem.

### `users`

```text
id             integer primary key
username       text unique not null
password_hash  text not null
must_change    integer not null default 1
created_at     text not null
updated_at     text not null
```

### `sessions`

```text
id_hash        text primary key
user_id        integer not null
expires_at     text not null
created_at     text not null
```

### `streams`

```text
id                    text primary key
path                  text unique not null
publish_token_hash    text not null
read_token_hash       text not null
codec                 text not null
audio_codec           text not null default 'opus'
width                 integer not null
height                integer not null
fps                   integer not null
max_bitrate_kbps      integer not null
current_bitrate_kbps  integer not null
portrait_mode         integer not null
audio_enabled         integer not null
record_requested      integer not null
state                 text not null
started_at            text
ended_at              text
created_at            text not null
```

Tidak ada tabel recording tambahan pada v1. Daftar recording diturunkan dari
path stream dan MediaMTX Playback API, sehingga metadata tidak diduplikasi.

## 6. Authentication dan authorization

### Dashboard

- Seed akun `admin/admin` hanya ketika database belum memiliki user.
- `must_change=1` memaksa password change.
- Password baru di-hash Argon2id.
- Session ID random disimpan dalam bentuk hash.
- Cookie diberi `HttpOnly`, `Secure`, `SameSite=Strict`.
- Mutating request hanya menerima same-origin session.
- Login dibatasi 5 kegagalan per IP lalu cooldown 1 menit; counter bersifat
  in-memory dan reset saat backend restart.

### Media

- Setiap stream memakai path random dengan entropy tinggi.
- Publish token dan read token berbeda.
- Database hanya menyimpan hash token.
- Token dapat diturunkan ulang dengan HMAC dari secret random `/data/token.key`;
  secret dan SQLite bertahan pada bind mount, sehingga URL stabil setelah restart.
- MoQ publish mengirim capability token sebagai Bearer token pada WebTransport.
- SRT read memakai token sebagai password pada stream ID.
- Token aktif selama row job masih tersimpan dan tidak dicabut oleh Stop relay.
- Stop relay melepas path aktif dari MediaMTX agar slot dan koneksi dilepas;
  PATCH/Start berikutnya membuat atau memperbarui path yang sama.
- Delete menghapus path jika masih aktif lalu menghapus row job, sehingga token
  lama tidak dapat diautentikasi lagi.
- MediaMTX Control API, metrics, dan playback tidak boleh public.

SRT URL adalah bearer credential. UI harus menggunakan `Referrer-Policy:
no-referrer`, tidak mengirim URL ke analytics, dan memberi tombol regenerate
dengan cara menghentikan stream lama.

## 7. MediaMTX lifecycle

### 7.1 Startup

Backend menulis atau menyediakan konfigurasi dasar:

```text
moq: true
moqHTTP2Address: :8892
moqHTTP3Address: :8892
moqServerKey: /certs/server.key
moqServerCert: /certs/server.crt
moqAllowOrigins: ["*"]

srt: true
srtAddress: :8890

api: true
apiAddress: 127.0.0.1:9997
metrics: true
metricsAddress: 127.0.0.1:9998

playback: true
playbackAddress: 127.0.0.1:9996

authMethod: http
authHTTPAddress: http://127.0.0.1:8080/internal/media-auth

pathDefaults:
  record: false
  maxReaders: 1
  recordPath: /data/recordings/%path/%Y-%m-%d_%H-%M-%S-%f
  recordFormat: fmp4
  recordPartDuration: 1s
  recordSegmentDuration: 10m
  recordDeleteAfter: 24h

paths:
  all_others:
```

`authHTTPExclude` mengecualikan API, metrics, pprof, dan playback karena
seluruhnya dibatasi ke loopback.

### 7.2 Create stream

Backend melakukan:

1. Validasi session dan limit 8 stream.
2. Generate stream ID/path dan turunkan publish/read token stabil memakai HMAC.
3. Simpan hanya hash token serta metadata ke SQLite.
4. Memanggil:

   ```text
   POST http://127.0.0.1:9997/v3/config/paths/add/{path}
   ```

5. Mengirim `record`, `maxReaders: 1`, dan setting path yang diperlukan.
6. Mengembalikan URL publisher dan SRT URL.

MediaMTX Control API mendukung add, patch, replace, dan delete path ketika
server sedang berjalan, sehingga toggle recording per stream tidak memerlukan
restart. [Control API path operations](https://github.com/bluenviron/mediamtx/blob/v1.20.1/api/openapi.yaml#L2216-L2380)

### 7.3 Stats

Frontend polling endpoint stats setiap 2 detik; backend membaca Control API
MediaMTX saat request diterima.
Bitrate dihitung dari delta inbound/outbound bytes, bukan dari satu sample.
MediaMTX menyediakan byte counters yang dapat dipakai untuk perhitungan ini.
[MediaMTX metrics](https://mediamtx.org/docs/features/metrics)

### 7.4 Stop relay, reuse, dan cleanup

1. Stop relay menutup resource browser, memanggil endpoint stop, menandai job
   `stopped`, dan memanggil `DELETE /v3/config/paths/delete/{path}`.
2. Profile job tidak diubah dari halaman live; endpoint update tetap tersedia
   untuk sinkronisasi metadata sebelum Start berikutnya.
3. Start berikutnya memakai path, read token, dan SRT URL yang sama; OBS hanya
   mengalami interupsi/reconnect, bukan membutuhkan URL baru.
4. Kembali ke Home menjalankan Stop lalu hanya mengubah tampilan dashboard.
5. Delete menghapus path bila perlu, menghapus row SQLite, dan mencabut akses
   token secara permanen. Recording tidak dihapus otomatis.

Jika MediaMTX mati, child process direstart dengan backoff. Konfigurasi
`all_others` membuat path bertoken tetap dapat dipakai; Start/PATCH berikutnya
memastikan kembali konfigurasi recording path khusus.

## 8. Browser encoder dan adaptive bitrate

### 8.1 Pipeline frame

- Capture track dibaca menggunakan `MediaStreamTrackProcessor`.
- Capture track dibuka dengan width, height, frameRate exact dan `resizeMode: none`.
- Hasil `getSettings()` dan frame pertama diverifikasi sebelum publisher berjalan.
- Ukuran frame dan konfigurasi `VideoEncoder` harus sama agar encoder tidak
  melakukan scaling.
- Frame kamera langsung diberikan ke `MediaStreamTrackProcessor` dan encoder.
- Desktop menampilkan track langsung dalam stage 16:9 dengan `object-fit: contain`.
- Mobile menampilkan track langsung dalam stage portrait; CSS rotate hanya untuk
  preview, bukan untuk media output.
- Orientasi, width, height, dan framerate tidak dikonfigurasi ulang saat live.

### 8.2 Preflight

Preflight konfigurasi output dilakukan sebelum `POST /api/streams` menggunakan
ukuran/FPS/codec target. Preflight Start diulang setelah job tersedia. Preflight
gagal bila:

- codec tidak supported;
- audio encoder yang diwajibkan tidak tersedia.

Setelah preflight Create lulus, input kamera/microphone dibuka terpisah saat
operator menekan Start. Kamera wajib menghasilkan resolusi/FPS profile exact;
tidak ada scaling atau pacing dari browser. Jika input tidak bisa dibuka,
job tetap `ready` agar operator dapat memilih device lain atau retry.

Operator dapat mematikan audio jika audio encoder atau microphone tidak tersedia.
Profile resolusi/FPS tidak berubah di halaman live; buat job baru jika profile
berbeda diperlukan. Job lama tetap reusable dari dashboard.

### 8.3 Adaptive controller

State yang dipantau:

- pending write pada publisher transport;
- MediaMTX inbound byte rate;
- reconnect/error events.

`VideoEncoder.encodeQueueSize` tidak dipakai sebagai indikator jaringan: nilai
itu menunjukkan pekerjaan encoder browser, bukan kapasitas write WebTransport.
Konfigurasi VideoEncoder meminta `hardwareAcceleration: "prefer-hardware"`;
ini hanya hint yang boleh diabaikan browser, bukan jaminan hardware-only.

Aturan:

```text
start target = max bitrate

pressure sustained 5s  -> target *= 0.80
stable 15s              -> target *= 1.10, capped at max bitrate
floor                   -> max(256 kbps, 25% of max bitrate)
below floor / no link   -> reconnect or failed
```

`targetBitrateKbps` dan `receivedBitrateKbps` ditampilkan terpisah agar bitrate
rendah karena content tidak keliru dianggap sebagai packet loss.

## 9. Recording dan playback

- Backend menambahkan path dengan `record: true` hanya ketika operator memilih
  Record.
- MediaMTX menulis fMP4 ke `/data/recordings`.
- `recordPartDuration: 1s` membatasi kehilangan bagian terakhir saat crash.
- `recordSegmentDuration: 10m` memudahkan download dan cleanup.
- `recordDeleteAfter: 24h` mencegah disk penuh tanpa notifikasi.
- Playback server hanya bind loopback.
- Backend memvalidasi session lalu mem-proxy daftar dan download playback.
- Delete hanya boleh dilakukan melalui backend dan harus memiliki confirmation.

Estimasi ukuran memakai bitrate target video ditambah audio dan overhead. Untuk
4 Mbps, estimasi dasar sekitar 1,8 GB/jam per stream.

## 10. Deployment Docker di Ubuntu

### Image

Deployment Ubuntu dipandu oleh `setup.sh`. Script memasang Docker Engine lebih
dulu, lalu Docker Compose plugin, Nginx, dan Certbot; menulis `.env`, merender
vhost Nginx, menunggu DNS `A` kedua hostname, meminta certificate, memasang
renewal hook, lalu menjalankan `docker compose up -d --build`. Detail command
operator ada di README.

Multi-stage Docker build:

1. Node stage membuild Svelte/Tailwind.
2. Go stage membuild backend.
3. Runtime stage berisi binary Go, binary MediaMTX `v1.20.1`, dan asset static.

Container dijalankan non-root. Backend memakai `:8443`, lalu Docker hanya
memetakan `127.0.0.1:8443` ke port tersebut agar Nginx menjadi satu-satunya
pintu web publik.

Hostname publik diset pada environment container:

```text
VDO_PUBLIC_ORIGIN=https://app.example.com
VDO_MOQ_PUBLIC_BASE_URL=https://media.example.com:8892
VDO_SRT_PUBLIC_HOST=media.example.com
```

Certificate yang sama harus memiliki SAN untuk `app.example.com` dan
`media.example.com` (atau gunakan wildcard certificate).

### Nginx dan certificate

Nginx berjalan di host Ubuntu. `setup.sh` merender template
`deploy/nginx/vdo-relay.conf` ke `sites-available`; file tersebut sengaja hanya
memiliki listener port 80 supaya dapat dipakai oleh Certbot. Setelah itu
Certbot menambahkan HTTPS sendiri:

```bash
sudo install -d /var/www/certbot
sudo cp deploy/nginx/vdo-relay.conf /etc/nginx/sites-available/vdo-relay
sudo ln -s /etc/nginx/sites-available/vdo-relay /etc/nginx/sites-enabled/vdo-relay
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d app.example.com -d media.example.com
```

Certbot mengedit konfigurasi Nginx, tetapi tidak mengubah file certificate di
dalam container. Salin certificate hasil Certbot ke `certs/` lalu restart
container setelah issuance dan setiap renewal:

```bash
sudo install -m 0644 /etc/letsencrypt/live/vdo-relay/fullchain.pem certs/server.crt
sudo install -m 0600 /etc/letsencrypt/live/vdo-relay/privkey.pem certs/server.key
docker compose restart vdo
```

Untuk renewal otomatis, `setup.sh` memasang symlink
`deploy/certbot/vdo-relay-deploy-hook.sh` ke
`/etc/letsencrypt/renewal-hooks/deploy/vdo-relay`. Hook menyalin certificate
baru dan me-restart container memakai `docker compose`; lokasi project diambil
dari target symlink atau `VDO_PROJECT_DIR`. Setup memakai nama lineage tetap
`vdo-relay`; hook mengabaikan certificate lain yang mungkin terpasang pada host.

### Volume dan certificate

```text
/data                 mount dari ./data pada host; SQLite dan recording
/data/app.db          database SQLite control plane
/data/token.key       secret HMAC untuk memulihkan token job
/data/recordings/     file recording fMP4
/certs/server.crt     certificate HTTPS
/certs/server.key     private key
```

Compose memakai bind mount `./data:/data`, bukan Docker named volume. Dengan
demikian database dan recording tetap berada di luar writable layer image dan
tetap ada setelah rebuild. Container berjalan sebagai UID/GID `10001`, lalu
`setup.sh` menyiapkan ownership folder host tersebut.

Production membutuhkan certificate valid untuk public domain. CORS MoQ wildcard
hanya mengizinkan browser membaca respons lintas-origin; callback auth tetap
menolak publish/read tanpa token yang cocok. Credential dashboard tetap berasal
dari database/constant seed, bukan environment variable.

### Port mapping

```text
127.0.0.1:8443:8443/tcp
8892:8892/tcp
8892:8892/udp
8890:8890/udp
```

Port `9996`, `9997`, dan `9998` tidak dipublish.

Firewall Ubuntu hanya membuka:

```text
80/tcp
443/tcp
8892/tcp
8892/udp
8890/udp
```

## 11. Operasional dan batas kapasitas

Target initial:

- 2 vCPU;
- 2 GB RAM;
- bandwidth simetris 500–1000 Mbps;
- 8 stream aktif;
- satu SRT reader per stream;
- recording default off.

Stress test 8 stream harus dijalankan dengan kombinasi H.265 4 Mbps dan H.264
7 Mbps. Limit boleh dinaikkan ke 12 atau 16 hanya jika 10 menit pengujian tidak
menunjukkan disconnect, queue runaway, atau disk/network saturation.

Jika satu stream dibaca oleh dua OBS, outbound bandwidth stream tersebut menjadi
kira-kira dua kali. Limit reader karena itu tetap satu pada v1.

## 12. Pengujian

### Unit

- password hash dan verify;
- session expiry;
- token hash dan revoke;
- bitrate validation dan adaptive step;
- stream limit;
- SRT URL encoding;
- path cleanup.

Perintah minimum:

```text
go test ./...
npm run build
```

### Integration

- MediaMTX start dan health check;
- create path dengan record off/on;
- patch/delete path tanpa restart;
- callback auth publish MoQ;
- callback auth read SRT;
- token invalid ditolak;
- playback list/download/delete.

### Browser

- Android Chrome portrait dan landscape;
- desktop Chrome;
- 375px viewport;
- H.264 selalu diuji;
- H.265 diuji pada perangkat yang melaporkan supported;
- capability VP8/VP9/AV1 tampil benar;
- preflight gagal dengan pesan yang dapat diperbaiki;
- ruang hitam portrait terlihat pada preview desktop, bukan pada output;
- adaptive bitrate tidak mengubah resolusi/FPS/codec;
- reduced-motion dan keyboard navigation.

### OBS dan load

- SRT URL valid masuk sebagai MPEG-TS;
- latency sekitar 2 detik;
- token salah gagal;
- 8 publisher dan 8 SRT reader;
- CPU, RAM, inbound/outbound bandwidth, packet loss, dan disk write dicatat.

## 13. Urutan implementasi

1. Buat struktur Svelte/Vite/Tailwind dan Go server dengan static embed.
2. Tambahkan SQLite, seed account, login, password change, dan session.
3. Integrasikan binary MediaMTX, config dasar, health check, dan Control API.
4. Tambahkan stream lifecycle, token auth, SRT URL, dan stats.
5. Tambahkan browser capability probe, exact camera preflight, WebCodecs, dan MoQ
   publisher tanpa canvas.
6. Tambahkan adaptive bitrate dan reconnect state.
7. Tambahkan recording, playback proxy, download, dan disk guard.
8. Jalankan unit, integration, browser, OBS, dan stress test.
