#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
RUN_USER="$(id -un)"

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

ensure_env_keys() {
  [[ -f "$ENV_FILE" ]] || die ".env belum ada. Jalankan ./setup.sh untuk instalasi pertama."
  [[ -f "$SCRIPT_DIR/.env.example" ]] || die '.env.example tidak ditemukan setelah git pull.'
  [[ -w "$ENV_FILE" ]] || die ".env tidak writable oleh $RUN_USER. Jalankan update.sh sebagai root atau perbaiki ownership."

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
  # Ignore only local executable-bit differences; chmod fallback is documented
  # for clones where GitHub did not preserve the script mode.
  changes="$(git -c core.fileMode=false status --porcelain --untracked-files=all)"
  [[ -z "$changes" ]] || {
    printf '%s\n' "$changes" >&2
    die 'Ada perubahan source atau file untracked. Commit/pindahkan dulu sebelum update; file ignored tidak ditampilkan di sini.'
  }
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
  require_privileges
  cd "$SCRIPT_DIR"
  [[ -d "$SCRIPT_DIR/.git" ]] || die 'Folder ini bukan checkout Git.'
  command -v git >/dev/null 2>&1 || die 'git belum tersedia.'
  command -v docker >/dev/null 2>&1 || die 'Docker Engine belum tersedia. Jalankan ./setup.sh.'
  if ! docker compose version >/dev/null 2>&1 && ! sudo docker compose version >/dev/null 2>&1; then
    die 'Docker Compose plugin belum tersedia. Jalankan ./setup.sh.'
  fi

  ensure_clean_worktree
  log 'Mengambil update dari Git'
  git pull --ff-only

  log 'Memeriksa konfigurasi environment terbaru'
  ensure_env_keys
  if ! sudo test -s "$SCRIPT_DIR/certs/server.crt" || ! sudo test -s "$SCRIPT_DIR/certs/server.key"; then
    die 'Certificate belum tersedia di certs/. Jalankan ./setup.sh untuk instalasi atau perbarui certificate.'
  fi

  prepare_data_dir
  log 'Memvalidasi dan membangun container'
  run_compose config >/dev/null
  run_compose up -d --build

  cat <<EOF

Update selesai.
Container: docker compose ps
Log:       docker compose logs --tail=200 -f vdo
EOF
}

main "$@"
