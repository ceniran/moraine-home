from __future__ import annotations

import re
from typing import Mapping


SHADOW_SCHEMA = "aml-shadow-v4"
CURRENT = re.compile(r"后来|当前|现在|目前|如今|最终|最新|改为|变成|不再|恢复|\b(?:current|latest|changed|now)\b", re.I)
HISTORICAL = re.compile(r"最初|以前|原来|曾经|起初|之前|\b(?:old|former|initially|before)\b", re.I)
UPDATE = re.compile(r"后来.{0,24}(?:改为|变成|不再|恢复)|(?:改为|变成|不再|更新为|替换为|更正为|纠正为|不是.{0,24}而是)|\b(?:changed|became|no longer|switched to|replaced by|corrected to)\b", re.I)
NEGATED = re.compile(r"不喜欢|不再|不是|没有|从未|取消|拒绝|禁止|不得|\b(?:not|never|no longer|didn't|doesn't|isn't|aren't)\b", re.I)
EDGE_STOP_TERMS = {"现在", "目前", "后来", "最终", "最新", "改为", "变成", "因为", "所以", "因此",
                   "这个", "那个", "已经", "还是", "什么", "怎么", "用户", "助手",
                   "the", "and", "that", "this", "with", "from", "into", "for", "was", "were",
                   "are", "has", "have", "had", "his", "her", "their", "our", "your", "its",
                   "who", "what", "when", "where", "which", "why", "how", "not", "but", "can",
                   "could", "would", "should", "will", "may", "might", "about", "after", "before",
                   "then", "than", "also", "very", "just", "some", "any", "all", "one", "two",
                   "unknown", "time", "years", "year", "old", "new", "man", "woman", "people"}


def _normalized(value: object) -> str:
    return "".join(re.findall(r"[a-z0-9\u3400-\u9fff]+", str(value or "").casefold()))


def _terms(row: Mapping) -> set[str]:
    return {str(term) for term in row.get("salient_terms") or []
            if len(str(term)) >= 2 and str(term) not in EDGE_STOP_TERMS}


def _edge(left: Mapping, right: Mapping, *, left_terms: set[str] | None = None,
          right_terms: set[str] | None = None, left_normalized: str | None = None,
          right_normalized: str | None = None) -> dict | None:
    if left.get("id") == right.get("id"):
        return None
    a = _terms(left) if left_terms is None else left_terms
    b = _terms(right) if right_terms is None else right_terms
    shared = sorted(a & b)
    similarity = len(shared) / max(1, min(len(a), len(b)))
    old, new = sorted((left, right), key=lambda row: (
        float(row.get("time_value") or 0), int(row.get("ingest_sequence") or 0),
        str(row.get("request_id") or ""), int(row.get("order") or 0),
    ))
    old_text, new_text = str(old.get("content") or ""), str(new.get("content") or "")
    old_subjects = {str(item).casefold() for item in old.get("subjects") or []}
    new_subjects = {str(item).casefold() for item in new.get("subjects") or []}
    # Never build an event edge across two explicitly different actors. A
    # leading pronoun without same-session antecedent is likewise insufficient
    # evidence for an automatic merge.
    if old_subjects and new_subjects and old_subjects.isdisjoint(new_subjects):
        return None
    if old.get("subject_ambiguous") or new.get("subject_ambiguous"):
        return None
    relation = "related_only"
    normalized_left = _normalized(left.get("content")) if left_normalized is None else left_normalized
    normalized_right = _normalized(right.get("content")) if right_normalized is None else right_normalized
    if normalized_left == normalized_right:
        relation = "duplicate"
    elif len(shared) >= 2 and similarity >= 0.25 and UPDATE.search(new_text):
        relation = "evolution"
    elif (len(shared) >= 2 and similarity >= 0.30
          and bool(NEGATED.search(old_text)) != bool(NEGATED.search(new_text))):
        relation = "conflict"
    elif (len(shared) >= 2 and similarity >= 0.30
          and "causal" in (old.get("signals") or [])
          and "causal" in (new.get("signals") or [])):
        relation = "causal"
    elif (len(shared) >= 2 and similarity >= 0.30
          and old.get("temporal_facts") and new.get("temporal_facts")):
        relation = "timeline"
    elif len(shared) >= 4 and similarity >= 0.50:
        relation = "supplement"
    elif len(shared) < 2:
        return None
    if relation == "related_only":
        return None
    confidence = min(0.98, 0.45 + len(shared) * 0.08
                     + (0.18 if relation in {"duplicate", "evolution", "conflict", "causal"} else 0.0))
    return {
        "source_id": str(old["id"]), "target_id": str(new["id"]), "relation": relation,
        "confidence": round(confidence, 4), "shared_terms": shared[:12],
        "source_time": float(old.get("time_value") or 0), "target_time": float(new.get("time_value") or 0),
        "authoritative": False, "rebuildable": True,
    }


def ensure_shadow_graph(data: dict, pending_ids: set[str] | None = None) -> bool:
    """Incrementally build a read-only graph; raw messages remain authoritative."""
    memories = list(data.get("memories") or [])
    if data.get("shadow_schema") != SHADOW_SCHEMA:
        data["shadow_edges"] = []
        data["shadow_indexed_ids"] = []
        data["shadow_schema"] = SHADOW_SCHEMA
    indexed = set(data.get("shadow_indexed_ids") or [])
    pending = [
        row for row in memories
        if row.get("id") not in indexed
        and (pending_ids is None or str(row.get("id")) in pending_ids)
    ]
    if not pending:
        return False
    existing = [row for row in memories if row.get("id") in indexed]
    by_id = {str(row["id"]): row for row in memories}
    # A Full corpus can contain long evidence pages. One pending batch may
    # compare the same old page with many new rows, so deriving terms and a
    # punctuation-insensitive duplicate key inside every pair turns a bounded
    # 16-row warmup into tens of thousands of full-text regex scans. Cache each
    # row once for this incremental pass; the cache is request-local and does
    # not enlarge the durable store.
    term_cache = {str(row["id"]): _terms(row) for row in memories}
    normalized_cache: dict[str, str] = {}

    def normalized(row: Mapping) -> str:
        row_id = str(row["id"])
        if row_id not in normalized_cache:
            normalized_cache[row_id] = _normalized(row.get("content"))
        return normalized_cache[row_id]

    term_index: dict[str, set[str]] = {}
    for row in existing:
        for term in term_cache[str(row["id"])]:
            term_index.setdefault(term, set()).add(str(row["id"]))
    edges = list(data.get("shadow_edges") or [])
    seen = {(edge.get("source_id"), edge.get("target_id"), edge.get("relation")) for edge in edges}
    for row in pending:
        candidate_ids = set()
        row_terms = term_cache[str(row["id"])]
        for term in row_terms:
            candidate_ids.update(term_index.get(term, set()))
        for candidate_id in candidate_ids:
            other = by_id[candidate_id]
            edge = _edge(
                other, row,
                left_terms=term_cache[str(other["id"])], right_terms=row_terms,
                left_normalized=normalized(other), right_normalized=normalized(row),
            )
            if edge and (edge["source_id"], edge["target_id"], edge["relation"]) not in seen:
                edges.append(edge)
                seen.add((edge["source_id"], edge["target_id"], edge["relation"]))
        for term in row_terms:
            term_index.setdefault(term, set()).add(str(row["id"]))
    # A graph is evidence, not a similarity clique. Keep only a handful of the
    # strongest incoming edges of each relation for every target memory.
    kept = []
    incoming: dict[tuple[str, str], int] = {}
    for edge in sorted(edges, key=lambda item: (item["confidence"], item["target_time"]), reverse=True):
        key = (edge["target_id"], edge["relation"])
        if incoming.get(key, 0) >= 6:
            continue
        incoming[key] = incoming.get(key, 0) + 1
        kept.append(edge)
    data["shadow_edges"] = kept[:4000]
    completed = indexed | {str(row["id"]) for row in pending}
    data["shadow_indexed_ids"] = [str(row["id"]) for row in memories if str(row["id"]) in completed]
    return True


def graph_bonuses(data: Mapping, base_scores: Mapping[str, float], query: str) -> dict[str, dict]:
    """Return bounded query-specific bonuses without changing graph or memories."""
    causal = bool(re.search(r"为什么|原因|导致|结果|如何发生|because|why|cause|result", query, re.I))
    current = bool(re.search(r"当前|现在|目前|如今|最终|最新|current|latest|now", query, re.I))
    historical = bool(re.search(r"最初|以前|原来|曾经|之前|当时|original|before|histor", query, re.I))
    temporal = bool(re.search(r"何时|什么时候|哪天|顺序|先后|之前|之后|when|before|after", query, re.I))
    seeds = {row_id for row_id, _ in sorted(base_scores.items(), key=lambda item: item[1], reverse=True)[:6]}
    bonuses: dict[str, dict] = {}
    frontier = set(seeds)
    for depth in range(2):
        next_frontier = set()
        for edge in data.get("shadow_edges") or []:
            source, target, relation = edge["source_id"], edge["target_id"], edge["relation"]
            if source not in frontier and target not in frontier:
                continue
            for row_id, direction in ((source, "source"), (target, "target")):
                amount = 0.0
                confidence = float(edge.get("confidence") or 0.0)
                if relation == "causal" and causal:
                    amount = 0.14 * confidence / (depth + 1)
                elif relation == "evolution" and current:
                    amount = (0.18 if direction == "target" else -0.10) * confidence / (depth + 1)
                elif relation == "evolution" and historical:
                    amount = (0.16 if direction == "source" else 0.02) * confidence / (depth + 1)
                elif relation == "timeline" and temporal:
                    amount = 0.10 * confidence / (depth + 1)
                if amount:
                    item = bonuses.setdefault(row_id, {"bonus": 0.0, "relations": []})
                    if amount > 0:
                        item["bonus"] = max(item["bonus"], amount)
                    else:
                        item["bonus"] = min(item["bonus"], amount)
                    item["bonus"] = max(-0.10, min(0.18, item["bonus"]))
                    item["relations"].append(relation)
                    next_frontier.add(row_id)
        frontier = next_frontier - seeds
    return bonuses
