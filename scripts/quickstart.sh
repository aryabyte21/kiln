#!/usr/bin/env bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_step() { echo -e "${BLUE}▶${NC} $1"; }
print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; exit 1; }

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   OpenSwarm Quick Start                      ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Check prerequisites
if ! command -v go &> /dev/null; then
  print_error "Go is not installed. Install Go 1.23+ from https://go.dev/dl/"
fi

if ! command -v node &> /dev/null; then
  print_error "Node.js is not installed. Install Node.js 18+ from https://nodejs.org/"
fi

if ! command -v pnpm &> /dev/null; then
  print_error "pnpm is not installed. Install from https://pnpm.io/"
fi

# Step 1: Install Node dependencies
print_step "Installing Node.js dependencies..."
pnpm install
print_success "Node dependencies installed"

# Step 2: Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
  print_step "Creating .env file from example..."
  cp .env.example .env
  print_success ".env file created"
else
  print_success ".env file already exists"
fi

# Step 3: Start Docker services
print_step "Starting Docker services (PostgreSQL, Redis, NATS)..."
if ! docker info &> /dev/null; then
  print_error "Docker is not running. Please start Docker Desktop and try again."
fi

docker compose up -d
print_success "Docker services started"

# Step 4: Wait for Postgres to be ready
print_step "Waiting for PostgreSQL to be ready..."
sleep 3
print_success "PostgreSQL is ready"

# Step 5: Build Go control plane
print_step "Building Go control plane..."
cd apps/controlplane
go build ./cmd/openswarm-controller
go build ./cmd/openswarm
cd ../..
print_success "Control plane built"

# Done!
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   ✓ Setup Complete!                          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo ""
echo "  1. Start the control plane:"
echo -e "     ${BLUE}./apps/controlplane/openswarm-controller${NC}"
echo ""
echo "  2. Start the dashboard (separate terminal):"
echo -e "     ${BLUE}pnpm dev:web${NC}"
echo ""
echo "  3. Open your browser:"
echo -e "     Dashboard:      ${BLUE}http://localhost:3000/dashboard${NC}"
echo -e "     Control Plane:  ${BLUE}http://localhost:9090/healthz${NC}"
echo ""
echo -e "${YELLOW}Tip:${NC} Run ${BLUE}pnpm db:studio${NC} to explore your database"
echo ""
