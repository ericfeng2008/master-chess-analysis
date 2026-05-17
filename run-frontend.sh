#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "Error: node_modules not found at $FRONTEND_DIR/node_modules" >&2
  echo "Install with: cd frontend && npm install" >&2
  exit 1
fi

cd "$FRONTEND_DIR"
exec npm run dev
