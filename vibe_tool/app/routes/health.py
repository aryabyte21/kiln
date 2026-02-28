"""
vibe_tool.app.routes.health
----------------------------
Health check endpoint.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/health", summary="Health check")
def health_check():
    return {"status": "ok", "service": "vibe_tool", "version": "1.0.0"}
