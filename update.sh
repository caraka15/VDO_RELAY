#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
RUN_USER="$(id -un)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
CERTBOT_NAME='vdo-relay'
TEMP_FILES=()

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
  local file
  file="$(mktemp)"
  TEMP_FILES+=("$file")
  printf '%s' "$file"
}

require_privileges() {
  if ((EUID == 0)); then
    # Root sudah memiliki privilege penuh; tetap dukung pemanggilan sudo di bawah.
    sudo() { "$@"; }
    return
  fi
  command -v sudo >/dev/null 2>&1 || die 'sudo belum tersedia.'
  sudo -v || die 'Tidak dapat memvalidasi akses sudo.'
  [[ -w "$SCRIPT_DIR" ]] || die "Folder project tidak writable oleh $RUN_USER."
}

env_value() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  awk -v key="$key" '
    index($0, key "=") == 1 {
      value = substr($0, length(key) + 2)
      if (value ~ /^".*"$/) value = substr(value, 2, length(value) - 2)
      print value
      exit
    }
  ' "$ENV_FILE"
}

example_env_value() {
  local key="$1"
  awk -v key="$key" '
    index($0, key "=") == 1 {
      value = substr($0, length(key) + 2)
      if (value ~ /^".*"$/) value = substr(value, 2, length(value) - 2)
      print value
      exit
    }
  ' "$SCRIPT_DIR/.env.example"
}

escape_env_value() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
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

ensure_runtime_dependencies() {
  command -v git >/dev/null 2>&1 || die 'git belum tersedia.'
  command -v docker >/dev/null 2>&1 || die 'Docker Engine belum tersedia. Instalasi awal memakai ./setup.sh.'
  if ! docker compose version >/dev/null 2>&1 && ! sudo docker compose version >/dev/null 2>&1; then
    die 'Docker Compose plugin belum tersedia. Instalasi awal memakai ./setup.sh.'
  fi
  command -v nginx >/dev/null 2>&1 || die 'Nginx belum tersedia. Instalasi awal memakai ./setup.sh.'
  command -v certbot >/dev/null 2>&1 || die 'Certbot belum tersedia. Instalasi awal memakai ./setup.sh.'
}

ensure_env_keys() {
  [[ -f "$ENV_FILE" ]] || die ".env belum ada. Jalankan ./setup.sh untuk instalasi pertama."
  [[ -f "$SCRIPT_DIR/.env.example" ]] || die '.env.example tidak ditemukan setelah git pull.'
  [[ -w "$ENV_FILE" ]] || die ".env tidak writable oleh $RUN_USER."

  local line key current example value
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)= ]]; then
      key="${BASH_REMATCH[1]}"
      current="$(env_value "$key")"
      [[ -n "$current" ]] && continue

      example="$(example_env_value "$key")"
      if [[ -n "$example" && "$example" != *example.com* && "$example" != *CHANGE_ME* ]]; then
        read -r -p "Nilai baru $key [$example]: " value
        value="${value:-$example}"
      else
        read -r -p "Nilai baru $key: " value
      fi
      [[ -n "$value" ]] || die "Nilai $key wajib diisi."
      printf '\n%s="%s"\n' "$key" "$(escape_env_value "$value")" >> "$ENV_FILE"
      printf '  tersimpan: %s\n' "$key"
    fi
  done < "$SCRIPT_DIR/.env.example"
  chmod 600 "$ENV_FILE"
}

# TEMPORARY WHIP MIGRATION: remove this function after old MoQ deployments
# have completed one update. It preserves unrelated env values and removes
# the obsolete key.
migrate_whip_env() {
  local web_url old_moq media_host srt_host output backup
  web_url="$(env_value VDO_WEBRTC_PUBLIC_BASE_URL)"
  old_moq="$(env_value VDO_MOQ_PUBLIC_BASE_URL)"

  if [[ -z "$web_url" ]]; then
    srt_host="$(env_value VDO_SRT_PUBLIC_HOST)"
    media_host="$(host_from_url "${srt_host:-$old_moq}")"
    if [[ -z "$media_host" ]]; then
      return 0
    fi
    valid_hostname "$media_host" || die "Hostname media tidak valid: $media_host"
    web_url="https://$media_host"
    log "Membuat VDO_WEBRTC_PUBLIC_BASE_URL dari hostname media: $web_url"
  fi

  output="$(temp_file)"
  awk -v web_url="$web_url" '
    /^[[:space:]]*VDO_MOQ_PUBLIC_BASE_URL[[:space:]]*=/ { next }
    /^[[:space:]]*VDO_WEBRTC_PUBLIC_BASE_URL[[:space:]]*=/ {
      if (!seen["webrtc"]++) print "VDO_WEBRTC_PUBLIC_BASE_URL=" web_url
      next
    }
    { print }
    END {
      if (!seen["webrtc"]) print "VDO_WEBRTC_PUBLIC_BASE_URL=" web_url
    }
  ' "$ENV_FILE" > "$output"

  if ! cmp -s "$output" "$ENV_FILE"; then
    backup="$ENV_FILE.backup.$TIMESTAMP"
    cp -- "$ENV_FILE" "$backup"
    chmod 600 "$backup" "$output"
    mv -- "$output" "$ENV_FILE"
    log "Env WHIP tersimpan; backup lama: $backup"
  fi
}

ensure_clean_worktree() {
  local changes
  changes="$(git -c core.fileMode=false status --porcelain --untracked-files=all)"
  [[ -z "$changes" ]] || {
    printf '%s\n' "$changes" >&2
    die 'Ada perubahan source atau file untracked. Commit/pindahkan dulu sebelum update.'
  }
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
      for (i=2; i<=NF; i++) {
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

install_certificate_files() {
  local lineage hook hook_target
  lineage="$(find_certificate_lineage)" || die 'Certificate untuk domain app/media tidak ditemukan.'
  sudo install -d -m 0750 "$SCRIPT_DIR/certs"
  sudo install -m 0644 "$lineage/fullchain.pem" "$SCRIPT_DIR/certs/server.crt"
  sudo install -m 0600 "$lineage/privkey.pem" "$SCRIPT_DIR/certs/server.key"

  hook='/etc/letsencrypt/renewal-hooks/deploy/vdo-relay'
  hook_target="$SCRIPT_DIR/deploy/certbot/vdo-relay-deploy-hook.sh"
  if sudo test -f "$hook_target"; then
    sudo install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
    sudo chmod 0755 "$hook_target"
    sudo ln -sfn "$hook_target" "$hook"
  fi
  sudo systemctl reload nginx
  log "Certificate tersinkron dari $lineage ke certs/"
}

nginx_needs_whip_migration() {
  local available='/etc/nginx/sites-available/vdo-relay'
  if ! sudo test -f "$available"; then
    return 0
  fi
  if ! sudo grep -Fq '# VDO Relay Nginx vhost.' "$available"; then
    die "$available bukan vhost VDO Relay yang dikenali; backup manual diperlukan sebelum update."
  fi
  if sudo awk -v media="$MEDIA_DOMAIN" '
    /^[[:space:]]*server_name[[:space:]]+/ {
      field_count = split($0, fields, /[[:space:]]+/)
      for (i = 1; i <= field_count; i++) {
        name = fields[i]
        sub(/;$/, "", name)
        if (name == media) media_name = 1
      }
    }
    /^[[:space:]]*proxy_pass[[:space:]]+https:\/\/127\.0\.0\.1:8889;[[:space:]]*$/ {
      if (media_name) found = 1
    }
    END { exit(found ? 0 : 1) }
  ' "$available"; then
    return 1
  fi
  return 0
}

# TEMPORARY WHIP MIGRATION: patch only the known old media location. Do not
# replace this with a full vhost render: Certbot and operators may have added
# HTTPS/custom directives that must survive an update.
migrate_nginx_to_whip() {
  local available='/etc/nginx/sites-available/vdo-relay'
  local rendered backup has_health='no'

  if ! nginx_needs_whip_migration; then
    log 'Nginx VDO sudah memakai proxy WHIP/WHEP port 8889'
    return 0
  fi

  sudo test -f "$available" || die "$available tidak ditemukan; update tidak akan membuat atau mengganti vhost secara otomatis."
  sudo grep -Fq '# VDO Relay Nginx vhost.' "$available" || die "$available bukan vhost VDO Relay yang dikenali; tidak disentuh."

  # A Certbot-managed deployment should already have HTTPS. If it does not,
  # stop instead of trying to make Certbot rewrite a possibly custom vhost.
  if ! sudo grep -Eq '^[[:space:]]*listen[[:space:]]+(\[::\]:)?443([[:space:];]|$)' "$available"; then
    die "Listener HTTPS 443 tidak ditemukan di $available. Tidak ada perubahan Nginx; periksa vhost/Certbot secara manual."
  fi

  if sudo grep -Eq '^[[:space:]]*location[[:space:]]*=[[:space:]]*/healthz[[:space:]]*\{' "$available"; then
    has_health='yes'
  fi

  rendered="$(temp_file)"
  if ! sudo awk -v app="$APP_DOMAIN" -v media="$MEDIA_DOMAIN" -v has_health="$has_health" '
    function brace_delta(line, copy, opens, closes) {
      copy = line
      sub(/#.*/, "", copy)
      opens = gsub(/\{/, "", copy)
      copy = line
      sub(/#.*/, "", copy)
      closes = gsub(/\}/, "", copy)
      return opens - closes
    }
    function indent_of(line) {
      match(line, /^[[:space:]]*/)
      return substr(line, RSTART, RLENGTH)
    }
    function print_health(indent) {
      print indent "location = /healthz {"
      print indent "    proxy_pass https://127.0.0.1:8443/healthz;"
      print indent "    proxy_ssl_server_name on;"
      print indent "    proxy_ssl_name " app ";"
      print indent "    proxy_ssl_verify off;"
      print indent "    proxy_set_header Host " app ";"
      print indent "    proxy_set_header X-Forwarded-Proto $scheme;"
      print indent "}"
    }
    function print_whip(indent) {
      print indent "location / {"
      print indent "    proxy_pass https://127.0.0.1:8889;"
      print indent "    proxy_ssl_server_name on;"
      print indent "    proxy_ssl_name " media ";"
      print indent "    proxy_ssl_verify off;"
      print ""
      print indent "    proxy_http_version 1.1;"
      print indent "    proxy_set_header Host $host;"
      print indent "    proxy_set_header X-Real-IP $remote_addr;"
      print indent "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"
      print indent "    proxy_set_header X-Forwarded-Proto $scheme;"
      print indent "    proxy_buffering off;"
      print indent "    proxy_read_timeout 3600s;"
      print indent "}"
    }
    BEGIN {
      server_depth = 0
      media_server = 0
      candidate = 0
      patched = 0
    }
    {
      line = $0

      # The old vhost has this exact three-line block. Anything less exact is
      # left alone so a custom location cannot be silently replaced.
      if (candidate == 1) {
        if (line ~ /^[[:space:]]*return[[:space:]]+404;[[:space:]]*$/) {
          candidate_return = line
          candidate = 2
          next
        }
        print candidate_root
        candidate = 0
      }
      if (candidate == 2) {
        if (line ~ /^[[:space:]]*\}[[:space:]]*$/) {
          if (has_health != "yes") print_health(candidate_indent)
          print_whip(candidate_indent)
          patched++
          candidate = 0
          if (server_depth > 0) {
            server_depth += brace_delta(line)
            if (server_depth <= 0) {
              server_depth = 0
              media_server = 0
            }
          }
          next
        }
        print candidate_root
        print candidate_return
        candidate = 0
      }

      server_start = (server_depth == 0 && line ~ /^[[:space:]]*server[[:space:]]*\{[[:space:]]*$/)
      if (server_depth > 0 && line ~ /^[[:space:]]*server_name[[:space:]]+/) {
        field_count = split(line, fields, /[[:space:]]+/)
        for (i = 1; i <= field_count; i++) {
          name = fields[i]
          sub(/;$/, "", name)
          if (name == media) media_server = 1
        }
      }

      if (media_server && line ~ /^[[:space:]]*location[[:space:]]+\/[[:space:]]*\{[[:space:]]*$/) {
        candidate_root = line
        candidate_indent = indent_of(line)
        candidate = 1
        if (server_start) server_depth = brace_delta(line)
        else server_depth += brace_delta(line)
        next
      }

      print line
      if (server_start) server_depth = brace_delta(line)
      else if (server_depth > 0) server_depth += brace_delta(line)
      if (server_depth <= 0) {
        server_depth = 0
        media_server = 0
      }
    }
    END {
      if (candidate == 1) print candidate_root
      else if (candidate == 2) {
        print candidate_root
        print candidate_return
      }
      if (patched == 0) exit 2
    }
  ' "$available" > "$rendered"; then
    die "Blok media lama tidak dikenali di $available; tidak ada perubahan Nginx. Backup/manual review diperlukan."
  fi

  if ! grep -Fq 'proxy_pass https://127.0.0.1:8889;' "$rendered"; then
    die 'Patch Nginx tidak menghasilkan proxy WHIP yang diharapkan; tidak ada perubahan Nginx.'
  fi

  backup="${available}.backup.${TIMESTAMP}"
  while sudo test -e "$backup"; do
    backup="${available}.backup.${TIMESTAMP}.$RANDOM"
  done
  sudo cp -- "$available" "$backup"
  warn "Vhost Nginx sebelum patch disimpan di $backup"
  sudo install -m 0644 "$rendered" "$available"

  if ! sudo nginx -t; then
    warn 'nginx -t gagal; mengembalikan vhost sebelum patch.'
    sudo install -m 0644 "$backup" "$available"
    sudo nginx -t || warn 'nginx -t juga gagal setelah rollback; jangan reload Nginx sebelum diperbaiki manual.'
    die 'Migrasi Nginx dibatalkan dan vhost dikembalikan.'
  fi
  sudo systemctl reload nginx
  log 'Nginx dipatch aman: hanya media location lama yang diarahkan ke WHIP/WHEP port 8889; blok Certbot tetap dipertahankan.'
}

ensure_firewall_ports() {
  if ! command -v ufw >/dev/null 2>&1 || ! sudo ufw status 2>/dev/null | grep -Fq 'Status: active'; then
    return 0
  fi
  sudo ufw allow 8189/udp >/dev/null
  sudo ufw allow 8890/udp >/dev/null
  log 'UFW aktif: port 8189/udp dan 8890/udp diizinkan'
}

run_compose() {
  if docker info >/dev/null 2>&1; then
    docker compose --project-directory "$SCRIPT_DIR" "$@"
  else
    sudo docker compose --project-directory "$SCRIPT_DIR" "$@"
  fi
}

prepare_data_dir() {
  sudo install -d -m 0750 "$SCRIPT_DIR/data" "$SCRIPT_DIR/data/recordings"
  sudo chown -R 10001:10001 "$SCRIPT_DIR/data"
}

main() {
  local before after
  local app_domain media_domain

  require_privileges
  cd "$SCRIPT_DIR"
  [[ -d "$SCRIPT_DIR/.git" ]] || die 'Folder ini bukan checkout Git.'
  command -v git >/dev/null 2>&1 || die 'git belum tersedia.'

  ensure_clean_worktree
  log 'Mengambil update dari Git'
  before="$(git rev-parse HEAD)"
  git pull --ff-only
  after="$(git rev-parse HEAD)"

  # Re-run the new file after git replaces it, so migration code is not
  # skipped on the first update that contains this script.
  if [[ "$before" != "$after" && "${1:-}" != '--post-pull' ]]; then
    exec bash "$SCRIPT_DIR/update.sh" --post-pull
  fi

  ensure_runtime_dependencies

  log 'Memeriksa konfigurasi environment terbaru'
  migrate_whip_env
  ensure_env_keys

  app_domain="$(host_from_url "$(env_value VDO_PUBLIC_ORIGIN)")"
  media_domain="$(host_from_url "$(env_value VDO_SRT_PUBLIC_HOST)")"
  media_domain="${media_domain:-$(host_from_url "$(env_value VDO_WEBRTC_PUBLIC_BASE_URL)")}"
  valid_hostname "$app_domain" || die "VDO_PUBLIC_ORIGIN harus memakai hostname FQDN: $(env_value VDO_PUBLIC_ORIGIN)"
  valid_hostname "$media_domain" || die "VDO_SRT_PUBLIC_HOST harus memakai hostname FQDN: $(env_value VDO_SRT_PUBLIC_HOST)"
  [[ "$app_domain" != "$media_domain" ]] || die 'Domain app dan media harus berbeda.'
  APP_DOMAIN="$app_domain"
  MEDIA_DOMAIN="$media_domain"

  migrate_nginx_to_whip
  if ! sudo test -s "$SCRIPT_DIR/certs/server.crt" || ! sudo test -s "$SCRIPT_DIR/certs/server.key"; then
    install_certificate_files
  fi
  ensure_firewall_ports
  prepare_data_dir

  log 'Memvalidasi dan membangun container'
  run_compose config >/dev/null
  run_compose up -d --build

  cat <<EOF

Update WHIP selesai.
Container: docker compose ps
Log:       docker compose logs --tail=200 -f vdo

Migrasi yang dipastikan:
  - VDO_WEBRTC_PUBLIC_BASE_URL tersedia di .env
  - Nginx media menuju WHIP/WHEP MediaMTX port 8889
  - WebRTC ICE UDP 8189 dibuka bila UFW aktif
  - MediaMTX port lama 8892 tidak lagi dipakai
EOF
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
