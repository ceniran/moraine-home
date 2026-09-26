# Moraine continuity backend v0.3 (development)

This backend is an opt-in extension to the v0.2 memory-governance store. It does not copy a particular Agent's identity, relationships, diary, or wakeup routine.

## Boundaries

- `self_core_records` contains a compact set of source-linked identity statements. Each revision retains its previous text, sources, reason, and timestamp. Detailed biography remains normal memory.
- legacy v0.2 `profile.self_core` data remains readable and exportable for compatibility, but it is no longer writable or recalled. New identity statements must use the source-linked self-core endpoint.
- `relations` separates attributable facts (`facts`, `source_ids`) from an Agent's non-recalled `private_note`. Frequency and semantic similarity never create a relationship automatically.
- layered recall is a zero-write projection with separate layer budgets plus a hard total budget. Request-time budgets may reduce configured limits but cannot raise them. Item text, source IDs, and recall reasons all count toward the limit. Recall is evidence, not a truth decision.
- wakeup is disabled by default. The preview endpoint can assemble bounded context and action choices, but it cannot execute an action, send a message, or write memory.
- the package does not include a scheduler, rotation loop, host-Agent runner, message sender, or action executor. A deployment-specific orchestrator must decide when to call the preview and must enforce its capability contract before doing anything external.
- Jev is optional. A wakeup adviser request contains only choice labels and categories explicitly marked `share_with_adviser`; labels are not shared by default, including mail or notification subjects. Memory content, identity text, relationship notes, and credentials are excluded. Jev has no execution or memory-write authority.

## Backend endpoints

- `GET/POST /api/self-core`
- `POST /api/self-core/{id}/archive|restore`
- `GET/POST /api/relations`
- `GET/POST /api/continuity/settings`
- `GET/POST /api/recall/layered`
- `POST /api/wakeup/preview`

The existing export, import, snapshot, authentication, and audit paths remain the source of persistence and recovery. No frontend is included in this development branch.

## Suggested activation order

1. Populate self-core with synthetic or reviewed, source-linked statements.
2. Add confirmed relationship facts; keep private interpretation in `private_note`.
3. Inspect layered recall with strict budgets.
4. Enable wakeup previews without an adviser.
5. Optionally configure the adviser secret and enable both adviser switches.
6. Keep external actions behind separate application-level permissions.
