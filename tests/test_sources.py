import json
import tempfile
import unittest
from pathlib import Path

from moraine.sources import JsonFileSource


class JsonFileSourceTests(unittest.TestCase):
    def test_accepts_array_and_supported_wrappers(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "memory.json"
            path.write_text(json.dumps([{"id": "a"}]), encoding="utf-8")
            self.assertEqual(JsonFileSource(path).load(), [{"id": "a"}])
            path.write_text(json.dumps({"memories": [{"id": "b"}]}), encoding="utf-8")
            self.assertEqual(JsonFileSource(path).load(), [{"id": "b"}])
            path.write_text(json.dumps({"documents": [{"id": "c"}]}), encoding="utf-8")
            self.assertEqual(JsonFileSource(path).load(), [{"id": "c"}])
            path.write_text(json.dumps({"items": [{"id": "d"}]}), encoding="utf-8")
            self.assertEqual(JsonFileSource(path).load(), [{"id": "d"}])

    def test_rejects_unknown_shape(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "memory.json"
            path.write_text("{}", encoding="utf-8")
            with self.assertRaises(ValueError):
                JsonFileSource(path).load()


if __name__ == "__main__":
    unittest.main()
