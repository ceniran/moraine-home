# Dwell shared UI release channel

`src/moraine/static/dwell-release/` is the public-beta release of the shared
Dwell memory interface. It is intentionally parallel to `dwell-v2/`; the old
beta frontend remains a working fallback and no store migration is involved.

The release boundary is enforced in `release-runtime.js`:

- shared memory routes are mapped to the existing `/api/dwell-v2/` backend;
- Cairn's private profile, diary, study and development-line routes are denied;
- private rooms are absent from the release HTML and removed defensively at
  runtime if a future source sync accidentally brings them back;
- authentication continues to use the beta instance's session-only token.

The frontend is available at `/dwell-release/` when the beta server uses the
package `static` directory as its web root. Starting with beta.14, `/` redirects
to that release frontend. The old `/dwell-v2/` route remains available as a
rollback path and both frontends read the same store. An explicitly configured
custom web root keeps its own root behavior when it does not contain a
`dwell-release/index.html`.

The concrete route inventory, authentication boundary, and intentionally
excluded host-Agent capabilities are documented in
[`dwell-release-backend-contract.md`](dwell-release-backend-contract.md).

Chinese guides:

- [`agent-handbook.zh-CN.md`](agent-handbook.zh-CN.md): how an Agent recalls,
  writes, revises and backs up memory;
- [`dwell-v2-to-release.zh-CN.md`](dwell-v2-to-release.zh-CN.md): feature
  additions, removals, interface mapping and rollback procedure.
