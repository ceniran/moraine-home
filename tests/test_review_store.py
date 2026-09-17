import os
import tempfile
import unittest
from pathlib import Path

from moraine.governance import create_strength_proposal
from moraine.review_store import ReviewStore


class ReviewStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "review.json"
        self.store = ReviewStore(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def proposal(self):
        return create_strength_proposal({"id": "a", "importance": 0.7}, 90, lock=True,
                                        actor="cairn", actor_role="machine", reason="important",
                                        now="t1", expected_version="v1")

    def test_put_list_get_and_remove(self):
        proposal = self.store.put(self.proposal())
        self.assertEqual(self.store.get(proposal["proposal_id"]), proposal)
        self.assertEqual(self.store.list(status="pending_review"), [proposal])
        self.assertTrue(self.store.remove(proposal["proposal_id"]))
        self.assertEqual(self.store.list(), [])

    def test_file_is_private_and_put_is_idempotent(self):
        proposal = self.proposal()
        self.store.put(proposal)
        self.store.put(proposal)
        self.assertEqual(len(self.store.list()), 1)
        self.assertEqual(os.stat(self.path).st_mode & 0o777, 0o600)

    def test_memory_content_and_rollback_snapshots_are_rejected(self):
        for field in ("content", "body", "preview", "rollback_record", "memory"):
            proposal = {**self.proposal(), field: "private"}
            with self.assertRaisesRegex(ValueError, "forbidden"):
                self.store.put(proposal)


if __name__ == "__main__":
    unittest.main()
