#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

if grep -RniE --binary-files=without-match --exclude='*.pyc' --exclude-dir='__pycache__' \
  '/var/lib/dwell|/etc/dwell|aml\.dwell\.wiki|agent\.qq\.com|w130297|cairnenen|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|[0-9]{8,10}:[A-Za-z0-9_-]{30,}|AKIA[0-9A-Z]{16}' \
  src examples deploy docs tests README.md README.zh-CN.md .env.example Dockerfile compose.yaml NOTICE.md; then
  echo "release check failed: private path, address, or credential-like text found" >&2
  exit 1
fi

if grep -RniE --binary-files=without-match --exclude='*.pyc' --exclude-dir='__pycache__' \
  '我接受小然|给小然发送|小然确认|翻到小然|>恩恩<|>小然<' \
  src examples deploy docs tests README.md README.zh-CN.md .env.example Dockerfile compose.yaml NOTICE.md; then
  echo "release check failed: maintainer-specific sample or default label found" >&2
  exit 1
fi

PYTHONPATH=src python3 -m unittest tests.test_beta_store tests.test_beta_server tests.test_dwell_release
if PYTHONPATH=src python3 -c 'import mcp' 2>/dev/null; then
  PYTHONPATH=src python3 -m unittest tests.test_mcp_server
else
  echo "release check: MCP protocol test skipped (install with pip install -e '.[mcp]')"
fi
python3 -m compileall -q src/moraine/beta_store.py src/moraine/beta_server.py src/moraine/mcp_server.py
node --check src/moraine/static/auth.js
node --check src/moraine/static/prototype.js
node --check src/moraine/static/execution-plan.js
node --check src/moraine/static/rehearsal-executor.js
node --check src/moraine/static/relation-aware-draft.js
node --check src/moraine/static/dwell-release/auth.js
node --check src/moraine/static/dwell-release/prototype.js
node --check src/moraine/static/dwell-release/release-runtime.js
node --check src/moraine/static/dwell-release/execution-plan.js
node --check src/moraine/static/dwell-release/rehearsal-executor.js
node --check src/moraine/static/dwell-release/relation-aware-draft.js
git diff --check

echo "release check: ok"
