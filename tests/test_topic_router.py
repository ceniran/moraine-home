import json
import stat
import unittest
import unicodedata
from pathlib import Path
from tempfile import TemporaryDirectory

from moraine.topic_router import TopicRegistry, TopicShadowLog, route_topics, workbench_shadow_view


class TopicRouterTest(unittest.TestCase):
    def setUp(self):
        self.topics = [
            {"topic_id": "moraine", "name": "Moraine", "version": "3",
             "exact_terms": ["Moraine", "记忆库"], "aliases": ["石脉"],
             "supporting_terms": ["召回", "候选箱"], "veto_terms": ["不是Moraine"]},
            {"topic_id": "lili", "name": "家庭模型", "version": "1",
             "exact_terms": ["砾砾", "记忆"], "aliases": ["小石头"],
             "supporting_terms": ["本地模型"], "veto_terms": []},
        ]

    def test_nfkc_casefold_boundaries_and_topic_local_longest_match(self):
        result = route_topics("ＭＯＲＡＩＮＥ 的记忆库，不是 moraineX", self.topics, "cfg")
        by_id = {row["topic_id"]: row for row in result["topics"]}
        self.assertEqual(by_id["moraine"]["evidence_level"], "exact")
        self.assertEqual(by_id["lili"]["evidence_level"], "exact")
        self.assertTrue(result["is_multi_topic"])
        moraine_terms = [row["term"] for row in by_id["moraine"]["matched_spans"]]
        self.assertNotIn("moraineX", moraine_terms)
        # "记忆库" suppresses no evidence in the other topic: scans are independent.
        self.assertIn("记忆", [row["term"] for row in by_id["lili"]["matched_spans"]])

    def test_spans_are_raw_text_offsets_after_normalization_expands_text(self):
        for text in ("今天聊了 Ｍｏｒａｉｎｅ 的设计", "ﬁx 完之后聊了 Moraine", "straße 之后聊了 Moraine"):
            result = route_topics(text, self.topics, "cfg")
            match = next(row for row in result["topics"][0]["matched_spans"] if row["term"] == "Moraine")
            self.assertEqual(unicodedata.normalize("NFKC", text[match["start"]:match["end"]]).casefold(), "moraine")

    def test_veto_is_topic_local_and_overrides_inheritance(self):
        result = route_topics("不是Moraine，今天说砾砾", self.topics, "cfg", inherited_topics=[
            {"topic_id": "moraine", "evidence_level": "exact", "turns_ago": 1},
        ])
        by_id = {row["topic_id"]: row for row in result["topics"]}
        self.assertTrue(by_id["moraine"]["vetoed"])
        self.assertFalse(by_id["moraine"]["inherited"]["applied"])
        self.assertEqual(result["primary_topic"], "lili")

    def test_alias_tie_is_ambiguous_and_supporting_orders_without_score(self):
        topics = [
            {"topic_id": "a", "name": "A", "version": "1", "exact_terms": [],
             "aliases": ["共用名"], "supporting_terms": ["甲"], "veto_terms": []},
            {"topic_id": "b", "name": "B", "version": "1", "exact_terms": [],
             "aliases": ["共用名"], "supporting_terms": [], "veto_terms": []},
        ]
        result = route_topics("共用名甲", topics, "cfg")
        self.assertTrue(result["is_ambiguous"])
        self.assertIsNone(result["primary_topic"])
        self.assertEqual(result["topics"][0]["topic_id"], "a")
        self.assertNotIn("score", json.dumps(result))
        self.assertNotIn("suggested_tier", json.dumps(result))

    def test_supporting_only_is_ambiguous_and_exact_topic_clears_inheritance(self):
        inherited = [{"topic_id": "moraine", "evidence_level": "exact", "turns_ago": 1}]
        result = route_topics("召回砾砾", self.topics, "cfg", inherited_topics=inherited)
        by_id = {row["topic_id"]: row for row in result["topics"]}
        self.assertEqual(result["primary_topic"], "lili")
        self.assertFalse(by_id["moraine"]["inherited"]["applied"])
        supporting = route_topics("只谈候选箱", self.topics, "cfg")
        self.assertTrue(supporting["is_ambiguous"])
        self.assertIsNone(supporting["primary_topic"])
        self.assertFalse(any(row["selection_role"] == "primary" for row in supporting["topics"]))

    def test_registry_and_shadow_log_are_separate_private_files(self):
        with TemporaryDirectory() as root_value:
            root = Path(root_value)
            registry_path = root / ".private-topics.json"
            registry_path.write_text(json.dumps({"topics": self.topics}), encoding="utf-8")
            registry = TopicRegistry(registry_path)
            topics, snapshot_id = registry.load()
            result = route_topics("Moraine", topics, snapshot_id)
            log = TopicShadowLog(root / ".topic-shadow.jsonl")
            entry = log.append("candidate_1", result)
            self.assertIn(entry["assignment"], {"visible", "hidden"})
            pending_view = workbench_shadow_view(entry)
            if entry["assignment"] == "hidden":
                self.assertNotIn("router_output", pending_view)
            decided = log.record_choice("candidate_1", ["moraine"])
            self.assertEqual(decided["final_topic_ids"], ["moraine"])
            self.assertIn("router_output", workbench_shadow_view(decided))
            rerouted = log.append("candidate_1", route_topics("石脉", topics, snapshot_id))
            self.assertTrue(rerouted["previous_choice_preserved"])
            history = log._read()
            self.assertEqual(history[-2]["final_topic_ids"], ["moraine"])
            self.assertIsNone(history[-1]["final_topic_ids"])
            other_snapshot = route_topics("石脉", topics, "different-snapshot")
            self.assertEqual(rerouted["assignment"], log.append("candidate_1", other_snapshot)["assignment"])
            self.assertEqual(stat.S_IMODE(log.path.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(registry_path.stat().st_mode), 0o600)
            self.assertNotIn("Moraine", entry["input_digest"])


if __name__ == "__main__":
    unittest.main()
