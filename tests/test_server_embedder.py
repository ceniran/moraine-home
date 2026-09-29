import unittest

from moraine.server import FastEmbedder


class FakeModel:
    def __init__(self):
        self.call = None

    def passage_embed(self, texts, **kwargs):
        self.call = (list(texts), kwargs)
        return iter([[1.0]])


class FastEmbedderTests(unittest.TestCase):
    def test_passages_reuses_in_process_session(self):
        embedder = FastEmbedder.__new__(FastEmbedder)
        embedder.model = FakeModel()
        self.assertEqual(embedder.passages(["memory"], 4), [[1.0]])
        self.assertIsNone(embedder.model.call[1]["parallel"])


if __name__ == "__main__":
    unittest.main()
