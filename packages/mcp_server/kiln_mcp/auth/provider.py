from __future__ import annotations

import json
import logging
import secrets
import time
from base64 import urlsafe_b64encode
from urllib.parse import urlencode

from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    RefreshToken,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

from kiln_mcp.auth.store import InMemoryOAuthStore

logger = logging.getLogger(__name__)

_ACCESS_TOKEN_TTL = 3600
_REFRESH_TOKEN_TTL = 2592000


class KilnAuthorizationCode(AuthorizationCode):
    user_id: str


class KilnAccessToken(AccessToken):
    user_id: str


class KilnRefreshToken(RefreshToken):
    user_id: str


class KilnOAuthProvider:
    def __init__(
        self,
        store: InMemoryOAuthStore,
        clerk_domain: str,
        issuer_url: str,
    ) -> None:
        self._store = store
        self._clerk_domain = clerk_domain
        self._issuer_url = issuer_url.rstrip("/")

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        data = self._store.get_client(client_id)
        if data is None:
            return None
        return OAuthClientInformationFull(**data)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        self._store.save_client(client_info.client_id, client_info.model_dump(mode="json"))

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        state_payload = {
            "oauth_state": params.state,
            "code_challenge": params.code_challenge,
            "redirect_uri": str(params.redirect_uri),
            "redirect_uri_provided_explicitly": params.redirect_uri_provided_explicitly,
            "client_id": client.client_id,
            "scopes": params.scopes or [],
        }
        encoded_state = urlsafe_b64encode(json.dumps(state_payload).encode()).decode()

        callback_url = f"{self._issuer_url}/oauth/callback"
        return (
            f"https://{self._clerk_domain}/sign-in?"
            + urlencode({"redirect_url": f"{callback_url}?state={encoded_state}"})
        )

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> KilnAuthorizationCode | None:
        data = self._store.get_auth_code(authorization_code)
        if data is None:
            return None
        if data.get("client_id") != client.client_id:
            return None
        return KilnAuthorizationCode(**data)

    async def exchange_authorization_code(
        self,
        client: OAuthClientInformationFull,
        authorization_code: KilnAuthorizationCode,
    ) -> OAuthToken:
        self._store.delete_auth_code(authorization_code.code)

        now = int(time.time())
        access_token_str = secrets.token_urlsafe(32)
        refresh_token_str = secrets.token_urlsafe(32)

        access_token = KilnAccessToken(
            token=access_token_str,
            client_id=client.client_id,
            scopes=authorization_code.scopes,
            expires_at=now + _ACCESS_TOKEN_TTL,
            user_id=authorization_code.user_id,
        )
        refresh_token = KilnRefreshToken(
            token=refresh_token_str,
            client_id=client.client_id,
            scopes=authorization_code.scopes,
            user_id=authorization_code.user_id,
        )

        self._store.save_access_token(
            access_token_str, access_token.model_dump(), ttl=_ACCESS_TOKEN_TTL
        )
        self._store.save_refresh_token(
            refresh_token_str, refresh_token.model_dump(), ttl=_REFRESH_TOKEN_TTL
        )

        return OAuthToken(
            access_token=access_token_str,
            refresh_token=refresh_token_str,
            token_type="Bearer",
            expires_in=_ACCESS_TOKEN_TTL,
        )

    async def load_access_token(self, token: str) -> KilnAccessToken | None:
        data = self._store.get_access_token(token)
        if data is None:
            return None
        return KilnAccessToken(**data)

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> KilnRefreshToken | None:
        data = self._store.get_refresh_token(refresh_token)
        if data is None:
            return None
        if data.get("client_id") != client.client_id:
            return None
        return KilnRefreshToken(**data)

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: KilnRefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        self._store.delete_refresh_token(refresh_token.token)

        now = int(time.time())
        new_access = secrets.token_urlsafe(32)
        new_refresh = secrets.token_urlsafe(32)

        access_token = KilnAccessToken(
            token=new_access,
            client_id=client.client_id,
            scopes=scopes or refresh_token.scopes,
            expires_at=now + _ACCESS_TOKEN_TTL,
            user_id=refresh_token.user_id,
        )
        new_refresh_token = KilnRefreshToken(
            token=new_refresh,
            client_id=client.client_id,
            scopes=scopes or refresh_token.scopes,
            user_id=refresh_token.user_id,
        )

        self._store.save_access_token(
            new_access, access_token.model_dump(), ttl=_ACCESS_TOKEN_TTL
        )
        self._store.save_refresh_token(
            new_refresh, new_refresh_token.model_dump(), ttl=_REFRESH_TOKEN_TTL
        )

        return OAuthToken(
            access_token=new_access,
            refresh_token=new_refresh,
            token_type="Bearer",
            expires_in=_ACCESS_TOKEN_TTL,
        )

    async def revoke_token(self, token: KilnAccessToken | KilnRefreshToken) -> None:
        if isinstance(token, KilnAccessToken):
            self._store.delete_access_token(token.token)
        elif isinstance(token, KilnRefreshToken):
            self._store.delete_refresh_token(token.token)
