from __future__ import annotations

import re
import unicodedata
import json
from dataclasses import dataclass


_SENTENCE_BOUNDARY = re.compile(r"(?<=[。！？!?；;])\s*|\n+")
_IGNORED_FOR_COMPARISON = re.compile(r"[\W_]+", re.UNICODE)
MAX_CONSOLIDATE_BODY = 64 * 1024
MAX_CONSOLIDATE_MEMORIES = 50


def split_sentences(text: str) -> list[str]:
    """Split prose without rewriting it or discarding its punctuation."""
    return [part.strip() for part in _SENTENCE_BOUNDARY.split(str(text)) if part.strip()]


def comparison_key(text: str) -> str:
    """Return a conservative key used only for deterministic deduplication."""
    normalized = unicodedata.normalize("NFKC", text).casefold()
    return _IGNORED_FOR_COMPARISON.sub("", normalized)


@dataclass(frozen=True)
class SentenceSource:
    memory_id: str
    sentence: str


def consolidation_from_body(body: bytes) -> dict:
    """Validate the bounded workbench payload before making a draft."""
    if len(body) > MAX_CONSOLIDATE_BODY:
        raise ValueError("consolidation request is too large")
    payload = json.loads(body or b"{}")
    memories = payload.get("memories") if isinstance(payload, dict) else None
    if not isinstance(memories, list) or not memories:
        raise ValueError("memories must be a non-empty list")
    if len(memories) > MAX_CONSOLIDATE_MEMORIES:
        raise ValueError("too many memories in one consolidation request")
    if not all(isinstance(item, dict) for item in memories):
        raise ValueError("every memory must be an object")
    return consolidate(memories)


def consolidate(memories: list[dict]) -> dict:
    """Build an extractive draft and an auditable removal report.

    Input order is preserved. Exact normalized duplicates are removed. A short
    sentence is removed as subsumed only when its complete normalized text is
    contained in a longer sentence. Paraphrases are deliberately left alone.
    """
    sources: list[SentenceSource] = []
    for memory in memories:
        memory_id = str(memory.get("id", "")).strip()
        if not memory_id:
            raise ValueError("every memory must have an id")
        for sentence in split_sentences(memory.get("content", "")):
            if comparison_key(sentence):
                sources.append(SentenceSource(memory_id, sentence))

    kept: list[SentenceSource] = []
    removed: list[dict] = []
    for candidate in sources:
        key = comparison_key(candidate.sentence)
        duplicate = next((item for item in kept if comparison_key(item.sentence) == key), None)
        if duplicate:
            removed.append({
                "source_id": candidate.memory_id,
                "sentence": candidate.sentence,
                "reason": "exact_duplicate",
                "kept_from": duplicate.memory_id,
            })
            continue

        containing = next(
            (
                item
                for item in sources
                if item != candidate
                and len(comparison_key(item.sentence)) > len(key)
                and key in comparison_key(item.sentence)
            ),
            None,
        )
        if containing:
            removed.append({
                "source_id": candidate.memory_id,
                "sentence": candidate.sentence,
                "reason": "subsumed_verbatim",
                "kept_from": containing.memory_id,
            })
            continue
        kept.append(candidate)

    return {
        "content": "".join(item.sentence for item in kept),
        "sentences": [
            {"text": item.sentence, "source_ids": [item.memory_id]}
            for item in kept
        ],
        "removed": removed,
        "requires_review": True,
        "method": "deterministic_extractive_v1",
    }
