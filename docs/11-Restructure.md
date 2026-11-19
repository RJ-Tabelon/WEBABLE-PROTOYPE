# 11. Restructure: same content, a structure built for the person

_Written 2026-10-16. Extends docs/10 (Fit view). Evidence: `docs/research/cal-attention.md`, `docs/research/v2-evidence.md`._

## 1. The promise

Someone whose Tune results show that busy, dense or poorly organised pages cost them time opens a cluttered page.
WebAble rebuilds it before they have to ask:
- one line says what the page is and what they can do on it;
- the one main thing on the page comes first;
- the rest is in a few labelled drawers, each with a count;
- lists come in small groups, and long text in short paragraphs;
- ads, motion and sticky bars are gone, and nothing is lost.

Every word, link, image and control is the site's own, and every control still works (docs/10 §4.4).
"Original page" is always one click away.

v2 as tested: Tailor (page zoom plus larger text) ran on every page. Fit view was only offered, and only on pages
triage judged "compose", so a person with clutter or comprehension needs never saw a structural change.

## 2. Who gets it, and when

`structureNeed(profile)` (`core/fit/structure.ts`) takes the strongest posterior P(benefit > 0) among Tune's four
Focus effects. Each is a within-person timing difference on a manipulated page (cal-attention.md §4):
- **distraction**: busy vs clean;
- **density**: dense vs spaced;
- **chunking**: dense vs chunked text;
- **guidance**: weak vs strong hierarchy.

Dimensions Tune never informed count as no benefit.

| Structure level | Page busy for this person (triage `needs.clutter` ≠ fits) | Page not busy |
| --- | --- | --- |
| 2 (P ≥ 0.8) | **Restructured on arrival.** A one-time line explains it. | Tailor only; the popup switch is available |
| 1 (P ≥ 0.6) | Offered: "Simplify this page" toast action and chip | Tailor only; the popup switch is available |
| 0 | Offered only if triage says compose (docs/10, unchanged) | Tailor only; the popup switch is available |

- **Triage's clutter need** now reads the structure need, not only `distraction`. A page counts as busy relative to the
  person's comfort percentile (docs/10 §3.2).
- **The popup's "Simplify this page" switch** shows on every page Fit view can represent, whatever triage says. A person
  can always ask.
- **Learning** (docs/10 §7, unchanged): two quick "Original page" exits on a site make the next visit an offer.
  "Always here" makes it automatic.
- **Invariant change, recorded here.** v1's "offer, never impose" becomes "impose only on measured need, one click
  back". This follows Gajos 2008: accurate adaptation raised use from 70.6% to 86.4%, and inaccurate adaptation is worse
  than none. That is why the gate is the posterior, not the mean.

## 3. What changes (and the person parameter behind it)

`FitLayout.structure` (`core/fit/types.ts`, solved by `solveStructure`) carries the person's settings. The renderer
applies them. "Clutter" means max(P distraction, P density).

| # | Change | Driven by | Rule | Evidence |
| --- | --- | --- | --- | --- |
| R1 | **Orientation.** The site name, the page's own title, and one page line from the spec, e.g. "Search results · 20 videos · Filters above the list". No generated prose. | always | page line from `page_type`, `primary_task`, counts | COGA "make the purpose of each page clear"; signaling, Schneider 2018 |
| R2 | **Main thing first.** The primary section starts inside the first screen. The only controls above it are search, account and Fit view's own. | always | `primary` from the spec | COGA "make it easy to find the most important things" |
| R3 | **Fewer things open at once.** Below the primary section, `sectionsOpen` sections stay open. The rest collapse into "More on this page" drawers, each titled by kind with a count. | clutter | 1 (P ≥ .8), 2 (P ≥ .6), all | COGA "avoid too much content"; Baughan 2020, complex pages 4.2 → 7.3 s |
| R4 | **Lists in small doses.** The first `listFirst` records show, then "Show n more". Each group of `groupEvery` records gets a group break. | clutter, chunking | 8 / 12 / all; 4 / 5 / 6 | Cowan 2001 (~4 chunks); Hick–Hyman (choice time grows with log₂ n) |
| R5 | **Short paragraphs.** A running-text paragraph longer than `splitSentences` sentences is shown as several, split only at sentence ends. The words do not change. | chunking | 3 / 4 / never | segmenting, Rey 2019 (d = 0.32 retention) |
| R6 | **Outline.** Text with 3 or more headings gets an "On this page" list of links above it. | guidance | on at P ≥ .6 or level 2 | signaling, Schneider 2018 |
| R7 | **One template per list.** Every record has the same fields in the same order and size: title, at most 2 facts, at most 1 image (capped), and 1 action. Ads fold into one "Sponsored (n)" line. | always | — | consistency, COGA; Simola 2011 (ads capture the eyes) |
| R8 | **Calm.** No motion, no carousels, and no sticky or overlay bars. Text uses at most 5 styles: page heading, section heading, title, body and meta. | always | FitLayout type tiers | Forster 2014; Miniukovich 2014 (fewer competing elements beats more white space) |
| R9 | **Physical fit** (docs/10 §4.2): text at least F, targets at least T with the gap, the person's spacing and contrast. | vision, motor | — | docs/10 |

What never changes:
- the page's words (no summaries, no rewriting);
- the order of records within a list;
- where links go;
- what a control does.

Everything the view leaves out is in "Everything else on this page" (conservation, docs/10 §4.7).

## 4. Scorecard: the numbers a restructured page must hit

These are measured on the first screen (1440 × 900 at the person's zoom) and on the whole page. The original page and
Fit view use the same definitions: `fitview/metrics.ts` `measureSurface(root, viewport)` runs on the document and on
the view's shadow root.

| Metric | Definition | Target (structure level 2) | Target (level 0–1) |
| --- | --- | --- | --- |
| **Items in view** | Visible text blocks, images and controls intersecting the first screen. A link inside running text is part of its text block. Fit view's own strip controls are counted apart. | ≤ min(30, 50% of the original) when the original has ≥ 40; otherwise ≤ min(30, the original) | ≤ 70% of the original when it has ≥ 40; otherwise ≤ the original |
| **Choices in view** | Visible interactive controls in the first screen. Excludes links inside running text (`inlineLinks`: shown inline in a text block with more than 10 other characters) and Fit view's own strip controls (`ownChoicesInView`). | ≤ 15 | ≤ 25 |
| **Own controls** | Fit view's strip: Text −, Text +, Original page, More (search field and button belong to the page) | ≤ 6 | ≤ 6 |
| **Text styles** | Distinct font-size × weight pairs over all visible text | ≤ 5 | ≤ 5 |
| **Ads in view** | Visible ad or sponsored records or slots in the first screen | 0 | 0 |
| **Moving things** | Running animations, autoplaying media, carousels | 0 | 0 |
| **Main content start** | Top of the primary section, as a share of the viewport height | ≤ 0.5 | ≤ 0.6 |
| **Group size** | Most records between two group breaks. A record is a repeated, titled box no taller than the screen; a taller box ends a run. | ≤ `groupEvery` | ≤ 6 |
| **Records before "Show more"** | Records rendered before the first disclosure | ≤ `listFirst` | all |
| **Conservation** | Content items of the original reachable: rendered, or in a labelled drawer with a count | 100% | 100% |
| **Template consistency** | Records in one list with a different field order or text size | 0 | 0 |
| **Physical fit** | Visible text below F; controls below T | 0 | 0 |

The definitions were tightened on 2026-10-16, after the first full run, for two reasons. First, links inside an
article's sentences are reading, not choices. Second, halving an already calm page (BBC, Meta) is not a goal; not
making it busier is. Under the first definitions:
- the YouTube channel and the inbox (16 choices) and Amazon product (18) would miss the 15-choice cap;
- Wikipedia would count 26 choices, including 14 inline links;
- Meta would be held to 15 items.

**Reporting.** The eval prints before → after for each page and persona; the `focus` persona is level 2. Release bar:
on the eight reference pages, every level-2 target is met on at least 7 of the 8:
- YouTube search and channel;
- Amazon search and product;
- Wikipedia;
- BBC News;
- Meta store;
- the inbox fixture.

## 5. Results (2026-10-16, `focus` persona = level 2; heuristic spec, no planner)

| Page | Items in view | Choices in view | Meets every level-2 target |
| --- | --- | --- | --- |
| YouTube search | 139 → 14 | 51 → 8 | ✓ |
| YouTube channel | 134 → 26 | 45 → 12 | ✓ |
| Amazon search | 144 → 17 | 58 → 8 | ✓ |
| Amazon product | 154 → 26 | 63 → 14 | ✓ |
| Wikipedia | 81 → 17 | 32 → 8 (+14 links in sentences) | ✓ |
| BBC News | 40 → 16 | 22 → 4 | ✓ |
| Meta store | 30 → 23 | 12 → 9 | ✓ |
| Inbox fixture | 124 → 24 | 21 → 12 | ✓ |

All 8 meet every level-2 target, against a release bar of 7 of 8. The first full run met 3 of 8, under the first
definitions. One level-0 gap remains: Amazon product at F 36 has 5 template mismatches. Evidence (screenshots,
report.html) is in the session scratchpad; re-run with `node scripts/eval/run.mjs --personas focus`.

## 6. Build (2026-10-16)

Contracts are done:
- `core/fit/structure.ts`;
- `FitLayout.structure` with `solveStructure` (solver 1.1.0);
- triage clutter reading the structure need;
- `FitViewEvent` `always` and `FitViewOpenReply.alwaysHere`;
- `SkeletonRegistry.isAd`;
- the eval `focus` persona.

Four work packages with disjoint files:
1. **Understand**: reader and spec. Records with the right titles and media, no empty cards, ads detected, page types
   and product pages right (eval issues B1, B3–B5, M4, M6, M10, m2, m4, m5).
2. **Present**: renderer.
   - R1–R8 and the metrics module.
   - Eval issues B2, M5, M7, m3, m6.
   - Media caps, ad folding, the compact strip, focus on open, comparison tables, and "Always here" in the strip.
3. **Behave**: worker, popup, adapter and live layer.
   - Auto-restructure per §2, the always-available popup switch, and the one-time intro line.
   - WP8's adapter requests and M8 (Wikipedia search).
4. **Tailor**: in-place health and triage features (B6, consistency, m1, M1–M3, M9).
