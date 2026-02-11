# Architecture Overview

## Runtime Topology

- `apps/web` serves UI and orchestrates calls to backend services.
- `apps/py-api` hosts Python-centric logic and experimentation.
- `apps/go-api` hosts low-latency service endpoints.
- Postgres stores application data via Drizzle from `apps/web`.

## Ports

- Web: `3000`
- FastAPI: `8000`
- Go API: `8080`
- Postgres: `5432`

## Initial Integration Pattern

The web app probes both backend services via `/health` and can evolve toward API gateway or direct service composition depending on scale and deployment needs.
