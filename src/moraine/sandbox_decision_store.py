from __future__ import annotations

import json
import os
import stat
import tempfile
from contextlib import contextmanager
from copy import deepcopy
from fcntl import LOCK_EX, LOCK_UN, flock
from pathlib import Path
from typing import Mapping

from .decision_ledger import canonical_json, memory_fingerprint, relation_fingerprint


def _text(value: object) -> str:
    return str(value or "").strip()


def _vault_key(ref: Mapping[str, object]) -> str:
    return "|".join((_text(ref.get("id")), _text(ref.get("version")), _text(ref.get("fingerprint"))))


class SandboxJsonAdapter:
    """Single-file decision store for synthetic or redacted sandbox records only."""

    SCHEMA = 1
    MODE = "sandbox"

    def __init__(self, path: str | Path, workspace: str):
        self.path = Path(path)
        self.workspace = _text(workspace)
        if not self.workspace:
            raise ValueError("workspace is required")
        self._load()

    @classmethod
    def create(
        cls,
        path: str | Path,
        workspace: str,
        memories: list[Mapping[str, object]] | None = None,
    ) -> "SandboxJsonAdapter":
        target = Path(path)
        if target.exists() or target.is_symlink():
            raise FileExistsError(target)
        selected_workspace = _text(workspace)
        if not selected_workspace:
            raise ValueError("workspace is required")
        rows: dict[str, dict] = {}
        vault: dict[str, dict] = {}
        for raw in memories or []:
            row = deepcopy(dict(raw))
            memory_id = _text(row.get("id"))
            if not memory_id:
                raise ValueError("every memory must have an id")
            if memory_id in rows:
                raise ValueError("duplicate memory id")
            if _text(row.get("workspace")) != selected_workspace:
                raise ValueError("memory workspace mismatch")
            row["fingerprint"] = memory_fingerprint(row)
            rows[memory_id] = row
            ref = cls._memory_ref(row)
            vault[_vault_key(ref)] = deepcopy(row)
        cls._write_file(target, {
            "schema": cls.SCHEMA,
            "mode": cls.MODE,
            "workspace": selected_workspace,
            "memories": rows,
            "relations": {},
            "receipts": {},
            "vault": vault,
        })
        return cls(target, selected_workspace)

    @staticmethod
    def _memory_ref(row: Mapping[str, object]) -> dict:
        return {
            "id": _text(row.get("id")),
            "version": _text(row.get("version")),
            "status": _text(row.get("status")),
            "kind": _text(row.get("kind")),
            "workspace": _text(row.get("workspace")),
            "fingerprint": memory_fingerprint(row),
        }

    @staticmethod
    def _write_file(path: Path, payload: Mapping[str, object]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(canonical_json(payload))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
            os.chmod(path, 0o600)
            directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except Exception:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
            raise

    def _load(self) -> dict:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        try:
            fd = os.open(self.path, flags)
        except OSError as error:
            if self.path.is_symlink():
                raise ValueError("sandbox store must be a regular file") from error
            raise
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode):
                raise ValueError("sandbox store must be a regular file")
            if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
                raise PermissionError("sandbox store must be owner-only")
            with os.fdopen(fd, "r", encoding="utf-8") as handle:
                fd = -1
                payload = json.load(handle)
        finally:
            if fd >= 0:
                os.close(fd)
        if payload.get("schema") != self.SCHEMA or payload.get("mode") != self.MODE:
            raise ValueError("unsupported sandbox decision store")
        if _text(payload.get("workspace")) != self.workspace:
            raise ValueError("sandbox workspace mismatch")
        return payload

    @contextmanager
    def _exclusive(self):
        lock_path = self.path.with_suffix(self.path.suffix + ".lock")
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(lock_path, flags, 0o600)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
                raise PermissionError("sandbox lock must be an owner-controlled regular file")
            if stat.S_IMODE(info.st_mode) & 0o077:
                raise PermissionError("sandbox lock must be owner-only")
            flock(fd, LOCK_EX)
            yield
        finally:
            flock(fd, LOCK_UN)
            os.close(fd)

    def get_memory(self, memory_id: str) -> dict | None:
        row = self._load()["memories"].get(_text(memory_id))
        return deepcopy(row) if row is not None else None

    def get_relation(self, relation_id: str) -> dict | None:
        row = self._load()["relations"].get(_text(relation_id))
        return deepcopy(row) if row is not None else None

    def get_receipt(self, operation_id: str) -> dict | None:
        row = self._load()["receipts"].get(_text(operation_id))
        return deepcopy(row) if row is not None else None

    def find_revert(self, operation_id: str) -> dict | None:
        for row in self._load()["receipts"].values():
            if row.get("receipt_type") == "revert" and row.get("revert_of") == operation_id:
                return deepcopy(row)
        return None

    def restore_snapshot(self, ref: Mapping[str, object]) -> dict | None:
        row = self._load()["vault"].get(_vault_key(ref))
        return deepcopy(row) if row is not None else None

    @staticmethod
    def _before_matches(memories: Mapping[str, dict], ref: Mapping[str, object]) -> bool:
        current = memories.get(_text(ref.get("id")))
        return bool(current) and all((
            _text(current.get("workspace")) == _text(ref.get("workspace")),
            _text(current.get("version")) == _text(ref.get("version")),
            memory_fingerprint(current) == _text(ref.get("fingerprint")),
        ))

    def commit(self, *, writes: list[dict], relations: list[dict], receipt: dict) -> None:
        with self._exclusive():
            self._commit_locked(writes=writes, relations=relations, receipt=receipt)

    def _commit_locked(self, *, writes: list[dict], relations: list[dict], receipt: dict) -> None:
        state = self._load()
        memories = state["memories"]
        current_relations = state["relations"]
        receipts = state["receipts"]
        key = receipt["operation_id"] if receipt.get("receipt_type") == "execution" else receipt.get("revert_id")
        if not key:
            raise ValueError("receipt id is required")
        existing = receipts.get(key)
        if existing is not None:
            same = (
                existing.get("receipt_type") == receipt.get("receipt_type")
                and existing.get("draft_fingerprint", existing.get("revert_of"))
                == receipt.get("draft_fingerprint", receipt.get("revert_of"))
            )
            if same:
                return
            raise ValueError("receipt already exists")

        for write in writes:
            before_ref = write.get("before_ref")
            after_id = _text((write.get("after") or {}).get("id") or write.get("id"))
            if before_ref and not self._before_matches(memories, before_ref):
                raise ValueError("before_ref no longer matches current memory")
            if not before_ref and after_id in memories:
                raise ValueError("create target id already exists")
        for relation in relations:
            expected = _text(relation.get("expected_fingerprint"))
            if expected:
                current = current_relations.get(_text(relation.get("id")))
                if current is None or relation_fingerprint(current) != expected:
                    raise ValueError("relation fingerprint no longer matches")

        next_state = deepcopy(state)
        for write in writes:
            before = write.get("before")
            after = deepcopy(write["after"])
            after["fingerprint"] = memory_fingerprint(after)
            after["last_operation_id"] = write["operation_id"]
            next_state["memories"][_text(after["id"])] = after
            for snapshot in (before, after):
                if snapshot:
                    ref = self._memory_ref(snapshot)
                    next_state["vault"][_vault_key(ref)] = deepcopy(snapshot)
        for relation in relations:
            row = deepcopy(relation)
            row.pop("expected_fingerprint", None)
            row["fingerprint"] = relation_fingerprint(row)
            next_state["relations"][_text(row["id"])] = row
        next_state["receipts"][key] = deepcopy(receipt)
        self._write_file(self.path, next_state)
