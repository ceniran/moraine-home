import unittest

from moraine.query_planner import expand_query


class QueryPlannerTests(unittest.TestCase):
    def test_failure_and_continuity_produce_bounded_facets(self):
        facets = expand_query("摄像头坏了还要登记怎么办？")
        self.assertEqual(len(facets), 2)
        self.assertTrue(all("摄像头坏了" in item for item in facets))
        self.assertTrue(any("替代" in item for item in facets))

    def test_lexical_intent_gets_exact_match_facet(self):
        facets = expand_query("怎样找到字面相关内容？")
        self.assertEqual(len(facets), 1)
        self.assertIn("关键词", facets[0])

    def test_plain_query_is_not_rewritten(self):
        self.assertEqual(expand_query("小然喜欢什么颜色？"), [])


if __name__ == "__main__":
    unittest.main()
