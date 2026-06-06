#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"

if ! command -v pipenv >/dev/null 2>&1; then
  echo "Error: pipenv is not installed or not available on PATH" >&2
  exit 1
fi

cd "$BACKEND_DIR"
exec pipenv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8099
