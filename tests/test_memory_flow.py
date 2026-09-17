import copy
import json
import unittest
from pathlib import Path

from moraine.memory_flow import preview_memory_flow


class MemoryFlowTests(unittest.TestCase):
    def fixture(self):
        path = Path(__file__).parents[1] / "examples" / "memory-flow.example.json"
        return json.loads(path.read_text(encoding="utf-8"))

    def test_example_flows_without_writes(self):
        fixture = self.fixture()
        result = preview_memory_flow(
            fixture["observations"], fixture["reviewed_records"],
            now=fixture["now"], workspace=fixture["workspace"],
        )
        self.assertEqual([row["member_ids"] for row in result["episodes"]],
                         [["obs_1", "obs_2", "obs_3"], ["obs_4"], ["obs_5"]])
        self.assertEqual(set(result["would_index_ids"]), {"rule_12h", "project_core"})
        self.assertEqual(result["historical_ids"], ["rule_daily"])
        self.assertEqual(result["review_gate"]["pending_ids"], ["unreviewed"])
        self.assertEqual(result["core_projection"]["source_ids"], ["project_core"])
        self.assertEqual(result["writes"], [])
        self.assertFalse(result["persisted"])

    def test_pending_and_rejected_records_cannot_cross_gate(self):
        fixture = self.fixture()
        records = [
            {"id": "pending", "state": "active", "workspace": "home"},
            {"id": "rejected", "state": "active", "workspace": "home", "review_status": "rejected"},
        ]
        result = preview_memory_flow(fixture["observations"], records, now=fixture["now"], workspace="home")
        self.assertEqual(result["would_index_ids"], [])
        self.assertEqual(result["review_gate"]["pending_ids"], ["pending"])
        self.assertEqual(result["review_gate"]["rejected_ids"], ["rejected"])

    def test_preview_does_not_mutate_inputs(self):
        fixture = self.fixture()
        observations = fixture["observations"]
        records = fixture["reviewed_records"]
        before = copy.deepcopy(fixture)
        preview_memory_flow(observations, records, now=fixture["now"], workspace=fixture["workspace"])
        self.assertEqual(fixture, before)


if __name__ == "__main__":
    unittest.main()
