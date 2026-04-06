FROM python:3.12-slim-bookworm

WORKDIR /app

# Install Node.js 22 LTS (required for OpenCode CLI)
# Use the official NodeSource setup for Debian bookworm (stable, no segfaults)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates gnupg && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install OpenCode CLI and the OpenAI-compatible provider adapter
RUN npm install -g opencode-ai @ai-sdk/openai-compatible

# Install Python service dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Configure OpenCode
RUN mkdir -p /root/.config/opencode
COPY opencode.json /root/.config/opencode/opencode.json

# Create runtime directories
RUN mkdir -p /app/logs /tmp/opencode_workspace

# Copy service code
COPY kiln_synthesis/ /app/kiln_synthesis/

# Default env vars for Docker context
ENV KILN_SYNTHESIS_LOG_DIR=/app/logs \
    KILN_SYNTHESIS_WORKSPACE_DIR=/tmp/opencode_workspace \
    KILN_CALLBACK_URL=http://host.docker.internal:8766/synthesis/callback

EXPOSE 8002

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8002/health')" || exit 1

CMD ["uvicorn", "kiln_synthesis.main:app", "--host", "0.0.0.0", "--port", "8002"]
