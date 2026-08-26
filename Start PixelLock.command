#!/bin/zsh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -d node_modules ]]; then
  echo "Preparing PixelLock for the first run..."
  npm ci --ignore-scripts --no-fund
fi

echo ""
echo "PixelLock is starting locally."
echo "Open http://localhost:3000 in Chrome or Edge."
echo "Press Control+C here when you want to stop it."
echo ""

npm run app
