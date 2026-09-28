from __future__ import annotations

import re


PROTECTED_KINDS = {"identity", "relationship", "boundary"}
DURABLE_KINDS = {"project", "decision", "preference", "identity", "relationship", "boundary"}
DECISION_OR_RESULT = re.compile(r"决定|确认|完成|上线|部署|修复|建立|改为|恢复|发布|寄出|收到|开始通信|达成|已经|已")
FUTURE_BEHAVIOR = re.compile(r"以后|今后|后续|下一步|原则|应当|应该|不再|将会|需要")
LATER_CONFIRMATION = re.compile(r"再次|重新|复测|后续确认|实际验收|真实验收|持续")
RELATIONSHIP_COMMITMENT = re.compile(r"相爱|爱你|表白|彼此选择|特别选择|继续相伴|一直相伴|共同生活|安心回来|确认关系|关系修复|结婚|婚礼|情书|承诺|约定|接住")


def admission_signals(candidate: dict) -> list[str]:
    text = f"{candidate.get('title', '')}\n{candidate.get('content', '')}"
    kind = str(candidate.get("kind") or "").casefold()
    signals: list[str] = []
    if DECISION_OR_RESULT.search(text):
        signals.append("decision_or_result")
    if FUTURE_BEHAVIOR.search(text):
        signals.append("future_behavior")
    if kind in DURABLE_KINDS or re.search(r"身份|关系|偏好|边界|长期项目|长期原则", text):
        signals.append("stable_domain")
    if LATER_CONFIRMATION.search(text):
        signals.append("later_confirmation")
    if kind == "relationship" and RELATIONSHIP_COMMITMENT.search(text):
        signals.append("relationship_commitment")
    try:
        if float(candidate.get("requested_importance", candidate.get("importance", 0))) >= 0.7:
            signals.append("author_salience")
    except (TypeError, ValueError):
        pass
    return list(dict.fromkeys(signals))


def classify_candidate(candidate: dict) -> dict:
    signals = admission_signals(candidate)
    kind = str(candidate.get("kind") or "").casefold()
    protected = kind in PROTECTED_KINDS
    eligible = len(signals) >= 2
    if protected:
        status = "protected_review_ready" if eligible else "protected_review"
        lane = "protected"
    else:
        status = "ready_for_review" if eligible else "held_low_signal"
        lane = "actionable" if eligible else "held_low_signal"
    strength = 0.75 if len(signals) >= 4 else 0.6 if len(signals) == 3 else 0.4 if eligible else None
    return {
        "version": 1, "signals": signals, "signal_count": len(signals),
        "eligible": eligible, "protected": protected, "status": status,
        "review_lane": lane, "suggested_importance": strength,
        "automatic_persistence": False,
    }
