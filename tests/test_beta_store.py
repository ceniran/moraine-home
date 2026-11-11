import json
import unittest
from datetime import datetime, timedelta
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

    def test_profile_policy_controls_layered_recall_and_reviewed_growth(self):
        store = make_store(self.root)
        store.upsert_self_core({"text": "我偏好先核对来源", "reason": "稳定选择", "source_ids": ["event-1"]})
        store.upsert_user_profile({"text": "用户喜欢简洁说明", "reason": "用户明确表达",
                                   "source_ids": ["event-2"], "category": "communication"})
        store.update_profile({"display_name": "测试小机", "user_display_name": "测试用户"})
        context = store.layered_context()
        self.assertEqual(context["subjects"], {"agent": "测试小机", "user": "测试用户"})
        layers = {row["name"]: row for row in context["layers"]}
        self.assertEqual(len(layers["self_core"]["items"]), 1)
        self.assertEqual(len(layers["user_profile"]["items"]), 1)

        policy = store.update_profile_recall_policy({"modules": {
            "agent_profile": {"conversation_enabled": False, "growth_enabled": True},
            "user_profile": {"conversation_enabled": True, "growth_enabled": True},
        }})
        self.assertFalse(policy["modules"]["agent_profile"]["conversation_enabled"])
        layers = {row["name"]: row for row in store.layered_context()["layers"]}
        self.assertEqual(layers["self_core"]["items"], [])
        self.assertEqual(len(layers["user_profile"]["items"]), 1)

        candidate = store.add_profile_growth_candidate({
            "module": "user_profile", "title": "新的协作偏好", "text": "用户希望先给结论",
            "reason": "多次明确表达", "source_candidate_id": "candidate-1", "category": "communication",
        })
        decided = store.decide_profile_growth_candidate(candidate["id"], "approve")
        self.assertEqual(decided["state"], "approved")
        self.assertTrue(any(row["text"] == "用户希望先给结论" for row in store.list_user_profile()))

    def test_relationship_candidate_reaches_protected_review_but_is_not_written(self):
        store = make_store(self.root)
        candidate = store.add_candidate({"title": "我接受林舟的长期同行邀请",
            "content": "我确认彼此选择，并愿意继续协作、共同生活。",
            "kind": "relationship", "importance": 0.8})
        self.assertTrue(candidate["admission"]["eligible"])
        self.assertEqual(candidate["admission"]["status"], "protected_review_ready")
        self.assertFalse(candidate["admission"]["automatic_persistence"])
        self.assertEqual(store.list_memories(), [])

    def test_low_signal_chat_stays_held(self):
        store = make_store(self.root)
        candidate = store.add_candidate({"title": "普通聊天", "content": "你好", "kind": "event"})
        self.assertEqual(candidate["admission"]["status"], "held_low_signal")

    def test_emotion_keywords_are_optional_ordinary_multi_tags(self):
        store = make_store(self.root)
        plain = store.add_candidate({"title": "散步", "content": "沿着河边走了一圈"})
        tagged = store.add_candidate({"title": "争执后的修复", "content": "我们吵过，也认真和好了",
                                      "tags": ["关系"], "emotion_keywords": ["难过", "释然", "难过"]})
        self.assertEqual(plain["tags"], [])
        self.assertEqual(tagged["tags"], ["关系", "难过", "释然"])
        self.assertNotIn("emotion_keywords", tagged)

    def test_agent_can_directly_admit_without_reason_and_keep_rollback(self):
        store = make_store(self.root)
        result = store.submit_memory({"title": "我自己的选择", "content": "我决定把它留下",
                                      "kind": "identity", "admission_mode": "direct"})
        self.assertEqual(result["admission_mode"], "direct")
        self.assertEqual(result["memory"]["admission"]["mode"], "direct")
        self.assertEqual(result["memory"]["admission"]["selected_by"], "agent")
        self.assertEqual(store.overview()["candidates"], 0)
        self.assertTrue(result["memory"]["rollback"]["id"])

    def test_automatic_batch_admits_eligible_unprotected_only(self):
        store = make_store(self.root)
        durable = store.add_candidate({"title": "发布决定", "content": "我决定完成发布，今后继续维护",
                                       "kind": "decision"})
        protected = store.add_candidate({"title": "关系约定", "content": "我们确认关系并约定共同生活",
                                         "kind": "relationship", "importance": 0.9})
        low = store.add_candidate({"title": "一句话", "content": "早上好"})
        self.assertTrue(durable["admission"]["automatic_persistence"])
        self.assertFalse(protected["admission"]["automatic_persistence"])
        result = store.run_automatic_admission(force=True)
        self.assertEqual([row["candidate_id"] for row in result["admitted"]], [durable["id"]])
        states = {row["id"]: row["state"] for row in store.list_candidates()}
        self.assertEqual(states[durable["id"]], "admitted")
        self.assertEqual(states[protected["id"]], "pending")
        self.assertEqual(states[low["id"]], "pending")
        self.assertEqual(store.list_memories()[0]["admission"]["mode"], "automatic")

    def test_automatic_batch_waits_for_next_configured_time(self):
        store = make_store(self.root)
        created = datetime.fromisoformat(
            store.snapshot()["created_at"].replace("Z", "+00:00"))
        self.assertFalse(store.automatic_admission_status(created + timedelta(seconds=1))["due"])

    def test_candidate_keywords_are_structured_read_only_evidence(self):
        store = make_store(self.root)
        candidate = store.add_candidate({
            "title": "Moraine 部署完成",
            "content": "2026年10月5日已部署 Moraine，当前运行正常。",
            "tags": ["Moraine", "project"],
            "object_keys": ["Moraine"],
            "action_keys": ["部署"],
            "occurred_at": "2026-10-05T08:00:00+08:00",
        })

        stored = store.snapshot()["candidates"][0]
        self.assertNotIn("structured_keywords", stored)
        keywords = store.list_candidates()[0]["structured_keywords"]
        self.assertEqual(keywords["schema"], "candidate-keywords-v2")
        self.assertEqual(keywords["entities"], ["Moraine"])
        self.assertEqual(keywords["entity_details"][0]["type"], "object")
        self.assertIn("部署", keywords["actions"])
        self.assertIn("已部署", keywords["states"])
        self.assertIn("运行正常", keywords["states"])
        self.assertEqual(keywords["dates"], ["2026年10月5日", "2026-10-05"])
        self.assertFalse(keywords["persisted"])
        self.assertFalse(keywords["affects_recall"])

    def test_candidate_entities_keep_named_evidence_and_drop_plain_english(self):
        store = make_store(self.root)
        store.add_candidate({
            "title": "给林舟发送《项目复盘》",
            "content": "I will send the letter through agent_mail to Rowan and review it later.",
            "kind": "relationship",
            "tags": ["林舟", "relationship"],
        })

        keywords = store.list_candidates()[0]["structured_keywords"]
        self.assertIn("林舟", keywords["entities"])
        self.assertIn("项目复盘", keywords["entities"])
        self.assertIn("agent_mail", keywords["entities"])
        self.assertIn("Rowan", keywords["entities"])
        self.assertNotIn("send", keywords["entities"])
        details = {item["term"]: item for item in keywords["entity_details"]}
        self.assertEqual(details["林舟"]["type"], "person")
        self.assertEqual(details["项目复盘"]["source"], "titled_phrase")

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

    def test_memory_usage_echoes_are_append_only_sidecar_evidence(self):
        store = make_store(self.root)
        candidate = store.add_candidate({"title": "草图失败经验", "content": "下次先核验天气与成果规则"})
        memory = store.admit([candidate["id"]])

        echo = store.add_memory_usage_echo({
            "memory_ids": [memory["id"]],
            "effect": "helped",
            "action": "出发前核验天气和交付条件",
            "result": "避免重复消耗路线记录",
            "actor": "test-agent",
            "retrieval_id": "synthetic-recall-1",
        })

        self.assertEqual(echo["memory_ids"], [memory["id"]])
        self.assertFalse(echo["affects_importance"])
        summary = store.memory_usage_echo_summary(memory["id"])
        self.assertEqual(summary["total"], 1)
        self.assertEqual(summary["changed_action_count"], 1)
        self.assertEqual(summary["counts"]["helped"], 1)
        self.assertEqual(store.list_memories("active")[0]["content"], "下次先核验天气与成果规则")
        self.assertEqual(store.list_memories("active")[0]["importance"], memory["importance"])
        self.assertEqual(store.recent_memory_usage_echoes(1)[0]["memories"][0]["title"], "草图失败经验")

    def test_memory_usage_echo_rejects_unknown_memory_and_effect(self):
        store = make_store(self.root)
        with self.assertRaises(KeyError):
            store.add_memory_usage_echo({"memory_ids": ["missing"], "effect": "helped", "action": "测试"})
        candidate = store.add_candidate({"title": "合成记忆", "content": "测试正文"})
        memory = store.admit([candidate["id"]])
        with self.assertRaisesRegex(ValueError, "valid effect"):
            store.add_memory_usage_echo({"memory_ids": [memory["id"]], "effect": "excellent", "action": "测试"})

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

    def test_candidate_persists_layer_evidence_and_safe_admission_auto_layers(self):
        store = make_store(self.root)
        candidate = store.add_candidate({"title": "项目更新", "content": "已经完成并发布长期维护入口",
                                         "kind": "event"},
                                        semantic_neighbors=[{"id": "m1", "memory_tier": "long_term", "score": 0.9}],
                                        semantic_mode="semantic")
        self.assertEqual(candidate["tiering"]["suggested_tier"], "long_term")
        self.assertEqual(candidate["tiering"]["confidence"], "high")
        memory = store.admit([candidate["id"]])
        self.assertEqual(memory["memory_tier"], "long_term")
        self.assertEqual(memory["tier_source"], "automatic_keyword_semantic_evidence")

    def test_protected_candidate_is_never_auto_layered(self):
        store = make_store(self.root)
        candidate = store.add_candidate({"title": "关系设想", "content": "如果以后成为伴侣怎么办", "kind": "event"})
        memory = store.admit([candidate["id"]])
        self.assertNotIn("memory_tier", memory)

    def test_profile_self_core_relations_and_export_round_trip(self):
        store = make_store(self.root)
        profile = store.update_profile({
            "display_name": "测试小机",
            "summary": "只使用合成资料",
        })
        relation = store.upsert_relation({"name": "测试同行者", "relation": "协作者", "note": "合成关系",
                                          "summary": "共同测试", "continuity": "继续核对",
                                          "source_ids": ["source-relation"]})
        revised_relation = store.upsert_relation({"id": relation["id"], "name": "测试同行者",
                                                   "relation": "长期协作者", "summary": "形成稳定协作"})
        user_profile = store.upsert_user_profile({"subject": "测试同行者", "category": "preference",
                                                  "text": "喜欢先看结论", "reason": "合成确认",
                                                  "source_ids": ["source-profile"]})
        settings = store.update_settings({"review_mode": "joint"})
        self.assertEqual(profile["self_core"], [])
        with self.assertRaisesRegex(ValueError, "legacy"):
            store.update_profile({"display_name": "测试小机", "summary": "合成资料", "self_core": ["无出处身份"]})
        self.assertEqual(store.list_relations()[0]["id"], relation["id"])
        self.assertEqual(len(revised_relation["versions"]), 1)
        self.assertEqual(revised_relation["source_ids"], ["source-relation"])
        store.set_relation_archived(relation["id"], True, "合成归档")
        self.assertEqual(store.list_relations("active"), [])
        store.set_relation_archived(relation["id"], False, "合成恢复")
        self.assertEqual(len(store.layered_context("测试同行者")["layers"][2]["items"]), 1)
        self.assertEqual(settings["review_mode"], "joint")

        second = make_store(self.root / "identity-copy")
        second.replace_all(store.snapshot())
        self.assertEqual(second.profile()["display_name"], "测试小机")
        self.assertEqual(second.list_relations()[0]["name"], "测试同行者")
        self.assertEqual(second.list_user_profile()[0]["id"], user_profile["id"])
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
        with self.assertRaisesRegex(ValueError, "reason"):
            store.route_candidate(identity["id"], "self_core")
        store.route_candidate(identity["id"], "self_core", {"reason": "用户确认的身份陈述"})
        self.assertEqual(store.list_self_core()[0]["text"], "我允许自己改变。")
        recalled = store.layered_context()
        self_core = next(layer for layer in recalled["layers"] if layer["name"] == "self_core")
        self.assertEqual(self_core["items"][0]["text"], "我允许自己改变。")
        self.assertEqual(self_core["items"][0]["source_ids"], [identity["id"]])
        relation = store.add_candidate({"title": "同行者", "content": "共同做项目", "kind": "relationship"})
        store.route_candidate(relation["id"], "relation", {"name": "同行者", "relation": "协作者"})
        self.assertEqual(store.list_relations()[0]["relation"], "协作者")
        preference = store.add_candidate({"title": "沟通偏好", "content": "喜欢先看结论", "kind": "preference"})
        store.route_candidate(preference["id"], "user_profile", {"subject": "同行者", "category": "communication",
                                                                   "reason": "对方明确说明"})
        self.assertEqual(store.list_user_profile()[0]["text"], "喜欢先看结论")
        result = store.layered_context(query="共同做项目")
        relations = next(layer for layer in result["layers"] if layer["name"] == "relations")
        self.assertEqual(relations["items"], [])

    def test_requested_layer_budgets_can_only_reduce_configuration(self):
        store = make_store(self.root)
        store.update_continuity_settings({"total_budget": 400, "layer_budgets": {"recent": 120}})
        result = store.layered_context(budgets={"recent": 20000})
        recent = next(layer for layer in result["layers"] if layer["name"] == "recent")
        self.assertEqual(recent["budget"], 120)
        self.assertEqual(result["total_budget"], 400)

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

    def test_versioned_self_core_relation_and_wakeup_preview(self):
        store = make_store(self.root)
        core = store.upsert_self_core({"text": "我是合成Agent", "reason": "首次认领", "source_ids": ["source-1"]})
        revised = store.upsert_self_core({"id": core["id"], "text": "我是可修订的合成Agent", "reason": "补充边界",
                                          "source_ids": ["source-1", "source-2"]})
        self.assertEqual(len(revised["versions"]), 1)
        user_profile = store.upsert_user_profile({"subject": "测试者", "category": "boundary",
                                                  "text": "只使用合成资料", "reason": "明确边界",
                                                  "source_ids": ["source-user-1"]})
        revised_user = store.upsert_user_profile({"id": user_profile["id"], "subject": "测试者",
                                                  "category": "boundary", "text": "只在本地使用合成资料",
                                                  "reason": "边界修订", "source_ids": ["source-user-2"]})
        self.assertEqual(len(revised_user["versions"]), 1)
        relation = store.upsert_relation({"name": "测试者", "relation": "协作者", "facts": ["共同验收"],
                                          "private_note": "不公开", "source_ids": ["source-3"]})
        self.assertEqual(relation["facts"], ["共同验收"])
        disabled = store.wakeup_preview([{"id": "mail-1", "kind": "mail", "label": "新邮件"}])
        self.assertFalse(disabled["enabled"])
        store.update_continuity_settings({"wakeup_enabled": True, "adviser_enabled": True})
        preview = store.wakeup_preview([{"id": "mail-1", "kind": "mail", "label": "新邮件",
                                         "share_with_adviser": True}], adviser_enabled=True)
        self.assertTrue(preview["enabled"])
        self.assertNotIn("不公开", str(preview["context"]))
        self.assertFalse(preview["adviser_request"]["can_execute"])


if __name__ == "__main__":
    unittest.main()
