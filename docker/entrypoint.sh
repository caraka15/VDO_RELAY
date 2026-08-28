#!/bin/sh
set -eu

if [ ! -r /certs/server.crt ] || [ ! -r /certs/server.key ]; then
  echo "VDO Relay requires readable /certs/server.crt and /certs/server.key" >&2
  exit 1
fi

mkdir -p /run/vdo
cp /certs/server.crt /run/vdo/server.crt
cp /certs/server.key /run/vdo/server.key
chown vdo:vdo /run/vdo/server.crt /run/vdo/server.key
chmod 0644 /run/vdo/server.crt
chmod 0600 /run/vdo/server.key

export VDO_TLS_CERT_FILE=/run/vdo/server.crt
export VDO_TLS_KEY_FILE=/run/vdo/server.key
exec su-exec vdo /usr/local/bin/vdo
