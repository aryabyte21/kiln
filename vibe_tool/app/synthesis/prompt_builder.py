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
id: com.aria.tools.<tool_name>
name: <Human Readable Name>
description: <What the tool does — this becomes the LLM function description>

interface:
  inputs:
    - name: <param_name>
      type: <string|integer|float|boolean|enum|array|object>
      description: <what it is>
      required: <true|false>
      default: <optional default value>
      values: [<for enum type only>]
  output:
    type: object
    fields:
      - name: <field_name>
        type: <type>
        description: <what it returns>

implementation:
  language: python
  entry_point: impl.py
  function: run
  dependencies:
    - <pip package if needed, e.g. requests>

targets:
  - ag2
  - raw_python

testing:
  fixtures:
    - description: <test case description>
      input:
        <param>: <value>
      expect_keys:
        - <expected_key_1>
        - <expected_key_2>

execution:
  timeout: 10
  retries: 2
  async: false
  error_format:
    type: object
    fields:
      - name: error
        type: string
      - name: code
        type: integer

metadata:
  author: vibe_tool
  version: 1.0.0
  tags: [synthesized]
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
- MUST define exactly one function: `def run(**kwargs) -> dict`
- Accept all inputs defined in spec as keyword arguments with appropriate defaults
- Return a dict whose keys match the output fields in the spec
- On error, return `{"error": "<message>"}` — NEVER raise exceptions to the caller
- Include mock/fallback behavior so tests pass even without live API keys
  (check `os.environ.get("API_KEY")` and return realistic mock data if missing)
- Only import stdlib modules + dependencies declared in spec.implementation.dependencies
- Keep the implementation concise and production-quality
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
        if inp.type == "string":
            sample[inp.name] = "test"
        elif inp.type == "integer":
            sample[inp.name] = 1
        elif inp.type == "float":
            sample[inp.name] = 1.0
        elif inp.type == "boolean":
            sample[inp.name] = True
        elif inp.type == "enum" and inp.values:
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

The implementation MUST read these from `os.environ.get()` and return mock/fallback data if they are not set:

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

## Testing

After generating both files, you MUST test the tool by running:

```bash
cd {workspace}
python -c "from impl import run; import json; result = run({_build_test_input(request)}); print(json.dumps(result, indent=2))"
```

Verify:
1. The command runs without errors
2. The output is a valid dict (not an error dict)
3. The output contains the expected keys from the spec

If the test fails, fix the implementation and re-test until it passes.

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
        f"After creating both files, test the tool by running: "
        f'python -c "from impl import run; import json; print(json.dumps(run({test_input}), indent=2))" '
        f"Fix any issues until the tool runs successfully and returns valid output."
    )
