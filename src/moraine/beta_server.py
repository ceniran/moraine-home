from __future__ import annotations

import json
import mimetypes
import os
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .adviser import AdviserSecretStore
from .aml_adapter import AMLAdapter
from .beta_store import BetaStore


MAX_BODY = 2 * 1024 * 1024


def create_beta_server(env: dict[str, str] | None = None):
    env = env or dict(os.environ)
    host = env.get("MORAINE_BETA_HOST", "127.0.0.1")
    port = int(env.get("MORAINE_BETA_PORT", "4790"))
    token = env.get("MORAINE_BETA_TOKEN", "")
    if host not in {"127.0.0.1", "::1", "localhost"} and not token:
        raise ValueError("MORAINE_BETA_TOKEN is required when binding beyond loopback")
    package_root = Path(__file__).resolve().parent
    web_root = Path(env.get("MORAINE_BETA_WEB_ROOT", package_root / "static")).resolve()
    data_file = Path(env.get("MORAINE_BETA_DATA_FILE", "./data/beta-store.json"))
    seed_file = Path(env.get("MORAINE_BETA_SEED_FILE", package_root / "data" / "beta-seed.json"))
    semantic_url = env.get("MORAINE_SEMANTIC_URL", "").rstrip("/")
    semantic_token = env.get("MORAINE_SEMANTIC_TOKEN", "")
    store = BetaStore(data_file, seed_file)
    adviser = AdviserSecretStore(env.get("MORAINE_ADVISER_SECRET_FILE", data_file.parent / ".adviser-secret.json"))
    aml_embedder = None
    if env.get("MORAINE_AML_SEMANTIC", "").lower() in {"1", "true", "yes"}:
        from .server import FastEmbedder
        aml_embedder = FastEmbedder(
            env.get("MORAINE_AML_MODEL", env.get("MORAINE_MODEL", "BAAI/bge-small-zh-v1.5")),
            env.get("MORAINE_AML_MODEL_CACHE", env.get("MORAINE_MODEL_CACHE", "./models")),
            int(env.get("MORAINE_AML_THREADS", env.get("MORAINE_THREADS", "2"))),
        )
    aml = AMLAdapter(env.get("MORAINE_AML_DATA_DIR", data_file.parent / "aml-evaluation"), aml_embedder,
                     int(env.get("MORAINE_AML_BATCH_SIZE", "4")))
    def search(query: str, limit: int) -> dict:
        if semantic_url:
            endpoint = f"{semantic_url}/search?{urllib.parse.urlencode({'query': query, 'limit': limit})}"
            request = urllib.request.Request(endpoint)
            if semantic_token:
                request.add_header("Authorization", f"Bearer {semantic_token}")
            try:
                with urllib.request.urlopen(request, timeout=8) as response:
                    result = json.load(response)
                by_id = {row["id"]: row for row in store.list_memories("active")}
                rows = [{**by_id[item["id"]], "score": item["score"], "search_mode": "semantic"} for item in result.get("results", []) if item.get("id") in by_id]
                return {"mode": "semantic", "items": rows}
            except Exception:
                pass
        return {"mode": "keyword", "items": store.keyword_search(query, limit)}

    class Handler(BaseHTTPRequestHandler):
        server_version = "MoraineBeta/0.1"

        def log_message(self, _format, *_args):
            return

        def _json(self, status: int, value) -> None:
            body = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _authorized(self) -> bool:
            return not token or self.headers.get("Authorization") == f"Bearer {token}"

        def _body(self) -> dict:
            length = int(self.headers.get("Content-Length", "0"))
            if length > MAX_BODY:
                raise OverflowError("request_too_large")
            value = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(value, dict):
                raise ValueError("JSON body must be an object")
            return value

        def _static(self, request_path: str) -> None:
            relative = request_path.lstrip("/") or "index.html"
            target = (web_root / relative).resolve()
            if web_root not in target.parents and target != web_root:
                return self._json(403, {"error": "forbidden"})
            if not target.is_file():
                target = web_root / "index.html"
            if not target.is_file():
                return self._json(404, {"error": "web_not_installed"})
            body = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(parsed.query)
            try:
                if parsed.path == "/api/health":
                    return self._json(200, {"ok": True, "service": "moraine-beta", "schema": BetaStore.SCHEMA,
                                            "auth_required": bool(token)})
                if parsed.path.startswith("/api/") and not self._authorized():
                    return self._json(401, {"error": "unauthorized"})
                if parsed.path == "/api/overview":
                    return self._json(200, store.overview())
                if parsed.path == "/api/memories":
                    return self._json(200, {"items": store.list_memories(query.get("state", ["all"])[0])})
                if parsed.path == "/api/candidates/tiering":
                    return self._json(200, {"items": store.tiering_suggestions(), "persisted": False})
                if parsed.path == "/api/candidates":
                    return self._json(200, {"items": store.list_candidates()})
                if parsed.path == "/api/events":
                    return self._json(200, {"items": store.list_events(int(query.get("limit", [200])[0]))})
                if parsed.path == "/api/rollbacks":
                    return self._json(200, {"items": store.list_rollbacks(), "ttl_hours": 48})
                if parsed.path == "/api/snapshots":
                    return self._json(200, {"items": store.list_snapshots()})
                if parsed.path == "/api/calendar":
                    return self._json(200, {"items": store.calendar()})
                if parsed.path == "/api/profile":
                    return self._json(200, store.profile())
                if parsed.path == "/api/self-core":
                    return self._json(200, {"items": store.list_self_core(query.get("state", ["active"])[0])})
                if parsed.path == "/api/user-profile":
                    return self._json(200, {"items": store.list_user_profile(query.get("state", ["active"])[0])})
                if parsed.path == "/api/relations":
                    return self._json(200, {"items": store.list_relations()})
                if parsed.path == "/api/continuity/settings":
                    return self._json(200, store.continuity_settings())
                if parsed.path == "/api/recall/layered":
                    context = store.layered_context(query.get("query", [""])[0],
                                                    query.get("history", ["0"])[0] in {"1", "true", "yes"})
                    if query.get("summary", ["0"])[0] in {"1", "true", "yes"}:
                        context["layers"] = [
                            {key: value for key, value in layer.items() if key != "items"}
                            | {"item_count": len(layer.get("items") or [])}
                            for layer in context["layers"]
                        ]
                    return self._json(200, context)
                if parsed.path == "/api/settings":
                    return self._json(200, store.settings())
                if parsed.path == "/api/adviser":
                    return self._json(200, adviser.public())
                if parsed.path == "/api/search":
                    return self._json(200, search(query.get("query", [""])[0], int(query.get("limit", [20])[0])))
                if parsed.path == "/api/export":
                    return self._json(200, store.snapshot())
                if parsed.path.startswith("/api/"):
                    return self._json(404, {"error": "not_found"})
                return self._static(parsed.path)
            except Exception as error:
                return self._json(500, {"error": f"{type(error).__name__}: {error}"})

        def do_POST(self):
            parsed = urllib.parse.urlparse(self.path)
            try:
                if not self._authorized():
                    return self._json(401, {"error": "unauthorized"})
                body = self._body()
                if parsed.path == "/aml/add":
                    return self._json(200, aml.add(body))
                if parsed.path == "/aml/search":
                    return self._json(200, aml.search(body))
                if parsed.path == "/api/candidates":
                    return self._json(201, store.add_candidate(body))
                if parsed.path == "/api/candidates/admit":
                    row = store.admit(body.get("candidate_ids") or [], body.get("title"), body.get("content"),
                                      body.get("relations"), body.get("memory_tier"), body.get("expires_at"))
                    return self._json(201, row)
                if parsed.path == "/api/candidates/consolidate-preview":
                    return self._json(200, store.consolidation_preview(body.get("candidate_ids") or [], body.get("relations")))
                if parsed.path == "/api/candidates/shred":
                    return self._json(200, store.shred_eligible_candidates())
                if parsed.path == "/api/snapshots":
                    return self._json(201, store.create_snapshot(str(body.get("label") or "manual")))
                if parsed.path.startswith("/api/snapshots/"):
                    parts = parsed.path.split("/")
                    if len(parts) == 4:
                        return self._json(200, store.restore_snapshot(parts[3]))
                if parsed.path.startswith("/api/rollbacks/"):
                    parts = parsed.path.split("/")
                    if len(parts) == 4:
                        return self._json(200, store.rollback_candidate_admission(parts[3]))
                if parsed.path.startswith("/api/candidates/"):
                    parts = parsed.path.split("/")
                    if len(parts) == 5 and parts[4] in {"ignore", "restore"}:
                        return self._json(200, store.decide_candidate(parts[3], parts[4]))
                    if len(parts) == 5 and parts[4] == "route":
                        return self._json(200, store.route_candidate(parts[3], str(body.get("destination") or ""), body))
                if parsed.path.startswith("/api/memories/"):
                    parts = parsed.path.split("/")
                    if len(parts) == 5 and parts[4] in {"archive", "restore"}:
                        return self._json(200, store.set_archive(parts[3], parts[4] == "archive"))
                    if len(parts) == 5 and parts[4] == "importance":
                        return self._json(200, store.set_importance(parts[3], body.get("importance")))
                    if len(parts) == 5 and parts[4] == "revise":
                        return self._json(200, store.revise_memory(parts[3], title=body.get("title"), content=body.get("content"), reason=body.get("reason")))
                    if len(parts) == 5 and parts[4] == "replace":
                        return self._json(200, store.replace_memory(parts[3], str(body.get("replacement_id") or ""), str(body.get("reason") or "")))
                if parsed.path == "/api/import":
                    return self._json(200, store.replace_all(body))
                if parsed.path == "/api/profile":
                    return self._json(200, store.update_profile(body))
                if parsed.path == "/api/self-core":
                    return self._json(200, store.upsert_self_core(body))
                if parsed.path.startswith("/api/self-core/"):
                    parts = parsed.path.split("/")
                    if len(parts) == 5 and parts[4] in {"archive", "restore"}:
                        return self._json(200, store.set_self_core_archived(parts[3], parts[4] == "archive",
                                                                           str(body.get("reason") or "")))
                if parsed.path == "/api/user-profile":
                    return self._json(200, store.upsert_user_profile(body))
                if parsed.path.startswith("/api/user-profile/"):
                    parts = parsed.path.split("/")
                    if len(parts) == 5 and parts[4] in {"archive", "restore"}:
                        return self._json(200, store.set_user_profile_archived(parts[3], parts[4] == "archive",
                                                                               str(body.get("reason") or "")))
                if parsed.path == "/api/relations":
                    return self._json(200, store.upsert_relation(body))
                if parsed.path == "/api/continuity/settings":
                    return self._json(200, store.update_continuity_settings(body))
                if parsed.path == "/api/recall/layered":
                    return self._json(200, store.layered_context(str(body.get("query") or ""),
                                                                 bool(body.get("include_history", False)),
                                                                 dict(body.get("budgets") or {})))
                if parsed.path == "/api/wakeup/preview":
                    adviser_status = adviser.public()
                    return self._json(200, store.wakeup_preview(list(body.get("signals") or []),
                                                                str(body.get("query") or ""),
                                                                bool(body.get("adviser_enabled", False)
                                                                     and adviser_status["enabled"]
                                                                     and adviser_status["use_for_wakeup"])))
                if parsed.path == "/api/settings":
                    return self._json(200, store.update_settings(body))
                if parsed.path == "/api/adviser":
                    return self._json(200, adviser.update(body))
                return self._json(404, {"error": "not_found"})
            except OverflowError:
                return self._json(413, {"error": "request_too_large"})
            except KeyError:
                return self._json(404, {"error": "memory_not_found"})
            except (ValueError, json.JSONDecodeError) as error:
                return self._json(400, {"error": str(error)})
            except Exception as error:
                return self._json(500, {"error": f"{type(error).__name__}: {error}"})

    return ThreadingHTTPServer((host, port), Handler)


def main() -> None:
    create_beta_server().serve_forever()


if __name__ == "__main__":
    main()
