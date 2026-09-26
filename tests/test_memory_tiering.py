import unittest
from datetime import datetime, timezone

from moraine.memory_tiering import derive_tiering_evidence, suggest_memory_tier


NOW = datetime(2026, 9, 26, tzinfo=timezone.utc)


class MemoryTieringTests(unittest.TestCase):
    def test_protected_kind_never_gets_ordinary_tier(self):
        result = suggest_memory_tier({"kind": "relationship"}, now=NOW)
        self.assertEqual(result["suggested_tier"], "uncertain")
        self.assertEqual(result["allowed_confirmations"], [])

    def test_future_expiry_suggests_recent(self):
        result = suggest_memory_tier({"kind": "status", "expires_at": "2026-09-28T00:00:00Z"}, now=NOW)
        self.assertEqual(result["suggested_tier"], "recent")
        self.assertIn("explicit_future_expiry", result["reasons"])

    def test_durable_kind_suggests_long_term_without_synthetic_counters(self):
        result = suggest_memory_tier({"kind": "decision"}, now=NOW)
        self.assertEqual(result["suggested_tier"], "long_term")
        self.assertTrue(result["actionable"])

    def test_store_projection_derives_span_from_real_basket_rows(self):
        candidate = {"id": "c2", "kind": "event", "basket": "same", "occurred_at": "2026-09-10T00:00:00Z"}
        snapshot = {"candidates": [
            {"id": "c1", "basket": "same", "occurred_at": "2026-09-01T00:00:00Z"}, candidate,
        ], "memories": [], "events": []}
        evidence = derive_tiering_evidence(candidate, snapshot)
        result = suggest_memory_tier(candidate, evidence=evidence, now=NOW)
        self.assertEqual(evidence["related_observation_count"], 2)
        self.assertEqual(evidence["observed_span_days"], 9)
        self.assertEqual(result["suggested_tier"], "long_term")

    def test_single_event_stays_uncertain(self):
        result = suggest_memory_tier({"kind": "event"}, now=NOW)
        self.assertEqual(result["suggested_tier"], "uncertain")
        self.assertFalse(result["actionable"])


if __name__ == "__main__":
    unittest.main()
