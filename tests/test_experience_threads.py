import json
import unittest
from pathlib import Path

from moraine.experience_threads import (
    build_experience_thread_candidate,
    preview_experience_thread_review,
    propose_experience_thread_members,
)


class ExperienceThreadTests(unittest.TestCase):
    @staticmethod
    def row(memory_id, created_at, *, workspace="personal", source_ref=None):
        return {
            "id": memory_id,
            "workspace": workspace,
            "created_at": created_at,
            "source": {"type": "game", "ref": source_ref or f"werewolf:{memory_id}"},
        }

    def test_orders_explicit_members_and_keeps_sources(self):
        rows = [
            self.row("later", "2026-09-02T10:00:00Z"),
            self.row("first", "2026-09-01T10:00:00Z"),
        ]
        result = build_experience_thread_candidate(
            rows,
            thread_id="werewolf.action-timing",
            title="Werewolf action timing",
            workspace="personal",
        )
        self.assertEqual(result["member_ids"], ["first", "later"])
        self.assertEqual(result["points"][0]["source"], {"type": "game", "ref": "werewolf:first"})
        self.assertFalse(result["membership_inferred"])
        self.assertTrue(result["requires_review"])
        self.assertEqual(result["writes"], [])
        self.assertFalse(result["persisted"])

    def test_builds_source_linked_pending_summary(self):
        result = build_experience_thread_candidate(
            [self.row("a", "2026-09-01T10:00:00Z"), self.row("b", "2026-09-02T10:00:00Z")],
            thread_id="werewolf.action-timing",
            title="Werewolf action timing",
            workspace="personal",
            summary_draft={
                "revision": 2,
                "previous_revision": 1,
                "text": "Wait for decisive replies before locking an action.",
                "source_ids": ["b", "a"],
                "unresolved": ["Needs another wolf-game check", ""],
                "revisit_when": ["A later game contradicts this rule"],
            },
        )
        summary = result["summary_draft"]
        self.assertEqual(summary["status"], "pending_review")
        self.assertEqual(summary["source_ids"], ["b", "a"])
        self.assertEqual(summary["unresolved"], ["Needs another wolf-game check"])
        self.assertFalse(summary["persisted"])

    def test_rejects_missing_identity_scope_source_or_time(self):
        base = self.row("a", "2026-09-01T10:00:00Z")
        cases = [
            {**base, "id": ""},
            {**base, "workspace": "other"},
            {**base, "source": {}},
            {**base, "created_at": ""},
        ]
        for row in cases:
            with self.subTest(row=row):
                with self.assertRaises(ValueError):
                    build_experience_thread_candidate(
                        [row], thread_id="thread", title="Thread", workspace="personal"
                    )

    def test_rejects_empty_or_duplicate_members(self):
        with self.assertRaises(ValueError):
            build_experience_thread_candidate([], thread_id="thread", title="Thread", workspace="personal")
        row = self.row("a", "2026-09-01T10:00:00Z")
        with self.assertRaises(ValueError):
            build_experience_thread_candidate([row, row], thread_id="thread", title="Thread", workspace="personal")

    def test_summary_must_cite_members_and_follow_revision_chain(self):
        row = self.row("a", "2026-09-01T10:00:00Z")
        invalid_summaries = [
            {"revision": 1, "text": "Summary", "source_ids": ["missing"]},
            {"revision": 1, "previous_revision": 1, "text": "Summary", "source_ids": ["a"]},
            {"revision": 3, "previous_revision": 1, "text": "Summary", "source_ids": ["a"]},
            {"revision": 1, "text": "", "source_ids": ["a"]},
            {"revision": 1, "text": "Summary", "source_ids": []},
            {"revision": 1, "text": "Summary", "source_ids": "a"},
            {"revision": 1, "text": "Summary", "source_ids": ["a"], "unresolved": "question"},
            {"revision": True, "text": "Summary", "source_ids": ["a"]},
        ]
        for summary in invalid_summaries:
            with self.subTest(summary=summary):
                with self.assertRaises(ValueError):
                    build_experience_thread_candidate(
                        [row], thread_id="thread", title="Thread", workspace="personal",
                        summary_draft=summary,
                    )

    def test_does_not_mutate_input(self):
        rows = [self.row("a", "2026-09-01T10:00:00Z")]
        snapshot = [{**rows[0], "source": dict(rows[0]["source"])}]
        build_experience_thread_candidate(
            rows, thread_id="thread", title="Thread", workspace="personal"
        )
        self.assertEqual(rows, snapshot)


class ExperienceThreadProposalTests(unittest.TestCase):
    @staticmethod
    def row(memory_id, created_at, *, workspace="personal", similarity=0.8, source_ref=None, **extra):
        row = {
            "id": memory_id,
            "workspace": workspace,
            "created_at": created_at,
            "source": {"type": "game", "ref": source_ref or f"werewolf:{memory_id}"},
            "similarity": similarity,
            "content": f"secret-{memory_id}",
        }
        row.update(extra)
        return row

    def propose(self, rows, **extra):
        kwargs = {
            "thread_id": "werewolf.action-timing",
            "title": "Werewolf action timing",
            "workspace": "personal",
        }
        kwargs.update(extra)
        return propose_experience_thread_members(rows, **kwargs)

    def test_filters_by_score_and_orders_by_time(self):
        result = self.propose([
            self.row("later", "2026-09-02T10:00:00Z", similarity=0.9),
            self.row("weak", "2026-09-01T09:00:00Z", similarity=0.2),
            self.row("first", "2026-09-01T10:00:00Z", similarity=0.7),
        ], min_score=0.5)
        self.assertEqual(result["proposed_member_ids"], ["first", "later"])
        self.assertEqual(result["excluded"], [{"memory_id": "weak", "reason": "below_min_score"}])
        self.assertEqual(result["points"][0]["similarity"], 0.7)
        self.assertEqual(result["status"], "pending_review")
        self.assertTrue(result["membership_inferred"])
        self.assertTrue(result["requires_review"])
        self.assertEqual(result["writes"], [])
        self.assertFalse(result["persisted"])

    def test_excludes_foreign_workspace_with_stable_reason(self):
        result = self.propose([
            self.row("keep", "2026-09-01T10:00:00Z"),
            self.row("other", "2026-09-01T11:00:00Z", workspace="work"),
        ])
        self.assertEqual(result["proposed_member_ids"], ["keep"])
        self.assertEqual(result["excluded"], [{"memory_id": "other", "reason": "workspace_mismatch"}])

    def test_rejects_missing_or_foreign_anchors(self):
        rows = [self.row("a", "2026-09-01T10:00:00Z")]
        with self.assertRaises(ValueError):
            self.propose(rows, anchor_ids=["missing"])
        with self.assertRaises(ValueError):
            self.propose(
                [self.row("a", "2026-09-01T10:00:00Z"), self.row("b", "2026-09-01T11:00:00Z", workspace="work")],
                anchor_ids=["b"],
            )

    def test_rejects_duplicate_ids(self):
        row = self.row("a", "2026-09-01T10:00:00Z")
        with self.assertRaises(ValueError):
            self.propose([row, dict(row)])

    def test_rejects_missing_workspace_and_text_anchor_collection(self):
        row = self.row("a", "2026-09-01T10:00:00Z")
        without_workspace = dict(row)
        without_workspace.pop("workspace")
        with self.assertRaises(ValueError):
            self.propose([without_workspace])
        with self.assertRaises(ValueError):
            self.propose([row], anchor_ids="a")

    def test_rejects_illegal_similarity_and_min_score(self):
        base = self.row("a", "2026-09-01T10:00:00Z")
        for similarity in (True, float("nan"), float("inf"), -0.1, 1.2, "0.5", None):
            with self.subTest(similarity=similarity):
                with self.assertRaises(ValueError):
                    self.propose([{**base, "similarity": similarity}])
        with self.assertRaises(ValueError):
            self.propose([base], min_score=True)
        with self.assertRaises(ValueError):
            self.propose([base], min_score=1.5)

    def test_rejects_empty_input_or_empty_result(self):
        with self.assertRaises(ValueError):
            self.propose([])
        with self.assertRaises(ValueError):
            self.propose([self.row("a", "2026-09-01T10:00:00Z", similarity=0.1)], min_score=0.9)

    def test_omits_content_and_does_not_mutate_input(self):
        rows = [self.row("a", "2026-09-01T10:00:00Z")]
        snapshot = [{**rows[0], "source": dict(rows[0]["source"])}]
        result = self.propose(rows, anchor_ids=["a"])
        self.assertNotIn("content", result)
        self.assertTrue(all("content" not in point for point in result["points"]))
        self.assertEqual(result["anchor_ids"], ["a"])
        self.assertEqual(rows, snapshot)

    def test_human_selected_subset_can_build_a_thread(self):
        proposal = self.propose([
            self.row("first", "2026-09-01T10:00:00Z", similarity=0.8),
            self.row("later", "2026-09-02T10:00:00Z", similarity=0.9),
            self.row("skip", "2026-09-03T10:00:00Z", similarity=0.6),
        ], min_score=0.5, anchor_ids=["first"])
        chosen = [
            self.row(memory_id, "2026-09-01T10:00:00Z" if memory_id == "first" else "2026-09-02T10:00:00Z")
            for memory_id in proposal["proposed_member_ids"]
            if memory_id != "skip"
        ]
        thread = build_experience_thread_candidate(
            chosen,
            thread_id=proposal["thread_id"],
            title=proposal["title"],
            workspace=proposal["workspace"],
        )
        self.assertEqual(thread["member_ids"], ["first", "later"])
        self.assertFalse(thread["membership_inferred"])
        self.assertTrue(thread["requires_review"])
        self.assertEqual(thread["writes"], [])
        self.assertFalse(thread["persisted"])


class ExperienceThreadReviewPreviewTests(unittest.TestCase):
    def test_checked_in_rehearsal_matches_adapter_contract(self):
        examples = Path(__file__).parents[1] / "examples"
        fixture_path = examples / "experience-thread-review.example.json"
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        result = preview_experience_thread_review(
            fixture["retrieval_results"],
            fixture["records"],
            **fixture["config"],
        )
        self.assertEqual(result, fixture["preview"])
        browser_preview = json.loads(
            (examples / "experience-thread-review.preview.json").read_text(encoding="utf-8")
        )
        self.assertEqual(result, browser_preview)
        self.assertNotIn("content", repr(browser_preview))

    def test_joins_retrieval_results_without_exposing_content(self):
        records = [
            {
                "id": "game-2", "workspace": "personal", "created_at": "2026-09-02T10:00:00Z",
                "source": {"type": "game", "ref": "werewolf:2"}, "title": "Second game",
                "kind": "event", "content": "private second game details",
            },
            {
                "id": "game-1", "workspace": "personal", "created_at": "2026-09-01T10:00:00Z",
                "source": {"type": "game", "ref": "werewolf:1"}, "title": "First game",
                "kind": "reflection", "content": "private first game details",
            },
        ]
        result = preview_experience_thread_review(
            [{"id": "game-2", "score": 0.91}, {"id": "game-1", "score": 0.84}],
            records,
            thread_id="werewolf.action-timing",
            title="Werewolf action timing",
            workspace="personal",
            anchor_ids=["game-2"],
            min_score=0.8,
        )
        self.assertEqual(result["mode"], "read_only_review")
        self.assertEqual(result["proposed_member_ids"], ["game-1", "game-2"])
        self.assertEqual(result["points"][0]["title"], "First game")
        self.assertEqual(result["points"][0]["kind"], "reflection")
        self.assertNotIn("content", repr(result))
        self.assertEqual(result["writes"], [])
        self.assertFalse(result["persisted"])

    def test_rejects_unknown_or_duplicate_retrieval_results(self):
        record = {
            "id": "game-1", "workspace": "personal", "created_at": "2026-09-01T10:00:00Z",
            "source": {"type": "game", "ref": "werewolf:1"},
        }
        kwargs = {
            "thread_id": "thread", "title": "Thread", "workspace": "personal",
        }
        with self.assertRaises(ValueError):
            preview_experience_thread_review([{"id": "missing", "score": 0.9}], [record], **kwargs)
        with self.assertRaises(ValueError):
            preview_experience_thread_review(
                [{"id": "game-1", "score": 0.9}, {"id": "game-1", "score": 0.8}],
                [record], **kwargs,
            )

    def test_does_not_mutate_inputs(self):
        results = [{"id": "game-1", "score": 0.9}]
        records = [{
            "id": "game-1", "workspace": "personal", "created_at": "2026-09-01T10:00:00Z",
            "source": {"type": "game", "ref": "werewolf:1"}, "content": "private",
        }]
        result_snapshot = [dict(results[0])]
        record_snapshot = [{**records[0], "source": dict(records[0]["source"])}]
        preview_experience_thread_review(
            results, records, thread_id="thread", title="Thread", workspace="personal"
        )
        self.assertEqual(results, result_snapshot)
        self.assertEqual(records, record_snapshot)


if __name__ == "__main__":
    unittest.main()
