"""
kiln/tool_executor/main.py
──────────────────────────
Placeholder for the Kiln Tool Executor service.

In the cloud deployment phase, this will be a gVisor-sandboxed Cloud Run
service that receives tool code + arguments + requirements.txt, installs
dependencies, and executes the tool in an isolated namespace.

For local development, tool execution stays in the registry_api service.
This placeholder exists to reserve the directory structure and Nx project.
"""

from fastapi import FastAPI

app = FastAPI(
    title="KilnToolExecutor",
    description="Placeholder — tool execution currently handled by registry_api",
    version="1.0.0",
)


@app.get("/health")
def health():
    return {"status": "placeholder", "service": "kiln-tool-executor"}
