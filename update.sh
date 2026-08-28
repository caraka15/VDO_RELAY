#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
RUN_USER="$(id -un)"
CERTBOT_NAME='vdo-relay'

log() {
  printf '\n==> %s\n' "$*"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
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

  # Re-run the new file after Git replaces it so new updater logic is used
  # immediately.
  if [[ "$before" != "$after" && "${1:-}" != '--post-pull' ]]; then
    exec bash "$SCRIPT_DIR/update.sh" --post-pull
  fi

  ensure_runtime_dependencies

  log 'Memeriksa konfigurasi environment terbaru'
  ensure_env_keys

  app_domain="$(host_from_url "$(env_value VDO_PUBLIC_ORIGIN)")"
  media_domain="$(host_from_url "$(env_value VDO_SRT_PUBLIC_HOST)")"
  media_domain="${media_domain:-$(host_from_url "$(env_value VDO_WEBRTC_PUBLIC_BASE_URL)")}"
  valid_hostname "$app_domain" || die "VDO_PUBLIC_ORIGIN harus memakai hostname FQDN: $(env_value VDO_PUBLIC_ORIGIN)"
  valid_hostname "$media_domain" || die "VDO_SRT_PUBLIC_HOST harus memakai hostname FQDN: $(env_value VDO_SRT_PUBLIC_HOST)"
  [[ "$app_domain" != "$media_domain" ]] || die 'Domain app dan media harus berbeda.'
  APP_DOMAIN="$app_domain"
  MEDIA_DOMAIN="$media_domain"

  if ! sudo test -s "$SCRIPT_DIR/certs/server.crt" || ! sudo test -s "$SCRIPT_DIR/certs/server.key"; then
    install_certificate_files
  fi
  ensure_firewall_ports
  prepare_data_dir

  log 'Memvalidasi dan membangun container'
  run_compose config >/dev/null
  run_compose up -d --build

  cat <<EOF

Update VDO Relay selesai.
Container: docker compose ps
Log:       docker compose logs --tail=200 -f vdo
EOF
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
