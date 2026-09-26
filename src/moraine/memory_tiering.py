from __future__ import annotations

from datetime import datetime, timezone
from typing import Mapping


PROTECTED_KINDS = {"identity", "relationship", "boundary"}
RECENT_KINDS = {"status", "emotion", "temporary", "plan"}


def _number(value, default: float = 0) -> float:
    try:
        return max(0, float(value))
    except (TypeError, ValueError):
        return default


def _has_future_expiry(value: object, now: datetime) -> bool:
    if not value:
        return False
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed > now
    except ValueError:
        return False


def suggest_memory_tier(candidate: Mapping, *, now: datetime | None = None) -> dict:
    """Return a deterministic, zero-write tier suggestion for one candidate.

    The function deliberately uses explicit metadata only. It does not infer
    truth, personality, relationship status, or semantic meaning from prose.
    """
    now = now or datetime.now(timezone.utc)
    kind = str(candidate.get("kind") or "event").strip().casefold()
    confirmation_count = int(_number(candidate.get("confirmation_count")))
    recall_count = int(_number(candidate.get("recall_count")))
    action_reference_count = int(_number(candidate.get("action_reference_count")))
    observed_span_days = _number(candidate.get("observed_span_days"))
    expires_at = candidate.get("expires_at")

    signals = {
        "kind": kind,
        "confirmation_count": confirmation_count,
        "recall_count": recall_count,
        "action_reference_count": action_reference_count,
        "observed_span_days": observed_span_days,
        "has_future_expiry": _has_future_expiry(expires_at, now),
    }

    if kind in PROTECTED_KINDS:
        return {
            "suggested_tier": "uncertain",
            "confidence": "high",
            "reasons": ["protected_kind_requires_specialized_review"],
            "signals": signals,
            "requires_review": True,
            "allowed_confirmations": [],
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
            "persisted": False,
        }

    long_term_reasons = []
    if confirmation_count >= 2:
        long_term_reasons.append("repeated_confirmation")
    if observed_span_days >= 7:
        long_term_reasons.append("observed_across_time")
    if recall_count >= 2:
        long_term_reasons.append("recalled_again")
    if action_reference_count >= 1:
        long_term_reasons.append("affected_later_action")
    if long_term_reasons:
        return {
            "suggested_tier": "long_term",
            "confidence": "high" if len(long_term_reasons) >= 2 else "medium",
            "reasons": long_term_reasons,
            "signals": signals,
            "requires_review": True,
            "allowed_confirmations": ["recent", "long_term"],
            "persisted": False,
        }

    return {
        "suggested_tier": "uncertain",
        "confidence": "low",
        "reasons": ["insufficient_stability_evidence"],
        "signals": signals,
        "requires_review": True,
        "allowed_confirmations": ["recent", "long_term"],
        "persisted": False,
    }
