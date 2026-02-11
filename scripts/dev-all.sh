#!/usr/bin/env bash
set -euo pipefail

echo "Starting services: web(3000), py-api(8000), go-api(8080)"
(
  cd apps/py-api
  ../../.venv/bin/python -m uvicorn app.main:app --reload --port 8000
) &
PY_PID=$!

(
  cd apps/go-api
  go run ./cmd/server
) &
GO_PID=$!

(
  pnpm dev:web
) &
WEB_PID=$!

trap 'kill $PY_PID $GO_PID $WEB_PID' INT TERM
wait
