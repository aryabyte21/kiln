"""
kiln_registry/db.py
───────────────────
Async database layer using SQLAlchemy 2.0 + asyncpg for PostgreSQL.

Falls back to SQLite (via aiosqlite) when DATABASE_URL is not set,
making local development zero-config.

Usage:
    from kiln_registry.db import get_engine, get_session, ToolModel

    async with get_session() as session:
        result = await session.execute(select(ToolModel))
        tools = result.scalars().all()
"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from sqlalchemy import DateTime, String, Text, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# ── Database URL ──────────────────────────────────────────────────────────────

def _get_database_url() -> str:
    """Get async database URL from environment or default to SQLite."""
    url = os.environ.get("DATABASE_URL", "")
    if url:
        # Convert postgres:// to postgresql+asyncpg://
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url
    # Default: async SQLite for local dev (separate from the legacy sync SQLite)
    return "sqlite+aiosqlite:///kiln_async.db"


# ── SQLAlchemy Base ───────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    pass


class ToolModel(Base):
    """Persisted tool metadata. Callables stay in-memory (Python limitation)."""

    __tablename__ = "tools"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    version: Mapped[str] = mapped_column(String(50), nullable=False, default="1.0.0")
    author: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    category: Mapped[str] = mapped_column(String(100), nullable=False, default="general", index=True)
    tags_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    spec_json: Mapped[str] = mapped_column(Text, nullable=False)
    registered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=lambda: datetime.now(UTC),
    )


# ── Engine & Session ──────────────────────────────────────────────────────────

_engine = None
_session_factory = None


def get_engine():
    global _engine  # noqa: PLW0603
    if _engine is None:
        url = _get_database_url()
        _engine = create_async_engine(
            url,
            echo=os.environ.get("SQL_ECHO", "").lower() == "true",
            pool_pre_ping=True,
        )
    return _engine


def _get_session_factory():
    global _session_factory  # noqa: PLW0603
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
        )
    return _session_factory


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    session = _get_session_factory()()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


async def init_db() -> None:
    """Create tables if they don't exist. Call on startup."""
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# ── Query helpers ─────────────────────────────────────────────────────────────

async def db_list_tools() -> list[ToolModel]:
    async with get_session() as session:
        result = await session.execute(select(ToolModel).order_by(ToolModel.name))
        return list(result.scalars().all())


async def db_get_tool(tool_id: str) -> ToolModel | None:
    async with get_session() as session:
        return await session.get(ToolModel, tool_id)


async def db_upsert_tool(tool_id: str, name: str, spec_json: str, **kwargs) -> ToolModel:
    async with get_session() as session:
        existing = await session.get(ToolModel, tool_id)
        if existing:
            existing.name = name
            existing.spec_json = spec_json
            for k, v in kwargs.items():
                setattr(existing, k, v)
            existing.updated_at = datetime.now(UTC)
            return existing

        tool = ToolModel(id=tool_id, name=name, spec_json=spec_json, **kwargs)
        session.add(tool)
        return tool


async def db_delete_tool(tool_id: str) -> bool:
    async with get_session() as session:
        tool = await session.get(ToolModel, tool_id)
        if tool:
            await session.delete(tool)
            return True
        return False


async def db_search_tools(query: str) -> list[ToolModel]:
    """Full-text search across name, description, and tags."""
    pattern = f"%{query.lower()}%"
    async with get_session() as session:
        result = await session.execute(
            select(ToolModel).where(
                (func.lower(ToolModel.name).like(pattern))
                | (func.lower(ToolModel.description).like(pattern))
                | (func.lower(ToolModel.tags_json).like(pattern))
                | (func.lower(ToolModel.id).like(pattern))
            ).order_by(ToolModel.name)
        )
        return list(result.scalars().all())
