from __future__ import annotations

from datetime import datetime, timezone
from typing import Mapping, Sequence


PROTECTED_KINDS = {"identity", "relationship", "boundary"}
RECENT_KINDS = {"status", "emotion", "temporary", "plan"}
DURABLE_KINDS = {"decision", "project", "reflection"}

PROTECTED_TEXT_RULES = {
    "identity": ("我是", "我叫", "身份", "self-core", "self core"),
    "relationship": ("关系", "伴侣", "爱人", "结婚", "分手", "朋友", "家人"),
    "boundary": ("边界", "不允许", "禁止", "不得", "隐私", "不要再"),
}
RECENT_TEXT_RULES = ("今天", "今晚", "刚才", "暂时", "目前", "这次", "待会", "明天", "正在")
DURABLE_TEXT_RULES = ("决定", "以后", "长期", "始终", "持续", "已经完成", "发布", "部署", "建立")
HYPOTHETICAL_RULES = ("如果", "假如", "也许", "可能会", "希望有一天", "怎么办", "要是")
OTHER_SUBJECT_RULES = ("我朋友", "同事说", "别人说", "他喜欢", "她喜欢", "他们喜欢")


def _number(value, default: float = 0) -> float:
    try:
        return max(0, float(value))
    except (TypeError, ValueError):
        return default


def _has_future_expiry(value: object, now: datetime) -> bool:
    if not value:
        return False
    parsed = _timestamp(value)
    return parsed is not None and parsed > now


def _timestamp(value: object) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc)
    except ValueError:
        return None


def derive_tiering_evidence(candidate: Mapping, snapshot: Mapping) -> dict:
    """Derive stable signals from existing store data without writing counters."""
    basket = str(candidate.get("basket") or "").strip()
    peers = [
        row for row in snapshot.get("candidates", [])
        if basket and basket != "unassigned" and str(row.get("basket") or "").strip() == basket
    ]
    dates = [
        value for value in (_timestamp(row.get("occurred_at") or row.get("created_at")) for row in peers)
        if value is not None
    ]
    span_days = (max(dates) - min(dates)).total_seconds() / 86400 if len(dates) > 1 else 0.0
    candidate_id = str(candidate.get("id") or "")
    source_confirmations = sum(
        candidate_id in set(memory.get("source_candidate_ids") or [])
        for memory in snapshot.get("memories", [])
    )
    audit_confirmations = sum(
        event.get("target") == candidate_id and event.get("type") in {"candidate_restored", "candidate_routed"}
        for event in snapshot.get("events", [])
    )
    return {
        "related_observation_count": len(peers),
        "observed_span_days": max(0.0, span_days),
        "review_confirmation_count": source_confirmations + audit_confirmations,
        "evidence_source": "store_projection",
    }


def infer_text_tiering(candidate: Mapping, *, semantic_neighbors: Sequence[Mapping] | None = None,
                       semantic_mode: str = "unavailable") -> dict:
    """Use explainable keyword evidence, with local semantics only as support."""
    text = " ".join((str(candidate.get("title") or ""), str(candidate.get("content") or ""))).casefold()
    protected_hits = {name: [term for term in terms if term.casefold() in text]
                      for name, terms in PROTECTED_TEXT_RULES.items()}
    protected_hits = {name: hits for name, hits in protected_hits.items() if hits}
    explicit_kind = str(candidate.get("kind") or "event").strip().casefold()
    if explicit_kind in PROTECTED_KINDS:
        protected_hits.setdefault(explicit_kind, []).append(f"kind:{explicit_kind}")
    blockers = []
    if any(term in text for term in HYPOTHETICAL_RULES):
        blockers.append("hypothetical_or_conditional")
    if any(term in text for term in OTHER_SUBJECT_RULES):
        blockers.append("other_subject_unconfirmed")
    recent_hits = [term for term in RECENT_TEXT_RULES if term in text]
    durable_hits = [term for term in DURABLE_TEXT_RULES if term in text]
    votes = {"recent": 0.0, "long_term": 0.0}
    semantic_evidence = []
    for row in list(semantic_neighbors or [])[:8]:
        tier = str(row.get("memory_tier") or "")
        try:
            score = float(row.get("score") or 0)
        except (TypeError, ValueError):
            score = 0.0
        if tier in votes and score >= 0.72:
            votes[tier] += score
            semantic_evidence.append({"id": str(row.get("id") or "")[:160], "tier": tier,
                                      "score": round(score, 4)})
    semantic_tier = max(votes, key=votes.get) if max(votes.values()) > 0 else None
    if semantic_tier and min(votes.values()) and abs(votes["recent"] - votes["long_term"]) < 0.2:
        blockers.append("semantic_neighbors_disagree")
        semantic_tier = None
    if protected_hits:
        suggestion, confidence = "uncertain", "high"
        blockers.append("protected_text_requires_specialized_review")
    elif blockers:
        suggestion, confidence = "uncertain", "low"
    elif durable_hits:
        suggestion, confidence = "long_term", ("high" if len(durable_hits) >= 2 or semantic_tier == "long_term" else "medium")
    elif recent_hits or _has_future_expiry(candidate.get("expires_at"), datetime.now(timezone.utc)):
        suggestion = "recent"
        confidence = "high" if candidate.get("expires_at") or semantic_tier == "recent" else "medium"
    elif semantic_tier and votes[semantic_tier] >= 1.5:
        suggestion, confidence = semantic_tier, "medium"
    else:
        suggestion, confidence = "uncertain", "low"
    return {
        "suggested_tier": suggestion, "confidence": confidence,
        "keyword_hits": {"protected": protected_hits, "recent": recent_hits, "durable": durable_hits},
        "semantic": {"mode": semantic_mode, "neighbors": semantic_evidence, "vote": semantic_tier},
        "blockers": list(dict.fromkeys(blockers)), "protected": bool(protected_hits), "persisted": False,
    }


def suggest_memory_tier(candidate: Mapping, *, evidence: Mapping | None = None,
                        now: datetime | None = None) -> dict:
    """Return a deterministic, zero-write tier suggestion for one candidate.

    The function deliberately uses explicit metadata only. It does not infer
    truth, personality, relationship status, or semantic meaning from prose.
    """
    now = now or datetime.now(timezone.utc)
    kind = str(candidate.get("kind") or "event").strip().casefold()
    evidence = dict(evidence or {})
    review_confirmation_count = int(_number(evidence.get("review_confirmation_count")))
    related_observation_count = int(_number(evidence.get("related_observation_count")))
    observed_span_days = _number(evidence.get("observed_span_days"))
    expires_at = candidate.get("expires_at")

    signals = {
        "kind": kind,
        "review_confirmation_count": review_confirmation_count,
        "related_observation_count": related_observation_count,
        "observed_span_days": observed_span_days,
        "has_future_expiry": _has_future_expiry(expires_at, now),
        "evidence_source": str(evidence.get("evidence_source") or "explicit_kind_and_expiry"),
    }

    if kind in PROTECTED_KINDS:
        return {
            "suggested_tier": "uncertain",
            "confidence": "high",
            "reasons": ["protected_kind_requires_specialized_review"],
            "signals": signals,
            "requires_review": True,
            "allowed_confirmations": [],
            "actionable": False,
            "persisted": False,
        }

    if signals["has_future_expiry"] or kind in RECENT_KINDS:
        reasons = ["explicit_future_expiry"] if signals["has_future_expiry"] else ["temporary_kind"]
        return {
            "suggested_tier": "recent",
            "confidence": "high" if signals["has_future_expiry"] else "medium",
            "reasons": reasons,
            "signals": signals,
            "requires_review": True,
            "allowed_confirmations": ["recent", "long_term"],
            "actionable": True,
            "persisted": False,
        }

    long_term_reasons = ["durable_kind"] if kind in DURABLE_KINDS else []
    if review_confirmation_count >= 1:
        long_term_reasons.append("reviewed_again")
    if related_observation_count >= 2 and observed_span_days >= 7:
        long_term_reasons.append("observed_across_time")
    if long_term_reasons:
        return {
            "suggested_tier": "long_term",
            "confidence": "high" if len(long_term_reasons) >= 2 else "medium",
            "reasons": long_term_reasons,
            "signals": signals,
            "requires_review": True,
            "allowed_confirmations": ["recent", "long_term"],
            "actionable": True,
            "persisted": False,
        }

    return {
        "suggested_tier": "uncertain",
        "confidence": "low",
        "reasons": ["insufficient_stability_evidence"],
        "signals": signals,
        "requires_review": True,
        "allowed_confirmations": ["recent", "long_term"],
        "actionable": False,
        "persisted": False,
    }
