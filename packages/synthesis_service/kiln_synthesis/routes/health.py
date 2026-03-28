"""
kiln_synthesis.routes.health
----------------------------
Health check endpoint.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/health", summary="Health check")
def health_check():
    return {"status": "ok", "service": "kiln-synthesis-service", "version": "1.0.0"}
