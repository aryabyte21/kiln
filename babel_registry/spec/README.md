# Babel Tool Specification Format

Babel is ARIA's universal tool packaging standard. Every tool in the ARIA ecosystem — whether pre-built, synthesized by Vibe, or contributed externally — is described by a Babel spec file.

---

## What is a Babel Spec?

A `.babel.yaml` file is the single source of truth for a tool. It defines:

- **Identity** — unique ID, name, description
- **Interface** — typed inputs and outputs (used by the LLM planner and AG2 schema)
- **Implementation** — which Python file and function to call
- **Targets** — which compilation targets are supported (`ag2`, `raw_python`)
- **Testing** — fixture inputs/expected outputs for validation
- **Execution contract** — timeout, retries, async behaviour
- **Metadata** — authorship, tags, required API keys

---

## Spec Structure

```yaml
babel_version: "1.0"          # Required. Always "1.0" for this version.
id: com.aria.tools.weather    # Required. Reverse-domain unique tool ID.
name: Weather Tool            # Required. Human-readable name.
description: "..."            # Required. Used as AG2 tool description for the LLM.

interface:
  inputs:
    - name: location          # Required. Parameter name (snake_case).
      type: string            # Required. See "Types" below.
      description: "..."      # Optional but strongly recommended.
      required: true          # Default: true.
      default: metric         # Optional default value.
      values: [a, b, c]      # Only for type: enum. Lists allowed values.
  output:
    type: object              # Return type. Usually object.
    fields:                   # Sub-fields when type is object.
      - name: temperature
        type: float

implementation:
  language: python            # Only python supported in v1.0.
  entry_point: impl.py        # Relative path from the spec file's directory.
  function: run               # Function to call in the module.
  dependencies:               # Optional pip packages.
    - requests

targets:                      # Which compiler targets to support.
  - ag2
  - raw_python

testing:
  fixtures:
    - description: "..."      # Human label for this test case.
      input:
        location: Singapore   # Input kwargs passed to the function.
      expect_keys:            # Assert these keys exist in output.
        - temperature

execution:
  timeout: 10                 # Seconds before the call is killed. Default: 30.
  retries: 2                  # Retry attempts on failure. Default: 0.
  async: false                # Whether the function is async. Default: false.

metadata:
  author: ARIA Team
  version: 1.0.0
  tags: [weather, utility]
  api_keys_required: [OPENWEATHERMAP_API_KEY]
```

---

## Types

| Type      | Python equivalent   | Notes                                              |
|-----------|---------------------|----------------------------------------------------|
| `string`  | `str`               |                                                    |
| `integer` | `int`               |                                                    |
| `float`   | `float`             |                                                    |
| `boolean` | `bool`              |                                                    |
| `enum`    | `str` (constrained) | Must include `values: [...]` list                  |
| `array`   | `list`              | Use `items:` to describe element type              |
| `object`  | `dict`              | Use `fields:` for known sub-keys                   |

---

## Tool ID Convention

Tool IDs use reverse domain notation and must be lowercase alphanumeric with dots:

```
com.aria.tools.<tool_name>
```

Examples:
- `com.aria.tools.weather`
- `com.aria.tools.gcal_create`
- `com.aria.tools.restaurant_search`

IDs are the primary key in the Babel registry.

---

## Implementation Contract

The `function` named in `implementation.function` must:

1. Accept all `interface.inputs` as **keyword arguments**
2. Return a `dict` matching the `interface.output` structure
3. On error, return `{"error": "<message>", "code": <int>}` (or raise — the runtime will catch it)

```python
# tools/weather/impl.py
def run(location: str, units: str = "metric", forecast_days: int = 0) -> dict:
    ...
    return {
        "temperature": 28.5,
        "conditions": "partly cloudy",
        "location_name": "Singapore",
        "forecast": []
    }
```

---

## Validation

Validate a spec from the command line:

```bash
python -m babel.cli validate tools/weather/spec.yaml
```

Or programmatically:

```python
from babel.compiler.base import BabelAdapter
adapter = BabelAdapter.from_schema()
adapter.validate_spec(spec_dict)  # raises jsonschema.ValidationError on failure
```

---

## Sample Specs

Three hand-written reference specs are in `babel/spec/samples/`:

| File                     | Tool ID                        | Owner |
|--------------------------|--------------------------------|-------|
| `weather.babel.yaml`     | `com.aria.tools.weather`       | E2    |
| `web_search.babel.yaml`  | `com.aria.tools.web_search`    | E3    |
| `gcal_create.babel.yaml` | `com.aria.tools.gcal_create`   | E1    |

---

## Integration Notes

**For E1 (Planner):** Query the registry with `registry.query(tool_name)` before flagging a gap. The planner's `gaps[]` list should only contain tool IDs not found in the registry.

**For E3 (AG2 Runner):** Use `runtime.load(tool_id)` to get a compiled AG2 tool object. The returned dict has `name`, `description`, `function`, and `schema` keys. Pass `function` to `register_for_execution` and `schema` to `register_for_llm`.

**For Vibe Synthesis (E3):** When synthesising a new tool, output must be a valid Babel spec + `impl.py`. Call `registry.publish(spec_dict, impl_path)` to add it to the registry and resume the graph.
