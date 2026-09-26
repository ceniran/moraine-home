from __future__ import annotations

from datetime import datetime, timezone
from typing import Mapping


PROTECTED_KINDS = {"identity", "relationship", "boundary"}
RECENT_KINDS = {"status", "emotion", "temporary", "plan"}
DURABLE_KINDS = {"decision", "project", "reflection"}


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
