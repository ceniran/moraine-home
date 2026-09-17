from __future__ import annotations

import json
import os
import re
import threading
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

from .consolidate import consolidate


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
            "profile": {"display_name": "", "summary": "", "self_core": []},
            "relations": [],
            "settings": {"review_mode": "autonomous"},
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
        payload.setdefault("profile", {"display_name": "", "summary": "", "self_core": []})
        payload.setdefault("relations", [])
        payload.setdefault("settings", {"review_mode": "autonomous"})
        if not isinstance(payload["profile"], dict) or not isinstance(payload["relations"], list) or not isinstance(payload["settings"], dict):
            raise ValueError("profile and settings must be objects; relations must be a list")
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
        return deepcopy(self.snapshot()["settings"])

    def update_settings(self, value: dict) -> dict:
        mode = str(value.get("review_mode") or "")
        if mode not in {"autonomous", "joint"}:
            raise ValueError("review_mode must be autonomous or joint")
        now = utc_now()
        with self.lock:
            data = self._read()
            data["settings"] = {**data.get("settings", {}), "review_mode": mode, "updated_at": now}
            data["events"].append({"id": uuid.uuid4().hex, "type": "settings_updated", "at": now, "target": "settings"})
            self._save(data)
            return deepcopy(data["settings"])

    def update_profile(self, value: dict) -> dict:
        display_name = str(value.get("display_name", "")).strip()[:120]
        summary = str(value.get("summary", "")).strip()[:2000]
        self_core = [str(item).strip()[:500] for item in list(value.get("self_core") or []) if str(item).strip()][:20]
        now = utc_now()
        with self.lock:
            data = self._read()
            data["profile"] = {"display_name": display_name, "summary": summary, "self_core": self_core, "updated_at": now}
            data["events"].append({"id": uuid.uuid4().hex, "type": "profile_updated", "at": now, "target": "profile"})
            self._save(data)
            return deepcopy(data["profile"])

    def list_relations(self) -> list[dict]:
        return sorted(deepcopy(self.snapshot()["relations"]), key=lambda row: row.get("updated_at", ""), reverse=True)

    def upsert_relation(self, value: dict) -> dict:
        name = str(value.get("name", "")).strip()
        relation = str(value.get("relation", "")).strip()
        if not name or not relation:
            raise ValueError("name and relation are required")
        relation_id = str(value.get("id") or f"relation_{uuid.uuid4().hex[:12]}")
        now = utc_now()
        row = {"id": relation_id, "name": name[:120], "relation": relation[:120], "note": str(value.get("note", "")).strip()[:2000], "updated_at": now}
        with self.lock:
            data = self._read()
            existing = next((index for index, item in enumerate(data["relations"]) if item.get("id") == relation_id), None)
            if existing is None:
                data["relations"].append(row)
                action = "relation_added"
            else:
                data["relations"][existing] = row
                action = "relation_updated"
            data["events"].append({"id": uuid.uuid4().hex, "type": action, "at": now, "target": relation_id})
            self._save(data)
        return row

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

    def admit(self, candidate_ids: list[str], title: str | None = None, content: str | None = None, relations: dict | None = None) -> dict:
        ids = {str(value) for value in candidate_ids}
        if not ids:
            raise ValueError("candidate_ids is required")
        now = utc_now()
        with self.lock:
            data = self._read()
            selected = [row for row in data["candidates"] if row.get("id") in ids and row.get("state", "pending") == "pending"]
            if len(selected) != len(ids):
                raise ValueError("one or more candidates are missing or already decided")
            ordered = sorted(selected, key=lambda row: row.get("occurred_at") or row.get("created_at") or "")
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
            data["memories"].append(memory)
            for row in data["candidates"]:
                if row.get("id") in ids:
                    row["state"] = "associated" if draft["relations"][row["id"]] == "related_only" else "admitted"
                    row["memory_id"] = memory["id"]
                    row["decided_at"] = now
            data["events"].append({"id": uuid.uuid4().hex, "type": "candidates_admitted", "at": now, "target": memory["id"], "sources": memory["source_candidate_ids"]})
            self._save(data)
        return memory

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
        for key in ("memories", "candidates", "events", "relations"):
            value = payload.get(key)
            if value is None and key == "relations":
                value = []
            if not isinstance(value, list):
                raise ValueError(f"{key} must be a list")
            clean[key] = deepcopy(value)
        profile = payload.get("profile") or {"display_name": "", "summary": "", "self_core": []}
        if not isinstance(profile, dict):
            raise ValueError("profile must be an object")
        clean["profile"] = deepcopy(profile)
        settings = payload.get("settings") or {"review_mode": "autonomous"}
        if not isinstance(settings, dict) or settings.get("review_mode", "autonomous") not in {"autonomous", "joint"}:
            raise ValueError("invalid settings")
        clean["settings"] = deepcopy(settings)
        with self.lock:
            if self.path.exists():
                backup = self.path.parent / "snapshots" / f"before-import-{utc_now().replace(':', '').replace('-', '')}.json"
                _atomic_write(backup, self._read())
            self._save(clean)
        return self.overview()
