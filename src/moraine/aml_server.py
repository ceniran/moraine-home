from __future__ import annotations

import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .aml_adapter import AMLAdapter


MAX_BODY = 16 * 1024 * 1024


def create_aml_server(env: dict[str, str] | None = None):
    """Create the frontend-free server used by Agent Memory evaluation."""
    env = env or dict(os.environ)
    # The BETA fallbacks let an existing isolated evaluator move to this
    # frontend-free process without copying or printing its deployed secret.
    host = env.get("MORAINE_AML_HOST", env.get("MORAINE_BETA_HOST", "127.0.0.1"))
    port = int(env.get("MORAINE_AML_PORT", env.get("MORAINE_BETA_PORT", "4791")))
    token = env.get("MORAINE_AML_TOKEN", env.get("MORAINE_BETA_TOKEN", ""))
    if host not in {"127.0.0.1", "::1", "localhost"} and not token:
        raise ValueError("MORAINE_AML_TOKEN is required when binding beyond loopback")
    embedder = None
    if env.get("MORAINE_AML_SEMANTIC", "").lower() in {"1", "true", "yes"}:
        from .server import FastEmbedder
        embedder = FastEmbedder(
            env.get("MORAINE_AML_MODEL", "BAAI/bge-small-zh-v1.5"),
            env.get("MORAINE_AML_MODEL_CACHE", "./models"),
            int(env.get("MORAINE_AML_THREADS", "2")),
        )
    adapter = AMLAdapter(
        Path(env.get("MORAINE_AML_DATA_DIR", "./data/aml-evaluation")), embedder,
        int(env.get("MORAINE_AML_BATCH_SIZE", "4")), env.get("MORAINE_AML_DIAGNOSTIC_LOG") or None,
        int(env.get("MORAINE_AML_ADD_SLOTS", "2")),
        int(env.get("MORAINE_AML_EAGER_DERIVED_LIMIT", "1000")),
        # Keep per-request semantic warmup bounded so concurrent evaluator
        # searches do not spend the whole proxy window rebuilding vectors.
        int(env.get("MORAINE_AML_SEARCH_VECTOR_LIMIT", "16")),
    )

    class Handler(BaseHTTPRequestHandler):
        server_version = "MoraineAML/1"

        def log_message(self, _format, *_args):
            return

        def _json(self, status: int, value: dict) -> None:
            payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            try:
                self.end_headers()
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                # The durable Add may finish after an evaluator-side timeout.
                # Its idempotent retry is safe; do not turn a closed response
                # socket into a second misleading internal-error response.
                return

        def _authorized(self) -> bool:
            if not token:
                return True
            authorization = self.headers.get("Authorization", "")
            supplied = self.headers.get("X-Api-Key", "")
            for prefix in ("Bearer ", "Token "):
                if authorization.startswith(prefix):
                    supplied = authorization[len(prefix):]
                    break
            return hmac.compare_digest(supplied, token)

        def _head(self, status: int) -> None:
            self.send_response(status)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def _body(self) -> dict:
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError as error:
                raise ValueError("invalid Content-Length") from error
            if length <= 0 or length > MAX_BODY:
                raise ValueError("request body must be between 1 byte and 16 MiB")
            value = json.loads(self.rfile.read(length))
            if not isinstance(value, dict):
                raise ValueError("JSON body must be an object")
            return value

        def do_GET(self):
            if self.path.rstrip("/") in {"/health", "/api/health"}:
                return self._json(200, {"status": "ok", "service": "moraine-agent-memory"})
            return self._json(404, {"error": "not_found"})

        def do_HEAD(self):
            path = self.path.rstrip("/")
            if path in {"/health", "/api/health"}:
                return self._head(200)
            if path in {"/add", "/aml/add", "/search", "/aml/search"}:
                return self._head(200 if self._authorized() else 401)
            return self._head(404)

        def do_POST(self):
            if not self._authorized():
                return self._json(401, {"error": "unauthorized"})
            try:
                if self.path.rstrip("/") in {"/add", "/aml/add"}:
                    return self._json(200, adapter.add_lazy(self._body))
                if self.path.rstrip("/") in {"/search", "/aml/search"}:
                    return self._json(200, adapter.search_lazy(self._body))
                return self._json(404, {"error": "not_found"})
            except (ValueError, json.JSONDecodeError) as error:
                return self._json(400, {"error": str(error)})
            except Exception:
                return self._json(500, {"error": "internal_error"})

    server = ThreadingHTTPServer((host, port), Handler)
    server.aml_adapter = adapter
    return server


def main() -> None:
    server = create_aml_server()
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
