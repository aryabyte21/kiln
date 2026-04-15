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

try:  # Optional server extras
    from .auth import KilnUser as KilnUser
    from .auth import require_auth as require_auth
    from .auth import require_jwt_auth as require_jwt_auth
    __all__.extend(["KilnUser", "require_auth", "require_jwt_auth"])
except ImportError:
    # Server extras not installed — that's expected for SDK-only consumers.
    pass
