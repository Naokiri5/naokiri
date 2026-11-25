#!/bin/sh
# Container entrypoint. Railway mounts volumes owned by root, so when started as root this prepares the data
# directory and then drops to the unprivileged "node" user before starting MIA. Nothing here reads secrets.
set -eu
DATA_DIR="${MIA_DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR"
  chmod 0700 "$DATA_DIR"
  exec setpriv --reuid=node --regid=node --init-groups node /app/server/scripts/run.mjs start
fi
exec node /app/server/scripts/run.mjs start
