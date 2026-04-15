from __future__ import annotations

import json
from base64 import urlsafe_b64encode

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from kiln_mcp.auth.clerk_callback import build_callback_route
from kiln_mcp.auth.provider import _sign_state
from kiln_mcp.auth.store import InMemoryOAuthStore


def _encoded_signed_state(payload: dict) -> str:
    raw = json.dumps(payload).encode()
    sig = _sign_state(raw)
    return f"{urlsafe_b64encode(raw).decode().rstrip('=')}.{sig}"


@pytest.fixture
def store() -> InMemoryOAuthStore:
    return InMemoryOAuthStore()


@pytest.fixture
def app(store: InMemoryOAuthStore) -> Starlette:
    route = build_callback_route(
        store=store,
        clerk_domain="test.clerk.accounts.dev",
        clerk_secret_key="sk_test_123",
    )
    return Starlette(routes=[route])


@pytest.fixture
def client(app: Starlette) -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


def test_missing_state_returns_400(client: TestClient) -> None:
    resp = client.get("/oauth/callback")
    assert resp.status_code == 400
    assert "state" in resp.json()["error"].lower()


def test_tampered_state_returns_400(client: TestClient) -> None:
    tampered = urlsafe_b64encode(json.dumps({"client_id": "x"}).encode()).decode().rstrip("=")
    resp = client.get(f"/oauth/callback?state={tampered}.deadbeef")
    assert resp.status_code == 400


def test_missing_clerk_session_returns_401(client: TestClient) -> None:
    state = _encoded_signed_state({
        "oauth_state": "xyz",
        "code_challenge": "ch",
        "redirect_uri": "http://localhost:3000/callback",
        "redirect_uri_provided_explicitly": True,
        "client_id": "c1",
        "scopes": ["kiln:tools"],
    })
    resp = client.get(f"/oauth/callback?state={state}")
    assert resp.status_code == 401


def test_malformed_state_returns_400(client: TestClient) -> None:
    resp = client.get("/oauth/callback?state=not-a-valid-state-at-all")
    assert resp.status_code == 400
