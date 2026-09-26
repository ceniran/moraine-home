import json
import os
import sys
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from moraine.beta_server import create_beta_server


class McpToolsTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        root = Path(self.temporary.name)
        seed = root / "seed.json"
        seed.write_text(json.dumps({"memories": [], "candidates": [], "events": []}), encoding="utf-8")
        web = root / "web"
        web.mkdir()
        (web / "index.html").write_text("ok", encoding="utf-8")
        self.server = create_beta_server({
            "MORAINE_BETA_HOST": "127.0.0.1",
            "MORAINE_BETA_PORT": "0",
            "MORAINE_BETA_TOKEN": "synthetic-token",
            "MORAINE_BETA_DATA_FILE": str(root / "store.json"),
            "MORAINE_BETA_SEED_FILE": str(seed),
            "MORAINE_BETA_WEB_ROOT": str(web),
        })
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary.cleanup()

    async def test_tool_chain_matches_workbench_capabilities(self):
        def payload(result):
            if result.structuredContent is not None:
                return result.structuredContent
            return json.loads(result.content[0].text)

        base = f"http://127.0.0.1:{self.server.server_address[1]}"
        env = dict(os.environ)
        env.update({"MORAINE_MCP_URL": base, "MORAINE_BETA_TOKEN": "synthetic-token"})
        parameters = StdioServerParameters(command=sys.executable, args=["-m", "moraine.mcp_server"], env=env)
        async with stdio_client(parameters) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = {tool.name: tool for tool in (await session.list_tools()).tools}
                self.assertEqual(
                    set(tools),
                    {
                        "system_overview", "memory_list", "memory_search", "memory_get",
                        "candidate_list", "candidate_tiering_suggestions", "candidate_add", "candidate_decide", "candidate_route", "candidate_shred_expired",
                        "consolidation_preview", "consolidation_apply",
                        "rollback_list", "consolidation_rollback",
                        "memory_set_archived", "memory_set_importance", "memory_revise", "memory_replace",
                        "event_list", "calendar_list", "profile_get", "profile_update",
                        "self_core_list", "self_core_upsert", "self_core_set_archived",
                        "user_profile_list", "user_profile_upsert", "user_profile_set_archived",
                        "relation_list", "relation_upsert", "layered_recall", "wakeup_preview",
                        "continuity_settings_get", "continuity_settings_update", "settings_get", "settings_update",
                        "snapshot_list", "snapshot_create", "snapshot_restore",
                        "store_export", "store_import",
                    },
                )

                added = await session.call_tool("candidate_add", {"title": "合成事件", "content": "只用于MCP验收", "tags": ["synthetic"]})
                candidate = payload(added)
                tiering = await session.call_tool("candidate_tiering_suggestions", {})
                self.assertEqual(payload(tiering)["items"][0]["suggested_tier"], "uncertain")
                preview = await session.call_tool("consolidation_preview", {"candidate_ids": [candidate["id"]]})
                self.assertFalse(payload(preview)["persisted"])

                applied = await session.call_tool("consolidation_apply", {"candidate_ids": [candidate["id"]]})
                memory = payload(applied)
                fetched = await session.call_tool("memory_get", {"memory_id": memory["id"]})
                self.assertEqual(payload(fetched)["content"], "只用于MCP验收")

                weighted = await session.call_tool("memory_set_importance", {"memory_id": memory["id"], "importance": 0.8})
                self.assertEqual(payload(weighted)["importance"], 0.8)
                revised = await session.call_tool("memory_revise", {"memory_id": memory["id"], "title": "合成事件修订", "content": "修订后的合成正文", "reason": "协议验收"})
                self.assertEqual(len(payload(revised)["versions"]), 1)

                second_added = await session.call_tool("candidate_add", {"title": "后来变化", "content": "新的合成状态"})
                second_candidate = payload(second_added)
                second_applied = await session.call_tool("consolidation_apply", {"candidate_ids": [second_candidate["id"]]})
                replacement = payload(second_applied)
                replaced = await session.call_tool("memory_replace", {"memory_id": memory["id"], "replacement_id": replacement["id"], "reason": "合成事实后来改变"})
                self.assertEqual(payload(replaced)["old"]["state"], "superseded")

                archived = await session.call_tool("memory_set_archived", {"memory_id": replacement["id"], "archived": True})
                self.assertEqual(payload(archived)["state"], "archived")
                restored = await session.call_tool("memory_set_archived", {"memory_id": replacement["id"], "archived": False})
                self.assertEqual(payload(restored)["state"], "active")

                ignored_added = await session.call_tool("candidate_add", {"title": "暂不保存", "content": "可恢复的候选"})
                ignored_candidate = payload(ignored_added)
                ignored = await session.call_tool("candidate_decide", {"candidate_id": ignored_candidate["id"], "action": "ignore"})
                self.assertEqual(payload(ignored)["state"], "ignored")
                restored_candidate = await session.call_tool("candidate_decide", {"candidate_id": ignored_candidate["id"], "action": "restore"})
                self.assertEqual(payload(restored_candidate)["state"], "pending")

                rollback_added = payload(await session.call_tool("candidate_add", {"title": "可撤回整合", "content": "合成回退验收"}))
                rollback_applied = payload(await session.call_tool("consolidation_apply", {"candidate_ids": [rollback_added["id"]]}))
                receipts = payload(await session.call_tool("rollback_list", {}))["items"]
                self.assertIn(rollback_applied["rollback"]["id"], {row["id"] for row in receipts})
                rolled_back = payload(await session.call_tool("consolidation_rollback", {"rollback_id": rollback_applied["rollback"]["id"]}))
                self.assertEqual(rolled_back["restored_candidate_ids"], [rollback_added["id"]])

                profile = await session.call_tool("profile_update", {"display_name": "测试小机", "summary": "合成资料"})
                self.assertEqual(payload(profile)["display_name"], "测试小机")
                relation = await session.call_tool("relation_upsert", {"name": "测试同行者", "relation": "协作者", "note": "合成关系"})
                self.assertEqual(payload(relation)["relation"], "协作者")
                core = payload(await session.call_tool("self_core_upsert", {
                    "text": "我是可修订的合成Agent", "reason": "MCP协议验收", "source_ids": [memory["id"]],
                }))
                self.assertEqual(len(payload(await session.call_tool("self_core_list", {}))["items"]), 1)
                user_profile = payload(await session.call_tool("user_profile_upsert", {
                    "subject": "测试者", "category": "communication", "text": "喜欢先看结论",
                    "reason": "MCP协议验收", "source_ids": [memory["id"]],
                }))
                self.assertEqual(len(payload(await session.call_tool("user_profile_list", {}))["items"]), 1)
                layered = payload(await session.call_tool("layered_recall", {"query": "测试同行者"}))
                self.assertTrue(layered["recall_is_evidence_not_fact"])
                continuity = payload(await session.call_tool("continuity_settings_update", {
                    "wakeup_enabled": True, "adviser_enabled": False, "max_choices": 2,
                }))
                self.assertTrue(continuity["wakeup_enabled"])
                wakeup = payload(await session.call_tool("wakeup_preview", {
                    "signals": [{"id": "mail-1", "kind": "mail", "label": "合成新邮件"}],
                }))
                self.assertFalse(wakeup["executed"])
                archived_core = payload(await session.call_tool("self_core_set_archived", {
                    "record_id": core["id"], "archived": True, "reason": "协议验收",
                }))
                self.assertEqual(archived_core["state"], "archived")
                archived_user = payload(await session.call_tool("user_profile_set_archived", {
                    "record_id": user_profile["id"], "archived": True, "reason": "协议验收",
                }))
                self.assertEqual(archived_user["state"], "archived")
                settings = await session.call_tool("settings_update", {"review_mode": "joint"})
                self.assertEqual(payload(settings)["review_mode"], "joint")

                exported = payload(await session.call_tool("store_export", {}))
                self.assertEqual(exported["profile"]["display_name"], "测试小机")
                imported = await session.call_tool("store_import", {"payload": exported})
                self.assertGreaterEqual(payload(imported)["active"], 1)

                self.assertGreaterEqual(payload(await session.call_tool("system_overview", {}))["total"], 2)
                self.assertGreaterEqual(len(payload(await session.call_tool("memory_list", {"state": "all"}))["items"]), 2)
                self.assertGreaterEqual(len(payload(await session.call_tool("event_list", {"limit": 20}))["items"]), 1)
                self.assertGreaterEqual(len(payload(await session.call_tool("calendar_list", {}))["items"]), 1)
                self.assertEqual(payload(await session.call_tool("profile_get", {}))["display_name"], "测试小机")
                self.assertEqual(len(payload(await session.call_tool("relation_list", {}))["items"]), 1)
                self.assertEqual(payload(await session.call_tool("settings_get", {}))["review_mode"], "joint")


if __name__ == "__main__":
    unittest.main()
