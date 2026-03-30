FROM python:3.12-slim

WORKDIR /app

# Install Mistral Vibe CLI + service dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-configure Vibe CLI so it skips first-run onboarding
RUN mkdir -p /root/.vibe && \
    echo '[providers]\n' > /root/.vibe/.env
COPY vibe_config.toml /root/.vibe/config.toml

# Create runtime directories
RUN mkdir -p /app/logs /tmp/vibe_workspace

# Copy service code
COPY kiln_synthesis/ /app/kiln_synthesis/

# Default env vars for Docker context
ENV KILN_SYNTHESIS_LOG_DIR=/app/logs \
    KILN_SYNTHESIS_WORKSPACE_DIR=/tmp/vibe_workspace \
    KILN_CALLBACK_URL=http://host.docker.internal:8766/synthesis/callback

EXPOSE 8002

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8002/health')" || exit 1

CMD ["uvicorn", "kiln_synthesis.main:app", "--host", "0.0.0.0", "--port", "8002"]
