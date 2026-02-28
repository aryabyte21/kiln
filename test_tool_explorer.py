"""
test_tool_explorer.py
----------------------
Interactive CLI to browse and call any tool on the Babel Tool Server.

Run:
    .venv/bin/python3 test_tool_explorer.py
"""

import json
import sys
import httpx

SERVER_URL = "http://localhost:8000"


def check_server():
    try:
        httpx.get(f"{SERVER_URL}/tools", timeout=5).raise_for_status()
    except Exception:
        print(f"\nERROR: Cannot reach Babel server at {SERVER_URL}")
        print("  Start it first:  .venv/bin/python3 -m babel_registry.server.tool_server\n")
        sys.exit(1)


def list_tools() -> list[dict]:
    return httpx.get(f"{SERVER_URL}/tools", timeout=10).json()


def get_schema(tool_id: str) -> dict:
    return httpx.get(f"{SERVER_URL}/tools/{tool_id}/schema", timeout=10).json()


def invoke_tool(tool_id: str, args: dict) -> dict:
    resp = httpx.post(
        f"{SERVER_URL}/tools/{tool_id}/invoke",
        json={"args": args},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def pick_tool(tools: list[dict]) -> dict:
    print("\nAvailable tools:\n")
    for i, t in enumerate(tools, 1):
        print(f"  [{i}] {t['name']}")
        print(f"       {t['tool_id']}")
        print(f"       {t['description'][:80]}...")
        print()

    while True:
        try:
            choice = int(input("Select a tool (number): "))
            if 1 <= choice <= len(tools):
                return tools[choice - 1]
        except (ValueError, KeyboardInterrupt):
            pass
        print(f"  Enter a number between 1 and {len(tools)}")


def collect_args(schema: dict) -> dict:
    props    = schema["function"]["parameters"]["properties"]
    required = schema["function"]["parameters"].get("required", [])
    args     = {}

    print("\nEnter values for each parameter (press Enter to skip optional ones):\n")

    for name, info in props.items():
        ptype = info.get("type", "string")
        desc  = info.get("description", "")
        req   = "(required)" if name in required else "(optional)"

        prompt = f"  {name} [{ptype}] {req}"
        if desc:
            prompt += f"\n    {desc}"
        prompt += "\n  > "

        while True:
            raw = input(prompt).strip()

            if not raw:
                if name in required:
                    print(f"  '{name}' is required — please enter a value.")
                    continue
                break  # skip optional

            try:
                if ptype == "integer":
                    args[name] = int(raw)
                elif ptype in ("float", "number"):
                    args[name] = float(raw)
                elif ptype == "boolean":
                    args[name] = raw.lower() in ("true", "1", "yes")
                else:
                    args[name] = raw
                break
            except ValueError:
                print(f"  Expected {ptype}, got '{raw}' — try again.")

    return args


def main():
    check_server()

    print(f"\n{'='*60}")
    print("  BABEL TOOL EXPLORER")
    print(f"  Server: {SERVER_URL}")
    print(f"{'='*60}")

    tools = list_tools()
    if not tools:
        print("\nNo tools registered yet.")
        sys.exit(0)

    while True:
        tool    = pick_tool(tools)
        tool_id = tool["tool_id"]
        schema  = get_schema(tool_id)

        print(f"\n--- {tool['name']} ---")
        print(f"  {tool['description']}\n")

        args   = collect_args(schema)
        print(f"\nCalling {tool_id} with: {args}")

        try:
            result = invoke_tool(tool_id, args)
            print(f"\nResult:\n{json.dumps(result, indent=2)}")
        except httpx.HTTPStatusError as e:
            print(f"\nERROR {e.response.status_code}: {e.response.text}")
        except Exception as e:
            print(f"\nERROR: {e}")

        print()
        again = input("Call another tool? (y/n): ").strip().lower()
        if again != "y":
            break

    print("\nDone.\n")


if __name__ == "__main__":
    main()
