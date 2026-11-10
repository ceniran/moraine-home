#!/usr/bin/env python3
"""Build whole-candidate service-area suggestions without writing candidate memories."""
import argparse, json
from pathlib import Path
import numpy as np
from fastembed import TextEmbedding

def norm(rows):
    matrix=np.asarray(rows,dtype=np.float32)
    return matrix/np.maximum(np.linalg.norm(matrix,axis=1,keepdims=True),1e-12)

def main():
    p=argparse.ArgumentParser(); p.add_argument('--candidates',required=True); p.add_argument('--areas',required=True); p.add_argument('--output',required=True); p.add_argument('--cache-dir'); p.add_argument('--model',default='BAAI/bge-small-zh-v1.5'); a=p.parse_args()
    candidates=json.loads(Path(a.candidates).read_text(encoding='utf-8')).get('candidates',[])
    areas=json.loads(Path(a.areas).read_text(encoding='utf-8')).get('registry',[])
    area_docs=[f"使用场景：{x['label']}。适合在这个场景使用的内容：{'、'.join(x.get('keywords') or [])}" for x in areas]
    docs=[f"标题：{x.get('title','')}\n类型：{x.get('kind','')}\n关键词：{'、'.join(x.get('tags') or [])}\n正文：{x.get('content','')}"[:12000] for x in candidates]
    model=TextEmbedding(model_name=a.model,cache_dir=a.cache_dir,threads=2)
    av=norm(list(model.passage_embed(area_docs,batch_size=8))); cv=norm(list(model.query_embed(docs,batch_size=8)))
    scores=cv@av.T; result={}
    for i,row in enumerate(candidates):
        order=np.argsort(-scores[i])[:3]; choices=[]
        for j in order:
            raw=float(scores[i,j]); weight=max(0.0,min(1.0,(raw-.32)/.38))
            if weight>=.25: choices.append({'area':areas[int(j)]['id'],'label':areas[int(j)]['label'],'weight':round(weight,3),'semantic_score':round(raw,4)})
        result[row['id']]={'areas':choices,'source':'whole_candidate_local_semantic','confirmed':False}
    payload={'version':1,'mode':'whole_candidate_shadow','model':a.model,'writes_memory':False,'suggestions':result}
    target=Path(a.output); target.parent.mkdir(parents=True,exist_ok=True); temp=target.with_suffix(target.suffix+'.tmp'); temp.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8'); temp.chmod(0o600); temp.replace(target)
if __name__=='__main__': main()
