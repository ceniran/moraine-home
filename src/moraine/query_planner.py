from __future__ import annotations

import re


FAILURE = re.compile(r"坏了|故障|失败|不可用|用不了|断开|没有网络|超时|停了|扫不出来|不理解|offline|unavailable|failed|timeout", re.I)
CONTINUITY = re.compile(r"仍|还|继续|避免.*丢|怎么办|会不会|靠什么|还有什么|怎样|如何|fallback|continue|still", re.I)
LEXICAL = re.compile(r"字面|原词|关键词|关键字|准确标题|exact|keyword|literal", re.I)


def expand_query(query: str) -> list[str]:
    """Return at most three generic retrieval facets while retaining the original query."""
    query = str(query).strip()
    if not query:
        return []
    expansions = []
    if FAILURE.search(query):
        expansions.append(f"{query}\n故障对象不可用后的降级、回退、备用或替代机制")
    if FAILURE.search(query) and CONTINUITY.search(query):
        expansions.append(f"{query}\n原功能失效时，怎样通过手动、本地、缓存、队列或备用路径继续完成目标并保留内容")
    if LEXICAL.search(query):
        expansions.append(f"{query}\n关键词、关键字、标题或字面精确匹配召回")
    return expansions[:3]
