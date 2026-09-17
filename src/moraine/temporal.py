from __future__ import annotations

from datetime import datetime, timezone
from typing import Mapping


def parse_time(value: object) -> datetime | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def validate_validity(record: Mapping[str, object]) -> None:
    start = parse_time(record.get("valid_from"))
    end = parse_time(record.get("valid_to"))
    if start is not None and end is not None and end <= start:
        raise ValueError("valid_to must be later than valid_from")


def is_valid_at(record: Mapping[str, object], at: str | datetime) -> bool:
    """Return whether an authoritative record describes a fact valid at `at`."""
    validate_validity(record)
    moment = parse_time(at) if not isinstance(at, datetime) else at
    if moment is None:
        raise ValueError("at is required")
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    moment = moment.astimezone(timezone.utc)
    start = parse_time(record.get("valid_from"))
    end = parse_time(record.get("valid_to"))
    return (start is None or start <= moment) and (end is None or moment < end)


def is_current(record: Mapping[str, object], now: str | datetime) -> bool:
    return record.get("state", "active") == "active" and is_valid_at(record, now)
