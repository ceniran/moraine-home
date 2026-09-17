import unittest

from moraine.core_projection import build_core_projection
from moraine.episodes import build_episode_candidates
from moraine.temporal import is_current, is_valid_at, validate_validity


class TemporalTests(unittest.TestCase):
    def test_half_open_validity_window(self):
        row = {"state": "active", "valid_from": "2026-01-01T00:00:00Z", "valid_to": "2026-02-01T00:00:00Z"}
        self.assertTrue(is_valid_at(row, "2026-01-15T00:00:00Z"))
        self.assertFalse(is_valid_at(row, "2026-02-01T00:00:00Z"))
        self.assertFalse(is_current({**row, "state": "superseded"}, "2026-01-15T00:00:00Z"))

    def test_rejects_invalid_window(self):
        with self.assertRaises(ValueError):
            validate_validity({"valid_from": "2026-02-01T00:00:00Z", "valid_to": "2026-01-01T00:00:00Z"})


class EpisodeTests(unittest.TestCase):
    @staticmethod
    def row(memory_id, created_at, **extra):
        row = {"id": memory_id, "source": {"type": "conversation", "ref": "session:a"},
               "workspace": "personal", "project_id": "moraine", "kind": "event",
               "created_at": created_at}
        row.update(extra)
        return row

    def test_groups_only_same_source_scope_inside_window(self):
        base = {"source": {"type": "conversation", "ref": "session:a"}, "workspace": "personal", "project_id": "moraine"}
        rows = [
            {**base, "id": "a", "created_at": "2026-09-05T01:00:00Z"},
            {**base, "id": "b", "created_at": "2026-09-05T01:40:00Z"},
            {**base, "id": "c", "created_at": "2026-09-05T03:00:00Z"},
            {**base, "id": "d", "created_at": "2026-09-05T01:20:00Z", "project_id": "dwell"},
        ]
        result = build_episode_candidates(rows, window_minutes=60)
        self.assertEqual([row["member_ids"] for row in result], [["d"], ["a", "b"], ["c"]])
        self.assertTrue(all(row["status"] == "pending_review" and not row["persisted"] for row in result))

    def test_requires_identity_and_time(self):
        with self.assertRaises(ValueError):
            build_episode_candidates([{"created_at": "2026-09-05T01:00:00Z"}])
        with self.assertRaises(ValueError):
            build_episode_candidates([{"id": "a", "source": {"type": "conversation", "ref": "session:a"}}])
        with self.assertRaises(ValueError):
            build_episode_candidates([{"id": "a", "created_at": "2026-09-05T01:00:00Z"}])

    def test_total_span_prevents_chain_buckets(self):
        rows = [self.row("a", "2026-09-05T01:00:00Z"), self.row("b", "2026-09-05T01:50:00Z"),
                self.row("c", "2026-09-05T02:40:00Z"), self.row("d", "2026-09-05T03:30:00Z")]
        result = build_episode_candidates(rows, inactivity_gap_minutes=60, max_episode_minutes=60)
        self.assertEqual([item["member_ids"] for item in result], [["a", "b"], ["c", "d"]])

    def test_episode_identity_ignores_policy_when_members_match(self):
        rows = [self.row("a", "2026-09-05T09:00:00Z"), self.row("b", "2026-09-05T09:10:00Z")]
        tight = build_episode_candidates(rows, inactivity_gap_minutes=30, max_episode_minutes=30)
        wide = build_episode_candidates(rows, inactivity_gap_minutes=120, max_episode_minutes=180)
        self.assertEqual(tight[0]["episode_id"], wide[0]["episode_id"])

    def test_scope_and_protected_members_require_review(self):
        incomplete = self.row("a", "2026-09-05T09:00:00Z", workspace=None)
        scoped = build_episode_candidates([incomplete])[0]
        self.assertTrue(scoped["scope_incomplete"])
        self.assertTrue(scoped["requires_review"])
        protected = build_episode_candidates([self.row("b", "2026-09-05T09:00:00Z", kind="identity")])[0]
        self.assertTrue(protected["requires_protected_review"])
        self.assertTrue(protected["requires_review"])
        self.assertTrue(protected["relationship_undetermined"])

    def test_input_order_and_objects_are_stable(self):
        rows = [self.row("b", "2026-09-05T09:10:00Z"), self.row("a", "2026-09-05T09:00:00Z")]
        snapshot = [dict(row) for row in rows]
        first = build_episode_candidates(rows)
        second = build_episode_candidates(list(reversed(rows)))
        self.assertEqual(first, second)
        self.assertEqual(rows, snapshot)


class CoreProjectionTests(unittest.TestCase):
    def test_only_explicit_current_records_enter_budget(self):
        records = [
            {"id": "identity", "title": "Name", "content": "Cairn", "state": "active", "importance": 0.9,
             "moraine_governance": {"core_presence": "always"}},
            {"id": "high-but-not-selected", "title": "Event", "content": "Not always", "state": "active", "importance": 1.0},
            {"id": "expired", "title": "Old", "content": "Old fact", "state": "active", "importance": 1.0,
             "valid_to": "2026-01-01T00:00:00Z", "moraine_governance": {"core_presence": "always"}},
        ]
        records[0]["workspace"] = "personal"
        records[1]["workspace"] = "personal"
        records[2]["workspace"] = "personal"
        result = build_core_projection(records, now="2026-09-05T00:00:00Z", workspace="personal", max_chars=100)
        self.assertEqual(result["source_ids"], ["identity"])
        self.assertIn("Cairn", result["text"])
        self.assertFalse(result["persisted"])

    def test_never_silently_truncates_a_block(self):
        row = {"id": "a", "title": "Long", "content": "x" * 100, "state": "active",
               "moraine_governance": {"core_presence": "always"}}
        row["workspace"] = "personal"
        result = build_core_projection([row], now="2026-09-05T00:00:00Z", workspace="personal", max_chars=20)
        self.assertEqual(result["text"], "")
        self.assertEqual(result["skipped_ids"], ["a"])

    def test_workspace_secret_and_contested_records_never_enter(self):
        def row(memory_id, **extra):
            value = {"id": memory_id, "title": memory_id, "content": "value", "state": "active",
                     "workspace": "personal", "moraine_governance": {"core_presence": "always"}}
            value.update(extra)
            return value
        records = [
            row("allowed"),
            row("other", workspace="work"),
            row("secret", sensitivity="secret"),
            row("contested", confidence="contested"),
        ]
        result = build_core_projection(records, now="2026-09-05T00:00:00Z", workspace="personal")
        self.assertEqual(result["source_ids"], ["allowed"])
        self.assertEqual(result["excluded"]["wrong_workspace"], ["other"])
        self.assertEqual(result["excluded"]["secret"], ["secret"])
        self.assertEqual(result["excluded"]["contested"], ["contested"])

    def test_workspace_is_required(self):
        with self.assertRaises(ValueError):
            build_core_projection([], now="2026-09-05T00:00:00Z", workspace="")


if __name__ == "__main__":
    unittest.main()
