# WebAble

The web, made to measure.

WebAble learns how a person reads, points and focuses, then adapts each website to fit
them. A short set of tasks (**Tune**) measures what works for the person and produces a
**fit profile**. The Chrome extension combines that fit with what it sees on each page,
chooses from a reviewed library of bounded adaptations, checks every change after it
applies, undoes anything that breaks the page, and learns from what the person keeps or
undoes. It never claims to make a site accessible, never diagnoses anyone, and never
sends page text anywhere.

- Architecture and decisions: [docs/08-System-Architecture.md](docs/08-System-Architecture.md)
- The research behind them: [docs/research/](docs/research/README.md)
- Positioning and invariants: [docs/01-Positioning.md](docs/01-Positioning.md)

## Repository

```text
apps/web/         Next.js 16: public site, Tune (calibration), the app, extension handoff
apps/extension/   WXT (MV3): service worker, in-page engine, popup, welcome page
packages/core/    Contracts and pure logic: fit profile, calibration, ops, policy,
                  learners, page-analysis catalog, Jev adapter, templates, DB types
packages/tokens/  Design tokens and self-hosted fonts (Atkinson Hyperlegible Next/Mono)
packages/ui/      Shared React components for the web app and extension pages
supabase/         Migrations (RLS on every table), Edge Functions, database tests
docs/             Architecture, research, positioning
```

## Getting started

Requirements: Node 22+, pnpm 10, Deno 2 (for Edge Function tests), Google Chrome.

```sh
pnpm install
cp .env.example .env          # fill in the Supabase URL, publishable key, database URL
pnpm env:sync                 # writes apps/web/.env.local and apps/extension/.env.local
pnpm db:push                  # applies supabase/migrations to the project
pnpm dev                      # web app on http://localhost:3000
pnpm dev:extension            # extension in a disposable Chrome profile
```

To load WebAble in your normal Chrome: `pnpm extension:enable`, then **Load unpacked** with
`apps/extension/.output/chrome-mv3-dev`. This development build has a fixed id
(`bbnblnlbgcccbbbbihngngbecbobedie`) and trusts the local web app, so the two can talk.

A release build (`pnpm extension:release`) needs `WXT_WEB_ORIGINS` set to the deployed https
origin (e.g. `https://webable.app/*`) and `WXT_WEB_ORIGIN`. It never trusts localhost and
carries no development key; the package check fails the build otherwise.

## Commands

| Command                                  | What it does                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                             | Format, lint, typecheck, unit tests, Edge Function tests, bundle drift check, contrast gate, release extension build and manifest check |
| `pnpm test`                              | Unit tests in every package                                                                                                             |
| `pnpm db:test`                           | RLS and SQL function tests against the database (each test rolls back)                                                                  |
| `pnpm test:functions`                    | Type-checks and tests the Edge Functions with Deno                                                                                      |
| `pnpm build:functions`                   | Rebuilds the core bundle the Edge Functions import (`--check` to verify)                                                                |
| `pnpm test:e2e`                          | Playwright: engine on fixture pages, the extension end to end, and the web app                                                          |
| `pnpm --filter @webable/tokens contrast` | Verifies every colour pair in both themes                                                                                               |
| `node scripts/gen-db-types.mjs`          | Regenerates `packages/core/src/db/types.ts` from the live schema                                                                        |

## Edge Functions

`decide` (page analysis through Jev), `extension-link` (sign-in handoff to the extension)
and `ingest` (opt-in anonymous counts). Connecting the extension on `/connect` needs
`extension-link` deployed. Deploy all three, with their secrets, as an account that can see
the project in `SUPABASE_URL`:

```sh
SUPABASE_ACCESS_TOKEN=<token> pnpm deploy:functions
```

Create the token at https://supabase.com/dashboard/account/tokens while signed in as the
project owner. The script sets `WEB_ORIGINS` (from `WEB_ORIGIN`), `EXTENSION_ORIGINS` (the
development extension id unless set), a generated `INGEST_TAG_SECRET` (kept on later runs)
and `TYPESAFE_API_KEY` when `.env` has one (without it, page analysis stays on-device), then
deploys without Docker and checks each function answers.

In the Supabase dashboard, set the Auth site URL to the web origin and add
`/auth/callback` and `/auth/confirm` as redirect URLs.
