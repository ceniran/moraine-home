import unittest

from moraine.episodes import build_episode_candidates


class EpisodeInputIsolationTests(unittest.TestCase):
    @staticmethod
    def row(memory_id, **extra):
        row = {
            "id": memory_id,
            "source": {"type": "conversation", "ref": "session:a"},
            "workspace": "personal",
            "project_id": "moraine",
            "kind": "event",
            "created_at": "2026-09-05T09:00:00Z",
        }
        row.update(extra)
        return row

    def test_strips_source_and_scope_strings(self):
        result = build_episode_candidates([
            self.row(" a ", source={"type": " conversation ", "ref": " session:a "},
                     workspace=" personal ", project_id=" moraine ", kind=" event "),
            self.row("b"),
        ])
        self.assertEqual(result[0]["member_ids"], ["a", "b"])
        self.assertEqual(result[0]["source"], {"type": "conversation", "ref": "session:a"})
        self.assertEqual(result[0]["workspace"], "personal")
        self.assertEqual(result[0]["project_id"], "moraine")

    def test_source_type_is_case_sensitive(self):
        rows = [self.row("a"), self.row("b", source={"type": "Conversation", "ref": "session:a"})]
        self.assertEqual([item["member_ids"] for item in build_episode_candidates(rows)], [["b"], ["a"]])

    def test_explicit_default_workspace_does_not_join_missing_workspace(self):
        rows = [self.row("a", workspace=None), self.row("b", workspace="default")]
        result = build_episode_candidates(rows)
        self.assertEqual(sorted(item["member_ids"] for item in result), [["a"], ["b"]])
        self.assertEqual([item["scope_incomplete"] for item in result].count(True), 1)

    def test_incomplete_records_stay_singleton_candidates(self):
        rows = [
            self.row("a", workspace=None),
            self.row("b", workspace=None),
            self.row("c", project_id=None),
            self.row("d", project_id=None),
        ]
        result = build_episode_candidates(rows)
        self.assertEqual(sorted(item["member_ids"] for item in result), [["a"], ["b"], ["c"], ["d"]])
        self.assertTrue(all(item["scope_incomplete"] and item["requires_review"] for item in result))

    def test_blank_strings_are_treated_as_missing(self):
        result = build_episode_candidates([
            self.row("a", workspace="   "),
            self.row("b", project_id="\t"),
        ])
        self.assertTrue(all(item["scope_incomplete"] for item in result))
        self.assertEqual([item["member_count"] for item in result], [1, 1])

    def test_episode_id_still_ignores_window_parameters(self):
        rows = [self.row("a"), self.row("b", created_at="2026-09-05T09:10:00Z")]
        tight = build_episode_candidates(rows, inactivity_gap_minutes=30, max_episode_minutes=30)
        wide = build_episode_candidates(rows, inactivity_gap_minutes=120, max_episode_minutes=180)
        self.assertEqual(tight[0]["episode_id"], wide[0]["episode_id"])


if __name__ == "__main__":
    unittest.main()
