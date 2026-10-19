# Testing WebAble

WebAble is tested at six levels. Each one protects a different promise. A real-site
evaluation (below) measures v2 on live pages; it is not a test and never runs in CI.

| Level          | Command                                                                  | What it protects                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit           | `pnpm test`                                                              | Calibration math, fit derivation, policy invariants, learners, the question catalog, templates, components, data-layer validation                                                                                      |
| Database       | `pnpm db:test`                                                           | Row Level Security on every table, SQL functions, size limits, grants, the `ai_layout` consent and `consume_compose_quota`. Each test runs in a transaction that is rolled back                                        |
| Edge Functions | `pnpm test:functions`                                                    | `decide`, `extension-link`, `ingest`, `compose` and the local dev planner: auth, CORS, consent, quota, vocabulary and record-word re-validation, the kill switch, degraded responses                                   |
| Engine         | `pnpm --filter @webable/extension exec playwright test --project=engine` | Every adaptation applies, verifies and removes cleanly on fixture pages; the clipping trap rolls back; Tailor keeps size order on the cards fixture; nothing leaks; ARIA and focus order are unchanged                 |
| v2             | `pnpm --filter @webable/extension exec playwright test --project=v2`     | The skeleton reader, layout features, Fit view rendering and health, proxies, the input firewall, site popups and Gmail-style routes on fixture pages                                                                  |
| End to end     | `pnpm test:e2e`                                                          | Every Playwright project above, then the real extension in Chrome (popup states, undo, pause, offers, page analysis against a local stub) and the web app (auth, Your fit, Changes, Sites, Privacy, Settings, Connect) |

`pnpm check` runs formatting, lint, typecheck, unit, Edge Function, bundle-drift, contrast and
extension-package checks together. CI runs it on every pull request.

## First-time setup

```sh
pnpm install
pnpm env:sync
pnpm --filter @webable/extension exec playwright install chromium   # only if not using installed Chrome
node scripts/create-test-user.mjs                                   # local test account for signed-in tests
```

The Playwright suites use the installed Google Chrome by default. Set `PW_CHANNEL=chromium`
to use Playwright's bundled browser instead.

## The extension by hand

1. `pnpm extension:enable`, then **Load unpacked** with `apps/extension/.output/chrome-mv3-dev`.
2. The welcome page opens. Allow WebAble on all sites, or skip and use the toolbar button on
   one site at a time.
3. Run the web app (`pnpm dev`), sign in, finish Tune, and open `/connect` to link the extension.
4. Visit a busy article or store page. Open the popup: check the state line, the list of
   changes with their before and after values, Undo on each row, and Pause on this site.
5. Open **What was sent** after a page analysis to see the exact payload.

Manifest, service-worker and content-script changes need an extension reload in
`chrome://extensions`, and content-script changes also need a page refresh.

## v2 (docs/10)

### The `v2` Playwright project

```sh
pnpm --filter @webable/extension exec playwright test --project=v2 [file] [-g pattern]
```

- Specs are `apps/extension/tests/v2/*.spec.ts`: skeleton, layout features, Fit view rendering and health, proxies,
  the input firewall and site popups, Gmail-style routes, the content adapter, and a harness smoke test.
- Each `tests/v2/entries/<name>.ts` is bundled automatically by the shared global setup (esbuild IIFE into
  `node_modules/.cache/webable-v2/`) and served at `/__v2/<name>.js`. A new entry needs no registration; keep one
  entry per work area.
- Fixture pages live in `tests/v2/fixtures/<name>.html` and are served at `/v2/<name>.html` by the fixture server on
  127.0.0.1:4173, which every project shares.
- Name specs `*.spec.ts`, never `*.test.ts`, or the extension's vitest collects them.
- CI's e2e job runs `--project=engine` only, so run `v2` locally before handing off.

### Fit view and the planner by hand

1. Start the local planner: `pnpm dev:compose -- --mock` (no key, no network), or `pnpm dev:compose` for the live
   planner, which reads `OPENAI_API_KEY` from the root `.env` at startup and never prints it. Add `--delay 3000` to the
   mock to see the "A better layout is ready" chip.
2. Build the development extension against it:
   `WXT_COMPOSE_URL=http://127.0.0.1:54400/compose pnpm extension:enable`, then reload it in `chrome://extensions`.
   Only development builds honour `WXT_COMPOSE_URL`.
3. Turn the dev planner on: popup → Settings → **Local dev planner** (shown only in a development build whose compose
   URL is a loopback address). While the popup work is in progress, the same switch from the popup's DevTools console:
   `chrome.runtime.sendMessage({ type: 'ui:set-prefs', devPlanner: true })`.
4. Open a busy page (a YouTube channel, an Amazon search) and press **Alt+Shift+F**. Fit view opens on its on-device
   layout first; the planned one is offered when it arrives. **What was sent** shows the exact request once the
   popup's receipts view lands.
5. Check what must never happen: typing `j`, `k`, `/` or `e` in Fit view's search fires no site shortcut; no layout
   request is sent on mail or chat (Fit view still opens there, on its on-device layout) or on checkout pages; and Fit
   view does not open at all on excluded sites (banking, health, government, gov.uk included) or on pages with
   password or payment fields.

### The real-site evaluation

`scripts/eval/*` measures v2 on live pages (docs/10 §10). It loads real sites, so it is not part of `pnpm check`, CI
or any Playwright project.

```sh
node scripts/eval/run.mjs [--sites a,b] [--personas x,y] [--no-planner] [--no-smoke] [--budget 3.5]
node scripts/eval/bench.mjs [--frozen <dir>] [--runs 2]   # planner re-benchmark on frozen skeletons
node scripts/eval/report.mjs <out>                        # re-render a report from saved results
```

- `run.mjs` loads each corpus page (`sites.mjs`) in installed Chrome, signed out, and per persona (`personas.mjs`)
  reads and triages it, applies Tailor at the triaged page scale, and renders Fit view from the heuristic and the
  planner spec. Four pages also get an interaction smoke test. Gmail is a local fixture: the evaluation never signs in.
- Output goes to `eval-output/<date>/` (screenshots, raw JSON, `report.html`, `summary.json`). `eval-output/` is
  gitignored and prettier-ignored; never commit it.
- Planner calls read `OPENAI_API_KEY` from the root `.env` at call time and never print it. A spend ledger
  (`eval-output/openai-ledger.json`) refuses calls past `--budget` dollars. `--no-planner` makes no OpenAI calls.
- Results and the re-benchmark are written up in `docs/research/v2-eval-*.md` and
  `docs/research/v2-planner-benchmark.md`.

## Things automation cannot establish

Automated checks prove that WebAble's changes don't clip, overlap, hide controls or lower
contrast, and that its own pages pass axe. They cannot prove that a change helps a
particular person. That is what the in-browser learning loop and the user study in
[docs/02-Feature-Set.md](docs/02-Feature-Set.md) are for.
