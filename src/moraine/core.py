from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from pathlib import Path
from typing import Protocol

import numpy as np

from .temporal import is_current


class MemorySource(Protocol):
    def load(self) -> list[dict]: ...


class Embedder(Protocol):
    @property
    def identity(self) -> str: ...

    def passages(self, texts: list[str], batch_size: int) -> list[np.ndarray]: ...

    def query(self, text: str) -> np.ndarray: ...


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(temporary, path)


def document(memory: dict, max_text: int = 12000) -> str:
    tags = " ".join(str(tag) for tag in memory.get("tags") or [])
    return (
        f"Title: {memory.get('title', '')}\n"
        f"Kind: {memory.get('kind', '')}\n"
        f"Tags: {tags}\n"
        f"Content: {memory.get('content', '')}"
    )[:max_text]


CURRENT_FINGERPRINT_SCHEMA = 2
_FINGERPRINT_FIELDS = ("id", "title", "kind", "tags", "content")
_LEGACY_FINGERPRINT_FIELDS = ("id", "title", "kind", "state", "importance", "tags", "content", "updated_at")


def _digest(memory: dict, keys: tuple[str, ...]) -> str:
    selected = {key: memory.get(key) for key in keys}
    body = json.dumps(selected, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode()).hexdigest()


def fingerprint(memory: dict) -> str:
    return _digest(memory, _FINGERPRINT_FIELDS)


def legacy_fingerprint(memory: dict) -> str:
    return _digest(memory, _LEGACY_FINGERPRINT_FIELDS)


class LocalIndex:
    def __init__(self, source: MemorySource, embedder: Embedder, index_file: str | Path, batch_size: int = 4):
        self.source = source
        self.embedder = embedder
        self.index_file = Path(index_file)
        self.batch_size = max(1, int(batch_size))
        self.lock = threading.RLock()
        self.refresh_lock = threading.Lock()
        self.records: dict[str, dict] = {}
        self.last_refresh: str | None = None
        self.last_error: str | None = None
        self.refreshing = False
        self.fingerprint_schema_version = CURRENT_FINGERPRINT_SCHEMA
        self.unsupported_fingerprint_schema = False
        self._load()

    def _load(self) -> None:
        self.fingerprint_schema_version = CURRENT_FINGERPRINT_SCHEMA
        self.unsupported_fingerprint_schema = False
        if not self.index_file.exists():
            return
        payload = json.loads(self.index_file.read_text(encoding="utf-8"))
        if payload.get("embedder") != self.embedder.identity:
            return
        schema = int(payload.get("fingerprint_schema_version", 1))
        self.fingerprint_schema_version = schema
        if schema > CURRENT_FINGERPRINT_SCHEMA:
            self.unsupported_fingerprint_schema = True
            return
        self.records = dict(payload.get("records") or {})
        self.last_refresh = payload.get("updated_at")

    def _save(self) -> None:
        atomic_json(
            self.index_file,
            {
                "version": 1,
                "fingerprint_schema_version": self.fingerprint_schema_version,
                "embedder": self.embedder.identity,
                "updated_at": self.last_refresh,
                "records": self.records,
            },
        )

    def refresh(self) -> dict:
        if self.unsupported_fingerprint_schema:
            return {"accepted": False, "reason": "unsupported_fingerprint_schema"}
        if not self.refresh_lock.acquire(blocking=False):
            return {"accepted": False, "reason": "already_refreshing"}
        self.refreshing = True
        try:
            rows = []
            refresh_now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            for raw in self.source.load():
                row = dict(raw)
                if "id" not in row:
                    raise ValueError("every memory must have an id")
                if not is_current(row, refresh_now):
                    continue
                row["id"] = str(row["id"])
                rows.append(row)

            active_ids = {row["id"] for row in rows}
            next_records = {key: value for key, value in self.records.items() if key in active_ids}
            allow_legacy = self.fingerprint_schema_version < CURRENT_FINGERPRINT_SCHEMA
            changed = []
            for row in rows:
                digest = fingerprint(row)
                stored = self.records.get(row["id"], {}).get("fingerprint")
                if stored == digest:
                    continue
                if allow_legacy and stored and stored == legacy_fingerprint(row):
                    next_records[row["id"]] = {**next_records[row["id"]], "fingerprint": digest}
                    continue
                changed.append((row, digest))

            for start in range(0, len(changed), self.batch_size):
                chunk = changed[start : start + self.batch_size]
                vectors = self.embedder.passages([document(row) for row, _ in chunk], self.batch_size)
                for (row, digest), vector in zip(chunk, vectors, strict=True):
                    next_records[row["id"]] = {
                        "fingerprint": digest,
                        "title": str(row.get("title", "")),
                        "vector": np.asarray(vector, dtype=np.float32).tolist(),
                    }
                with self.lock:
                    self.records = dict(next_records)
                    self._save()

            with self.lock:
                self.records = next_records
                self.last_refresh = refresh_now
                self.last_error = None
                self.fingerprint_schema_version = CURRENT_FINGERPRINT_SCHEMA
                self._save()
            return {"accepted": True, "indexed": len(next_records), "changed": len(changed)}
        except Exception as error:
            self.last_error = f"{type(error).__name__}: {error}"
            raise
        finally:
            self.refreshing = False
            self.refresh_lock.release()

    def search(self, query: str, limit: int = 20) -> list[dict]:
        query = str(query).strip()[:12000]
        if not query:
            raise ValueError("query is required")
        vector = np.asarray(self.embedder.query(query), dtype=np.float32)
        with self.lock:
            rows = list(self.records.items())
        if not rows:
            return []
        matrix = np.asarray([row[1]["vector"] for row in rows], dtype=np.float32)
        denominator = np.maximum(np.linalg.norm(matrix, axis=1) * float(np.linalg.norm(vector)), 1e-12)
        scores = (matrix @ vector) / denominator
        count = max(1, min(int(limit), 100))
        order = np.argsort(-scores)[:count]
        return [
            {"id": rows[index][0], "title": rows[index][1]["title"], "score": float(scores[index])}
            for index in order
        ]

    def health(self) -> dict:
        with self.lock:
            return {
                "ok": self.last_error is None,
                "service": "moraine",
                "embedder": self.embedder.identity,
                "indexed": len(self.records),
                "refreshing": self.refreshing,
                "last_refresh": self.last_refresh,
                "last_error": self.last_error,
            }
