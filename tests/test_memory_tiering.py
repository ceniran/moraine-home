import unittest
from datetime import datetime, timezone

from moraine.memory_tiering import suggest_memory_tier


NOW = datetime(2026, 9, 26, tzinfo=timezone.utc)


class MemoryTieringTests(unittest.TestCase):
    def test_protected_kind_never_gets_ordinary_tier(self):
        result = suggest_memory_tier({"kind": "relationship", "confirmation_count": 9}, now=NOW)
        self.assertEqual(result["suggested_tier"], "uncertain")
        self.assertEqual(result["allowed_confirmations"], [])

    def test_future_expiry_suggests_recent(self):
        result = suggest_memory_tier({"kind": "status", "expires_at": "2026-09-28T00:00:00Z"}, now=NOW)
        self.assertEqual(result["suggested_tier"], "recent")
        self.assertIn("explicit_future_expiry", result["reasons"])

    def test_repeated_and_action_used_suggests_long_term(self):
        result = suggest_memory_tier({"confirmation_count": 2, "action_reference_count": 1}, now=NOW)
        self.assertEqual(result["suggested_tier"], "long_term")
        self.assertEqual(result["confidence"], "high")

    def test_single_event_stays_uncertain(self):
        result = suggest_memory_tier({"kind": "event"}, now=NOW)
        self.assertEqual(result["suggested_tier"], "uncertain")


if __name__ == "__main__":
    unittest.main()
