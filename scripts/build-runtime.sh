#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUNTIME_SERVICE_NAME="${RUNTIME_SERVICE_NAME:-3j-tv.service}"

if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet "$RUNTIME_SERVICE_NAME"; then
    cat >&2 <<'EOF'
Refusing to build .next-runtime while the runtime service is active.

This can rewrite live chunk files mid-request and trigger ChunkLoadError in browsers.
EOF
    cat >&2 <<EOF
Use this sequence instead:
  sudo systemctl stop ${RUNTIME_SERVICE_NAME%.service}
  RUNTIME_SERVICE_NAME=$RUNTIME_SERVICE_NAME npm run build:runtime
  sudo systemctl start ${RUNTIME_SERVICE_NAME%.service}
EOF
    exit 1
  fi
fi

export NEXT_DIST_DIR=.next-runtime
exec "$ROOT_DIR/node_modules/.bin/next" build "$@"
