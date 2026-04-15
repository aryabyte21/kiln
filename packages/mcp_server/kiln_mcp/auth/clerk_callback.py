from __future__ import annotations

import logging
import secrets
import time

import httpx
import jwt
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse
from starlette.routing import Route

from kiln_mcp.auth.provider import verify_state
from kiln_mcp.auth.store import InMemoryOAuthStore

logger = logging.getLogger(__name__)

_AUTH_CODE_TTL = 600


def build_callback_route(
    *,
    store: InMemoryOAuthStore,
    clerk_domain: str,
    clerk_secret_key: str,
) -> Route:
    async def oauth_callback(request: Request) -> JSONResponse | RedirectResponse:
        state_raw = request.query_params.get("state")
        if not state_raw:
            return JSONResponse({"error": "Missing state parameter"}, status_code=400)

        state = verify_state(state_raw)
        if state is None:
            return JSONResponse({"error": "Invalid or tampered state parameter"}, status_code=400)

        session_token = request.query_params.get("__clerk_ticket") or request.cookies.get("__session")
        if not session_token:
            return JSONResponse(
                {"error": "No Clerk session found. Please sign in first."},
                status_code=401,
            )

        user_id = await _resolve_clerk_user(session_token, clerk_domain)
        if user_id is None:
            return JSONResponse(
                {"error": "Invalid or expired Clerk session"},
                status_code=401,
            )

        code = secrets.token_urlsafe(32)
        code_data = {
            "code": code,
            "scopes": state.get("scopes", []),
            "expires_at": time.time() + _AUTH_CODE_TTL,
            "client_id": state["client_id"],
            "code_challenge": state["code_challenge"],
            "redirect_uri": state["redirect_uri"],
            "redirect_uri_provided_explicitly": state.get("redirect_uri_provided_explicitly", True),
            "user_id": user_id,
        }
        store.save_auth_code(code, code_data, ttl=_AUTH_CODE_TTL)

        redirect_uri = state["redirect_uri"]
        sep = "&" if "?" in redirect_uri else "?"
        target = f"{redirect_uri}{sep}code={code}"
        if state.get("oauth_state"):
            target += f"&state={state['oauth_state']}"

        return RedirectResponse(url=target, status_code=302)

    _ = clerk_secret_key

    return Route("/oauth/callback", oauth_callback, methods=["GET"])


async def _resolve_clerk_user(token: str, clerk_domain: str) -> str | None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            jwks_resp = await client.get(f"https://{clerk_domain}/.well-known/jwks.json")
            jwks_resp.raise_for_status()
            jwks_data = jwks_resp.json()

        jwk_set = jwt.PyJWKSet.from_dict(jwks_data)
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")

        signing_key = None
        for key in jwk_set.keys:
            if key.key_id == kid:
                signing_key = key
                break

        if signing_key is None:
            logger.warning("No matching signing key for kid=%s", kid)
            return None

        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=f"https://{clerk_domain}",
            options={"verify_aud": False},
        )
        return payload.get("sub")
    except jwt.ExpiredSignatureError:
        logger.warning("Clerk session token expired")
        return None
    except (jwt.InvalidTokenError, httpx.HTTPError, ValueError):
        logger.warning("Failed to verify Clerk session token", exc_info=True)
        return None
