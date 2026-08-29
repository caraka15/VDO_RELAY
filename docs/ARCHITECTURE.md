# Arsitektur VDO Relay

## 1. Diagram

```text
┌─────────────────────────────┐
│ Android/Desktop Chrome      │
│ getUserMedia                 │
│ ideal output track + crop    │
│ and scale + Opus             │
│ RTCPeerConnection / WHIP     │
└──────────────┬──────────────┘
               │ HTTPS SDP : media.example.com
               │ UDP ICE :8189
               ▼
┌─────────────────────────────┐
│ MediaMTX v1.20.1            │
│ WebRTC ingress               │
│ path auth + remux/relay      │
│ fMP4 recording optional      │
│ SRT egress :8890/udp        │
└──────────────┬──────────────┘
               ▼
             OBS
```

Go backend mengelola dashboard, token, SQLite, lifecycle path, stats, dan
MediaMTX child process. Frontend static di-embed ke binary Go.

## 2. Mengapa WHIP

WHIP/WHEP adalah HTTP handshake standar untuk WebRTC. Publisher browser cukup
membuat `RTCPeerConnection`, mengirim SDP, dan melakukan trickle ICE. Browser
sendiri menangani packetization, congestion control, dan jaringan.

Pipeline tidak memiliki `VideoEncoder`, `AudioEncoder`, `MediaStreamTrackProcessor`,
WebTransport, MoQ, canvas capture, atau framing media custom. Ini menghilangkan
sumber masalah queue serial dan adaptive bitrate palsu pada implementasi lama.

MediaMTX mendokumentasikan endpoint publish `/path/whip` dan read `/path/whep`.
[Dokumentasi WebRTC MediaMTX](https://mediamtx.org/docs/publish/webrtc-clients)

## 3. Frontend

Stack: Svelte 5, Vite, Tailwind v4, dan `@lucide/svelte`.

```text
src/App.svelte
  ├─ LoginView / PasswordView
  ├─ DashboardView
  ├─ SetupView
  ├─ LiveView
  ├─ ResultView
  └─ PlayerView

src/lib/media.ts
  ├─ permission + device enumeration
  ├─ ideal output profile probe
  ├─ WebRTC capability probe
  └─ getUserMedia capture

src/lib/mediamtx-webrtc-publisher.js
  └─ WHIP OPTIONS → POST SDP → PATCH ICE → DELETE

src/lib/mediamtx-webrtc-reader.js
  └─ WHEP OPTIONS → POST SDP → PATCH ICE → DELETE
```

### Capture semantics

Output `getUserMedia` memakai `width`, `height`, dan `aspectRatio` `ideal`, serta
`frameRate` `ideal` dengan batas `max`. Width/height tidak memiliki batas `max`
karena beberapa Android HAL menolak crop-and-scale ketika dua dimensi diberi
batas atas. Browser dicoba
dengan crop-and-scale sebagai preferensi, lalu sebagai mode wajib bila perlu,
dan terakhir tanpa resize mode untuk kamera yang memiliki mode native 16:9.
Detector menguji target output 16:9/9:16 yang ditentukan aplikasi dan menerima
hasil hanya selama track aktif, ukurannya tidak di bawah target, dan rasio
`getSettings()` mendekati target. Kemampuan sensor native seperti 2304×1728
hanya dipakai sebagai informasi dan filter; 4:3 tidak pernah menjadi fallback.

Saat startup, migrasi SQLite mengubah profile job lama yang bukan 16:9/9:16 ke
1920×1080 atau 1080×1920 berdasarkan `portrait_mode`. Path, token, dan recording
metadata tidak berubah.

Dengan demikian kamera 4:3 dapat diminta menjadi 1920×1080 tanpa canvas:
browser/OS memotong area 4:3 dan menurunkannya ke track 16:9. Spesifikasi
`crop-and-scale` tidak menjamin implementasi crop tertentu berjalan di ISP
hardware; jaminan hardware-only membutuhkan native Android Camera2/MediaCodec.
CSS rotate di `LiveView` hanya memutar preview mobile agar track landscape dapat
dilihat seperti aplikasi kamera; CSS tidak memengaruhi WebRTC track.

### Codec

Capability diperoleh dari `RTCRtpSender.getCapabilities("video")` dan
`navigator.mediaCapabilities.encodingInfo()`. H.264/H.265 hanya lolos bila
terdaftar di capability RTP serta menghasilkan `supported: true` dan
`powerEfficient: true`. Publisher memakai `RTCRtpTransceiver.setCodecPreferences()`
untuk mengunci codec yang dipilih, sehingga VP8/VP9/AV1 tidak menjadi fallback.
`powerEfficient` adalah sinyal browser, bukan bukti absolut implementasi hardware;
jaminan hardware-only tetap memerlukan native Android Camera2/MediaCodec.

H.264 dan H.265 dipilih untuk output SRT. VP8, VP9, dan AV1 dapat diketahui
sebagai capability WebRTC, tetapi tidak menjadi pilihan job SRT v1 karena
pipeline SRT yang ditargetkan memakai codec H.264/H.265. H.265 juga tergantung
dukungan OS/GPU/browser; dokumentasi MediaMTX mencatat batasan Chrome pada
platform tertentu. [WebRTC-specific features](https://mediamtx.org/docs/features/webrtc-specific-features)

Audio browser memakai Opus. AAC tidak dipaksakan karena publisher browser
WebRTC ini tidak mengirim AAC sebagai RTP audio track.

## 4. WHIP publisher

`MediaMTXWebRTCPublisher` melakukan urutan berikut:

1. `OPTIONS <media>/<path>/whip` dengan Bearer publish token.
2. Parse header `Link` untuk ICE server.
3. Buat peer connection dan transceiver `sendonly` untuk video/audio.
4. Pin codec pilihan dengan `setCodecPreferences`.
5. Buat SDP offer dan set local description.
6. `POST` offer dengan `Content-Type: application/sdp`.
7. Simpan `Location` session dan set SDP answer.
8. Kirim local ICE candidates melalui `PATCH` dengan
   `application/trickle-ice-sdpfrag`.
9. Saat connection state `connected`, UI menandai LIVE.
10. Stop melakukan `DELETE` terhadap session dan menghentikan source tracks.

Token dikirim pada header `Authorization: Bearer`. Error 401/403 bersifat
terminal; error koneksi lain mencoba reconnect dengan jeda 2 detik. MediaMTX
memanggil callback auth Go dengan `protocol: "webrtc"`.

## 5. WHEP player

Result tidak memakai HTML player bawaan MediaMTX karena token header tidak dapat
diandalkan melalui iframe biasa. Backend membuat URL:

```text
/player?url=https%3A%2F%2Fmedia.example.com%2Fvdo-abc%2Fwhep&token=READ_TOKEN
```

`PlayerView` membaca URL tersebut, lalu reader melakukan WHEP dengan Bearer
header dan memasukkan remote `MediaStream` ke `<video>`. Route player tidak
memerlukan session dashboard, sehingga dapat dipakai untuk link embed. Token
adalah credential; siapa pun yang menerima link dapat membaca sampai job
dihapus.

Browser reader memakai `recvonly` video/audio transceiver dan menunggu status
path live. Player memberi muted autoplay agar aturan autoplay browser tidak
menghentikan tampilan; pengguna dapat menyalakan audio dari kontrol video.

## 6. Backend Go

### Listener

```text
public  :8443  HTTPS jika cert tersedia
internal 127.0.0.1:8080  callback MediaMTX
```

Public handler menyajikan embedded `web/dist`, `/healthz`, dan `/api/*`.
Internal handler hanya menerima `POST /internal/media-auth` dari loopback.

### API dan lifecycle

```text
POST   /api/streams             create reusable path + token
GET    /api/streams             list jobs
GET    /api/streams/:id         private URLs + metadata
PATCH  /api/streams/:id         update profile/path recording
POST   /api/streams/:id/stop    stop path tanpa menghapus job
DELETE /api/streams/:id         delete path + revoke token
GET    /api/streams/:id/stats   path bytes/readers/status
```

Create dan update memvalidasi H.264/H.265, Opus, ukuran kandidat, FPS, bitrate,
dan record. Create menambahkan path dengan Control API. Start browser melakukan
`PATCH` profile lalu WHIP; backend tidak menunggu atau mengatur frame.

Stop menandai row `stopped` dan menghapus path MediaMTX. Start berikutnya
memakai path serta HMAC token yang sama, sehingga SRT URL OBS tidak berubah.
Delete menghapus path dan row; token lama tidak lagi cocok dengan hash.

### Auth callback

MediaMTX mengirim JSON seperti:

```json
{
  "action": "publish",
  "path": "vdo-abc",
  "protocol": "webrtc",
  "token": "publish-token"
}
```

Go hanya menerima callback dari loopback, memeriksa action/protocol/path/status,
lalu membandingkan token dengan hash. SRT read memakai callback yang sama dengan
`protocol: "srt"` dan read token. [MediaMTX authentication](https://mediamtx.org/docs/features/authentication)

## 7. MediaMTX configuration

Backend menulis config ke `VDO_DATA_DIR/mediamtx.yml` saat startup:

```yaml
moq: false
webrtc: true
webrtcAddress: :8889
webrtcEncryption: true
webrtcServerCert: /certs/server.crt
webrtcServerKey: /certs/server.key
webrtcAllowOrigins: ["*"]
webrtcLocalUDPAddress: :8189
webrtcIPsFromInterfaces: true
webrtcAdditionalHosts: ["media.example.com"]

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
```

`webrtcAdditionalHosts` diambil dari hostname `VDO_WEBRTC_PUBLIC_BASE_URL` agar
ICE answer mengiklankan alamat yang dapat dijangkau browser. Di belakang NAT,
tambahkan TURN melalui konfigurasi MediaMTX ketika server tidak dapat menerima
UDP langsung.

Path defaults:

```yaml
record: false
maxReaders: 10
recordPath: /data/recordings/%path/%Y-%m-%d_%H-%M-%S-%f
recordFormat: fmp4
recordPartDuration: 1s
recordSegmentDuration: 10m
recordDeleteAfter: 24h
```

MediaMTX mengubah container/protokol menuju SRT, tetapi tidak melakukan video
transcoding. [SRT read](https://mediamtx.org/docs/read/srt)

## 8. Nginx dan domain

Gunakan dua hostname bebas, misalnya `example.com` untuk app dan
`media.example.com` untuk media. Prefix `app` bukan persyaratan.

```text
Browser HTTPS :443 example.com
  -> Nginx -> https://127.0.0.1:8443 (Go)

Browser HTTPS :443 media.example.com
  -> Nginx -> https://127.0.0.1:8889 (MediaMTX WHIP/WHEP)

Browser/ICE UDP :8189 -> host/container -> MediaMTX
OBS/SRT UDP :8890 -> host/container -> MediaMTX
```

`deploy/nginx/vdo-relay.conf` hanya port 80 agar Certbot dapat menambahkan
HTTPS. Media upstream memakai HTTPS dan certificate yang sama; proxy internal
mematikan verifikasi karena certificate public hostname tidak cocok dengan
`127.0.0.1`. Traffic client tetap HTTPS.

Nginx tidak dapat mem-proxy UDP. Firewall/security group perlu membuka:

```text
80/tcp  443/tcp  8189/udp  8890/udp
```

MediaMTX TCP 8889 hanya bind loopback host melalui Compose. Control API,
metrics, dan playback tidak dipublish.

## 9. Storage dan deployment

Satu image/satu container:

```text
Node build Svelte -> Go build embedded frontend -> Alpine runtime
                                      └─ MediaMTX v1.20.1 child process
```

Bind mount:

```text
./data  -> /data
./certs -> /certs:ro
```

`/data/app.db`, `/data/token.key`, generated MediaMTX config, dan
`/data/recordings` bertahan saat `docker compose up -d --build`. Container
berjalan sebagai UID/GID 10001.

## 10. Bitrate dan stats

UI mengirim `maxBitrateKbps`. Publisher menerapkan
`RTCRtpSender.setParameters()` pada encoding pertama dan mengisi
`RTCRtpEncodingParameters.maxBitrate` sebagai cap. Fungsi ini dapat dipanggil
lagi saat peer connection hidup tanpa restart. WebRTC boleh memilih bitrate
aktual di bawah cap karena congestion control, scene, atau codec. Tidak ada
controller yang menurunkan target setiap beberapa detik dan tidak ada floor
buatan.

Backend menghitung `receivedBitrateKbps` dari delta `inboundBytes` MediaMTX
antar polling. Angka ini adalah estimasi data yang masuk ke MediaMTX, bukan
target bitrate dan bukan hasil speedtest. Angka rendah tidak otomatis berarti
encoder rusak; scene sederhana dan congestion control dapat membuat bitrate
aktual berada di bawah cap. Status error ditentukan dari status
path/connection dan error WHIP, bukan dari satu sample bitrate.

## 11. Security

- Dashboard cookie secure dan HttpOnly pada production.
- Password Argon2id; token media tidak disimpan plaintext di SQLite.
- CORS WebRTC MediaMTX wildcard diperlukan karena app dan media hostname
  berbeda; token callback tetap wajib.
- `/player` sengaja dapat di-iframe dan hanya membuka stream dengan read token.
- Referrer policy `no-referrer`; SRT URL tidak dikirim ke analytics.
- MediaMTX control/metrics/playback loopback-only.
- `maxReaders: 10` memberi ruang untuk OBS, player WHEP, dan pembaca lain per
  job. Nilai ini adalah gabungan semua protokol reader, bukan kuota SRT saja.

## 12. Verifikasi

```bash
go test ./...
cd frontend
npm run check
npm run build
npm run test:flow
```

Integration manual:

1. Buat job dengan Record off dan pastikan tidak ada file baru.
2. Start dari Chrome, pastikan WHIP OPTIONS/POST/PATCH sukses.
3. Pastikan MediaMTX log menunjukkan `WebRTC` dan path `ready/live`.
4. Masukkan SRT URL ke OBS dan pastikan satu reader.
5. Buka Result/player; WHEP harus menampilkan remote track.
6. Stop, buka kembali job dari Home, dan pastikan URL SRT sama.
7. Delete job; WHIP/WHEP/SRT token lama harus ditolak.
8. Record on; pastikan fMP4 muncul di `./data/recordings` dan dapat di-download.
