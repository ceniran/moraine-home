from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from typing import Mapping


GOVERNANCE_SCHEMA = "aml-governance-v1"
MERGEABLE_RELATIONS = {"duplicate", "evolution", "supplement"}


def _order(row: Mapping) -> tuple[float, int, str, int]:
    return (float(row.get("time_value") or 0), int(row.get("ingest_sequence") or 0),
            str(row.get("request_id") or ""), int(row.get("order") or 0))


def _normalized(value: object) -> str:
    return "".join(re.findall(r"[a-z0-9\u3400-\u9fff]+", str(value or "").casefold()))


def ensure_governance(data: dict) -> bool:
    """Derive conservative, reversible review decisions from evidence edges.

    Raw memories remain authoritative. Only exact duplicates and explicit state
    evolution may share an event. Causal, temporal, or topical proximity never
    becomes an automatic merge decision.
    """
    memories = list(data.get("memories") or [])
    all_edges = list(data.get("shadow_edges") or [])
    edges = [edge for edge in all_edges
             if edge.get("relation") in MERGEABLE_RELATIONS]
    conflict_edges = [edge for edge in all_edges if edge.get("relation") == "conflict"]
    fingerprint = hashlib.sha256(repr((
        [(row.get("id"), row.get("state"), row.get("time_value")) for row in memories],
        [(edge.get("source_id"), edge.get("target_id"), edge.get("relation")) for edge in all_edges],
    )).encode()).hexdigest()
    if data.get("governance_schema") == GOVERNANCE_SCHEMA and data.get("governance_fingerprint") == fingerprint:
        return False

    parent = {str(row["id"]): str(row["id"]) for row in memories}

    def find(item: str) -> str:
        while parent[item] != item:
            parent[item] = parent[parent[item]]
            item = parent[item]
        return item

    def union(left: str, right: str) -> None:
        a, b = find(left), find(right)
        if a != b:
            parent[b] = a

    by_id = {str(row["id"]): row for row in memories}
    for edge in edges:
        left, right = str(edge.get("source_id")), str(edge.get("target_id"))
        if left in parent and right in parent:
            union(left, right)

    groups: dict[str, list[dict]] = defaultdict(list)
    for row in memories:
        groups[find(str(row["id"]))].append(row)

    relation_by_pair = {
        (str(edge["source_id"]), str(edge["target_id"])): str(edge["relation"])
        for edge in edges
    }
    event_views = []
    review_by_id = {}
    for rows in groups.values():
        ordered = sorted(rows, key=_order)
        stable = hashlib.sha256("\n".join(sorted(str(row["id"]) for row in ordered)).encode()).hexdigest()[:20]
        event_id = f"event_{stable}"
        has_evolution = any(
            relation_by_pair.get((str(left["id"]), str(right["id"]))) == "evolution"
            for left in ordered for right in ordered
        )
        current_id = str(ordered[-1]["id"]) if has_evolution else None
        seen_content: dict[str, str] = {}
        timeline = []
        for row in ordered:
            row_id = str(row["id"])
            normalized = _normalized(row.get("content"))
            duplicate_of = seen_content.get(normalized) if normalized else None
            if normalized and not duplicate_of:
                seen_content[normalized] = row_id
            decision = "duplicate" if duplicate_of else (
                "current" if row_id == current_id else ("historical" if has_evolution else "independent")
            )
            review_by_id[row_id] = {
                "event_id": event_id,
                "decision": decision,
                **({"duplicate_of": duplicate_of} if duplicate_of else {}),
            }
            if not duplicate_of:
                timeline.append({
                    "memory_id": row_id,
                    "timestamp": row.get("timestamp"),
                    "content": row.get("content"),
                    "stage": "current" if row_id == current_id else "history",
                })
        if len(ordered) > 1:
            event_views.append({
                "id": event_id,
                "source_ids": [str(row["id"]) for row in ordered],
                "current_id": current_id,
                "timeline": timeline,
                "relations": sorted({
                    relation_by_pair[pair] for pair in relation_by_pair
                    if pair[0] in {str(row["id"]) for row in ordered}
                    and pair[1] in {str(row["id"]) for row in ordered}
                }),
            })

    for row in memories:
        row["automatic_review"] = review_by_id[str(row["id"])]
    data["event_views"] = event_views
    data["conflict_views"] = [{
        "source_id": str(edge["source_id"]), "target_id": str(edge["target_id"]),
        "shared_terms": list(edge.get("shared_terms") or []), "state": "unresolved",
    } for edge in conflict_edges]
    data["governance_schema"] = GOVERNANCE_SCHEMA
    data["governance_fingerprint"] = fingerprint
    return True


def searchable_memories(data: Mapping) -> list[dict]:
    """Return active evidence while folding exact duplicate review results."""
    rows = [row for row in data.get("memories") or [] if row.get("state", "active") == "active"]
    exact_groups: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        exact_groups[_normalized(row.get("content"))].append(row)
    keep = set()
    for normalized, group in exact_groups.items():
        reviewed_duplicate = any((row.get("automatic_review") or {}).get("decision") == "duplicate"
                                 for row in group)
        if normalized and reviewed_duplicate:
            keep.add(str(max(group, key=_order)["id"]))
        else:
            keep.update(str(row["id"]) for row in group)
    # Prefer the latest exact duplicate while retaining every raw source on disk.
    return [row for row in rows if str(row.get("id")) in keep]


def governance_bonuses(data: Mapping, base_scores: Mapping[str, float], query: str) -> dict[str, float]:
    """Use reviewed event structure to retrieve current state or its history."""
    current = bool(re.search(r"当前|现在|目前|如今|最终|最新|current|latest|now", query, re.I))
    historical = bool(re.search(r"最初|以前|原来|曾经|之前|当时|original|before|histor", query, re.I))
    timeline = bool(re.search(r"过程|发展|变化|先后|顺序|之后|后来|何时|什么时候|timeline|evolve|before|after|when", query, re.I))
    conflict = bool(re.search(r"冲突|矛盾|不同说法|到底|究竟|conflict|contradict", query, re.I))
    bonuses: dict[str, float] = {}
    for event in data.get("event_views") or []:
        sources = [str(item) for item in event.get("source_ids") or []]
        seed = max((float(base_scores.get(item, 0.0)) for item in sources), default=0.0)
        if seed <= 0:
            continue
        current_id = str(event.get("current_id") or "")
        for node in event.get("timeline") or []:
            row_id = str(node.get("memory_id") or "")
            amount = 0.0
            if current and row_id == current_id:
                amount = 0.24
            elif historical and row_id != current_id:
                amount = 0.18
            elif timeline:
                amount = 0.14
            elif "supplement" in (event.get("relations") or []):
                amount = 0.08
            if amount:
                bonuses[row_id] = max(bonuses.get(row_id, 0.0), amount)
    if conflict:
        for item in data.get("conflict_views") or []:
            left, right = str(item.get("source_id") or ""), str(item.get("target_id") or "")
            if base_scores.get(left, 0.0) or base_scores.get(right, 0.0):
                bonuses[left] = max(bonuses.get(left, 0.0), 0.16)
                bonuses[right] = max(bonuses.get(right, 0.0), 0.16)
    return bonuses
