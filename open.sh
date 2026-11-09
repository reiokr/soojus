#!/usr/bin/env bash
# Soojus — avab serveri juhtpaneeli vaikebrauseris (Tailscale).
# Lokaalne systemd-teenus on välja lülitatud; andmeid kogub serveris olev VM.
set -euo pipefail

URL="${SOOJUS_URL:-https://soojus.tail3bacb0.ts.net}"
exec xdg-open "$URL"
