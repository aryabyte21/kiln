"""
run_server.py
─────────────
Start the BabelServer locally.

Usage:
    conda run -n shekhar python run_server.py
    conda run -n shekhar python run_server.py --port 9000
    conda run -n shekhar python run_server.py --host 0.0.0.0 --port 8765

Once running:
    Docs:    http://localhost:8765/docs
    Health:  http://localhost:8765/health
    Tools:   http://localhost:8765/tools
"""

import argparse
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

import uvicorn

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Start BabelServer")
    parser.add_argument("--host",   default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port",   default=8765, type=int, help="Bind port (default: 8765)")
    parser.add_argument("--reload", action="store_true",   help="Hot-reload on code changes")
    args = parser.parse_args()

    print(f"\n  BabelServer starting on http://{args.host}:{args.port}")
    print(f"  Docs:   http://{args.host}:{args.port}/docs")
    print(f"  Health: http://{args.host}:{args.port}/health\n")

    uvicorn.run(
        "babel_registry.server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )
