#!/bin/bash
# Kiln — Start all services for local development
# Usage: ./dev.sh

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🔥 Kiln — Starting all services${NC}"
echo ""

# Check env files
if [ ! -f .env ]; then
  echo -e "${YELLOW}⚠  No .env file found. Copy .env.example and fill in your keys:${NC}"
  echo "   cp .env.example .env"
  exit 1
fi

# Source root env vars
set -a; source .env; set +a

# Kill background processes on exit
PIDS=()
cleanup() {
  echo ""
  echo -e "${YELLOW}Shutting down all services...${NC}"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null
  done
  wait 2>/dev/null
  echo -e "${GREEN}All services stopped.${NC}"
}
trap cleanup EXIT INT TERM

# 1. Registry API (Python — port 8766)
echo -e "${BLUE}[1/5] Registry API → :8766${NC}"
cd "$ROOT"
uv run uvicorn kiln_registry.main:app --host 0.0.0.0 --port 8766 --reload &
PIDS+=($!)
sleep 3

# 2. Chat Backend (Python — port 8765)
echo -e "${BLUE}[2/5] Chat Backend → :8765${NC}"
cd "$ROOT"
uv run uvicorn kiln_chat_backend.main:app --host 0.0.0.0 --port 8765 --reload &
PIDS+=($!)
sleep 1

# 3. MCP Server (Python — port 8768)
echo -e "${BLUE}[3/5] MCP Server → :8768${NC}"
cd "$ROOT"
uv run python -m kiln_mcp.main streamable-http &
PIDS+=($!)
sleep 1

# 4. Chat UI (Vite — port 5173)
echo -e "${BLUE}[4/5] Chat UI → :5173${NC}"
cd "$ROOT/packages/chat_ui"
npx vite --host 0.0.0.0 --port 5173 &
PIDS+=($!)
cd "$ROOT"
sleep 1

# 5. Registry UI (Next.js — port 3000)
echo -e "${BLUE}[5/5] Registry UI → :3000${NC}"
cd "$ROOT/packages/registry_ui"
npx next dev --hostname 0.0.0.0 --port 3000 &
PIDS+=($!)
cd "$ROOT"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🔥 Kiln is running!${NC}"
echo ""
echo -e "  Registry UI   ${BLUE}http://localhost:3000${NC}"
echo -e "  Chat UI       ${BLUE}http://localhost:5173${NC}"
echo -e "  Registry API  ${BLUE}http://localhost:8766/tools${NC}"
echo -e "  Chat Backend  ${BLUE}http://localhost:8765/health${NC}"
echo -e "  MCP Server    ${BLUE}http://localhost:8768/mcp${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Press Ctrl+C to stop all services."

wait
