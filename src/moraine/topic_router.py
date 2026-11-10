from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import unicodedata
from bisect import bisect_left, bisect_right
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable


ROUTER_VERSION = "literal-v1"
EVIDENCE_RANK = {"supporting": 1, "alias": 2, "exact": 3}
_ASCII_WORD = re.compile(r"^[A-Za-z0-9_ -]+$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def _normalize(value: object) -> str:
    return unicodedata.normalize("NFKC", str(value or "")).casefold()


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _atomic_private_write(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
    os.chmod(path, 0o600)


def _validate_terms(value: object, field: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    result = []
    for raw in value:
        term = str(raw).strip()
        if term and term not in result:
            result.append(term)
    return result


class TopicRegistry:
    """Private, file-backed topic definitions kept outside the memory store."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._cache_key = ""
        self._cache: tuple[list[dict], str] = ([], "")

    def load(self) -> tuple[list[dict], str]:
        if not self.path.exists():
            return [], _digest("[]")
        os.chmod(self.path, 0o600)
        raw = self.path.read_bytes()
        key = _digest(raw.decode("utf-8"))
        if key == self._cache_key:
            return self._cache
        value = json.loads(raw)
        rows = value.get("topics") if isinstance(value, dict) else value
        if not isinstance(rows, list):
            raise ValueError("topic registry must contain a topics list")
        topics = []
        seen = set()
        for raw_topic in rows:
            if not isinstance(raw_topic, dict):
                raise ValueError("each topic must be an object")
            topic_id = str(raw_topic.get("topic_id") or "").strip()
            name = str(raw_topic.get("name") or "").strip()
            if not topic_id or not name or topic_id in seen:
                raise ValueError("topic_id and name are required and topic_id must be unique")
            seen.add(topic_id)
            topics.append({
                "topic_id": topic_id,
                "name": name,
                "exact_terms": _validate_terms(raw_topic.get("exact_terms"), "exact_terms"),
                "aliases": _validate_terms(raw_topic.get("aliases"), "aliases"),
                "supporting_terms": _validate_terms(raw_topic.get("supporting_terms"), "supporting_terms"),
                "veto_terms": _validate_terms(raw_topic.get("veto_terms"), "veto_terms"),
                "version": str(raw_topic.get("version") or "1"),
            })
        snapshot = _digest(json.dumps(topics, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        self._cache_key = key
        self._cache = topics, snapshot
        return self._cache


def _term_spans(text: str, term: str) -> list[tuple[int, int]]:
    normalized_term = _normalize(term)
    if not normalized_term:
        return []
    boundary = _ASCII_WORD.fullmatch(normalized_term) is not None
    pattern = re.escape(normalized_term)
    if boundary:
        pattern = rf"(?<![a-z0-9_]){pattern}(?![a-z0-9_])"
    return [(match.start(), match.end()) for match in re.finditer(pattern, text)]


def _raw_span(raw_text: str, start: int, end: int, prefix_cache: dict[int, int]) -> tuple[int, int]:
    """Translate one normalized span without building an O(n²) prefix table."""
    indices = range(len(raw_text) + 1)

    def normalized_prefix_length(index: int) -> int:
        if index not in prefix_cache:
            prefix_cache[index] = len(_normalize(raw_text[:index]))
        return prefix_cache[index]

    raw_start = max(0, bisect_right(indices, start, key=normalized_prefix_length) - 1)
    raw_end = min(len(raw_text), bisect_left(indices, end, key=normalized_prefix_length))
    return raw_start, max(raw_start, raw_end)


def _matches_for_topic(text: str, raw_text: str, topic: dict, prefix_cache: dict[int, int]) -> dict:
    by_class: dict[str, list[dict]] = {}
    for evidence, field in (("exact", "exact_terms"), ("alias", "aliases"),
                            ("supporting", "supporting_terms"), ("veto", "veto_terms")):
        matches = []
        for term in topic[field]:
            for start, end in _term_spans(text, term):
                matches.append({"term": term, "start": start, "end": end, "evidence": evidence})
        # Longest-match suppression is deliberately topic-local. Other topics
        # scan independently, so overlapping vocabularies cannot steal evidence.
        matches.sort(key=lambda row: (row["start"], -(row["end"] - row["start"]), row["term"]))
        kept = []
        for match in matches:
            if any(match["start"] >= old["start"] and match["end"] <= old["end"] for old in kept):
                continue
            kept.append(match)
        by_class[evidence] = [
            {**match, "start": raw_start, "end": raw_end}
            for match in kept
            for raw_start, raw_end in [_raw_span(raw_text, match["start"], match["end"], prefix_cache)]
        ]
    return by_class


def route_topics(text: str, topics: Iterable[dict], config_snapshot_id: str, *,
                 inherited_topics: Iterable[dict] | None = None, evaluated_at: str | None = None) -> dict:
    raw_text = str(text or "")
    normalized = _normalize(raw_text)
    prefix_cache: dict[int, int] = {0: 0, len(raw_text): len(normalized)}
    inherited_by_id = {str(row.get("topic_id")): dict(row) for row in (inherited_topics or [])}
    rows = []
    for topic in topics:
        matches = _matches_for_topic(normalized, raw_text, topic, prefix_cache)
        vetoed = bool(matches["veto"])
        evidence = next((name for name in ("exact", "alias", "supporting") if matches[name]), None)
        inherited = inherited_by_id.get(topic["topic_id"])
        inheritance_available = bool(inherited and inherited.get("evidence_level") == "exact")
        inheritance_applied = bool(inheritance_available and evidence == "supporting" and not vetoed)
        if vetoed:
            evidence = None
            inheritance_applied = False
        if evidence is None and not vetoed:
            continue
        spans = matches["exact"] + matches["alias"] + matches["supporting"] + matches["veto"]
        reasons = []
        if vetoed:
            reasons.append("当前文本命中了该主题的排除词")
        elif evidence == "exact":
            reasons.append(f"正文中出现了主题名或精确词「{matches['exact'][0]['term']}」")
        elif evidence == "alias":
            reasons.append(f"正文中出现了稳定别名「{matches['alias'][0]['term']}」")
        else:
            reasons.append("正文只出现了辅助词，需要结合其他证据判断")
        rows.append({
            "topic_id": topic["topic_id"],
            "name": topic["name"],
            "evidence_level": evidence,
            "selection_role": "candidate",
            "matched_spans": spans,
            "supporting_count": len(matches["supporting"]),
            "vetoed": vetoed,
            "inherited": {
                "available": inheritance_available,
                "applied": inheritance_applied,
                "turns_ago": inherited.get("turns_ago") if inherited else None,
                "contribution": "tie_break_only" if inheritance_applied else "none",
            },
            "reasons": reasons,
            "topic_definition_version": topic["version"],
        })
    active = [row for row in rows if not row["vetoed"] and row["evidence_level"]]
    if any(row["evidence_level"] == "exact" for row in active):
        for row in active:
            if row["evidence_level"] != "exact" and row["inherited"]["applied"]:
                row["inherited"]["applied"] = False
                row["inherited"]["contribution"] = "cleared_by_explicit_topic_change"
    best_rank = max((EVIDENCE_RANK[row["evidence_level"]] for row in active), default=0)
    best = [row for row in active if EVIDENCE_RANK[row["evidence_level"]] == best_rank]
    best.sort(key=lambda row: (-row["supporting_count"], row["topic_id"]))
    is_multi = best_rank == EVIDENCE_RANK["exact"] and len(best) > 1
    is_ambiguous = (best_rank == EVIDENCE_RANK["supporting"] or
                    (best_rank == EVIDENCE_RANK["alias"] and len(best) > 1))
    if best and not is_ambiguous:
        best[0]["selection_role"] = "primary"
        if is_multi:
            for row in best:
                row["selection_role"] = "primary"
    return {
        "topics": rows,
        "is_multi_topic": is_multi,
        "is_ambiguous": is_ambiguous,
        "primary_topic": best[0]["topic_id"] if best and not is_ambiguous else None,
        "router_version": ROUTER_VERSION,
        "config_snapshot_id": config_snapshot_id,
        "evaluated_at": evaluated_at or _iso(_now()),
        "input_digest": _digest(raw_text),
        "topic_match_is_not_event_identity": True,
        "persisted_to_memory_store": False,
    }


class TopicShadowLog:
    """Private evaluation log; never part of store snapshots or exports."""

    def __init__(self, path: str | Path, retention_days: int = 45):
        self.path = Path(path)
        self.retention_days = max(31, int(retention_days))
        self.lock = threading.RLock()

    def _read(self) -> list[dict]:
        if not self.path.exists():
            return []
        rows = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                rows.append(json.loads(line))
        return rows

    def _write(self, rows: list[dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
        os.chmod(temporary, 0o600)
        os.replace(temporary, self.path)
        os.chmod(self.path, 0o600)

    def append(self, candidate_id: str, result: dict) -> dict:
        with self.lock:
            now = _now()
            cutoff = now - timedelta(days=self.retention_days)
            rows = [row for row in self._read() if datetime.fromisoformat(str(row["evaluated_at"]).replace("Z", "+00:00")) >= cutoff]
            assignment = "visible" if int(_digest(candidate_id)[:8], 16) % 2 == 0 else "hidden"
            previous = next((row for row in reversed(rows) if row.get("candidate_id") == candidate_id), None)
            entry = {
                "candidate_id": candidate_id,
                "evaluated_at": result["evaluated_at"],
                "input_digest": result["input_digest"],
                "config_snapshot_id": result["config_snapshot_id"],
                "assignment": assignment,
                "router_output": result,
                "final_topic_ids": None,
            }
            if previous is not None:
                entry["previous_evaluation_at"] = previous.get("evaluated_at")
                entry["previous_choice_preserved"] = previous.get("final_topic_ids") is not None
            rows.append(entry)
            self._write(rows)
            return entry

    def get(self, candidate_id: str) -> dict | None:
        with self.lock:
            return next((row for row in reversed(self._read()) if row.get("candidate_id") == candidate_id), None)

    def latest(self) -> dict[str, dict]:
        """Return the latest private shadow entry for each candidate."""
        with self.lock:
            result: dict[str, dict] = {}
            for row in self._read():
                candidate_id = str(row.get("candidate_id") or "")
                if candidate_id:
                    result[candidate_id] = row
            return result

    def record_choice(self, candidate_id: str, topic_ids: list[str]) -> dict:
        with self.lock:
            rows = self._read()
            entry = next((row for row in reversed(rows) if row.get("candidate_id") == candidate_id), None)
            if entry is None:
                raise KeyError(candidate_id)
            entry["final_topic_ids"] = list(dict.fromkeys(str(value) for value in topic_ids if str(value).strip()))
            entry["decided_at"] = _iso(_now())
            self._write(rows)
            return entry


def workbench_shadow_view(entry: dict) -> dict:
    """Hide the suggestion from the control group until a choice exists."""
    value = dict(entry)
    visible = value.get("assignment") == "visible" or value.get("final_topic_ids") is not None
    value["suggestion_visible"] = visible
    if not visible:
        value.pop("router_output", None)
    return value
