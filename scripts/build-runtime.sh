#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet 3j-tv.service; then
    cat >&2 <<'EOF'
Refusing to build .next-runtime while 3j-tv.service is active.

This can rewrite live chunk files mid-request and trigger ChunkLoadError in browsers.
Use this sequence instead:
  sudo systemctl stop 3j-tv
  npm run build:runtime
  sudo systemctl start 3j-tv
EOF
    exit 1
  fi
fi

export NEXT_DIST_DIR=.next-runtime
exec "$ROOT_DIR/node_modules/.bin/next" build "$@"
