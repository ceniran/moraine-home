from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
import time
from pathlib import Path
from typing import Iterable, Protocol

from .query_planner import expand_query
from .aml_shadow import ensure_shadow_graph, graph_bonuses


KEYWORD_SCHEMA = "aml-keywords-v1"
STRUCTURE_SCHEMA = "aml-structure-v2"
MAX_INTRINSIC_KEYWORDS = 128
MAX_AUXILIARY_TERMS = 192

SIGNAL_PATTERNS = {
    "relation": re.compile(r"关系|朋友|同事|伴侣|家人|父母|女儿|儿子|认识|成为|负责|属于|写信|寄信|约定|答应|relationship|friend|colleague|partner|family", re.I),
    "temporal": re.compile(r"最初|以前|原来|后来|随后|目前|现在|如今|最新|最终|改为|变成|不再|取消|恢复|before|after|currently|latest|finally", re.I),
    "governance": re.compile(r"忘掉|遗忘|删除|清除|撤回|更正|纠正|不是.+是|改为|取代|覆盖|保留|归档|恢复|forget|delete|remove|correct|replace|archive|restore", re.I),
    "procedure": re.compile(r"必须|应该|需要|不得|禁止|允许|步骤|流程|规则|如果|否则|然后|先.+再|must|should|required|never|allowed|step|rule|if.+then", re.I),
    "privacy": re.compile(r"隐私|私人|敏感|秘密|凭证|密码|令牌|授权|越权|披露|公开|拒绝|最小披露|privacy|private|sensitive|secret|credential|token|permission|disclos|refuse", re.I),
    "causal": re.compile(r"因为|由于|所以|因此|导致|使得|为了|通过|从而|原因|结果|because|therefore|caused|resulted|so that", re.I),
}
CURRENT_MARKERS = re.compile(r"目前|现在|如今|最新|最终|后来|改为|变成|不再|取消|恢复|current|latest|final|now", re.I)
HISTORICAL_MARKERS = re.compile(r"最初|以前|原来|曾经|起初|之前|old|former|initially|before", re.I)
FORGET_MARKERS = re.compile(r"忘掉|遗忘|删除|清除|不要记得|不要再记|forget|delete|remove", re.I)
GENERIC_TERMS = {"我们", "这个", "那个", "什么", "怎么", "怎样", "可以", "已经", "还是", "一个", "没有", "用户", "助手", "the", "and", "that", "with"}
DATE_PATTERN = re.compile(r"(?:20\d{2}[年./-]\d{1,2}(?:[月./-]\d{1,2}日?)?|\d{1,2}月\d{1,2}日|(?:今天|昨天|前天|明天|后天|上周|下周|本周|去年|今年|明年))")


def _keyword_terms(text: str) -> list[str]:
    """Extract deterministic literal terms without calling a generative model."""
    latin = [word.casefold() for word in re.findall(r"[A-Za-z0-9_]+", str(text))]
    cjk_chunks = re.findall(r"[\u3400-\u9fff]+", str(text))
    cjk = []
    for chunk in cjk_chunks:
        if len(chunk) == 1:
            cjk.append(chunk)
        else:
            cjk.extend(chunk[index:index + 2] for index in range(len(chunk) - 1))
    return list(dict.fromkeys([*latin, *cjk]))


def _signals(text: str) -> list[str]:
    return [name for name, pattern in SIGNAL_PATTERNS.items() if pattern.search(str(text))]


def _salient_terms(text: str) -> list[str]:
    return [term for term in _keyword_terms(text) if term not in GENERIC_TERMS][:64]


def _time_value(value: object) -> float:
    """Normalize millisecond/second epochs and ISO values for real ordering."""
    if isinstance(value, (int, float)):
        number = float(value)
        return number / 1000 if number > 10_000_000_000 else number
    text = str(value or "").strip()
    if not text:
        return 0.0
    try:
        number = float(text)
        return number / 1000 if number > 10_000_000_000 else number
    except ValueError:
        pass
    try:
        from datetime import datetime
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


class AMLEmbedder(Protocol):
    @property
    def identity(self) -> str: ...

    def passages(self, texts: list[str], batch_size: int) -> list[Iterable[float]]: ...

    def query(self, text: str) -> Iterable[float]: ...


def _vector(value: Iterable[float]) -> list[float]:
    return [round(float(item), 6) for item in value]


def _cosine(left: list[float], right: list[float]) -> float:
    if len(left) != len(right):
        raise ValueError("embedding dimensions do not match")
    denominator = math.sqrt(sum(item * item for item in left)) * math.sqrt(sum(item * item for item in right))
    if denominator <= 1e-12:
        return 0.0
    return sum(a * b for a, b in zip(left, right, strict=True)) / denominator


def _atomic(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


class AMLAdapter:
    """Isolated Add/Search contract for AML evaluation traffic."""

    def __init__(self, root: str | Path, embedder: AMLEmbedder | None = None, batch_size: int = 4,
                 diagnostic_log: str | Path | None = None):
        self.root = Path(root)
        self.embedder = embedder
        self.batch_size = max(1, int(batch_size))
        self.lock = threading.RLock()
        # FastEmbed/ONNX may create worker processes per call. The leaderboard
        # sends concurrent users, so user-level locks alone are insufficient:
        # serialize model access while keeping file and keyword work concurrent.
        self.embed_lock = threading.Lock()
        # Accept concurrent clients while bounding full-store jobs in memory.
        self.workload_slots = threading.BoundedSemaphore(2)
        self.diagnostic_log = Path(diagnostic_log) if diagnostic_log else None
        self.user_locks: dict[str, threading.RLock] = {}

    def _audit_search(self, body: dict, user_id: str, ranked: list[tuple]) -> None:
        if not self.diagnostic_log:
            return
        record = {
            "at": time.time(), "user_hash": hashlib.sha256(user_id.encode()).hexdigest()[:16],
            "query": str(body.get("query") or "")[:4000],
            "options": [str(item)[:1000] for item in list(body.get("options") or [])[:20]],
            "top_k": int(body.get("top_k") or 0),
            "results": [{"id": row["id"], "score": round(float(score), 6), **components}
                        for score, _semantic, _lexical, row, components in ranked[:100]],
        }
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
        with self.lock:
            self.diagnostic_log.parent.mkdir(parents=True, exist_ok=True)
            if self.diagnostic_log.exists() and self.diagnostic_log.stat().st_size > 20 * 1024 * 1024:
                os.replace(self.diagnostic_log, self.diagnostic_log.with_suffix(".previous.jsonl"))
            with self.diagnostic_log.open("a", encoding="utf-8") as handle:
                handle.write(line)

    def _user_lock(self, user_id: str) -> threading.RLock:
        with self.lock:
            return self.user_locks.setdefault(user_id, threading.RLock())

    def _file(self, user_id: str) -> Path:
        digest = hashlib.sha256(user_id.encode()).hexdigest()
        return self.root / f"{digest}.json"

    def _read(self, user_id: str) -> dict:
        path = self._file(user_id)
        if not path.exists():
            return {"version": 1, "user_id": user_id, "requests": [], "memories": []}
        value = json.loads(path.read_text(encoding="utf-8"))
        if value.get("user_id") != user_id:
            raise ValueError("user isolation mismatch")
        return value

    def _ensure_vectors(self, data: dict) -> bool:
        if not self.embedder:
            return False
        memories = data["memories"]
        rebuild = data.get("embedder") != self.embedder.identity
        pending = memories if rebuild else [row for row in memories if not isinstance(row.get("vector"), list)]
        for start in range(0, len(pending), self.batch_size):
            chunk = pending[start:start + self.batch_size]
            with self.embed_lock:
                vectors = self.embedder.passages([row["content"] for row in chunk], self.batch_size)
            if len(vectors) != len(chunk):
                raise ValueError("embedder returned an unexpected number of vectors")
            for row, vector in zip(chunk, vectors, strict=True):
                row["vector"] = _vector(vector)
        if rebuild or pending:
            data["embedder"] = self.embedder.identity
            return True
        return False

    def _ensure_keywords(self, data: dict) -> bool:
        memories = data["memories"]
        rebuild = data.get("keyword_schema") != KEYWORD_SCHEMA
        pending = memories if rebuild else [
            row for row in memories
            if not isinstance(row.get("intrinsic_keywords"), list)
            or not isinstance(row.get("auxiliary_terms"), list)
        ]
        if not pending:
            return False

        targets = memories if rebuild else pending
        context_terms: dict[str, list[str]] = {}
        for row in targets:
            context_id = str(row.get("request_id") or row.get("session_id") or "")
            own_terms = _keyword_terms(row.get("content") or "")[:MAX_INTRINSIC_KEYWORDS]
            row["intrinsic_keywords"] = own_terms
            context_terms.setdefault(context_id, []).extend(own_terms)

        for row in targets:
            own = set(row["intrinsic_keywords"])
            context_id = str(row.get("request_id") or row.get("session_id") or "")
            context = context_terms.get(context_id, [])
            row["auxiliary_terms"] = [
                term for term in dict.fromkeys(context) if term not in own
            ][:MAX_AUXILIARY_TERMS]
        data["keyword_schema"] = KEYWORD_SCHEMA
        return True

    def _ensure_structure(self, data: dict) -> bool:
        memories = data["memories"]
        rebuild = data.get("structure_schema") != STRUCTURE_SCHEMA
        pending = memories if rebuild else [row for row in memories if not isinstance(row.get("signals"), list)]
        if not pending:
            return False
        for row in pending:
            content = str(row.get("content") or "")
            row["signals"] = _signals(content)
            row["salient_terms"] = _salient_terms(content)
            row["temporal_facts"] = DATE_PATTERN.findall(content)[:16]
            row["time_value"] = _time_value(row.get("timestamp"))
            row.setdefault("state", "active")
        data["structure_schema"] = STRUCTURE_SCHEMA
        return True

    def _apply_forgetting(self, data: dict, new_rows: list[dict]) -> bool:
        changed = False
        for command in new_rows:
            content = str(command.get("content") or "")
            if command.get("role") != "user" or not FORGET_MARKERS.search(content):
                continue
            target_terms = set(_salient_terms(FORGET_MARKERS.sub("", content)))
            if not target_terms:
                continue
            for row in data["memories"]:
                if row is command or row.get("state", "active") != "active":
                    continue
                overlap = target_terms & set(row.get("salient_terms") or _salient_terms(row.get("content") or ""))
                if len(overlap) >= min(2, len(target_terms)):
                    row["state"] = "forgotten"
                    row["forgotten_by"] = command["id"]
                    changed = True
        return changed

    def add(self, body: dict) -> dict:
        with self.workload_slots:
            return self._add(body)

    def _add(self, body: dict) -> dict:
        request_id = str(body.get("request_id") or "").strip()
        user_id = str(body.get("user_id") or "").strip()
        session_id = str(body.get("session_id") or "").strip()
        messages = body.get("messages")
        if not request_id or not user_id or not session_id or not isinstance(messages, list) or not messages:
            raise ValueError("request_id, user_id, session_id, and non-empty messages are required")
        normalized = []
        for index, message in enumerate(messages):
            role = str(message.get("role") or "")
            content = message.get("content")
            if role not in {"user", "assistant"} or not isinstance(content, str) or not content:
                raise ValueError("each message requires role=user|assistant and non-empty string content")
            stable = hashlib.sha256(f"{request_id}:{index}".encode()).hexdigest()[:24]
            normalized.append({"id": f"aml_{stable}", "session_id": session_id, "role": role,
                               "content": content, "timestamp": message.get("timestamp"), "order": index,
                               "request_id": request_id})
        with self._user_lock(user_id):
            data = self._read(user_id)
            if request_id not in data["requests"]:
                data["memories"].extend(normalized)
                data["requests"].append(request_id)
                self._ensure_keywords(data)
                self._ensure_structure(data)
                self._apply_forgetting(data, normalized)
                ensure_shadow_graph(data)
                self._ensure_vectors(data)
                _atomic(self._file(user_id), data)
        return {"success": True, "request_id": request_id, "user_id": user_id, "session_id": session_id}

    def search(self, body: dict) -> dict:
        with self.workload_slots:
            return self._search(body)

    def _search(self, body: dict) -> dict:
        query = body.get("query")
        user_id = str(body.get("user_id") or "").strip()
        top_k = int(body.get("top_k") or 0)
        if not isinstance(query, str) or not query.strip() or not user_id or not 1 <= top_k <= 100:
            raise ValueError("query, user_id, and top_k between 1 and 100 are required")
        def terms(text: str) -> tuple[list[str], list[str]]:
            cjk = "".join(re.findall(r"[\u3400-\u9fff]", text))
            return _keyword_terms(text), list(dict.fromkeys(cjk))
        words, characters = terms(query)
        options = [str(item) for item in body.get("options") or []]
        option_terms = [terms(item) for item in options]
        option_words = [word for words_in_option, _ in option_terms for word in words_in_option]
        option_characters = [character for _, characters_in_option in option_terms for character in characters_in_option]
        planned_queries = expand_query("\n".join([query, *options]))
        planned_terms = [terms(item) for item in planned_queries]
        planned_words = [word for words_in_plan, _ in planned_terms for word in words_in_plan]
        query_signals = set(_signals("\n".join([query, *options])))
        with self._user_lock(user_id):
            data = self._read(user_id)
            changed = self._ensure_keywords(data)
            changed = self._ensure_structure(data) or changed
            changed = ensure_shadow_graph(data) or changed
            if self._ensure_vectors(data) or changed:
                _atomic(self._file(user_id), data)
        semantic_queries = []
        if self.embedder and data.get("embedder") == self.embedder.identity:
            original = "\n".join([query, *options])
            with self.embed_lock:
                semantic_queries = [_vector(self.embedder.query(original))]
                semantic_queries.extend(_vector(self.embedder.query(item)) for item in expand_query(original))
        active_memories = [row for row in data["memories"] if row.get("state", "active") == "active"]
        scored = []
        timestamps = sorted({float(row.get("time_value") or _time_value(row.get("timestamp"))) for row in active_memories})
        timestamp_rank = {value: index / max(1, len(timestamps) - 1) for index, value in enumerate(timestamps)}
        wants_current = bool(re.search(r"现在|目前|如今|最终|最后|后来|最新|current|latest|final", query, re.I))
        wants_time = bool(re.search(r"何时|什么时候|哪天|日期|多久|几天|间隔|先后|顺序|之前|之后|when|date|how long|before|after", query, re.I))
        asks_name = bool(re.search(r"称呼|叫什么|名字|called|name", query, re.I))
        query_word_set = set([*words, *option_words, *planned_words])
        document_frequency: dict[str, int] = {}
        for row in active_memories:
            for term in set(row.get("salient_terms") or []):
                document_frequency[term] = document_frequency.get(term, 0) + 1
        seed_terms = set()
        for row in active_memories:
            row_terms = set(row.get("salient_terms") or [])
            if query_word_set & row_terms:
                seed_terms.update(term for term in row_terms if term not in GENERIC_TERMS)
        rare_bridges = {term for term in seed_terms
                        if document_frequency.get(term, 0) <= max(3, len(active_memories) // 8)}
        for row in active_memories:
            content = row["content"].casefold()
            intrinsic_keywords = set(row.get("intrinsic_keywords") or [])
            auxiliary_terms = set(row.get("auxiliary_terms") or [])
            all_query_words = query_word_set
            direct = sum(2 for word in words if word in content)
            option = sum(1 for word in option_words if word in content)
            planned = sum(1 for word in planned_words if word in content)
            intrinsic = len(all_query_words & intrinsic_keywords)
            auxiliary = len(all_query_words & auxiliary_terms)
            row_signals = set(row.get("signals") or [])
            signal_overlap = len(query_signals & row_signals)
            bridge_overlap = len(rare_bridges & set(row.get("salient_terms") or []))
            rare_exact = sum(1 for term in query_word_set & intrinsic_keywords
                             if document_frequency.get(term, 0) <= max(2, len(active_memories) // 10))
            character_overlap = sum(0.2 for character in characters if character in content)
            option_character_overlap = sum(0.1 for character in option_characters if character in content)
            lexical = direct + option + character_overlap + option_character_overlap + intrinsic
            semantic = None
            if semantic_queries and isinstance(row.get("vector"), list):
                vector = _vector(row["vector"])
                original_semantic = _cosine(vector, semantic_queries[0])
                expanded_semantic = max((_cosine(vector, item) for item in semantic_queries[1:]),
                                        default=original_semantic)
                semantic = original_semantic * 0.7 + expanded_semantic * 0.3
            if lexical or auxiliary or signal_overlap or bridge_overlap or semantic is not None:
                time_value = float(row.get("time_value") or _time_value(row.get("timestamp")))
                recency = timestamp_rank.get(time_value, 0.0) * 0.35 if wants_current else 0.0
                naming = 0.08 if asks_name and re.search(r"称|叫|名字|called|named", content, re.I) else 0.0
                temporal = (0.35 if wants_current and CURRENT_MARKERS.search(content) else 0.0)
                temporal -= 0.30 if wants_current and HISTORICAL_MARKERS.search(content) and not CURRENT_MARKERS.search(content) else 0.0
                temporal += 0.20 if wants_time and row.get("temporal_facts") else 0.0
                causal = 0.22 if "causal" in query_signals and "causal" in row_signals else 0.0
                combined = ((semantic or 0.0) + min(lexical, 4) * 0.08
                            + min(planned, 6) * 0.03 + min(auxiliary, 4) * 0.035
                            + min(signal_overlap, 2) * 0.09 + min(bridge_overlap, 3) * 0.025
                            + min(rare_exact, 3) * 0.12 + recency + naming + temporal + causal)
                components = {
                    "semantic": round(float(semantic or 0.0), 6), "lexical": round(float(lexical), 6),
                    "planned": planned, "auxiliary": auxiliary, "signal_overlap": signal_overlap,
                    "bridge_overlap": bridge_overlap, "rare_exact": rare_exact,
                    "recency": round(recency, 6), "temporal": round(temporal, 6),
                    "causal": round(causal, 6), "naming": round(naming, 6),
                }
                scored.append((combined, semantic, lexical, row, components))
        base_scores = {row["id"]: score for score, _semantic, _lexical, row, _components in scored}
        graph = graph_bonuses(data, base_scores, query)
        scored = [(score + float(graph.get(row["id"], {}).get("bonus", 0.0)), semantic, lexical, row,
                   {**components, "graph_bonus": round(float(graph.get(row["id"], {}).get("bonus", 0.0)), 6),
                    "graph_relations": list(dict.fromkeys(graph.get(row["id"], {}).get("relations", [])))})
                  for score, semantic, lexical, row, components in scored]
        scored.sort(key=lambda item: (item[0], item[2], float(item[3].get("time_value") or 0), item[3]["order"]), reverse=True)
        self._audit_search(body, user_id, scored)
        maximum = max([max(score, 0.0) for score, *_ in scored], default=1.0) or 1.0
        return {"data": [{"id": row["id"], "content": row["content"], "score": max(score, 0.0) / maximum,
                           **({"created_at": row["timestamp"]} if row.get("timestamp") is not None else {})}
                          for score, _semantic, _lexical, row, _components in scored[:top_k]]}
