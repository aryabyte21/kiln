"""Public surface of `kiln_shared`.

The spec / model exports are always available — they have no heavy deps.
The auth helpers are only re-exported when the optional `[server]` extra is
installed (they pull in fastapi / jwt / httpx). SDK-only consumers can do
`from kiln_shared import KilnTool` without dragging the server stack in.
"""

from .spec import KilnTool as KilnTool
from .spec import KilnToolSpec as KilnToolSpec
from .spec import ToolParam as ToolParam
from .spec import ToolReturn as ToolReturn
from .spec import kiln_tool as kiln_tool

__all__ = [
    "KilnToolSpec",
    "KilnTool",
    "ToolParam",
    "ToolReturn",
    "kiln_tool",
]

# Optional server-only helpers. These live behind a targeted guard: we
# catch ImportError *only* when the root cause is a missing server-extra
# dependency (fastapi / httpx / jwt). Any other ImportError — a typo in
# auth.py, a bad export, a circular import — must bubble up so it's
# visible instead of silently dropping the KilnUser / require_auth
# re-exports.
def _load_auth_extras() -> list[str]:
    from importlib import util as _iu

    _server_deps = ("fastapi", "httpx", "jwt")
    _missing = [dep for dep in _server_deps if _iu.find_spec(dep) is None]
    if _missing:
        # SDK-only install — server extras intentionally absent.
        return []

    from .auth import KilnUser, require_auth, require_jwt_auth

    globals()["KilnUser"] = KilnUser
    globals()["require_auth"] = require_auth
    globals()["require_jwt_auth"] = require_jwt_auth
    return ["KilnUser", "require_auth", "require_jwt_auth"]


__all__.extend(_load_auth_extras())
del _load_auth_extras
