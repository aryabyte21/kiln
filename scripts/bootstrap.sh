#!/usr/bin/env bash
set -euo pipefail

mise install
pnpm install
python -m venv .venv
./.venv/bin/python -m pip install --upgrade pip
(
  cd apps/py-api
  ../../.venv/bin/python -m pip install -r requirements-dev.txt
)
