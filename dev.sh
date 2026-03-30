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

# Source env vars for Python services
set -a
source .env
set +a

# Kill background processes on exit
cleanup() {
  echo ""
  echo -e "${YELLOW}Shutting down all services...${NC}"
  kill $(jobs -p) 2>/dev/null
  wait 2>/dev/null
  echo -e "${GREEN}All services stopped.${NC}"
}
trap cleanup EXIT INT TERM

# 1. Registry API (Python — port 8766)
echo -e "${BLUE}[1/5] Starting Registry API on :8766${NC}"
uv run uvicorn kiln_registry.main:app --host 127.0.0.1 --port 8766 --reload &
sleep 2

# 2. Chat Backend (Python — port 8765)
echo -e "${BLUE}[2/5] Starting Chat Backend on :8765${NC}"
uv run uvicorn kiln_chat_backend.main:app --host 127.0.0.1 --port 8765 --reload &
sleep 1

# 3. MCP Server (Python — port 8768)
echo -e "${BLUE}[3/5] Starting MCP Server on :8768${NC}"
uv run python -m kiln_mcp.main streamable-http &
sleep 1

# 4. Chat UI (Vite + React — port 5173)
echo -e "${BLUE}[4/5] Starting Chat UI on :5173${NC}"
cd packages/chat_ui && npm run dev -- --host 127.0.0.1 &
cd "$ROOT"
sleep 1

# 5. Registry UI (Next.js — port 3000)
echo -e "${BLUE}[5/5] Starting Registry UI on :3000${NC}"
cd packages/registry_ui && npm run dev &
cd "$ROOT"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🔥 Kiln is running!${NC}"
echo ""
echo -e "  Registry UI   ${BLUE}http://localhost:3000${NC}        (Next.js)"
echo -e "  Chat UI       ${BLUE}http://localhost:5173${NC}        (Vite + OpenUI)"
echo -e "  Registry API  ${BLUE}http://localhost:8766/tools${NC}  (FastAPI)"
echo -e "  Chat Backend  ${BLUE}http://localhost:8765/health${NC} (FastAPI)"
echo -e "  MCP Server    ${BLUE}http://localhost:8768/mcp${NC}    (MCP protocol)"
echo ""
echo -e "  MCP config:   ${YELLOW}{\"mcpServers\":{\"kiln\":{\"url\":\"http://localhost:8768/mcp\"}}}${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Press Ctrl+C to stop all services."

# Wait for all background processes
wait
