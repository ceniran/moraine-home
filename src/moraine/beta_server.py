from __future__ import annotations

import json
import hmac
import mimetypes
import os
import re
import secrets
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .adviser import AdviserSecretStore
from .aml_adapter import AMLAdapter
from .beta_store import BetaStore
from .candidate_capture import write_guidance


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
                     int(env.get("MORAINE_AML_BATCH_SIZE", "4")), env.get("MORAINE_AML_DIAGNOSTIC_LOG") or None)
    action_drafts: dict[str, dict] = {}
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

    def memory_terms(row: dict) -> set[str]:
        text = " ".join((str(row.get("title") or ""), str(row.get("content") or ""),
                         " ".join(str(tag) for tag in row.get("tags") or []))).casefold()
        words = set(re.findall(r"[a-z0-9_]{2,}|[\u3400-\u9fff]{2,}", text))
        compact = "".join(re.findall(r"[\u3400-\u9fff]", text))
        words.update(compact[index:index + 2] for index in range(max(0, len(compact) - 1)))
        return words

    def memory_similarity(left: dict, right: dict) -> float:
        a, b = memory_terms(left), memory_terms(right)
        return len(a & b) / max(1, len(a | b))

    def workbench_clusters(offset: int = 0, include_related: bool = False) -> dict:
        rows = store.list_memories("active")
        queue = store.workbench_queue()
        dismissed = set(queue.get("dismissed_pairs") or [])
        deferred = set(queue.get("deferred_source_ids") or [])
        clusters = []
        for source in rows:
            if source.get("id") in deferred:
                continue
            neighbors = []
            for other in rows:
                if other.get("id") == source.get("id"):
                    continue
                pair = "::".join(sorted((str(source.get("id")), str(other.get("id")))))
                if pair in dismissed:
                    continue
                score = memory_similarity(source, other)
                threshold = 0.04 if include_related else 0.10
                if score >= threshold:
                    neighbors.append({**other, "similarity": round(score, 4),
                                      "assessment": "possible_duplicate" if score >= .35 else "related_only"})
            neighbors.sort(key=lambda row: row["similarity"], reverse=True)
            if neighbors:
                clusters.append({"source": {**source, "similarity": 1.0}, "neighbors": neighbors[:5]})
        if not clusters:
            return {"clusters": [], "persisted": False}
        index = max(0, min(int(offset), len(clusters) - 1))
        cluster = clusters[index]
        cluster["selection"] = {"offset": index, "position": index + 1, "total": len(clusters),
                                "has_next": index + 1 < len(clusters), "origin_source_id": cluster["source"]["id"]}
        return {"clusters": [cluster], "persisted": False}

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
            if not token:
                return True
            authorization = self.headers.get("Authorization", "")
            supplied = ""
            if authorization.startswith("Bearer "):
                supplied = authorization[7:]
            elif authorization.startswith("Token "):
                supplied = authorization[6:]
            elif self.headers.get("X-Api-Key"):
                supplied = self.headers.get("X-Api-Key", "")
            return hmac.compare_digest(supplied, token)

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
            if target.is_dir():
                target = target / "index.html"
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
                if parsed.path == "/api/dwell-v2/library":
                    rows = store.list_memories(query.get("state", ["all"])[0])
                    return self._json(200, {"ok": True, "mode": "moraine_beta_isolated", "memories": [
                        {"id": row.get("id"), "title": row.get("title"), "preview": row.get("content", ""),
                         "kind": row.get("kind", "event"), "tags": row.get("tags") or [],
                         "importance": row.get("importance", .5), "state": row.get("state", "active"),
                         "occurred_at": row.get("occurred_at"), "created_at": row.get("created_at"),
                         "updated_at": row.get("updated_at"), "source": "Moraine beta",
                         "protected": row.get("kind") in {"identity", "relationship"},
                         "version_count": max(1, len(row.get("versions") or []) + 1)}
                        for row in rows]})
                if parsed.path == "/api/dwell-v2/overview":
                    overview = store.overview()
                    active = store.list_memories("active")
                    candidates = [row for row in store.list_candidates() if row.get("state", "pending") == "pending"]
                    weights = {"transient": 0, "normal": 0, "stable": 0, "important": 0, "core": 0}
                    for row in active:
                        importance = float(row.get("importance", .5) or .5)
                        band = ("core" if importance >= .9 else "important" if importance >= .75 else
                                "stable" if importance >= .55 else "normal" if importance >= .3 else "transient")
                        weights[band] += 1
                    return self._json(200, {"ok": True, "mode": "moraine_beta_isolated",
                                            "counts": {"effective": len(active), "weighted_effective": len(active),
                                                       "pending_reviews": 0, "pending_candidates": len(candidates),
                                                       "weights": weights},
                                            "recent": overview.get("recent", []),
                                            "generated_at": overview.get("updated_at")})
                if parsed.path == "/api/dwell-v2/calendar":
                    month = query.get("month", [""])[0]
                    events = []
                    undated = 0
                    for row in store.list_memories("all"):
                        date = str(row.get("occurred_at") or row.get("created_at") or "")[:10]
                        if not date:
                            undated += 1
                            continue
                        if month and not date.startswith(month + "-"):
                            continue
                        events.append({"id": row.get("id"), "open_id": row.get("id"), "day": date,
                                       "title": row.get("title"), "preview": row.get("content", "")[:180],
                                       "kind": row.get("kind", "event"), "state": row.get("state", "active"),
                                       "role": "memory"})
                    return self._json(200, {"ok": True, "mode": "moraine_beta_isolated", "month": month,
                                            "events": events, "undated_count": undated})
                if parsed.path == "/api/dwell-v2/relations":
                    profile = store.profile()
                    relationships = store.list_relations("active")
                    edges = [{"from": "cairn", "to": row.get("id"), "direction": "both"}
                             for row in relationships if row.get("id")]
                    for row in relationships:
                        row["role"] = row.get("relation", "")
                        row["model"] = row.get("model", "")
                        row["status"] = row.get("status") or row.get("relation", "")
                        row["summary"] = row.get("summary") or row.get("private_note", "")
                        row["source_memory_ids"] = list(row.get("source_ids") or [])
                        row["source_labels"] = [str(item) for item in row.get("source_ids") or []]
                    return self._json(200, {"ok": True, "mode": "moraine_beta_isolated",
                                            "relationships": relationships, "edges": edges,
                                            "identity_profile": profile, "resident_identity": profile,
                                            "self_core": {"items": store.list_self_core("active")},
                                            "user_profile": {"items": store.list_user_profile("active")},
                                            "achievements": None, "pending_projection_count": 0})
                if parsed.path == "/api/dwell-v2/layered-recall":
                    context = store.layered_context(query.get("query", [""])[0], False)
                    return self._json(200, {**context, "mode": "live_read_only_layered_recall",
                                            "persisted": False, "writes": []})
                if parsed.path == "/api/dwell-v2/profile-recall-policy":
                    return self._json(200, {"ok": True, "policy": store.profile_recall_policy()})
                if parsed.path == "/api/dwell-v2/profile-growth-candidates":
                    return self._json(200, {"ok": True,
                                            "pending": store.list_profile_growth_candidates("pending")})
                if parsed.path == "/api/dwell-v2/candidate-shred-policy":
                    settings = store.settings()
                    return self._json(200, {"ok": True, "policy": {
                        "enabled": settings.get("candidate_retention_enabled", False),
                        "retention_hours": settings.get("candidate_retention_hours", 168)}})
                if parsed.path == "/api/dwell-v2/portability/snapshots":
                    return self._json(200, {"ok": True, "snapshots": store.list_snapshots()})
                if parsed.path == "/api/dwell-v2/portability/export":
                    return self._json(200, store.snapshot())
                if parsed.path == "/api/dwell-v2/queue":
                    return self._json(200, {"ok": True, "queue": store.workbench_queue()})
                if parsed.path == "/api/dwell-v2/clusters":
                    return self._json(200, workbench_clusters(
                        int(query.get("offset", [0])[0]), query.get("include_related", ["0"])[0] in {"1", "true"}))
                if parsed.path == "/api/dwell-v2/replacements":
                    candidates = []
                    rows = store.list_memories("active")
                    for index, old in enumerate(rows):
                        for new in rows[index + 1:]:
                            score = memory_similarity(old, new)
                            if score < .12:
                                continue
                            candidates.append({"id": f"{old['id']}::{new['id']}", "old_memory": old,
                                               "new_memory": new, "similarity": score, "gap_hours": 24})
                    return self._json(200, {"candidates": candidates[:20], "persisted": False})
                if parsed.path == "/api/dwell-v2/cleanup":
                    return self._json(200, {"candidates": [], "near_duplicate_candidates": [],
                                            "recycle": [row for row in store.list_memories("all")
                                                        if row.get("state") == "archived"], "persisted": False})
                if parsed.path == "/api/dwell-v2/rollbacks":
                    rows = store.list_rollbacks()
                    return self._json(200, {"rollbacks": [{**row, "memory_ids": [row["memory_id"]]} for row in rows]})
                if parsed.path == "/api/dwell-v2/flow":
                    return self._json(200, {"persisted": False, "writes": [], "stages": [
                        {"key": "candidate", "number": "01", "title": "候选", "status": "可审阅", "summary": "事件先进入候选箱", "items": ["保留来源"]},
                        {"key": "review", "number": "02", "title": "核对", "status": "人工判断", "summary": "检查边界与关系", "items": ["不自动裁决"]},
                        {"key": "memory", "number": "03", "title": "记忆", "status": "可回退", "summary": "确认后进入记忆库", "items": ["保留历史"]},
                    ]})
                if parsed.path == "/api/dwell-v2/activities":
                    limit = max(1, min(500, int(query.get("limit", [120])[0])))
                    labels = {
                        "candidate_added": "候选", "candidates_admitted": "记忆",
                        "memory_revised": "修订", "memory_archived": "归档",
                        "memory_restored": "恢复", "settings_updated": "设置",
                    }
                    items = []
                    for event in reversed(store.list_events(limit)):
                        kind = str(event.get("type") or "activity")
                        items.append({"id": event.get("id"), "occurred_at": event.get("at"),
                                      "kind": kind, "kind_label": labels.get(kind, "活动"),
                                      "place": "Moraine", "summary": kind.replace("_", " "),
                                      "visibility": "private"})
                    return self._json(200, {"ok": True, "items": items})
                if parsed.path == "/api/dwell-v2/diary":
                    notes = [row for row in store.list_memories("active")
                             if str(row.get("kind") or "").casefold() in {"reflection", "note", "diary"}]
                    return self._json(200, {"ok": True, "items": [
                        {"id": row.get("id"), "title": row.get("title"), "content": row.get("content"),
                         "type": row.get("kind", "note"), "author": "shared",
                         "createdAt": row.get("created_at"), "updatedAt": row.get("updated_at")}
                        for row in notes]})
                if parsed.path == "/api/dwell-v2/governance":
                    rows = store.list_memories("active")
                    bands = {"短暂": 0, "普通": 0, "稳定": 0, "重要": 0, "核心": 0}
                    samples = []
                    for row in rows:
                        strength = round(float(row.get("importance", .5) or .5) * 100)
                        band = "核心" if strength >= 90 else "重要" if strength >= 75 else "稳定" if strength >= 55 else "普通" if strength >= 30 else "短暂"
                        bands[band] += 1
                        samples.append({"id": row.get("id"), "title": row.get("title"),
                                        "kind": row.get("kind", "event"), "current_strength": strength,
                                        "suggested_strength": strength,
                                        "requires_review": row.get("kind") in {"identity", "relationship"}})
                    return self._json(200, {"count": len(rows), "current_distribution": bands,
                                            "suggested_distribution": dict(bands), "samples": samples[:12],
                                            "persisted": False})
                if parsed.path == "/api/dwell-v2/identity-relation-routing-policy":
                    settings = store.settings()
                    return self._json(200, {"ok": True, "policy": {
                        "enabled": settings.get("identity_relation_routing", False),
                        "retain_memory_copy": settings.get("retain_identity_memory_copy", False)}})
                if parsed.path == "/api/dwell-v2/jev-settings":
                    return self._json(200, {"ok": True, "settings": adviser.public()})
                if parsed.path.startswith("/api/dwell-v2/experience-threads/"):
                    memories = store.list_memories("active")
                    return self._json(200, {"ok": True, "persisted": False,
                                            "thread": {"id": parsed.path.rsplit("/", 1)[-1],
                                                       "title": "项目发展线", "items": memories[:12]}})
                if parsed.path == "/api/dwell-v2/reflections":
                    return self._json(200, {"ok": True, "reflections": []})
                if parsed.path == "/api/dwell-v2/candidates":
                    all_candidates = store.list_candidates()
                    rows = [row for row in all_candidates if row.get("state") == "pending"]
                    archived = [row for row in all_candidates if row.get("state") in {
                        "admitted", "associated", "ignored", "routed", "shredded"}]
                    retention = store.settings()
                    exposed = [{**row, "review_status": "pending", "candidate_entered_at": row.get("created_at"),
                                "lane": "protected" if row.get("kind") in {"identity", "relationship"} else "actionable",
                                "status": "protected_review" if row.get("kind") in {"identity", "relationship"} else "ready_for_review",
                                "source": {"type": "moraine_beta", "ref": row.get("id"), "actor": "owner"},
                                "neighbor_evidence": {"status": "unavailable", "relationship": "undetermined",
                                                      "candidate_neighbors": [], "memory_neighbors": []},
                                "topic_evidence": {"topics": [], "topic_match_is_not_event_identity": True,
                                                   "persisted": False}, "event_match_suggestions": []}
                               for row in rows]
                    protected = sum(row.get("kind") in {"identity", "relationship"} for row in rows)
                    return self._json(200, {"ok": True, "mode": "moraine_beta_isolated",
                                            "counts": {"pending": len(rows), "actionable": len(rows) - protected,
                                                       "protected": protected, "held": 0, "waiting_batch": 0,
                                                       "needs_review": protected, "today_generated": 0,
                                                       "today_persisted": 0, "recent_concluded": 0,
                                                       "archived": 0, "shred_eligible": 0, "shred_protected": 0},
                                            "candidates": exposed, "archived": archived,
                                            "shred_policy": {
                                                "enabled": retention.get("candidate_retention_enabled", False),
                                                "retention_hours": retention.get("candidate_retention_hours", 168)}})
                if parsed.path.startswith("/api/dwell-v2/memories/"):
                    memory_id = parsed.path.rsplit("/", 1)[-1]
                    row = next((item for item in store.list_memories("all") if item.get("id") == memory_id), None)
                    if row is None:
                        return self._json(404, {"error": "memory_not_found"})
                    return self._json(200, {"id": row.get("id"), "title": row.get("title"),
                                            "content": row.get("content", ""), "timeline": row.get("timeline") or [],
                                            "integration_summary": row.get("content", "")})
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
                    return self._json(200, {"items": store.list_relations(query.get("state", ["all"])[0])})
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
                    episode_id = str(body.get("episode_id") or "").strip()[:160]
                    semantic = search(" ".join((str(body.get("title") or ""), str(body.get("content") or ""))), 8)
                    row = store.add_candidate(body, semantic_neighbors=semantic.get("items") or [],
                                              semantic_mode=str(semantic.get("mode") or "unavailable"))
                    return self._json(201, {**row, "write_guidance": write_guidance(
                        [row], episode_id=episode_id, episode_complete=body.get("episode_complete") is True,
                        batch=False,
                    )})
                if parsed.path == "/api/candidates/batch":
                    episode_id = str(body.get("episode_id") or "").strip()[:160]
                    rows = store.add_candidates(body.get("candidates") or [], episode_id=episode_id)
                    return self._json(201, {"items": rows, "count": len(rows), "write_guidance": write_guidance(
                        rows, episode_id=episode_id, episode_complete=body.get("episode_complete") is True,
                        batch=True,
                    )})
                if parsed.path == "/api/dwell-v2/queue":
                    return self._json(200, {"ok": True, "queue": store.update_workbench_queue(
                        str(body.get("action") or ""), str(body.get("source_id") or ""),
                        str(body.get("neighbor_id") or ""))})
                if parsed.path == "/api/dwell-v2/actions/preview":
                    action = str(body.get("action") or "")
                    if action == "auto_weight":
                        rows = store.list_memories("active")
                        draft_id = "draft_" + secrets.token_hex(8)
                        confirmation_code = f"{secrets.randbelow(1000000):06d}"
                        action_drafts[draft_id] = {"action": action, "body": body,
                                                   "confirmation_code": confirmation_code}
                        held = sum(row.get("kind") in {"identity", "relationship"} for row in rows)
                        return self._json(200, {"ok": True, "persisted": False, "draft_id": draft_id,
                                                "confirmation_code": confirmation_code, "action": action,
                                                "summary": {"will_update": 0, "held_for_review": held},
                                                "writes": []})
                    if action in {"content_revision", "weight", "supersede", "restore_archive", "archive", "merge_many"}:
                        draft_id = "draft_" + secrets.token_hex(8)
                        confirmation_code = f"{secrets.randbelow(1000000):06d}"
                        action_drafts[draft_id] = {"action": action, "body": body,
                                                   "confirmation_code": confirmation_code}
                        memory_id = str(body.get("memory_id") or body.get("old_memory_id") or body.get("old_id") or "")
                        row = next((item for item in store.list_memories("all") if item.get("id") == memory_id), None)
                        response = {"ok": True, "persisted": False, "draft_id": draft_id,
                                    "confirmation_code": confirmation_code, "action": action,
                                    "reason": str(body.get("reason") or ""), "before": row,
                                    "after": {**(row or {}), "title": body.get("title", (row or {}).get("title")),
                                              "content": body.get("content", (row or {}).get("content")),
                                              "importance": body.get("importance", (row or {}).get("importance"))},
                                    "changes": {"importance": body.get("importance")},
                                    "writes": [memory_id] if memory_id else []}
                        if action == "supersede":
                            replacement_id = str(body.get("replacement_id") or body.get("new_memory_id") or "")
                            response["replacement"] = next((item for item in store.list_memories("active")
                                                              if item.get("id") == replacement_id), None)
                        if action == "merge_many":
                            members = [item for item in store.list_memories("active")
                                       if item.get("id") in set(body.get("memory_ids") or [])]
                            response.update({"target": {"title": body.get("result_title") or "整合记忆"},
                                             "sources": members, "protected_source_ids": []})
                        return self._json(200, response)
                    if action != "candidate_merge":
                        return self._json(400, {"error": "unsupported_dwell_v2_action"})
                    candidate_ids = [str(value) for value in body.get("candidate_ids") or []]
                    master_id = str(body.get("master_id") or "")
                    if len(candidate_ids) < 2 or master_id not in candidate_ids:
                        raise ValueError("candidate_merge requires at least two candidates and a master")
                    candidates = {row.get("id"): row for row in store.list_candidates()}
                    master = candidates.get(master_id)
                    if master is None or master.get("state", "pending") != "pending":
                        raise ValueError("candidate_master_missing")
                    if str(master.get("kind") or "").casefold() in {"identity", "relationship", "boundary"}:
                        raise ValueError("candidate_master_protected")
                    relations = {master_id: "supplement"}
                    relations.update({str(key): str(value) for key, value in dict(body.get("member_relations") or {}).items()})
                    preview = store.consolidation_preview(candidate_ids, relations)
                    preview["title"] = master.get("title") or preview.get("title")
                    draft_id = "draft_" + secrets.token_hex(8)
                    confirmation_code = f"{secrets.randbelow(1000000):06d}"
                    action_drafts[draft_id] = {"candidate_ids": candidate_ids, "relations": relations,
                                               "title": preview["title"], "content": preview["content"],
                                               "confirmation_code": confirmation_code}
                    members = [{"id": candidate_id,
                                "relation": "master" if candidate_id == master_id else relations.get(candidate_id, "supplement"),
                                "disposition": "reference_active" if relations.get(candidate_id) == "related_only" else "conclude"}
                               for candidate_id in candidate_ids]
                    return self._json(200, {"ok": True, "persisted": False, "draft_id": draft_id,
                                            "confirmation_code": confirmation_code,
                                            "result_preview": {"title": preview["title"], "content": preview["content"]},
                                            "member_relations": members})
                if parsed.path == "/api/dwell-v2/actions/execute":
                    draft_id = str(body.get("draft_id") or "")
                    draft = action_drafts.get(draft_id)
                    if draft is None:
                        raise ValueError("draft_not_found")
                    if not hmac.compare_digest(str(body.get("confirmation_code") or ""), draft["confirmation_code"]):
                        raise ValueError("confirmation_code_mismatch")
                    if draft.get("action"):
                        payload, action = draft["body"], draft["action"]
                        if action == "content_revision":
                            result = store.revise_memory(str(payload.get("memory_id") or ""), title=payload.get("title"),
                                                         content=payload.get("content"), reason=payload.get("reason"))
                        elif action == "weight":
                            result = store.set_importance(str(payload.get("memory_id") or ""), payload.get("importance"))
                        elif action == "supersede":
                            result = store.replace_memory(str(payload.get("old_memory_id") or payload.get("old_id") or payload.get("memory_id") or ""),
                                                          str(payload.get("new_memory_id") or payload.get("replacement_id") or ""),
                                                          str(payload.get("reason") or ""))
                        elif action == "merge_many":
                            result = store.merge_memories(list(payload.get("memory_ids") or []),
                                                          title=str(payload.get("result_title") or payload.get("title") or "整合记忆"),
                                                          content=str(payload.get("result_content") or payload.get("content") or "\n\n".join(
                                                              row.get("content", "") for row in store.list_memories("active")
                                                              if row.get("id") in set(payload.get("memory_ids") or []))),
                                                          reason=str(payload.get("reason") or "人工确认整合"))
                        elif action in {"restore_archive", "archive"}:
                            result = store.set_archive(str(payload.get("memory_id") or ""), action == "archive")
                        elif action == "auto_weight":
                            result = {"updated": 0, "held_for_review": sum(
                                row.get("kind") in {"identity", "relationship"}
                                for row in store.list_memories("active"))}
                        action_drafts.pop(draft_id, None)
                        return self._json(200, {"ok": True, "action": action, "result": result,
                                                **(result if isinstance(result, dict) else {})})
                    memory = store.admit(draft["candidate_ids"], draft["title"], draft["content"], draft["relations"])
                    action_drafts.pop(draft_id, None)
                    return self._json(200, {"ok": True, "memory": memory,
                                            "concluded_candidate_ids": draft["candidate_ids"],
                                            "rollback": memory.get("rollback")})
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
                if parsed.path.startswith("/api/relations/"):
                    parts = parsed.path.split("/")
                    if len(parts) == 5 and parts[4] in {"archive", "restore"}:
                        return self._json(200, store.set_relation_archived(parts[3], parts[4] == "archive",
                                                                           str(body.get("reason") or "")))
                if parsed.path == "/api/continuity/settings":
                    return self._json(200, store.update_continuity_settings(body))
                if parsed.path == "/api/dwell-v2/profile-recall-policy":
                    return self._json(200, {"ok": True, "policy": store.update_profile_recall_policy(body)})
                if parsed.path == "/api/dwell-v2/profile-growth-candidates":
                    return self._json(201, {"ok": True, "candidate": store.add_profile_growth_candidate(body)})
                if parsed.path == "/api/dwell-v2/profile-growth-candidates/decide":
                    return self._json(200, {"ok": True, "candidate": store.decide_profile_growth_candidate(
                        str(body.get("candidate_id") or ""), str(body.get("action") or ""))})
                if parsed.path == "/api/dwell-v2/candidate-shred-policy":
                    current = store.settings()
                    updated = store.update_settings({
                        **current,
                        "candidate_retention_enabled": bool(body.get("enabled", current.get("candidate_retention_enabled", False))),
                        "candidate_retention_hours": int(body.get("retention_hours", current.get("candidate_retention_hours", 168))),
                    })
                    return self._json(200, {"ok": True, "policy": {
                        "enabled": updated["candidate_retention_enabled"],
                        "retention_hours": updated["candidate_retention_hours"]}})
                if parsed.path == "/api/dwell-v2/identity-relation-routing-policy":
                    current = store.settings()
                    updated = store.update_settings({
                        **current,
                        "identity_relation_routing": bool(body.get("enabled", current.get("identity_relation_routing", False))),
                        "retain_identity_memory_copy": bool(body.get("retain_memory_copy", current.get("retain_identity_memory_copy", False))),
                    })
                    return self._json(200, {"ok": True, "policy": {
                        "enabled": updated.get("identity_relation_routing", False),
                        "retain_memory_copy": updated.get("retain_identity_memory_copy", False)}})
                if parsed.path == "/api/dwell-v2/jev-settings":
                    return self._json(200, {"ok": True, "settings": adviser.update(body)})
                if parsed.path == "/api/dwell-v2/candidate-shred/run":
                    return self._json(200, store.shred_eligible_candidates())
                if parsed.path == "/api/dwell-v2/portability/snapshots":
                    return self._json(201, {"ok": True, "snapshot": store.create_snapshot(
                        str(body.get("label") or "manual"))})
                if parsed.path.startswith("/api/dwell-v2/portability/snapshots/") and parsed.path.endswith("/restore-preview"):
                    snapshot_id = parsed.path.split("/")[-2]
                    target = store.snapshots_path / f"{snapshot_id}.json"
                    if not target.is_file():
                        raise KeyError(snapshot_id)
                    snapshot_payload = json.loads(target.read_text(encoding="utf-8"))
                    current = store.snapshot()
                    current_ids = {row.get("id") for row in current.get("memories") or []}
                    target_ids = {row.get("id") for row in snapshot_payload.get("memories") or []}
                    draft_id = "snapshot_restore_" + secrets.token_hex(8)
                    confirmation_code = f"{secrets.randbelow(1000000):06d}"
                    action_drafts[draft_id] = {"action": "snapshot_restore", "snapshot_id": snapshot_id,
                                               "confirmation_code": confirmation_code}
                    return self._json(200, {"ok": True, "persisted": False, "draft_id": draft_id,
                                            "confirmation_code": confirmation_code,
                                            "impact": {"changed": len(current_ids & target_ids),
                                                       "missing": len(target_ids - current_ids), "held": 0,
                                                       "newer_preserved": len(current_ids - target_ids)}})
                if parsed.path == "/api/dwell-v2/portability/restore-execute":
                    draft = action_drafts.get(str(body.get("draft_id") or ""))
                    if not draft or draft.get("action") != "snapshot_restore":
                        raise ValueError("snapshot_restore_draft_not_found")
                    if not hmac.compare_digest(str(body.get("confirmation_code") or ""), draft["confirmation_code"]):
                        raise ValueError("confirmation_code_mismatch")
                    before = store.snapshot()
                    result = store.restore_snapshot(draft["snapshot_id"])
                    action_drafts.pop(str(body.get("draft_id")), None)
                    return self._json(200, {"ok": True, "restored": result.get("active", 0), "recreated": 0,
                                            "newer_preserved": 0, "before_count": len(before.get("memories") or [])})
                if parsed.path == "/api/dwell-v2/migration/preview":
                    content = str(body.get("content") or "")
                    filename = str(body.get("filename") or "")
                    rows = []
                    try:
                        parsed_content = json.loads(content)
                        values = parsed_content if isinstance(parsed_content, list) else parsed_content.get("memories", [])
                        for index, value in enumerate(values[:500]):
                            if not isinstance(value, dict):
                                rows.append({"index": index, "status": "invalid", "warnings": ["不是对象"]})
                                continue
                            rows.append({"index": index, "status": "ready", "title": str(value.get("title") or f"导入记忆 {index + 1}"),
                                         "content": str(value.get("content") or value.get("text") or ""),
                                         "kind": str(value.get("kind") or "event"), "tags": value.get("tags") or []})
                    except (ValueError, TypeError, AttributeError):
                        if filename.lower().endswith((".md", ".markdown")) and content.strip():
                            rows = [{"index": 0, "status": "ready", "title": Path(filename).stem or "导入记忆",
                                     "content": content.strip(), "kind": "event", "tags": ["imported"]}]
                        else:
                            rows = [{"index": 0, "status": "invalid", "title": filename,
                                     "warnings": ["无法解析 JSON、JSONL 或 Markdown"]}]
                    ready = [row for row in rows if row.get("status") == "ready" and row.get("content")]
                    for row in rows:
                        if row.get("status") == "ready" and not row.get("content"):
                            row["status"], row["warnings"] = "invalid", ["正文为空"]
                    ready = [row for row in rows if row.get("status") == "ready"]
                    draft_id = "migration_" + secrets.token_hex(8)
                    confirmation_code = f"{secrets.randbelow(1000000):06d}"
                    action_drafts[draft_id] = {"action": "migration", "rows": ready,
                                               "confirmation_code": confirmation_code}
                    counts = {key: sum(row.get("status") == key for row in rows)
                              for key in ("ready", "duplicate", "held", "invalid")}
                    return self._json(200, {"ok": True, "persisted": False, "draft_id": draft_id,
                                            "confirmation_code": confirmation_code,
                                            "preview": {"counts": counts, "rows": rows}})
                if parsed.path == "/api/dwell-v2/migration/execute":
                    draft = action_drafts.get(str(body.get("draft_id") or ""))
                    if not draft or draft.get("action") != "migration":
                        raise ValueError("migration_draft_not_found")
                    if not hmac.compare_digest(str(body.get("confirmation_code") or ""), draft["confirmation_code"]):
                        raise ValueError("confirmation_code_mismatch")
                    imported = []
                    for row in draft["rows"]:
                        candidate = store.add_candidate({"title": row["title"], "content": row["content"],
                                                         "kind": row["kind"], "tags": row.get("tags") or []})
                        imported.append(store.admit([candidate["id"]]))
                    action_drafts.pop(str(body.get("draft_id")), None)
                    rollback_until = max((row.get("rollback", {}).get("available_until", "") for row in imported), default="")
                    return self._json(200, {"ok": True, "imported": len(imported),
                                            "rollback": {"available_until": rollback_until}})
                if parsed.path.startswith("/api/dwell-v2/rollbacks/"):
                    return self._json(200, store.rollback_candidate_admission(parsed.path.rsplit("/", 1)[-1]))
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
