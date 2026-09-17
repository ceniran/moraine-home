from __future__ import annotations

import json
import os
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

from .core import LocalIndex
from .consolidate import MAX_CONSOLIDATE_BODY, consolidation_from_body
from .sources import HttpSource, JsonFileSource


class FastEmbedder:
    def __init__(self, model_name: str, cache_dir: str, threads: int):
        from fastembed import TextEmbedding

        self.model_name = model_name
        self.model = TextEmbedding(model_name=model_name, cache_dir=cache_dir, threads=threads)

    @property
    def identity(self) -> str:
        return f"fastembed:{self.model_name}"

    def passages(self, texts: list[str], batch_size: int) -> list[np.ndarray]:
        return list(self.model.passage_embed(texts, batch_size=batch_size, parallel=1))

    def query(self, text: str) -> np.ndarray:
        return next(iter(self.model.query_embed([text])))


def build_source(env: dict[str, str]):
    mode = env.get("MORAINE_SOURCE_MODE", "json").lower()
    if mode == "json":
        return JsonFileSource(env.get("MORAINE_JSON_PATH", "./documents.json"))
    if mode == "http":
        return HttpSource(
            env.get("MORAINE_HTTP_LIST_URL", ""),
            env.get("MORAINE_HTTP_DETAIL_URL", ""),
            env.get("MORAINE_HTTP_TOKEN", ""),
        )
    raise ValueError("MORAINE_SOURCE_MODE must be json or http")


def create_server(env: dict[str, str] | None = None):
    env = env or dict(os.environ)
    host = env.get("MORAINE_HOST", "127.0.0.1")
    port = int(env.get("MORAINE_PORT", "4781"))
    token = env.get("MORAINE_API_TOKEN", "")
    if host not in {"127.0.0.1", "::1", "localhost"} and not token:
        raise ValueError("MORAINE_API_TOKEN is required when binding beyond loopback")
    index_dir = Path(env.get("MORAINE_INDEX_DIR", "./data"))
    embedder = FastEmbedder(
        env.get("MORAINE_MODEL", "BAAI/bge-small-zh-v1.5"),
        env.get("MORAINE_MODEL_CACHE", "./models"),
        int(env.get("MORAINE_THREADS", "2")),
    )
    index = LocalIndex(build_source(env), embedder, index_dir / "index.json", int(env.get("MORAINE_BATCH_SIZE", "4")))

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format, *_args):
            return

        def send_json(self, status: int, value: dict) -> None:
            body = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def authorized(self) -> bool:
            return not token or self.headers.get("Authorization") == f"Bearer {token}"

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            try:
                if parsed.path == "/health":
                    return self.send_json(200, index.health())
                if parsed.path == "/search":
                    if not self.authorized():
                        return self.send_json(401, {"error": "unauthorized"})
                    params = urllib.parse.parse_qs(parsed.query)
                    results = index.search(params.get("query", [""])[0], int(params.get("limit", [20])[0]))
                    return self.send_json(200, {"count": len(results), "results": results})
                return self.send_json(404, {"error": "not_found"})
            except Exception as error:
                status = 400 if isinstance(error, ValueError) else 500
                return self.send_json(status, {"error": f"{type(error).__name__}: {error}"})

        def do_POST(self):
            try:
                if self.path not in {"/refresh", "/consolidate"}:
                    return self.send_json(404, {"error": "not_found"})
                if not self.authorized():
                    return self.send_json(401, {"error": "unauthorized"})
                if self.path == "/consolidate":
                    length = int(self.headers.get("Content-Length", "0"))
                    if length > MAX_CONSOLIDATE_BODY:
                        return self.send_json(413, {"error": "request_too_large"})
                    result = consolidation_from_body(self.rfile.read(length))
                    return self.send_json(200, result)
                result = index.refresh()
                return self.send_json(202 if result.get("accepted") else 409, result)
            except (ValueError, json.JSONDecodeError) as error:
                return self.send_json(400, {"error": f"{type(error).__name__}: {error}"})
            except Exception as error:
                return self.send_json(500, {"error": f"{type(error).__name__}: {error}"})

    refresh_seconds = max(0, int(env.get("MORAINE_REFRESH_SECONDS", "300")))

    def refresh_once():
        try:
            index.refresh()
        except Exception:
            pass

    def periodic_refresh():
        while True:
            time.sleep(refresh_seconds)
            refresh_once()

    threading.Thread(target=refresh_once, daemon=True).start()
    if refresh_seconds:
        threading.Thread(target=periodic_refresh, daemon=True).start()
    return ThreadingHTTPServer((host, port), Handler)


def main() -> None:
    create_server().serve_forever()


if __name__ == "__main__":
    main()
