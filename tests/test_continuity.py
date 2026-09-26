import unittest

from moraine.continuity import build_layered_context, build_wakeup_preview


class ContinuityTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = {
            "self_core_records": [{"id": "core-1", "text": "我是可修订的合成Agent", "source_ids": ["m1"], "state": "active"}],
            "user_profile_records": [{"id": "user-1", "subject": "测试者", "category": "communication",
                                      "text": "喜欢先看结论", "source_ids": ["m1"], "state": "active"}],
            "relations": [{"id": "r1", "name": "测试者", "relation": "协作者", "facts": ["共同验收"],
                           "private_note": "不应进入召回文本", "state": "active"}],
            "memories": [
                {"id": "m1", "title": "近期验收", "content": "测试者共同检查入口", "state": "active", "occurred_at": "2026-09-25"},
                {"id": "m2", "title": "旧版本", "content": "历史内容", "state": "archived", "updated_at": "2026-09-01"},
            ],
            "continuity_settings": {"wakeup_enabled": True, "adviser_enabled": True, "max_choices": 2, "layer_budgets": {}},
        }

    def test_layered_context_is_bounded_and_excludes_private_relation_note(self):
        result = build_layered_context(self.snapshot, query="测试者", include_history=True)
        text = str(result)
        self.assertIn("共同验收", text)
        self.assertIn("喜欢先看结论", text)
        self.assertNotIn("不应进入召回文本", text)
        self.assertTrue(result["recall_is_evidence_not_fact"])
        self.assertFalse(result["persisted"])

    def test_wakeup_adviser_receives_choices_not_memory_content(self):
        result = build_wakeup_preview(self.snapshot, signals=[
            {"id": "mail-1", "kind": "mail", "label": "有一封新邮件", "necessary": True, "share_with_adviser": True},
            {"id": "bad", "kind": "secret", "label": "不允许"},
        ], adviser_enabled=True)
        self.assertEqual(len(result["choices"]), 1)
        request = result["adviser_request"]
        self.assertFalse(request["can_execute"])
        self.assertFalse(request["can_write_memory"])
        self.assertNotIn("近期验收", str(request))

    def test_signal_label_is_not_shared_without_explicit_consent(self):
        result = build_wakeup_preview(self.snapshot, signals=[
            {"id": "mail-1", "kind": "mail", "label": "私人邮件主题", "necessary": True},
        ], adviser_enabled=True)
        self.assertIsNone(result["adviser_request"])
        self.assertNotIn("私人邮件主题", str(result["adviser_request"]))

    def test_total_budget_counts_metadata(self):
        self.snapshot["self_core_records"][0]["source_ids"] = ["x" * 160] * 20
        self.snapshot["self_core_records"][0]["recall_reason"] = "r" * 500
        result = build_layered_context(self.snapshot, total_budget=300)
        self.assertLessEqual(result["used_chars"], 300)
        core = next(layer for layer in result["layers"] if layer["name"] == "self_core")
        self.assertEqual(core["items"], [])

    def test_wakeup_is_disabled_by_default(self):
        self.snapshot["continuity_settings"]["wakeup_enabled"] = False
        result = build_wakeup_preview(self.snapshot, signals=[])
        self.assertFalse(result["enabled"])
        self.assertEqual(result["reason"], "wakeup_disabled")


if __name__ == "__main__":
    unittest.main()
