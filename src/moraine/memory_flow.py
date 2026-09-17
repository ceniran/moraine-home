from __future__ import annotations

from typing import Iterable, Mapping

from .core_projection import build_core_projection
from .episodes import build_episode_candidates
from .temporal import is_current, validate_validity


def preview_memory_flow(
    observations: Iterable[Mapping[str, object]],
    reviewed_records: Iterable[Mapping[str, object]],
    *,
    now: str,
    workspace: str,
    inactivity_gap_minutes: int = 60,
    max_episode_minutes: int = 60,
    core_max_chars: int = 2000,
) -> dict:
    """Preview the full memory path without writing source data or an index.

    Only records carrying ``review_status=approved`` may cross the review gate.
    The function returns IDs and projections, not a mutable authoritative store.
    """
    observation_rows = [dict(row) for row in observations]
    proposed_rows = [dict(row) for row in reviewed_records]
    episodes = build_episode_candidates(
        observation_rows,
        inactivity_gap_minutes=inactivity_gap_minutes,
        max_episode_minutes=max_episode_minutes,
    )

    approved: list[dict] = []
    pending_ids: list[str] = []
    rejected_ids: list[str] = []
    for row in proposed_rows:
        memory_id = str(row.get("id") or "")
        if not memory_id:
            raise ValueError("every reviewed record must have an id")
        decision = str(row.get("review_status") or "pending")
        if decision == "approved":
            validate_validity(row)
            approved.append(row)
        elif decision == "rejected":
            rejected_ids.append(memory_id)
        else:
            pending_ids.append(memory_id)

    current_ids = [str(row["id"]) for row in approved if is_current(row, now)]
    historical_ids = [str(row["id"]) for row in approved if not is_current(row, now)]
    projection = build_core_projection(
        approved, now=now, workspace=workspace, max_chars=core_max_chars
    )
    return {
        "mode": "read_only_preview",
        "episodes": episodes,
        "review_gate": {
            "approved_ids": [str(row["id"]) for row in approved],
            "pending_ids": pending_ids,
            "rejected_ids": rejected_ids,
        },
        "would_index_ids": current_ids,
        "historical_ids": historical_ids,
        "core_projection": projection,
        "writes": [],
        "persisted": False,
    }
