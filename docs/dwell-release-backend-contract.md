# Dwell release backend contract

This document is the interface boundary between the public-beta Dwell UI in
`src/moraine/static/dwell-release/` and the standalone Moraine server. It is a
release checklist, not a promise that private Dwell integrations are bundled.

## Route mapping

The shared frontend keeps the private deployment's readable route names so the
UI can be maintained from one design lineage. `release-runtime.js` maps them
before any application request is sent:

- `/api/memory-preview/<path>` -> `/api/dwell-v2/<path>`;
- `/api/cairn/profile` -> `/api/profile` (a `PUT` becomes `POST`);
- `/api/diary` and `/api/memory-preview/development-lines` are rejected inside
  the browser because those rooms are not part of the standalone release.

The runtime is loaded before `prototype.js`. Do not reverse that script order.

For the Agent-facing operating model, read
[`agent-handbook.zh-CN.md`](agent-handbook.zh-CN.md). For a feature-by-feature
comparison with the previous frontend and the rollback procedure, read
[`dwell-v2-to-release.zh-CN.md`](dwell-v2-to-release.zh-CN.md).

## Interface groups

| Intent | HTTP surface | Access | Durability / safety |
| --- | --- | --- | --- |
| Health and overview | `GET /api/health`, `/api/overview` | public health; API auth for overview | read only |
| Recall and search | `GET /api/search`, `/api/recall/layered`, `/api/dwell-v2/layered-recall` | API auth | read only; semantic failure must degrade cleanly |
| Candidates | `/api/candidates*`, `/api/dwell-v2/candidates`, `/api/dwell-v2/queue` | API auth | reversible writes; candidates are not facts |
| Memory governance | `/api/memories*`, `/api/dwell-v2/actions/*`, `/api/dwell-v2/rollbacks*` | API auth | preview/execute for high-impact UI actions |
| Identity and relations | `/api/profile`, `/api/self-core*`, `/api/user-profile*`, `/api/relations*` | API auth | source-aware reversible writes |
| Policies and settings | `/api/settings`, `/api/continuity/settings`, `/api/dwell-v2/*-policy` | API auth | durable settings writes |
| Audit views | `/api/events`, `/api/calendar`, `/api/dwell-v2/activities`, `/api/dwell-v2/calendar` | API auth | read only |
| Portability | `/api/export`, `/api/import`, `/api/snapshots*`, `/api/dwell-v2/portability/*`, `/api/dwell-v2/migration/*` | API auth | import/restore can replace state; snapshot first |
| Wakeup preview | `POST /api/wakeup/preview` | API auth | read-only proposal; no scheduler or sender |
| Private topic routing | `/api/private/topic-routing/*` | separate private capability | not part of the public UI contract |

Dynamic routes ending in an object ID are documented by route family above.
The authoritative request and response shapes remain the server implementation
and MCP adapter tests; documentation must not imply that a private host-Agent
route is available in the standalone release.

## Page-load reads

A clean instance must return `200` for every request made while the release UI
boots:

- `GET /api/health`
- `GET /api/profile`
- `GET /api/dwell-v2/overview`
- `GET /api/dwell-v2/library`
- `GET /api/dwell-v2/calendar`
- `GET /api/dwell-v2/candidates`
- `GET /api/dwell-v2/queue`
- `GET /api/dwell-v2/flow`
- `GET /api/dwell-v2/reflections`
- `GET /api/dwell-v2/candidate-experience-policy`
- `GET /api/dwell-v2/candidate-schedule-policy`
- `GET /api/dwell-v2/identity-relation-routing-policy`
- `GET /api/dwell-v2/profile-recall-policy`
- `GET /api/dwell-v2/profile-growth-candidates`

The candidate routing preview uses the ordinary candidate endpoint and filters
identity and relationship candidates locally. It must not depend on the private
Agent workbench.

## User-triggered writes

The standalone server owns all durable state changes. Important writes use a
preview/confirmation pair when the UI may revise, merge, archive, replace, or
restore memory:

- `POST /api/dwell-v2/actions/preview`
- `POST /api/dwell-v2/actions/execute`
- `POST /api/dwell-v2/queue`
- `POST /api/dwell-v2/profile-recall-policy`
- `POST /api/dwell-v2/profile-growth-candidates[/decide]`
- `POST /api/dwell-v2/candidate-*-policy`
- `POST /api/dwell-v2/identity-relation-routing-policy`
- `POST /api/dwell-v2/migration/preview`
- `POST /api/dwell-v2/migration/execute`
- `POST /api/dwell-v2/portability/snapshots`
- `POST /api/dwell-v2/portability/restore-execute`
- `POST /api/profile`

All request bodies are bounded by `MAX_BODY`. Snapshot restore and migration
execute calls require the confirmation code returned by their preview call.

## Intentionally excluded capabilities

The release does not expose Cairn's diary, private study, development lines,
scheduled wakeup executor, message sender, or backend Agent revision queue. The
memory detail therefore does not render “hand to Agent for revision”, and the
release runtime disables the private revision submission controls. These capabilities
belong to a host Agent or private deployment and must not silently degrade into
dead controls or unauthenticated write routes.

The release does keep the workbench progress surface. Without a private Agent
revision queue it reports three verifiable core reads only: overview/store,
candidate inbox, and workbench queue. The ratio is an integration check, not a
claim that memory work is complete. A host that implements the optional private
contracts described in [`agent-handbook.zh-CN.md`](agent-handbook.zh-CN.md) may
replace this fallback with its own authenticated, auditable task progress.

## Authentication and deployment

Loopback deployments may omit `MORAINE_BETA_TOKEN`. Any non-loopback bind
requires it. API clients may send the configured token as `Authorization:
Bearer`, `Authorization: Token`, or `X-Api-Key`. The browser stores the token in
session storage only. A reverse proxy must preserve the authorization header
and should add TLS; static hosting without the API is not a supported mode.

## Release verification

Before publishing a candidate:

1. run `scripts/check-release.sh`;
2. boot a clean temporary store and open `/dwell-release/`;
3. confirm all page-load requests above return `200`;
4. exercise one preview/execute write and one snapshot restore preview;
5. confirm the old `/dwell-v2/` frontend still works as the rollback path;
6. scan the repository for credentials, private paths, production addresses,
   and exported memory data.
