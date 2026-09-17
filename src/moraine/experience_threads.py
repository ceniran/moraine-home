from __future__ import annotations

import math
from typing import Iterable, Mapping

from .temporal import parse_time


def _text(value: object) -> str:
    return "" if value is None else str(value).strip()


def _source(row: Mapping[str, object]) -> dict[str, str]:
    raw = row.get("source") if isinstance(row.get("source"), Mapping) else {}
    source_type = _text(raw.get("type"))
    source_ref = _text(raw.get("ref"))
    if not source_type or not source_ref:
        raise ValueError("every thread member must have a source type and reference")
    return {"type": source_type, "ref": source_ref}


def build_experience_thread_candidate(
    records: Iterable[Mapping[str, object]],
    *,
    thread_id: str,
    title: str,
    workspace: str,
    summary_draft: Mapping[str, object] | None = None,
) -> dict:
    """Build one reviewer-selected cross-memory thread without persistence.

    Membership is supplied explicitly.  This function orders source-linked
    memories and validates an optional line-end summary draft; it never infers
    membership, approves a summary, or mutates an authoritative record.
    """
    thread_id = _text(thread_id)
    title = _text(title)
    workspace = _text(workspace)
    if not thread_id or not title or not workspace:
        raise ValueError("thread_id, title and workspace are required")

    points: list[tuple] = []
    seen_ids: set[str] = set()
    for raw in records:
        row = dict(raw)
        memory_id = _text(row.get("id"))
        if not memory_id:
            raise ValueError("every thread member must have an id")
        if memory_id in seen_ids:
            raise ValueError("thread member ids must be unique")
        seen_ids.add(memory_id)

        member_workspace = _text(row.get("workspace"))
        if member_workspace != workspace:
            raise ValueError("every thread member must belong to the requested workspace")
        observed = parse_time(row.get("observed_at") or row.get("created_at"))
        if observed is None:
            raise ValueError("every thread member must have observed_at or created_at")
        points.append((observed, memory_id, _source(row)))

    if not points:
        raise ValueError("an experience thread requires at least one member")
    points.sort(key=lambda item: (item[0], item[1]))
    ordered_ids = [item[1] for item in points]

    summary = None
    if summary_draft is not None:
        text = _text(summary_draft.get("text"))
        revision = summary_draft.get("revision")
        raw_source_ids = summary_draft.get("source_ids")
        if not isinstance(raw_source_ids, (list, tuple)):
            raise ValueError("summary draft source_ids must be a list")
        source_ids = [_text(value) for value in raw_source_ids]
        if not text:
            raise ValueError("summary draft text is required")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
            raise ValueError("summary draft revision must be a positive integer")
        if not source_ids or any(not value for value in source_ids):
            raise ValueError("summary draft must cite at least one source id")
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("summary draft source ids must be unique")
        if not set(source_ids).issubset(seen_ids):
            raise ValueError("summary draft may cite only thread members")

        previous_revision = summary_draft.get("previous_revision")
        if revision == 1 and previous_revision not in (None, ""):
            raise ValueError("the first summary revision cannot supersede another revision")
        if revision > 1 and previous_revision != revision - 1:
            raise ValueError("summary draft must point to the immediately previous revision")
        raw_unresolved = summary_draft.get("unresolved", [])
        raw_revisit = summary_draft.get("revisit_when", [])
        if not isinstance(raw_unresolved, (list, tuple)) or not isinstance(raw_revisit, (list, tuple)):
            raise ValueError("summary draft unresolved and revisit_when must be lists")
        summary = {
            "revision": revision,
            "previous_revision": previous_revision or None,
            "status": "pending_review",
            "text": text,
            "source_ids": source_ids,
            "unresolved": [_text(value) for value in raw_unresolved if _text(value)],
            "revisit_when": [_text(value) for value in raw_revisit if _text(value)],
            "persisted": False,
        }

    return {
        "thread_id": thread_id,
        "title": title,
        "workspace": workspace,
        "status": "pending_review",
        "started_at": points[0][0].isoformat().replace("+00:00", "Z"),
        "ended_at": points[-1][0].isoformat().replace("+00:00", "Z"),
        "member_ids": ordered_ids,
        "member_count": len(ordered_ids),
        "points": [
            {
                "memory_id": memory_id,
                "observed_at": observed.isoformat().replace("+00:00", "Z"),
                "source": source,
            }
            for observed, memory_id, source in points
        ],
        "summary_draft": summary,
        "membership_inferred": False,
        "requires_review": True,
        "writes": [],
        "persisted": False,
    }


def _score(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number between 0 and 1")
    score = float(value)
    if not math.isfinite(score) or not 0.0 <= score <= 1.0:
        raise ValueError(f"{name} must be a finite number between 0 and 1")
    return score


def propose_experience_thread_members(
    records: Iterable[Mapping[str, object]],
    *,
    thread_id: str,
    title: str,
    workspace: str,
    anchor_ids: Iterable[str] | None = None,
    min_score: float = 0.0,
) -> dict:
    """Rank already-retrieved candidates into a review-only membership basket.

    The caller supplies the retrieved rows. This function never searches the
    store, never infers an experience from kind or tags, and never approves a
    thread. Cross-workspace rows are excluded with a stable reason; missing or
    foreign anchors fail the whole proposal.
    """
    thread_id = _text(thread_id)
    title = _text(title)
    workspace = _text(workspace)
    if not thread_id or not title or not workspace:
        raise ValueError("thread_id, title and workspace are required")
    threshold = _score(min_score, "min_score")

    rows = list(records)
    if not rows:
        raise ValueError("an experience thread proposal requires at least one candidate")

    prepared: list[dict] = []
    seen_ids: set[str] = set()
    by_id: dict[str, dict] = {}
    for raw in rows:
        memory_id = _text(raw.get("id"))
        if not memory_id:
            raise ValueError("every proposal candidate must have an id")
        if memory_id in seen_ids:
            raise ValueError("proposal candidate ids must be unique")
        seen_ids.add(memory_id)
        member_workspace = _text(raw.get("workspace"))
        if not member_workspace:
            raise ValueError("every proposal candidate must have a workspace")
        source = _source(raw)
        observed = parse_time(raw.get("observed_at") or raw.get("created_at"))
        if observed is None:
            raise ValueError("every proposal candidate must have observed_at or created_at")
        item = {
            "id": memory_id,
            "workspace": member_workspace,
            "observed": observed,
            "source": source,
            "similarity": _score(raw.get("similarity"), "similarity"),
        }
        prepared.append(item)
        by_id[memory_id] = item

    if isinstance(anchor_ids, (str, bytes)):
        raise ValueError("anchor_ids must be an iterable of ids, not text")
    requested_anchors = [_text(value) for value in (anchor_ids or [])]
    if any(not value for value in requested_anchors):
        raise ValueError("anchor ids must be non-empty")
    if len(requested_anchors) != len(set(requested_anchors)):
        raise ValueError("anchor ids must be unique")
    for anchor_id in requested_anchors:
        item = by_id.get(anchor_id)
        if item is None:
            raise ValueError("every anchor must exist in the candidate set")
        if item["workspace"] != workspace:
            raise ValueError("every anchor must belong to the requested workspace")

    proposed: list[dict] = []
    excluded: list[dict] = []
    for item in prepared:
        if item["workspace"] != workspace:
            excluded.append({"memory_id": item["id"], "reason": "workspace_mismatch"})
            continue
        if item["similarity"] < threshold:
            excluded.append({"memory_id": item["id"], "reason": "below_min_score"})
            continue
        proposed.append(item)

    if not proposed:
        raise ValueError("an experience thread proposal requires at least one member")
    proposed.sort(key=lambda item: (item["observed"], item["id"]))

    return {
        "thread_id": thread_id,
        "title": title,
        "workspace": workspace,
        "status": "pending_review",
        "proposed_member_ids": [item["id"] for item in proposed],
        "excluded": excluded,
        "points": [
            {
                "memory_id": item["id"],
                "observed_at": item["observed"].isoformat().replace("+00:00", "Z"),
                "source": item["source"],
                "similarity": item["similarity"],
            }
            for item in proposed
        ],
        "anchor_ids": list(requested_anchors),
        "membership_inferred": True,
        "requires_review": True,
        "writes": [],
        "persisted": False,
    }


def preview_experience_thread_review(
    retrieval_results: Iterable[Mapping[str, object]],
    records: Iterable[Mapping[str, object]],
    *,
    thread_id: str,
    title: str,
    workspace: str,
    anchor_ids: Iterable[str] | None = None,
    min_score: float = 0.0,
) -> dict:
    """Join retrieval scores to source metadata for a read-only review view.

    Both inputs are caller-supplied. The adapter does not query an index or an
    authoritative store, and it intentionally drops memory content before
    passing candidates to the proposal contract.
    """
    metadata: dict[str, Mapping[str, object]] = {}
    for raw in records:
        memory_id = _text(raw.get("id"))
        if not memory_id:
            raise ValueError("every review record must have an id")
        if memory_id in metadata:
            raise ValueError("review record ids must be unique")
        metadata[memory_id] = raw

    joined: list[dict] = []
    display: dict[str, dict[str, str]] = {}
    seen_result_ids: set[str] = set()
    for raw in retrieval_results:
        memory_id = _text(raw.get("id"))
        if not memory_id:
            raise ValueError("every retrieval result must have an id")
        if memory_id in seen_result_ids:
            raise ValueError("retrieval result ids must be unique")
        seen_result_ids.add(memory_id)
        record = metadata.get(memory_id)
        if record is None:
            raise ValueError("every retrieval result must have supplied metadata")
        joined.append({
            "id": memory_id,
            "workspace": record.get("workspace"),
            "observed_at": record.get("observed_at"),
            "created_at": record.get("created_at"),
            "source": record.get("source"),
            "similarity": raw.get("similarity", raw.get("score")),
        })
        display[memory_id] = {
            "title": _text(record.get("title")) or memory_id,
            "kind": _text(record.get("kind")) or "unknown",
        }

    proposal = propose_experience_thread_members(
        joined,
        thread_id=thread_id,
        title=title,
        workspace=workspace,
        anchor_ids=anchor_ids,
        min_score=min_score,
    )
    return {
        "mode": "read_only_review",
        **proposal,
        "points": [
            {**point, **display[point["memory_id"]]}
            for point in proposal["points"]
        ],
    }
