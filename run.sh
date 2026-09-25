#!/usr/bin/env bash
# Soojus — ühilduvusaliis. Server jookseb systemd user-teenusena (soojus.service);
# see skript avab lihtsalt juhtpaneeli brauseris.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/open.sh" "$@"
