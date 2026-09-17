import json
import unittest

from moraine.consolidate import comparison_key, consolidate, consolidation_from_body, split_sentences


class ConsolidateTests(unittest.TestCase):
    def test_splits_chinese_and_newlines_without_rewriting(self):
        self.assertEqual(split_sentences("第一句。第二句！\n第三句"), ["第一句。", "第二句！", "第三句"])

    def test_normalizes_width_case_spacing_and_punctuation(self):
        self.assertEqual(comparison_key("Ｍoraine， Local!"), comparison_key("moraine local"))

    def test_removes_exact_duplicate_and_keeps_provenance(self):
        result = consolidate([
            {"id": "m1", "content": "砾砾负责本地语义召回。"},
            {"id": "m2", "content": "砾砾负责本地语义召回！工作台需要人工确认。"},
        ])
        self.assertEqual(result["content"], "砾砾负责本地语义召回。工作台需要人工确认。")
        self.assertEqual(result["sentences"][0]["source_ids"], ["m1"])
        self.assertEqual(result["removed"][0]["reason"], "exact_duplicate")
        self.assertTrue(result["requires_review"])

    def test_removes_only_verbatim_subsumed_sentence(self):
        result = consolidate([
            {"id": "old", "content": "旧记录不会抹除"},
            {"id": "new", "content": "合并后旧记录不会抹除，并保留来源。"},
        ])
        self.assertEqual(result["content"], "合并后旧记录不会抹除，并保留来源。")
        self.assertEqual(result["removed"][0]["reason"], "subsumed_verbatim")

    def test_does_not_guess_that_paraphrases_are_duplicates(self):
        result = consolidate([
            {"id": "a", "content": "记忆需要由双方确认。"},
            {"id": "b", "content": "两个人同意后才可以修改记录。"},
        ])
        self.assertEqual(len(result["sentences"]), 2)
        self.assertEqual(result["removed"], [])

    def test_rejects_missing_id(self):
        with self.assertRaisesRegex(ValueError, "id"):
            consolidate([{"content": "没有来源的句子。"}])

    def test_workbench_request_accepts_only_explicit_cluster(self):
        result = consolidation_from_body(json.dumps({"memories": [
            {"id": "a", "content": "共同事实。"},
            {"id": "b", "content": "共同事实。新增事实。"},
        ]}, ensure_ascii=False).encode())
        self.assertEqual(result["content"], "共同事实。新增事实。")
        self.assertEqual(result["method"], "deterministic_extractive_v1")

    def test_workbench_request_rejects_empty_or_oversized_cluster(self):
        with self.assertRaisesRegex(ValueError, "non-empty"):
            consolidation_from_body(b'{"memories": []}')
        oversized = {"memories": [{"id": str(index), "content": "x"} for index in range(51)]}
        with self.assertRaisesRegex(ValueError, "too many"):
            consolidation_from_body(json.dumps(oversized).encode())


if __name__ == "__main__":
    unittest.main()
