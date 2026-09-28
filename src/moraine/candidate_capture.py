from __future__ import annotations

import re
from typing import Any, Iterable


_TRANSITION_PATTERNS = (
    ("multiple_dates", re.compile(r"(?:20\d{2}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?).*?(?:20\d{2}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?)", re.S)),
    ("topic_transition", re.compile(r"(?:另外|与此同时|同一天还|另一件事|除此之外|后来又|随后又|然后又)")),
    ("numbered_events", re.compile(r"(?:^|\n)\s*(?:1[.、)]|一[、.]).+\n\s*(?:2[.、)]|二[、.])", re.S)),
)


def possible_multi_event_signals(candidates: Iterable[dict[str, Any]]) -> list[str]:
    text = "\n".join(
        f"{candidate.get('title', '')}\n{candidate.get('content', '')}"
        for candidate in candidates
    )
    return [name for name, pattern in _TRANSITION_PATTERNS if pattern.search(text)]


def write_guidance(
    candidates: list[dict[str, Any]],
    *,
    episode_id: str,
    episode_complete: bool,
    batch: bool,
) -> dict[str, Any]:
    signals = possible_multi_event_signals(candidates)
    if episode_complete:
        return {
            "episode_id": episode_id,
            "status": "complete",
            "needs_episode_confirmation": False,
            "possible_multiple_events": bool(signals),
            "signals": signals,
            "message": "This episode was marked complete. The candidates remain separate, reviewable material.",
        }
    message = (
        "The batch was accepted. Check the current conversation once for any other independent event. "
        if batch else
        "This candidate was accepted. Check the current conversation once for any other independent event. "
    )
    message += (
        "Different subjects, actions, outcomes, or lifecycles should be submitted as separate candidates "
        "under the same episode_id; sharing a day is not a reason to merge them. "
        "If there is nothing else worth preserving, mark the episode complete."
    )
    if signals:
        message += " The submitted text may contain more than one event; consider splitting it before review."
    return {
        "episode_id": episode_id,
        "status": "check_more_events",
        "needs_episode_confirmation": True,
        "choices": ["complete", "add_more"],
        "possible_multiple_events": bool(signals),
        "signals": signals,
        "message": message,
    }
