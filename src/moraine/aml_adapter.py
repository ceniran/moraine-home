from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
from pathlib import Path
from typing import Iterable, Protocol

from .query_planner import expand_query


class AMLEmbedder(Protocol):
    @property
    def identity(self) -> str: ...

    def passages(self, texts: list[str], batch_size: int) -> list[Iterable[float]]: ...

    def query(self, text: str) -> Iterable[float]: ...


def _vector(value: Iterable[float]) -> list[float]:
    return [float(item) for item in value]


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

    def __init__(self, root: str | Path, embedder: AMLEmbedder | None = None, batch_size: int = 4):
        self.root = Path(root)
        self.embedder = embedder
        self.batch_size = max(1, int(batch_size))
        self.lock = threading.RLock()

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
            vectors = self.embedder.passages([row["content"] for row in chunk], self.batch_size)
            if len(vectors) != len(chunk):
                raise ValueError("embedder returned an unexpected number of vectors")
            for row, vector in zip(chunk, vectors, strict=True):
                row["vector"] = _vector(vector)
        if rebuild or pending:
            data["embedder"] = self.embedder.identity
            return True
        return False

    def add(self, body: dict) -> dict:
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
                               "content": content, "timestamp": message.get("timestamp"), "order": index})
        with self.lock:
            data = self._read(user_id)
            if request_id not in data["requests"]:
                data["memories"].extend(normalized)
                data["requests"].append(request_id)
                self._ensure_vectors(data)
                _atomic(self._file(user_id), data)
        return {"success": True, "request_id": request_id, "user_id": user_id, "session_id": session_id}

    def search(self, body: dict) -> dict:
        query = body.get("query")
        user_id = str(body.get("user_id") or "").strip()
        top_k = int(body.get("top_k") or 0)
        if not isinstance(query, str) or not query.strip() or not user_id or not 1 <= top_k <= 100:
            raise ValueError("query, user_id, and top_k between 1 and 100 are required")
        def terms(text: str) -> tuple[list[str], list[str]]:
            latin = [word.casefold() for word in re.findall(r"[A-Za-z0-9_]+", text)]
            cjk = "".join(re.findall(r"[\u3400-\u9fff]", text))
            pairs = [cjk] if len(cjk) == 1 else [cjk[index:index + 2] for index in range(len(cjk) - 1)]
            return latin + pairs, list(dict.fromkeys(cjk))
        words, characters = terms(query)
        options = [str(item) for item in body.get("options") or []]
        option_terms = [terms(item) for item in options]
        option_words = [word for words_in_option, _ in option_terms for word in words_in_option]
        option_characters = [character for _, characters_in_option in option_terms for character in characters_in_option]
        planned_queries = expand_query("\n".join([query, *options]))
        planned_terms = [terms(item) for item in planned_queries]
        planned_words = [word for words_in_plan, _ in planned_terms for word in words_in_plan]
        with self.lock:
            data = self._read(user_id)
            if self._ensure_vectors(data):
                _atomic(self._file(user_id), data)
        semantic_queries = []
        if self.embedder and data.get("embedder") == self.embedder.identity:
            original = "\n".join([query, *options])
            semantic_queries = [_vector(self.embedder.query(original))]
            semantic_queries.extend(_vector(self.embedder.query(item)) for item in expand_query(original))
        scored = []
        timestamps = sorted({str(row.get("timestamp") or "") for row in data["memories"]})
        timestamp_rank = {value: index / max(1, len(timestamps) - 1) for index, value in enumerate(timestamps)}
        wants_current = bool(re.search(r"现在|目前|如今|最终|最后|后来|最新|current|latest|final", query, re.I))
        asks_name = bool(re.search(r"称呼|叫什么|名字|called|name", query, re.I))
        for row in data["memories"]:
            content = row["content"].casefold()
            direct = sum(2 for word in words if word in content)
            option = sum(1 for word in option_words if word in content)
            planned = sum(1 for word in planned_words if word in content)
            character_overlap = sum(0.2 for character in characters if character in content)
            option_character_overlap = sum(0.1 for character in option_characters if character in content)
            lexical = direct + option + character_overlap + option_character_overlap
            semantic = None
            if semantic_queries and isinstance(row.get("vector"), list):
                vector = _vector(row["vector"])
                original_semantic = _cosine(vector, semantic_queries[0])
                expanded_semantic = max((_cosine(vector, item) for item in semantic_queries[1:]),
                                        default=original_semantic)
                semantic = original_semantic * 0.7 + expanded_semantic * 0.3
            if lexical or semantic is not None:
                recency = timestamp_rank[str(row.get("timestamp") or "")] * 0.15 if wants_current else 0.0
                naming = 0.08 if asks_name and re.search(r"称|叫|名字|called|named", content, re.I) else 0.0
                combined = ((semantic or 0.0) + min(lexical, 4) * 0.08
                            + min(planned, 6) * 0.02 + recency + naming)
                scored.append((combined, semantic, lexical, row))
        scored.sort(key=lambda item: (item[0], item[2], str(item[3].get("timestamp") or ""), item[3]["order"]), reverse=True)
        maximum = max([max(score, 0.0) for score, *_ in scored], default=1.0) or 1.0
        return {"data": [{"id": row["id"], "content": row["content"], "score": max(score, 0.0) / maximum,
                           **({"created_at": row["timestamp"]} if isinstance(row.get("timestamp"), str) else {})}
                          for score, _semantic, _lexical, row in scored[:top_k]]}
