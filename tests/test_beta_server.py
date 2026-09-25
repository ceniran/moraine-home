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

        profile = self.request("/api/profile", "POST", {"display_name": "测试小机", "summary": "合成身份", "self_core": ["可修订"]})[1]
        self.assertEqual(profile["display_name"], "测试小机")
        relation = self.request("/api/relations", "POST", {"name": "同行者", "relation": "协作者", "note": "合成节点"})[1]
        self.assertEqual(relation["relation"], "协作者")
        self.assertEqual(self.request("/api/relations")[1]["items"][0]["name"], "同行者")
        self.assertEqual(self.request("/api/settings", "POST", {"review_mode": "joint"})[1]["review_mode"], "joint")
        revised = self.request("/api/memories/m1/revise", "POST", {"title": "离线检索修订", "content": "修正后的本地搜索", "reason": "修正表述"})[1]
        self.assertEqual(len(revised["versions"]), 1)
        replaced = self.request("/api/memories/m1/replace", "POST", {"replacement_id": memory["id"], "reason": "事实发生变化"})[1]
        self.assertEqual(replaced["old"]["state"], "superseded")

    def test_candidate_admission_rollback_http_chain(self):
        memory = self.request("/api/candidates/admit", "POST", {"candidate_ids": ["c1"]})[1]
        result = self.request(f"/api/rollbacks/{memory['rollback']['id']}", "POST", {})[1]
        self.assertEqual(result["removed_memory_id"], memory["id"])
        self.assertEqual(self.request("/api/overview")[1]["candidates"], 1)
        self.assertEqual(self.request("/api/overview")[1]["active"], 1)

    def test_snapshot_routing_and_retention_http_chain(self):
        settings = self.request("/api/settings", "POST", {
            "identity_relation_routing": True,
            "candidate_retention_enabled": True,
            "candidate_retention_hours": 24,
        })[1]
        self.assertTrue(settings["identity_relation_routing"])
        identity = self.request("/api/candidates", "POST", {"title": "身份", "content": "允许修订", "kind": "identity"})[1]
        routed = self.request(f"/api/candidates/{identity['id']}/route", "POST", {"destination": "self_core"})[1]
        self.assertEqual(routed["destination"], "self_core")
        snapshot = self.request("/api/snapshots", "POST", {"label": "合成安全点"})[1]
        self.assertEqual(self.request("/api/snapshots")[1]["items"][0]["id"], snapshot["id"])
        self.assertEqual(self.request("/api/candidates/shred", "POST", {})[1]["enabled"], True)

    def test_static_frontend_does_not_require_api_token(self):
        with urlopen(self.base + "/") as response:
            self.assertIn(b"Moraine beta", response.read())

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

if __name__ == "__main__":
    unittest.main()
