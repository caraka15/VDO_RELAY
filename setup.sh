#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUN_USER="$(id -un)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
CERTBOT_NAME='vdo-relay'
TEMP_FILES=()
LAST_TEMP_FILE=''

cleanup() {
  if ((${#TEMP_FILES[@]} > 0)); then
    rm -f -- "${TEMP_FILES[@]}"
  fi
}
trap cleanup EXIT

log() {
  printf '\n==> %s\n' "$*"
}

warn() {
  printf 'WARN: %s\n' "$*" >&2
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

temp_file() {
  LAST_TEMP_FILE="$(mktemp)"
  TEMP_FILES+=("$LAST_TEMP_FILE")
}

require_ubuntu() {
  [[ -r /etc/os-release ]] || die 'Sistem operasi tidak dapat dikenali. Jalankan di Ubuntu.'
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID:-}" == 'ubuntu' ]] || die "Script ini untuk Ubuntu; terdeteksi ${ID:-unknown}."
  UBUNTU_SUITE="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
  [[ -n "$UBUNTU_SUITE" ]] || die 'Ubuntu codename tidak ditemukan.'
}

require_privileges() {
  if ((EUID == 0)); then
    # Root sudah memiliki privilege penuh; buat pemanggilan sudo di bawah ini
    # tetap portable pada image Ubuntu minimal yang tidak memasang sudo.
    sudo() { "$@"; }
    return
  fi
  command -v sudo >/dev/null 2>&1 || die 'sudo belum tersedia.'
  sudo -v || die 'Tidak dapat memvalidasi akses sudo.'
  [[ -w "$SCRIPT_DIR" ]] || die "Folder project tidak writable oleh $RUN_USER. Jangan clone dengan sudo, atau perbaiki ownership folder project."
}

env_value() {
  local key="$1"
  local value=''
  if [[ -f "$SCRIPT_DIR/.env" ]]; then
    value="$(awk -v key="$key" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }' "$SCRIPT_DIR/.env")"
  fi
  value="${value#\"}"
  value="${value%\"}"
  printf '%s' "$value"
}

host_from_url() {
  local value="$1"
  value="${value#*://}"
  value="${value%%/*}"
  value="${value%%:*}"
  printf '%s' "$value"
}

valid_hostname() {
  local host="$1"
  local label
  local labels=()

  ((${#host} <= 253)) || return 1
  [[ "$host" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || return 1
  [[ "$host" == *.* && "$host" != *..* ]] || return 1
  IFS='.' read -r -a labels <<< "$host"
  ((${#labels[@]} >= 2)) || return 1
  for label in "${labels[@]}"; do
    ((${#label} <= 63)) || return 1
    [[ "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || return 1
  done
}

valid_ipv4() {
  local value="$1"
  local part
  local parts=()
  [[ "$value" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  IFS='.' read -r -a parts <<< "$value"
  ((${#parts[@]} == 4)) || return 1
  for part in "${parts[@]}"; do
    ((10#$part <= 255)) || return 1
  done
}

ask_hostname() {
  local label="$1"
  local default="$2"
  local value
  while true; do
    read -r -p "$label [$default]: " value
    value="${value:-$default}"
    if valid_hostname "$value"; then
      printf '%s' "$value"
      return
    fi
    warn "Hostname tidak valid: $value. Masukkan FQDN seperti app.example.com."
  done
}

ask_yes_no() {
  local prompt="$1"
  local answer
  read -r -p "$prompt [Y/n]: " answer
  [[ "${answer,,}" != 'n' ]]
}

detect_ipv4() {
  local candidate
  candidate="$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  if valid_ipv4 "$candidate"; then
    printf '%s' "$candidate"
  else
    return 0
  fi
}

ask_public_ipv4() {
  local detected="$1"
  local value
  while true; do
    if [[ -n "$detected" ]]; then
      read -r -p "IP publik server untuk instruksi DNS [$detected]: " value
      value="${value:-$detected}"
    else
      read -r -p 'IP publik server untuk instruksi DNS: ' value
    fi
    if valid_ipv4 "$value"; then
      printf '%s' "$value"
      return
    fi
    warn "IPv4 tidak valid: $value."
  done
}

ensure_docker_repository() {
  local architecture
  local source_file='/etc/apt/sources.list.d/docker.sources'
  architecture="$(dpkg --print-architecture)"
  sudo install -m 0755 -d /etc/apt/keyrings
  if ! sudo test -s /etc/apt/keyrings/docker.asc; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
    sudo chmod a+r /etc/apt/keyrings/docker.asc
  fi
  if sudo test -f "$source_file" && ! sudo grep -Fq 'download.docker.com/linux/ubuntu' "$source_file"; then
    sudo cp -- "$source_file" "${source_file}.backup.$TIMESTAMP"
    warn "Docker apt source lama disimpan di ${source_file}.backup.$TIMESTAMP"
  fi
  sudo tee "$source_file" >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $UBUNTU_SUITE
Components: stable
Architectures: $architecture
Signed-By: /etc/apt/keyrings/docker.asc
EOF
}

install_dependencies() {
  local auto_install="$1"

  if [[ "$auto_install" == 'yes' ]]; then
    log 'Memasang paket dasar Ubuntu'
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl gnupg

    if ! command -v docker >/dev/null 2>&1; then
      log 'Memasang Docker Engine'
      ensure_docker_repository
      sudo apt-get update
      sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
    fi

    sudo systemctl enable --now docker

    # Docker Engine harus siap sebelum plugin Compose dipasang.
    log 'Memasang Docker Compose plugin'
    if ! docker compose version >/dev/null 2>&1; then
      ensure_docker_repository
      sudo apt-get update
      sudo apt-get install -y docker-compose-plugin
    fi

    log 'Memasang Nginx dan Certbot'
    sudo apt-get update
    sudo apt-get install -y nginx certbot python3-certbot-nginx
  else
    command -v curl >/dev/null 2>&1 || die 'curl tidak tersedia. Jalankan ulang dan izinkan instalasi paket.'
    command -v docker >/dev/null 2>&1 || die 'Docker Engine tidak tersedia. Jalankan ulang dan izinkan instalasi paket.'
    sudo systemctl enable --now docker
    if ! docker compose version >/dev/null 2>&1 && ! sudo docker compose version >/dev/null 2>&1; then
      die 'Docker Compose plugin tidak tersedia. Jalankan ulang dan izinkan instalasi paket.'
    fi
    command -v nginx >/dev/null 2>&1 || die 'Nginx tidak tersedia. Jalankan ulang dan izinkan instalasi paket.'
    command -v certbot >/dev/null 2>&1 || die 'Certbot tidak tersedia. Jalankan ulang dan izinkan instalasi paket.'
  fi

  command -v docker >/dev/null 2>&1 || die 'Docker Engine gagal dipasang.'
  sudo systemctl is-active --quiet docker || die 'Docker service tidak aktif.'
  if ! docker compose version >/dev/null 2>&1 && ! sudo docker compose version >/dev/null 2>&1; then
    die 'Docker Compose plugin gagal dipasang.'
  fi
  sudo systemctl enable --now nginx
}

write_env() {
  local env_file="$SCRIPT_DIR/.env"
  local input='/dev/null'
  local output
  local backup
  [[ ! -L "$env_file" ]] || die '.env tidak boleh berupa symbolic link.'
  if [[ -f "$env_file" ]]; then
    input="$env_file"
    backup="$env_file.backup.$TIMESTAMP"
    cp -- "$env_file" "$backup"
    chmod 600 "$backup"
    log "Backup .env dibuat: $backup"
  fi

  temp_file
  output="$LAST_TEMP_FILE"
  awk -v public_origin="$VDO_PUBLIC_ORIGIN" \
    -v moq_url="$VDO_MOQ_PUBLIC_BASE_URL" \
    -v srt_host="$VDO_SRT_PUBLIC_HOST" '
    /^[[:space:]]*VDO_PUBLIC_ORIGIN[[:space:]]*=/ {
      if (!seen["VDO_PUBLIC_ORIGIN"]++) print "VDO_PUBLIC_ORIGIN=" public_origin
      next
    }
    /^[[:space:]]*VDO_MOQ_PUBLIC_BASE_URL[[:space:]]*=/ {
      if (!seen["VDO_MOQ_PUBLIC_BASE_URL"]++) print "VDO_MOQ_PUBLIC_BASE_URL=" moq_url
      next
    }
    /^[[:space:]]*VDO_SRT_PUBLIC_HOST[[:space:]]*=/ {
      if (!seen["VDO_SRT_PUBLIC_HOST"]++) print "VDO_SRT_PUBLIC_HOST=" srt_host
      next
    }
    { print }
    END {
      if (!seen["VDO_PUBLIC_ORIGIN"]) print "VDO_PUBLIC_ORIGIN=" public_origin
      if (!seen["VDO_MOQ_PUBLIC_BASE_URL"]) print "VDO_MOQ_PUBLIC_BASE_URL=" moq_url
      if (!seen["VDO_SRT_PUBLIC_HOST"]) print "VDO_SRT_PUBLIC_HOST=" srt_host
    }
  ' "$input" > "$output"
  chmod 600 "$output"
  mv -- "$output" "$env_file"
}

install_nginx_config() {
  local available='/etc/nginx/sites-available/vdo-relay'
  local enabled='/etc/nginx/sites-enabled/vdo-relay'
  local rendered
  local backup
  local has_vdo='no'
  local has_domains='no'

  sudo install -d -m 0755 /var/www/certbot
  temp_file
  rendered="$LAST_TEMP_FILE"
  sed \
    -e "s/app\\.example\\.com/$APP_DOMAIN/g" \
    -e "s/media\\.example\\.com/$MEDIA_DOMAIN/g" \
    "$SCRIPT_DIR/deploy/nginx/vdo-relay.conf" > "$rendered"

  if sudo test -f "$available" && sudo grep -Fq '# VDO Relay Nginx vhost.' "$available"; then
    has_vdo='yes'
    if sudo grep -Fq "server_name $APP_DOMAIN;" "$available" \
      && sudo grep -Fq "server_name $MEDIA_DOMAIN;" "$available"; then
      has_domains='yes'
    fi
  fi

  if [[ "$has_domains" != 'yes' ]]; then
    if sudo test -e "$available"; then
      backup="${available}.backup.$TIMESTAMP"
      sudo cp -- "$available" "$backup"
      warn "Konfigurasi Nginx lama disimpan di $backup"
    fi
    sudo install -m 0644 "$rendered" "$available"
  elif [[ "$has_vdo" == 'yes' ]]; then
    log 'Mempertahankan konfigurasi Nginx VDO yang sudah dipasang Certbot'
  fi

  if sudo test -e "$enabled" && ! sudo test -L "$enabled"; then
    sudo mv -- "$enabled" "${enabled}.backup.$TIMESTAMP"
  fi
  sudo ln -sfn "$available" "$enabled"
  sudo nginx -t
  sudo systemctl reload nginx
}

resolve_ipv4() {
  getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u || true
}

contains_ipv4() {
  local expected="$1"
  local records="$2"
  local record
  while read -r record; do
    [[ "$record" == "$expected" ]] && return 0
  done <<< "$records"
  return 1
}

wait_for_dns() {
  local records_app
  local records_media
  local records_app_v6
  local records_media_v6
  local answer

  printf '\nDNS yang harus dibuat sebelum Certbot:\n'
  printf '  A %s -> %s\n' "$APP_DOMAIN" "$PUBLIC_IPV4"
  printf '  A %s -> %s\n' "$MEDIA_DOMAIN" "$PUBLIC_IPV4"
  printf '\nPastikan port 80/tcp sudah menuju server ini. Setelah DNS selesai, tekan Enter.\n'
  read -r -p '> '

  while true; do
    records_app="$(resolve_ipv4 "$APP_DOMAIN")"
    records_media="$(resolve_ipv4 "$MEDIA_DOMAIN")"
    records_app_v6="$(getent ahostsv6 "$APP_DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u || true)"
    records_media_v6="$(getent ahostsv6 "$MEDIA_DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u || true)"
    printf '\nDNS saat ini:\n'
    printf '  %s: %s\n' "$APP_DOMAIN" "${records_app:-belum terdeteksi}"
    printf '  %s: %s\n' "$MEDIA_DOMAIN" "${records_media:-belum terdeteksi}"
    if [[ -n "$records_app_v6$records_media_v6" ]]; then
      warn 'AAAA record terdeteksi. Pastikan IPv6 juga menuju server ini, atau hapus AAAA sebelum Certbot.'
    fi

    if contains_ipv4 "$PUBLIC_IPV4" "$records_app" && contains_ipv4 "$PUBLIC_IPV4" "$records_media"; then
      log 'DNS app dan media sudah mengarah ke IP server'
      return
    fi

    warn 'DNS belum cocok. Tunggu propagasi lalu tekan Enter untuk mencoba lagi.'
    read -r -p "Ketik CONTINUE untuk lanjut paksa, atau Enter untuk cek lagi: " answer
    if [[ "$answer" == 'CONTINUE' ]]; then
      warn 'Certbot dilanjutkan secara paksa; issuance masih bisa gagal jika DNS belum siap.'
      return
    fi
  done
}

find_certificate_lineage() {
  local direct="/etc/letsencrypt/live/$CERTBOT_NAME"
  local found

  if sudo test -r "$direct/fullchain.pem" && sudo test -r "$direct/privkey.pem"; then
    printf '%s' "$direct"
    return
  fi

  found="$(sudo certbot certificates 2>/dev/null | awk -v app="$APP_DOMAIN" -v media="$MEDIA_DOMAIN" '
    /^ *Certificate Name:/ { name=$3 }
    /^ *Domains:/ {
      has_app=0
      has_media=0
      for (i=3; i<=NF; i++) {
        if ($i == app) has_app=1
        if ($i == media) has_media=1
      }
      if (has_app && has_media && found == "") found=name
    }
    END { if (found != "") print found }
  ')"
  [[ -n "$found" ]] || return 1
  printf '/etc/letsencrypt/live/%s' "$found"
}

install_certificate_and_hook() {
  local lineage
  local hook='/etc/letsencrypt/renewal-hooks/deploy/vdo-relay'
  local hook_target="$SCRIPT_DIR/deploy/certbot/vdo-relay-deploy-hook.sh"

  lineage="$(find_certificate_lineage)" || die 'Certificate lineage tidak ditemukan setelah Certbot selesai.'
  sudo install -m 0644 "$lineage/fullchain.pem" "$SCRIPT_DIR/certs/server.crt"
  sudo install -m 0600 "$lineage/privkey.pem" "$SCRIPT_DIR/certs/server.key"

  sudo install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
  if sudo test -e "$hook" && ! sudo test -L "$hook"; then
    sudo mv -- "$hook" "${hook}.backup.$TIMESTAMP"
  fi
  sudo chmod 0755 "$hook_target"
  sudo ln -sfn "$hook_target" "$hook"
  sudo systemctl reload nginx
  log "Certificate terpasang untuk MediaMTX dari $lineage"
}

run_compose() {
  if docker info >/dev/null 2>&1; then
    docker compose --project-directory "$SCRIPT_DIR" "$@"
  else
    sudo docker compose --project-directory "$SCRIPT_DIR" "$@"
  fi
}

wait_for_app_health() {
  local url="$1"
  local attempt
  for ((attempt = 1; attempt <= 10; attempt++)); do
    if curl -fsS --max-time 5 "$url" >/dev/null; then
      return 0
    fi
    sleep 3
  done
  return 1
}

media_http_status() {
  curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "$1" || true
}

health_check() {
  local app_url="https://$APP_DOMAIN/healthz"
  local media_url="https://$MEDIA_DOMAIN:8892/"
  local media_status
  local attempt
  local failures=0

  log 'Memeriksa health endpoint app'
  if wait_for_app_health "$app_url"; then
    printf 'OK  %s\n' "$app_url"
  else
    printf 'FAIL %s\n' "$app_url" >&2
    failures=$((failures + 1))
  fi

  log 'Memeriksa TLS/HTTP endpoint media'
  media_status=''
  for ((attempt = 1; attempt <= 10; attempt++)); do
    media_status="$(media_http_status "$media_url")"
    if [[ "$media_status" =~ ^[234][0-9][0-9]$ ]]; then
      printf 'OK  %s (HTTP %s; endpoint MediaMTX merespons)\n' "$media_url" "$media_status"
      break
    fi
    sleep 3
  done
  if ! [[ "$media_status" =~ ^[234][0-9][0-9]$ ]]; then
    printf 'FAIL %s (HTTP %s)\n' "$media_url" "${media_status:-000}" >&2
    failures=$((failures + 1))
  fi

  return "$failures"
}

main() {
  local existing_app
  local existing_media
  local app_default
  local media_default
  local auto_install='no'
  local detected_ip
  local compose_user_note=''
  local app_health_status=0
  local certbot_help
  local -a certbot_args

  require_ubuntu
  require_privileges

  existing_app="$(env_value VDO_PUBLIC_ORIGIN)"
  existing_media="$(env_value VDO_SRT_PUBLIC_HOST)"
  app_default="$(host_from_url "$existing_app")"
  media_default="${existing_media:-$(host_from_url "$(env_value VDO_MOQ_PUBLIC_BASE_URL)")}"
  app_default="${app_default:-app.example.com}"
  media_default="${media_default:-media.example.com}"

  printf 'VDO Relay setup untuk Ubuntu. Project: %s\n' "$SCRIPT_DIR"
  APP_DOMAIN="$(ask_hostname 'Domain web/app' "$app_default")"
  MEDIA_DOMAIN="$(ask_hostname 'Domain media/SRT' "$media_default")"
  [[ "$APP_DOMAIN" != "$MEDIA_DOMAIN" ]] || die 'Domain app dan media harus berbeda agar konfigurasi lebih jelas.'

  if ask_yes_no 'Install paket yang belum ada (Docker Engine, Compose plugin, Nginx, Certbot)?'; then
    auto_install='yes'
  fi
  install_dependencies "$auto_install"

  detected_ip="$(detect_ipv4)"
  PUBLIC_IPV4="$(ask_public_ipv4 "$detected_ip")"
  CERTBOT_EMAIL="admin@$MEDIA_DOMAIN"
  VDO_PUBLIC_ORIGIN="https://$APP_DOMAIN"
  VDO_MOQ_PUBLIC_BASE_URL="https://$MEDIA_DOMAIN:8892"
  VDO_SRT_PUBLIC_HOST="$MEDIA_DOMAIN"

  log 'Menyimpan konfigurasi domain ke .env'
  write_env
  install_nginx_config
  wait_for_dns

  log "Meminta certificate dengan email $CERTBOT_EMAIL"
  certbot_args=(
    --nginx
    --non-interactive
    --agree-tos
    --no-eff-email
    --email "$CERTBOT_EMAIL"
    --redirect
    --cert-name "$CERTBOT_NAME"
  )
  certbot_help="$(sudo certbot --help all 2>/dev/null || true)"
  if [[ "$certbot_help" == *'--renew-with-new-domains'* ]]; then
    certbot_args+=(--renew-with-new-domains)
  else
    # Older Certbot releases use --expand for an existing lineage.
    certbot_args+=(--expand)
  fi
  sudo certbot "${certbot_args[@]}" -d "$APP_DOMAIN" -d "$MEDIA_DOMAIN"
  install_certificate_and_hook

  log 'Validasi compose dan build image'
  run_compose config >/dev/null
  run_compose up -d --build

  # Menjaga command operasional tetap `docker compose`; sudo hanya dipakai
  # sementara jika membership group docker belum aktif pada shell ini.
  if ! docker info >/dev/null 2>&1; then
    sudo usermod -aG docker "$RUN_USER"
    compose_user_note='Logout/login sekali agar user dapat menjalankan docker compose tanpa sudo.'
  fi

  if ! health_check; then
    warn 'Health check gagal. Periksa log dengan: docker compose logs --tail=200 vdo'
    app_health_status=1
  fi

  cat <<EOF

Setup selesai.

Web app:       https://$APP_DOMAIN
Health app:    https://$APP_DOMAIN/healthz
Media check:   https://$MEDIA_DOMAIN:8892/
SRT output:    srt://$MEDIA_DOMAIN:8890
Login awal:    admin / admin (wajib ganti password)

Pastikan firewall/security group membuka:
  80/tcp  443/tcp  8892/tcp  8892/udp  8890/udp

Nginx hanya menangani web dan ACME. SRT serta WebTransport tetap langsung ke
port MediaMTX 8890/8892.
${compose_user_note}
EOF

  return "$app_health_status"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
