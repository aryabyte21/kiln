"""
vibe_tool.app.routes.synthesize
--------------------------------
POST /synthesize — accepts a tool synthesis request, queues background work,
and calls the webhook on completion.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks

from app.jobs.job_store import job_store
from app.models import JobStatus, SynthesizeRequest, SynthesizeResponse
from app.synthesis.pipeline import run_synthesis_pipeline

router = APIRouter()


@router.post("/synthesize", response_model=SynthesizeResponse, summary="Synthesize a new Babel tool")
async def synthesize_tool(
    request: SynthesizeRequest,
    background_tasks: BackgroundTasks,
):
    job_id = request.job_id or str(uuid.uuid4())
    job_store.create(job_id, request.tool_name)
    background_tasks.add_task(run_synthesis_pipeline, job_id, request)

    return SynthesizeResponse(
        job_id=job_id,
        status=JobStatus.ACCEPTED,
        message=f"Synthesis started for tool: {request.tool_name}",
    )
