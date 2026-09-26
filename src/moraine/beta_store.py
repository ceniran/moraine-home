from __future__ import annotations

import json
import os
import re
import threading
import uuid
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .consolidate import consolidate
from .continuity import DEFAULT_LAYER_BUDGETS, build_layered_context, build_wakeup_preview
from .memory_tiering import derive_tiering_evidence, suggest_memory_tier


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _atomic_write(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


class BetaStore:
    """Small, auditable store used by the standalone beta workbench.

    The file is the source of truth. Search indexes and UI projections may be
    rebuilt from it, so importing or restoring never depends on a model.
    """

    SCHEMA = 1

    def __init__(self, path: str | Path, seed_path: str | Path | None = None):
        self.path = Path(path)
        self.seed_path = Path(seed_path) if seed_path else None
        self.lock = threading.RLock()
        self._ensure()

    def _empty(self) -> dict:
        return {
            "schema": self.SCHEMA,
            "created_at": utc_now(),
            "updated_at": utc_now(),
            "memories": [],
            "candidates": [],
            "events": [],
            "rollbacks": [],
            "profile": {"display_name": "", "summary": "", "self_core": []},
            "self_core_records": [],
            "user_profile_records": [],
            "relations": [],
            "continuity_settings": {
                "wakeup_enabled": False,
                "adviser_enabled": False,
                "max_choices": 3,
                "total_budget": 5000,
                "layer_budgets": {},
            },
            "settings": {"review_mode": "autonomous", "candidate_retention_enabled": False,
                         "candidate_retention_hours": 168, "identity_relation_routing": False},
        }

    def _ensure(self) -> None:
        if self.path.exists():
            self._read()
            return
        payload = self._empty()
        if self.seed_path and self.seed_path.exists():
            seed = json.loads(self.seed_path.read_text(encoding="utf-8"))
            for key in ("memories", "candidates", "events", "relations"):
                payload[key] = list(seed.get(key) or [])
            if isinstance(seed.get("profile"), dict):
                payload["profile"] = dict(seed["profile"])
            if isinstance(seed.get("settings"), dict):
                payload["settings"] = dict(seed["settings"])
        _atomic_write(self.path, payload)

    def _read(self) -> dict:
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        if int(payload.get("schema", 0)) != self.SCHEMA:
            raise ValueError("unsupported beta store schema")
        for key in ("memories", "candidates", "events"):
            if not isinstance(payload.get(key), list):
                raise ValueError(f"{key} must be a list")
        payload.setdefault("rollbacks", [])
        payload.setdefault("profile", {"display_name": "", "summary": "", "self_core": []})
        payload.setdefault("self_core_records", [])
        payload.setdefault("user_profile_records", [])
        payload.setdefault("relations", [])
        payload.setdefault("continuity_settings", {"wakeup_enabled": False, "adviser_enabled": False,
                                                    "max_choices": 3, "total_budget": 5000, "layer_budgets": {}})
        payload["continuity_settings"].setdefault("total_budget", 5000)
        payload.setdefault("settings", {"review_mode": "autonomous"})
        if (not isinstance(payload["profile"], dict) or not isinstance(payload["relations"], list)
                or not isinstance(payload["self_core_records"], list) or not isinstance(payload["user_profile_records"], list)
                or not isinstance(payload["continuity_settings"], dict)
                or not isinstance(payload["settings"], dict) or not isinstance(payload["rollbacks"], list)):
            raise ValueError("profile and settings must be objects; relations must be a list")
        legacy_settings = payload["settings"]
        payload["settings"] = {
            "review_mode": legacy_settings.get("review_mode", "autonomous"),
            "candidate_retention_enabled": bool(legacy_settings.get("candidate_retention_enabled", False)),
            "candidate_retention_hours": int(legacy_settings.get("candidate_retention_hours", 168)),
            "identity_relation_routing": bool(legacy_settings.get("identity_relation_routing", False)),
            **({"updated_at": legacy_settings["updated_at"]} if legacy_settings.get("updated_at") else {}),
        }
        return payload

    def snapshot(self) -> dict:
        with self.lock:
            return deepcopy(self._read())

    def _save(self, payload: dict) -> None:
        payload["updated_at"] = utc_now()
        _atomic_write(self.path, payload)

    def overview(self) -> dict:
        data = self.snapshot()
        active = [row for row in data["memories"] if row.get("state", "active") == "active"]
        archived = [row for row in data["memories"] if row.get("state") in {"archived", "superseded"}]
        return {
            "total": len(data["memories"]),
            "active": len(active),
            "archived": len(archived),
            "candidates": len([row for row in data["candidates"] if row.get("state", "pending") == "pending"]),
            "updated_at": data["updated_at"],
            "recent": sorted(data["memories"], key=lambda row: row.get("updated_at", ""), reverse=True)[:8],
            "relations": len(data["relations"]),
        }

    def profile(self) -> dict:
        return deepcopy(self.snapshot()["profile"])

    def settings(self) -> dict:
        current = self.snapshot()["settings"]
        return {
            "review_mode": current.get("review_mode", "autonomous"),
            "candidate_retention_enabled": bool(current.get("candidate_retention_enabled", False)),
            "candidate_retention_hours": int(current.get("candidate_retention_hours", 168)),
            "identity_relation_routing": bool(current.get("identity_relation_routing", False)),
            **({"updated_at": current["updated_at"]} if current.get("updated_at") else {}),
        }

    def update_settings(self, value: dict) -> dict:
        current = self.settings()
        mode = str(value.get("review_mode", current.get("review_mode", "autonomous")) or "")
        if mode not in {"autonomous", "joint"}:
            raise ValueError("review_mode must be autonomous or joint")
        retention_hours = int(value.get("candidate_retention_hours", current.get("candidate_retention_hours", 168)))
        if retention_hours not in {24, 72, 168, 720}:
            raise ValueError("candidate_retention_hours must be 24, 72, 168, or 720")
        now = utc_now()
        with self.lock:
            data = self._read()
            data["settings"] = {
                "review_mode": mode,
                "candidate_retention_enabled": bool(value.get("candidate_retention_enabled", current.get("candidate_retention_enabled", False))),
                "candidate_retention_hours": retention_hours,
                "identity_relation_routing": bool(value.get("identity_relation_routing", current.get("identity_relation_routing", False))),
                "updated_at": now,
            }
            data["events"].append({"id": uuid.uuid4().hex, "type": "settings_updated", "at": now, "target": "settings"})
            self._save(data)
            return deepcopy(data["settings"])

    def update_profile(self, value: dict) -> dict:
        if "self_core" in value:
            raise ValueError("profile.self_core is read-only legacy data; use /api/self-core with reason and source_ids")
        display_name = str(value.get("display_name", "")).strip()[:120]
        summary = str(value.get("summary", "")).strip()[:2000]
        now = utc_now()
        with self.lock:
            data = self._read()
            legacy_self_core = list(data["profile"].get("self_core") or [])
            data["profile"] = {"display_name": display_name, "summary": summary,
                               "self_core": legacy_self_core, "updated_at": now}
            data["events"].append({"id": uuid.uuid4().hex, "type": "profile_updated", "at": now, "target": "profile"})
            self._save(data)
            return deepcopy(data["profile"])

    def list_self_core(self, state: str = "active") -> list[dict]:
        rows = deepcopy(self.snapshot()["self_core_records"])
        if state != "all":
            rows = [row for row in rows if row.get("state", "active") == state]
        return sorted(rows, key=lambda row: (int(row.get("position", 0)), str(row.get("created_at", ""))))

    def upsert_self_core(self, value: dict) -> dict:
        text = str(value.get("text") or "").strip()
        reason = str(value.get("reason") or "").strip()
        source_ids = [str(item)[:160] for item in list(value.get("source_ids") or [])[:20] if str(item).strip()]
        if not text or not reason or not source_ids:
            raise ValueError("text, reason, and at least one source_id are required")
        if len(text) > 800:
            raise ValueError("self-core text must contain at most 800 characters")
        record_id = str(value.get("id") or f"core_{uuid.uuid4().hex[:12]}")
        now = utc_now()
        with self.lock:
            data = self._read()
            existing = next((row for row in data["self_core_records"] if row.get("id") == record_id), None)
            if existing is None:
                row = {"id": record_id, "text": text, "source_ids": source_ids, "reason": reason[:500],
                       "state": "active", "position": int(value.get("position", len(data["self_core_records"]))),
                       "created_at": now, "updated_at": now, "versions": []}
                data["self_core_records"].append(row)
                event_type = "self_core_added"
            else:
                versions = list(existing.get("versions") or [])
                versions.append({key: deepcopy(existing.get(key)) for key in ("text", "source_ids", "reason", "updated_at")})
                existing.update({"text": text, "source_ids": source_ids, "reason": reason[:500], "updated_at": now,
                                 "versions": versions[-50:]})
                row, event_type = existing, "self_core_revised"
            data["events"].append({"id": uuid.uuid4().hex, "type": event_type, "at": now, "target": record_id,
                                   "source_ids": source_ids})
            self._save(data)
            return deepcopy(row)

    def set_self_core_archived(self, record_id: str, archived: bool, reason: str) -> dict:
        reason = str(reason).strip()
        if not reason:
            raise ValueError("reason is required")
        now = utc_now()
        with self.lock:
            data = self._read()
            row = next((item for item in data["self_core_records"] if item.get("id") == record_id), None)
            if row is None:
                raise KeyError(record_id)
            row.update({"state": "archived" if archived else "active", "updated_at": now})
            data["events"].append({"id": uuid.uuid4().hex, "type": "self_core_archived" if archived else "self_core_restored",
                                   "at": now, "target": record_id, "reason": reason[:500]})
            self._save(data)
            return deepcopy(row)

    def list_user_profile(self, state: str = "active") -> list[dict]:
        rows = deepcopy(self.snapshot()["user_profile_records"])
        if state != "all":
            rows = [row for row in rows if row.get("state", "active") == state]
        return sorted(rows, key=lambda row: (str(row.get("category", "")), str(row.get("created_at", ""))))

    def upsert_user_profile(self, value: dict) -> dict:
        text = str(value.get("text") or "").strip()
        reason = str(value.get("reason") or "").strip()
        subject = str(value.get("subject") or "user").strip()[:120]
        category = str(value.get("category") or "preference").strip()
        source_ids = [str(item).strip()[:160] for item in list(value.get("source_ids") or [])[:20] if str(item).strip()]
        if category not in {"preference", "boundary", "communication", "context"}:
            raise ValueError("category must be preference, boundary, communication, or context")
        if not text or not reason or not source_ids:
            raise ValueError("text, reason, and at least one source_id are required")
        if len(text) > 1000:
            raise ValueError("user profile text must contain at most 1000 characters")
        record_id = str(value.get("id") or f"user_{uuid.uuid4().hex[:12]}")
        now = utc_now()
        with self.lock:
            data = self._read()
            existing = next((row for row in data["user_profile_records"] if row.get("id") == record_id), None)
            if existing is None:
                row = {"id": record_id, "subject": subject, "category": category, "text": text,
                       "source_ids": source_ids, "reason": reason[:500], "state": "active",
                       "created_at": now, "updated_at": now, "versions": []}
                data["user_profile_records"].append(row)
                event_type = "user_profile_added"
            else:
                versions = list(existing.get("versions") or [])
                versions.append({key: deepcopy(existing.get(key)) for key in
                                 ("subject", "category", "text", "source_ids", "reason", "updated_at")})
                existing.update({"subject": subject, "category": category, "text": text,
                                 "source_ids": source_ids, "reason": reason[:500], "updated_at": now,
                                 "versions": versions[-50:]})
                row, event_type = existing, "user_profile_revised"
            data["events"].append({"id": uuid.uuid4().hex, "type": event_type, "at": now,
                                   "target": record_id, "source_ids": source_ids})
            self._save(data)
            return deepcopy(row)

    def set_user_profile_archived(self, record_id: str, archived: bool, reason: str) -> dict:
        reason = str(reason).strip()
        if not reason:
            raise ValueError("reason is required")
        now = utc_now()
        with self.lock:
            data = self._read()
            row = next((item for item in data["user_profile_records"] if item.get("id") == record_id), None)
            if row is None:
                raise KeyError(record_id)
            row.update({"state": "archived" if archived else "active", "updated_at": now})
            data["events"].append({"id": uuid.uuid4().hex,
                                   "type": "user_profile_archived" if archived else "user_profile_restored",
                                   "at": now, "target": record_id, "reason": reason[:500]})
            self._save(data)
            return deepcopy(row)

    def list_relations(self) -> list[dict]:
        return sorted(deepcopy(self.snapshot()["relations"]), key=lambda row: row.get("updated_at", ""), reverse=True)

    def upsert_relation(self, value: dict) -> dict:
        name = str(value.get("name", "")).strip()
        relation = str(value.get("relation", "")).strip()
        if not name or not relation:
            raise ValueError("name and relation are required")
        relation_id = str(value.get("id") or f"relation_{uuid.uuid4().hex[:12]}")
        now = utc_now()
        facts = [str(item).strip()[:500] for item in list(value.get("facts") or [])[:20] if str(item).strip()]
        source_ids = [str(item).strip()[:160] for item in list(value.get("source_ids") or [])[:20] if str(item).strip()]
        visibility = str(value.get("visibility") or "private")
        if visibility not in {"private", "shared", "public"}:
            raise ValueError("visibility must be private, shared, or public")
        with self.lock:
            data = self._read()
            existing = next((index for index, item in enumerate(data["relations"]) if item.get("id") == relation_id), None)
            if existing is None:
                row = {"id": relation_id, "name": name[:120], "relation": relation[:120],
                       "facts": facts, "private_note": str(value.get("private_note", value.get("note", ""))).strip()[:2000],
                       "source_ids": source_ids, "visibility": visibility, "state": "active",
                       "created_at": now, "updated_at": now, "versions": []}
                data["relations"].append(row)
                action = "relation_added"
            else:
                previous = data["relations"][existing]
                versions = list(previous.get("versions") or [])
                versions.append({key: deepcopy(previous.get(key)) for key in ("name", "relation", "facts", "source_ids", "visibility", "updated_at")})
                row = {**previous, "name": name[:120], "relation": relation[:120], "facts": facts,
                       "private_note": str(value.get("private_note", value.get("note", previous.get("private_note", "")))).strip()[:2000],
                       "source_ids": source_ids, "visibility": visibility, "updated_at": now, "versions": versions[-50:]}
                data["relations"][existing] = row
                action = "relation_updated"
            data["events"].append({"id": uuid.uuid4().hex, "type": action, "at": now, "target": relation_id})
            self._save(data)
        return row

    def continuity_settings(self) -> dict:
        return deepcopy(self.snapshot()["continuity_settings"])

    def update_continuity_settings(self, value: dict) -> dict:
        current = self.continuity_settings()
        max_choices = int(value.get("max_choices", current.get("max_choices", 3)))
        if max_choices < 1 or max_choices > 5:
            raise ValueError("max_choices must be between 1 and 5")
        budgets = dict(value.get("layer_budgets", current.get("layer_budgets", {})) or {})
        total_budget = int(value.get("total_budget", current.get("total_budget", 5000)))
        if total_budget < 1 or total_budget > 12000:
            raise ValueError("total_budget must be between 1 and 12000")
        allowed = {"self_core", "user_profile", "relations", "recent", "long_term", "history"}
        if set(budgets) - allowed or any(int(item) < 0 or int(item) > 20000 for item in budgets.values()):
            raise ValueError("invalid layer_budgets")
        now = utc_now()
        row = {"wakeup_enabled": bool(value.get("wakeup_enabled", current.get("wakeup_enabled", False))),
               "adviser_enabled": bool(value.get("adviser_enabled", current.get("adviser_enabled", False))),
               "max_choices": max_choices, "total_budget": total_budget,
               "layer_budgets": {key: int(item) for key, item in budgets.items()},
               "updated_at": now}
        with self.lock:
            data = self._read()
            data["continuity_settings"] = row
            data["events"].append({"id": uuid.uuid4().hex, "type": "continuity_settings_updated", "at": now,
                                   "target": "continuity_settings"})
            self._save(data)
        return deepcopy(row)

    def layered_context(self, query: str = "", include_history: bool = False, budgets: dict | None = None) -> dict:
        settings = self.continuity_settings()
        requested = dict(budgets or {})
        configured = {**DEFAULT_LAYER_BUDGETS, **dict(settings.get("layer_budgets") or {})}
        effective = dict(configured)
        for key, value in requested.items():
            if key not in DEFAULT_LAYER_BUDGETS:
                raise ValueError("invalid layer budget")
            effective[key] = min(int(value), int(configured[key]))
        return build_layered_context(self.snapshot(), query=str(query), include_history=bool(include_history),
                                     budgets=effective, total_budget=int(settings.get("total_budget", 5000)))

    def wakeup_preview(self, signals: list[dict] | None = None, query: str = "", adviser_enabled: bool = False) -> dict:
        return build_wakeup_preview(self.snapshot(), signals=signals, query=str(query), adviser_enabled=bool(adviser_enabled))

    def list_memories(self, state: str = "all") -> list[dict]:
        rows = self.snapshot()["memories"]
        if state == "historical":
            rows = [row for row in rows if row.get("state") in {"archived", "superseded"}]
        elif state != "all":
            rows = [row for row in rows if row.get("state", "active") == state]
        return sorted(rows, key=lambda row: row.get("occurred_at") or row.get("created_at") or "", reverse=True)

    def list_candidates(self) -> list[dict]:
        rows = self.snapshot()["candidates"]
        return sorted(rows, key=lambda row: row.get("created_at", ""))

    def tiering_suggestions(self) -> list[dict]:
        snapshot = self.snapshot()
        return [
            {"candidate_id": row["id"], **suggest_memory_tier(
                row, evidence=derive_tiering_evidence(row, snapshot)
            )}
            for row in snapshot["candidates"]
            if row.get("state", "pending") == "pending"
        ]

    def list_events(self, limit: int = 200) -> list[dict]:
        rows = self.snapshot()["events"]
        return sorted(rows, key=lambda row: row.get("at", ""), reverse=True)[: max(1, min(int(limit), 1000))]

    def calendar(self) -> list[dict]:
        counts: dict[str, int] = {}
        for row in self.snapshot()["memories"]:
            if row.get("state", "active") != "active":
                continue
            day = str(row.get("occurred_at") or row.get("created_at") or "")[:10]
            if day:
                counts[day] = counts.get(day, 0) + 1
        return [{"date": day, "count": counts[day]} for day in sorted(counts)]

    def keyword_search(self, query: str, limit: int = 20) -> list[dict]:
        words = [word.casefold() for word in re.findall(r"[\w\u3400-\u9fff]+", str(query)) if word.strip()]
        if not words:
            raise ValueError("query is required")
        scored = []
        for row in self.list_memories("active"):
            title = str(row.get("title", "")).casefold()
            body = " ".join((title, str(row.get("content", "")).casefold(), " ".join(row.get("tags") or []).casefold()))
            score = sum((3 if word in title else 1) for word in words if word in body)
            if score:
                scored.append((score, str(row.get("updated_at", "")), row))
        scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
        return [{**deepcopy(row), "score": score / max(1, len(words) * 3), "search_mode": "keyword"} for score, _, row in scored[: max(1, min(int(limit), 100))]]

    def add_candidate(self, value: dict) -> dict:
        title = str(value.get("title", "")).strip()
        content = str(value.get("content", "")).strip()
        if not title or not content:
            raise ValueError("title and content are required")
        now = utc_now()
        row = {
            "id": str(value.get("id") or f"candidate_{uuid.uuid4().hex[:12]}"),
            "title": title[:200],
            "content": content[:20000],
            "kind": str(value.get("kind") or "event")[:40],
            "tags": [str(tag)[:60] for tag in list(value.get("tags") or [])[:20]],
            "occurred_at": str(value.get("occurred_at") or now),
            "created_at": now,
            "state": "pending",
            "basket": str(value.get("basket") or "unassigned")[:120],
        }
        if value.get("expires_at"):
            row["expires_at"] = str(value["expires_at"])
        with self.lock:
            data = self._read()
            if any(item.get("id") == row["id"] for item in data["candidates"]):
                raise ValueError("candidate id already exists")
            data["candidates"].append(row)
            data["events"].append({"id": uuid.uuid4().hex, "type": "candidate_added", "at": now, "target": row["id"]})
            self._save(data)
        return row

    def consolidation_preview(self, candidate_ids: list[str], relations: dict | None = None) -> dict:
        ids = {str(value) for value in candidate_ids}
        if not ids:
            raise ValueError("candidate_ids is required")
        selected = [row for row in self.list_candidates() if row.get("id") in ids and row.get("state", "pending") == "pending"]
        if len(selected) != len(ids):
            raise ValueError("one or more candidates are missing or already decided")
        ordered = sorted(selected, key=lambda row: row.get("occurred_at") or row.get("created_at") or "")
        relations = {str(key): str(value) for key, value in dict(relations or {}).items()}
        allowed = {"duplicate", "supplement", "evolution", "conflict", "related_only"}
        if any(value not in allowed for value in relations.values()):
            raise ValueError("unsupported candidate relation")
        included = [row for row in ordered if relations.get(row["id"], "supplement") != "related_only"]
        if not included:
            raise ValueError("at least one candidate must contribute to the memory")
        draft = consolidate(included)
        conflicts = [row for row in ordered if relations.get(row["id"]) == "conflict"]
        evolutions = [row for row in ordered if relations.get(row["id"]) == "evolution"]
        related = [row for row in ordered if relations.get(row["id"]) == "related_only"]
        content = draft["content"]
        if evolutions:
            content = "【发展时间线】\n" + "\n".join(
                f"{row.get('occurred_at') or row.get('created_at') or '未标时间'}｜{row['content']}" for row in included
            )
            content += "\n\n【当前状态】\n" + evolutions[-1]["content"]
        if conflicts:
            content += "\n\n【未决冲突】\n" + "\n".join(
                f"{row.get('occurred_at') or row.get('created_at') or '未标时间'}｜{row['content']}" for row in conflicts
            )
        return {
            **draft,
            "content": content,
            "title": ordered[-1]["title"],
            "candidate_ids": [row["id"] for row in ordered],
            "timeline": [{"candidate_id": row["id"], "occurred_at": row.get("occurred_at"), "title": row["title"]} for row in ordered],
            "relations": {row["id"]: relations.get(row["id"], "supplement") for row in ordered},
            "associations": [row["id"] for row in related],
            "persisted": False,
        }

    def admit(self, candidate_ids: list[str], title: str | None = None, content: str | None = None,
              relations: dict | None = None, memory_tier: str | None = None,
              expires_at: str | None = None) -> dict:
        ids = {str(value) for value in candidate_ids}
        if not ids:
            raise ValueError("candidate_ids is required")
        if memory_tier not in {None, "recent", "long_term"}:
            raise ValueError("memory_tier must be recent or long_term")
        if memory_tier == "recent" and not expires_at:
            raise ValueError("expires_at is required for recent memory")
        if memory_tier == "long_term" and expires_at:
            raise ValueError("long_term memory must not have expires_at")
        if expires_at:
            try:
                parsed_expiry = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
                if parsed_expiry.tzinfo is None:
                    parsed_expiry = parsed_expiry.replace(tzinfo=timezone.utc)
                if parsed_expiry <= datetime.now(timezone.utc):
                    raise ValueError("expires_at must be in the future")
            except ValueError as error:
                if str(error) == "expires_at must be in the future":
                    raise
                raise ValueError("expires_at must be an ISO timestamp") from error
        now = utc_now()
        with self.lock:
            data = self._read()
            selected = [row for row in data["candidates"] if row.get("id") in ids and row.get("state", "pending") == "pending"]
            if len(selected) != len(ids):
                raise ValueError("one or more candidates are missing or already decided")
            if memory_tier and any(str(row.get("kind") or "").casefold() in {"identity", "relationship", "boundary"}
                                   for row in selected):
                raise ValueError("identity, relationship, and boundary candidates require specialized routing")
            ordered = sorted(selected, key=lambda row: row.get("occurred_at") or row.get("created_at") or "")
            candidate_snapshots = deepcopy(ordered)
            draft = self.consolidation_preview([row["id"] for row in ordered], relations)
            memory = {
                "id": f"memory_{uuid.uuid4().hex[:12]}",
                "title": (str(title).strip() if title else ordered[-1]["title"])[:200],
                "content": (str(content).strip() if content else draft["content"])[:40000],
                "kind": ordered[-1].get("kind", "event"),
                "tags": sorted({tag for row in ordered for tag in row.get("tags", [])}),
                "importance": max(float(row.get("importance", 0.5)) for row in ordered),
                "state": "active",
                "occurred_at": ordered[0].get("occurred_at") or now,
                "created_at": now,
                "updated_at": now,
                "source_candidate_ids": [row["id"] for row in ordered if draft["relations"][row["id"]] != "related_only"],
                "associated_candidate_ids": draft["associations"],
                "timeline": [
                    {"candidate_id": row["id"], "occurred_at": row.get("occurred_at"), "title": row["title"]}
                    for row in ordered
                ],
                "consolidation": {"method": draft["method"], "removed": draft["removed"], "sentences": draft["sentences"], "relations": draft["relations"]},
                "versions": [],
            }
            if memory_tier:
                memory["memory_tier"] = memory_tier
                memory["tier_confirmed_at"] = now
                memory["tier_source"] = "human_or_agent_review"
            if expires_at:
                memory["expires_at"] = str(expires_at)
            data["memories"].append(memory)
            for row in data["candidates"]:
                if row.get("id") in ids:
                    row["state"] = "associated" if draft["relations"][row["id"]] == "related_only" else "admitted"
                    row["memory_id"] = memory["id"]
                    row["decided_at"] = now
            candidate_after = deepcopy([row for row in data["candidates"] if row.get("id") in ids])
            rollback_id = f"rollback_{uuid.uuid4().hex[:16]}"
            available_until = (datetime.now(timezone.utc) + timedelta(hours=48)).isoformat(timespec="seconds").replace("+00:00", "Z")
            data["rollbacks"].append({
                "id": rollback_id,
                "action": "candidate_admission",
                "created_at": now,
                "available_until": available_until,
                "memory_id": memory["id"],
                "memory_after": deepcopy(memory),
                "candidate_before": candidate_snapshots,
                "candidate_after": candidate_after,
                "event_offset_after": len(data["events"]) + 1,
            })
            data["events"].append({"id": uuid.uuid4().hex, "type": "candidates_admitted", "at": now, "target": memory["id"], "sources": memory["source_candidate_ids"]})
            self._save(data)
        return {**memory, "rollback": {"id": rollback_id, "available_until": available_until, "ttl_hours": 48}}

    def list_rollbacks(self) -> list[dict]:
        now = datetime.now(timezone.utc)
        rows = []
        for row in self.snapshot()["rollbacks"]:
            try:
                available_until = datetime.fromisoformat(str(row.get("available_until", "")).replace("Z", "+00:00"))
            except ValueError:
                continue
            if row.get("action") == "candidate_admission" and available_until > now:
                rows.append({
                    "id": row["id"],
                    "action": row["action"],
                    "created_at": row["created_at"],
                    "available_until": row["available_until"],
                    "memory_id": row["memory_id"],
                    "candidate_ids": [item["id"] for item in row.get("candidate_before", [])],
                })
        return sorted(rows, key=lambda row: row["created_at"], reverse=True)

    def rollback_candidate_admission(self, rollback_id: str) -> dict:
        now = utc_now()
        current_time = datetime.now(timezone.utc)
        with self.lock:
            data = self._read()
            receipt = next((row for row in data["rollbacks"] if row.get("id") == rollback_id), None)
            if receipt is None or receipt.get("action") != "candidate_admission":
                raise KeyError(rollback_id)
            try:
                available_until = datetime.fromisoformat(str(receipt["available_until"]).replace("Z", "+00:00"))
            except (KeyError, ValueError) as error:
                raise ValueError("invalid rollback receipt") from error
            if available_until <= current_time:
                raise ValueError("rollback expired")
            memory = next((row for row in data["memories"] if row.get("id") == receipt.get("memory_id")), None)
            if memory is None or memory != receipt.get("memory_after"):
                raise ValueError("rollback blocked by a newer memory change")
            candidate_ids = {row["id"] for row in receipt.get("candidate_after", [])}
            later_events = data["events"][int(receipt.get("event_offset_after", len(data["events"]))):]
            if any(event.get("target") == receipt.get("memory_id") or event.get("target") in candidate_ids for event in later_events):
                raise ValueError("rollback blocked by a newer related change")
            after_by_id = {row["id"]: row for row in receipt.get("candidate_after", [])}
            current_by_id = {row.get("id"): row for row in data["candidates"]}
            if not after_by_id or any(current_by_id.get(candidate_id) != snapshot for candidate_id, snapshot in after_by_id.items()):
                raise ValueError("rollback blocked by a newer candidate change")
            before_by_id = {row["id"]: row for row in receipt.get("candidate_before", [])}
            data["memories"] = [row for row in data["memories"] if row.get("id") != receipt["memory_id"]]
            data["candidates"] = [deepcopy(before_by_id.get(row.get("id"), row)) for row in data["candidates"]]
            data["rollbacks"] = [row for row in data["rollbacks"] if row.get("id") != rollback_id]
            restored_ids = sorted(before_by_id)
            data["events"].append({
                "id": uuid.uuid4().hex,
                "type": "candidate_admission_rolled_back",
                "at": now,
                "target": receipt["memory_id"],
                "sources": restored_ids,
                "rollback_id": rollback_id,
            })
            self._save(data)
        return {"ok": True, "rollback_id": rollback_id, "removed_memory_id": receipt["memory_id"], "restored_candidate_ids": restored_ids}

    def revise_memory(self, memory_id: str, *, title: str, content: str, reason: str) -> dict:
        title, content, reason = str(title).strip(), str(content).strip(), str(reason).strip()
        if not title or not content or not reason:
            raise ValueError("title, content and reason are required")
        now = utc_now()
        with self.lock:
            data = self._read()
            row = next((item for item in data["memories"] if item.get("id") == memory_id), None)
            if row is None:
                raise KeyError(memory_id)
            versions = list(row.get("versions") or [])
            versions.append({"title": row.get("title"), "content": row.get("content"), "updated_at": row.get("updated_at"), "reason": reason})
            row.update({"title": title[:200], "content": content[:40000], "updated_at": now, "versions": versions[-50:]})
            data["events"].append({"id": uuid.uuid4().hex, "type": "memory_revised", "at": now, "target": memory_id, "reason": reason})
            self._save(data)
            return deepcopy(row)

    def replace_memory(self, old_id: str, new_id: str, reason: str) -> dict:
        reason = str(reason).strip()
        if not reason or old_id == new_id:
            raise ValueError("a different replacement and reason are required")
        now = utc_now()
        with self.lock:
            data = self._read()
            old = next((item for item in data["memories"] if item.get("id") == old_id), None)
            new = next((item for item in data["memories"] if item.get("id") == new_id), None)
            if old is None or new is None:
                raise KeyError(old_id if old is None else new_id)
            if old.get("state", "active") != "active" or new.get("state", "active") != "active":
                raise ValueError("both memories must be active")
            old.update({"state": "superseded", "superseded_by": new_id, "superseded_at": now, "updated_at": now})
            data["events"].append({"id": uuid.uuid4().hex, "type": "memory_replaced", "at": now, "target": old_id, "replacement": new_id, "reason": reason})
            self._save(data)
            return {"old": deepcopy(old), "replacement": deepcopy(new)}

    def decide_candidate(self, candidate_id: str, action: str) -> dict:
        if action not in {"ignore", "restore"}:
            raise ValueError("action must be ignore or restore")
        now = utc_now()
        with self.lock:
            data = self._read()
            row = next((item for item in data["candidates"] if item.get("id") == candidate_id), None)
            if row is None:
                raise KeyError(candidate_id)
            if action == "restore" and row.get("state") == "admitted":
                raise ValueError("admitted candidates cannot be restored to pending")
            row["state"] = "ignored" if action == "ignore" else "pending"
            row["decided_at"] = now if action == "ignore" else None
            data["events"].append({"id": uuid.uuid4().hex, "type": f"candidate_{action}d", "at": now, "target": candidate_id})
            self._save(data)
            return deepcopy(row)

    def route_candidate(self, candidate_id: str, destination: str, value: dict | None = None) -> dict:
        if destination not in {"self_core", "user_profile", "relation"}:
            raise ValueError("destination must be self_core, user_profile, or relation")
        value = value or {}
        now = utc_now()
        with self.lock:
            data = self._read()
            if not data["settings"].get("identity_relation_routing", False):
                raise ValueError("identity and relation routing is disabled")
            candidate = next((item for item in data["candidates"] if item.get("id") == candidate_id), None)
            if candidate is None:
                raise KeyError(candidate_id)
            if candidate.get("state", "pending") != "pending":
                raise ValueError("candidate is no longer pending")
            if destination == "self_core":
                text = str(value.get("text") or candidate.get("content") or "").strip()
                reason = str(value.get("reason") or "").strip()
                if not text or not reason:
                    raise ValueError("self_core text and reason are required")
                if len(text) > 800:
                    raise ValueError("self-core text must contain at most 800 characters")
                source_ids = [candidate_id]
                source_ids.extend(str(item).strip()[:160] for item in list(value.get("source_ids") or []) if str(item).strip())
                source_ids = list(dict.fromkeys(source_ids))[:20]
                target = str(value.get("id") or f"core_{uuid.uuid4().hex[:12]}")
                if any(row.get("id") == target for row in data["self_core_records"]):
                    raise ValueError("self_core id already exists")
                data["self_core_records"].append({
                    "id": target, "text": text, "source_ids": source_ids, "reason": reason[:500],
                    "state": "active", "position": int(value.get("position", len(data["self_core_records"]))),
                    "created_at": now, "updated_at": now, "versions": [],
                })
            elif destination == "user_profile":
                text = str(value.get("text") or candidate.get("content") or "").strip()
                reason = str(value.get("reason") or "").strip()
                category = str(value.get("category") or "preference").strip()
                if category not in {"preference", "boundary", "communication", "context"}:
                    raise ValueError("invalid user profile category")
                if not text or not reason:
                    raise ValueError("user profile text and reason are required")
                source_ids = list(dict.fromkeys([candidate_id] + [str(item).strip()[:160] for item in list(value.get("source_ids") or []) if str(item).strip()]))[:20]
                target = str(value.get("id") or f"user_{uuid.uuid4().hex[:12]}")
                if any(row.get("id") == target for row in data["user_profile_records"]):
                    raise ValueError("user profile id already exists")
                data["user_profile_records"].append({
                    "id": target, "subject": str(value.get("subject") or "user").strip()[:120],
                    "category": category, "text": text[:1000], "source_ids": source_ids,
                    "reason": reason[:500], "state": "active", "created_at": now, "updated_at": now,
                    "versions": [],
                })
            else:
                name = str(value.get("name") or candidate.get("title") or "").strip()[:120]
                relation = str(value.get("relation") or "").strip()[:120]
                if not name or not relation:
                    raise ValueError("relation name and relation are required")
                relation_id = str(value.get("id") or f"relation_{uuid.uuid4().hex[:12]}")
                if any(row.get("id") == relation_id for row in data["relations"]):
                    raise ValueError("relation id already exists")
                facts = [str(item).strip()[:500] for item in list(value.get("facts") or [])[:20] if str(item).strip()]
                source_ids = [candidate_id]
                source_ids.extend(str(item).strip()[:160] for item in list(value.get("source_ids") or []) if str(item).strip())
                source_ids = list(dict.fromkeys(source_ids))[:20]
                visibility = str(value.get("visibility") or "private")
                if visibility not in {"private", "shared", "public"}:
                    raise ValueError("visibility must be private, shared, or public")
                row = {"id": relation_id, "name": name, "relation": relation, "facts": facts,
                       "private_note": str(value.get("private_note", value.get("note", candidate.get("content") or ""))).strip()[:2000],
                       "source_ids": source_ids, "visibility": visibility, "state": "active",
                       "created_at": now, "updated_at": now, "versions": []}
                data["relations"].append(row)
                target = relation_id
            candidate.update({"state": "routed", "routed_to": destination, "routed_target": target,
                              "decided_at": now, "updated_at": now})
            data["events"].append({"id": uuid.uuid4().hex, "type": "candidate_routed", "at": now,
                                   "target": candidate_id, "destination": destination, "routed_target": target})
            self._save(data)
            return {"candidate": deepcopy(candidate), "destination": destination, "target": target}

    def shred_eligible_candidates(self) -> dict:
        now_dt = datetime.now(timezone.utc)
        now = utc_now()
        with self.lock:
            data = self._read()
            settings = data["settings"]
            if not settings.get("candidate_retention_enabled", False):
                return {"enabled": False, "shredded": 0, "candidate_ids": []}
            cutoff = now_dt - timedelta(hours=int(settings.get("candidate_retention_hours", 168)))
            shredded = []
            for row in data["candidates"]:
                if row.get("state") not in {"admitted", "associated", "ignored", "routed"}:
                    continue
                try:
                    decided = datetime.fromisoformat(str(row.get("decided_at", "")).replace("Z", "+00:00"))
                except ValueError:
                    continue
                if decided > cutoff:
                    continue
                original_state = row.get("state")
                keep = {key: row[key] for key in ("id", "memory_id", "routed_to", "routed_target", "decided_at") if key in row}
                row.clear()
                row.update(keep, state="shredded", original_state=original_state, shredded_at=now)
                shredded.append(row["id"])
            if shredded:
                data["events"].append({"id": uuid.uuid4().hex, "type": "candidate_content_shredded", "at": now,
                                       "target": "candidates", "candidate_ids": shredded})
                self._save(data)
            return {"enabled": True, "shredded": len(shredded), "candidate_ids": shredded}

    @property
    def snapshots_path(self) -> Path:
        return self.path.parent / "snapshots"

    def create_snapshot(self, label: str = "manual") -> dict:
        snapshot_id = f"snapshot-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
        payload = self.snapshot()
        payload["snapshot_meta"] = {"id": snapshot_id, "label": str(label).strip()[:120] or "manual", "created_at": utc_now()}
        target = self.snapshots_path / f"{snapshot_id}.json"
        _atomic_write(target, payload)
        return deepcopy(payload["snapshot_meta"])

    def list_snapshots(self) -> list[dict]:
        rows = []
        for path in self.snapshots_path.glob("*.json") if self.snapshots_path.exists() else []:
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                meta = payload.get("snapshot_meta") or {}
                rows.append({"id": meta.get("id") or path.stem, "label": meta.get("label") or path.stem,
                             "created_at": meta.get("created_at") or datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
                             "memories": len(payload.get("memories") or []), "candidates": len(payload.get("candidates") or [])})
            except (OSError, ValueError, TypeError):
                continue
        return sorted(rows, key=lambda row: row["created_at"], reverse=True)

    def restore_snapshot(self, snapshot_id: str) -> dict:
        if not re.fullmatch(r"[A-Za-z0-9._-]+", snapshot_id):
            raise ValueError("invalid snapshot id")
        target = self.snapshots_path / f"{snapshot_id}.json"
        if not target.is_file():
            raise KeyError(snapshot_id)
        payload = json.loads(target.read_text(encoding="utf-8"))
        return self.replace_all(payload)

    def set_importance(self, memory_id: str, importance: float) -> dict:
        value = float(importance)
        if not 0 <= value <= 1:
            raise ValueError("importance must be between 0 and 1")
        now = utc_now()
        with self.lock:
            data = self._read()
            row = next((item for item in data["memories"] if item.get("id") == memory_id), None)
            if row is None:
                raise KeyError(memory_id)
            previous = float(row.get("importance", 0.5))
            row["importance"] = value
            row["updated_at"] = now
            data["events"].append({"id": uuid.uuid4().hex, "type": "importance_changed", "at": now, "target": memory_id, "before": previous, "after": value})
            self._save(data)
            return deepcopy(row)

    def set_archive(self, memory_id: str, archived: bool) -> dict:
        now = utc_now()
        with self.lock:
            data = self._read()
            row = next((item for item in data["memories"] if item.get("id") == memory_id), None)
            if row is None:
                raise KeyError(memory_id)
            row["state"] = "archived" if archived else "active"
            row["updated_at"] = now
            data["events"].append({"id": uuid.uuid4().hex, "type": "memory_archived" if archived else "memory_restored", "at": now, "target": memory_id})
            self._save(data)
            return deepcopy(row)

    def replace_all(self, payload: dict) -> dict:
        if int(payload.get("schema", 0)) != self.SCHEMA:
            raise ValueError("unsupported import schema")
        clean = self._empty()
        for key in ("memories", "candidates", "events", "self_core_records", "user_profile_records",
                    "relations", "rollbacks"):
            value = payload.get(key)
            if value is None and key in {"self_core_records", "user_profile_records", "relations", "rollbacks"}:
                value = []
            if not isinstance(value, list):
                raise ValueError(f"{key} must be a list")
            clean[key] = deepcopy(value)
        profile = payload.get("profile") or {"display_name": "", "summary": "", "self_core": []}
        if not isinstance(profile, dict):
            raise ValueError("profile must be an object")
        clean["profile"] = deepcopy(profile)
        continuity_settings = payload.get("continuity_settings") or clean["continuity_settings"]
        if not isinstance(continuity_settings, dict):
            raise ValueError("continuity_settings must be an object")
        clean["continuity_settings"] = deepcopy(continuity_settings)
        settings = payload.get("settings") or {"review_mode": "autonomous"}
        if (not isinstance(settings, dict)
                or settings.get("review_mode", "autonomous") not in {"autonomous", "joint"}
                or int(settings.get("candidate_retention_hours", 168)) not in {24, 72, 168, 720}):
            raise ValueError("invalid settings")
        clean["settings"] = {
            "review_mode": settings.get("review_mode", "autonomous"),
            "candidate_retention_enabled": bool(settings.get("candidate_retention_enabled", False)),
            "candidate_retention_hours": int(settings.get("candidate_retention_hours", 168)),
            "identity_relation_routing": bool(settings.get("identity_relation_routing", False)),
            **({"updated_at": settings["updated_at"]} if settings.get("updated_at") else {}),
        }
        with self.lock:
            if self.path.exists():
                backup = self.path.parent / "snapshots" / f"before-import-{utc_now().replace(':', '').replace('-', '')}-{uuid.uuid4().hex[:8]}.json"
                _atomic_write(backup, self._read())
            self._save(clean)
        return self.overview()
