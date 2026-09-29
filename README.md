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

To load the production build in your normal Chrome: `pnpm extension:enable`, then
**Load unpacked** with `apps/extension/.output/chrome-mv3`. The development build has a
fixed id (`bbnblnlbgcccbbbbihngngbecbobedie`) so the web app can reach it.

## Commands

| Command                                  | What it does                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                             | Format, lint, typecheck, unit tests, Edge Function tests, bundle drift check, contrast gate, extension build and manifest check |
| `pnpm test`                              | Unit tests in every package                                                                                                     |
| `pnpm db:test`                           | RLS and SQL function tests against the database (each test rolls back)                                                          |
| `pnpm test:functions`                    | Type-checks and tests the Edge Functions with Deno                                                                              |
| `pnpm build:functions`                   | Rebuilds the core bundle the Edge Functions import (`--check` to verify)                                                        |
| `pnpm test:e2e`                          | Playwright: engine on fixture pages, the extension end to end, and the web app                                                  |
| `pnpm --filter @webable/tokens contrast` | Verifies every colour pair in both themes                                                                                       |
| `node scripts/gen-db-types.mjs`          | Regenerates `packages/core/src/db/types.ts` from the live schema                                                                |

## Edge Functions

`decide` (page analysis through Jev), `extension-link` (sign-in handoff to the extension)
and `ingest` (opt-in anonymous counts). Deploy with an account that owns the project:

```sh
supabase link --project-ref <ref>
supabase secrets set WEB_ORIGINS=http://localhost:3000 \
  EXTENSION_ORIGINS=chrome-extension://bbnblnlbgcccbbbbihngngbecbobedie \
  INGEST_TAG_SECRET=<32+ random characters>
supabase secrets set TYPESAFE_API_KEY=<key>   # optional: without it, page analysis stays local
supabase functions deploy decide extension-link ingest
```

In the Supabase dashboard, set the Auth site URL to the web origin and add
`/auth/callback` and `/auth/confirm` as redirect URLs.
