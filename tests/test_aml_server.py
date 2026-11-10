import json
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from moraine.aml_server import create_aml_server


class AMLServerTest(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.server = create_aml_server({
            "MORAINE_AML_HOST": "127.0.0.1", "MORAINE_AML_PORT": "0",
            "MORAINE_AML_TOKEN": "secret", "MORAINE_AML_DATA_DIR": str(Path(self.temporary.name) / "data"),
        })
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary.cleanup()

    def request(self, path, body=None, token="secret", header="Authorization"):
        headers = {}
        if token:
            headers[header] = f"Bearer {token}" if header == "Authorization" else token
        data = None if body is None else json.dumps(body).encode()
        request = Request(self.base + path, data=data, headers=headers,
                          method="GET" if body is None else "POST")
        with urlopen(request) as response:
            return response.status, json.load(response)

    def head(self, path, token="secret"):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        request = Request(self.base + path, headers=headers, method="HEAD")
        with urlopen(request) as response:
            return response.status, response.read()

    def test_health_is_public_and_only_competition_routes_exist(self):
        self.assertEqual(self.request("/health", token=None)[0], 200)
        self.assertEqual(self.request("/api/health", token=None)[0], 200)
        with self.assertRaises(HTTPError) as error:
            self.request("/")
        self.assertEqual(error.exception.code, 404)

    def test_add_is_immediately_searchable(self):
        add = {"request_id": "r1", "user_id": "u1", "session_id": "s1",
               "messages": [{"role": "user", "content": "纪念物是绿色石头"}]}
        self.assertTrue(self.request("/add", add)[1]["success"])
        search = {"query": "纪念物是什么", "options": [], "user_id": "u1", "top_k": 100}
        self.assertEqual(self.request("/search", search)[1]["data"][0]["content"], "纪念物是绿色石头")

    def test_auth_supports_bearer_token_and_api_key(self):
        add = {"request_id": "r2", "user_id": "u1", "session_id": "s2",
               "messages": [{"role": "user", "content": "喜欢蓝色"}]}
        self.assertTrue(self.request("/add", add, header="X-Api-Key")[1]["success"])
        with self.assertRaises(HTTPError) as error:
            self.request("/search", {"query": "蓝色", "user_id": "u1", "top_k": 1}, token="wrong")
        self.assertEqual(error.exception.code, 401)

    def test_head_probe_supports_authenticated_competition_routes(self):
        self.assertEqual(self.head("/health", token=None), (200, b""))
        self.assertEqual(self.head("/add"), (200, b""))
        self.assertEqual(self.head("/search"), (200, b""))
        with self.assertRaises(HTTPError) as error:
            self.head("/add", token="wrong")
        self.assertEqual(error.exception.code, 401)

    def test_legacy_environment_names_allow_secret_preserving_migration(self):
        migrated = create_aml_server({
            "MORAINE_BETA_HOST": "127.0.0.1", "MORAINE_BETA_PORT": "0",
            "MORAINE_BETA_TOKEN": "old-secret",
            "MORAINE_AML_DATA_DIR": str(Path(self.temporary.name) / "migrated"),
        })
        try:
            self.assertEqual(migrated.server_address[0], "127.0.0.1")
        finally:
            migrated.server_close()


if __name__ == "__main__":
    unittest.main()
