import unittest

from moraine.retrieval_policy import RetrievalPolicy, compare_rankings, rerank_candidates


class RetrievalPolicyTests(unittest.TestCase):
    def test_strength_breaks_close_semantic_race(self):
        rows = [
            {"id": "close-low", "score": 0.80, "importance": 0.2},
            {"id": "close-high", "score": 0.79, "importance": 0.9},
        ]
        result = rerank_candidates(rows)
        self.assertEqual([row["id"] for row in result], ["close-high", "close-low"])
        self.assertEqual(result[0]["memory_strength"], 90)

    def test_semantic_gate_rejects_unrelated_core_memory(self):
        rows = [
            {"id": "unrelated-core", "score": 0.10, "importance": 1.0},
            {"id": "related-normal", "score": 0.60, "importance": 0.4},
        ]
        result = rerank_candidates(rows)
        self.assertEqual([row["id"] for row in result], ["related-normal"])

    def test_missing_strength_uses_neutral_default(self):
        result = rerank_candidates([{"id": "a", "score": 0.8}])
        self.assertEqual(result[0]["memory_strength"], 50)

    def test_comparison_does_not_mutate_input(self):
        rows = [
            {"id": "a", "score": 0.80, "strength": 10},
            {"id": "b", "score": 0.79, "strength": 90},
        ]
        original = [dict(row) for row in rows]
        comparison = compare_rankings(rows)
        self.assertEqual(rows, original)
        self.assertEqual(comparison["mode"], "read_only_comparison")
        self.assertEqual(comparison["baseline"][0]["id"], "a")
        self.assertEqual(comparison["strength_aware"][0]["id"], "b")

    def test_policy_validation(self):
        with self.assertRaises(ValueError):
            RetrievalPolicy(semantic_weight=0, strength_weight=0)


if __name__ == "__main__":
    unittest.main()
