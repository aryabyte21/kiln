FROM python:3.12-slim

WORKDIR /app

# Install Mistral Vibe CLI + service dependencies
COPY vibe_tool/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-configure Vibe CLI so it skips first-run onboarding
RUN mkdir -p /root/.vibe && \
    echo '[providers]\n' > /root/.vibe/.env
COPY vibe_tool/vibe_config.toml /root/.vibe/config.toml

# Copy service code
COPY vibe_tool/app/ /app/app/

EXPOSE 8002

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
