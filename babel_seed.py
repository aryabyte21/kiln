"""
babel_seed.py
-------------
Registry seed script — run this once at startup to compile and publish
all 8 pre-built tools from tools/ into the Babel registry.

Usage:
    python babel_seed.py
    python babel_seed.py --tools-dir /path/to/tools
    python babel_seed.py --force   # re-publish even if already registered
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

# Ensure project root is on path
sys.path.insert(0, str(Path(__file__).parent))

from babel.compiler.adapters.ag2_adapter import AG2Adapter
from babel.registry.local_registry import LocalRegistry
from babel.runtime.babel_runtime import BabelRuntime

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")


def seed(tools_dir: Path, dist_dir: Path, force: bool = False) -> None:
    adapter = AG2Adapter()
    registry = LocalRegistry()
    runtime = BabelRuntime(registry=registry, dist_dir=dist_dir)

    spec_files = sorted(tools_dir.glob("*/spec.yaml"))
    if not spec_files:
        print(f"No spec.yaml files found under {tools_dir}")
        return

    print(f"\nBabel Registry Seed")
    print(f"{'='*50}")
    print(f"Tools dir:   {tools_dir}")
    print(f"Dist dir:    {dist_dir}")
    print(f"DB:          {registry.db_path}")
    print(f"{'='*50}")

    seeded = 0
    skipped = 0
    failed = 0

    for spec_file in spec_files:
        tool_name = spec_file.parent.name
        t0 = time.monotonic()

        try:
            spec = adapter.load_spec(spec_file)
            tool_id = spec["id"]

            # Skip if already registered and not forcing
            if not force and registry.query(tool_id):
                print(f"  SKIP  {tool_id}  (already registered)")
                skipped += 1
                continue

            impl_path = (spec_file.parent / spec["implementation"]["entry_point"]).resolve()
            if not impl_path.exists():
                raise FileNotFoundError(f"impl not found: {impl_path}")

            # Compile
            adapter.compile(spec, impl_path, dist_dir)

            # Publish to registry
            registry.publish(spec, impl_path, source="pre-built")

            elapsed = (time.monotonic() - t0) * 1000
            print(f"  OK    {tool_id}  ({elapsed:.0f}ms)")
            seeded += 1

        except Exception as exc:
            print(f"  FAIL  {tool_name}: {exc}")
            failed += 1

    print(f"\nDone. Seeded: {seeded}  Skipped: {skipped}  Failed: {failed}")
    print(f"Registry total: {registry.count()} tool(s)")
    print(f"Hit rate:       {registry.hit_rate():.1%}")

    # Warm the runtime cache for all successfully seeded tools
    print(f"\nWarming runtime cache ...")
    warmed = runtime.precompile_all()
    print(f"  Cached {len(warmed)} tool(s)")

    # Quick smoke-test: load weather if available
    weather_id = registry.query("weather")
    if weather_id:
        try:
            tool = runtime.load(weather_id)
            result = tool["function"](location="Singapore")
            temp = result.get("temperature", "?")
            loc = result.get("location_name", "?")
            print(f"\nSmoke test — weather(Singapore): {temp}° @ {loc}  ✓")
        except Exception as exc:
            print(f"\nSmoke test failed: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the Babel registry with pre-built tools")
    parser.add_argument("--tools-dir", default="tools", help="Path to tools/ directory")
    parser.add_argument("--dist-dir", default="dist", help="Compiler output directory")
    parser.add_argument("--force", action="store_true", help="Re-publish even if already registered")
    args = parser.parse_args()

    tools_dir = Path(args.tools_dir).resolve()
    dist_dir = Path(args.dist_dir).resolve()

    if not tools_dir.exists():
        print(f"ERROR: tools directory not found: {tools_dir}", file=sys.stderr)
        sys.exit(1)

    seed(tools_dir, dist_dir, force=args.force)


if __name__ == "__main__":
    main()
