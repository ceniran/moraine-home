import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from moraine.beta_store import BetaStore
from moraine.host_integration import build_turn_query, commit_turn, extract_memory_blocks, prepare_turn


class HostIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        root = Path(self.temporary.name)
        seed = root / "seed.json"
        seed.write_text(json.dumps({
            "memories": [{
                "id": "m1", "title": "散步约定", "content": "周末沿河散步",
                "state": "active", "importance": 0.7, "source_ids": ["c-old"],
            }],
            "candidates": [], "events": [],
        }), encoding="utf-8")
        self.store = BetaStore(root / "store.json", seed)

    def tearDown(self):
        self.temporary.cleanup()

    def test_prepare_uses_short_history_without_persisting(self):
        before = self.store.snapshot()
        query = build_turn_query("那周末呢", ["我们刚才聊散步", "想去河边"])
        self.assertIn("想去河边", query)
        prepared = prepare_turn(self.store, "那周末呢", ["我们刚才聊散步", "想去河边"])
        self.assertIn("Moraine 召回", prepared["prompt_context"])
        self.assertIn("散步约定", prepared["prompt_context"])
        self.assertFalse(prepared["persisted"])
        self.assertEqual(self.store.snapshot(), before)

    def test_nested_json_and_multiple_blocks_are_parsed_safely(self):
        text = (
            '正文<dwell-memory>{"title":"第一条","content":"包含 } 也没关系",'
            '"cairn_reflection":{"content":"不进入通用字段"}}</dwell-memory>'
            '<dwell-memory>{"title":"第二条","content":"另一条","emotion_keywords":["开心","安心"]}</dwell-memory>'
        )
        blocks = extract_memory_blocks(text)
        self.assertEqual([row["payload"]["title"] for row in blocks], ["第一条", "第二条"])
        self.assertNotIn("cairn_reflection", blocks[0]["payload"])

    def test_commit_supports_candidate_direct_and_partial_failure(self):
        text = (
            '给用户看的正文\n'
            '<dwell-memory>{"title":"候选记忆","content":"先进入候选箱"}</dwell-memory>'
            '<dwell-memory>{"title":"自主记忆","content":"由小机直接留下","admission_mode":"direct",'
            '"emotion_keywords":["感动","安心"]}</dwell-memory>'
            '<dwell-memory>{bad json}</dwell-memory>'
        )
        result = commit_turn(text, self.store.submit_memory)
        self.assertEqual(result["visible_text"], "给用户看的正文")
        self.assertEqual(result["block_count"], 3)
        self.assertEqual(result["persisted_count"], 2)
        self.assertEqual(len(result["errors"]), 1)
        self.assertEqual(sum(row.get("state", "pending") == "pending" for row in self.store.list_candidates()), 1)
        direct = next(row for row in self.store.list_memories("active") if row["title"] == "自主记忆")
        self.assertEqual(set(direct["tags"]), {"感动", "安心"})


if __name__ == "__main__":
    unittest.main()
