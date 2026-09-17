from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Mapping


class ReviewStore:
    """Local proposal queue. It stores governance metadata, never memory content."""

    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _read(self) -> dict:
        if not self.path.exists():
            return {"schema": 1, "proposals": []}
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        if payload.get("schema") != 1 or not isinstance(payload.get("proposals"), list):
            raise ValueError("unsupported review store")
        return payload

    def _write(self, payload: Mapping[str, object]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd, temporary = tempfile.mkstemp(prefix=f".{self.path.name}.", dir=self.path.parent)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
            os.chmod(self.path, 0o600)
        except Exception:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
            raise

    @staticmethod
    def _safe(proposal: Mapping[str, object]) -> dict:
        allowed = {"proposal_id", "memory_id", "expected_version", "from_strength", "to_strength",
                   "lock", "reason", "proposed_by", "high_impact", "requires_second_key",
                   "signatures", "status", "persisted"}
        forbidden = {"content", "body", "preview", "rollback_record", "memory"}
        if forbidden.intersection(proposal):
            raise ValueError("proposal contains forbidden memory data")
        safe = {key: proposal[key] for key in allowed if key in proposal}
        if not safe.get("proposal_id") or not safe.get("memory_id"):
            raise ValueError("proposal_id and memory_id are required")
        return safe

    def put(self, proposal: Mapping[str, object]) -> dict:
        safe = self._safe(proposal)
        payload = self._read()
        rows = [row for row in payload["proposals"] if row.get("proposal_id") != safe["proposal_id"]]
        rows.append(safe)
        self._write({"schema": 1, "proposals": rows})
        return dict(safe)

    def list(self, *, status: str | None = None) -> list[dict]:
        rows = self._read()["proposals"]
        return [dict(row) for row in rows if status is None or row.get("status") == status]

    def get(self, proposal_id: str) -> dict | None:
        return next((row for row in self.list() if row.get("proposal_id") == proposal_id), None)

    def remove(self, proposal_id: str) -> bool:
        payload = self._read()
        rows = [row for row in payload["proposals"] if row.get("proposal_id") != proposal_id]
        if len(rows) == len(payload["proposals"]):
            return False
        self._write({"schema": 1, "proposals": rows})
        return True
