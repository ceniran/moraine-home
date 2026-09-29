from __future__ import annotations

import re
from typing import Mapping

SHADOW_SCHEMA = "aml-shadow-v3"
CURRENT = re.compile(r"后来|当前|现在|目前|如今|最终|最新|改为|变成|不再|恢复|\b(?:current|latest|changed|now)\b", re.I)
UPDATE = re.compile(r"后来.{0,24}(?:改为|变成|不再|恢复)|(?:改为|变成|不再|更新为|替换为)|\b(?:changed|became|no longer|switched to|replaced by)\b", re.I)
EDGE_STOP_TERMS={"现在","目前","后来","最终","最新","改为","变成","因为","所以","因此","这个","那个","已经","还是","什么","怎么","用户","助手","the","and","that","this","with","from","into","for","was","were","are","has","have","had","his","her","their","our","your","its","who","what","when","where","which","why","how","not","but","can","could","would","should","will","may","might","about","after","before","then","than","also","very","just","some","any","all","one","two","unknown","time","years","year","old","new","man","woman","people"}

def _normalized(value: object) -> str:
    return "".join(re.findall(r"[a-z0-9\u3400-\u9fff]+", str(value or "").casefold()))

def _terms(row: Mapping) -> set[str]:
    return {str(term) for term in row.get("salient_terms") or [] if len(str(term)) >= 2 and str(term) not in EDGE_STOP_TERMS}

def _edge(left: Mapping, right: Mapping) -> dict | None:
    if left.get("id") == right.get("id"): return None
    a,b=_terms(left),_terms(right); shared=sorted(a&b); similarity=len(shared)/max(1,min(len(a),len(b)))
    old, new = sorted((left, right), key=lambda row: (float(row.get("time_value") or 0), str(row.get("request_id") or ""), int(row.get("order") or 0)))
    old_text, new_text = str(old.get("content") or ""), str(new.get("content") or "")
    relation = "related_only"
    if _normalized(old_text) == _normalized(new_text): relation = "duplicate"
    elif len(shared)>=2 and similarity>=0.25 and UPDATE.search(new_text): relation="evolution"
    elif len(shared)>=2 and similarity>=0.30 and "causal" in (old.get("signals") or []) and "causal" in (new.get("signals") or []): relation="causal"
    elif len(shared)>=2 and similarity>=0.30 and old.get("temporal_facts") and new.get("temporal_facts"): relation="timeline"
    elif len(shared) < 2: return None
    if relation=="related_only": return None
    confidence = min(0.98, 0.45 + len(shared) * 0.08 + (0.18 if relation in {"duplicate", "evolution", "causal"} else 0.0))
    return {"source_id": str(old["id"]), "target_id": str(new["id"]), "relation": relation,
            "confidence": round(confidence, 4), "shared_terms": shared[:12],
            "source_time": float(old.get("time_value") or 0), "target_time": float(new.get("time_value") or 0),
            "authoritative": False, "rebuildable": True}

def ensure_shadow_graph(data: dict) -> bool:
    memories = list(data.get("memories") or [])
    if data.get("shadow_schema") != SHADOW_SCHEMA:
        data["shadow_edges"], data["shadow_indexed_ids"], data["shadow_schema"] = [], [], SHADOW_SCHEMA
    indexed = set(data.get("shadow_indexed_ids") or []); pending = [row for row in memories if row.get("id") not in indexed]
    if not pending: return False
    existing=[row for row in memories if row.get("id") in indexed]; by_id={str(row["id"]):row for row in memories}; term_index={}
    for row in existing:
        for term in _terms(row): term_index.setdefault(term,set()).add(str(row["id"]))
    edges = list(data.get("shadow_edges") or [])
    seen = {(edge.get("source_id"), edge.get("target_id"), edge.get("relation")) for edge in edges}
    for row in pending:
        row_terms=_terms(row); candidate_ids=set()
        for term in row_terms: candidate_ids.update(term_index.get(term,set()))
        for candidate_id in candidate_ids:
            other=by_id[candidate_id]
            edge = _edge(other, row)
            if edge and (edge["source_id"], edge["target_id"], edge["relation"]) not in seen:
                edges.append(edge); seen.add((edge["source_id"], edge["target_id"], edge["relation"]))
        for term in row_terms: term_index.setdefault(term,set()).add(str(row["id"]))
    kept=[]; incoming={}
    for edge in sorted(edges,key=lambda item:(item["confidence"],item["target_time"]),reverse=True):
        key=(edge["target_id"],edge["relation"])
        if incoming.get(key,0)>=6: continue
        incoming[key]=incoming.get(key,0)+1; kept.append(edge)
    data["shadow_edges"] = kept[:4000]
    data["shadow_indexed_ids"] = [str(row["id"]) for row in memories]
    return True

def graph_bonuses(data: Mapping, base_scores: Mapping[str, float], query: str) -> dict[str, dict]:
    causal=bool(re.search(r"为什么|原因|导致|结果|如何发生|because|why|cause|result",query,re.I)); current=bool(re.search(r"当前|现在|目前|如今|最终|最新|current|latest|now",query,re.I)); historical=bool(re.search(r"最初|以前|原来|曾经|之前|当时|original|before|histor",query,re.I)); temporal=bool(re.search(r"何时|什么时候|哪天|顺序|先后|之前|之后|when|before|after",query,re.I))
    seeds={row_id for row_id,_ in sorted(base_scores.items(),key=lambda item:item[1],reverse=True)[:6]}; bonuses={}; frontier=set(seeds)
    for depth in range(2):
        next_frontier=set()
        for edge in data.get("shadow_edges") or []:
            source,target,relation=edge["source_id"],edge["target_id"],edge["relation"]
            if source not in frontier and target not in frontier: continue
            for row_id,direction in ((source,"source"),(target,"target")):
                amount=0.0
                confidence=float(edge.get("confidence") or 0.0)
                if relation=="causal" and causal: amount=0.14*confidence/(depth+1)
                elif relation=="evolution" and current: amount=(0.18 if direction=="target" else -0.10)*confidence/(depth+1)
                elif relation=="evolution" and historical: amount=(0.16 if direction=="source" else 0.02)*confidence/(depth+1)
                elif relation=="timeline" and temporal: amount=0.10*confidence/(depth+1)
                if amount:
                    item=bonuses.setdefault(row_id,{"bonus":0.0,"relations":[]})
                    item["bonus"]=(max(item["bonus"],amount) if amount>0 else min(item["bonus"],amount))
                    item["bonus"]=max(-0.10,min(0.18,item["bonus"])); item["relations"].append(relation); next_frontier.add(row_id)
        frontier=next_frontier-seeds
    return bonuses
