# AML local contract smoke test

Moraine's experimental AML adapter exposes authenticated `POST /aml/add` and
`POST /aml/search` endpoints. It is intended for local contract testing before
any official Agent Memory Leaderboard run.

Evaluation traffic is stored in `MORAINE_AML_DATA_DIR`, separately from the
normal Moraine store. Each AML `user_id` maps to a different hashed file. Add
requests are durably written before success is returned and repeated
`request_id` values are idempotent. Search returns evidence records rather than
generated answers and accepts `top_k` values from 1 through 100.

Run the local checks with:

```bash
PYTHONPATH=src python3 -m unittest tests.test_aml_adapter tests.test_beta_server
```

These checks validate the HTTP contract, retry behavior, and user isolation.
They do not produce an official AML score. The current adapter uses a small
deterministic keyword retriever by default. Set `MORAINE_AML_SEMANTIC=1` to
enable a separate per-user FastEmbed vector index over synthetic evaluation
data. Vectors stay beside that user's hashed AML data file and never enter the
normal Moraine index. This local mode still does not produce an official AML
score; it must pass a representative synthetic retrieval set before submission.

For a repeatable 20-case semantic check covering preferences, relationships,
updates, events, and operating rules, run:

```bash
PYTHONPATH=src python3 scripts/run-aml-synthetic.py --cache ./models --json
```

The script uses only in-memory temporary evaluation files and synthetic text.
Pass `--hard` to include the frozen pressure set with multi-step updates,
negation, similar entities, causal questions, and indirect wording.
Pass `--holdout` to include the fallback questions committed before the query
planner was implemented. The planner retains the original query, emits at most
three generic facets, and gives expanded-query similarity a minority share of
the semantic score.

Run the synthetic multi-user endurance check with:

```bash
PYTHONPATH=src python3 scripts/run-aml-endurance.py --cache ./models
```

It writes isolated temporary users, retries one Add request, reloads the
adapter, performs `top_k=100` searches, and reports latency and index size.
