"""CLI entrypoints for kiln_registry.

Exposed as the ``kiln-registry`` console script so k8s Jobs and init-containers
can run migrations without invoking Alembic directly::

    kiln-registry migrate              # upgrade head
    kiln-registry migrate --revision X # upgrade to specific revision
    kiln-registry migrate --downgrade  # downgrade one step
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config


def _alembic_config() -> Config:
    ini_path = Path(__file__).parent.parent / "alembic.ini"
    if not ini_path.exists():
        raise FileNotFoundError(f"alembic.ini not found at {ini_path}")
    cfg = Config(str(ini_path))
    cfg.set_main_option("script_location", str(ini_path.parent / "kiln_registry" / "migrations"))
    return cfg


def migrate(args: argparse.Namespace) -> int:
    cfg = _alembic_config()
    if args.downgrade:
        command.downgrade(cfg, args.revision or "-1")
    else:
        command.upgrade(cfg, args.revision or "head")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kiln-registry")
    sub = parser.add_subparsers(dest="command", required=True)

    m = sub.add_parser("migrate", help="Run database migrations")
    m.add_argument("--revision", default=None, help="Target revision (default: head)")
    m.add_argument("--downgrade", action="store_true", help="Downgrade instead of upgrade")
    m.set_defaults(func=migrate)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
