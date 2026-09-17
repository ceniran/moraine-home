# Moraine standalone beta

The standalone beta is isolated from the private production deployment. It starts with synthetic records and writes only to its configured local JSON store.

It currently provides event baskets, candidate admission, chronological source timelines, overview and calendar projections, an audit feed, weight controls, archive/restore, portable JSON import/export, and a mobile-first web UI. Search uses the local Moraine vector API when configured and falls back visibly to keyword matching when it is unavailable.

See [the Chinese deployment guide](beta-standalone.zh-CN.md) for direct, virtualenv, systemd, and Docker Compose installation modes. Never expose an unauthenticated workbench to the public internet, and never attach private exports or tokens to public issue reports.
