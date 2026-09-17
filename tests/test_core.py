import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from moraine.core import LocalIndex, fingerprint, legacy_fingerprint
from moraine.sources import JsonFileSource


class FakeEmbedder:
    identity = "fake:v1"

    def passages(self, texts, batch_size):
        return [self._vector(text) for text in texts]

    def query(self, text):
        return self._vector(text)

    @staticmethod
    def _vector(text):
        lowered = text.lower()
        return np.asarray([
            lowered.count("local") + lowered.count("本地"),
            lowered.count("light") + lowered.count("灯"),
        ], dtype=np.float32)


class LocalIndexTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source_file = self.root / "memories.json"

    def tearDown(self):
        self.temp.cleanup()

    def write(self, rows):
        self.source_file.write_text(json.dumps({"memories": rows}, ensure_ascii=False), encoding="utf-8")

    def index(self):
        return LocalIndex(JsonFileSource(self.source_file), FakeEmbedder(), self.root / "index.json", batch_size=1)

    def write_index(self, records, schema=None):
        payload = {
            "version": 1,
            "embedder": FakeEmbedder.identity,
            "updated_at": "2026-01-01T00:00:00Z",
            "records": records,
        }
        if schema is not None:
            payload["fingerprint_schema_version"] = schema
        (self.root / "index.json").write_text(json.dumps(payload), encoding="utf-8")

    def test_refresh_search_and_incremental_update(self):
        self.write([
            {"id": "a", "title": "local", "content": "本地 model", "state": "active"},
            {"id": "b", "title": "light", "content": "leave a 灯", "state": "active"},
        ])
        index = self.index()
        self.assertEqual(index.refresh()["changed"], 2)
        self.assertEqual(index.search("本地", 1)[0]["id"], "a")
        self.assertEqual(index.refresh()["changed"], 0)

        self.write([
            {"id": "a", "title": "local", "content": "灯", "state": "active"},
            {"id": "b", "title": "light", "content": "leave a 灯", "state": "archived"},
        ])
        result = index.refresh()
        self.assertEqual(result, {"accepted": True, "indexed": 1, "changed": 1})
        self.assertEqual(index.search("灯", 5)[0]["id"], "a")

    def test_reloads_compatible_index(self):
        self.write([{"id": "a", "title": "local", "content": "本地", "state": "active"}])
        first = self.index()
        first.refresh()
        second = self.index()
        self.assertEqual(second.health()["indexed"], 1)

    def test_fingerprint_reembeds_only_semantic_changes(self):
        row = {"id": "a", "title": "local", "kind": "event", "tags": ["home"],
               "content": "本地 model", "state": "active", "importance": 0.2,
               "updated_at": "2026-01-01T00:00:00Z"}
        self.write([row])
        index = self.index()
        self.assertEqual(index.refresh()["changed"], 1)
        for field, value in (("importance", 0.9), ("updated_at", "2026-09-05T00:00:00Z")):
            row = {**row, field: value}
            self.write([row])
            self.assertEqual(index.refresh()["changed"], 0)
        for field, value in (("title", "elsewhere"), ("content", "leave a 灯"),
                             ("tags", ["garden"]), ("kind", "project")):
            row = {**row, field: value}
            self.write([row])
            self.assertEqual(index.refresh()["changed"], 1)

    def test_inactive_records_leave_and_rejoin_index(self):
        row = {"id": "a", "title": "local", "content": "本地", "state": "active"}
        self.write([row])
        index = self.index()
        self.assertEqual(index.refresh()["indexed"], 1)
        for state in ("archived", "superseded"):
            self.write([{**row, "state": state}])
            self.assertEqual(index.refresh(), {"accepted": True, "indexed": 0, "changed": 0})
        self.write([row])
        self.assertEqual(index.refresh(), {"accepted": True, "indexed": 1, "changed": 1})

    def test_refresh_indexes_only_currently_valid_records(self):
        self.write([
            {"id": "current", "title": "Now", "content": "current", "state": "active",
             "valid_from": "2020-01-01T00:00:00Z"},
            {"id": "expired", "title": "Old", "content": "old", "state": "active",
             "valid_to": "2020-01-01T00:00:00Z"},
            {"id": "future", "title": "Later", "content": "future", "state": "active",
             "valid_from": "2999-01-01T00:00:00Z"},
        ])
        index = self.index()
        self.assertEqual(index.refresh(), {"accepted": True, "indexed": 1, "changed": 1})
        self.assertEqual(set(index.records), {"current"})

    def test_unversioned_legacy_index_migrates_without_reembedding(self):
        row = {"id": "a", "title": "local", "kind": "event", "tags": ["home"],
               "content": "本地", "state": "active", "importance": 0.2,
               "updated_at": "2026-01-01T00:00:00Z"}
        self.write([row])
        self.write_index({"a": {"fingerprint": legacy_fingerprint(row), "title": "local", "vector": [1.0, 0.0]}})
        index = self.index()
        self.assertEqual(index.fingerprint_schema_version, 1)
        self.assertEqual(index.refresh()["changed"], 0)
        payload = json.loads((self.root / "index.json").read_text())
        self.assertEqual(payload["fingerprint_schema_version"], 2)
        self.assertEqual(payload["records"]["a"]["fingerprint"], fingerprint(row))
        self.assertEqual(payload["records"]["a"]["vector"], [1.0, 0.0])

    def test_v2_index_never_uses_legacy_compatibility(self):
        row = {"id": "a", "title": "local", "kind": "event", "tags": ["home"],
               "content": "本地", "state": "active", "importance": 0.2,
               "updated_at": "2026-01-01T00:00:00Z"}
        self.write([row])
        self.write_index(
            {"a": {"fingerprint": legacy_fingerprint(row), "title": "local", "vector": [1.0, 0.0]}},
            schema=2,
        )
        index = self.index()
        self.assertEqual(index.refresh()["changed"], 1)
        self.assertEqual(index.records["a"]["fingerprint"], fingerprint(row))

    def test_failed_v1_migration_does_not_promote_schema(self):
        old = {"id": "a", "title": "local", "content": "本地", "state": "active"}
        new = {"id": "b", "title": "light", "content": "灯", "state": "active"}
        self.write([old, new])
        self.write_index({"a": {"fingerprint": legacy_fingerprint(old), "title": "local", "vector": [1.0, 0.0]}})
        class Boom(FakeEmbedder):
            def passages(self, texts, batch_size):
                raise RuntimeError("embed failed")
        before = (self.root / "index.json").read_bytes()
        index = LocalIndex(JsonFileSource(self.source_file), Boom(), self.root / "index.json", batch_size=1)
        with self.assertRaises(RuntimeError):
            index.refresh()
        self.assertEqual((self.root / "index.json").read_bytes(), before)

    def test_empty_index_starts_at_v2(self):
        self.write([])
        index = self.index()
        self.assertEqual(index.refresh(), {"accepted": True, "indexed": 0, "changed": 0})
        payload = json.loads((self.root / "index.json").read_text())
        self.assertEqual(payload["fingerprint_schema_version"], 2)

    def test_future_schema_is_rejected_without_touching_index(self):
        self.write([{"id": "a", "title": "local", "content": "本地", "state": "active"}])
        self.write_index({"a": {"fingerprint": "future", "title": "local", "vector": [1.0, 0.0]}}, schema=3)
        before = (self.root / "index.json").read_bytes()
        index = self.index()
        self.assertEqual(index.refresh(), {"accepted": False, "reason": "unsupported_fingerprint_schema"})
        self.assertEqual((self.root / "index.json").read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
