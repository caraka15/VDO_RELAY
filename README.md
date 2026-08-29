# VDO Relay

VDO Relay adalah relay kamera untuk Android Chrome dan desktop Chrome.
Browser membuka kamera dan mikrofon dengan preferensi ukuran/FPS, membiarkan
Chrome memilih track native sesuai orientasi perangkat, lalu mengirim track itu
langsung melalui WHIP/WebRTC ke MediaMTX. MediaMTX tidak
melakukan transcoding; hasilnya dibaca OBS melalui SRT.

```text
Chrome camera + microphone
        │  native camera track
        │  WebRTC / WHIP
        ▼
MediaMTX  ───────────────► SRT read URL ─► OBS
        │
        └── fMP4 recording (optional, tanpa re-encode)
```

WHIP dipakai karena browser sudah menangani codec negotiation, congestion
control, dan ICE. Client kecil di frontend melakukan retry session jika
koneksi WHIP putus. Project ini tidak memakai MoQ, WebTransport, WebCodecs,
atau framing media custom; track kamera native langsung masuk ke WebRTC.

## Setup Ubuntu

Nama repository yang disarankan: `vdo-relay`.

```bash
git clone https://github.com/USERNAME/vdo-relay.git
cd vdo-relay
chmod +x setup.sh update.sh
./setup.sh
```

`setup.sh` akan menanyakan domain web, domain media, IP publik, dan izin
instalasi. Script lalu memasang Docker Engine, Docker Compose plugin, Nginx,
dan Certbot; membuat `.env`; membuat vhost Nginx; menampilkan instruksi DNS;
menunggu konfirmasi; meminta certificate; membuild image; dan menjalankan:

```bash
docker compose up -d --build
```

Domain tidak harus bernama `app.example.com`. Gunakan dua hostname berbeda,
misalnya:

```text
A example.com       -> IP_SERVER
A media.example.com -> IP_SERVER
```

`VDO_PUBLIC_ORIGIN` dan `VDO_WEBRTC_PUBLIC_BASE_URL` disimpan di `.env`.
`VDO_WEBRTC_PUBLIC_BASE_URL` harus berupa URL HTTPS tanpa port publik, karena
Nginx meneruskan WHIP/WHEP ke MediaMTX lokal pada port 8889.

Certbot memakai email `admin@<domain-media>`. Jangan menekan Enter sebelum DNS
A kedua hostname sudah mengarah ke server; script melakukan pengecekan ulang.

## Update

```bash
./update.sh
```

Script memastikan perubahan source sudah bersih, menjalankan `git pull
--ff-only`, menambahkan key `.env` baru bila ada, lalu membangun ulang:

```bash
docker compose up -d --build
```

Setelah instalasi, `update.sh` tidak menyentuh vhost Nginx atau menjalankan
`certbot --nginx`; konfigurasi HTTPS dan custom directive yang dibuat Certbot
tetap milik server. Jika domain, proxy, atau port Nginx berubah, ubah vhost
secara manual lalu jalankan `nginx -t` sebelum reload.

File runtime `data/`, `certs/`, `tools/`, dan asset build lokal sudah di-ignore
Git. SQLite dan recording berada di `./data`, jadi tidak hilang saat rebuild.

## Port dan Nginx

| Port | Fungsi | Akses |
| --- | --- | --- |
| 80/tcp | ACME dan redirect Certbot | publik |
| 443/tcp | web dashboard, API, player | publik |
| 8189/udp | ICE WebRTC media | publik |
| 8890/udp | SRT output untuk OBS | publik |
| 8443/tcp | Go app upstream | loopback host |
| 8889/tcp | WHIP/WHEP MediaMTX upstream | loopback host |

Nginx hanya menangani HTTP/HTTPS. UDP 8189 diperlukan WebRTC dan UDP 8890
diperlukan OBS, sehingga keduanya tidak bisa digantikan oleh proxy HTTP Nginx.
Control API, metrics, playback, dan callback auth hanya bind loopback di
container.

`deploy/nginx/vdo-relay.conf` adalah template instalasi awal dan sengaja hanya
berisi port 80. Certbot menambahkan blok HTTPS sendiri dan setup menyalin
certificate yang sama ke `certs/` untuk MediaMTX. Setelah itu, blok HTTPS yang
diubah Certbot tetap berada di `/etc/nginx/sites-available/vdo-relay`; update
tidak merender ulang file tersebut.

## Alur penggunaan

1. Login dengan `admin/admin` pada instalasi baru, lalu ganti password.
2. Job baru memilih preferensi resolusi/FPS; orientasi sumber kamera ditentukan
   oleh track native yang dikembalikan Chrome saat Start.
3. Tekan Deteksi. Browser meminta izin kamera dan mikrofon.
4. Pilih kamera. Resolusi/FPS adalah preferensi `getUserMedia`; Chrome dapat
   melakukan crop-and-scale pada pipeline kameranya dan ukuran native aktual
   ditampilkan setelah kamera dimulai.
5. Pilih codec WebRTC yang tersedia, audio Opus, bitrate maksimum, dan record.
6. Tekan `Create stream`. Ini hanya membuat job dan URL; kamera belum live.
7. Di halaman job, tekan `Start`. Kamera dibuka ulang dan track native dikirim
   langsung melalui WHIP.
8. Copy SRT URL dari tombol `OBS / SRT` di layar live atau dari Result. URL dan
   token tetap sama ketika job di-stop lalu dibuka kembali dari dashboard.

`Stop` menghentikan sesi media tetapi tidak menghapus job. `Delete` menghapus
job dan mencabut token. Satu job memiliki maksimum 10 reader gabungan, termasuk
OBS melalui SRT dan player browser melalui WHEP.

## Kamera dan codec

Resolusi/FPS yang dipilih adalah preferensi kamera, bukan ukuran yang dipaksa.
Browser membuka track dengan width/height ideal dan tanpa memaksa aspect ratio
atau `resizeMode: "none"`. Orientasi serta ukuran aktual mengikuti track yang
dikembalikan Chrome.

Semantik `resizeMode` mengikuti [MediaTrackConstraints di MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints).

Tidak ada canvas, frame loop, atau copy pixel pada jalur kamera normal. WebRTC
melakukan encoding track native dan dapat memakai encoder hardware yang lolos
preflight. Server tidak melakukan transcoding.

Saat aplikasi menemukan job lama yang menyimpan ukuran 4:3, migrasi database
mengubahnya ke 1920×1080 atau 1080×1920 sesuai orientasi job. Link stream tetap
sama. Job lama yang sempat dibuat sebagai portrait 1920×1080 dinormalisasi ke
portrait 1080×1920 saat dibuka.

Pada mobile, preview mengikuti bentuk aplikasi kamera: stage tetap portrait,
track tidak diputar oleh CSS, dan tidak di-zoom oleh `object-fit: contain`. Jika HP
dimiringkan, Chrome dapat mengembalikan track landscape/native; status aktual
ditampilkan di stage dan rotasi akhir dapat diatur di OBS. Tombol
Start/Stop, mute, Settings, sumber kamera, zoom, torch, serta akses cepat
SRT/player berada di layar live.

Deteksi codec menggabungkan `RTCRtpSender.getCapabilities("video")` dengan
`navigator.mediaCapabilities.encodingInfo()`. H.264/H.265 hanya dianggap dapat
dipilih bila browser melaporkan `supported` dan `powerEfficient`; publisher lalu
mengunci codec tersebut dengan `setCodecPreferences`, sehingga VP8/VP9/AV1
tidak menjadi fallback. `powerEfficient` adalah sinyal kemampuan dari browser,
bukan jaminan absolut implementasi hardware; jaminan hardware-only tetap
memerlukan aplikasi native Android dengan Camera2 dan MediaCodec. H.265 di
Chrome memiliki batasan dukungan perangkat/browser.

Audio browser memakai Opus melalui WebRTC. MediaMTX merelay track tanpa
transcoding menuju SRT.

## URL OBS dan player

Response private `GET /api/streams/:id` mengembalikan WHIP URL, token publish,
SRT URL, dan player URL. Bentuk SRT:

```text
srt://media.example.com:8890?streamid=read:vdo-STREAM:user:READ_TOKEN&latency=2000000&pkt_size=1316
```

Di OBS gunakan `Media Source`, matikan `Local File`, masukkan URL tersebut, dan
gunakan format `mpegts` dengan latency sekitar dua detik.

Player memakai route `/player` milik VDO Relay dan WHEP dengan header Bearer,
bukan halaman iframe bawaan MediaMTX. Dengan begitu token tetap bisa dipakai
lintas-origin tanpa endpoint fingerprint; request CORS WHEP ditangani sebagai
bagian dari handshake WebRTC. Link embed dapat disalin dari halaman Result.

## Environment

```dotenv
VDO_PUBLIC_ORIGIN=https://example.com
VDO_WEBRTC_PUBLIC_BASE_URL=https://media.example.com
VDO_SRT_PUBLIC_HOST=media.example.com
```

`VDO_DATA_DIR` default `/data` di container. `VDO_MEDIAMTX_BIN`, certificate,
alamat listener, dan Control API memiliki default untuk deployment Compose.

## Pengembangan lokal

Frontend:

```bash
cd frontend
npm ci
npm run check
npm run build
npm run test:flow
```

Backend:

```bash
go test ./...
```

Untuk uji browser lokal, gunakan HTTPS yang dipercaya browser untuk app dan
MediaMTX. Kamera, mikrofon, WHIP, dan WHEP tidak dapat diuji lengkap dari
halaman HTTP biasa selain pengecualian localhost tertentu.

## Struktur utama

```text
cmd/vdo/                         entrypoint Go
internal/app/                    API, SQLite, auth, lifecycle MediaMTX
frontend/src/App.svelte          routing dashboard/setup/live/result/player
frontend/src/lib/media.ts        capability, native source, dan direct track
frontend/src/lib/mediamtx-webrtc-publisher.js  WHIP publisher
frontend/src/lib/mediamtx-webrtc-reader.js     WHEP player
deploy/nginx/vdo-relay.conf      vhost port 80 sebelum Certbot
deploy/certbot/                  renewal hook
compose.yaml                     deployment single-container
setup.sh                         instalasi awal Ubuntu
update.sh                        pull dan rebuild
```

## Lisensi

MediaMTX dipin pada versi `v1.20.1`. Lihat lisensi masing-masing dependency.
