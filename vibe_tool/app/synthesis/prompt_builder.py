"""
vibe_tool.app.synthesis.prompt_builder
---------------------------------------
Builds the --prompt string for Vibe CLI and writes CONTEXT.md into the workspace.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.models import SynthesizeRequest


# ── Babel spec format reference (embedded) ───────────────────────────────────

_SPEC_FORMAT = """\
babel_version: "1.0"

tool:
  id: com.aria.tools.<tool_name>
  name: <tool_name>          # MUST match the Python function name exactly
  version: 1.0.0
  description: <What the tool does — this becomes the LLM function description>
  author: vibe_tool

interface:
  inputs:
    - name: <param_name>
      type: <string|integer|float|boolean|array|object>
      description: <what it is>
      required: <true|false>
      default: <optional default value>
      enum: [<for enum type only — omit this line if not an enum>]
  outputs:
    - name: <output_field_name>
      type: <string|integer|float|boolean|array|object>
      description: <what this field contains>

implementation:
  runtime: python3.10
  entrypoint: impl.py
  dependencies: []

testing:
  fixtures:
    - input:
        <param>: <value>
      expected_output_contains:
        - <expected_key_1>
        - <expected_key_2>

metadata:
  tags: [synthesized]
  category: general
  generated_by: vibe_tool
"""

_IMPL_RULES = """\
## Implementation Rules (impl.py)

- MUST define a global list `REQUIRED_ENV_VARS` at the top of the file listing every environment
  variable the tool needs. Each entry is a dict with `name` and `description`. Example:
  ```python
  REQUIRED_ENV_VARS = [
      {"name": "GOOGLE_MAPS_API_KEY", "description": "Google Maps API key for directions and geocoding"},
  ]
  ```
  If the tool needs no env vars, set it to an empty list: `REQUIRED_ENV_VARS = []`
- MUST define exactly one function whose name matches `tool.name` in spec.yaml exactly
  Example: if `tool.name: geopolitical_analysis` then `def geopolitical_analysis(**kwargs) -> dict`
- Accept all inputs defined in spec as keyword arguments with appropriate type hints and defaults
- Return a dict whose keys match the `expected_output_contains` keys in the test fixtures
- On error, return `{"error": "<message>"}` — NEVER raise exceptions to the caller
- NEVER include mock or fallback data — always make real API calls
- Only import stdlib modules + dependencies declared in spec.implementation.dependencies
- Keep the implementation concise and production-quality
- **STRONGLY prefer free, open APIs that require no API key.** Use paid/key-gated APIs only when
  there is absolutely no free alternative. If a free API is used, `REQUIRED_ENV_VARS` MUST be `[]`.
  If a key-gated API is unavoidable, declare its env var in `REQUIRED_ENV_VARS` and return
  `{"error": "Missing required env var: <VAR>"}` if it is absent.
"""


def _format_inputs(request: SynthesizeRequest) -> str:
    lines = []
    for inp in request.inputs:
        parts = [f"- **{inp.name}** ({inp.type})"]
        if inp.description:
            parts.append(f": {inp.description}")
        if inp.required:
            parts.append(" [required]")
        else:
            parts.append(f" [optional, default={inp.default}]")
        if inp.values:
            parts.append(f" — allowed: {inp.values}")
        lines.append("".join(parts))
    return "\n".join(lines)


def _format_output(request: SynthesizeRequest) -> str:
    if not request.output or not request.output.fields:
        return "Return a dict with relevant fields."
    lines = []
    for f in request.output.fields:
        lines.append(f"- **{f.name}** ({f.type}): {f.description}")
    return "\n".join(lines)


def _build_test_input(request: SynthesizeRequest) -> str:
    """Build a sample test invocation from the inputs."""
    sample = {}
    for inp in request.inputs:
        if not inp.required and inp.default is not None:
            continue
        t = inp.type.lower()
        if t in ("string", "str"):
            sample[inp.name] = "test"
        elif t in ("integer", "int"):
            sample[inp.name] = 1
        elif t in ("float", "number"):
            sample[inp.name] = 1.0
        elif t in ("boolean", "bool"):
            sample[inp.name] = True
        elif t in ("array", "list"):
            sample[inp.name] = []
        elif t in ("object", "dict"):
            sample[inp.name] = {}
        elif t == "enum" and inp.values:
            sample[inp.name] = inp.values[0]
        else:
            sample[inp.name] = "test"
    return json.dumps(sample)


def write_context(workspace: Path, request: SynthesizeRequest) -> None:
    """Write CONTEXT.md into the workspace directory."""
    context = f"""\
# Babel Tool Synthesis Context

## Your Task

Generate a Babel tool with the following requirements:

- **Tool name**: {request.tool_name}
- **Tool ID**: com.aria.tools.{request.tool_name}
- **Description**: {request.description}

### Inputs
{_format_inputs(request)}

### Expected Output
{_format_output(request)}
"""

    if request.env_vars:
        env_lines = "\n".join(
            f"- `{ev.name}`: {ev.description}" for ev in request.env_vars
        )
        context += f"""
### Required Environment Variables

The implementation MUST read these from `os.environ.get()`. If a required env var is missing, return `{"error": "Missing required env var: <VAR_NAME>"}` — do NOT return mock or fallback data:

{env_lines}
"""

    if request.constraints:
        context += f"""
### Constraints
{request.constraints}
"""

    context += f"""
## Babel Spec Format (spec.yaml)

Every tool is defined as a YAML spec with this exact structure:

```yaml
{_SPEC_FORMAT}
```

{_IMPL_RULES}

## Testing — CRITICAL

After generating both files, you MUST test the tool thoroughly:

### Step 1: Import test
```bash
cd {workspace}
python -c "from impl import {request.tool_name}; print('Import OK')"
```
If this fails, fix syntax errors in impl.py before proceeding.

### Step 2: Functional test
```bash
cd {workspace}
python -c "from impl import {request.tool_name}; import json; result = {request.tool_name}(**{_build_test_input(request)}); print(json.dumps(result, indent=2))"
```

### Verification checklist
1. The command runs **without any Python errors or tracebacks**
2. The output is a valid dict — NOT an error dict like `{{"error": "..."}}`
3. The output contains the expected keys from the spec
4. If an API call fails (network error, timeout), add a local fallback so the tool always returns useful output

### Important testing rules
- Do NOT consider the tool done until the test command above succeeds
- If an external API is unreachable, switch to a **free API that works** or use a **local computation** (e.g. stdlib `datetime` for dates, stdlib `math` for calculations)
- Do NOT waste turns retrying the same failing approach — if an API doesn't work after one attempt, switch strategy immediately
- The test input may use placeholder values like "test" — make sure your implementation handles these gracefully without crashing

## Files to Create

Create these two files in the current directory (`{workspace}`):

1. **spec.yaml** — Valid Babel tool spec following the format above
2. **impl.py** — Python implementation following the rules above
"""

    (workspace / "CONTEXT.md").write_text(context)


def build_prompt(workspace: Path, request: SynthesizeRequest) -> str:
    """Build the --prompt string for Vibe CLI."""
    test_input = _build_test_input(request)

    return (
        f"Read the file CONTEXT.md in this directory for full instructions. "
        f"Generate a Babel tool called '{request.tool_name}' that: {request.description}. "
        f"Create two files in this directory: spec.yaml and impl.py. "
        f"Follow the Babel spec format exactly as described in CONTEXT.md. "
        f"IMPORTANT: First test the import works: python -c \"from impl import {request.tool_name}; print('OK')\". "
        f"Then test the full tool: "
        f'python -c "from impl import {request.tool_name}; import json; print(json.dumps({request.tool_name}(**{test_input}), indent=2))" '
        f"If an external API fails, switch to a free alternative or local computation immediately — do not retry the same failing API. "
        f"Fix any issues until the tool runs successfully and returns valid output (not an error dict)."
    )
