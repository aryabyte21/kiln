#!/usr/bin/env bash
# scripts/publish.sh — build + publish kiln-shared and kiln-registry-api to PyPI
#
# Usage:
#   export UV_PUBLISH_TOKEN="pypi-XXXXX"   # mint at https://pypi.org/manage/account/token/
#   ./scripts/publish.sh                    # publishes to PyPI
#   ./scripts/publish.sh --test             # publishes to TestPyPI for a dry-run
#
# The script always:
#   1. Cleans dist/
#   2. Builds both wheels
#   3. Runs `twine check` (PyPI's metadata validator)
#   4. Smoke-tests the wheels in a fresh venv
#   5. Asks for confirmation
#   6. Uploads both packages (kiln-shared first, since registry depends on it)

set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"

PUBLISH_URL=""
if [[ "${1:-}" == "--test" ]]; then
  PUBLISH_URL="--publish-url https://test.pypi.org/legacy/"
  echo "→ Publishing to TestPyPI"
else
  echo "→ Publishing to PyPI"
fi

if [[ -z "${UV_PUBLISH_TOKEN:-}" ]]; then
  echo "ERROR: UV_PUBLISH_TOKEN is not set. Mint one at"
  echo "       https://pypi.org/manage/account/token/   (or testpypi.org for --test)"
  echo "       then:  export UV_PUBLISH_TOKEN='pypi-...'"
  exit 1
fi

echo "→ Cleaning dist/"
rm -rf dist

echo "→ Building wheels"
uv build --package kiln-shared
uv build --package kiln-registry-api

echo
echo "→ Built artefacts:"
ls -lh dist/

echo
echo "→ Validating metadata with twine check"
uvx twine check dist/*

echo
echo "→ Smoke-testing in a clean venv (/tmp/kiln-publish-test)"
rm -rf /tmp/kiln-publish-test
python3.12 -m venv /tmp/kiln-publish-test
/tmp/kiln-publish-test/bin/pip install --quiet \
  dist/kiln_shared-*-py3-none-any.whl \
  dist/kiln_registry_api-*-py3-none-any.whl
/tmp/kiln-publish-test/bin/python -c "
from kiln_shared import KilnTool, KilnToolSpec
from kiln_registry.runtime import KilnRuntime, ADAPTERS
assert set(ADAPTERS) == {'ag2', 'langchain', 'pydantic_ai', 'mistral'}
print('  smoke test passed')
"

echo
read -p "→ All checks green. Push to ${PUBLISH_URL:-PyPI}? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

echo
echo "→ Publishing kiln-shared (first — kiln-registry-api depends on it)"
# shellcheck disable=SC2086
uv publish $PUBLISH_URL dist/kiln_shared-*

echo
echo "→ Publishing kiln-registry-api"
# shellcheck disable=SC2086
uv publish $PUBLISH_URL dist/kiln_registry_api-*

echo
echo "✓ Done. View at:"
if [[ -n "$PUBLISH_URL" ]]; then
  echo "  https://test.pypi.org/project/kiln-shared/"
  echo "  https://test.pypi.org/project/kiln-registry-api/"
else
  echo "  https://pypi.org/project/kiln-shared/"
  echo "  https://pypi.org/project/kiln-registry-api/"
fi
