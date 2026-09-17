import json
import multiprocessing
import os
import tempfile
import unittest
from pathlib import Path

from moraine.decision_ledger import apply_execution, memory_fingerprint, plan_execution, revert_execution
from moraine.sandbox_decision_store import SandboxJsonAdapter


def _commit_planned(path, plan, start, results):
    store = SandboxJsonAdapter(path, "test")
    start.wait()
    try:
        store.commit(
            writes=plan["writes"],
            relations=plan["relations"],
            receipt={
                "receipt_type": "execution",
                "operation_id": plan["operation_id"],
                "draft_fingerprint": plan["draft_fingerprint"],
            },
        )
        results.put("applied")
    except ValueError:
        results.put("stale")


class SandboxDecisionStoreTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.path = self.root / "sandbox.json"
        self.store = SandboxJsonAdapter.create(self.path, "test", [self._memory("a"), self._memory("b")])

    @staticmethod
    def _memory(memory_id):
        return {
            "id": memory_id,
            "version": "v1",
            "status": "active",
            "kind": "event",
            "workspace": "test",
            "title": memory_id,
            "content": f"synthetic-{memory_id}",
        }

    @staticmethod
    def _draft(action, targets, payload=None, draft_id=None):
        return {
            "draft_id": draft_id or f"draft-{action}",
            "workspace": "test",
            "action": action,
            "status": "ready",
            "proposed_by": {"id": "human-owner", "role": "human", "at": "t0"},
            "reviewers": [],
            "signatures": {"human": {"actor": "human-owner", "decision": "approve", "at": "t0"}},
            "reason": "synthetic sandbox exercise",
            "targets": targets,
            "payload": payload or {},
        }

    def test_create_requires_explicit_sandbox_file_and_private_mode(self):
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(self.path.read_text())["mode"], "sandbox")
        with self.assertRaises(FileExistsError):
            SandboxJsonAdapter.create(self.path, "test")

    def test_execute_reload_and_revert_round_trip(self):
        receipt = apply_execution(
            self._draft("modify", [{"id": "a", "expected_version": "v1"}], {"fields": {"title": "changed"}}),
            self.store,
            now="t1",
        )
        reloaded = SandboxJsonAdapter(self.path, "test")
        self.assertEqual(reloaded.get_memory("a")["title"], "changed")
        reverted = revert_execution(receipt["operation_id"], reloaded, now="t2")
        self.assertEqual(reverted["restored"], ["a"])
        self.assertEqual(SandboxJsonAdapter(self.path, "test").get_memory("a")["title"], "a")

    def test_stale_plan_is_rejected_without_partial_state(self):
        plan = plan_execution(
            self._draft("merge", [
                {"id": "a", "expected_version": "v1"},
                {"id": "b", "expected_version": "v1"},
            ], {"merged": {"id": "ab"}}),
            self.store,
        )
        state = json.loads(self.path.read_text())
        state["memories"]["b"]["title"] = "concurrent-change"
        state["memories"]["b"]["fingerprint"] = memory_fingerprint(state["memories"]["b"])
        SandboxJsonAdapter._write_file(self.path, state)
        with self.assertRaisesRegex(ValueError, "before_ref"):
            self.store.commit(
                writes=plan["writes"],
                relations=plan["relations"],
                receipt={"receipt_type": "execution", "operation_id": plan["operation_id"]},
            )
        current = json.loads(self.path.read_text())
        self.assertNotIn("ab", current["memories"])
        self.assertEqual(current["relations"], {})
        self.assertEqual(current["receipts"], {})

    def test_rejects_symlink_and_open_permissions(self):
        link = self.root / "link.json"
        link.symlink_to(self.path)
        with self.assertRaises(ValueError):
            SandboxJsonAdapter(link, "test")
        os.chmod(self.path, 0o644)
        with self.assertRaises(PermissionError):
            SandboxJsonAdapter(self.path, "test")

    def test_cross_process_commits_cannot_overwrite_each_other(self):
        first = plan_execution(
            self._draft("modify", [{"id": "a", "expected_version": "v1"}],
                        {"fields": {"title": "first"}}, draft_id="first"),
            self.store,
        )
        second = plan_execution(
            self._draft("modify", [{"id": "a", "expected_version": "v1"}],
                        {"fields": {"title": "second"}}, draft_id="second"),
            self.store,
        )
        context = multiprocessing.get_context("fork")
        start = context.Event()
        results = context.Queue()
        workers = [
            context.Process(target=_commit_planned, args=(self.path, plan, start, results))
            for plan in (first, second)
        ]
        for worker in workers:
            worker.start()
        start.set()
        for worker in workers:
            worker.join(5)
            self.assertEqual(worker.exitcode, 0)
        self.assertEqual(sorted(results.get(timeout=1) for _ in workers), ["applied", "stale"])
        reloaded = SandboxJsonAdapter(self.path, "test")
        self.assertEqual(reloaded.get_memory("a")["version"], "v2")
        self.assertEqual(len(reloaded._load()["receipts"]), 1)
        self.assertEqual(self.path.with_suffix(".json.lock").stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
