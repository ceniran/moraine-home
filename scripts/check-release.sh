#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

if grep -RniE --binary-files=without-match --exclude='*.pyc' --exclude-dir='__pycache__' \
  '/var/lib/dwell|/etc/dwell|agent\.qq\.com|w130297|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|sk-[A-Za-z0-9_-]{20,}' \
  src examples deploy docs tests README.md README.zh-CN.md .env.example Dockerfile compose.yaml NOTICE.md; then
  echo "release check failed: private path, address, or credential-like text found" >&2
  exit 1
fi

PYTHONPATH=src python3 -m unittest tests.test_beta_store tests.test_beta_server
if PYTHONPATH=src python3 -c 'import mcp' 2>/dev/null; then
  PYTHONPATH=src python3 -m unittest tests.test_mcp_server
else
  echo "release check: MCP protocol test skipped (install with pip install -e '.[mcp]')"
fi
python3 -m compileall -q src/moraine/beta_store.py src/moraine/beta_server.py src/moraine/mcp_server.py
node --check src/moraine/static/app.js
node --check src/moraine/static/service-worker.js
git diff --check

echo "release check: ok"
