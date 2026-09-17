import unittest

from moraine.decision_ledger import (
    InMemoryAdapter,
    apply_execution,
    memory_fingerprint,
    operation_id_for,
    revert_execution,
)


class DecisionLedgerV2Tests(unittest.TestCase):
    def setUp(self):
        self.store = InMemoryAdapter([
            self._row("a", version="v1", status="active", kind="event"),
            self._row("b", version="v1", status="active", kind="event"),
            self._row("pending", version="v1", status="pending", kind="event"),
            self._row("identity", version="v3", status="active", kind="identity"),
        ])

    def _row(self, memory_id, *, version, status, kind, workspace="personal", **extra):
        row = {
            "id": memory_id,
            "version": version,
            "status": status,
            "kind": kind,
            "workspace": workspace,
            "root_id": memory_id,
            "lineage": {"position": 1, "parent_id": None, "parent_version": None},
            "metadata": {"title": memory_id},
            "title": memory_id,
            "content": f"body-{memory_id}",
            "tags": ["home"],
            "source": {"type": "telegram-codex", "ref": "session:garden"},
            "valid_from": "2026-01-01T00:00:00Z",
        }
        row.update(extra)
        return row

    def _draft(self, action, targets, payload=None, **extra):
        draft = {
            "draft_id": extra.pop("draft_id", f"draft-{action}"),
            "workspace": extra.pop("workspace", "personal"),
            "action": action,
            "status": extra.pop("status", "ready"),
            "proposed_by": extra.pop("proposed_by", {"id": "cairn", "role": "human", "at": "t0"}),
            "reviewers": extra.pop("reviewers", [{"id": "codex", "role": "machine"}]),
            "signatures": extra.pop("signatures", {
                "human": {"actor": "cairn", "decision": "approve", "at": "t0"},
                "machine": {"actor": "codex", "decision": "approve", "at": "t0"},
            }),
            "reason": extra.pop("reason", f"{action} after review"),
            "targets": targets,
            "payload": payload or {},
        }
        draft.update(extra)
        return draft

    def test_modify_then_revert_restores_version_chain(self):
        receipt = apply_execution(self._draft("modify", [{"id": "a", "expected_version": "v1"}],
                                             {"fields": {"title": "renamed"}}), self.store, now="t1")
        self.assertTrue(all("content" not in write and "before" not in write for write in receipt["writes"]))
        self.assertEqual(self.store.get_memory("a")["version"], "v2")
        reverted = revert_execution(receipt["operation_id"], self.store, now="t2")
        self.assertEqual(reverted["restored"], ["a"])
        self.assertEqual(self.store.get_memory("a")["version"], "v1")
        self.assertEqual(self.store.get_memory("a")["title"], "a")

    def test_merge_revert_invalidates_new_and_restores_old(self):
        receipt = apply_execution(self._draft(
            "merge",
            [{"id": "a", "expected_version": "v1"}, {"id": "b", "expected_version": "v1"}],
            {"merged": {"id": "ab", "title": "merged"}},
        ), self.store, now="t1")
        self.assertEqual(self.store.get_memory("ab")["status"], "active")
        revert_execution(receipt["operation_id"], self.store, now="t2")
        self.assertEqual(self.store.get_memory("a")["status"], "active")
        self.assertEqual(self.store.get_memory("ab")["status"], "invalidated")
        self.assertTrue(all(row["status"] == "closed" for row in self.store.relations.values()))

    def test_replace_restores_lineage_position(self):
        receipt = apply_execution(self._draft(
            "replace",
            [{"id": "a", "expected_version": "v1"}],
            {"replacement": {"title": "successor"}},
        ), self.store, now="t1")
        revert_execution(receipt["operation_id"], self.store, now="t2")
        self.assertEqual(self.store.get_memory("a")["lineage"]["position"], 1)
        self.assertEqual(self.store.get_memory("a")["version"], "v1")

    def test_delete_and_keep_actions_persist_and_revert_relations(self):
        deleted = apply_execution(self._draft("delete", [{"id": "b", "expected_version": "v1"}]), self.store, now="t1")
        revert_execution(deleted["operation_id"], self.store, now="t2")
        self.assertEqual(self.store.get_memory("b")["status"], "active")

        kept = apply_execution(self._draft(
            "keep_existing",
            [{"id": "a", "expected_version": "v1"}],
            {"candidate": {"id": "pending", "expected_version": "v1"}},
        ), self.store, now="t3")
        rel = next(row for row in self.store.relations.values() if row["type"] == "kept_existing")
        self.assertEqual(rel["status"], "active")
        revert_execution(kept["operation_id"], self.store, now="t4")
        self.assertEqual(self.store.get_relation(rel["id"])["status"], "closed")

        both = apply_execution(self._draft(
            "keep_both",
            [{"id": "a", "expected_version": "v1"}, {"id": "b", "expected_version": "v1"}],
        ), self.store, now="t5")
        distinct = next(row for row in self.store.relations.values() if row["type"] == "distinct")
        revert_execution(both["operation_id"], self.store, now="t6")
        self.assertEqual(self.store.get_relation(distinct["id"])["status"], "closed")

    def test_later_modification_skips_restore(self):
        receipt = apply_execution(self._draft("modify", [{"id": "a", "expected_version": "v1"}],
                                             {"fields": {"title": "once"}}), self.store, now="t1")
        apply_execution(self._draft("modify", [{"id": "a", "expected_version": "v2"}],
                                   {"fields": {"title": "later"}}, draft_id="draft-later",
                                   reason="second edit"), self.store, now="t2")
        reverted = revert_execution(receipt["operation_id"], self.store, now="t3")
        self.assertEqual(reverted["skipped"], ["a"])
        self.assertEqual(self.store.get_memory("a")["title"], "later")

    def test_stale_expected_version_is_rejected(self):
        before = dict(self.store.memories)
        with self.assertRaisesRegex(ValueError, "version changed"):
            apply_execution(self._draft("modify", [{"id": "a", "expected_version": "v0"}],
                                       {"fields": {"title": "nope"}}), self.store, now="t1")
        self.assertEqual(self.store.memories, before)

    def test_draft_fingerprint_conflict_is_rejected(self):
        first = apply_execution(self._draft("delete", [{"id": "b", "expected_version": "v1"}]), self.store, now="t1")
        clash = self._draft("delete", [{"id": "b", "expected_version": "v1"}], reason="other reason")
        clash["operation_id"] = first["operation_id"]
        with self.assertRaisesRegex(ValueError, "fingerprint"):
            apply_execution(clash, self.store, now="t2")

    def test_merge_rejects_existing_id_and_unknown_or_foreign_candidates(self):
        with self.assertRaisesRegex(ValueError, "already exists"):
            apply_execution(self._draft(
                "merge",
                [{"id": "a", "expected_version": "v1"}, {"id": "identity", "expected_version": "v3"}],
                {"merged": {"id": "b"}},
            ), self.store, now="t1")
        with self.assertRaisesRegex(ValueError, "unknown candidate"):
            apply_execution(self._draft("modify", [{"id": "missing", "expected_version": "v1"}]), self.store, now="t1")
        foreign = InMemoryAdapter([self._row("z", version="v1", status="active", kind="event", workspace="work")])
        with self.assertRaisesRegex(ValueError, "workspace"):
            apply_execution(self._draft("delete", [{"id": "z", "expected_version": "v1"}]), foreign, now="t1")

    def test_pending_cannot_enter_active_through_merge_or_replace(self):
        with self.assertRaisesRegex(ValueError, "pending"):
            apply_execution(self._draft(
                "merge",
                [{"id": "pending", "expected_version": "v1"}, {"id": "a", "expected_version": "v1"}],
                {"merged": {"id": "new-active"}},
            ), self.store, now="t1")
        with self.assertRaisesRegex(ValueError, "pending"):
            apply_execution(self._draft(
                "replace",
                [{"id": "pending", "expected_version": "v1"}],
                {"replacement": {"status": "active", "title": "promoted"}},
            ), self.store, now="t1")

    def test_pending_review_draft_cannot_execute(self):
        with self.assertRaisesRegex(ValueError, "not ready"):
            apply_execution(self._draft(
                "modify",
                [{"id": "a", "expected_version": "v1"}],
                {"fields": {"title": "x"}},
                status="pending_review",
            ), self.store, now="t1")

    def test_proposer_cannot_supply_second_key_and_reviewer_must_match(self):
        with self.assertRaisesRegex(ValueError, "proposer"):
            apply_execution(self._draft(
                "modify",
                [{"id": "identity", "expected_version": "v3"}],
                {"fields": {"title": "x"}},
                signatures={
                    "human": {"actor": "cairn", "decision": "approve", "at": "t0"},
                    "machine": {"actor": "cairn", "decision": "approve", "at": "t0"},
                },
            ), self.store, now="t1")
        with self.assertRaisesRegex(ValueError, "reviewer"):
            apply_execution(self._draft(
                "modify",
                [{"id": "identity", "expected_version": "v3"}],
                {"fields": {"title": "x"}},
                reviewers=[{"id": "someone-else", "role": "machine"}],
            ), self.store, now="t1")

    def test_changing_kind_to_identity_requires_dual_signatures(self):
        draft = self._draft(
            "modify",
            [{"id": "a", "expected_version": "v1"}],
            {"fields": {"kind": "identity"}},
            signatures={"human": {"actor": "cairn", "decision": "approve", "at": "t0"}},
            reviewers=[],
        )
        with self.assertRaisesRegex(ValueError, "dual signatures"):
            apply_execution(draft, self.store, now="t1")

    def test_action_arity_is_enforced(self):
        with self.assertRaisesRegex(ValueError, "modify"):
            apply_execution(self._draft(
                "modify",
                [{"id": "a", "expected_version": "v1"}, {"id": "b", "expected_version": "v1"}],
                {"fields": {"title": "x"}},
            ), self.store, now="t1")
        with self.assertRaisesRegex(ValueError, "merge"):
            apply_execution(self._draft("merge", [{"id": "a", "expected_version": "v1"}], {"merged": {"id": "z"}}),
                            self.store, now="t1")
        with self.assertRaisesRegex(ValueError, "keep_both"):
            apply_execution(self._draft(
                "keep_both",
                [{"id": "a", "expected_version": "v1"}, {"id": "b", "expected_version": "v1"},
                 {"id": "pending", "expected_version": "v1"}],
            ), self.store, now="t1")

    def test_keep_existing_requires_candidate_version(self):
        with self.assertRaisesRegex(ValueError, "expected_version"):
            apply_execution(self._draft(
                "keep_existing",
                [{"id": "a", "expected_version": "v1"}],
                {"candidate_id": "pending"},
            ), self.store, now="t1")

    def test_fingerprint_includes_tags_source_and_temporal_fields(self):
        base = self._row("a", version="v1", status="active", kind="event")
        changed = {**base, "tags": ["garden"], "valid_to": "2026-02-01T00:00:00Z"}
        self.assertNotEqual(memory_fingerprint(base), memory_fingerprint(changed))

    def test_execute_and_revert_are_idempotent(self):
        draft = self._draft("modify", [{"id": "a", "expected_version": "v1"}], {"fields": {"title": "once"}})
        first = apply_execution(draft, self.store, now="t1")
        second = apply_execution(draft, self.store, now="t9")
        self.assertEqual(first["operation_id"], second["operation_id"])
        self.assertEqual(first["operation_id"], operation_id_for(draft))
        one = revert_execution(first["operation_id"], self.store, now="t2")
        two = revert_execution(first["operation_id"], self.store, now="t3")
        self.assertEqual(one["revert_id"], two["revert_id"])

    def test_commit_is_atomic_when_receipt_append_fails(self):
        def boom(*, writes, relations, receipt):
            raise RuntimeError("fsync failed")

        self.store.commit = boom
        with self.assertRaises(RuntimeError):
            apply_execution(self._draft("delete", [{"id": "a", "expected_version": "v1"}]), self.store, now="t1")
        self.assertEqual(self.store.get_memory("a")["status"], "active")
        self.assertEqual(self.store.receipts, {})

    def test_delete_and_merge_invalidate_advance_version(self):
        apply_execution(self._draft("delete", [{"id": "b", "expected_version": "v1"}]), self.store, now="t1")
        self.assertEqual(self.store.get_memory("b")["status"], "deleted")
        self.assertEqual(self.store.get_memory("b")["version"], "v2")
        with self.assertRaisesRegex(ValueError, "version changed"):
            apply_execution(self._draft("modify", [{"id": "b", "expected_version": "v1"}],
                                       {"fields": {"title": "stale"}}, draft_id="after-delete"), self.store, now="t2")
        apply_execution(self._draft(
            "merge",
            [{"id": "a", "expected_version": "v1"}, {"id": "identity", "expected_version": "v3"}],
            {"merged": {"id": "ax"}},
            draft_id="merge-version",
        ), self.store, now="t3")
        self.assertEqual(self.store.get_memory("a")["status"], "invalidated")
        self.assertEqual(self.store.get_memory("a")["version"], "v2")
        with self.assertRaisesRegex(ValueError, "version changed"):
            apply_execution(self._draft("modify", [{"id": "a", "expected_version": "v1"}],
                                       {"fields": {"title": "stale"}}, draft_id="after-merge"), self.store, now="t4")

    def test_commit_rejects_stale_before_ref(self):
        from moraine.decision_ledger import plan_execution

        plan = plan_execution(self._draft("modify", [{"id": "a", "expected_version": "v1"}],
                                         {"fields": {"title": "planned"}}), self.store)
        self.store.memories["a"]["title"] = "changed-after-plan"
        self.store.memories["a"]["fingerprint"] = memory_fingerprint(self.store.memories["a"])
        with self.assertRaisesRegex(ValueError, "before_ref"):
            self.store.commit(writes=plan["writes"], relations=[], receipt={"receipt_type": "execution", "operation_id": "op_tmp"})
        self.assertEqual(self.store.get_memory("a")["title"], "changed-after-plan")
        self.assertEqual(self.store.get_memory("a")["version"], "v1")
        self.assertEqual(self.store.relations, {})
        self.assertEqual(self.store.receipts, {})

    def test_modified_relation_is_not_closed_on_revert(self):
        receipt = apply_execution(self._draft(
            "keep_both",
            [{"id": "a", "expected_version": "v1"}, {"id": "b", "expected_version": "v1"}],
        ), self.store, now="t1")
        rel_id = receipt["relations"][0]["id"]
        self.store.relations[rel_id]["note"] = "edited later"
        self.store.relations[rel_id]["fingerprint"] = "tampered"
        reverted = revert_execution(receipt["operation_id"], self.store, now="t2")
        self.assertIn(rel_id, reverted["skipped"])
        self.assertEqual(self.store.get_relation(rel_id)["status"], "active")

    def test_empty_or_unknown_signatures_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "proposed_by signature"):
            apply_execution(self._draft(
                "modify",
                [{"id": "a", "expected_version": "v1"}],
                {"fields": {"title": "x"}},
                signatures={"machine": {"actor": "codex", "decision": "approve", "at": "t0"}},
            ), self.store, now="t1")
        with self.assertRaisesRegex(ValueError, "proposed_by signature"):
            apply_execution(self._draft(
                "modify",
                [{"id": "a", "expected_version": "v1"}],
                {"fields": {"title": "x"}},
                signatures={"human": {"actor": "", "decision": "approve", "at": "t0"}},
            ), self.store, now="t1")
        with self.assertRaisesRegex(ValueError, "proposed_by signature"):
            apply_execution(self._draft(
                "modify",
                [{"id": "a", "expected_version": "v1"}],
                {"fields": {"title": "x"}},
                signatures={"human": {"actor": "other", "decision": "approve", "at": "t0"}},
            ), self.store, now="t1")
        with self.assertRaisesRegex(ValueError, "unknown signature role"):
            apply_execution(self._draft(
                "modify",
                [{"id": "a", "expected_version": "v1"}],
                {"fields": {"title": "x"}},
                signatures={
                    "human": {"actor": "cairn", "decision": "approve", "at": "t0"},
                    "system": {"actor": "root", "decision": "approve", "at": "t0"},
                },
            ), self.store, now="t1")

    def test_merge_commit_is_all_or_nothing_when_one_before_ref_stales(self):
        from moraine.decision_ledger import plan_execution

        plan = plan_execution(self._draft(
            "merge",
            [{"id": "a", "expected_version": "v1"}, {"id": "b", "expected_version": "v1"}],
            {"merged": {"id": "ab"}},
        ), self.store)
        self.store.memories["b"]["title"] = "touched-after-plan"
        self.store.memories["b"]["fingerprint"] = memory_fingerprint(self.store.memories["b"])
        with self.assertRaisesRegex(ValueError, "before_ref"):
            self.store.commit(writes=plan["writes"], relations=plan["relations"],
                              receipt={"receipt_type": "execution", "operation_id": plan["operation_id"]})
        self.assertEqual(self.store.get_memory("a")["status"], "active")
        self.assertEqual(self.store.get_memory("a")["version"], "v1")
        self.assertEqual(self.store.get_memory("b")["status"], "active")
        self.assertIsNone(self.store.get_memory("ab"))
        self.assertEqual(self.store.relations, {})
        self.assertEqual(self.store.receipts, {})

    def test_commit_rejects_concurrent_merged_id(self):
        from moraine.decision_ledger import plan_execution

        plan = plan_execution(self._draft(
            "merge",
            [{"id": "a", "expected_version": "v1"}, {"id": "b", "expected_version": "v1"}],
            {"merged": {"id": "ab"}},
        ), self.store)
        self.store.memories["ab"] = self._row("ab", version="v1", status="active", kind="event")
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.store.commit(writes=plan["writes"], relations=plan["relations"],
                              receipt={"receipt_type": "execution", "operation_id": plan["operation_id"]})
        self.assertEqual(self.store.get_memory("a")["version"], "v1")
        self.assertEqual(self.store.get_memory("ab")["title"], "ab")
        self.assertEqual(self.store.receipts, {})

    def test_empty_now_is_rejected_for_execute_and_revert(self):
        with self.assertRaisesRegex(ValueError, "now is required"):
            apply_execution(self._draft("delete", [{"id": "a", "expected_version": "v1"}]), self.store, now="")
        receipt = apply_execution(self._draft("delete", [{"id": "a", "expected_version": "v1"}]), self.store, now="t1")
        with self.assertRaisesRegex(ValueError, "now is required"):
            revert_execution(receipt["operation_id"], self.store, now="")

    def test_concurrent_commit_keeps_one_receipt(self):
        from moraine.decision_ledger import plan_execution

        plan = plan_execution(self._draft("delete", [{"id": "b", "expected_version": "v1"}]), self.store)
        receipt = {
            "receipt_type": "execution",
            "operation_id": plan["operation_id"],
            "draft_fingerprint": plan["draft_fingerprint"],
            "status": "applied",
        }
        self.store.commit(writes=plan["writes"], relations=[], receipt=receipt)
        self.store.commit(writes=plan["writes"], relations=[], receipt=dict(receipt, executed_at="later"))
        matches = [row for row in self.store.receipts.values() if row.get("operation_id") == plan["operation_id"]]
        self.assertEqual(len(matches), 1)
        self.assertIsNone(matches[0].get("executed_at"))


if __name__ == "__main__":
    unittest.main()
