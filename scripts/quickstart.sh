#!/usr/bin/env bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_step() {
  echo -e "${BLUE}▶${NC} $1"
}

print_success() {
  echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
  echo -e "${RED}✗${NC} $1"
  exit 1
}

# Banner
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   CS5224 Monorepo Quick Start Script        ║"
echo "║   Get from zero to running dev env in 2min  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Check if mise is installed
if ! command -v mise &> /dev/null; then
  print_warning "mise not found. Installing mise..."
  curl https://mise.run | sh
  echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc
  echo 'eval "$(~/.local/bin/mise activate zsh)"' >> ~/.zshrc
  export PATH="$HOME/.local/bin:$PATH"
  print_success "mise installed"
fi

# Step 1: Install runtimes
print_step "Installing runtimes (Node.js, pnpm, Python, Go)..."
mise install
print_success "Runtimes installed"

# Step 2: Install Node dependencies
print_step "Installing Node.js dependencies..."
pnpm install
print_success "Node dependencies installed"

# Step 3: Setup Python virtual environment
print_step "Setting up Python virtual environment..."
python -m venv .venv
./.venv/bin/python -m pip install --upgrade pip --quiet
./.venv/bin/python -m pip install -r apps/py-api/requirements-dev.txt --quiet
print_success "Python environment ready"

# Step 4: Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
  print_step "Creating .env file from example..."
  cp .env.example .env
  print_success ".env file created"
else
  print_success ".env file already exists"
fi

# Step 5: Start Docker services
print_step "Starting Docker services (PostgreSQL)..."
if ! docker info &> /dev/null; then
  print_error "Docker is not running. Please start Docker Desktop and try again."
fi

docker compose up -d
print_success "Docker services started"

# Step 6: Wait for Postgres to be ready
print_step "Waiting for PostgreSQL to be ready..."
sleep 3
print_success "PostgreSQL is ready"

# Step 7: Run database migrations
print_step "Running database migrations..."
if [ -d "apps/web/drizzle" ] && [ "$(find apps/web/drizzle -name '*.sql' | wc -l | tr -d ' ')" -gt 0 ]; then
  pnpm db:migrate
  print_success "Database migrations applied"
else
  print_warning "No migration files found in apps/web/drizzle."
  print_warning "Run 'pnpm db:generate' after finalizing your initial schema."
fi

# Done!
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   ✓ Setup Complete!                          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo ""
echo "  1. Start all services:"
echo -e "     ${BLUE}pnpm dev${NC}"
echo ""
echo "  2. Open your browser:"
echo -e "     Web:     ${BLUE}http://localhost:3000${NC}"
echo -e "     FastAPI: ${BLUE}http://localhost:8000/docs${NC}"
echo -e "     Go API:  ${BLUE}http://localhost:8080/health${NC}"
echo ""
echo "  3. Run validation:"
echo -e "     ${BLUE}pnpm check:all${NC}"
echo ""
echo -e "${YELLOW}Tip:${NC} Run ${BLUE}pnpm db:studio${NC} to explore your database"
echo ""
