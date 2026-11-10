# AML Full 2026-09-29 diagnostic note

This note contains aggregate diagnostics only. It does not copy benchmark
documents, answers, user identifiers, tokens, or private Moraine memories.

## Observed result

- Overall: 40.27
- A factual recall: 40.00
- B relational / multi-hop: 33.33
- C temporal / event sequence: 30.00
- D memory governance: 20.00
- E personalization / care: 100.00
- G contextual learning / execution: 30.00
- H epistemic safety / privacy: 50.00
- I streaming memory: 34.38

## Full-run traffic

- 21 isolated user stores
- 1,495 stored messages
- 48 completed Search calls
- No service restart or HTTP failure during the completed beta.10 run

## Root cause in the beta.9 shadow graph

- 17,488 derived edges
- 14,687 timeline edges
- 2,756 causal edges
- 42 duplicate edges
- 3 explicit evolution edges
- One 361-message store reached the 12,000-edge hard cap
- 621 of 1,420 returned results reached the old `0.45` graph-bonus cap
- 25 of 48 queries contained at least one saturated result

The old graph treated ordinary message timestamps as timeline evidence and
gave a generic bonus even when the query did not ask about time, causality, or
state. The result was a dense similarity graph rather than a sparse evidence
graph.

## Frozen v3 correction

- Ordinary timestamps no longer create timeline edges.
- Timeline edges require explicit temporal facts in both memories.
- Causal edges require causal evidence in both memories, at least two shared
  terms, and stronger overlap.
- Each target keeps at most six incoming edges of a relation type.
- Non-intent queries receive no generic graph bonus.
- Intent-specific bonuses use edge confidence, take the strongest path rather
  than adding every path, and are capped at `0.18`.

Replaying the 21 Full stores without writing them produced:

- 63 edges total: 42 duplicate, 18 causal, 3 evolution, 0 timeline
- 2 of 48 queries received any graph bonus
- 6 returned memories received a graph bonus
- Maximum absolute bonus: 0.1372
- Results at the former 0.45 cap: 0

This correction removes a demonstrated source of ranking noise. It is not yet
evidence of benchmark improvement because the leaderboard does not expose
ground-truth answer IDs. Further work must use frozen synthetic and blind cases
for factual, relational, temporal, governance, contextual-execution, and
streaming-memory behavior before another release.
