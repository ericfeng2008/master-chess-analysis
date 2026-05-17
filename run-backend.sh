#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"

if [ ! -d "$BACKEND_DIR/.venv" ]; then
  echo "Error: python virtual environment not found at $BACKEND_DIR/.venv" >&2
  exit 1
fi

source "$BACKEND_DIR/.venv/bin/activate"
cd "$BACKEND_DIR"
exec uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
