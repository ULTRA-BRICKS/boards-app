# A/B staging manifests (HYP-1490)

`baseline.json` and `state-lib.json` describe the same board built with the
baseline state backend and with the state-lib backend. They share one schema
and differ only in `variant`, `buildCommand`, `outputDir` and the
`BOARDS_STATE_BACKEND` value. They contain variable NAMES only, never values.

## Targets

- `local-synthetic`: runnable on any developer machine. Uses the SQLite
  in-memory test mode, a synthetic auth placeholder and the invented people in
  `synthetic-demo/people.json` (all emails end with `example.invalid`).
  Run it with the `env` block of the manifest, for example:
  `LOCAL_TEST_MODE=1 LOCAL_DATABASE_PATH=:memory: AUTH_SECRET=synthetic-not-a-secret BOARDS_SEED_PEOPLE=deploy/staging/synthetic-demo/people.json BOARDS_STATE_BACKEND=state-lib PORT=5173 node scripts/dev.mjs`
- `remote-staging`: NOT runnable by an automated worker. It lists the
  environment names a human or the coordinator must provide.
  `DATABASE_URL` must be a dedicated staging database, never the production
  one. The server refuses `LOCAL_TEST_MODE` on Vercel, so a remote staging
  needs a real staging sign-in provider (client id and secret). That
  capability has to be supplied by the coordinator.

## Forbidden variables

`forbiddenEnv` lists variables that must stay unset in every staging target so
that no notifications or third-party calls (mail, Slack, GitHub, Linear,
Cloudflare, vision or embedding providers) can happen.

## Build

- `npm run build:baseline` writes `dist/board-baseline` with a state config
  that cannot be flipped from the URL.
- `npm run build:state` writes `dist/board-state`, same guarantee.
