# Caller integration

Moraine deliberately returns IDs and scores instead of full private document
objects. The caller remains responsible for authorization, fetching content,
keyword matching, ranking policy, and fallbacks.

A resilient retrieval chain looks like this:

1. Run exact-keyword retrieval in the authoritative memory store.
2. Ask Moraine for semantic candidates with a short timeout.
3. Resolve returned IDs against the authoritative store; ignore missing or
   inactive IDs.
4. Fuse exact-keyword and semantic candidates using a deterministic policy.
5. If Moraine is unavailable or returns no valid IDs, call the previous cloud
   semantic retriever.
6. If both semantic paths fail, return exact-keyword results rather than
   failing the memory request.

Example pseudocode:

```text
keyword = store.keyword_search(query)

try:
    semantic = resolve_ids(moraine.search(query, timeout=2.5s))
    if not semantic:
        semantic = cloud.search(query)
except:
    try:
        semantic = cloud.search(query)
    except:
        semantic = []

return fuse(keyword, semantic)
```

## Let memory strength affect recall

Memory strength belongs after semantic retrieval, not inside the embedding
index. Resolve Moraine's candidate IDs against the authoritative store, attach
each record's `importance` (0..1) or `strength` (0..100), then call
`rerank_candidates`.

The default policy uses 80% semantic relevance and 20% memory strength. It also
rejects candidates below a semantic score of 0.35 before applying strength, so
an unrelated core memory cannot enter a result merely because it is locked or
important. Missing strength is treated as a neutral 50 rather than zero.

```python
from moraine import RetrievalPolicy, compare_rankings, rerank_candidates

policy = RetrievalPolicy(
    semantic_weight=0.8,
    strength_weight=0.2,
    minimum_semantic_score=0.35,
)

# Use this first in production to inspect old versus proposed ordering.
preview = compare_rankings(resolved_candidates, limit=20, policy=policy)

# Enable only after the comparison has been reviewed.
results = rerank_candidates(resolved_candidates, limit=20, policy=policy)
```

Every returned result contains the semantic score, resolved memory strength,
final score, and policy weights. The function is deterministic, reads no memory
content, writes nothing, and does not mutate its inputs.

Do not let a local embedding model become the only path to retrieval. A smaller
model can be unavailable, can rank a name poorly, and can require a complete
rebuild after a model change. Literal matching and a tested rollback path are
part of the design, not optional polish.
