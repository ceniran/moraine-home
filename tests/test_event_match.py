import unittest

from moraine.event_match import propose_event_matches


class EventMatchTests(unittest.TestCase):
    def row(self, row_id, when, *, topic="project", objects=(), actions=(), kind="event"):
        return {
            "id": row_id, "occurred_at": when, "kind": kind,
            "topic_evidence": {"topics": [{"topic_id": topic, "evidence_level": "exact", "vetoed": False}]},
            "object_keys": list(objects), "action_keys": list(actions),
        }

    def test_topic_is_only_a_comparison_gate(self):
        rows = [
            self.row("a", "2026-09-27T10:00:00Z", objects=["alpha"], actions=["meeting"]),
            self.row("b", "2026-09-27T10:05:00Z", objects=["alpha"], actions=["budget"]),
        ]
        result = propose_event_matches(rows)
        self.assertEqual(result[0]["status"], "needs_review")
        self.assertIn("action_continuity_unconfirmed", result[0]["blockers"])
        self.assertFalse(result[0]["automatic_merge"])

    def test_explicit_object_and_action_continuity_can_raise_a_suggestion(self):
        rows = [
            self.row("a", "2026-09-27T10:00:00Z", objects=["alpha"], actions=["deploy"]),
            self.row("b", "2026-09-27T10:05:00Z", objects=["alpha"], actions=["deploy"]),
        ]
        result = propose_event_matches(rows)
        self.assertEqual(result[0]["status"], "suggested")
        self.assertEqual(result[0]["keyword_role"], "comparison_gate")
        self.assertFalse(result[0]["persisted"])

    def test_different_topics_or_distant_rows_are_not_compared(self):
        different = [self.row("a", "2026-09-27T10:00:00Z"), self.row("b", "2026-09-27T10:05:00Z", topic="mail")]
        distant = [self.row("a", "2026-09-27T10:00:00Z"), self.row("b", "2026-09-27T12:00:00Z")]
        self.assertEqual(propose_event_matches(different), [])
        self.assertEqual(propose_event_matches(distant), [])

    def test_protected_kinds_always_require_review(self):
        rows = [
            self.row("a", "2026-09-27T10:00:00Z", objects=["user-a"], actions=["confirm"], kind="relationship"),
            self.row("b", "2026-09-27T10:05:00Z", objects=["user-a"], actions=["confirm"]),
        ]
        result = propose_event_matches(rows)
        self.assertIn("protected_kind_requires_review", result[0]["blockers"])
        self.assertEqual(result[0]["status"], "needs_review")


if __name__ == "__main__":
    unittest.main()
