import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from moraine.beta_store import BetaStore


def make_store(root: Path):
    root.mkdir(parents=True, exist_ok=True)
    seed = root / "seed.json"
    seed.write_text(json.dumps({"memories": [], "candidates": [], "events": []}), encoding="utf-8")
    return BetaStore(root / "store.json", seed)


class BetaStoreTest(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_candidate_admission_and_timeline(self):
        store = make_store(self.root)
        later = store.add_candidate({"title": "后来", "content": "第二段", "occurred_at": "2026-02-02T00:00:00Z", "basket": "demo"})
        earlier = store.add_candidate({"title": "起点", "content": "第一段", "occurred_at": "2026-02-01T00:00:00Z", "basket": "demo"})
        memory = store.admit([later["id"], earlier["id"]], title="完整事件")
        self.assertEqual(memory["content"], "第一段第二段")
        self.assertEqual([row["title"] for row in memory["timeline"]], ["起点", "后来"])
        self.assertEqual(memory["consolidation"]["method"], "deterministic_extractive_v1")
        self.assertEqual(store.overview()["candidates"], 0)
        self.assertEqual(store.overview()["active"], 1)

    def test_candidate_admission_can_be_fully_rolled_back(self):
        store = make_store(self.root)
        first = store.add_candidate({"title": "第一段", "content": "起点"})
        related = store.add_candidate({"title": "旁支", "content": "只关联"})
        before = store.snapshot()["candidates"]
        memory = store.admit(
            [first["id"], related["id"]],
            relations={first["id"]: "supplement", related["id"]: "related_only"},
        )
        receipt = memory["rollback"]
        self.assertEqual(store.list_rollbacks()[0]["id"], receipt["id"])
        result = store.rollback_candidate_admission(receipt["id"])
        self.assertEqual(result["removed_memory_id"], memory["id"])
        self.assertEqual(store.snapshot()["candidates"], before)
        self.assertEqual(store.overview()["active"], 0)
        self.assertEqual(store.list_rollbacks(), [])
        self.assertIn("candidate_admission_rolled_back", [event["type"] for event in store.list_events()])

    def test_candidate_admission_rollback_refuses_newer_changes(self):
        store = make_store(self.root)
        candidate = store.add_candidate({"title": "将被整合", "content": "正文"})
        memory = store.admit([candidate["id"]])
        store.set_importance(memory["id"], 0.9)
        with self.assertRaisesRegex(ValueError, "newer memory change"):
            store.rollback_candidate_admission(memory["rollback"]["id"])

    def test_archive_restore_and_portable_round_trip(self):
        store = make_store(self.root)
        candidate = store.add_candidate({"title": "可恢复", "content": "正文"})
        memory = store.admit([candidate["id"]])
        self.assertEqual(store.set_archive(memory["id"], True)["state"], "archived")
        self.assertEqual(store.set_archive(memory["id"], False)["state"], "active")
        second = make_store(self.root / "second")
        second.replace_all(store.snapshot())
        self.assertEqual(second.snapshot()["memories"][0]["title"], "可恢复")

    def test_rejects_incomplete_candidate(self):
        store = make_store(self.root)
        with self.assertRaises(ValueError):
            store.add_candidate({"title": "没有正文"})

    def test_calendar_search_weight_and_ignore(self):
        store = make_store(self.root)
        first = store.add_candidate({"title": "本地向量检索", "content": "完成第一次离线搜索", "occurred_at": "2026-03-04T01:00:00Z"})
        ignored = store.add_candidate({"title": "不保存", "content": "只是临时测试"})
        memory = store.admit([first["id"]])
        self.assertEqual(store.calendar(), [{"date": "2026-03-04", "count": 1}])
        self.assertEqual(store.keyword_search("向量")[0]["id"], memory["id"])
        self.assertEqual(store.set_importance(memory["id"], 0.83)["importance"], 0.83)
        self.assertEqual(store.decide_candidate(ignored["id"], "ignore")["state"], "ignored")
        self.assertEqual(store.decide_candidate(ignored["id"], "restore")["state"], "pending")

    def test_import_creates_recovery_snapshot(self):
        store = make_store(self.root)
        store.add_candidate({"title": "导入前", "content": "需要保留"})
        exported = store.snapshot()
        exported["candidates"] = []
        store.replace_all(exported)
        backups = list((self.root / "snapshots").glob("before-import-*.json"))
        self.assertEqual(len(backups), 1)
        previous = json.loads(backups[0].read_text(encoding="utf-8"))
        self.assertEqual(previous["candidates"][0]["title"], "导入前")

    def test_consolidation_preview_is_zero_write_and_deduplicates(self):
        store = make_store(self.root)
        one = store.add_candidate({"title": "第一条", "content": "共同事实。独有事实一。"})
        two = store.add_candidate({"title": "第二条", "content": "共同事实。独有事实二。"})
        before = store.snapshot()
        preview = store.consolidation_preview([one["id"], two["id"]])
        self.assertFalse(preview["persisted"])
        self.assertEqual(len(preview["removed"]), 1)
        self.assertEqual(store.snapshot(), before)

    def test_profile_self_core_relations_and_export_round_trip(self):
        store = make_store(self.root)
        profile = store.update_profile({
            "display_name": "测试小机",
            "summary": "只使用合成资料",
            "self_core": ["我可以修改自己的定义。", "私人内容默认不公开。"],
        })
        relation = store.upsert_relation({"name": "测试同行者", "relation": "协作者", "note": "合成关系"})
        settings = store.update_settings({"review_mode": "joint"})
        self.assertEqual(profile["self_core"][0], "我可以修改自己的定义。")
        self.assertEqual(store.list_relations()[0]["id"], relation["id"])
        self.assertEqual(settings["review_mode"], "joint")

        second = make_store(self.root / "identity-copy")
        second.replace_all(store.snapshot())
        self.assertEqual(second.profile()["display_name"], "测试小机")
        self.assertEqual(second.list_relations()[0]["name"], "测试同行者")
        self.assertEqual(second.settings()["review_mode"], "joint")

    def test_legacy_jev_setting_is_ignored_on_import(self):
        store = make_store(self.root)
        exported = store.snapshot()
        exported["settings"]["jev_enabled"] = True
        exported["settings"]["jev_endpoint"] = "https://example.invalid"
        second = make_store(self.root / "legacy-settings")
        second.replace_all(exported)
        self.assertEqual(second.settings()["review_mode"], "autonomous")
        self.assertFalse(second.settings()["candidate_retention_enabled"])
        self.assertNotIn("jev_enabled", second.snapshot()["settings"])

    def test_snapshot_create_list_and_restore(self):
        store = make_store(self.root)
        store.add_candidate({"title": "快照前", "content": "应被恢复"})
        snapshot = store.create_snapshot("手动安全点")
        store.add_candidate({"title": "快照后", "content": "恢复后应消失"})
        self.assertEqual(store.list_snapshots()[0]["id"], snapshot["id"])
        store.restore_snapshot(snapshot["id"])
        self.assertEqual([row["title"] for row in store.list_candidates()], ["快照前"])

    def test_identity_relation_routing_is_opt_in(self):
        store = make_store(self.root)
        identity = store.add_candidate({"title": "身份", "content": "我允许自己改变。", "kind": "identity"})
        with self.assertRaisesRegex(ValueError, "disabled"):
            store.route_candidate(identity["id"], "self_core")
        store.update_settings({"identity_relation_routing": True})
        store.route_candidate(identity["id"], "self_core")
        self.assertIn("我允许自己改变。", store.profile()["self_core"])
        relation = store.add_candidate({"title": "同行者", "content": "共同做项目", "kind": "relationship"})
        store.route_candidate(relation["id"], "relation", {"name": "同行者", "relation": "协作者"})
        self.assertEqual(store.list_relations()[0]["relation"], "协作者")

    def test_candidate_retention_shreds_only_eligible_content(self):
        store = make_store(self.root)
        pending = store.add_candidate({"title": "仍待审", "content": "不能粉碎"})
        concluded = store.add_candidate({"title": "已忽略", "content": "到期后粉碎"})
        store.decide_candidate(concluded["id"], "ignore")
        with store.lock:
            data = store._read()
            next(row for row in data["candidates"] if row["id"] == concluded["id"])["decided_at"] = "2020-01-01T00:00:00Z"
            store._save(data)
        store.update_settings({"candidate_retention_enabled": True, "candidate_retention_hours": 24})
        result = store.shred_eligible_candidates()
        self.assertEqual(result["candidate_ids"], [concluded["id"]])
        rows = {row["id"]: row for row in store.list_candidates()}
        self.assertEqual(rows[pending["id"]]["content"], "不能粉碎")
        self.assertNotIn("content", rows[concluded["id"]])

    def test_relation_aware_merge_revision_and_replacement(self):
        store = make_store(self.root)
        base = store.add_candidate({"title": "起点", "content": "最初状态。", "occurred_at": "2026-01-01T00:00:00Z"})
        changed = store.add_candidate({"title": "后来", "content": "现在状态。", "occurred_at": "2026-02-01T00:00:00Z"})
        conflict = store.add_candidate({"title": "异议", "content": "另一来源不同意。", "occurred_at": "2026-02-02T00:00:00Z"})
        related = store.add_candidate({"title": "旁支", "content": "只建立关联。", "occurred_at": "2026-02-03T00:00:00Z"})
        relations = {base["id"]: "supplement", changed["id"]: "evolution", conflict["id"]: "conflict", related["id"]: "related_only"}
        preview = store.consolidation_preview(list(relations), relations)
        self.assertIn("【发展时间线】", preview["content"])
        self.assertIn("【未决冲突】", preview["content"])
        self.assertEqual(preview["associations"], [related["id"]])
        memory = store.admit(list(relations), relations=relations)
        self.assertNotIn(related["id"], memory["source_candidate_ids"])
        self.assertEqual(next(row for row in store.list_candidates() if row["id"] == related["id"])["state"], "associated")

        revised = store.revise_memory(memory["id"], title="修正标题", content="修正正文", reason="原记录有误")
        self.assertEqual(revised["versions"][0]["content"], memory["content"])
        other_candidate = store.add_candidate({"title": "新事实", "content": "事实后来变化。"})
        replacement = store.admit([other_candidate["id"]])
        result = store.replace_memory(memory["id"], replacement["id"], "事实后来变化")
        self.assertEqual(result["old"]["state"], "superseded")
        self.assertEqual(store.list_memories("historical")[0]["superseded_by"], replacement["id"])


if __name__ == "__main__":
    unittest.main()
