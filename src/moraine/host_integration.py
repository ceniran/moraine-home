from __future__ import annotations

import json
import re
from collections.abc import Callable, Iterable
from copy import deepcopy


MEMORY_BLOCK = re.compile(r"<dwell-memory>\s*(.*?)\s*</dwell-memory>", re.DOTALL)
MAX_TURN_CHARS = 100_000
MAX_BLOCKS = 8
ALLOWED_MEMORY_FIELDS = {
    "title", "content", "kind", "tags", "emotion_keywords", "importance",
    "requested_importance", "occurred_at", "basket", "service_areas",
    "object_keys", "action_keys", "expires_at", "admission_mode",
}


def _message_text(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return str(value.get("content") or value.get("text") or "").strip()
    return ""


def build_turn_query(message: str, recent_messages: Iterable[object] | None = None) -> str:
    """Build a bounded recall query, adding history only for short continuation turns."""
    current = str(message or "").strip()
    if not current:
        raise ValueError("message is required")
    if len(current) > 80:
        return current[:2000]
    history = [_message_text(item) for item in list(recent_messages or [])[-4:]]
    history = [item for item in history if item]
    return "\n".join((history[-2:] + [current]))[-2000:]


def format_turn_context(layered: dict, semantic_items: list[dict] | None = None) -> str:
    """Format bounded evidence for a host prompt without changing the store."""
    lines = [
        "[Moraine 召回｜只作线索，不把旧理解当作当前事实]",
        "先核对人物、时间、来源与后续变化；无关内容可以忽略。",
    ]
    seen: set[str] = set()
    for layer in layered.get("layers") or []:
        for item in layer.get("items") or []:
            memory_id = str(item.get("id") or "")
            fingerprint = memory_id or str(item.get("text") or "")
            if not fingerprint or fingerprint in seen:
                continue
            seen.add(fingerprint)
            sources = "、".join(str(value) for value in item.get("source_ids") or [])
            suffix = f"〔来源：{sources}〕" if sources else ""
            lines.append(f"- [{layer.get('name', 'memory')}] {item.get('text', '')}{suffix}")
    for row in list(semantic_items or [])[:4]:
        memory_id = str(row.get("id") or "")
        fingerprint = memory_id or f"{row.get('title', '')}\0{row.get('content', '')}"
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        lines.append(f"- [semantic] {row.get('title', '')}：{str(row.get('content') or '')[:500]}")
    if len(lines) == 2:
        lines.append("- 没有找到足够相关的旧信息；继续处理当前对话即可。")
    return "\n".join(lines)


def prepare_turn(store, message: str, recent_messages: Iterable[object] | None = None,
                 *, area: str | None = None, include_history: bool = False,
                 semantic_items: list[dict] | None = None) -> dict:
    query = build_turn_query(message, recent_messages)
    layered = store.layered_context(query, include_history=include_history, area=area)
    if semantic_items is None:
        try:
            semantic_items = store.keyword_search(query, 4)
        except (AttributeError, ValueError):
            semantic_items = []
    return {
        "query": query,
        "context": layered,
        "prompt_context": format_turn_context(layered, semantic_items),
        "write_contract": {
            "marker": "<dwell-memory>{JSON}</dwell-memory>",
            "default_admission_mode": "candidate",
            "direct_admission_available": True,
            "emotion_keywords": "optional ordinary tags; zero or several",
        },
        "persisted": False,
    }


def extract_memory_blocks(text: str) -> list[dict]:
    value = str(text or "")
    if len(value) > MAX_TURN_CHARS:
        raise ValueError(f"assistant_text must contain at most {MAX_TURN_CHARS} characters")
    matches = list(MEMORY_BLOCK.finditer(value))
    if len(matches) > MAX_BLOCKS:
        raise ValueError(f"assistant_text may contain at most {MAX_BLOCKS} memory blocks")
    output = []
    for index, match in enumerate(matches):
        try:
            raw = json.loads(match.group(1))
        except json.JSONDecodeError as error:
            output.append({"index": index, "error": f"invalid_json: {error.msg}"})
            continue
        if not isinstance(raw, dict):
            output.append({"index": index, "error": "memory block must be a JSON object"})
            continue
        payload = {key: deepcopy(value) for key, value in raw.items() if key in ALLOWED_MEMORY_FIELDS}
        if not str(payload.get("title") or "").strip() or not str(payload.get("content") or "").strip():
            output.append({"index": index, "error": "title and content are required"})
            continue
        output.append({"index": index, "payload": payload})
    return output


def strip_memory_blocks(text: str) -> str:
    return MEMORY_BLOCK.sub("", str(text or "")).strip()


def commit_turn(assistant_text: str, submit: Callable[[dict], dict], *,
                default_admission_mode: str = "candidate") -> dict:
    mode = str(default_admission_mode or "candidate").strip().casefold()
    if mode not in {"candidate", "direct"}:
        raise ValueError("default_admission_mode must be candidate or direct")
    extracted = extract_memory_blocks(assistant_text)
    accepted, errors = [], []
    for item in extracted:
        if item.get("error"):
            errors.append({"index": item["index"], "error": item["error"]})
            continue
        payload = dict(item["payload"])
        payload.setdefault("admission_mode", mode)
        payload["selected_by"] = "agent"
        try:
            accepted.append({"index": item["index"], "result": submit(payload)})
        except Exception as error:
            errors.append({"index": item["index"], "error": f"{type(error).__name__}: {error}"})
    return {
        "visible_text": strip_memory_blocks(assistant_text),
        "block_count": len(extracted),
        "accepted": accepted,
        "errors": errors,
        "persisted_count": len(accepted),
    }
