from __future__ import annotations

from itertools import combinations
from typing import Iterable, Mapping

from .temporal import parse_time


def _strings(value: object) -> set[str]:
    if not isinstance(value, (list, tuple, set)):
        return set()
    return {str(item).strip() for item in value if str(item).strip()}


def _active_topics(row: Mapping[str, object]) -> set[str]:
    evidence = row.get("topic_evidence")
    if not isinstance(evidence, Mapping):
        return set()
    topics = evidence.get("topics")
    if not isinstance(topics, list):
        return set()
    return {
        str(topic.get("topic_id") or "").strip()
        for topic in topics
        if isinstance(topic, Mapping) and not topic.get("vetoed")
        and topic.get("evidence_level") in {"exact", "alias", "supporting", "reviewed"}
        and str(topic.get("topic_id") or "").strip()
    }


def propose_event_matches(rows: Iterable[Mapping[str, object]], *, max_gap_minutes: int = 60) -> list[dict]:
    """Return reversible, review-only same-event suggestions.

    A shared topic only admits a pair for comparison. It never contributes a
    merge score. Object and action keys must be supplied explicitly by an
    integration; Moraine does not infer them from prose.
    """
    if not 1 <= int(max_gap_minutes) <= 24 * 60:
        raise ValueError("max_gap_minutes must be between 1 and 1440")
    prepared = []
    for raw in rows:
        row = dict(raw)
        row_id = str(row.get("id") or "").strip()
        observed = parse_time(row.get("occurred_at") or row.get("observed_at") or row.get("created_at"))
        if not row_id or observed is None:
            continue
        prepared.append((row_id, observed, row))
    prepared.sort(key=lambda item: (item[1], item[0]))

    suggestions = []
    for left, right in combinations(prepared, 2):
        gap = int(abs((right[1] - left[1]).total_seconds()) // 60)
        if gap > int(max_gap_minutes):
            continue
        shared_topics = sorted(_active_topics(left[2]) & _active_topics(right[2]))
        if not shared_topics:
            continue
        shared_objects = sorted(_strings(left[2].get("object_keys")) & _strings(right[2].get("object_keys")))
        shared_actions = sorted(_strings(left[2].get("action_keys")) & _strings(right[2].get("action_keys")))
        blockers = []
        if not shared_objects:
            blockers.append("object_identity_unconfirmed")
        if not shared_actions:
            blockers.append("action_continuity_unconfirmed")
        if {str(left[2].get("kind") or ""), str(right[2].get("kind") or "")} & {"identity", "relationship", "boundary"}:
            blockers.append("protected_kind_requires_review")
        suggestions.append({
            "member_ids": [left[0], right[0]],
            "status": "suggested" if not blockers else "needs_review",
            "evidence": {
                "shared_topic_ids": shared_topics,
                "time_gap_minutes": gap,
                "shared_object_keys": shared_objects,
                "shared_action_keys": shared_actions,
            },
            "blockers": blockers,
            "keyword_role": "comparison_gate",
            "topic_match_is_not_event_identity": True,
            "automatic_merge": False,
            "reversible": True,
            "persisted": False,
        })
    return suggestions
