from __future__ import annotations

from datetime import timedelta
from hashlib import sha256
from typing import Iterable, Mapping

from .temporal import parse_time

_PROTECTED_KINDS = frozenset({"identity", "relationship"})
_ALLOWED_DECISIONS = ["promote", "supplement", "relate", "supersede", "keep_episode"]


def _clean(value: object) -> str:
    return "" if value is None else str(value).strip()


def _source_key(row: Mapping[str, object]) -> tuple[str, str]:
    source = row.get("source") if isinstance(row.get("source"), Mapping) else {}
    return _clean(source.get("type")) or "unknown", _clean(source.get("ref"))


def _bucket_key(row: Mapping[str, object]) -> tuple[str, str, str, str]:
    source_type, source_ref = _source_key(row)
    memory_id = _clean(row.get("id"))
    workspace = _clean(row.get("workspace"))
    project_id = _clean(row.get("project_id"))
    # An incomplete scope cannot prove that two observations belong to the
    # same work unit. Keep each one isolated until a reviewer supplies scope.
    if not workspace or not project_id:
        return source_type, source_ref, f"\0incomplete:{memory_id}", ""
    return (
        source_type,
        source_ref,
        workspace,
        project_id,
    )


def _minutes(value: object, name: str) -> int:
    minutes = int(value)
    if not 1 <= minutes <= 24 * 60:
        raise ValueError(f"{name} must be between 1 and 1440")
    return minutes


def build_episode_candidates(
    rows: Iterable[Mapping[str, object]], *,
    inactivity_gap_minutes: int | None = None,
    max_episode_minutes: int | None = None,
    window_minutes: int | None = None,
) -> list[dict]:
    """Group same-source observations into review-only episode candidates.

    Time proximity only continues a session bucket. It never asserts that
    members are duplicates or that one should supersede another.
    """
    if window_minutes is not None:
        shared = _minutes(window_minutes, "window_minutes")
        inactivity_gap_minutes = shared if inactivity_gap_minutes is None else inactivity_gap_minutes
        max_episode_minutes = shared if max_episode_minutes is None else max_episode_minutes
    gap = _minutes(60 if inactivity_gap_minutes is None else inactivity_gap_minutes, "inactivity_gap_minutes")
    span_limit = _minutes(60 if max_episode_minutes is None else max_episode_minutes, "max_episode_minutes")
    prepared = []
    for raw in rows:
        row = dict(raw)
        memory_id = _clean(row.get("id"))
        if not memory_id:
            raise ValueError("every episode member must have an id")
        row["id"] = memory_id
        row["workspace"] = _clean(row.get("workspace")) or None
        row["project_id"] = _clean(row.get("project_id")) or None
        row["kind"] = _clean(row.get("kind"))
        source_type, source_ref = _source_key(row)
        if source_type == "unknown" or not source_ref:
            raise ValueError("every episode member must have a source type and reference")
        row["source"] = {"type": source_type, "ref": source_ref}
        observed = parse_time(row.get("observed_at") or row.get("created_at"))
        if observed is None:
            raise ValueError("every episode member must have observed_at or created_at")
        prepared.append((_bucket_key(row), observed, row))
    prepared.sort(key=lambda item: (item[0], item[1], str(item[2]["id"])))

    groups: list[list[tuple]] = []
    for item in prepared:
        if not groups:
            groups.append([item])
            continue
        current = groups[-1]
        previous = current[-1]
        start = current[0]
        same_key = previous[0] == item[0]
        within_gap = item[1] - previous[1] <= timedelta(minutes=gap)
        within_span = item[1] - start[1] <= timedelta(minutes=span_limit)
        if same_key and within_gap and within_span:
            current.append(item)
        else:
            groups.append([item])

    candidates = []
    for group in groups:
        key = group[0][0]
        ids = [str(item[2]["id"]) for item in group]
        kinds = {str(item[2].get("kind") or "") for item in group}
        workspace = _clean(group[0][2].get("workspace"))
        project_id = _clean(group[0][2].get("project_id"))
        scope_incomplete = not workspace or not project_id
        protected = bool(kinds & _PROTECTED_KINDS)
        seed = "|".join((*key, *ids))
        candidates.append({
            "episode_id": f"episode_{sha256(seed.encode()).hexdigest()[:16]}",
            "status": "pending_review",
            "source": {"type": key[0], "ref": key[1]},
            "workspace": workspace or "default",
            "project_id": project_id or None,
            "inactivity_gap_minutes": gap,
            "max_episode_minutes": span_limit,
            "window_minutes": gap if gap == span_limit else None,
            "started_at": group[0][1].isoformat().replace("+00:00", "Z"),
            "ended_at": group[-1][1].isoformat().replace("+00:00", "Z"),
            "member_ids": ids,
            "member_count": len(ids),
            "allowed_decisions": list(_ALLOWED_DECISIONS),
            "relationship_undetermined": True,
            "scope_incomplete": scope_incomplete,
            "requires_protected_review": protected,
            "requires_review": scope_incomplete or protected,
            "persisted": False,
        })
    return candidates
