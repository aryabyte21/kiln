# AGENTS Instructions for `apps/py-api`

## Stack

- FastAPI
- Uvicorn
- Pytest
- Ruff

## Commands

```bash
../../.venv/bin/python -m pip install -r requirements-dev.txt
../../.venv/bin/python -m uvicorn app.main:app --reload --port 8000
../../.venv/bin/python -m ruff check .
../../.venv/bin/python -m pytest
```

## Rules

- Keep route handlers minimal and deterministic.
- Validate request payloads explicitly as APIs evolve.
- Add tests for both success and failure behavior.
