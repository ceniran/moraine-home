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
            "relations": [],
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
        payload.setdefault("relations", [])
        payload.setdefault("settings", {"review_mode": "autonomous"})
        if (not isinstance(payload["profile"], dict) or not isinstance(payload["relations"], list)
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
        if destination not in {"self_core", "relation"}:
            raise ValueError("destination must be self_core or relation")
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
                text = str(value.get("text") or candidate.get("content") or "").strip()[:500]
                if not text:
                    raise ValueError("self_core text is required")
                lines = list(data["profile"].get("self_core") or [])
                if text not in lines:
                    if len(lines) >= 20:
                        raise ValueError("self_core already has 20 entries")
                    lines.append(text)
                data["profile"]["self_core"] = lines
                data["profile"]["updated_at"] = now
                target = "profile:self_core"
            else:
                name = str(value.get("name") or candidate.get("title") or "").strip()[:120]
                relation = str(value.get("relation") or "").strip()[:120]
                if not name or not relation:
                    raise ValueError("relation name and relation are required")
                relation_id = str(value.get("id") or f"relation_{uuid.uuid4().hex[:12]}")
                row = {"id": relation_id, "name": name, "relation": relation,
                       "note": str(value.get("note") or candidate.get("content") or "").strip()[:2000], "updated_at": now}
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
        for key in ("memories", "candidates", "events", "relations", "rollbacks"):
            value = payload.get(key)
            if value is None and key in {"relations", "rollbacks"}:
                value = []
            if not isinstance(value, list):
                raise ValueError(f"{key} must be a list")
            clean[key] = deepcopy(value)
        profile = payload.get("profile") or {"display_name": "", "summary": "", "self_core": []}
        if not isinstance(profile, dict):
            raise ValueError("profile must be an object")
        clean["profile"] = deepcopy(profile)
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
