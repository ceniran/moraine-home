from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping

from .governance import clamp_strength, strength_from_importance


@dataclass(frozen=True)
class RetrievalPolicy:
    """Deterministic, read-only policy for reranking semantic candidates."""

    semantic_weight: float = 0.8
    strength_weight: float = 0.2
    minimum_semantic_score: float = 0.35
    missing_strength: int = 50

    def __post_init__(self) -> None:
        if self.semantic_weight < 0 or self.strength_weight < 0:
            raise ValueError("ranking weights cannot be negative")
        if self.semantic_weight + self.strength_weight <= 0:
            raise ValueError("at least one ranking weight must be positive")
        if not -1 <= self.minimum_semantic_score <= 1:
            raise ValueError("minimum_semantic_score must be between -1 and 1")


def _strength(candidate: Mapping, policy: RetrievalPolicy) -> int:
    explicit = candidate.get("strength")
    if explicit is not None:
        return clamp_strength(explicit)
    stored = strength_from_importance(candidate.get("importance"))
    return stored if stored is not None else clamp_strength(policy.missing_strength)


def rerank_candidates(
    candidates: Iterable[Mapping],
    *,
    limit: int = 20,
    policy: RetrievalPolicy | None = None,
) -> list[dict]:
    """Rerank resolved candidates without reading or changing memory content.

    A semantic gate is applied before memory strength. This prevents an
    unrelated core memory from entering the result set merely because it has a
    high strength. Stable input position is the final tie-breaker.
    """

    policy = policy or RetrievalPolicy()
    total_weight = policy.semantic_weight + policy.strength_weight
    ranked = []
    for position, raw in enumerate(candidates):
        candidate = dict(raw)
        semantic = float(candidate.get("score", candidate.get("semantic_score", 0.0)))
        if semantic < policy.minimum_semantic_score:
            continue
        strength = _strength(candidate, policy)
        final = (
            semantic * policy.semantic_weight
            + (strength / 100.0) * policy.strength_weight
        ) / total_weight
        candidate.update({
            "semantic_score": semantic,
            "memory_strength": strength,
            "final_score": final,
            "ranking_reason": {
                "semantic_weight": policy.semantic_weight / total_weight,
                "strength_weight": policy.strength_weight / total_weight,
                "minimum_semantic_score": policy.minimum_semantic_score,
            },
            "_input_position": position,
        })
        ranked.append(candidate)

    ranked.sort(key=lambda row: (-row["final_score"], -row["semantic_score"], row["_input_position"]))
    count = max(1, min(int(limit), 100))
    for row in ranked:
        row.pop("_input_position", None)
    return ranked[:count]


def compare_rankings(
    candidates: Iterable[Mapping],
    *,
    limit: int = 20,
    policy: RetrievalPolicy | None = None,
) -> dict:
    """Return semantic-only and strength-aware rankings for dry-run review."""

    rows = [dict(row) for row in candidates]
    count = max(1, min(int(limit), 100))
    baseline = sorted(
        rows,
        key=lambda row: -float(row.get("score", row.get("semantic_score", 0.0))),
    )[:count]
    return {
        "mode": "read_only_comparison",
        "baseline": baseline,
        "strength_aware": rerank_candidates(rows, limit=count, policy=policy),
    }
