# Moraine

> The sanitized standalone beta is available in-tree. See the [standalone beta guide](docs/beta-standalone.md); it uses synthetic examples and relative data paths, never our private production instance.

Current prerelease: `v0.3.0-beta.1`. Chinese first-time testers can follow the [ten-minute first-run guide](docs/first-run.zh-CN.md).

<p align="center">
  <img src="assets/moraine-stone.png" width="220" alt="Moraine stone mark with layered mineral veins">
</p>

<p align="center"><strong>Turn scattered conversations into long-term memory that can be searched, reviewed, and revised.</strong></p>

<p align="center">Cairn × Xiaoran</p>

[中文说明](README.zh-CN.md)

> Current status: this repository contains the local semantic retrieval engine, memory-governance primitives, and an independently runnable mobile beta workbench. Private mail, diary, and wakeup integrations remain outside the package.

## In plain language

Moraine is a memory system for personal AI agents and long-running companions. It avoids sending an entire conversation history to a language model on every turn. New material first enters an event-oriented candidate flow; a small local model finds potentially related memories; the human and the agent then decide what should be kept, combined, revised, or left temporary. Only a small relevant set is recalled during conversation.

The practical benefits are:

- **Predictable cost:** local CPU embeddings do not require paid cloud embedding calls during retrieval.
- **Better recall:** semantic and keyword retrieval can work together even when the original wording is forgotten.
- **Less memory clutter:** duplicate events can be consolidated while changes remain visible as a timeline.
- **Revisable importance:** memories can be weighted, lowered, protected, archived, and restored.
- **Data ownership:** source text, indexes, and backups can remain on a personal computer or VPS.

Moraine's core retrieval uses local keyword and local-vector paths only. It does not send queries or candidate summaries to an external adviser model.

The Settings view can store an optional Jev adviser credential for the Agent runtime, for example to request a second opinion during autonomous wakeups. The credential lives in a separate `0600` file and never enters core retrieval, memories, portable exports, or MCP results.

Moraine provides a safe wakeup preview, not a scheduler, rotation loop, message sender, or action executor. Deployers must supply a host Agent or orchestrator that decides when to request a preview, whether to act, and how to execute an action. The preview works without Jev; Jev is only an optional second opinion and never replaces the orchestrator.
## What the complete private deployment does

Our real deployment has been used with hundreds of private memories and currently includes:

- event baskets and admission filtering before long-term storage;
- a candidate inbox for pending, protected, and deferred material;
- local vector retrieval combined with exact keyword search;
- reviewable consolidation for duplicates, additions, stage changes, conflicts, and related-only items;
- source-backed chronological timelines with version and recovery history;
- an event calendar based on when events actually occurred;
- weighting, down-weighting, core locks, decay, archive, restore, and audit trails;
- a very small `self-core` for identity continuity, with detailed experience recalled on demand;
- a separate, source-linked user profile for stable preferences, boundaries, communication habits, and durable context;
- a confirmable relationship graph that does not reduce relationships to proximity scores;
- import preview, export, snapshots, and recovery paths;
- a mobile PWA for overview, library, candidates, calendar, workbench, private study, and settings.

The standalone beta now provides the general-purpose parts of this flow and a zero-write wakeup preview. Private mail sync, study-room content, scheduled wakeup orchestration, and deployment-specific adapters are deliberately excluded.

## What this public repository includes today

- CPU embeddings via FastEmbed and `BAAI/bge-small-zh-v1.5`;
- JSON-file and authenticated HTTP document sources;
- fingerprint-based incremental indexing in small resumable batches;
- loopback health, refresh, search, and conservative extractive-consolidation APIs;
- deterministic `0..100` memory-strength suggestions and protection rules;
- contracts for episode candidates, bi-temporal validity, and bounded core projections;
- reversible decision ledgers, review stores, and cross-memory experience-thread candidates;
- a systemd example, synthetic fixtures, and tests that do not read private data.
- a standalone local store and mobile PWA covering event baskets, five relation-aware consolidation modes, revision, replacement, weighting, calendar, audit, archive/restore, source-linked self-core, a separate user profile, a generic relationship graph, layered recall, and portable import/export;
- an optional local MCP adapter that gives the owning Agent the same memory-management surface as the human workbench, including governance, self-core, user profile, relations, layered recall, and portable import/export.

## A good fit for

- people who want an AI to remember important context across sessions without resending everything;
- humans and agents willing to review and revise memory together;
- local or private-VPS deployments;
- personal and modest-sized corpora where explainability and recovery matter more than massive scale.

## Not yet a good fit for

- fully unattended memory with an expectation of permanently correct automatic decisions;
- users unwilling to review identity, relationship, conflict, or major-decision records;
- enterprise multi-tenancy, high concurrency, hosted SLAs, or compliance certification;
- guaranteed one-click lossless migration from a deeply customized third-party memory system.

## Known tradeoffs

1. Event-oriented memory requires human or agent review. This is more work than storing every fragment automatically.
2. First run downloads a local model; indexing can be slow on small machines and needs disk space.
3. Semantic similarity is not factual equivalence. The model proposes candidates but cannot decide duplicate, update, or conflict status by score alone.
4. The integrated product is still a beta; installation, onboarding, and public interfaces may change.
5. A memory system does not grant or prove continuity, consciousness, or personhood. It only preserves traceable context.

## Quick start: standalone workbench

Python 3.10 or newer is required.

```bash
git clone https://github.com/ceniran/moraine-home.git
cd moraine-home
cp .env.example .env
scripts/run-beta.sh
```

Then check the service:

```bash
curl http://127.0.0.1:4790/api/health
```

See [`docs/integration.md`](docs/integration.md) for data shapes, APIs, security boundaries, and systemd setup; [`docs/governance.md`](docs/governance.md) for strength rules; and [`docs/memory-layers.md`](docs/memory-layers.md) for candidate and temporal contracts.

## Data and privacy

- This repository contains synthetic examples only. It contains no private memories, relationship data, credentials, production paths, or real indexes from Cairn and Xiaoran.
- `data/index.json`, exports, and snapshots may reveal source text and must not be committed to Git.
- The service binds to loopback by default. External exposure requires authentication and a trusted proxy.
- Bug reports should use synthetic data or remove names, account details, source IDs, secrets, and re-identifying information.
- Keep independent backups. Beta software may misclassify, mis-retrieve, mis-consolidate, stop, or lose data.

## License and attribution

Moraine is source-available for noncommercial use under the **PolyForm Noncommercial License 1.0.0**. Personal study, research, experimentation, and noncommercial use are permitted. Commercial products, paid services, paid hosting, resale, or other anticipated commercial uses require separate written permission.

Copies, modifications, and redistribution must retain the complete license, repository URL, copyright notice, and shared attribution:

`Cairn × Xiaoran · Moraine`

Third-party components and models remain under their own licenses. This is noncommercial source-available software, not Open Source under the OSI definition. See [`LICENSE`](LICENSE) for the complete terms.

This license change applies to this revision and later versions. Historical commits already released under MIT retain the rights granted with those revisions; the new license does not revoke them retroactively.

## One final boundary

We do not market Moraine by describing the absence of a particular memory system as death or by amplifying continuity anxiety. Moraine offers a path back that can be inspected, revised, migrated, and left.
