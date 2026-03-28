"""
kiln_synthesis.models
--------------------
Pydantic models for the Kiln Synthesis API.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# -- Request models -----------------------------------------------------------


class ToolInput(BaseModel):
    name: str = Field(..., description="Input parameter name")
    type: str = Field(..., description="Kiln type: string|integer|float|boolean|enum|array|object")
    description: str = Field("", description="What this parameter does")
    required: bool = True
    default: Optional[Any] = None
    values: Optional[list[str]] = None  # for enum type


class ToolOutput(BaseModel):
    type: str = "object"
    fields: list[ToolInput] = Field(default_factory=list)


class EnvVar(BaseModel):
    name: str = Field(..., description="Env var name, e.g. GOOGLE_MAPS_API_KEY")
    description: str = Field("", description="What this env var is used for")


class SynthesizeRequest(BaseModel):
    job_id: Optional[str] = Field(None, description="Caller-provided UUID; auto-generated if omitted")
    tool_name: str = Field(..., description="Short name, e.g. 'linkedin_search'")
    description: str = Field(..., description="What the tool should do")
    inputs: list[ToolInput] = Field(..., description="Expected input parameters")
    output: Optional[ToolOutput] = None
    env_vars: list[EnvVar] = Field(default_factory=list, description="Required env vars for this tool")
    constraints: Optional[str] = Field(None, description="Extra constraints or API hints")
    callback_url: Optional[str] = Field(None, description="Override default Kiln callback URL")


# -- Response models ----------------------------------------------------------


class JobStatus(str, Enum):
    ACCEPTED = "accepted"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class SynthesizeResponse(BaseModel):
    job_id: str
    status: JobStatus
    message: str


class JobInfo(BaseModel):
    job_id: str
    tool_name: str
    status: JobStatus
    tool_id: Optional[str] = None
    error: Optional[str] = None
    created_at: datetime
    updated_at: datetime
