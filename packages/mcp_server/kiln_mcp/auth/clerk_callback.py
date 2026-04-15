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

_JWKS_TTL = 300  # 5 minutes
_jwks_cache: dict | None = None
_jwks_cache_time: float = 0.0


async def _fetch_jwks(clerk_domain: str) -> dict:
    global _jwks_cache, _jwks_cache_time  # noqa: PLW0603
    now = time.time()
    if _jwks_cache is not None and (now - _jwks_cache_time) < _JWKS_TTL:
        return _jwks_cache

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"https://{clerk_domain}/.well-known/jwks.json")
        resp.raise_for_status()
        _jwks_cache = resp.json()
        _jwks_cache_time = now
        return _jwks_cache


def build_callback_route(
    *,
    store: InMemoryOAuthStore,
    clerk_domain: str,
) -> Route:
    async def oauth_callback(request: Request) -> JSONResponse | RedirectResponse:
        state_raw = request.query_params.get("state")
        if not state_raw:
            return JSONResponse({"error": "Missing state parameter"}, status_code=400)

        state = verify_state(state_raw)
        if state is None:
            return JSONResponse({"error": "Invalid or tampered state parameter"}, status_code=400)

        session_token = request.cookies.get("__session")
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

    return Route("/oauth/callback", oauth_callback, methods=["GET"])


async def _resolve_clerk_user(token: str, clerk_domain: str) -> str | None:
    try:
        jwks_data = await _fetch_jwks(clerk_domain)

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
    except jwt.InvalidTokenError:
        logger.warning("Invalid Clerk session token", exc_info=True)
        return None
    except httpx.HTTPError as e:
        logger.error("JWKS fetch failed from Clerk: %s", e)
        return None
    except ValueError:
        logger.warning("Malformed JWKS or JWT payload", exc_info=True)
        return None
