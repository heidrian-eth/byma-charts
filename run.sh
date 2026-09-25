#!/usr/bin/env bash
# Starts the API on :8765 and the web app on :5173; Ctrl+C stops both.
set -euo pipefail
cd "$(dirname "$0")"
(cd backend && uv sync -q && uv run uvicorn app.main:app --port 8765) &
api=$!
trap 'kill $api 2>/dev/null' EXIT
cd frontend && pnpm install --silent && pnpm dev --open
