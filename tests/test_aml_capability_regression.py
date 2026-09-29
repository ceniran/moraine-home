import tempfile
import unittest
from pathlib import Path
from moraine.aml_adapter import AMLAdapter

class AMLCapabilityRegressionTests(unittest.TestCase):
    def setUp(self): self.temporary=tempfile.TemporaryDirectory(); self.adapter=AMLAdapter(Path(self.temporary.name))
    def tearDown(self): self.temporary.cleanup()
    def add(self,request,content,timestamp,user="case"):
        self.adapter.add({"request_id":request,"user_id":user,"session_id":request,"messages":[{"role":"user","content":content,"timestamp":timestamp}]})
    def contents(self,query,count=5,user="case"):
        return [row["content"] for row in self.adapter.search({"query":query,"user_id":user,"top_k":count})["data"]]
    def test_relational_chain_retrieves_each_evidence_hop(self):
        self.add("creator","Portal由Valve开发。",1); self.add("chief","Valve的首席执行官是Gabe Newell。",2); self.add("citizen","Gabe Newell是美国公民。",3)
        self.assertEqual(set(self.contents("开发Portal的公司首席执行官是哪国公民？",3)),{"Portal由Valve开发。","Valve的首席执行官是Gabe Newell。","Gabe Newell是美国公民。"})
    def test_current_state_beats_two_historical_states(self):
        self.add("one","右膝晨僵最初持续10分钟。",1); self.add("two","右膝晨僵后来变成20分钟。",2); self.add("three","复诊时右膝晨僵最终改为5分钟。",3)
        self.assertEqual(self.contents("右膝晨僵当前持续多少分钟？",3)[0],"复诊时右膝晨僵最终改为5分钟。")
    def test_explicit_date_query_prefers_matching_event_not_latest_event(self):
        self.add("jan","2024-01-12社区医院开具双氯芬酸凝胶。",1); self.add("feb","2024-02-18复诊时改用辣椒素乳膏。",2)
        self.assertEqual(self.contents("2024-01-12社区医院开了什么药？",2)[0],"2024-01-12社区医院开具双氯芬酸凝胶。")
    def test_forget_command_removes_fact_from_later_recall(self):
        self.add("secret","我的备用门锁密码是7391。",1); self.add("forget","请删除并忘掉备用门锁密码7391。",2)
        self.assertNotIn("我的备用门锁密码是7391。",self.contents("备用门锁密码是什么？",10))
    def test_unrelated_streaming_updates_do_not_displace_durable_rule(self):
        self.add("rule","发布故障报告时必须移除令牌与私人路径。",1)
        for index in range(25): self.add(f"noise-{index}",f"第{index}次例行整理桌面并检查绿植。",2+index)
        self.assertEqual(self.contents("发布故障报告必须移除什么？",5)[0],"发布故障报告时必须移除令牌与私人路径。")

if __name__=="__main__": unittest.main()
