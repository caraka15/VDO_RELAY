# VDO Relay

VDO Relay adalah private camera relay untuk Android Chrome dan desktop Chrome.
Browser melakukan capture, framing 16:9, dan encode H.264/H.265. MediaMTX
menerima hasil encode tersebut lalu menyediakan output SRT untuk OBS tanpa
server-side transcoding.

## Setup otomatis Ubuntu

Rekomendasi nama repository GitHub: `vdo-relay`.

Setelah repository di-clone ke server Ubuntu:

```bash
git clone https://github.com/USERNAME/vdo-relay.git
cd vdo-relay
./setup.sh
```

Jika GitHub tidak mempertahankan executable bit saat repository dipush, jalankan
sekali `chmod +x setup.sh update.sh`. Sebelum push, gunakan
`git update-index --chmod=+x setup.sh update.sh` supaya clone berikutnya bisa
langsung memakai kedua script.

Script akan menanyakan:

- domain web/app;
- domain media/SRT;
- IP publik server untuk instruksi DNS;
- izin memasang paket yang belum tersedia.

Kemudian script secara berurutan akan:

1. memasang Docker Engine jika belum ada;
2. memasang Docker Compose plugin setelah Docker Engine siap;
3. menjalankan operasi container dengan command `docker compose`;
4. memasang Nginx, Certbot, dan plugin Certbot Nginx;
5. membuat `.env` dan vhost Nginx dari domain yang dipilih;
6. menampilkan record DNS yang harus dibuat dan menunggu konfirmasi;
7. mengecek kedua record `A` sebelum memanggil Certbot;
8. meminta certificate dengan email otomatis `admin@<domain-media>`;
9. menyalin certificate ke MediaMTX dan memasang renewal hook;
10. menjalankan `docker compose up -d --build`;
11. mengecek health app dan respons TLS/HTTP MediaMTX.

DNS harus dibuat seperti ini, keduanya menuju IP server yang sama:

```text
A app.example.com    -> IP_SERVER
A media.example.com  -> IP_SERVER
```

Jika hostname memiliki `AAAA`, IPv6 juga harus menuju server yang sama atau
record tersebut perlu dihapus sementara; Let's Encrypt dapat memilih IPv6 saat
melakukan validasi.

Script menunggu propagasi DNS. Ada pilihan `CONTINUE` untuk kondisi khusus
seperti NAT atau load balancer, tetapi issuance Certbot tetap dapat gagal jika
domain belum benar-benar mencapai server.

Script bisa dijalankan sebagai `root` atau sebagai user biasa yang memiliki
akses `sudo`. Jika sudah login sebagai `root`, langsung jalankan
`./setup.sh`; tidak perlu menambahkan `sudo`. Setelah setup selesai, logout/login
sekali jika script memberi catatan membership group Docker belum aktif.

## Update deployment

Untuk deployment yang sudah pernah menjalankan setup:

```bash
./update.sh
```

`update.sh` melakukan `git pull --ff-only`, memeriksa key baru pada
`.env.example`, lalu menjalankan `docker compose up -d --build`. Key environment
yang sudah ada tidak diubah. Jika rilis menambahkan key baru, script akan
memintanya secara interaktif. Perubahan source yang belum di-commit akan
menghentikan update agar tidak tertimpa; file ignored seperti `.env`, `data/`,
certificate, `node_modules`, dan `dist` tidak menghalangi pull.

## Domain dan arsitektur jaringan

Gunakan dua hostname. `api.example.com` tidak diperlukan karena frontend dan
API disajikan Go pada origin yang sama; cookie session tidak memerlukan CORS.

```text
app.example.com    -> Nginx :443 -> Go + Svelte :8443
media.example.com  -> MediaMTX :8892 TCP/UDP dan :8890 UDP
```

Nginx hanya menangani web dan HTTP-01 challenge Certbot. Nginx tidak mem-proxy
SRT atau WebTransport. Hostname `media` harus DNS-only jika memakai provider
proxy HTTP yang tidak meneruskan UDP.

Port publik:

```text
80/tcp, 443/tcp    Nginx dan HTTPS app
8892/tcp, 8892/udp Media-over-QUIC/WebTransport
8890/udp           SRT read untuk OBS
```

Domain memang disimpan di `.env` dan boleh diganti dengan menjalankan ulang
`./setup.sh`. Nilai yang ditulis script:

```env
VDO_PUBLIC_ORIGIN=https://app.example.com
VDO_MOQ_PUBLIC_BASE_URL=https://media.example.com:8892
VDO_SRT_PUBLIC_HOST=media.example.com
```

Jangan menaruh dua domain dalam satu variable. `.env` tidak di-commit.
Script membuat backup `.env` lama sebelum memperbarui tiga variable tersebut.

## Nginx, TLS, dan renewal

Template awal ada di
[`deploy/nginx/vdo-relay.conf`](deploy/nginx/vdo-relay.conf). Template sengaja
hanya mendengarkan port 80. Certbot menambahkan server block HTTPS sendiri.

Certificate lineage `vdo-relay` yang sama dipakai Nginx dan MediaMTX WebTransport. Renewal hook
[`deploy/certbot/vdo-relay-deploy-hook.sh`](deploy/certbot/vdo-relay-deploy-hook.sh)
menyalin certificate baru ke `certs/` lalu me-restart service VDO melalui
`docker compose`. Hook yang dipasang oleh `setup.sh` mengikuti lokasi clone,
jadi project tidak wajib berada di `/opt/vdo`.

Uji renewal setelah setup:

```bash
sudo certbot renew --dry-run
```

Jangan menghapus rule firewall/security group berikut:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8892/tcp
sudo ufw allow 8892/udp
sudo ufw allow 8890/udp
```

Setup tidak mengubah UFW secara otomatis untuk menghindari mengunci akses SSH.

## Penggunaan

1. Buka `https://app.example.com` dan login dengan `admin` / `admin`.
2. Ganti password saat diminta.
3. Buat stream baru, lalu jalankan deteksi device dan preflight.
4. Pilih H.264 atau H.265, resolusi, FPS, bitrate maksimum, audio, portrait,
   dan recording.
5. Saat live, buka **Result**.

Halaman Result menyediakan:

- player live bawaan MediaMTX;
- SRT URL lengkap dengan read token;
- langkah konfigurasi OBS;
- link player terpisah;
- kode HTML `<iframe>` untuk embed.

Player memakai halaman browser bawaan MediaMTX melalui MoQ. Browser yang
membuka player harus mendukung decoder codec yang dipakai; H.264 paling aman
untuk kompatibilitas umum.

### OBS

Di OBS:

1. Tambahkan **Media Source**.
2. Matikan **Local File**.
3. Tempel SRT URL dari halaman Result.
4. Gunakan input format `mpegts`.

SRT URL berbentuk:

```text
srt://media.example.com:8890?streamid=read:<path>:user:<token>&latency=2000000&pkt_size=1316
```

Token read hanya diberikan kepada operator yang membuat stream dan dicabut
saat stream dihentikan. Jangan membagikan URL tersebut sembarangan.

### Health check

App menyediakan:

```text
https://app.example.com/healthz
```

Setup memanggil endpoint tersebut. Untuk domain media, setup memeriksa
`https://media.example.com:8892/`; semua respons HTTP 2xx–4xx berarti listener
TLS/HTTP MediaMTX merespons. SRT tetap perlu diuji dari OBS karena SRT memakai
UDP dan bukan HTTP health endpoint.

## Operasional

```bash
docker compose ps
docker compose logs --tail=200 -f vdo
docker compose restart vdo
docker compose up -d --build
```

Login awal selalu `admin` / `admin` pada database baru. Password wajib diganti
pada login pertama. SQLite dan recording berada di host pada bind mount:
`data/app.db` dan `data/recordings/`. Folder `data/` di-ignore Git, sehingga
`docker compose up -d --build` tidak menghapus database atau recording.
Container menulis folder tersebut sebagai UID/GID `10001`; gunakan `sudo` bila
ingin membaca atau menyalin file langsung dari host.

Recording default disimpan sebagai fMP4 tanpa re-encode. Retention default
adalah 24 jam dan path recording dibuat melalui MediaMTX Control API.

## Struktur project

```text
setup.sh                             setup deployment Ubuntu satu perintah
update.sh                            pull aman dan rebuild deployment
frontend/src/App.svelte              flow dan state halaman
frontend/src/components/             Login, Setup, Live, Result, Dashboard
frontend/src/lib/media.ts            kamera, canvas, WebCodecs, bitrate adaptif
internal/app/                        Go API, auth, SQLite, MediaMTX control
deploy/nginx/                        vhost HTTP awal untuk Certbot
deploy/certbot/                      renewal hook certificate
compose.yaml                         container dan port MediaMTX
data/                                SQLite dan recording (bind mount, ignored)
```

## Push ke GitHub

Jalankan dari folder project setelah memastikan `.env`, `data/`, dan
certificate tidak masuk staging:

```bash
git init
git add .
git update-index --chmod=+x setup.sh
git status
git commit -m "Initial VDO Relay"
git branch -M main
git remote add origin git@github.com:USERNAME/vdo-relay.git
git push -u origin main
```

`.gitignore` mengecualikan `.env`, database, recording, certificate,
`node_modules`, dan hasil build.

## Development dan validasi

Frontend:

```bash
cd frontend
npm install
npm run check
npm run build
```

Backend dan script:

```bash
cd ..
go test ./...
go vet ./...
bash -n setup.sh
```

Dokumentasi detail ada di [docs/PRD.md](docs/PRD.md) dan
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Referensi resmi

- [Docker Engine di Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Docker Compose plugin di Linux](https://docs.docker.com/compose/install/linux/)
- [Certbot Nginx](https://eff-certbot.readthedocs.io/en/stable/man/certbot.html)
- [MediaMTX browser read/embed](https://mediamtx.org/docs/read/web-browsers)
- [MediaMTX MoQ publishing](https://mediamtx.org/docs/publish/moq-clients)
- [MediaMTX SRT read](https://mediamtx.org/docs/read/srt)
