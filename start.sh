#!/usr/bin/env bash
# Universal startup script for Pterodactyl/Pelican-based panels
# (OptikLink, Katabump, etc.) and any plain shell environment.
#
# Usage in a panel's "Startup Command" field:
#     bash start.sh
# or simply:
#     node index.js
set -e

cd "$(dirname "$0")"

echo "[sano] node $(node -v)"

# Install deps if missing
if [ ! -d node_modules ]; then
  echo "[sano] installing dependencies..."
  npm install --no-audit --no-fund
fi

# Build if dist/Bot.js missing
if [ ! -f dist/Bot.js ]; then
  echo "[sano] building bot..."
  npm run build
fi

echo "[sano] starting..."
exec node index.js
