"""
vibe_tool.app.main
-------------------
FastAPI application — tool synthesis service powered by Mistral Vibe CLI.

Run from the vibe_tool/ directory:
    python app/main.py
    # or
    uvicorn app.main:app --host 0.0.0.0 --port 8002
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

# Ensure `vibe_tool/` is on sys.path so `from app.` imports resolve
# regardless of whether we run via `python app/main.py` or `uvicorn app.main:app`
_VIBE_ROOT = str(Path(__file__).parent.parent)
if _VIBE_ROOT not in sys.path:
    sys.path.insert(0, _VIBE_ROOT)

from fastapi import FastAPI  # noqa: E402

from app.routes.events import router as events_router  # noqa: E402
from app.routes.health import router as health_router  # noqa: E402
from app.routes.synthesize import router as synthesize_router  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)

app = FastAPI(
    title="vibe_tool",
    description=(
        "Babel tool synthesis service — generates missing tools on demand "
        "using Mistral Vibe CLI, then registers them via webhook."
    ),
    version="1.0.0",
)

app.include_router(health_router)
app.include_router(synthesize_router)
app.include_router(events_router)

# Wire log_dir from settings into the job store
from app.config import get_settings  # noqa: E402
from app.jobs.job_store import job_store  # noqa: E402

job_store.set_log_dir(get_settings().log_dir)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8002, reload=False)
