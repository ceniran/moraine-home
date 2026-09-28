import json
import stat
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from moraine.beta_server import create_beta_server


class BetaServerTest(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        root = Path(self.temporary.name)
        self.root = root
        seed = root / "seed.json"
        seed.write_text(
            json.dumps(
                {
                    "memories": [{"id": "m1", "title": "离线检索", "content": "本地搜索", "state": "active", "importance": 0.5, "occurred_at": "2026-01-02T00:00:00Z"}],
                    "candidates": [{"id": "c1", "title": "补充", "content": "事件补充", "state": "pending", "occurred_at": "2026-01-03T00:00:00Z"}],
                    "events": [],
                }
            ),
            encoding="utf-8",
        )
        web = root / "web"
        web.mkdir()
        (web / "index.html").write_text("<h1>Moraine beta</h1>", encoding="utf-8")
        self.token = "test-token"
        self.server = create_beta_server(
            {
                "MORAINE_BETA_HOST": "127.0.0.1",
                "MORAINE_BETA_PORT": "0",
                "MORAINE_BETA_TOKEN": self.token,
                "MORAINE_BETA_DATA_FILE": str(root / "store.json"),
                "MORAINE_BETA_SEED_FILE": str(seed),
                "MORAINE_BETA_WEB_ROOT": str(web),
            }
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary.cleanup()

    def request(self, path, method="GET", body=None, authenticated=True):
        headers = {"Content-Type": "application/json"}
        if authenticated:
            headers["Authorization"] = f"Bearer {self.token}"
        data = json.dumps(body).encode() if body is not None else None
        request = Request(self.base + path, data=data, headers=headers, method=method)
        with urlopen(request) as response:
            return response.status, json.load(response)

    def test_auth_and_core_http_chain(self):
        with self.assertRaises(HTTPError) as caught:
            self.request("/api/overview", authenticated=False)
        self.assertEqual(caught.exception.code, 401)

        self.assertEqual(self.request("/api/overview")[1]["active"], 1)
        self.assertEqual(self.request("/api/calendar")[1]["items"][0]["date"], "2026-01-02")
        self.assertEqual(self.request("/api/search?query=%E6%A3%80%E7%B4%A2")[1]["mode"], "keyword")
        memory = self.request("/api/candidates/admit", "POST", {"candidate_ids": ["c1"]})[1]
        self.assertEqual(self.request("/api/rollbacks")[1]["items"][0]["id"], memory["rollback"]["id"])
        self.assertEqual(self.request(f"/api/memories/{memory['id']}/importance", "POST", {"importance": 0.9})[1]["importance"], 0.9)
        self.assertEqual(self.request(f"/api/memories/{memory['id']}/archive", "POST", {})[1]["state"], "archived")
        self.assertEqual(self.request(f"/api/memories/{memory['id']}/restore", "POST", {})[1]["state"], "active")
        exported = self.request("/api/export")[1]
        self.assertEqual(self.request("/api/import", "POST", exported)[1]["active"], 2)

        avatar = "data:image/png;base64,iVBORw0KGgo="
        profile = self.request("/api/profile", "POST", {"display_name": "测试小机", "user_display_name": "测试用户", "summary": "合成身份", "avatar": avatar})[1]
        self.assertEqual(profile["display_name"], "测试小机")
        self.assertEqual(profile["user_display_name"], "测试用户")
        self.assertEqual(profile["avatar"], avatar)
        renamed = self.request("/api/profile", "POST", {"display_name": "新名字"})[1]
        self.assertEqual(renamed["user_display_name"], "测试用户")
        self.assertEqual(renamed["avatar"], avatar)
        browser_payload = {key: renamed.get(key, "") for key in ("display_name", "user_display_name", "summary", "avatar")}
        browser_payload["avatar"] = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
        saved_avatar = self.request("/api/profile", "POST", browser_payload)[1]
        self.assertEqual(saved_avatar["avatar"], browser_payload["avatar"])
        self.assertEqual(saved_avatar["display_name"], "新名字")
        relation = self.request("/api/relations", "POST", {"name": "同行者", "relation": "协作者", "note": "合成节点", "summary": "共同测试"})[1]
        self.assertEqual(relation["relation"], "协作者")
        self.assertEqual(self.request("/api/relations")[1]["items"][0]["name"], "同行者")
        graph = self.request("/api/dwell-v2/relations")[1]
        self.assertEqual(graph["edges"][0]["to"], relation["id"])
        self.assertEqual(graph["relationships"][0]["summary"], "共同测试")
        self.assertEqual(self.request(f"/api/relations/{relation['id']}/archive", "POST", {"reason": "合成归档"})[1]["state"], "archived")
        relation_layer = {row["name"]: row for row in self.request("/api/recall/layered?query=%E5%90%8C%E8%A1%8C%E8%80%85")[1]["layers"]}["relations"]
        self.assertEqual(relation_layer["items"], [])
        self.assertEqual(self.request(f"/api/relations/{relation['id']}/restore", "POST", {"reason": "合成恢复"})[1]["state"], "active")
        self.assertEqual(self.request("/api/settings", "POST", {"review_mode": "joint"})[1]["review_mode"], "joint")
        revised = self.request("/api/memories/m1/revise", "POST", {"title": "离线检索修订", "content": "修正后的本地搜索", "reason": "修正表述"})[1]
        self.assertEqual(len(revised["versions"]), 1)
        replaced = self.request("/api/memories/m1/replace", "POST", {"replacement_id": memory["id"], "reason": "事实发生变化"})[1]
        self.assertEqual(replaced["old"]["state"], "superseded")

    def test_profile_policy_and_growth_http_chain(self):
        status, payload = self.request("/api/dwell-v2/profile-recall-policy")
        self.assertEqual(status, 200)
        self.assertTrue(payload["policy"]["connected_to_chat"])
        policy = self.request("/api/dwell-v2/profile-recall-policy", "POST", {"modules": {
            "user_profile": {"conversation_enabled": False, "growth_enabled": True}
        }})[1]["policy"]
        self.assertFalse(policy["modules"]["user_profile"]["conversation_enabled"])
        candidate = self.request("/api/dwell-v2/profile-growth-candidates", "POST", {
            "module": "user_profile", "title": "沟通偏好", "text": "用户希望先给结论",
            "reason": "明确表达", "source_candidate_id": "source-1", "category": "communication",
        })[1]["candidate"]
        pending = self.request("/api/dwell-v2/profile-growth-candidates")[1]["pending"]
        self.assertEqual([row["id"] for row in pending], [candidate["id"]])
        decided = self.request("/api/dwell-v2/profile-growth-candidates/decide", "POST", {
            "candidate_id": candidate["id"], "action": "approve"
        })[1]["candidate"]
        self.assertEqual(decided["state"], "approved")
        self.assertEqual(self.request("/api/user-profile")[1]["items"][0]["text"], "用户希望先给结论")

    def test_settings_page_retention_and_snapshot_adapters(self):
        policy = self.request("/api/dwell-v2/candidate-shred-policy", "POST", {
            "enabled": True, "retention_hours": 48
        })[1]["policy"]
        self.assertEqual(policy, {"enabled": True, "retention_hours": 48})
        self.assertEqual(self.request("/api/dwell-v2/candidate-shred-policy")[1]["policy"], policy)
        snapshot = self.request("/api/dwell-v2/portability/snapshots", "POST", {
            "label": "设置页合成快照"
        })[1]["snapshot"]
        self.assertEqual(self.request("/api/dwell-v2/portability/snapshots")[1]["snapshots"][0]["id"], snapshot["id"])
        self.assertEqual(self.request("/api/dwell-v2/portability/export")[1]["schema"], 1)

    def test_restored_frontend_sections_have_backend_contracts(self):
        self.assertIn("items", self.request("/api/dwell-v2/activities?limit=20")[1])
        self.assertEqual(self.request("/api/dwell-v2/diary")[1]["items"], [])
        governance = self.request("/api/dwell-v2/governance?mode=simulate")[1]
        self.assertEqual(governance["count"], 1)
        self.assertFalse(governance["persisted"])
        policy = self.request("/api/dwell-v2/identity-relation-routing-policy", "POST", {
            "enabled": True, "retain_memory_copy": True
        })[1]["policy"]
        self.assertEqual(policy, {"enabled": True, "retain_memory_copy": True})
        self.assertEqual(self.request("/api/dwell-v2/identity-relation-routing-policy")[1]["policy"], policy)
        self.assertIn("configured", self.request("/api/dwell-v2/jev-settings")[1]["settings"])

    def test_remaining_frontend_contracts_are_real(self):
        thread = self.request("/api/dwell-v2/experience-threads/moraine-project-progress")[1]
        self.assertFalse(thread["persisted"])
        preview = self.request("/api/dwell-v2/migration/preview", "POST", {
            "filename": "memory.json", "content": json.dumps([{"title": "迁入测试", "content": "真实迁入正文"}])
        })[1]
        self.assertEqual(preview["preview"]["counts"]["ready"], 1)
        migrated = self.request("/api/dwell-v2/migration/execute", "POST", {
            "draft_id": preview["draft_id"], "confirmation_code": preview["confirmation_code"]
        })[1]
        self.assertEqual(migrated["imported"], 1)
        snapshot = self.request("/api/dwell-v2/portability/snapshots", "POST", {"label": "恢复测试"})[1]["snapshot"]
        self.assertIn("checksum", snapshot)
        restore = self.request(f"/api/dwell-v2/portability/snapshots/{snapshot['id']}/restore-preview", "POST", {})[1]
        self.assertFalse(restore["persisted"])
        restored = self.request("/api/dwell-v2/portability/restore-execute", "POST", {
            "draft_id": restore["draft_id"], "confirmation_code": restore["confirmation_code"]
        })[1]
        self.assertTrue(restored["ok"])

    def test_public_workbench_core_adapters(self):
        self.assertEqual(self.request("/api/dwell-v2/queue")[1]["queue"]["deferred_source_ids"], [])
        queue = self.request("/api/dwell-v2/queue", "POST", {
            "action": "defer_source", "source_id": "m1"
        })[1]["queue"]
        self.assertEqual(queue["deferred_source_ids"], ["m1"])
        self.assertIn("stages", self.request("/api/dwell-v2/flow")[1])
        self.assertIn("clusters", self.request("/api/dwell-v2/clusters?offset=0")[1])
        self.assertIn("candidates", self.request("/api/dwell-v2/replacements")[1])
        self.assertIn("recycle", self.request("/api/dwell-v2/cleanup")[1])
        self.assertIn("rollbacks", self.request("/api/dwell-v2/rollbacks")[1])

        preview = self.request("/api/dwell-v2/actions/preview", "POST", {
            "action": "content_revision", "memory_id": "m1", "title": "修订标题",
            "content": "修订正文", "reason": "测试修订"
        })[1]
        executed = self.request("/api/dwell-v2/actions/execute", "POST", {
            "draft_id": preview["draft_id"], "confirmation_code": preview["confirmation_code"]
        })[1]
        self.assertEqual(executed["result"]["title"], "修订标题")
    def test_candidate_admission_rollback_http_chain(self):
        memory = self.request("/api/candidates/admit", "POST", {"candidate_ids": ["c1"]})[1]
        result = self.request(f"/api/rollbacks/{memory['rollback']['id']}", "POST", {})[1]
        self.assertEqual(result["removed_memory_id"], memory["id"])
        self.assertEqual(self.request("/api/overview")[1]["candidates"], 1)
        self.assertEqual(self.request("/api/overview")[1]["active"], 1)

    def test_candidate_write_guidance_and_batch_endpoint(self):
        single = self.request("/api/candidates", "POST", {
            "title": "同日第一件事", "content": "完成接口，然后又修复页面",
            "episode_id": "episode_http_synthetic",
        })[1]
        self.assertTrue(single["write_guidance"]["needs_episode_confirmation"])
        self.assertTrue(single["write_guidance"]["possible_multiple_events"])
        batch = self.request("/api/candidates/batch", "POST", {
            "episode_id": "episode_http_batch",
            "episode_complete": True,
            "candidates": [
                {"title": "事件甲", "content": "结果甲"},
                {"title": "事件乙", "content": "结果乙"},
            ],
        })[1]
        self.assertEqual(batch["count"], 2)
        self.assertFalse(batch["write_guidance"]["needs_episode_confirmation"])
        self.assertEqual({row["episode_id"] for row in batch["items"]}, {"episode_http_batch"})

    def test_snapshot_routing_and_retention_http_chain(self):
        settings = self.request("/api/settings", "POST", {
            "identity_relation_routing": True,
            "candidate_retention_enabled": True,
            "candidate_retention_hours": 24,
        })[1]
        self.assertTrue(settings["identity_relation_routing"])
        identity = self.request("/api/candidates", "POST", {"title": "身份", "content": "允许修订", "kind": "identity"})[1]
        routed = self.request(f"/api/candidates/{identity['id']}/route", "POST", {
            "destination": "self_core", "reason": "合成身份由测试确认",
        })[1]
        self.assertEqual(routed["destination"], "self_core")
        snapshot = self.request("/api/snapshots", "POST", {"label": "合成安全点"})[1]
        self.assertEqual(self.request("/api/snapshots")[1]["items"][0]["id"], snapshot["id"])
        self.assertEqual(self.request("/api/candidates/shred", "POST", {})[1]["enabled"], True)

    def test_static_frontend_does_not_require_api_token(self):
        with urlopen(self.base + "/") as response:
            self.assertIn(b"Moraine beta", response.read())

    def test_new_frontend_adapter_reads_public_store(self):
        library = self.request("/api/dwell-v2/library")[1]
        self.assertEqual(library["mode"], "moraine_beta_isolated")
        self.assertEqual(library["memories"][0]["id"], "m1")

    def test_personal_space_is_visible_and_routable(self):
        index = (Path(__file__).parents[1] / "src" / "moraine" / "static" / "index.html").read_text(encoding="utf-8")
        script = (Path(__file__).parents[1] / "src" / "moraine" / "static" / "prototype.js").read_text(encoding="utf-8")
        self.assertIn('class="cairn-entry" type="button" data-view="cairn" aria-label="进入实例空间">', index)
        self.assertIn("['cairn', 'calendar', 'candidates'", script)
        self.assertIn('data-view="activity"', index)
        self.assertNotIn('data-view="review"', index)
        self.assertNotIn('data-view="study"', index)
        self.assertNotIn("'review', 'activity', 'study'", script)
        self.assertNotIn('aria-labelledby="migrationTitle" hidden', index)

    def test_public_feature_copy_has_no_family_names(self):
        static = Path(__file__).parents[1] / "src" / "moraine" / "static"
        index = (static / "index.html").read_text(encoding="utf-8")
        script = (static / "prototype.js").read_text(encoding="utf-8")
        self.assertNotIn("砾砾", index + script)
        self.assertNotIn("恩恩", index + script)
        self.assertNotIn("岑野", index + script)
        self.assertNotIn("Cairn 的反思面", script)
        self.assertIn("Cairn × Xiaoran · Moraine", index)

    def test_visible_auto_weight_control_has_real_action_contract(self):
        preview = self.request("/api/dwell-v2/actions/preview", "POST", {
            "action": "auto_weight", "actor": "system", "reason": "合成检查"
        })[1]
        self.assertFalse(preview["persisted"])
        result = self.request("/api/dwell-v2/actions/execute", "POST", {
            "draft_id": preview["draft_id"], "confirmation_code": preview["confirmation_code"]
        })[1]
        self.assertEqual(result["action"], "auto_weight")

    def test_dwell_v2_read_only_adapter_contracts(self):
        overview = self.request("/api/dwell-v2/overview")[1]
        self.assertEqual(overview["counts"]["effective"], 1)
        self.assertEqual(overview["counts"]["pending_candidates"], 1)
        calendar = self.request("/api/dwell-v2/calendar?month=2026-01")[1]
        self.assertEqual(calendar["events"][0]["open_id"], "m1")
        self.assertEqual(self.request("/api/dwell-v2/relations")[1]["mode"], "moraine_beta_isolated")

    def test_new_frontend_candidate_merge_requires_preview_confirmation(self):
        second = self.request("/api/candidates", "POST", {
            "title": "第二条", "content": "合成补充", "kind": "event",
        })[1]
        preview = self.request("/api/dwell-v2/actions/preview", "POST", {
            "action": "candidate_merge", "candidate_ids": ["c1", second["id"]],
            "master_id": "c1", "member_relations": {second["id"]: "supplement"},
        })[1]
        self.assertFalse(preview["persisted"])
        self.assertEqual(self.request("/api/overview")[1]["active"], 1)
        executed = self.request("/api/dwell-v2/actions/execute", "POST", {
            "draft_id": preview["draft_id"], "confirmation_code": preview["confirmation_code"],
        })[1]
        self.assertEqual(set(executed["concluded_candidate_ids"]), {"c1", second["id"]})
        self.assertEqual(self.request("/api/overview")[1]["active"], 2)

    def test_health_explains_that_authentication_is_required(self):
        status, health = self.request("/api/health", authenticated=False)
        self.assertEqual(status, 200)
        self.assertTrue(health["auth_required"])

    def test_adviser_key_is_separate_from_memory_and_exports(self):
        status = self.request("/api/adviser", "POST", {
            "api_key": "synthetic-adviser-secret",
            "enabled": True,
            "use_for_wakeup": True,
        })[1]
        self.assertEqual(status, {"provider": "jev", "configured": True, "enabled": True, "use_for_wakeup": True})
        self.assertNotIn("synthetic-adviser-secret", json.dumps(status))
        self.assertNotIn("synthetic-adviser-secret", json.dumps(self.request("/api/export")[1]))
        secret_file = self.root / ".adviser-secret.json"
        self.assertTrue(secret_file.exists())
        self.assertEqual(stat.S_IMODE(secret_file.stat().st_mode), 0o600)
        cleared = self.request("/api/adviser", "POST", {"clear_api_key": True, "enabled": False})[1]
        self.assertFalse(cleared["configured"])

    def test_continuity_backend_http_chain(self):
        core = self.request("/api/self-core", "POST", {
            "text": "我是合成Agent", "reason": "合成测试", "source_ids": ["m1"],
        })[1]
        self.assertEqual(self.request("/api/self-core")[1]["items"][0]["id"], core["id"])
        user_profile = self.request("/api/user-profile", "POST", {
            "subject": "测试者", "category": "communication", "text": "喜欢先看结论",
            "reason": "合成测试", "source_ids": ["m1"],
        })[1]
        self.assertEqual(self.request("/api/user-profile")[1]["items"][0]["id"], user_profile["id"])
        relation = self.request("/api/relations", "POST", {
            "name": "测试者", "relation": "协作者", "facts": ["共同验收"],
            "private_note": "不进入召回", "source_ids": ["m1"],
        })[1]
        self.assertEqual(relation["facts"], ["共同验收"])
        settings = self.request("/api/continuity/settings", "POST", {
            "wakeup_enabled": True, "adviser_enabled": True, "max_choices": 2,
        })[1]
        self.assertTrue(settings["wakeup_enabled"])
        self.request("/api/adviser", "POST", {"api_key": "synthetic-key", "enabled": True, "use_for_wakeup": True})
        layered = self.request("/api/recall/layered", "POST", {"query": "测试者"})[1]
        self.assertNotIn("不进入召回", str(layered))
        self.assertIn("喜欢先看结论", str(layered))
        summary = self.request("/api/recall/layered?summary=1")[1]
        self.assertNotIn("我是合成Agent", json.dumps(summary, ensure_ascii=False))
        self.assertTrue(all("items" not in layer and "item_count" in layer for layer in summary["layers"]))
        wakeup = self.request("/api/wakeup/preview", "POST", {
            "signals": [{"id": "mail-1", "kind": "mail", "label": "新邮件", "necessary": True,
                         "share_with_adviser": True}],
            "adviser_enabled": True,
        })[1]
        self.assertFalse(wakeup["executed"])
        self.assertFalse(wakeup["adviser_request"]["can_write_memory"])
        archived_profile = self.request(f"/api/user-profile/{user_profile['id']}/archive", "POST", {"reason": "合成归档"})[1]
        self.assertEqual(archived_profile["state"], "archived")

    def test_tiering_preview_and_confirmed_recent_memory(self):
        candidate = self.request("/api/candidates", "POST", {
            "title": "短期状态", "content": "这周临时调整", "kind": "status",
            "expires_at": "2099-01-01T00:00:00Z",
        })[1]
        preview = self.request("/api/candidates/tiering")[1]
        suggestion = next(row for row in preview["items"] if row["candidate_id"] == candidate["id"])
        self.assertEqual(suggestion["suggested_tier"], "recent")
        self.assertFalse(preview["persisted"])
        memory = self.request("/api/candidates/admit", "POST", {
            "candidate_ids": [candidate["id"]], "memory_tier": "recent",
            "expires_at": "2099-01-01T00:00:00Z",
        })[1]
        self.assertEqual(memory["memory_tier"], "recent")
        layered = self.request("/api/recall/layered", "POST", {"query": "短期"})[1]
        recent = next(layer for layer in layered["layers"] if layer["name"] == "recent")
        self.assertIn(memory["id"], [row["id"] for row in recent["items"]])

    def test_normal_project_candidate_reaches_long_term_without_hidden_counters(self):
        candidate = self.request("/api/candidates", "POST", {
            "title": "公开项目", "content": "完成一个可复核版本", "kind": "project",
        })[1]
        preview = self.request("/api/candidates/tiering")[1]
        suggestion = next(row for row in preview["items"] if row["candidate_id"] == candidate["id"])
        self.assertEqual(suggestion["suggested_tier"], "long_term")
        self.assertTrue(suggestion["actionable"])
        self.assertEqual(suggestion["signals"]["evidence_source"], "store_projection")
        self.assertNotIn("confirmation_count", suggestion["signals"])

if __name__ == "__main__":
    unittest.main()
