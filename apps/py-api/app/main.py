from fastapi import FastAPI

app = FastAPI(title="CS5224 FastAPI Service", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "py-api"}


@app.get("/api/v1/ping")
def ping() -> dict[str, str]:
    return {"message": "pong from FastAPI"}
