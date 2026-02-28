"""
babel.cli.babel_cli
--------------------
Babel CLI — compile, publish, install, validate, and manage the registry.

Usage:
    python -m babel.cli compile tools/weather/spec.yaml --target ag2
    python -m babel.cli publish tools/weather/spec.yaml
    python -m babel.cli validate tools/weather/spec.yaml
    python -m babel.cli registry list
    python -m babel.cli registry info com.aria.tools.weather
    python -m babel.cli registry seed
    python -m babel.cli registry stats

Run with --help for full usage.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

# Lazy imports inside subcommands to keep startup fast


def cmd_compile(args: argparse.Namespace) -> None:
    """Compile a Babel spec to a target binding."""
    from babel.compiler.adapters.ag2_adapter import AG2Adapter
    from babel.compiler.adapters.raw_python_adapter import RawPythonAdapter

    spec_path = Path(args.spec).resolve()
    if not spec_path.exists():
        print(f"ERROR: Spec file not found: {spec_path}", file=sys.stderr)
        sys.exit(1)

    dist_dir = Path(args.output).resolve() if args.output else Path("dist").resolve()
    target = args.target.lower()

    from babel.compiler.adapters.pydantic_adapter import PydanticAdapter
    from babel.compiler.adapters.langchain_adapter import LangChainAdapter

    adapter_map = {
        "ag2":        AG2Adapter,
        "raw_python":  RawPythonAdapter,
        "pydantic":   PydanticAdapter,
        "langchain":  LangChainAdapter,
    }
    if target not in adapter_map:
        print(f"ERROR: Unknown target '{target}'. Choose from: {list(adapter_map)}", file=sys.stderr)
        sys.exit(1)

    adapter = adapter_map[target]()
    print(f"Compiling {spec_path.name} → target={target} ...")

    try:
        out_dir = adapter.compile_from_file(spec_path, dist_dir)
        print(f"  ✓ Output: {out_dir}")
    except Exception as exc:
        print(f"  ✗ Compilation failed: {exc}", file=sys.stderr)
        sys.exit(1)


def cmd_validate(args: argparse.Namespace) -> None:
    """Validate a Babel spec against the schema."""
    import jsonschema
    from babel.compiler.adapters.ag2_adapter import AG2Adapter

    spec_path = Path(args.spec).resolve()
    if not spec_path.exists():
        print(f"ERROR: File not found: {spec_path}", file=sys.stderr)
        sys.exit(1)

    adapter = AG2Adapter()

    with open(spec_path) as f:
        spec = yaml.safe_load(f)

    print(f"Validating {spec_path.name} ...")
    try:
        adapter.validate_spec(spec)
        print(f"  ✓ Valid Babel spec: {spec['id']} v{spec.get('metadata', {}).get('version', '?')}")
    except jsonschema.ValidationError as exc:
        print(f"  ✗ Validation failed:\n    {exc.message}", file=sys.stderr)
        sys.exit(1)


def cmd_publish(args: argparse.Namespace) -> None:
    """Validate a spec, run fixtures, and publish to the registry."""
    from babel.compiler.adapters.ag2_adapter import AG2Adapter
    from babel.registry.local_registry import LocalRegistry

    spec_path = Path(args.spec).resolve()
    if not spec_path.exists():
        print(f"ERROR: Spec file not found: {spec_path}", file=sys.stderr)
        sys.exit(1)

    adapter = AG2Adapter()
    print(f"Publishing {spec_path.name} ...")

    try:
        spec = adapter.load_spec(spec_path)
    except Exception as exc:
        print(f"  ✗ Spec validation failed: {exc}", file=sys.stderr)
        sys.exit(1)

    impl_rel = spec["implementation"]["entry_point"]
    impl_path = (spec_path.parent / impl_rel).resolve()
    if not impl_path.exists():
        print(f"  ✗ Implementation file not found: {impl_path}", file=sys.stderr)
        sys.exit(1)

    # Run test fixtures if present and not skipped
    if not args.skip_tests:
        _run_fixtures(spec, impl_path)

    registry = LocalRegistry()
    source = args.source or "pre-built"
    tool_id = registry.publish(spec, impl_path, source=source)
    print(f"  ✓ Published: {tool_id} (total in registry: {registry.count()})")


def _run_fixtures(spec: dict, impl_path: Path) -> None:
    """Run test fixtures from the spec against the implementation."""
    import importlib.util

    fixtures = spec.get("testing", {}).get("fixtures", [])
    if not fixtures:
        print("  (no fixtures defined — skipping tests)")
        return

    mod_spec = importlib.util.spec_from_file_location("_fixture_impl", impl_path)
    mod = importlib.util.module_from_spec(mod_spec)
    mod_spec.loader.exec_module(mod)

    passed = 0
    failed = 0
    for i, fixture in enumerate(fixtures):
        desc = fixture.get("description", f"fixture {i+1}")
        inputs = fixture.get("input", {})
        expect_keys = fixture.get("expect_keys", [])
        try:
            result = mod.run(**inputs)
            if "error" in result and len(result) == 1:
                raise RuntimeError(result["error"])
            missing = [k for k in expect_keys if k not in result]
            if missing:
                raise AssertionError(f"Missing keys in output: {missing}")
            print(f"  ✓ {desc}")
            passed += 1
        except Exception as exc:
            print(f"  ✗ {desc}: {exc}")
            failed += 1

    if failed > 0:
        print(f"  {failed} fixture(s) failed — aborting publish", file=sys.stderr)
        sys.exit(1)


def cmd_registry_list(args: argparse.Namespace) -> None:
    """List all tools in the registry."""
    from babel.registry.local_registry import LocalRegistry

    registry = LocalRegistry()
    tools = registry.list()

    if not tools:
        print("Registry is empty.")
        return

    print(f"\n{'Tool ID':<45} {'Name':<25} {'Version':<8} {'Source':<12}")
    print("-" * 95)
    for t in tools:
        tags_str = ", ".join(t["tags"][:3]) if t["tags"] else ""
        print(f"{t['tool_id']:<45} {t['name']:<25} {t['version']:<8} {t['source']:<12}")
    print(f"\nTotal: {len(tools)} tool(s) | Hit rate: {registry.hit_rate():.1%}")


def cmd_registry_info(args: argparse.Namespace) -> None:
    """Show full info for a single tool."""
    from babel.registry.local_registry import LocalRegistry

    registry = LocalRegistry()
    row = registry.get(args.tool_id)
    if not row:
        print(f"Tool not found: {args.tool_id}", file=sys.stderr)
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  {row['name']}  ({row['tool_id']})")
    print(f"{'='*60}")
    print(f"  Version:     {row['version']}")
    print(f"  Description: {row['description']}")
    print(f"  Source:      {row['source']}")
    print(f"  Tags:        {', '.join(row['tags'])}")
    print(f"  impl_path:   {row['impl_path']}")
    print(f"  created_at:  {row['created_at']}")
    print(f"\n--- Spec ---\n{row['spec_yaml']}")


def cmd_registry_seed(args: argparse.Namespace) -> None:
    """Publish all pre-built tools from tools/ directory to the registry."""
    tools_dir = Path(args.tools_dir or "tools").resolve()
    if not tools_dir.exists():
        print(f"ERROR: tools/ directory not found at: {tools_dir}", file=sys.stderr)
        sys.exit(1)

    from babel.compiler.adapters.ag2_adapter import AG2Adapter
    from babel.registry.local_registry import LocalRegistry

    adapter = AG2Adapter()
    registry = LocalRegistry()
    dist_dir = Path("dist").resolve()

    seeded = 0
    errors = 0
    for spec_file in sorted(tools_dir.glob("*/spec.yaml")):
        tool_name = spec_file.parent.name
        print(f"  Seeding {tool_name} ...")
        try:
            spec = adapter.load_spec(spec_file)
            impl_path = (spec_file.parent / spec["implementation"]["entry_point"]).resolve()
            # Compile to dist/
            adapter.compile(spec, impl_path, dist_dir)
            registry.publish(spec, impl_path, source="pre-built")
            print(f"    ✓ {spec['id']}")
            seeded += 1
        except Exception as exc:
            print(f"    ✗ {tool_name}: {exc}")
            errors += 1

    print(f"\nSeeded {seeded} tool(s). Errors: {errors}. Registry total: {registry.count()}")


def cmd_registry_stats(args: argparse.Namespace) -> None:
    """Show registry statistics."""
    from babel.registry.local_registry import LocalRegistry

    registry = LocalRegistry()
    tools = registry.list()

    pre_built = sum(1 for t in tools if t["source"] == "pre-built")
    synthesized = sum(1 for t in tools if t["source"] == "synthesized")

    print(f"\nBabel Registry Stats")
    print(f"{'='*30}")
    print(f"  Total tools:    {len(tools)}")
    print(f"  Pre-built:      {pre_built}")
    print(f"  Synthesized:    {synthesized}")
    print(f"  Query hit rate: {registry.hit_rate():.1%}")

    events = registry.get_events(limit=10)
    if events:
        print(f"\n  Recent events:")
        for e in events[:5]:
            print(f"    [{e['created_at']}] {e['event_type']:<15} {e['tool_id'] or ''}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="babel",
        description="Babel CLI — ARIA's universal tool packaging system",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # compile
    p_compile = sub.add_parser("compile", help="Compile a Babel spec to a target")
    p_compile.add_argument("spec", help="Path to .babel.yaml spec file")
    p_compile.add_argument("--target", default="ag2", help="Compilation target: ag2 | raw_python | pydantic | langchain")
    p_compile.add_argument("--output", default=None, help="Output dist/ directory (default: ./dist)")
    p_compile.set_defaults(func=cmd_compile)

    # validate
    p_validate = sub.add_parser("validate", help="Validate a Babel spec against the schema")
    p_validate.add_argument("spec", help="Path to .babel.yaml spec file")
    p_validate.set_defaults(func=cmd_validate)

    # publish
    p_publish = sub.add_parser("publish", help="Validate, test, and publish a tool to the registry")
    p_publish.add_argument("spec", help="Path to .babel.yaml spec file")
    p_publish.add_argument("--skip-tests", action="store_true", help="Skip fixture tests")
    p_publish.add_argument("--source", default="pre-built", help="Tool source label")
    p_publish.set_defaults(func=cmd_publish)

    # registry subcommands
    p_reg = sub.add_parser("registry", help="Registry management commands")
    reg_sub = p_reg.add_subparsers(dest="registry_command", required=True)

    r_list = reg_sub.add_parser("list", help="List all tools in the registry")
    r_list.set_defaults(func=cmd_registry_list)

    r_info = reg_sub.add_parser("info", help="Show details for a specific tool")
    r_info.add_argument("tool_id", help="Full tool ID (e.g. com.aria.tools.weather)")
    r_info.set_defaults(func=cmd_registry_info)

    r_seed = reg_sub.add_parser("seed", help="Publish all tools from tools/ to registry")
    r_seed.add_argument("--tools-dir", default="tools", help="Path to tools directory")
    r_seed.set_defaults(func=cmd_registry_seed)

    r_stats = reg_sub.add_parser("stats", help="Show registry statistics")
    r_stats.set_defaults(func=cmd_registry_stats)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
