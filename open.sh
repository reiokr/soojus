#!/usr/bin/env bash
# Soojus — avab juhtpaneeli vaikebrauseris.
# Eeldab, et server jookseb systemd user-teenusena (soojus.service).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PORT="${PORT:-3210}"
[ -f .env ] && PORT="$(sed -n 's/^PORT=\([0-9]*\).*/\1/p' .env | tail -n1 || true)"
[ -n "$PORT" ] || PORT=3210
URL="http://localhost:${PORT}"

# Käivita server, kui see veel ei tööta.
if ! curl -fsS -o /dev/null "$URL" 2>/dev/null; then
  systemctl --user start soojus.service 2>/dev/null || true
  for _ in $(seq 1 40); do
    curl -fsS -o /dev/null "$URL" 2>/dev/null && break
    sleep 0.5
  done
fi

xdg-open "$URL" >/dev/null 2>&1 &
