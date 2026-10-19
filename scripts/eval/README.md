# Real-site evaluation (WebAble v2)

Measures the docs/10 §10 release gates on real pages: triage, Tailor, Fit view
from the heuristic spec and from the planner, an interaction smoke test, and a
re-benchmark of the planner against a hand-labelled answer key.

```sh
node scripts/eval/run.mjs                       # whole corpus, every persona
node scripts/eval/run.mjs --sites wikipedia,inbox-fixture --personas large-text
node scripts/eval/run.mjs --no-planner          # no OpenAI calls
node scripts/eval/report.mjs eval-output/<run>  # re-render a run's report
node scripts/eval/bench.mjs [--frozen eval-output/<run>/frozen] [--runs 2]
```

Needs the installed Google Chrome (Playwright from `apps/extension`) and, for
the planner, `OPENAI_API_KEY` in the repo's `.env`. The key is read at call
time, sent only in the Authorization header, and never printed or written.
Spend is tracked in `eval-output/openai-ledger.json`; calls stop at the budget
(`--budget`, default $3.50 across runs). Planner answers are cached by outline
in `eval-output/planner-cache/` so a re-run of `run.mjs` does not pay again;
`--fresh-planner` and the benchmark always call.

## What a run does

For every page in `sites.mjs` (signed out, 1440×900, en-US):

1. Load, decline cookie consent (only reject or necessary-only choices are
   ever clicked), close keep-this-page interstitials, settle (fonts, a quiet
   DOM, a scroll down and back for lazy content). Pages that answer with a bot
   wall are recorded as `blocked` and skipped.
2. The bundles go in as the extension's scripts would: the input firewall in a
   CDP isolated world and the key bridge in the MAIN world, both at
   document_start; `apps/extension/tests/eval/entry.ts` in the same isolated
   world after load. No `bypassCSP`.
3. Per persona (`personas.mjs`, valid `FitProfile`s):
   - **Read**: `Engine.extract` (PageSignals with layout) and core `triage`,
     then `buildPlan`, each timed; the first persona also sweeps the reading
     floor (F 16–40) through triage with a text-only profile.
   - **Tailor**: the triaged page scale through CDP device metrics (a smaller
     CSS viewport at a higher DPR, as browser zoom does), the worker's zoom
     guard with step-down, then `Engine.apply`. Snapshots at 100% (B), at the
     scale before ops (Z) and after (T) give size-rank inversions per region
     (Kendall τ-b), template consistency, row heights, new truncation, new
     overlap (clip-aware), overflow and visible navigation.
   - **Fit view, heuristic**: `readSkeleton` → `heuristicSpec` →
     `validateSpec` → `solveFitLayout` → `createFitViewRuntime().open` with a
     fake `EngineApi` and the real live layer, timed to first render; render
     health, conservation, bound controls, smallest control, type tiers,
     primary position; the site's DOM is compared by element identity before
     open and after close, against an idle control period.
   - **Fit view, planner**: one call per page through the compose function's
     own steps (`lib/planner.mjs`); the spec is validated, stored as locators
     and re-bound to a fresh read for every render (the cache path).
4. Interaction smoke on four pages (`smoke: true`): in the heuristic view,
   real mouse and keyboard input types into the search field, presses a chip,
   tab or filter, and opens a record; it checks that the original reacted,
   which element the page saw clicked, and that no event from the view reached
   a page listener (`main-world.ts` watchers).

Output (gitignored) in `eval-output/<date>/`: `report.html` (screenshots
before | tailor | Fit view heuristic | Fit view planner per site and persona,
with metrics), `summary.json` (the gates), `sites/<id>/result.json`, and
`frozen/<id>.json` (the skeleton, wire and resolved answer key the benchmark
reads; skeletons hold page labels, so they stay local).

## Answer key

`answer-key.mjs` labels each page by CSS selector (true main content, search
field, navigation, record lists with their title, clutter) and accepted page
types. `run.mjs` resolves the selectors to node ids of the frozen skeleton
(unresolved entries are listed in `result.json` under `keyResolved.missing`).
To label a new page, run it once and read `sites/<id>/label-outline.txt`: the
skeleton with a selector per node.

## Files

| File                         | What                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| `run.mjs`                    | the runner                                                             |
| `sites.mjs`                  | corpus                                                                 |
| `personas.mjs`               | personas and the triage sweep profile                                  |
| `openai.mjs`                 | Responses API client (streaming) and spend ledger                      |
| `report.mjs`                 | report.html and summary.json; gate definitions                         |
| `bench.mjs`                  | planner re-benchmark on frozen skeletons                               |
| `answer-key.mjs`             | hand-labelled answer key                                               |
| `lib/`                       | bundling, browser plumbing, fixture server, planner path, rubric       |
| `apps/extension/tests/eval/` | in-page bundles (entry, firewall, MAIN world) and the Node core bundle |
