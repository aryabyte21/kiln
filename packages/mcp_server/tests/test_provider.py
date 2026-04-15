from __future__ import annotations

import time

import pytest
from mcp.shared.auth import OAuthClientInformationFull
from pydantic import AnyUrl

from kiln_mcp.auth.provider import (
    KilnAccessToken,
    KilnAuthorizationCode,
    KilnOAuthProvider,
)
from kiln_mcp.auth.store import InMemoryOAuthStore


@pytest.fixture
def store() -> InMemoryOAuthStore:
    return InMemoryOAuthStore()


@pytest.fixture
def provider(store: InMemoryOAuthStore) -> KilnOAuthProvider:
    return KilnOAuthProvider(
        store=store,
        clerk_domain="test.clerk.accounts.dev",
        issuer_url="http://localhost:8768",
    )


def _make_client_info(client_id: str = "test-client") -> OAuthClientInformationFull:
    return OAuthClientInformationFull(
        client_id=client_id,
        client_name="Test Client",
        redirect_uris=[AnyUrl("http://localhost:3000/callback")],
        grant_types=["authorization_code", "refresh_token"],
        response_types=["code"],
        token_endpoint_auth_method="none",
    )


@pytest.mark.asyncio
async def test_register_and_get_client(provider: KilnOAuthProvider) -> None:
    info = _make_client_info()
    await provider.register_client(info)
    result = await provider.get_client("test-client")
    assert result is not None
    assert result.client_id == "test-client"


@pytest.mark.asyncio
async def test_get_unknown_client_returns_none(provider: KilnOAuthProvider) -> None:
    result = await provider.get_client("unknown")
    assert result is None


@pytest.mark.asyncio
async def test_authorize_returns_clerk_redirect(provider: KilnOAuthProvider) -> None:
    from mcp.server.auth.provider import AuthorizationParams

    info = _make_client_info()
    await provider.register_client(info)
    params = AuthorizationParams(
        state="xyz",
        scopes=["kiln:tools"],
        code_challenge="challenge123",
        redirect_uri=AnyUrl("http://localhost:3000/callback"),
        redirect_uri_provided_explicitly=True,
    )
    url = await provider.authorize(info, params)
    assert "test.clerk.accounts.dev" in url
    assert "oauth%2Fcallback" in url or "oauth/callback" in url


@pytest.mark.asyncio
async def test_exchange_authorization_code(provider: KilnOAuthProvider) -> None:
    info = _make_client_info()
    await provider.register_client(info)

    auth_code = KilnAuthorizationCode(
        code="test-code",
        scopes=["kiln:tools"],
        expires_at=time.time() + 600,
        client_id="test-client",
        code_challenge="challenge",
        redirect_uri=AnyUrl("http://localhost:3000/callback"),
        redirect_uri_provided_explicitly=True,
        user_id="user_abc",
    )
    provider._store.save_auth_code("test-code", auth_code.model_dump(mode="json"), ttl=600)

    token = await provider.exchange_authorization_code(info, auth_code)
    assert token.access_token
    assert token.refresh_token
    assert token.expires_in == 3600


@pytest.mark.asyncio
async def test_load_access_token(provider: KilnOAuthProvider) -> None:
    info = _make_client_info()
    await provider.register_client(info)

    auth_code = KilnAuthorizationCode(
        code="code2",
        scopes=["kiln:tools"],
        expires_at=time.time() + 600,
        client_id="test-client",
        code_challenge="ch",
        redirect_uri=AnyUrl("http://localhost:3000/callback"),
        redirect_uri_provided_explicitly=True,
        user_id="user_xyz",
    )
    provider._store.save_auth_code("code2", auth_code.model_dump(mode="json"), ttl=600)
    token_resp = await provider.exchange_authorization_code(info, auth_code)

    loaded = await provider.load_access_token(token_resp.access_token)
    assert loaded is not None
    assert loaded.user_id == "user_xyz"
    assert loaded.client_id == "test-client"


@pytest.mark.asyncio
async def test_load_expired_access_token_returns_none(provider: KilnOAuthProvider) -> None:
    provider._store.save_access_token(
        "expired",
        KilnAccessToken(
            token="expired",
            client_id="c",
            scopes=["kiln:tools"],
            expires_at=int(time.time()) - 10,
            user_id="u",
        ).model_dump(),
        ttl=-1,
    )
    loaded = await provider.load_access_token("expired")
    assert loaded is None


@pytest.mark.asyncio
async def test_exchange_refresh_token(provider: KilnOAuthProvider) -> None:
    info = _make_client_info()
    await provider.register_client(info)

    auth_code = KilnAuthorizationCode(
        code="code3",
        scopes=["kiln:tools"],
        expires_at=time.time() + 600,
        client_id="test-client",
        code_challenge="ch",
        redirect_uri=AnyUrl("http://localhost:3000/callback"),
        redirect_uri_provided_explicitly=True,
        user_id="user_refresh",
    )
    provider._store.save_auth_code("code3", auth_code.model_dump(mode="json"), ttl=600)
    token_resp = await provider.exchange_authorization_code(info, auth_code)

    refresh = await provider.load_refresh_token(info, token_resp.refresh_token)
    assert refresh is not None

    new_token = await provider.exchange_refresh_token(info, refresh, ["kiln:tools"])
    assert new_token.access_token != token_resp.access_token
    assert new_token.refresh_token != token_resp.refresh_token


@pytest.mark.asyncio
async def test_revoke_token(provider: KilnOAuthProvider) -> None:
    at = KilnAccessToken(
        token="revoke-me",
        client_id="c",
        scopes=["kiln:tools"],
        expires_at=int(time.time()) + 3600,
        user_id="u",
    )
    provider._store.save_access_token("revoke-me", at.model_dump(), ttl=3600)

    await provider.revoke_token(at)
    assert await provider.load_access_token("revoke-me") is None
