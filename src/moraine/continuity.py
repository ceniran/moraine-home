from __future__ import annotations

from copy import deepcopy
import json
from typing import Iterable, Mapping
from datetime import datetime, timezone


DEFAULT_LAYER_BUDGETS = {"self_core": 800, "user_profile": 900, "relations": 800, "recent": 1100, "long_term": 1600, "history": 800}
LEGACY_ITEM_ESTIMATE = 300
MAX_LEGACY_RECENT_ITEMS = 12


def _terms(value: str) -> set[str]:
    return {part.casefold() for part in str(value).replace("/", " ").replace("，", " ").split() if part.strip()}


def _matches(query: str, row: Mapping) -> bool:
    terms = _terms(query)
    if not terms:
        return True
    haystack = " ".join(str(row.get(key) or "") for key in ("name", "relation", "title", "content", "text", "facts")).casefold()
    return any(term in haystack for term in terms)


def _expired(row: Mapping) -> bool:
    value = row.get("expires_at")
    if not value:
        return False
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed <= datetime.now(timezone.utc)
    except ValueError:
        return True


def _fit(rows: Iterable[Mapping], budget: int, *, layer: str, text_keys: tuple[str, ...]) -> dict:
    items, used, skipped_ids = [], 0, []
    for raw in rows:
        row = dict(raw)
        text = "\n".join(str(row.get(key) or "").strip() for key in text_keys if str(row.get(key) or "").strip())
        if not text:
            continue
        item = {"id": row.get("id"), "text": text,
                "source_ids": [str(value)[:160] for value in list(row.get("source_ids") or [])[:20]],
                "reason": str(row.get("recall_reason") or layer)[:120]}
        addition = len(json.dumps(item, ensure_ascii=False)) + (1 if items else 0)
        if used + addition > budget:
            skipped_ids.append(row.get("id"))
            continue
        items.append(item)
        used += addition
    return {"name": layer, "budget": budget, "used": used, "items": items,
            "skipped_count": len(skipped_ids), "skipped_ids": skipped_ids}


def build_layered_context(snapshot: Mapping, *, query: str = "", include_history: bool = False,
                          budgets: Mapping[str, int] | None = None, total_budget: int = 5000) -> dict:
    """Build a bounded, source-linked context projection without changing the store."""
    limits = {**DEFAULT_LAYER_BUDGETS, **dict(budgets or {})}
    if any(int(value) < 0 or int(value) > 20000 for value in limits.values()):
        raise ValueError("layer budgets must be between 0 and 20000 characters")
    total_budget = int(total_budget)
    if total_budget < 1 or total_budget > 12000:
        raise ValueError("total_budget must be between 1 and 12000 characters")
    core = [row for row in snapshot.get("self_core_records", []) if row.get("state", "active") == "active"]
    user_profile = [row for row in snapshot.get("user_profile_records", []) if row.get("state", "active") == "active"]
    relations = [row for row in snapshot.get("relations", []) if row.get("state", "active") == "active" and _matches(query, row)]
    active = [row for row in snapshot.get("memories", []) if row.get("state", "active") == "active"
              and not _expired(row) and _matches(query, row)]
    active.sort(key=lambda row: str(row.get("occurred_at") or row.get("updated_at") or ""), reverse=True)
    historical = [row for row in snapshot.get("memories", []) if row.get("state") in {"archived", "superseded"} and _matches(query, row)]
    historical.sort(key=lambda row: str(row.get("updated_at") or row.get("occurred_at") or ""), reverse=True)
    explicit_recent = [row for row in active if row.get("memory_tier") == "recent"]
    explicit_long_term = [row for row in active if row.get("memory_tier") == "long_term"]
    legacy = [row for row in active if row.get("memory_tier") not in {"recent", "long_term"}]
    legacy_recent_limit = max(1, min(MAX_LEGACY_RECENT_ITEMS, int(limits["recent"]) // LEGACY_ITEM_ESTIMATE))
    recent = explicit_recent + legacy[:legacy_recent_limit]
    long_term = explicit_long_term + legacy[legacy_recent_limit:]
    history_reserve = min(int(limits["history"]), total_budget) if include_history else 0
    layers, remaining = [], total_budget - history_reserve
    for name, rows, text_keys in (
        ("self_core", core, ("text",)), ("user_profile", user_profile, ("subject", "category", "text")),
        ("relations", relations, ("name", "relation", "facts")),
        ("recent", recent, ("title", "content")), ("long_term", long_term, ("title", "content")),
    ):
        layer = _fit(rows, min(int(limits[name]), remaining), layer=name, text_keys=text_keys)
        layers.append(layer)
        remaining -= layer["used"]
    if include_history:
        layer = _fit(historical, min(int(limits["history"]), history_reserve + remaining),
                     layer="history", text_keys=("title", "content"))
        layers.append(layer)
    return {"query": query, "layers": layers, "used_chars": sum(layer["used"] for layer in layers),
            "total_budget": total_budget, "persisted": False, "recall_is_evidence_not_fact": True}


def build_wakeup_preview(snapshot: Mapping, *, signals: list[Mapping] | None = None,
                         query: str = "", adviser_enabled: bool = False) -> dict:
    """Prepare a zero-write wakeup envelope. It never executes an action or calls an adviser."""
    settings = dict(snapshot.get("continuity_settings") or {})
    if not settings.get("wakeup_enabled", False):
        return {"enabled": False, "reason": "wakeup_disabled", "context": None, "choices": [], "adviser_request": None,
                "persisted": False}
    safe_signals = []
    for raw in list(signals or [])[:20]:
        signal = dict(raw)
        if str(signal.get("kind") or "") not in {"direct", "mail", "notification", "project", "social", "rest"}:
            continue
        safe_signals.append({"id": str(signal.get("id") or "")[:120], "kind": str(signal.get("kind"))[:40],
                             "label": str(signal.get("label") or "")[:240], "necessary": bool(signal.get("necessary", False)),
                             "share_with_adviser": bool(signal.get("share_with_adviser", False))})
    context = build_layered_context(snapshot, query=query, budgets=settings.get("layer_budgets") or {},
                                    total_budget=int(settings.get("total_budget", 5000)))
    choices = []
    for signal in safe_signals:
        choices.append({"id": signal["id"], "category": signal["kind"], "label": signal["label"],
                        "reason": "direct_event" if signal["necessary"] else "available_life_signal",
                        "requires_confirmation": signal["kind"] in {"mail", "social", "project"}})
    choices = choices[: max(1, min(int(settings.get("max_choices", 3)), 5))]
    adviser_request = None
    if adviser_enabled and settings.get("adviser_enabled", False) and choices:
        shared_ids = {signal["id"] for signal in safe_signals if signal["share_with_adviser"]}
        adviser_choices = [choice for choice in choices if choice["id"] in shared_ids]
        if adviser_choices:
            adviser_request = {"purpose": "second_opinion_only", "choices": deepcopy(adviser_choices),
                               "excluded": ["memory_content", "relationship_notes", "identity_text", "credentials"],
                               "can_execute": False, "can_write_memory": False}
    return {"enabled": True, "context": context, "signals": safe_signals, "choices": choices,
            "adviser_request": adviser_request, "persisted": False, "executed": False}
