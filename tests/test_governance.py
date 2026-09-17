import unittest

from moraine.governance import (GovernancePolicy, band_for, importance_from_strength,
                                apply_strength_proposal, create_strength_proposal,
                                manual_strength_change, migration_preview,
                                review_strength_proposal, rollback_strength_change,
                                simulate_strengths, suggest_strength, unlock_strength)


class GovernanceTests(unittest.TestCase):
    def test_hundred_point_round_trip(self):
        self.assertEqual(importance_from_strength(42), 0.42)
        self.assertEqual(suggest_strength({"id": "m1", "kind": "event", "importance": 0.42})["current_strength"], 42)

    def test_kind_is_starting_point_not_forced_high_score(self):
        result = suggest_strength({"id": "m1", "kind": "project", "importance": 0.8})
        self.assertEqual(result["suggested_strength"], 40)
        self.assertEqual(result["difference"], -40)

    def test_protection_and_confirmations_are_explainable(self):
        result = suggest_strength({"id": "m1", "kind": "identity", "memory_decay": {"policy": "protected", "confirmation_count": 15}})
        self.assertEqual(result["suggested_strength"], 79)
        self.assertTrue(result["requires_review"])
        self.assertEqual([reason["signal"] for reason in result["reasons"]], ["kind_default", "explicit_protection", "confirmed_use"])

    def test_simulation_reports_distributions_without_content(self):
        result = simulate_strengths([{"id": "a", "kind": "event", "importance": 0.8, "content": "private"},
                                     {"id": "b", "kind": "decision", "importance": 0.7}])
        self.assertEqual(result["current_distribution"]["core"], 1)
        self.assertEqual(result["suggested_distribution"]["ordinary"], 1)
        self.assertTrue(all("content" not in row for row in result["suggestions"]))

    def test_auto_assign_keeps_sensitive_types_in_review(self):
        result = migration_preview([{"id": "a", "kind": "event"}, {"id": "b", "kind": "relationship", "importance": 0.8}], "auto_assign")
        self.assertFalse(result["persisted"])
        self.assertTrue(result["records"][0]["would_write"])
        self.assertFalse(result["records"][1]["would_write"])

    def test_only_missing_preserves_existing_strength(self):
        result = migration_preview([{"id": "a", "kind": "event", "importance": 0.77}], "auto_assign", only_missing=True)
        self.assertEqual(result["records"][0]["selected_strength"], 77)
        self.assertFalse(result["records"][0]["would_write"])

    def test_custom_policy(self):
        result = suggest_strength({"id": "a", "kind": "event"}, GovernancePolicy(base_strength={"event": 22, "unknown": 10}))
        self.assertEqual(result["suggested_strength"], 22)
        self.assertEqual(band_for(22), "ordinary")

    def test_automatic_suggestion_can_never_declare_core(self):
        result = suggest_strength({"id": "a", "kind": "identity", "priority": 1,
                                   "identity_weight": 1, "memory_decay": {"policy": "protected", "confirmation_count": 100}})
        self.assertEqual(result["suggested_strength"], 79)

    def test_manual_core_strength_can_be_locked_with_audit(self):
        original = {"id": "a", "kind": "identity", "importance": 0.7}
        result = manual_strength_change(original, 92, lock=True, actor="cairn", reason="self definition", now="2026-09-04T12:00:00Z")
        self.assertEqual(original["importance"], 0.7)
        self.assertEqual(result["record"]["importance"], 0.92)
        self.assertTrue(result["record"]["moraine_governance"]["strength_locked"])
        self.assertEqual(result["record"]["moraine_governance"]["audit"][0]["action"], "manual_strength_locked")
        self.assertFalse(result["persisted"])

    def test_locked_strength_is_unchanged_by_automatic_policy(self):
        memory = manual_strength_change({"id": "a", "kind": "event", "importance": 0.3}, 88, lock=True,
                                        actor="cairn", reason="important", now="2026-09-04T12:00:00Z")["record"]
        result = suggest_strength(memory)
        self.assertEqual(result["suggested_strength"], 88)
        self.assertEqual(result["reasons"][0]["signal"], "manual_lock")

    def test_locked_strength_must_be_unlocked_before_change(self):
        memory = manual_strength_change({"id": "a", "kind": "event"}, 88, lock=True,
                                        actor="cairn", reason="important", now="2026-09-04T12:00:00Z")["record"]
        with self.assertRaisesRegex(ValueError, "unlock"):
            manual_strength_change(memory, 90, actor="cairn", reason="adjust", now="2026-09-04T12:01:00Z")
        unlocked = unlock_strength(memory, actor="cairn", reason="reconsider", now="2026-09-04T12:02:00Z")["record"]
        self.assertFalse(unlocked["moraine_governance"]["strength_locked"])
        self.assertEqual(unlocked["moraine_governance"]["audit"][-1]["action"], "manual_strength_unlocked")

    def test_locking_non_core_strength_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "80..100"):
            manual_strength_change({"id": "a"}, 79, lock=True, actor="cairn", reason="x", now="now")

    def test_high_impact_proposal_needs_the_other_key(self):
        proposal = create_strength_proposal({"id": "a", "importance": 0.7}, 90, lock=True,
                                            actor="cairn", actor_role="machine", reason="self definition",
                                            now="t1", expected_version="v1")
        self.assertEqual(proposal["status"], "pending_review")
        self.assertEqual(set(proposal["signatures"]), {"machine"})
        approved = review_strength_proposal(proposal, actor="xiaoran", actor_role="human",
                                            decision="approve", now="t2")
        self.assertEqual(approved["status"], "ready")
        self.assertEqual(set(approved["signatures"]), {"machine", "human"})

    def test_proposer_cannot_supply_second_key(self):
        proposal = create_strength_proposal({"id": "a", "importance": 0.7}, 90, lock=True,
                                            actor="cairn", actor_role="machine", reason="important",
                                            now="t1", expected_version="v1")
        with self.assertRaisesRegex(ValueError, "proposer"):
            review_strength_proposal(proposal, actor="cairn", actor_role="machine",
                                     decision="approve", now="t2")

    def test_version_change_rejects_apply_and_ready_change_can_rollback(self):
        memory = {"id": "a", "importance": 0.7, "content": "private"}
        proposal = create_strength_proposal(memory, 90, lock=True, actor="cairn", actor_role="machine",
                                            reason="important", now="t1", expected_version="v1")
        proposal = review_strength_proposal(proposal, actor="xiaoran", actor_role="human",
                                            decision="approve", now="t2")
        with self.assertRaisesRegex(ValueError, "version changed"):
            apply_strength_proposal(memory, proposal, current_version="v2", now="t3")
        applied = apply_strength_proposal(memory, proposal, current_version="v1", now="t3")
        self.assertEqual(applied["record"]["importance"], 0.9)
        self.assertTrue(applied["record"]["moraine_governance"]["strength_locked"])
        self.assertEqual(rollback_strength_change(applied)["record"], memory)

    def test_returned_proposal_cannot_apply(self):
        proposal = create_strength_proposal({"id": "a", "importance": 0.7}, 20,
                                            actor="xiaoran", actor_role="human", reason="reconsider",
                                            now="t1", expected_version="v1")
        proposal = review_strength_proposal(proposal, actor="cairn", actor_role="machine",
                                            decision="return", now="t2")
        with self.assertRaisesRegex(ValueError, "not ready"):
            apply_strength_proposal({"id": "a", "importance": 0.7}, proposal,
                                    current_version="v1", now="t3")


if __name__ == "__main__":
    unittest.main()
