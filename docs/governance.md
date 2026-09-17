# Memory governance preview

Moraine's governance module represents **memory strength** from `0` to `100`.
Storage adapters may keep the existing `0..1` `importance`; conversion remains
compatible at two decimal places.

The first policy is deterministic and metadata-only. It never needs memory
content or a text model. Kind supplies a starting point, while explicit
protection, confirmed useful use, priority, and identity weight may adjust it.
Every adjustment is returned as a reason.

Automatic policy is capped at `79`: software may recommend that a memory is
important, but it cannot declare a memory core. Strengths from `80` through
`100` are assigned manually. They may be locked with an actor, timestamp, and
reason; locked strength is excluded from later automatic reassignment. Changing
a locked value requires an explicit, audited unlock first. Locking does not
prevent review, supersession, or archival of the memory itself.

| Kind | Default strength |
| --- | ---: |
| context | 15 |
| status | 20 |
| event | 30 |
| reflection | 35 |
| project | 40 |
| preference | 45 |
| decision | 50 |
| relationship | 50 |
| identity | 70 |

`simulate_strengths()` compares current and suggested distributions without
changing records. `migration_preview()` supports `preserve`, `simulate`,
`auto_assign`, and `unassigned`, plus an `only_missing` scope. Even in
`auto_assign`, identity, relationship, and explicitly protected memories remain
review-only. Every preview reports `persisted: false`.

## Ownership and review contract

`create_strength_proposal()` records the memory id, expected version, old and
new strength, proposer role, reason, lock request, and the proposer's first
signature. Core assignment, locking, or a change of at least 20 points requires
the other owner as a second key. The proposer cannot self-review.

`apply_strength_proposal()` rejects stale versions and proposals that are not
ready. A successful dry-run returns the updated copy plus the exact rollback
record; `rollback_strength_change()` restores that input. Adapters remain
responsible for atomic persistence and version creation. These functions never
persist on their own and always report `persisted: false`.

`ReviewStore` is an optional local queue for these proposal records. It writes
atomically with mode `0600`, is idempotent by proposal id, and rejects memory
content, previews, memory objects, and rollback snapshots. Exposing the queue to
a browser requires a separately authenticated owner gateway; the read-only
preview adapter must not be upgraded into an unauthenticated write API.
