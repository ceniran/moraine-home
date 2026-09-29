import unittest
from moraine.aml_shadow import ensure_shadow_graph, graph_bonuses

def row(row_id, content, terms, time, signals=()):
    return {"id":row_id,"content":content,"salient_terms":list(terms),"time_value":time,"signals":list(signals),"request_id":row_id,"order":0}

class AMLShadowTests(unittest.TestCase):
    def test_explicit_update_creates_rebuildable_non_authoritative_edge(self):
        data={"memories":[row("old","会议最初定在两点",{"会议","两点","定在"},1,["temporal"]),row("new","会议后来改为四点",{"会议","四点","改为","定在"},2,["temporal"])]}
        self.assertTrue(ensure_shadow_graph(data)); edge=data["shadow_edges"][0]
        self.assertEqual(edge["relation"],"evolution"); self.assertFalse(edge["authoritative"]); self.assertTrue(edge["rebuildable"])
        bonus=graph_bonuses(data,{"old":1.0,"new":0.9},"会议现在几点")
        self.assertGreater(bonus["new"]["bonus"],0); self.assertLess(bonus["old"]["bonus"],0)
    def test_causal_edge_can_expand_two_hops(self):
        data={"memories":[row("a","因为服务器内存不足导致模型失败",{"服务器","内存","模型","失败"},1,["causal"]),row("b","模型失败所以降低批量大小",{"模型","失败","批量","降低"},2,["causal"]),row("c","批量降低后服务恢复",{"批量","降低","服务","恢复"},3,["causal"])]}
        ensure_shadow_graph(data); bonus=graph_bonuses(data,{"a":1.0,"b":0.2,"c":0.1},"模型为什么恢复")
        self.assertGreater(bonus["b"]["bonus"],0); self.assertGreater(bonus["c"]["bonus"],0)
    def test_weak_single_term_similarity_does_not_create_edge(self):
        data={"memories":[row("a","苹果早餐",{"苹果","早餐"},1),row("b","苹果手机",{"苹果","手机"},2)]}
        ensure_shadow_graph(data); self.assertEqual(data["shadow_edges"],[])

if __name__=="__main__": unittest.main()
