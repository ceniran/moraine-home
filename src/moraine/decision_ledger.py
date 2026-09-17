"""Reversible reviewed-decision plans and immutable receipts.

Design borrowed from Memloom (Apache-2.0), not copied:
- packages/core/src/resolve.ts ``reactivateIfUntouched``
- packages/core/src/reconcile.ts apply/revert split and restored/skipped
- versioning.test.ts / reconcile.test.ts keep_* and stale-restore rules

Receipts store version references only. Full snapshots stay in the adapter's
recovery vault, not the public ledger. Writes, relations and the receipt are
committed in one adapter transaction.
"""

from __future__ import annotations

import json
from copy import deepcopy
from hashlib import sha256
from typing import Mapping, Protocol

ACTIONS = frozenset({"modify", "merge", "replace", "delete", "keep_existing", "keep_both"})
PROTECTED_KINDS = frozenset({"identity", "relationship"})
ARITY = {
    "modify": (1, 1),
    "replace": (1, 1),
    "delete": (1, 1),
    "keep_existing": (1, 1),
    "keep_both": (2, 2),
    "merge": (2, 64),
}
VOLATILE_FIELDS = frozenset({"fingerprint", "last_operation_id"})


def _text(value: object) -> str:
    return str(value or "").strip()


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def memory_fingerprint(row: Mapping[str, object]) -> str:
    selected = {key: value for key, value in dict(row).items() if key not in VOLATILE_FIELDS}
    return sha256(canonical_json(selected).encode()).hexdigest()


def normalize_draft(draft: Mapping[str, object]) -> dict:
    payload = deepcopy(dict(draft))
    payload.pop("operation_id", None)
    return json.loads(canonical_json(payload))


def draft_fingerprint(draft: Mapping[str, object]) -> str:
    return sha256(canonical_json(normalize_draft(draft)).encode()).hexdigest()


def operation_id_for(draft: Mapping[str, object]) -> str:
    return f"op_{draft_fingerprint(draft)[:20]}"


def relation_fingerprint(row: Mapping[str, object]) -> str:
    selected = {key: value for key, value in dict(row).items() if key not in VOLATILE_FIELDS}
    return sha256(canonical_json(selected).encode()).hexdigest()


def _ref(row: Mapping[str, object] | None) -> dict | None:
    if row is None:
        return None
    return {
        "id": _text(row.get("id")),
        "version": _text(row.get("version")),
        "status": _text(row.get("status")),
        "kind": _text(row.get("kind")),
        "workspace": _text(row.get("workspace")),
        "fingerprint": memory_fingerprint(row),
    }


def _protected_kinds(*rows: Mapping[str, object] | None) -> bool:
    return any(_text((row or {}).get("kind")) in PROTECTED_KINDS for row in rows)


class StorageAdapter(Protocol):
    def get_memory(self, memory_id: str) -> dict | None: ...
    def get_relation(self, relation_id: str) -> dict | None: ...
    def get_receipt(self, operation_id: str) -> dict | None: ...
    def find_revert(self, operation_id: str) -> dict | None: ...
    def restore_snapshot(self, ref: Mapping[str, object]) -> dict | None: ...
    def commit(self, *, writes: list[dict], relations: list[dict], receipt: dict) -> None:
        """Atomically apply writes, relations and the receipt.

        Existing-record writes must re-check before_ref id, workspace,
        version and fingerprint against live state before any mutation.
        """
        ...


class InMemoryAdapter:
    """Fixture adapter with an atomic commit and a private recovery vault."""

    def __init__(self, memories: list[Mapping[str, object]] | None = None):
        self.memories = {
            _text(row["id"]): {**deepcopy(dict(row)), "fingerprint": memory_fingerprint(row)}
            for row in memories or []
        }
        self.relations: dict[str, dict] = {}
        self.receipts: dict[str, dict] = {}
        self.vault: dict[tuple[str, str, str], dict] = {}

    def get_memory(self, memory_id: str) -> dict | None:
        row = self.memories.get(_text(memory_id))
        return deepcopy(row) if row is not None else None

    def get_relation(self, relation_id: str) -> dict | None:
        row = self.relations.get(_text(relation_id))
        return deepcopy(row) if row is not None else None

    def get_receipt(self, operation_id: str) -> dict | None:
        row = self.receipts.get(operation_id)
        return deepcopy(row) if row is not None else None

    def find_revert(self, operation_id: str) -> dict | None:
        for row in self.receipts.values():
            if row.get("receipt_type") == "revert" and row.get("revert_of") == operation_id:
                return deepcopy(row)
        return None

    def restore_snapshot(self, ref: Mapping[str, object]) -> dict | None:
        key = (_text(ref.get("id")), _text(ref.get("version")), _text(ref.get("fingerprint")))
        row = self.vault.get(key)
        return deepcopy(row) if row is not None else None

    def _before_ref_matches(self, before_ref: Mapping[str, object]) -> bool:
        current = self.memories.get(_text(before_ref.get("id")))
        if current is None:
            return False
        return (
            _text(current.get("id")) == _text(before_ref.get("id"))
            and _text(current.get("workspace")) == _text(before_ref.get("workspace"))
            and _text(current.get("version")) == _text(before_ref.get("version"))
            and memory_fingerprint(current) == _text(before_ref.get("fingerprint"))
        )

    def commit(self, *, writes: list[dict], relations: list[dict], receipt: dict) -> None:
        prior = (deepcopy(self.memories), deepcopy(self.relations), deepcopy(self.receipts), deepcopy(self.vault))
        try:
            key = receipt["operation_id"] if receipt.get("receipt_type") == "execution" else receipt.get("revert_id")
            existing = self.receipts.get(key)
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
                before_ref = write.get("before_ref") or _ref(write.get("before"))
                after_id = _text((write.get("after") or {}).get("id") or write.get("id"))
                if before_ref and not self._before_ref_matches(before_ref):
                    raise ValueError("before_ref no longer matches current memory")
                if not before_ref and after_id in self.memories:
                    raise ValueError("create target id already exists")
            for write in writes:
                after = deepcopy(write["after"])
                after["fingerprint"] = memory_fingerprint(after)
                after["last_operation_id"] = write["operation_id"]
                self.memories[_text(after["id"])] = after
                for snapshot in (write.get("before"), after):
                    if snapshot:
                        self.vault[(
                            _text(snapshot.get("id")),
                            _text(snapshot.get("version")),
                            memory_fingerprint(snapshot),
                        )] = deepcopy(snapshot)
            for relation in relations:
                row = deepcopy(relation)
                row["fingerprint"] = relation_fingerprint(row)
                expected = _text(row.get("expected_fingerprint"))
                if expected:
                    current = self.relations.get(_text(row["id"]))
                    if current is None or relation_fingerprint(current) != expected:
                        raise ValueError("relation fingerprint no longer matches")
                row.pop("expected_fingerprint", None)
                self.relations[_text(row["id"])] = row
            key = receipt["operation_id"] if receipt.get("receipt_type") == "execution" else receipt["revert_id"]
            self.receipts[key] = deepcopy(receipt)
        except Exception:
            self.memories, self.relations, self.receipts, self.vault = prior
            raise


def _proposed_by(draft: Mapping[str, object]) -> dict:
    row = draft.get("proposed_by") if isinstance(draft.get("proposed_by"), Mapping) else {}
    actor = _text(row.get("id"))
    role = _text(row.get("role"))
    if not actor or role not in {"machine", "human"}:
        raise ValueError("proposed_by id and role are required")
    return {"id": actor, "role": role, "at": row.get("at")}


def _reviewers(draft: Mapping[str, object]) -> list[dict]:
    rows = []
    for raw in draft.get("reviewers") or []:
        if not isinstance(raw, Mapping):
            continue
        actor = _text(raw.get("id"))
        role = _text(raw.get("role"))
        if actor and role in {"machine", "human"}:
            rows.append({"id": actor, "role": role})
    return rows


def _require_ready(draft: Mapping[str, object], *kind_sources: Mapping[str, object] | None) -> None:
    if _text(draft.get("status")) != "ready":
        raise ValueError("draft is not ready")
    proposed = _proposed_by(draft)
    signatures = draft.get("signatures") if isinstance(draft.get("signatures"), Mapping) else {}
    unknown = set(signatures) - {"human", "machine"}
    if unknown:
        raise ValueError("unknown signature role")
    own = signatures.get(proposed["role"]) if isinstance(signatures.get(proposed["role"]), Mapping) else {}
    if _text(own.get("actor")) != proposed["id"] or own.get("decision") != "approve":
        raise ValueError("proposed_by signature is required")
    protected = _protected_kinds(*kind_sources) or draft.get("requires_second_key") is True
    if not protected:
        return
    if not all(
        isinstance(signatures.get(role), Mapping) and signatures[role].get("decision") == "approve"
        for role in ("machine", "human")
    ):
        raise ValueError("protected identity or relationship memory requires dual signatures")
    other_role = "human" if proposed["role"] == "machine" else "machine"
    other = signatures[other_role]
    if not _text(other.get("actor")):
        raise ValueError("second-key signature is required")
    if _text(other.get("actor")) == proposed["id"] or other_role == proposed["role"]:
        raise ValueError("the proposer cannot provide the second key")
    reviewers = _reviewers(draft)
    if not any(row["role"] == other_role and row["id"] == _text(other.get("actor")) for row in reviewers):
        raise ValueError("second-key signature does not match a reviewer")


def _target(adapter: StorageAdapter, spec: Mapping[str, object], workspace: str) -> dict:
    memory_id = _text(spec.get("id"))
    if not memory_id:
        raise ValueError("unknown candidate")
    row = adapter.get_memory(memory_id)
    if row is None:
        raise ValueError("unknown candidate")
    if _text(row.get("workspace")) != workspace:
        raise ValueError("cross-workspace target is not allowed")
    if _text(spec.get("expected_version")) != _text(row.get("version")):
        raise ValueError("memory version changed; proposal must be reviewed again")
    return row


def _require_arity(action: str, count: int) -> None:
    low, high = ARITY[action]
    if not low <= count <= high:
        raise ValueError(f"{action} requires {low} target" if low == high == 1 else f"{action} requires {low}..{high} targets")


def _bump(row: dict, *, status: str | None = None, fields: Mapping[str, object] | None = None) -> dict:
    updated = deepcopy(row)
    lineage = dict(updated.get("lineage") or {})
    version = _text(updated.get("version") or "v1")
    next_version = f"v{int(version[1:]) + 1}" if version.startswith("v") and version[1:].isdigit() else f"{version}.next"
    if fields:
        for key, value in dict(fields).items():
            if key in {"id", "workspace"}:
                continue
            updated[key] = deepcopy(value)
    if status is not None:
        updated["status"] = status
    updated["version"] = next_version
    updated["lineage"] = {
        "position": int(lineage.get("position") or 1) + 1,
        "parent_id": updated.get("id"),
        "parent_version": version,
    }
    updated["root_id"] = updated.get("root_id") or updated.get("id")
    return updated


def _write(operation_id: str, before: dict | None, after: dict, kind: str) -> dict:
    return {
        "kind": kind,
        "id": _text(after.get("id")),
        "operation_id": operation_id,
        "before": deepcopy(before),
        "after": deepcopy(after),
        "before_ref": _ref(before),
        "after_ref": _ref(after),
        "after_version": _text(after.get("version")),
        "after_fingerprint": memory_fingerprint(after),
    }


def _relation(operation_id: str, rel_type: str, from_id: str, to_id: str, workspace: str) -> dict:
    return {
        "id": f"rel_{operation_id}_{rel_type}_{from_id}_{to_id}",
        "type": rel_type,
        "from_id": from_id,
        "to_id": to_id,
        "workspace": workspace,
        "status": "active",
        "created_by_operation": operation_id,
    }


def _public_writes(writes: list[dict]) -> list[dict]:
    public = []
    for write in writes:
        public.append({
            "kind": write["kind"],
            "id": write["id"],
            "operation_id": write["operation_id"],
            "before_ref": write.get("before_ref"),
            "after_ref": write.get("after_ref"),
            "after_version": write["after_version"],
            "after_fingerprint": write["after_fingerprint"],
        })
    return public


def plan_execution(draft: Mapping[str, object], adapter: StorageAdapter) -> dict:
    action = _text(draft.get("action"))
    workspace = _text(draft.get("workspace"))
    if action not in ACTIONS:
        raise ValueError("unsupported action")
    if not workspace or not _text(draft.get("draft_id")) or not _text(draft.get("reason")):
        raise ValueError("draft_id, workspace and reason are required")
    claimed = _text(draft.get("operation_id"))
    operation_id = operation_id_for(draft)
    if claimed and claimed != operation_id:
        raise ValueError("draft fingerprint does not match operation_id")
    specs = list(draft.get("targets") or [])
    _require_arity(action, len(specs))
    targets = [_target(adapter, spec, workspace) for spec in specs]
    payload = draft.get("payload") if isinstance(draft.get("payload"), Mapping) else {}
    writes: list[dict] = []
    relations: list[dict] = []
    after_kinds: list[dict] = []

    if action == "modify":
        after = _bump(targets[0], fields=payload.get("fields") if isinstance(payload.get("fields"), Mapping) else payload)
        if targets[0].get("status") == "pending" and after.get("status") == "active":
            raise ValueError("pending candidates must not become active")
        writes.append(_write(operation_id, targets[0], after, "update"))
        after_kinds.append(after)
    elif action == "replace":
        after = _bump(targets[0], fields=payload.get("replacement") if isinstance(payload.get("replacement"), Mapping) else payload)
        if targets[0].get("status") == "pending":
            if _text(after.get("status") or "active") == "active":
                raise ValueError("pending candidates must not become active")
            after["status"] = "pending"
        writes.append(_write(operation_id, targets[0], after, "replace"))
        after_kinds.append(after)
    elif action == "delete":
        after = _bump(targets[0], status="deleted")
        writes.append(_write(operation_id, targets[0], after, "delete"))
        after_kinds.append(after)
    elif action == "merge":
        merged = payload.get("merged") if isinstance(payload.get("merged"), Mapping) else {}
        merged_id = _text(merged.get("id"))
        if not merged_id:
            raise ValueError("merge requires payload.merged.id")
        if adapter.get_memory(merged_id) is not None:
            raise ValueError("merge target id already exists")
        if any(row.get("status") == "pending" for row in targets):
            raise ValueError("pending candidates must not become active")
        created = {
            "id": merged_id,
            "version": _text(merged.get("version") or "v1"),
            "status": "active",
            "kind": _text(merged.get("kind") or "event"),
            "workspace": workspace,
            "root_id": merged_id,
            "lineage": {"position": 1, "parent_id": None, "parent_version": None},
            "metadata": dict(merged.get("metadata") or {"merged_from": [row["id"] for row in targets]}),
            "title": merged.get("title"),
            "content": merged.get("content"),
        }
        writes.append(_write(operation_id, None, created, "create"))
        after_kinds.append(created)
        for row in targets:
            after = _bump(row, status="invalidated", fields={"superseded_by": merged_id})
            writes.append(_write(operation_id, row, after, "invalidate"))
            relations.append(_relation(operation_id, "merged_into", row["id"], merged_id, workspace))
            after_kinds.append(after)
    elif action == "keep_existing":
        candidate_spec = payload.get("candidate") if isinstance(payload.get("candidate"), Mapping) else {
            "id": payload.get("candidate_id"),
            "expected_version": payload.get("expected_version"),
        }
        if not _text(candidate_spec.get("id")) or not _text(candidate_spec.get("expected_version")):
            raise ValueError("keep_existing requires candidate id and expected_version")
        candidate = _target(adapter, candidate_spec, workspace)
        if candidate.get("status") == "pending" and payload.get("activate_candidate"):
            raise ValueError("pending candidates must not become active")
        relations.append(_relation(operation_id, "kept_existing", candidate["id"], targets[0]["id"], workspace))
        after_kinds.extend((targets[0], candidate))
    else:
        left, right = targets
        if any(row.get("status") == "pending" for row in (left, right)) and payload.get("activate_pending"):
            raise ValueError("pending candidates must not become active")
        relations.append(_relation(operation_id, "distinct", left["id"], right["id"], workspace))
        after_kinds.extend((left, right))

    _require_ready(draft, *targets, *after_kinds)
    return {
        "operation_id": operation_id,
        "draft_fingerprint": draft_fingerprint(draft),
        "action": action,
        "workspace": workspace,
        "draft_id": _text(draft.get("draft_id")),
        "writes": writes,
        "relations": relations,
    }


def apply_execution(draft: Mapping[str, object], adapter: StorageAdapter, *, now: str) -> dict:
    if not _text(now):
        raise ValueError("now is required")
    fingerprint = draft_fingerprint(draft)
    operation_id = operation_id_for(draft)
    claimed = _text(draft.get("operation_id"))
    if claimed and claimed != operation_id:
        raise ValueError("draft fingerprint does not match operation_id")
    existing = adapter.get_receipt(operation_id)
    if existing is not None:
        if existing.get("draft_fingerprint") != fingerprint:
            raise ValueError("operation_id already used by a different draft fingerprint")
        return deepcopy(existing)
    plan = plan_execution(draft, adapter)
    receipt = {
        "receipt_type": "execution",
        "operation_id": plan["operation_id"],
        "draft_id": plan["draft_id"],
        "draft_fingerprint": plan["draft_fingerprint"],
        "workspace": plan["workspace"],
        "action": plan["action"],
        "proposed_by": deepcopy(draft.get("proposed_by") or {}),
        "reviewers": deepcopy(draft.get("reviewers") or []),
        "signatures": deepcopy(draft.get("signatures") or {}),
        "reason": _text(draft.get("reason")),
        "executed_at": _text(now),
        "writes": _public_writes(plan["writes"]),
        "relations": [{
            "id": row["id"],
            "type": row["type"],
            "from_id": row["from_id"],
            "to_id": row["to_id"],
            "workspace": row["workspace"],
            "fingerprint": relation_fingerprint(row),
            "created_by_operation": row["created_by_operation"],
        } for row in plan["relations"]],
        "status": "applied",
    }
    try:
        adapter.commit(writes=plan["writes"], relations=plan["relations"], receipt=receipt)
    except ValueError:
        raced = adapter.get_receipt(operation_id)
        if raced is not None and raced.get("draft_fingerprint") == fingerprint:
            return deepcopy(raced)
        raise
    return deepcopy(receipt)


def _owned_by_operation(current: dict | None, write: Mapping[str, object]) -> bool:
    if current is None:
        return False
    return (
        _text(current.get("version")) == _text(write.get("after_version"))
        and _text(current.get("fingerprint") or memory_fingerprint(current)) == _text(write.get("after_fingerprint"))
        and _text(current.get("last_operation_id")) == _text(write.get("operation_id"))
    )


def revert_execution(operation_id: str, adapter: StorageAdapter, *, now: str) -> dict:
    if not _text(now):
        raise ValueError("now is required")
    operation_id = _text(operation_id)
    receipt = adapter.get_receipt(operation_id)
    if receipt is None or receipt.get("receipt_type") != "execution":
        raise ValueError("unknown operation")
    existing_revert = adapter.find_revert(operation_id)
    if existing_revert is not None:
        return existing_revert

    items = []
    restore_writes = []
    closed_relations = []
    for write in receipt.get("writes") or []:
        current = adapter.get_memory(write["id"])
        if write["kind"] == "create":
            if _owned_by_operation(current, write):
                invalidated = deepcopy(current)
                invalidated["status"] = "invalidated"
                restore_writes.append(_write(operation_id, current, invalidated, "invalidate"))
                items.append({"id": write["id"], "outcome": "restored", "reason": "created_record_invalidated"})
            else:
                items.append({"id": write["id"], "outcome": "skipped", "reason": "later_modification"})
            continue
        before = adapter.restore_snapshot(write.get("before_ref") or {})
        if before is None:
            items.append({"id": write["id"], "outcome": "skipped", "reason": "no_before_snapshot"})
            continue
        if _owned_by_operation(current, write):
            restore_writes.append(_write(operation_id, current, before, "restore"))
            items.append({"id": write["id"], "outcome": "restored", "reason": "exact_after_state"})
        else:
            items.append({"id": write["id"], "outcome": "skipped", "reason": "later_modification"})

    for relation_ref in receipt.get("relations") or []:
        current = adapter.get_relation(relation_ref["id"])
        expected = _text(relation_ref.get("fingerprint"))
        if (
            current is not None
            and current.get("status") == "active"
            and current.get("created_by_operation") == operation_id
            and relation_fingerprint(current) == expected
        ):
            closed = deepcopy(current)
            closed["status"] = "closed"
            closed["closed_by"] = f"revert_{operation_id}"
            closed["expected_fingerprint"] = expected
            closed_relations.append(closed)
            items.append({"id": relation_ref["id"], "outcome": "restored", "reason": "relation_closed"})
        else:
            items.append({"id": relation_ref["id"], "outcome": "skipped", "reason": "later_modification"})

    revert_receipt = {
        "receipt_type": "revert",
        "revert_id": f"revert_{operation_id}",
        "revert_of": operation_id,
        "draft_id": receipt.get("draft_id"),
        "workspace": receipt.get("workspace"),
        "action": receipt.get("action"),
        "executed_at": _text(now),
        "status": "applied",
        "items": items,
        "restored": [item["id"] for item in items if item["outcome"] == "restored"],
        "skipped": [item["id"] for item in items if item["outcome"] == "skipped"],
    }
    try:
        adapter.commit(writes=restore_writes, relations=closed_relations, receipt=revert_receipt)
    except ValueError:
        raced = adapter.find_revert(operation_id)
        if raced is not None:
            return raced
        raise
    return deepcopy(revert_receipt)
