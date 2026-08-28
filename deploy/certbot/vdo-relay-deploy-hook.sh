#!/bin/sh
set -eu

# Certbot runs deploy hooks as root. When this file is installed as a symlink,
# infer the project directory from the repository path; VDO_PROJECT_DIR remains
# available for manual installations.
script_path="$(readlink -f "$0")"
script_dir="$(CDPATH= cd -- "$(dirname -- "$script_path")/../.." && pwd)"
project_dir="${VDO_PROJECT_DIR:-$script_dir}"
lineage="${RENEWED_LINEAGE:?Certbot did not provide RENEWED_LINEAGE}"

# This directory hook is global. Ignore unrelated certificates installed on
# the same Ubuntu host so they cannot replace VDO's MediaMTX certificate.
if [ "$lineage" != "/etc/letsencrypt/live/vdo-relay" ]; then
  exit 0
fi

install -m 0644 "$lineage/fullchain.pem" "$project_dir/certs/server.crt"
install -m 0600 "$lineage/privkey.pem" "$project_dir/certs/server.key"
docker compose --project-directory "$project_dir" restart vdo
