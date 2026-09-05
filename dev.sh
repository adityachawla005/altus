#!/usr/bin/env bash
# Runs both halves of Altus. Ctrl-C stops them together.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env

# The address to browse from, and the one a scanned QR resolves to. Read off
# the default route, so it is right on whatever network you are actually on —
# a venue hands out a different IP than your desk does.
LAN=$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')
printf '\n  \033[1mAltus\033[0m\n'
printf '  this machine   http://localhost:3000\n'
if [ -n "$LAN" ]; then
  printf '  on the LAN     \033[1mhttp://%s:3000\033[0m  ← browse here, or QR codes are a dead end\n\n' "$LAN"
else
  printf '  on the LAN     (offline — QR codes will point at localhost)\n\n'
fi

trap 'kill 0' EXIT
(cd backend && .venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload) &
(cd frontend && npm run dev) &
wait
