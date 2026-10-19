# Planner re-benchmark on the shipped schema, 2026-10-15

_WP10. Re-runs the layout planner (docs/10 §6) with what ships: the wire skeleton (`core/skeleton/to-wire.ts`),
the server-written outline (`core/skeleton/outline.ts`), `PLANNER_INSTRUCTIONS` and the enum-only PageSpec
schema (`core/compose/prompt.ts`, `wire.ts`), through the compose function's own request and output checks.
Harness: `node scripts/eval/bench.mjs`. Raw results (local, gitignored): `eval-output/2026-10-15-first/bench.json`
(run A) and `eval-output/2026-10-15/bench.json` (run B). Companion report:
[v2-eval-2026-10-15.md](v2-eval-2026-10-15.md)._

## Bottom line

On 15 pages and 60 calls, the shipped planner path is **reliable and fast**: every response was valid, no
response referenced an unknown id, p95 latency was 6.0 s on the fast tier (budget 8 s), and it cost about
$0.008 per page. On the hand-labelled rubric it scores **4.40–4.46 / 5 against the heuristic's 3.90–4.13**,
almost entirely by naming page types correctly (0.87–0.93 vs 0.53–0.67) and by finding the primary content on
pages where the heuristic does not (BBC, Amazon product, WebAIM, GOV.UK browse). The two specs agree on the
primary section's content on most pages (Jaccard 0.75–0.88) but on page type only half the time.

The claim stays **"pilot"**: 15 pages, one author's answer key, a structural rubric that does not see what
renders (see Limits), and temperature-0 runs that were identical, so two runs per page are one sample.

## Setup

- **Pages.** The 15 evaluable pages of the real-site corpus (Reddit blocked automation): YouTube channel and
  search, Wikipedia, Amazon search and product, Meta, a BBC article, GOV.UK browse and passport, Craigslist,
  GitHub, NN/g, WebAIM, and WP3a's inbox and feed fixtures. The pilot's own frozen outlines use the pilot's
  extractor and free-text schema, so they were not reused; instead each run of `run.mjs` freezes the shipped
  skeleton of every page (`frozen/<page>.json`: skeleton, wire, rule context, resolved answer key). Run A uses
  the skeletons from the 23:09 run, run B those from the 23:34 run, so A and B also sample page variation (on
  Amazon search, run B's skeleton was cut by the read budget to 40 nodes; see the evaluation report, M4).
- **Calls.** `gpt-6-sol`, `plannerRequestBody(outline, {fast: true})`: reasoning none, temperature 0, strict
  JSON schema, `store: false`, constant `prompt_cache_key`, 1,800 output tokens, priority tier. Request path as
  the compose function runs it (`scripts/eval/lib/planner.mjs`): strict request schema, VOCAB_V1 and
  record-word re-checks, `wireOutline`, then JSON, schema and unknown-id checks on the answer. Then
  `validateSpec` as the extension runs it. Two fresh calls per page per run (no cache): 60 calls.
- **Heuristic.** `heuristicSpec(skeleton, {verdicts, signals})` with the page's rule verdicts and page signals,
  then `validateSpec`.
- **Answer key** (`scripts/eval/answer-key.mjs`), labelled by CSS selector on the live pages and resolved to the
  frozen skeleton's ids at capture time: accepted page types, the true main content, the site search field,
  navigation blocks, record lists with the title inside one record, and clutter to fold: 72 entries. 4 did not
  resolve in run A (GOV.UK's header nav on both pages, the feed fixture's ad section, YouTube search's title slot)
  and 5 in run B (also Amazon's result list, cut from that skeleton); they are left out of the score.
- **Rubric** (`scripts/eval/lib/rubric.mjs`), on the validated spec, each criterion 0–1, score = mean of the
  criteria that apply × 5: page type in the accepted set; primary covers the main content (0.5 for a much larger
  wrapper or part of it); search is a search section (0.5 if shown in another section); each nav block is in a
  nav-like section (0.5 in another shown section, 0 if folded or left out); each record list is a collection
  (0.5) with its title slot mapped to the title role or the open slot (+0.5); each clutter block is folded.

## Results

| | Run A | Run B | Pilot (docs/10 §6, 4 pages, old schema) |
| --- | --- | --- | --- |
| Calls | 30 | 30 | 217 (12 models) |
| Valid (JSON, schema, known ids) | 30/30 | 30/30 | 216/217 |
| Unknown-id rate | 0 | 0 | 0 |
| Validator repairs per spec | 0.33 | 0.50 | — (overlaps "common": 11 of 44 runs) |
| Repairs by kind | untrusted_slot 6, overlap 2, rest_added 2 | untrusted_slot 6, overlap 5, rest_added 2, heading_dropped 2 | |
| Latency p50 / p95 / max | 3.41 / 6.28 / 6.75 s | 3.36 / 5.04 / 5.06 s | 4.2 / 6.1 s (fast tier) |
| Pooled, 60 calls | p50 3.38 s, p95 5.97 s, max 6.75 s, first token p50 0.78 s, 0 over the 12 s abort | | |
| Tokens in (cached) / out, p50 | 4,585 (4,446) / 650 | 4,449 (4,446) / 629 | |
| Cost (fast tier counted at 2×) | $0.265 | $0.227 | $0.011–0.024 per page |
| Rubric, heuristic | **4.13** | **3.90** | — |
| Rubric, planner | **4.46** | **4.40** | 4.89 (different key and rubric) |
| Page type agreement (heuristic = planner) | 0.53 | 0.47 | |
| Primary section kind agreement | 0.87 | 0.73 | |
| Primary content overlap (Jaccard) | 0.88 | 0.75 | |
| Planner run-to-run page type | 1.00 | 1.00 | 3 distinct outputs per page at T = 0 |

Rubric criteria (mean, run A / run B):

| Criterion | Heuristic | Planner |
| --- | --- | --- |
| Page type | 0.67 / 0.53 | 0.93 / 0.87 |
| Primary | 0.93 / 0.80 | 0.93 / 0.93 |
| Search | 0.90 / 0.90 | 0.95 / 0.95 |
| Navigation | 0.75 / 0.77 | 0.74 / 0.73 |
| Records | 0.94 / 1.00 | 0.94 / 1.00 |
| Clutter | 1.00 / 1.00 | 1.00 / 1.00 |

Per page (run B; run A where it differs):

| Page | Heuristic: type / primary | Score | Planner: type / primary | Score | Repairs |
| --- | --- | --- | --- | --- | --- |
| YouTube channel | search_results / main_list | 4.00 | channel_or_profile / main_list | 4.67 | untrusted_slot |
| YouTube search | search_results / main_list | 5.00 | search_results / main_list | 4.50 | untrusted_slot |
| Wikipedia | article / article | 5.00 | article / article | 5.00 | overlap |
| Amazon search | other / primary_nav (A: search_results / main_list, 4.17) | 2.50 | other / main_list (A: search_results, 4.58) | 3.75 | |
| Amazon product | article / article (A: product_detail, 4.75) | 3.00 | product_detail / product_detail | 4.75 | overlap, rest_added |
| Meta | product_marketing / feature_blocks | 2.92 | product_marketing / feature_blocks | 2.92 | |
| BBC article | listing_grid / main_list | 3.75 | article / article | 5.00 | |
| GOV.UK browse | search_results / main_list | 3.44 | home_portal / main_list | 5.00 | |
| GOV.UK passport | article / article | 5.00 | article / article | 5.00 | |
| Craigslist | search_results / main_list | 3.50 | listing_grid / main_list | 3.50 | untrusted_slot |
| GitHub | article / article | 4.17 | docs_reference / article | 4.17 | heading_dropped |
| NN/g | article / article | 3.75 | article / article | 3.75 | overlap |
| WebAIM | other / other | 3.50 | article / main_list | 4.00 | |
| Inbox fixture | inbox_or_messages / main_list | 5.00 | inbox_or_messages / main_list | 5.00 | |
| Feed fixture | search_results / main_list | 4.00 | feed / main_list | 5.00 | |

## Observations

- **Validity is no longer the risk.** The enum-only schema with id patterns gave 60/60 valid answers with no
  unknown ids. The validator still earns its place: it demoted a planner `account_and_cart` holding YouTube's
  "Sign in" (its link leaves the site) and a Craigslist bar from the trusted strip (6 repairs per run), and
  dropped ancestor/descendant overlaps (2–5).
- **Latency has headroom.** Output length drives latency (p50 650 tokens); the instructions were served from the
  prompt cache on almost every call (4,446 of about 4,500 input tokens cached), which cut cost, not time to first
  token (0.78 s), as the pilot found.
- **Deterministic at temperature 0 here.** Both runs of every page returned the same spec; the pilot saw three
  different outputs per page at temperature 0. Pages themselves vary more (Amazon search between runs A and B).
- **Where the planner wins** is semantic: the BBC article is an article (the heuristic took its text blocks for a
  list), Amazon's product page is a product (the heuristic said article in run B), GOV.UK browse is a portal, the
  feed is a feed. **Where neither wins**: Meta (both pick a feature block, both miss the top nav), NN/g and
  Craigslist navigation, and Amazon search when the skeleton is cut (run B).
- **Rubric ≠ rendering.** Records scored 0.94–1.00 for both sources although the evaluation found empty or
  mistitled records on Amazon search, YouTube search, BBC and the inbox (evaluation report B1–B5). Those are
  reader and renderer defects downstream of the spec, and a structural rubric cannot see them; the evaluation's
  record-title check can.

## Limits and claim status

- 15 pages, of which 2 are fixtures; one author wrote the answer key, with no second rater.
- The rubric is structural and saturates near 5 on easy pages; it is not the pilot's rubric, so 4.40–4.46 is not
  comparable to the pilot's 4.89.
- Only `gpt-6-sol` on the fast tier was run; the fallback (`gpt-5.6-terra`) and the default tier were not.
- Costs use the pilot's third-party list prices with the priority tier at 2×.

**Status: pilot.** The shipped path is valid and within budget on this sample; quality relative to the
heuristic favours the planner by about 0.3–0.5 rubric points, driven by page type and primary on 4–5 pages. The
docs/10 §6 planner claims should cite this benchmark as a 15-page pilot until a second rater labels the key and
the corpus covers more page kinds (forms, checkout-free shops, dashboards).
