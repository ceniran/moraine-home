from __future__ import annotations

import re
from datetime import datetime


KEYWORD_SCHEMA = "candidate-keywords-v2"

ACTION_WORDS = (
    "新增", "加入", "建立", "接入", "部署", "发布", "完成", "修复", "修改", "升级",
    "恢复", "确认", "决定", "选择", "拒绝", "停止", "开始", "回复", "发送", "整合",
    "拆分", "归档", "召回", "认识", "讨论", "测试", "验收",
)
STATE_WORDS = (
    "运行正常", "已上线", "已部署", "已发布", "已恢复", "已确认", "未完成", "尚未",
    "不再", "持续", "等待", "暂停", "关闭", "失败", "异常", "保留", "独立", "私密",
    "公开", "当前",
)
GENERIC_TAGS = {"event", "project", "decision", "preference", "reflection", "relationship",
                "事件", "项目", "决定", "偏好", "反思", "关系"}
INLINE_DATE = re.compile(
    r"(?:20\d{2})[年./-](?:1[0-2]|0?[1-9])(?:[月./-](?:3[01]|[12]\d|0?[1-9])日?)?"
    r"|(?:1[0-2]|0?[1-9])月(?:3[01]|[12]\d|0?[1-9])日"
    r"|今天|昨天|前天|明天|后天|今年|去年|明年"
)
IDENTIFIER = re.compile(r"\b[A-Za-z][A-Za-z0-9_.-]*\b")
TITLED_PHRASE = re.compile(r"《([^》\n]{2,60})》|「([^」\n]{2,40})」|“([^”\n]{2,40})”")


def _unique(values, limit: int = 12) -> list[str]:
    return list(dict.fromkeys(str(value).strip() for value in values if str(value).strip()))[:limit]


def _normalized_date(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", text)
    if match:
        return "-".join(match.groups())
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return ""


def _identifier_like(term: str) -> bool:
    """Reject ordinary lowercase prose while retaining literal product/ID shapes."""
    return (
        any(character.isupper() for character in term)
        or any(character.isdigit() for character in term)
        or any(character in "_.-" for character in term)
    )


def _entity_type(term: str, *, source: str, candidate_kind: str) -> str:
    if source == "object_key":
        return "object"
    if source == "titled_phrase":
        return "named_work"
    if source == "identifier":
        return "identifier"
    if candidate_kind == "relationship" and re.fullmatch(r"[\u3400-\u9fff]{2,4}", term):
        return "person"
    if _identifier_like(term):
        return "project_or_identifier"
    return "named_tag"


def structured_candidate_keywords(candidate: dict) -> dict:
    """Return transparent, read-only keyword facets for a candidate.

    The result is derived from literal candidate text and explicit metadata. It
    is intentionally not persisted and does not affect admission or recall.
    """
    title = str(candidate.get("title") or "")
    content = str(candidate.get("content") or "")
    text = f"{title}\n{content}"

    candidate_kind = str(candidate.get("kind") or "").casefold()
    evidence: list[dict] = []
    for source, confidence, values in (
        ("object_key", 1.0, list(candidate.get("object_keys") or [])),
        ("tag", 0.9, list(candidate.get("tags") or [])),
    ):
        for value in values:
            term = str(value).strip()
            if term and term.casefold() not in GENERIC_TAGS and term in text:
                evidence.append({"term": term, "type": _entity_type(term, source=source,
                                                                      candidate_kind=candidate_kind),
                                 "source": source, "confidence": confidence})
    for match in TITLED_PHRASE.finditer(text):
        term = next(value for value in match.groups() if value is not None).strip()
        evidence.append({"term": term, "type": "named_work", "source": "titled_phrase",
                         "confidence": 0.8})
    for term in IDENTIFIER.findall(text):
        if _identifier_like(term):
            evidence.append({"term": term, "type": "identifier", "source": "identifier",
                             "confidence": 0.7})
    entity_details = []
    seen_entities = set()
    for item in evidence:
        if item["term"] in seen_entities:
            continue
        seen_entities.add(item["term"])
        entity_details.append(item)
        if len(entity_details) >= 12:
            break

    explicit_actions = [value for value in list(candidate.get("action_keys") or []) if str(value) in text]
    actions = [*explicit_actions, *(word for word in ACTION_WORDS if word in text)]
    states = [word for word in STATE_WORDS if word in text]
    inline_dates = INLINE_DATE.findall(text)
    event_date = _normalized_date(candidate.get("occurred_at") or candidate.get("created_at"))

    return {
        "schema": KEYWORD_SCHEMA,
        "entities": [item["term"] for item in entity_details],
        "entity_details": entity_details,
        "actions": _unique(actions),
        "states": _unique(states),
        "dates": _unique([*inline_dates, event_date] if event_date else inline_dates),
        "derived": True,
        "persisted": False,
        "affects_recall": False,
    }
