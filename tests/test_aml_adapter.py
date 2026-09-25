import json
import threading
import unittest
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


if __name__ == "__main__": unittest.main()
