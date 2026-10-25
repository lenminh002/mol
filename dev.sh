#!/usr/bin/env bash
# Runs the API (:8000) and web (:3000) together. Ctrl-C stops both.
cd "$(dirname "$0")"
(cd api && uv run fastapi dev main.py --port 8000) &
(cd web && pnpm dev) &
trap 'kill 0' EXIT
wait
