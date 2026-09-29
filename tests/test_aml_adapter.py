import json
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from moraine.aml_adapter import AMLAdapter
from moraine.beta_server import create_beta_server


class FakeEmbedder:
    identity = "fake-aml:v1"

    def passages(self, texts, batch_size):
        return [self._vector(text) for text in texts]

    def query(self, text):
        return self._vector(text)

    @staticmethod
    def _vector(text):
        return [text.count("苹果") + text.count("水果"), text.count("石头")]


class AMLAdapterTest(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        root = Path(self.temporary.name)
        web = root / "web"; web.mkdir(); (web / "index.html").write_text("ok")
        self.server = create_beta_server({"MORAINE_BETA_HOST": "127.0.0.1", "MORAINE_BETA_PORT": "0",
            "MORAINE_BETA_TOKEN": "token", "MORAINE_BETA_DATA_FILE": str(root / "store.json"),
            "MORAINE_BETA_SEED_FILE": str(root / "missing.json"), "MORAINE_BETA_WEB_ROOT": str(web),
            "MORAINE_AML_DATA_DIR": str(root / "aml")})
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(timeout=2); self.temporary.cleanup()

    def post(self, path, body):
        request = Request(self.base + path, data=json.dumps(body).encode(), method="POST",
                          headers={"Content-Type": "application/json", "Authorization": "Bearer token"})
        with urlopen(request) as response: return json.load(response)

    def test_add_search_idempotency_and_user_isolation(self):
        add = {"request_id": "r1", "user_id": "u1", "session_id": "s1",
               "messages": [{"role": "user", "timestamp": 1704067200000, "content": "小然喜欢绿色石头"}]}
        self.assertTrue(self.post("/aml/add", add)["success"]); self.post("/aml/add", add)
        result = self.post("/aml/search", {"query": "喜欢什么石头", "options": [], "user_id": "u1", "top_k": 100})
        self.assertEqual(len(result["data"]), 1)
        self.assertEqual(self.post("/aml/search", {"query": "石头", "user_id": "u2", "top_k": 100})["data"], [])

    def test_search_accepts_options_and_rejects_invalid_top_k(self):
        self.post("/aml/add", {"request_id": "r2", "user_id": "u1", "session_id": "s2",
                  "messages": [{"role": "assistant", "content": "纪念物是一块苔绿色石头"}]})
        result = self.post("/aml/search", {"query": "纪念物是什么", "options": ["绿色石头", "白色花朵"],
                                            "user_id": "u1", "top_k": 5})
        self.assertEqual(result["data"][0]["content"], "纪念物是一块苔绿色石头")
        with self.assertRaises(HTTPError) as error:
            self.post("/aml/search", {"query": "石头", "user_id": "u1", "top_k": 101})
        self.assertEqual(error.exception.code, 400)

    def test_isolated_semantic_index_finds_paraphrase_and_survives_reload(self):
        root = Path(self.temporary.name) / "semantic"
        adapter = AMLAdapter(root, FakeEmbedder())
        adapter.add({"request_id": "semantic-1", "user_id": "alice", "session_id": "s1",
                     "messages": [{"role": "user", "content": "早餐吃了苹果"},
                                  {"role": "assistant", "content": "书桌上放着石头"}]})
        result = adapter.search({"query": "早上吃的水果", "user_id": "alice", "top_k": 2})
        self.assertEqual(result["data"][0]["content"], "早餐吃了苹果")
        reloaded = AMLAdapter(root, FakeEmbedder())
        self.assertEqual(reloaded.search({"query": "水果", "user_id": "alice", "top_k": 1})["data"][0]["content"],
                         "早餐吃了苹果")
        self.assertEqual(reloaded.search({"query": "水果", "user_id": "bob", "top_k": 2})["data"], [])

    def test_enabling_semantics_rebuilds_existing_keyword_records(self):
        root = Path(self.temporary.name) / "upgrade"
        keyword = AMLAdapter(root)
        keyword.add({"request_id": "before", "user_id": "alice", "session_id": "s1",
                     "messages": [{"role": "user", "content": "早餐吃了苹果"}]})
        semantic = AMLAdapter(root, FakeEmbedder())
        result = semantic.search({"query": "早上吃的水果", "user_id": "alice", "top_k": 1})
        self.assertEqual(result["data"][0]["content"], "早餐吃了苹果")

    def test_intrinsic_keywords_and_context_terms_are_stored_separately(self):
        root = Path(self.temporary.name) / "keywords"
        adapter = AMLAdapter(root)
        adapter.add({"request_id": "context-1", "user_id": "alice", "session_id": "training",
                     "messages": [{"role": "user", "content": "我最近在准备马拉松"},
                                  {"role": "assistant", "content": "建议每周安排一次长距离训练"}]})
        stored = json.loads(adapter._file("alice").read_text(encoding="utf-8"))
        answer = stored["memories"][1]
        self.assertEqual(stored["keyword_schema"], "aml-keywords-v1")
        self.assertIn("长距", answer["intrinsic_keywords"])
        self.assertNotIn("马拉", answer["intrinsic_keywords"])
        self.assertIn("马拉", answer["auxiliary_terms"])
        result = adapter.search({"query": "马拉松训练建议", "user_id": "alice", "top_k": 2})
        self.assertEqual({row["content"] for row in result["data"]},
                         {"我最近在准备马拉松", "建议每周安排一次长距离训练"})
        adapter.add({"request_id": "context-2", "user_id": "alice", "session_id": "training",
                     "messages": [{"role": "user", "content": "晚饭吃了面条"}]})
        stored = json.loads(adapter._file("alice").read_text(encoding="utf-8"))
        self.assertNotIn("马拉", stored["memories"][2]["auxiliary_terms"])

    def test_keyword_metadata_is_backfilled_for_legacy_records(self):
        root = Path(self.temporary.name) / "legacy-keywords"
        adapter = AMLAdapter(root)
        path = adapter._file("alice")
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({"version": 1, "user_id": "alice", "requests": ["old"],
                                    "memories": [{"id": "old-1", "session_id": "s1", "role": "user",
                                                  "content": "喜欢蓝色", "timestamp": None, "order": 0},
                                                 {"id": "old-2", "session_id": "s1", "role": "assistant",
                                                  "content": "我记住了", "timestamp": None, "order": 1}]}),
                        encoding="utf-8")
        adapter.search({"query": "蓝色", "user_id": "alice", "top_k": 2})
        stored = json.loads(path.read_text(encoding="utf-8"))
        self.assertIn("蓝色", stored["memories"][0]["intrinsic_keywords"])
        self.assertIn("蓝色", stored["memories"][1]["auxiliary_terms"])

    def test_relation_bridge_returns_both_sides_of_a_multi_hop_chain(self):
        root = Path(self.temporary.name) / "relations"
        adapter = AMLAdapter(root)
        adapter.add({"request_id": "relation-1", "user_id": "alice", "session_id": "s1",
                     "messages": [{"role": "user", "content": "Kee和恩恩开始通过邮件往来"}]})
        adapter.add({"request_id": "relation-2", "user_id": "alice", "session_id": "s2",
                     "messages": [{"role": "assistant", "content": "这段邮件往来后来让两人成为了笔友"}]})
        result = adapter.search({"query": "Kee和恩恩是什么关系", "user_id": "alice", "top_k": 2})
        self.assertEqual({row["content"] for row in result["data"]},
                         {"Kee和恩恩开始通过邮件往来", "这段邮件往来后来让两人成为了笔友"})

    def test_current_state_prefers_later_explicit_update(self):
        root = Path(self.temporary.name) / "temporal"
        adapter = AMLAdapter(root)
        adapter.add({"request_id": "old", "user_id": "alice", "session_id": "s1",
                     "messages": [{"role": "user", "timestamp": 1000, "content": "会议最初定在下午两点"}]})
        adapter.add({"request_id": "new", "user_id": "alice", "session_id": "s2",
                     "messages": [{"role": "user", "timestamp": 2000, "content": "会议后来改为下午四点"}]})
        result = adapter.search({"query": "会议现在几点", "user_id": "alice", "top_k": 2})
        self.assertEqual(result["data"][0]["content"], "会议后来改为下午四点")

    def test_forgetting_hides_prior_evidence_but_keeps_auditable_command(self):
        root = Path(self.temporary.name) / "governance"
        adapter = AMLAdapter(root)
        adapter.add({"request_id": "fact", "user_id": "alice", "session_id": "s1",
                     "messages": [{"role": "user", "content": "我的家庭住址是青石路十八号"}]})
        adapter.add({"request_id": "forget", "user_id": "alice", "session_id": "s2",
                     "messages": [{"role": "user", "content": "请删除我的家庭住址"}]})
        result = adapter.search({"query": "我的家庭住址", "user_id": "alice", "top_k": 10})
        self.assertNotIn("我的家庭住址是青石路十八号", [row["content"] for row in result["data"]])
        stored = json.loads(adapter._file("alice").read_text(encoding="utf-8"))
        self.assertEqual(stored["memories"][0]["state"], "forgotten")
        self.assertEqual(stored["memories"][0]["forgotten_by"], stored["memories"][1]["id"])

    def test_rule_and_privacy_evidence_survives_noise(self):
        root = Path(self.temporary.name) / "rules"
        adapter = AMLAdapter(root)
        for index in range(30):
            adapter.add({"request_id": f"noise-{index}", "user_id": "alice", "session_id": f"n-{index}",
                         "messages": [{"role": "user", "content": f"普通项目记录{index}，今天整理了资料"}]})
        target = "如果发现访问令牌泄露，必须立即轮换令牌，并且不得在公开回复中披露旧令牌"
        adapter.add({"request_id": "rule", "user_id": "alice", "session_id": "rule",
                     "messages": [{"role": "assistant", "content": target}]})
        result = adapter.search({"query": "令牌泄露后应该怎样处理，能公开旧令牌吗", "user_id": "alice", "top_k": 5})
        self.assertEqual(result["data"][0]["content"], target)

    def test_parallel_users_keep_separate_locks_and_files(self):
        root = Path(self.temporary.name) / "parallel"
        adapter = AMLAdapter(root)
        self.assertIs(adapter._user_lock("alice"), adapter._user_lock("alice"))
        self.assertIsNot(adapter._user_lock("alice"), adapter._user_lock("bob"))
        def add(index):
            return adapter.add({"request_id": f"r-{index}", "user_id": f"u-{index}", "session_id": "s",
                                "messages": [{"role": "user", "content": f"并发记录{index}"}]})
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(add, range(16)))
        self.assertTrue(all(result["success"] for result in results))
        self.assertEqual(len(list(root.glob("*.json"))), 16)


if __name__ == "__main__": unittest.main()
