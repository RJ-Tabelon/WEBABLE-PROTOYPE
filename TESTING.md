# Testing WebAble

WebAble is tested at five levels. Each one protects a different promise.

| Level          | Command                                                                  | What it protects                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit           | `pnpm test`                                                              | Calibration math, fit derivation, policy invariants, learners, the question catalog, templates, components, data-layer validation                                                 |
| Database       | `pnpm db:test`                                                           | Row Level Security on every table, SQL functions, size limits, grants. Each test runs in a transaction that is rolled back                                                        |
| Edge Functions | `pnpm test:functions`                                                    | `decide`, `extension-link`, `ingest`: auth, CORS, consent, quota, vocabulary re-validation, degraded responses                                                                    |
| Engine         | `pnpm --filter @webable/extension exec playwright test --project=engine` | Every adaptation applies, verifies and removes cleanly on fixture pages; the clipping trap rolls back; nothing leaks; ARIA and focus order are unchanged                          |
| End to end     | `pnpm test:e2e`                                                          | The real extension in Chrome (popup states, undo, pause, offers, page analysis against a local stub) and the web app (auth, Your fit, Changes, Sites, Privacy, Settings, Connect) |

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

## Things automation cannot establish

Automated checks prove that WebAble's changes don't clip, overlap, hide controls or lower
contrast, and that its own pages pass axe. They cannot prove that a change helps a
particular person. That is what the in-browser learning loop and the user study in
[docs/02-Feature-Set.md](docs/02-Feature-Set.md) are for.
