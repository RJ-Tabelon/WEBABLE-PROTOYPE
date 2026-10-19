# WebAble

The web, made to measure.

WebAble learns how a person reads, points and focuses, then adapts each website to fit
them. A short set of tasks (**Tune**) measures what works for the person and produces a
**fit profile**. The Chrome extension combines that fit with what it sees on each page,
chooses from a reviewed library of bounded adaptations, checks every change after it
applies, undoes anything that breaks the page, and learns from what the person keeps or
undoes. It never claims to make a site accessible, never diagnoses anyone, and never
sends page text anywhere.

v2 adds per-person triage ("does this page need anything for you?"), page scale with a
breakpoint guard, and **Fit view**: an offered re-presentation of the page in WebAble's own
layout, where every control drives the original. An optional layout planner (OpenAI, opt-in)
only ever sees an outline of interface words and returns fixed choices.

- Architecture and decisions: [docs/08-System-Architecture.md](docs/08-System-Architecture.md),
  and for v2 [docs/10-V2-Architecture.md](docs/10-V2-Architecture.md)
- The research behind them: [docs/research/](docs/research/README.md), and for v2
  [docs/research/v2-evidence.md](docs/research/v2-evidence.md)
- Positioning and invariants: [docs/01-Positioning.md](docs/01-Positioning.md)
- How it is tested: [TESTING.md](TESTING.md)

## Repository

```text
apps/web/         Next.js 16: public site, Tune (calibration), the app, extension handoff
apps/extension/   WXT (MV3): service worker, in-page engine, popup, welcome page
packages/core/    Contracts and pure logic: fit profile, calibration, ops, policy,
                  learners, page-analysis catalog, Jev adapter, templates, DB types
packages/tokens/  Design tokens and self-hosted fonts (Atkinson Hyperlegible Next/Mono)
packages/ui/      Shared React components for the web app and extension pages
supabase/         Migrations (RLS on every table), Edge Functions, database tests
scripts/          Env sync, deploy, bundle and package checks, dev:compose, eval/ (real-site evaluation)
docs/             Architecture, research, positioning
```

## Getting started

Requirements: Node 22+, pnpm 10, Deno 2 (Edge Function tests and `pnpm dev:compose`), Google Chrome.

```sh
pnpm install
cp .env.example .env          # fill in the Supabase URL, publishable key, database URL
pnpm env:sync                 # writes apps/web/.env.local and apps/extension/.env.local
pnpm db:push                  # applies supabase/migrations to the project (v2: 20261015000000_v2_layout.sql)
pnpm dev                      # web app on http://localhost:3000
pnpm dev:extension            # extension in a disposable Chrome profile
```

To load WebAble in your normal Chrome: `pnpm extension:enable`, then **Load unpacked** with
`apps/extension/.output/chrome-mv3-dev`. This development build has a fixed id
(`bbnblnlbgcccbbbbihngngbecbobedie`) and trusts the local web app, so the two can talk.

A release build (`pnpm extension:release`) needs `WXT_WEB_ORIGINS` set to the deployed https
origin (e.g. `https://webable.app/*`) and `WXT_WEB_ORIGIN`. It never trusts localhost and
carries no development key; the package check fails the build otherwise.

### Fit view's local planner

Fit view works without any planner (its on-device layout). To try planned layouts without an
account or a deployed function, run the local planner and point a development build at it:

```sh
pnpm dev:compose -- --mock    # deterministic planner: no key, no network
pnpm dev:compose              # live: OPENAI_API_KEY from the root .env, gpt-6-sol
WXT_COMPOSE_URL=http://127.0.0.1:54400/compose pnpm extension:enable
```

It binds to 127.0.0.1:54400 (`--port` to change), answers only the development extension's
Origin, and needs no token unless started with `--token <t>`. The key is read from `.env` at
startup and never printed. `--delay <ms>` slows the mock so the "better layout" chip shows.
Only development builds honour `WXT_COMPOSE_URL`; the extension uses it when its dev planner
setting is on (see [TESTING.md](TESTING.md)).

## Commands

| Command                                  | What it does                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                             | Format, lint, typecheck, unit tests, Edge Function tests, bundle drift check, contrast gate, release extension build and manifest check |
| `pnpm test`                              | Unit tests in every package                                                                                                             |
| `pnpm db:test`                           | RLS and SQL function tests against the database (each test rolls back)                                                                  |
| `pnpm test:functions`                    | Type-checks and tests the Edge Functions with Deno                                                                                      |
| `pnpm build:functions`                   | Rebuilds the core bundle the Edge Functions import (`--check` to verify)                                                                |
| `pnpm test:e2e`                          | Playwright: the engine and v2 (skeleton, Fit view, proxies) on fixture pages, the extension end to end, and the web app                 |
| `pnpm dev:compose`                       | Local layout planner for development builds (`--mock` for no key and no network)                                                        |
| `node scripts/eval/run.mjs`              | Real-site evaluation of v2 (network, real sites, not in CI); writes to `eval-output/`                                                   |
| `pnpm --filter @webable/tokens contrast` | Verifies every colour pair in both themes                                                                                               |
| `node scripts/gen-db-types.mjs`          | Regenerates `packages/core/src/db/types.ts` from the live schema                                                                        |

One Playwright project on its own: `pnpm --filter @webable/extension exec playwright test --project=v2`
(or `engine`, `extension`). [TESTING.md](TESTING.md) has the details.

## Edge Functions

`decide` (page analysis through Jev), `extension-link` (sign-in handoff to the extension),
`ingest` (opt-in anonymous counts) and `compose` (v2: Fit view layout planning through
OpenAI). Connecting the extension on `/connect` needs `extension-link` deployed. Deploy all
four, with their secrets, as an account that can see the project in `SUPABASE_URL`:

```sh
SUPABASE_ACCESS_TOKEN=<token> pnpm deploy:functions
```

Create the token at https://supabase.com/dashboard/account/tokens while signed in as the
project owner. The script sets `WEB_ORIGINS` (from `WEB_ORIGIN`), `EXTENSION_ORIGINS` (the
development extension id unless set), a generated `INGEST_TAG_SECRET` (kept on later runs),
`TYPESAFE_API_KEY` when `.env` has one (without it, page analysis stays on-device) and
`OPENAI_API_KEY` when `.env` has one (without it, Fit view keeps its on-device layouts). It
then deploys without Docker and checks that each function answers 401 without a session.
Values go through a temporary 0600 file and are never printed.

### Deploying v2

1. `pnpm db:push` applies `supabase/migrations/20261015000000_v2_layout.sql`: the
   `accounts.ai_layout` consent (off by default) and `consume_compose_quota` (per person 10 an
   hour and 60 a day; 30 a minute and 2,000 a day overall). Until it is in, `compose` answers
   503 to every call.
2. `SUPABASE_ACCESS_TOKEN=<token> pnpm deploy:functions` deploys `compose` with the others. The
   planner key comes from `COMPOSE_OPENAI_API_KEY` in `.env` when set (a key for the planner
   only), otherwise from `OPENAI_API_KEY`; either way it is stored as the `OPENAI_API_KEY`
   secret.
3. Kill switch: `supabase secrets set COMPOSE_DISABLED=1 --project-ref <ref>`. `compose` reads it
   on every request and answers `{ ok: false, degraded: 'disabled' }` without reading the body
   or calling OpenAI. Unset it to turn planning back on. The deploy script never sets it.

Without the consent, the key or the function, Fit view still works on its on-device layout.

In the Supabase dashboard, set the Auth site URL to the web origin and add
`/auth/callback` and `/auth/confirm` as redirect URLs.

The functions authenticate inside their handlers using `getClaims` / `getUser`.
Keep `verify_jwt = false` in `supabase/config.toml`, following Supabase's documented
setup for asymmetric signing keys. Disabling that gateway check does not
disable the handlers' session, consent, quota or origin checks.

Saved text and target minimums apply automatically when a page needs them,
including content rendered after loading and client-side navigation. Existing
tabs update when Tune saves a new fit. Undo and paused sites take precedence;
failed layout checks restore the original page. Basic adaptations work locally,
while optional cloud analysis requires sign-in and consent.

Refreshes measure the site's native styles without painting an unadapted frame,
replace marks without rewriting unchanged ones, and retain previously scanned
content when a later scan is incomplete. Layout failures are confirmed with
synchronous counterfactual measurements so safe changes are kept, and rejected
fits stay rolled back during unrelated updates until their native constraints
change. Expanded click areas stay within page and scroll-container bounds.
Undo immediately saves an off preference for that site in local storage, across
reloads and browser restarts; Redo or an explicit turn-on clears it. The optional
reason window delays learning only, and the popup shows the saved preference.
On engine upgrades, outdated verifier counts and verifier suppression are reset;
user preferences and offer snoozes remain. Legacy Undo flags become saved site
preferences, so existing installations retain those decisions too.

`pnpm check` validates a separate `chrome-mv3-package-check` build with a dummy
web origin. It does not overwrite the unpacked extension in `chrome-mv3` or
`chrome-mv3-dev`. Rebuild the extension with its configured origins before
reloading it in Chrome; the fixed extension version is 0.1.1.
