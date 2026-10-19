# WebAble v2: evidence base

_Compiled 2026-10-15 for [10-V2-Architecture.md](../10-V2-Architecture.md) from the v2 discovery research (code
maps, six literature tracks, two measurement probes, the planner pilot) and the five-lens design review. Claims are
grouped by the docs/10 decision that relies on them._

**How to read it.**
- **Conf.** **H**: primary source read, or measured by the team. **M**: abstract only, a secondary source, a single
  small study, or product practice. **L**: inference, a reviewer's observation, or unverified.
- **Team judgement** marks a number or rule with no source behind it. Most are the † defaults in docs/10, which the
  real-site corpus (§10) calibrates.
- **WebAble measurements** are the team's own probes, run 2026-10-14/15 in installed Chrome. Their scripts lived
  outside the repo; the shipped evaluation is `scripts/eval/*`.
- Model names, prices and API facts are as of 2026-10-14. Sources are listed in full under [References](#references).
- Not here: the real-site evaluation results and the planner re-benchmark on the shipped schema. The evaluation
  writes those (`v2-eval-*.md`, `v2-planner-benchmark.md`).

## 1. What v1 got wrong (docs/10 §1)

| Claim | Source | Conf. | docs/10 |
| --- | --- | --- | --- |
| `text_floor` sets every text element below the floor, page-wide, to exactly the floor. It ignores role, original size and container, and its ladder reaches 48 px. | Repo code (`ops/text.ts`, `core/ops/catalog.ts`) | H | §1, §5.2 |
| Per-element rollback reverts only text whose container fit before and clips after, so line-clamped titles revert and overflow-visible metadata stays enlarged. YouTube search at a 24 px floor: title 18 → 24 px, views and age 12 → 24 px, channel name and description reverted to 12 px (12 elements reverted, all in that class). | WebAble engine probe | H | §1 |
| The overlap check sees only text siblings of the element and two ancestors. On meta.com at 40 px every header link had zero neighbours, so overlapping links passed. | WebAble engine probe | H | §1, §5.2 |
| The outcome is all or patchwork: on YouTube search and channel grids `text_floor` was rolled back whole; on Wikipedia the lead paragraph stayed 16 px while later paragraphs went to 21 px. | WebAble engine probe | H | §1 |
| Typography-only repair leaves layout-emergent properties broken: LLM-written CSS sometimes improved typography but "essentially never" improved reflow, zoom, target size or arrangement. | Wanscher 2026 | M | §1 |
| A minimum applied per element breaks size rank order; platform text scaling avoids this by being order-preserving (see §4). | Apple HIG; Android 14 | H | §1 |

## 2. Triage: a person-relative gap (docs/10 §3)

| Claim | Source | Conf. | docs/10 |
| --- | --- | --- | --- |
| A yes/no "text below the floor" test fires on almost every page. For an 18 px floor, 99% of in-view text area on a Wikipedia article and 81% on YouTube search is below it. | WebAble triage probe | L–M | §3 (why k, not a share) |
| Automated checkers are person-agnostic and incomplete: the best tools found about 30–40% of 142 planted barriers (50% counting "potential" issues); six tools covered at most 50% of WCAG criteria; a vendor reports 57% of issues by volume. | GDS 2017; Vigo 2013; Deque 2021 | M | §3 (triage is a fit gap, not a checker) |
| 95.9% of the top million home pages have detectable failures; 83.9% have low-contrast text. A pass/fail gate would fire everywhere. | WebAIM Million 2026 | H | §3 |
| 44.0% of low-vision respondents use browser zoom and 48.4% screen magnification; 17.9% magnify 400% or more. | WebAIM low vision survey 2018 | H | §3.2 (`currentZoom` in k), §5.1 (the person's zoom wins) |
| Health-bounded whole-page magnification reached 1.6× (SD 0.9) on 50 real pages before a side effect; horizontal scroll stopped 41, narrow wrap 6, overlap 2. Achievable zoom rises with window width. The iterative probe averaged 2.2 s. | Bigham 2014 | H | §3.2 (zMax), §5.1 |
| Caveat: Bigham's 1.6× and the probe's 1.94× (below) were measured with CSS `zoom`, which does not move the viewport media queries see. Browser zoom does. | Bigham 2014; MDN CSS zoom; design review | M | §5.1 (why a breakpoint guard, not a constant) |
| Probing zoom during triage is too expensive: one forced re-layout cost 10–24 ms on The Guardian and about 140–190 ms on Meta; a six-step binary search on Meta took 0.9–1.1 s (headroom 1.94× with root CSS zoom, need 1.29×). | WebAble triage probe | L–M | §3 (static features only), §5.1 (z frozen per page view) |
| A deterministic feature pass fits the budget only if it is viewport-first: 2–28 ms warm, 43–106 ms cold, of which a getComputedStyle sweep over every element cost 49 ms on YouTube search. 50 ms is the long-task threshold. | WebAble triage probe; web.dev RAIL | L–M (probe), H (RAIL) | §10 latency gate |
| The first state of a page can be meaningless: signed-out YouTube home is an empty "Try searching" screen; The Guardian opened under a consent overlay. | WebAble triage probe | L–M | §3.2 (blocking overlay), §4.5 |
| Perceived complexity is predictable from cheap features (R² .65 on 382 pages; text area, non-text area, text groups, image areas). Appeal fell sharply at high complexity; people over 45 preferred low complexity. | Reinecke 2013 | H | §3.1 `layout.density`, §3.2 clutter |
| Complex sites slowed search from 4.2 s to 7.3 s (n = 165), more for people who prefer simple sites (d = .96 vs .67). Caveat: it measured preference for simple sites, not distractibility. | Baughan 2020 | M | §1 point 4, §3.2 (person-relative clutter) |
| Clutter (share of used space) and link count hurt older adults' web search more than younger adults'. Useful-field-of-view decline is a loss of efficiency in clutter. | Grahame 2004; Sekuler 2000 | H | §1 point 4 |
| White space barely predicts aesthetics (r ≈ −.15, n.s. elsewhere); edge congestion and dominant colours do. Reduce competing elements rather than add space. | Miniukovich 2014/2015 | H | §3.2, §4.2 Calm |
| Clutter measures track search time in complex imagery (r ≈ .74–.83), but on websites only Feature Congestion predicted response time. Use clutter as a gate with thresholds, not an objective. | Rosenholtz 2007; Hunt & Moacdieh 2026 | M | §3.2 |
| DOM-only stand-ins work: a complexity score from block corners, words and images (adj. R² .666); block-level chunk density ranked pages with 86% agreement. Image metrics cost seconds per screenshot. | Michailidou 2021; Harper 2013; AIM 2018 | M (scores), H (AIM cost) | §3.1 `layout.density` |
| `isProbablyReaderable` is a sub-millisecond article gate (paragraphs of 140+ characters, √-length score above 20). | Mozilla Readability | H | §3.1 `layout.readerable`, §3.2 representable |
| Extraction is reliable only for articles: the best extractors reach F1 0.93 on articles and 0.41–0.84 on listings, products, forums and service pages. | WCXB 2026 (preprint) | H (abstract) | §3.2 (records or detail page, not free-text extraction) |
| Record detection works: visual-gap record detection reached 98.3% recall and 99.8% precision on 72 pages from 49 sites; deep semantic segmentation agrees poorly with people (F ≈ 0.49). | Zhai & Liu 2005; Liu 2003; Kreuzer 2015 | H / M | §3.1 `layout.records`, §3.2 (≥ 5 records) |
| Large sticky ads take more than 30% of a desktop screen. | Better Ads Standards, as cited in the triage research (no link given; not checked) | M | §3.2 occlusion 30% |
| Adaptation accuracy matters more than predictability: higher accuracy raised use of the adaptive toolbar from 70.6% to 86.4% and cut access time; inaccurate adaptation is worse than none. | Gajos 2008b | H | §3.2 (posterior P ≥ 0.8, auto only above k > 1.15) |
| A conservative planner that "avoids changes when there are none" beat both static (2283 ms) and frequency-based (2298 ms) menus (2162 ms). | Todi 2021 | M–H | §3.2 ("a page that fits gets nothing") |
| Able-bodied participants, who gained least, rated SUPPLE's generated UIs less attractive (3.24 vs 5.14); the cost of change dominates when the benefit is small. | Gajos 2010 | H | §3.2 (fits band up to k = 1.15) |
| The bands (1.15, 10%, 40%, 90th percentile, 15%/30%), the 0.1 hysteresis, P ≥ 0.8, ≥ 5 records covering ≥ 40% of main. | Team judgement (triage research proposal and design review), † in `core/triage/triage.ts` | — | §3.2 |

## 3. Page scale before text scaling (docs/10 §5.1, §4.6)

| Claim | Source | Conf. | docs/10 |
| --- | --- | --- | --- |
| Page zoom scales all content uniformly; text-only scaling causes overflow and overlap. Clipping, truncation or obscuring at 200% is failure F69. Above 200%, zoom "may be more effective than text resizing". | W3C Understanding 1.4.4; F69 | H | §1 point 3, §5.1 |
| At 400% on a 1280 px window the layout is 320 CSS px; content must reflow to one scroll direction, because two-dimensional scrolling loses the reader's place. | W3C Understanding 1.4.10 | H | §5.1 ("the site's own breakpoints do the reflow") |
| Per-tab zoom changes the CSS viewport, so media queries fire; per-tab zoom and its settings reset on navigation. | Chrome tabs API; W3C Understanding 1.4.10 | H | §5.1 (re-applied at `cs:hello`, `pageshow`, prerender) |
| CSS `zoom` changes layout but not the viewport media queries see, so desktop layouts get crammed. Not a stand-in for browser zoom. | MDN CSS zoom; Chrome 128 notes | M | §5.1 |
| Hidden navigation is used about half as often: combo navigation in 89% of tasks vs 44–56% for hidden; first navigation use 21–24 s vs 33 s (n = 179). | NN/g 2016 | M | §5.1 breakpoint guard, §4.2 Navigation |
| At z = 1.6 a 1280 px window is about 800 CSS px, where YouTube shrinks its guide to icons; at z = 2 its search box collapses. | Design review (observation, not measured) | L | §5.1 guard (nav links and search must not drop) |
| Spatial memory survives scaling but not reflow: a stable scaled layout "dramatically outperforms" a reflowing one. | Scarr 2013 (abstract level) | M | §5.1 (z frozen per page view), §4.3 (section order τ ≥ 0.8) |
| Uniform enlargement wastes space and magnifiers force serial exploration; SUPPLE++ re-laid out a dialog at 3× fonts so the whole structure stayed visible, and 8 discrete size settings covered 12–50 pt. No formal low-vision evaluation was reported. | Gajos 2007 | H (method), L (benefit) | §2 (Fit view beyond page scale), §5.1 (presets) |
| Low-vision readers magnify mostly by letter size, not by moving closer (54 of 75). | Granquist 2018 | M–H | §5.1 |
| Older users with cognitive limitations used magnification as a simplification tool; IBM moved its adaptation service client-side after a proxy failed on SSL and rendering fidelity. | Hanson & Richards 2004 | M | §2 (in the browser, on the live page) |
| Magnifiers cause loss of context and missed items (n = 11); a magnifier that keeps local page structure was at least 20% faster for 15 low-vision users. | Szpiro 2016; SteeringWheel 2018 | M | §4 (re-present instead of magnify further) |
| Snap z to Chrome's presets (110/125/150/175/200%), because any page script can read the zoom through `devicePixelRatio`, and an unsnapped z would leak the fit. | Team judgement (privacy review) | — | §5.1, §8 disclosure |
| Over a personal zoom other than 100% the tab factor is not a preset (125% × 1.5 = 187.5%). Accepted trade-off. | Team judgement (build) | — | §5.1 |
| Whether `setZoom` shows Chrome's zoom bubble on every change is unconfirmed; if it does, its Reset must count as Undo. | Design review (unverified) | L | §5.1 |

## 4. Type ramp and the text map (docs/10 §4.2, §5.2)

| Claim | Source | Conf. | docs/10 |
| --- | --- | --- | --- |
| iOS Dynamic Type grows large text much less than small text. Large Title / Body / Caption 2 go 34 / 17 / 11 pt at the default, 48 / 33 / 24 at AX2 and 60 / 53 / 40 at AX5. Large Title : Body compresses 2.00 → 1.45 → 1.13; Caption 2 : Body rises 0.65 → 0.75. | Apple HIG (values read 2026-10-14) | H | §1 point 3, §4.2 Type ramp |
| Where size steps vanish, Apple separates tiers by weight: Headline is Body's size in semibold. | Apple HIG | H | §4.2 (≥ 200 weight or a structural cue) |
| Android 14 scales text non-linearly to 200%: 8 → 16, 12 → 24, 14 → 26, 18 → 30, 24 → 36, 30 → 38 sp, 100 → 100. Stated aim: preserve "the proportional hierarchy" while avoiding cut-off text. | Android 14 features; AOSP `FontScaleConverterFactory` | H | §4.2, §5.2 (monotone map) |
| Both curves are strictly monotonic, keep small text at least at body's factor, grow large text less, and never push text that was below body above it. A fit in log space: exponent ≈ max(0.2, 1 − 0.48·log2 k) above body, 0.5–0.75 below. | Apple HIG; Android 14 (properties); team computation (fit) | H / M | §5.2 (`text_floor`: never above body size) |
| These curves are product decisions, not experiments. No study of a just-noticeable heading : body ratio was found. | Literature search | — | §4.2 († ramp ratios) |
| Proportional scaling makes headings very large; some low-vision users style headings smaller. | W3C LVTF 2016 (draft) | H (draft) | §4.2 (compressive ramp) |
| Entry points were predicted by position, colour and text style, not size. | Still 2018 (via a secondary source) | M | §4.2 (space, rule line, tinted band carry tiers) |
| Signalling improves retention (g = 0.53). Caveat: an instruction effect, not a web-task effect. | Schneider 2018 (via cal-attention) | H | §4.2 |
| Reading speed is flat above critical print size; the fluent range is 0.2°–2° x-height. Bigger is not better. | Legge & Bigelow 2011 | H | §4.2 Body size F = `textMinPx` |
| Normally sighted readers choose about their critical print size on phones, tablets and laptops (0.21°). | Granquist 2018 | M–H | §4.2 |
| Labels and metadata are spot reading, which needs far less reserve than fluent reading; critical acuity reserve is about 3.4. | Whittaker & Lovie-Kitchin 1993 (via cal-vision); Wang 2019 | M | §4.2 Meta = max(0.85F, 14) |
| Ramp ratios 1.8 / 1.45 / 1.25 at F = 16 toward 1.25 / 1.15 / 1.08 at F ≥ 40, meta = max(0.85F, 14), the 1.15× distinguishability step. | Team judgement, shaped by the curves above | — | §4.2 † |

## 5. Spacing, measure, targets, lists and calm (docs/10 §4.2)

| Claim | Source | Conf. | docs/10 |
| --- | --- | --- | --- |
| Above acuity, reading is limited by letter spacing (crowding), not size. Critical spacing is the same for letters, faces and gratings. | Pelli 2007; Pelli & Tillman 2008 | H | §4.2 Spacing |
| Crowding differs stably between people (between-person SD of log Bouma factor 0.08 vs 0.03 test-retest) and is independent of acuity. Spacing cannot be derived from text size. | Kurzawski 2023 | H | §4.2 (spacing from the profile, not from F) |
| Letter spacing without proportionate word spacing impairs reading; wider than standard is not better for typical readers. | Galliussi 2020; Yu 2007 | M / H | §4.2 (letter spacing only with ≥ equal word spacing) |
| Spacing helps a subset a lot: doubled line and word spacing gave +26% (high contrast) and +46% (low contrast) in macular disease; interline spacing alone is a small effect. | Blackmore-Wright 2013; Calabrèse 2010 | M / H | §4.2 |
| WCAG 1.4.12's values rest mainly on one letter-spacing study. | W3C Understanding 1.4.12 | M | §4.2 |
| Grouping by proximity depends on ratios of distances and is scale-invariant, so gaps in em preserve grouping. | Kubovy & Wagemans 1995; Kubovy 1998 | M–H | §4.2 (gaps in em) |
| Between-group gap ≥ 2× within-group gap. | Team judgement | — | §4.2 |
| Reading falls below 80% of maximum speed with fewer than 13 characters per line (normal vision) or 8 (low vision), whatever the font or display. | Atılgan 2020 | H | §4.2 Measure, Grid |
| Endpoint spread fixes the hit rate: an effective width of 4.133σ gives about 96% hits. | Soukoreff & MacKenzie 2004 | H | §4.2 Targets (T from measured S\*) |
| WCAG 2.5.8: 24 × 24 CSS px, or spacing so a 24 px circle on each undersized target touches no other. | W3C Understanding 2.5.8 | H | §4.2 (the circle test with the person's T) |
| Motor-impaired touch errors fell from 42.1% at 6 mm to 7.0% at 18 mm. | Findlater 2017 | H | §4.2 Targets |
| Button size, not spacing (1 vs 3 mm), changed touch behaviour; for older adults spacing of 0–10.5 mm had no significant effect. Gaps matter mainly to stop wrong-target activations. | Sesto 2012; Leitão & Silva | H / M | §4.2 (hit area first, gap = max(8, spacing − T)) |
| A slow but accurate SUPPLE participant did better with smaller targets in one pane. T must be the measured size, not a fixed 44. | Gajos 2010 | H | §4.2 (T = `minTargetPx`) |
| Working memory holds about 4 chunks. Caveat: capacity, not evidence for paging a list; no web trials of item caps for older or ADHD users were found. | Cowan 2001; literature search | H / — | §4.2 Lists (never paged) |
| Records grouped every 6; card width ≈ 11F; column caps 2/3/4; 5 or 8 inline nav links. | Team judgement | — | §4.2 † |
| Salient irrelevant distractors interfere more in ADHD, and high perceptual load removes the excess. | Forster 2014 | H | §4.2 Calm |
| Animated and abrupt ads near text capture the eyes during reading; animated banners slow search and raise workload. | Simola 2011; Burke 2005 | H | §5.2 (calm motion, pause media unchanged), §4.5 |
| Older adults are disproportionately slowed by related distractor text interspersed in a passage. Caveat: distractors inside sentences, not page regions. | Connelly 1991 | H | §1 point 4, §4.2 Calm |
| Sparse groups are searched first and faster. | Halverson & Hornof 2004 (poster) | M | §4.2 Calm |
| W3C COGA patterns: use white spacing, avoid too much content, limit interruptions. | W3C COGA 2021 | M | §4.2 Calm |

## 6. Ability-based design and SUPPLE (docs/10 §1, §4.2, §4.4)

| Claim | Source | Conf. | docs/10 |
| --- | --- | --- | --- |
| Ability-based generated interfaces made motor-impaired users 26.4% faster with 73% fewer errors, and were strongly preferred. | Gajos 2008a (CHI Best Paper) | H | §1 point 1 |
| The full analysis: 28% faster for ability-based vs 10% for preference-based interfaces; errors 0.93% vs 2.57%; 62% of the speed gap to able-bodied users closed (individual gains 32–103%). 11 motor-impaired and 6 able-bodied participants. | Gajos 2010 | H | §1, §10 (gap closure) |
| Most of the gain was manipulation time (8.29 → 0.84 s) from substituting how controls are operated (lists and radio buttons instead of combo boxes, spinners, scrolling). Navigation time got about 3% worse. | Gajos 2010 | H | §1 point 1, §4.4 control substitution |
| Measured ability beat stated preference; people's preferences rested on "different assumptions about what would be easier". | Gajos 2010 | H | §2 (fit from Tune, not settings) |
| Fitts' law fit atypical users poorly (mean R² 0.51); per-person models raised it to 0.71. A Fitts-only optimizer would grow targets to infinity. | Gajos 2007 | H | §4.2 (personal pointing model) |
| SUPPLE's deployment barrier was the hand-written functional specification; the authors planned a web library to get one. | Gajos 2010 | H | §1 point 1, §4.1 (the planner and heuristic produce the spec) |
| SUPPLE "had no declarative knowledge of either muscular dystrophy or cerebral palsy"; it generated interfaces "solely from observed input performance". | Wobbrock 2018 | H | §11 (no diagnosis) |
| Ability-based design principles; transparency (inspect, override, revert, preview) was upheld by only 6 of 14 exemplar projects. | Wobbrock 2011 | H | §7 (one click back, Text − / +) |
| A design-intent preservation term works on live web pages (recolouring for colour-vision deficiency). | SPRWeb 2013 | M | §4.3 (order τ against the original) |
| Integer programming generates responsive and personalised layouts from an existing page; small layout refinements toward a per-user touch model gave 9% faster selection (participants not impaired). | Laine 2021; Reflow 2022 | M / H | §4.2 |
| docs/10's solver is closed-form, ability-parameterised rules, not SUPPLE's optimizer. | Team judgement (design review) | — | §4.2 |
| Select with ≤ 12 options becomes a visible list. | Team judgement | — | §4.4 |

## 7. Verify-or-rollback, and what the model may decide (docs/10 §1, §4.1, §4.7, §5.2, §11)

| Claim | Source | Conf. | docs/10 |
| --- | --- | --- | --- |
| Unverified LLM CSS (six local 7–14B models, 20 live sites) gave 24 improvements and 20 regressions in 100 trials. A verified loop (accept only when violations strictly decrease and no new type appears) detected 57/57 seeded faults with 0/12 false positives and rejected 126/126 harmful candidates, tested with stub generators. | Wanscher 2026 | H (preprint) | §1 point 2, §4.7, §5.2 whole-op rollback |
| Regenerating HTML loses content (91.6–99.4% similarity), so a similarity threshold is too loose; conservation has to be 100%. | Yu 2025 | H | §4.1 "Everything else on this page", §4.7 conservation |
| Vision-language models judge layout quality near chance (GPT-4V 51.6% pairwise, LLaVA 54.6%); a purpose-trained model reached 75.1%. GPT-4V accepted a screen with overflowing text. | UIClip 2024 | H / M | §1 point 2, §11 (no LLM judges layout) |
| Base LLM layouts collide (collision rates 0.69–0.73); direct prompting "rarely produces feasible solutions" on constrained problems. | LaySPA 2025; Orvalho 2026 | M | §1 point 2 (the model decides what things are, code decides size and place) |
| Generated UIs carry about 1.8 semantic accessibility violations each (300 UIs). | Calo 2026 (via a secondary review) | M | §11 (the model never writes HTML) |
| Industry converged on "model emits data, client renders from its own catalog": flat component lists with id references are easy for LLMs to generate. | A2UI; json-render; AI SDK | H | §4.1 (enums and ids only) |
| Generative UI took "a minute or two" per page and still lost to expert pages (Elo 1736 vs 1800); small models produced 29–60% output errors. | Leviathan 2026 | H | §6 (never on the paint path), §11 |
| Strict schemas guarantee syntax, not meaning (100% schema adherence on OpenAI's complex-schema test). | OpenAI Structured Outputs 2024 | H | §4.1 (the validator runs on every spec) |
| Page health = 1 − (area scrolled off-screen + overlapping area + narrow-wrapped area). | Bigham 2014 | H | §4.7 render health, §5.2 verifier |
| Pausing motion must be a fixed rule: only the strongest planner models hid Meta's autoplaying hero video. | WebAble planner pilot | H | §4.5 (media under the view is paused) |

## 8. Offer, undo and learning (docs/10 §1, §7)

| Claim | Source | Conf. | docs/10 |
| --- | --- | --- | --- |
| MyUI (N = 12, ages 49–73): every control pattern beat silent adaptation on transparency, control and acceptability (silent preferred in 3 of 48 cases). For high-benefit adaptations people preferred implicit change with undo (12 vs 4); for low-benefit ones, preview then confirm (13 vs 5). It measured benefit, not size of change. | Peissner & Edlin-White 2013 | H | §1 point 5, §7 (Tailor auto with undo; Fit view offered) |
| MyUI's generator itself: no outcome data found beyond the control-pattern study; AALuis and GPII/Cloud4all reported no efficacy numbers. | Peissner 2012; AALuis; Cloud4all | M / L | §2 (no heavy upfront modelling) |
| Elective "split" adaptation, which copies items while the original stays, was faster and preferred over moving items. | Gajos 2006 | M | §1 point 5, §4 (Fit view copies; the original stays) |
| Static menus beat adaptive ones; adaptable menus were preferred (n = 27). | Findlater & McGrenere 2004 | H | §7 |
| Ephemeral adaptation (timing, not position) helped at 79% accuracy and was harmless at 50%. | Findlater 2009 | H | §7 |
| Preferences for generated UIs vary widely (α = 0.25, 20 people × 600 pairs); a few pairwise judgments beat shared guidelines and people's written preferences. | Peng 2026 | H | §7 (learn from keep/undo) |
| Users of hidden-content filtering lowered the threshold to double-check what was hidden. | Task Mode 2025 | H | §4.1 (nothing unreachable), §11 |
| As many as 42% of blind and low-vision respondents stopped using sites with overlays; 72% of practitioners with disabilities rated overlays not or not very effective. | Makati 2024 (via a secondary summary); WebAIM practitioners survey | M | §7 (offer, never impose) |
| An explicit "Original page" within 30 s counts as undo; a proxied navigation as keep. | Team judgement (design review) | — | §7 |

## 9. Control substitution and proxies (docs/10 §4.3–§4.5)

| Claim | Source | Conf. | docs/10 |
| --- | --- | --- | --- |
| Gmail's delegated handlers need the full sequence `mousedown → mouseup → click`; keyboard events go through a page-world bridge because `keyCode` cannot be set reliably from the isolated world. | InboxSDK source | H | §4.4 Button, Enter via the key bridge |
| React ignores dispatched events unless the value goes through the native setter; its `onChange` listens to `input` for text, `click` for checkboxes and radios, `change` for selects. Vue and Angular follow the same events, and both handle IME composition. | React #10135; React ChangeEventPlugin; Vue forms; Angular DefaultValueAccessor | H | §4.4 Text input, Checkbox, Select |
| Synthetic events are `isTrusted: false` but default actions still run; features like `window.open` need the user's transient activation, so dispatch inside their real click. | MDN isTrusted; MDN transient activation | H | §4.4 Recipes |
| Re-locate the element on every action ("an up-to-date DOM element is located") and check it is connected, enabled and stable. Virtualised lists reuse nodes. | Playwright locators; Playwright actionability | H | §4.4 Identity (never by index) |
| IntersectionObserver is geometric: a missing box stops infinite scroll and lazy loading, while opacity and occlusion do not; `trackVisibility` reports occluded elements. | W3C IntersectionObserver | H | §4.5 (never `display:none`; covering check) |
| Reparenting page nodes crashes frameworks (React with Google Translate); `moveBefore` keeps state but not framework references. | React #11538; Chrome moveBefore; MDN moveBefore | M / H | §11 (never moves the site's nodes) |
| `transform`, `filter`, `perspective` or `will-change` on an ancestor becomes the containing block for `fixed` descendants. | MDN position | H | §4.3 (own host, nothing set on page ancestors) |
| Events from a closed shadow root are retargeted to the host, so page shortcut handlers fire on typing; window capture listeners run before the host. | DOM retargeting rules (inference); design review | M | §4.5 input firewall |
| MAIN-world scripts fall under page CSP, while `scripting.executeScript` accepts files, not code strings; isolated-world scripts are exempt from Trusted Types in Chrome. | Chrome content scripts; Chrome scripting; WebKit bug 290037 | H / M | §4.4 (key bridge is a bundled file), §4.3 (`createElement` only) |
| Reading mode "doesn't work well on video sites, forums, image galleries, interactive maps, forms, quizzes, payment pages, or login screens", and distilled pages carry no forms or page JavaScript. | Chrome Reading mode help; Chromium reader mode docs | H | §3.2 representable, §4.4 never proxied |
| Reader View: +5% reading speed (n = 391), no extra benefit for dyslexia, available on 2% of home pages and 41% of other pages. | Li 2019 | H | §2 (Fit view works beyond articles), §10 baseline |
| LLM task filtering halved screen-reader users' task time (211 → 102 s; gap to sighted 2× → 1.2×, N = 12) and worked on 19 of 20 sites; it failed on a virtualised infinite scroll and used `aria-hidden`, which WebAble forbids. | Task Mode 2025 | H | §4.5 (lazy lists), §11 |
| Copied UI regions stay fully interactive; accessibility-layer proxies support transformed layouts. | Façades 2006; Sinter 2016 | H | §4.4 (every control drives the original) |
| 3 s effect window; 300 ms before `requestSubmit()`; status strip mirrors toasts within 3 s. | Team judgement (design review) | — | §4.4, §4.5 |

## 10. Prompt-injection minimisation: no page text in, enums out (docs/10 §6, §8, §11)

| Claim | Source | Conf. | docs/10 |
| --- | --- | --- | --- |
| Agentic browsers were exploited through page content: hidden text made "Summarize this page" exfiltrate an email address and one-time password; faint text injected through screenshots. | Brave 2025a; Brave 2025b | H | §6 Security, §11 |
| Hidden HTML in an email made Gemini's summary add a fake security alert: a model that writes text is a phishing channel. | 0DIN 2025 | H | §4.3 (text is never generated) |
| OpenAI: prompt injection "is unlikely to ever be fully 'solved'". | OpenAI Atlas 2025 | H | §6 Security |
| Exfiltration needs private data, untrusted content and an external channel together; removing one breaks it. | Willison 2025 | H | §6 (no page text in, enums out) |
| Action-selector and context-minimisation are the patterns with provable guarantees; injected text can then only influence the choice among allowed actions. | Beurer-Kellner 2025 | H | §6 Wire format and Output |
| Marking untrusted input cut attack success from over 50% to under 2%, but probabilistically; capability-based control solved 77% of tasks with provable security. | Spotlighting 2024; CaMeL 2025 | H / M | §6 (architecture over prompting) |
| What remains is adversarial structure, handled in code: protected kinds, the trusted-slot rule, conservation. A probe outline leaked page sentences, titles and list samples, so records carry shapes only. | Team judgement (security review) | — | §4.1 validator, §6 Wire format |
| Withholding page text from the planner cost at most about 0.2 rubric points (gpt-6-sol 4.89 → 4.70 with vocabulary-filtered labels). | WebAble planner pilot | H (pilot) | §6 (the rule is workable) |
| Simplification inserts, deletes and substitutes facts; Apple paused news summaries after a false one; LLM simplification raised comprehension 3.9 points but confidence rose more than accuracy. | Devaraj 2022; MobileSyrup 2025; Guidroz 2025 | H | §4.3, §11 (no generated text) |

## 11. The planner: OpenAI benchmark (docs/10 §6)

**WebAble planner pilot** (2026-10-14): YouTube channel, Wikipedia, Amazon and Meta loaded at 1280 × 800, outline
skeletons with vocabulary-filtered labels, 12 models, 217 planner calls and 112 triage calls, scored against one
hand-labelled answer key (rubric out of 5).

| Claim | Source | Conf. | docs/10 |
| --- | --- | --- | --- |
| gpt-6-sol (reasoning none) scored best: 4.89 (sd .18) over 12 runs, 4.96 at temperature 0; no invalid ids, never more than one primary section. | WebAble planner pilot | H (pilot) | §6 Model |
| gpt-6-sol latency: p50 5.6 s, p95 8.0 s on the default tier; 4.2 / 6.1 s on the fast tier (−25%, quality unchanged). Sections are complete at about 3.0 s. Cost about $0.011 per page, about $0.024 on the fast tier (third-party list prices, fast counted at 2×). | WebAble planner pilot | H (pilot), M (prices) | §6, §10 (planner p95 ≤ 8 s) |
| Fallback gpt-5.6-terra: 4.57 (sd .49), 4.3 / 5.4 s, 3.4 / 4.3 s on priority. gpt-6.1-sol and gpt-6-astra matched quality (4.88) but cannot run without reasoning: 10–14 s. | WebAble planner pilot | H (pilot) | §6 fallback |
| Output length decides latency: 6.4k input tokens add about 100 ms to time to first token; output tokens dominate. | WebAble planner pilot; OpenAI latency guide | H | §6 (`max_output_tokens` 1,800, compact enums) |
| Reasoning above none is not worth it (low adds 2–3 s; medium is harmful). Screenshots add tokens with no quality gain. A JSON skeleton costs 65–70% more tokens than the outline with no gain. | WebAble planner pilot | H (pilot) | §6 (outline written on the server), §8 (no screenshots) |
| 216 of 217 calls returned valid JSON, and none referenced an unknown id; ancestor/descendant overlaps were still common (gpt-6-sol 11 of 44 runs). | WebAble planner pilot | H (pilot) | §4.1 validator (drop overlaps) |
| Plans differ run to run: importance agreement 0.82–0.96 for gpt-6-sol; at temperature 0, 0.90–1.00 but still three different outputs per page. A cache is required for a stable layout. | WebAble planner pilot | H (pilot) | §6 Cache, §7 |
| An earlier latency probe on a synthetic 140-region skeleton: gpt-6-luna on the fast tier took 3.1 s; 36/36 matched the schema, yet weaker models duplicated ids, omitted the primary region, and identical calls produced 13–27 "hide" decisions. | WebAble latency probe | H | §4.1 validator, §6 Cache |
| No LLM in the triage gate: on numbers and a label-free outline, six models got page type right 0–33% of the time. | WebAble planner pilot | H (pilot) | §3 |
| gpt-6-sol sometimes over-curates (it hid Amazon's "Deliver to" and Meta's try-on band). | WebAble planner pilot | H (pilot) | §4.1 protected kinds, "Everything else on this page" |
| Limits: four pages, one author-written answer key, a rubric that saturates near 5, and a schema with a free `heading` string, into which models copied page text. The shipped enum-only schema has not been re-benchmarked; until it is, these are "4-page pilot" numbers. | Design review | — | §4.1, §10 |
| Prompt caching cut cost, not latency (cached and uncached time to first token were equal); the shared prefix was cached across pages on 76 of 157 first calls. | WebAble planner pilot | H (pilot) | §6 (constant `prompt_cache_key`) |

## 12. Policy, privacy and platform limits (docs/10 §6, §8)

| Claim | Source | Conf. | docs/10 |
| --- | --- | --- | --- |
| MV3 extensions may fetch remote data "provided it contains no logic"; an "interpreter to run complex commands fetched from a remote source, even if fetched as data" is rejected. | Chrome Web Store MV3 requirements; troubleshooting; remote hosted code | H | §8 (the spec selects bundled behaviour), §11 |
| Website content is user data even when processed locally; disclosure must sit in the product before collection with a specific consent action; the privacy policy must name every recipient; Limited Use needs an affirmative statement. | CWS User Data FAQ; CWS Limited Use | H | §8 consent copy, receipts |
| From 1 Aug 2026 data must be "strictly necessary", and a change in data handling after install must be disclosed proactively. Adding OpenAI is such a change. | CWS policy updates 2026 | H | §8 (one-time v1 notice; planner only after Fit view opens) |
| OpenAI API data is not used for training by default; abuse-monitoring logs are kept up to 30 days; Responses state is kept 30 days unless `store: false`. | OpenAI data controls | H | §6 (`store: false`), §8 "Kept" |
| Structured Outputs: all fields required, `additionalProperties: false`, up to 1,000 enum values, `pattern` supported; output follows the schema's key order. | OpenAI Structured Outputs guide | H | §4.1 (every string an enum or pattern) |
| Edge Functions: 2 s of CPU time (async I/O excluded), 150 s request idle timeout. | Supabase limits | H | §6 (one 12 s deadline, no retry) |
| The FTC ordered accessiBe to pay $1M and stop unsupported claims that automation makes sites WCAG-compliant. | FTC 2025 | H | §11 (no compliance claims) |
| On-device Gemini Nano needs 22 GB free disk and a GPU with more than 4 GB VRAM or 16 GB RAM with 4 cores, covers five languages, and has no published latency figures. | Chrome Prompt API | H | §2 (heuristic spec on device; planner optional) |
| Quota of 10 per hour and 60 per day per person, 30 per minute and 2,000 per day globally; usage and cached-token counts never returned (a cached-prefix count would tell one person that someone else sent the same structure). | Team judgement (security review), sized from the pilot's cost | — | §6 Cost |

## 13. Evaluation methods (docs/10 §10)

| Claim | Source | Conf. | docs/10 |
| --- | --- | --- | --- |
| Report results as gap closure against an unimpaired baseline (SUPPLE 62%; Task Mode 2× → 1.2×), with SUPPLE's split of search, navigation and manipulation time. SUPPLE removed visual search from its tasks; WebAble's study must not. | Gajos 2010; Task Mode 2025 | H | §10 Study |
| Benchmark wins overstate real-user wins: 84% on a benchmark fell to 50.8% on users' own queries; an LLM judge agreed with people 69% of the time and favoured longer outputs. | Chen 2026 | H | §10 (real sites, familiar × unfamiliar) |
| Confidence is not comprehension; report it separately. | Guidroz 2025 | H | §10 (NASA-TLX, perceived control) |
| Validate a verifier with seeded faults and report detection and false positives; report improvements and regressions per page, not only means. | Wanscher 2026 | H | §10 seeded-fault fixtures, sign tests |
| Pairwise preference with Elo against fixed baselines; report it with and without latency (generation speed was excluded in the original). | Leviathan 2026 | H | §10 |
| LLM accessibility work rarely evaluates with disabled users, and none adapted pages at runtime for older, motor-impaired or cognitively impaired users. | Aljedaani & Mollik 2026 | H / M | §10 Study |

## 14. Gaps: not found or not verified

- No experiment sets an optimal heading : body ratio or a hierarchy just-noticeable difference. The ramp is fitted to
  platform practice.
- No web trials of item caps or progressive disclosure for older or ADHD users.
- Whether a structure-only skeleton specifies a page as well as full HTML is untested; the working systems in this space
  sent HTML (Task Mode, Yu 2025).
- Per-tab zoom headroom on real sites (as opposed to CSS zoom) is not yet measured; the corpus measures it.
- Whether `setZoom` shows Chrome's zoom bubble; Gemini Nano latency; per-algorithm segmentation numbers (Kiesel 2020).
- Read only through secondary sources: Still 2018, Makati 2024's 42%, Calo 2026, UIClip's exact figures. Abstract
  level only: Scarr 2013. Preprints: Wanscher 2026, Leviathan 2026, Peng 2026, WCXB 2026.
- Every † in docs/10 needs calibration on a labelled corpus.

## References

Internal:
- **WebAble engine probe** (2026-10-14). v1's engine test bundle on live youtube.com, meta.com, wikipedia.org and
  github.com with a 21–48 px reader profile; per-element before/after sizes and clip state.
- **WebAble triage probe** (2026-10-15). Geometry and computed-style feature pass, no text read, on Wikipedia, YouTube
  search, Meta and The Guardian at 1440 × 900; profile F = 18, T = 36. Single runs.
- **WebAble latency probe** (2026-10-14). 36 streaming Responses API calls on a synthetic text-free 140-region
  skeleton.
- **WebAble planner pilot** (2026-10-14). 4 pages × 12 models, 217 planner and 112 triage calls; about $2.23 spent.
- **Design review** (2026-10-15). Five lenses: evidence, UX, privacy and security, feasibility, robustness.

External:
- 0DIN 2025. Figueroa, "Phishing for Gemini". https://0din.ai/blog/phishing-for-gemini
- A2UI. Google. https://github.com/google/A2UI
- AI SDK. Vercel, "Generative User Interfaces". https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces
- AIM 2018. Oulasvirta et al., "Aalto Interface Metrics", UIST Adjunct.
  https://acris.aalto.fi/ws/portalfiles/portal/30261274/ELEC_oulasvirta_et_al_2018_002_.pdf
- AALuis. https://www.aal-europe.eu/aaluis/
- Aljedaani & Mollik 2026. "Large Language Models for Web Accessibility: A Systematic Literature Review", W4A.
  https://arxiv.org/abs/2605.13873
- Android 14. "Non-linear font scaling to 200%". https://developer.android.com/about/versions/14/features ; AOSP
  `FontScaleConverterFactory.java`.
  https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/content/res/FontScaleConverterFactory.java
- Angular `default_value_accessor.ts`.
  https://github.com/angular/angular/blob/main/packages/forms/src/directives/default_value_accessor.ts
- Apple HIG, Typography (Dynamic Type sizes). https://developer.apple.com/design/human-interface-guidelines/typography
- Atılgan 2020. Atılgan, Xiong, Legge, "Reconciling print-size and display-size constraints on reading", PNAS.
  https://doi.org/10.1073/pnas.2007514117
- Baughan 2020. Baughan, August, Yamashita, Reinecke, CHI. https://dl.acm.org/doi/fullHtml/10.1145/3313831.3376849
- Beurer-Kellner 2025. "Design Patterns for Securing LLM Agents against Prompt Injections".
  https://arxiv.org/abs/2506.08837
- Bigham 2014. "Making the web easier to see with opportunistic accessibility improvement", UIST.
  https://www.cs.cmu.edu/~jbigham/pubs/pdfs/2014/oppaccess.pdf
- Blackmore-Wright 2013. Blackmore-Wright, Georgeson, Anderson, PLOS ONE. https://doi.org/10.1371/journal.pone.0080325
- Brave 2025a. Chaikin, Sahib, "Agentic Browser Security: Indirect Prompt Injection in Perplexity Comet".
  https://brave.com/blog/comet-prompt-injection/
- Brave 2025b. "Unseeable prompt injections in screenshots". https://brave.com/blog/unseeable-prompt-injections/
- Burke 2005. Burke, Hornof, Nilsen, Gorman, "High-cost banner blindness", TOCHI. https://doi.org/10.1145/1121112.1121116
- Calabrèse 2010. IOVS. https://doi.org/10.1167/iovs.09-3682
- Calo 2026. Calo, Gurita, De Russis, "Measuring the Semantic Accessibility Gap in LLM-Generated Web UIs", CHI EA
  (via a secondary review). https://a11y-paradise.onrender.com/reviews/69e8d16a891b0e7c69dbcfff
- CaMeL 2025. Debenedetti et al., "Defeating Prompt Injections by Design". https://arxiv.org/abs/2503.18813
- Chen 2026. Chen, Zhang, Zhang, Shao, Yang, "Generative Interfaces for Language Models", Findings of ACL.
  https://arxiv.org/abs/2508.19227
- Chrome content scripts. https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome moveBefore. https://developer.chrome.com/blog/movebefore-api
- Chrome Prompt API. https://developer.chrome.com/docs/ai/prompt-api
- Chrome Reading mode help. https://support.google.com/chrome/answer/14218344
- Chrome scripting. https://developer.chrome.com/docs/extensions/reference/api/scripting
- Chrome tabs API. https://developer.chrome.com/docs/extensions/reference/api/tabs
- Chrome 128 notes, standardized CSS zoom. https://developer.chrome.com/release-notes/128
- Chromium reader mode docs.
  https://chromium.googlesource.com/chromium/src/+show/47cd4f581fdc93cbca03bc94de084cd418c8c59e/docs/accessibility/reader_mode.md
- Cloud4all. https://cordis.europa.eu/article/id/116263-making-the-internet-accessible-to-everyone
- Connelly 1991. Connelly, Hasher, Zacks, "Age and reading: the impact of distraction", Psychology and Aging.
  https://doi.org/10.1037/0882-7974.6.4.533
- Cowan 2001. "The magical number 4 in short-term memory", BBS. https://pubmed.ncbi.nlm.nih.gov/11515286/
- CWS Limited Use. https://developer.chrome.com/docs/webstore/program-policies/limited-use
- CWS MV3 requirements. https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements ; troubleshooting:
  https://developer.chrome.com/docs/webstore/troubleshooting ; remote hosted code:
  https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code
- CWS policy updates 2026. https://developer.chrome.com/blog/cws-policy-updates-2026
- CWS User Data FAQ. https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- Deque 2021. https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues
- Devaraj 2022. Devaraj, Sheffield, Wallace, Li, "Evaluating Factuality in Text Simplification", ACL.
  https://arxiv.org/abs/2204.07562
- Façades 2006. Stuerzlinger, Chapuis, Phillips, Roussel, "User Interface Façades", UIST.
  https://vvise.iat.sfu.ca/pubs/stuerzlinger2006uifacades
- Findlater & McGrenere 2004. "A comparison of static, adaptive, and adaptable menus", CHI.
  https://doi.org/10.1145/985692.985704
- Findlater 2009. Findlater, Moffatt, McGrenere, Dawson, "Ephemeral adaptation", CHI.
  https://doi.org/10.1145/1518701.1518956
- Findlater 2017. "Comparing touchscreen and mouse input performance by people with and without upper body motor
  impairments", CHI.
  https://makeabilitylab.cs.washington.edu/media/publications/Findlater_ComparingTouchscreenAndMouseInputPerformanceByPeopleWithAndWithoutUpperBodyMotorImpairments_CHI2017.pdf
- Forster 2014. Forster, Robertson, Jennings, Asherson, Lavie, "Plugging the attention deficit", Neuropsychology.
  https://doi.org/10.1037/neu0000020
- FTC 2025. "FTC Approves Final Order Requiring accessiBe to Pay $1 Million".
  https://www.ftc.gov/news-events/news/press-releases/2025/04/ftc-approves-final-order-requiring-accessibe-pay-1-million
- Gajos 2006. Gajos, Czerwinski, Tan, Weld, "Exploring the design space for adaptive graphical user interfaces", AVI.
  https://kgajos.seas.harvard.edu/papers/kgajos-avi06.pdf
- Gajos 2007. Gajos, Wobbrock, Weld, "Automatically generating user interfaces adapted to users' motor and vision
  capabilities", UIST. https://kgajos.seas.harvard.edu/papers/kgajos-uist07.pdf
- Gajos 2008a. Gajos, Wobbrock, Weld, "Improving the performance of motor-impaired users with automatically-generated,
  ability-based interfaces", CHI. https://doi.org/10.1145/1357054.1357250
- Gajos 2008b. Gajos, Everitt, Tan, Czerwinski, Weld, "Predictability and accuracy in adaptive user interfaces", CHI.
  https://doi.org/10.1145/1357054.1357252
- Gajos 2010. Gajos, Weld, Wobbrock, "Automatically generating personalized user interfaces with Supple", Artificial
  Intelligence 174. https://kgajos.seas.harvard.edu/papers/gajos10supple-aij.pdf
- Galliussi 2020. "Inter-letter spacing, inter-word spacing, and font with dyslexia-friendly features", Annals of
  Dyslexia. https://doi.org/10.1007/s11881-020-00194-x
- GDS 2017. "What we found when we tested tools on the world's least-accessible webpage".
  https://accessibility.blog.gov.uk/2017/02/24/what-we-found-when-we-tested-tools-on-the-worlds-least-accessible-webpage/
- Grahame 2004. Grahame, Laberge, Scialfa, "Age differences in search of web pages", Human Factors.
  https://doi.org/10.1518/hfes.46.3.385.50404
- Granquist 2018. Granquist, Wu, Gage, Crossland, Legge, "How people with low vision achieve magnification in digital
  reading", OVS. https://doi.org/10.1097/opx.0000000000001261
- Guidroz 2025. Guidroz, Ardila et al., "LLM-based Text Simplification and its Effect on User Comprehension and
  Cognitive Load". https://arxiv.org/abs/2505.01980
- Halverson & Hornof 2004. "Local density guides visual search", HFES poster.
  https://www.cs.uoregon.edu/Activities/Poster_Contest/2004/Halverson04visual.pdf
- Hanson & Richards 2004. "A Web Accessibility Service: Update and Findings", ASSETS.
  https://research.ibm.com/publications/a-web-accessibility-service-update-and-findings
- Harper 2013. Harper, Jay, Michailidou, Quan, Behaviour & IT 32(5).
  https://ideas.repec.org/a/taf/tbitxx/v32y2013i5p491-502.html
- Hunt & Moacdieh 2026. "Measuring display clutter in different contexts", Ergonomics.
  https://doi.org/10.1080/00140139.2026.2739579
- InboxSDK. Streak, `simulate-mouse-event.ts`, `trigger-relay-event.ts`. https://github.com/InboxSDK/InboxSDK
- json-render. Vercel Labs. https://cdn.jsdelivr.net/gh/vercel-labs/json-render@main/README.md
- Kreuzer 2015. Kreuzer, Hage, Feelders, ICWE.
  https://researchportal.hw.ac.uk/en/publications/a-quantitative-comparison-of-semantic-web-page-segmentation-appro-2/
- Kubovy & Wagemans 1995. Psychological Science. https://doi.org/10.1111/j.1467-9280.1995.tb00597.x ; Kubovy 1998.
  Kubovy, Holcombe, Wagemans, Cognitive Psychology. https://doi.org/10.1006/cogp.1997.0673
- Kurzawski 2023. "The Bouma law accounts for crowding in 50 observers", J Vision. https://doi.org/10.1167/jov.23.8.6
- Laine 2021. Laine, Zhang, Santala, Jokinen, Oulasvirta, "Responsive and personalized web layouts with integer
  programming", PACM HCI (EICS). https://doi.org/10.1145/3461735
- LaySPA 2025. "LLMs as layout designers: a spatial reasoning perspective". https://arxiv.org/abs/2509.16891
- Legge & Bigelow 2011. "Does print size matter for reading?", J Vision. https://doi.org/10.1167/11.5.8
- Leitão & Silva. "Target and spacing sizes for smartphone user interfaces for older adults".
  https://mural.maynoothuniversity.ie/6045/1/PS-Target-Spacing.pdf
- Leviathan 2026. Leviathan et al., "Generative UI: LLMs are Effective UI Generators".
  https://arxiv.org/abs/2604.09577
- Li 2019. Li, Morris, Fourney, Larson, Reinecke, "The Impact of Web Browser Reader Views on Reading Speed and User
  Experience", CHI. https://wildlab.cs.washington.edu/Publications_files/Li_CHI2019.pdf
- Liu 2003. Liu, Grossman, Zhai, MDR, KDD. https://doi.org/10.1145/956750.956826
- Makati 2024. Makati, Tigwell, Shinohara, ASSETS. https://doi.org/10.1145/3663548.3675650
- MDN CSS zoom. https://developer.mozilla.org/en-US/docs/Web/CSS/zoom
- MDN isTrusted. https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted
- MDN moveBefore. https://developer.mozilla.org/en-US/docs/Web/API/Element/moveBefore
- MDN position. https://developer.mozilla.org/en-US/docs/Web/CSS/position
- MDN transient activation. https://developer.mozilla.org/en-US/docs/Glossary/Transient_activation
- Michailidou 2021. Michailidou, Eraslan, Yesilada, Harper, IJHCS 145. https://doi.org/10.1016/j.ijhcs.2020.102523
- Miniukovich 2014/2015. Miniukovich & De Angeli, AVI 2014 and CHI 2015; PhD thesis (Trento).
  https://iris.unitn.it/retrieve/4428babf-9533-4673-b270-55d7adbd29f9/aesthetics_thesis_v1.2.12_final_1.pdf
- MobileSyrup 2025. Apple pauses notification summaries.
  https://mobilesyrup.com/2025/01/16/apple-temporarily-walks-back-notification-summaries/
- Mozilla Readability, `Readability-readerable.js`.
  https://github.com/mozilla/readability/blob/main/Readability-readerable.js
- NN/g 2016. Hidden vs combo mobile navigation. https://www.nngroup.com/articles/find-navigation-mobile-even-hamburger/
- OpenAI Atlas 2025. "Continuously hardening ChatGPT Atlas against prompt injection attacks".
  https://openai.com/index/hardening-atlas-against-prompt-injection
- OpenAI data controls. https://developers.openai.com/api/docs/guides/your-data
- OpenAI latency guide. https://developers.openai.com/api/docs/guides/latency-optimization
- OpenAI Structured Outputs 2024 (via Willison). https://simonwillison.net/2024/Aug/6/openai-structured-outputs ;
  guide: https://developers.openai.com/api/docs/guides/structured-outputs
- Orvalho 2026. Orvalho, Kwiatkowska, Alenyà, Manyà, "Reliable reasoning with LLMs via preference-based MaxSAT".
  https://arxiv.org/abs/2605.29687
- Peissner 2012. Peissner, Häbe, Janssen, Sellner, "MyUI", EICS. doi:10.1145/2305484.2305500
- Peissner & Edlin-White 2013. "User control in adaptive user interfaces for accessibility", INTERACT.
  https://hal.science/hal-01497467
- Pelli 2007. Pelli, Tillman, Freeman, Su, Berger, Majaj, "Crowding and eccentricity determine reading rate", J
  Vision. https://doi.org/10.1167/7.2.20
- Pelli & Tillman 2008. "The uncrowded window of object recognition", Nature Neuroscience.
  https://doi.org/10.1038/nn.2187
- Peng 2026. Peng, Bigham, Wu, "Efficient Personalization of Generative User Interfaces".
  https://arxiv.org/abs/2604.09876
- Playwright actionability and locators. https://playwright.dev/docs/actionability ;
  https://playwright.dev/docs/locators
- React #10135 and #11538. https://github.com/facebook/react/issues/10135 ;
  https://github.com/facebook/react/issues/11538 ; `ChangeEventPlugin.js`:
  https://github.com/facebook/react/blob/main/packages/react-dom-bindings/src/events/plugins/ChangeEventPlugin.js
- Reflow 2022. Wu, Barik, Zhang, Lea, Nichols, Bigham. https://arxiv.org/abs/2207.07712
- Reinecke 2013. Reinecke et al., "Predicting users' first impressions of website aesthetics…", CHI.
  https://kgajos.seas.harvard.edu/papers/reinecke13aesthetics.pdf
- Rosenholtz 2007. Rosenholtz, Li, Nakano, "Measuring visual clutter", J Vision. https://doi.org/10.1167/7.2.17
- Scarr 2013. Scarr, Cockburn, Gutwin, Malacria, "Testing the robustness and performance of spatially consistent
  interfaces", CHI. https://doi.org/10.1145/2470654.2466430
- Schneider 2018. Signaling meta-analysis, as cited in `cal-attention.md`.
- Sekuler 2000. Sekuler, Bennett, Mamelak, "Effects of aging on the useful field of view", Experimental Aging Research.
  https://doi.org/10.1080/036107300243588
- Sesto 2012. "Effect of touch screen button size and spacing…", Human Factors. https://doi.org/10.1177/0018720811433831
- Simola 2011. "The impact of salient advertisements on reading and attention on web pages", JEP: Applied.
  https://doi.org/10.1037/a0024042
- Sinter 2016. Billah, Porter, Ramakrishnan, EuroSys. https://www.cs.unc.edu/~porter/pubs/sinter16.pdf
- Soukoreff & MacKenzie 2004. "Towards a standard for pointing device evaluation", IJHCS.
  https://doi.org/10.1016/j.ijhcs.2004.09.001
- Spotlighting 2024. Hines et al. https://arxiv.org/abs/2403.14720
- SPRWeb 2013. Flatla, Reinecke, Gutwin, Gajos, CHI. https://www.eecs.harvard.edu/~kgajos/papers/2013/flatla13sprweb.shtml
- SteeringWheel 2018. Billah, Ashok, Porter, Ramakrishnan, CHI. https://www.cs.unc.edu/~porter/pubs/pn1132-billahA.pdf
- Still 2018. "Web page visual hierarchy: Examining Faraday's guidelines for entry points", Computers in Human Behavior
  (via a secondary source). https://doi.org/10.1016/j.chb.2018.03.014
- Supabase limits. https://supabase.com/docs/guides/functions/limits
- Szpiro 2016. Szpiro, Hashash, Zhao, Azenkot, "How people with low vision access computing devices", ASSETS.
  https://doi.org/10.1145/2982142.2982168
- Task Mode 2025. Mohanbabu, Sechayk, Pavel, ASSETS. https://arxiv.org/abs/2507.14769
- Todi 2021. Todi, Bailly, Leiva, Oulasvirta, "Adapting user interfaces with model-based reinforcement learning", CHI.
  https://arxiv.org/abs/2103.06807
- UIClip 2024. Wu et al., UIST. https://arxiv.org/abs/2404.12500
- Vigo 2013. Vigo, Brown, Conway, "Benchmarking web accessibility evaluation tools", W4A.
  https://doi.org/10.1145/2461121.2461124
- Vue, Form Input Bindings. https://vuejs.org/guide/essentials/forms.html
- W3C COGA 2021. "Making Content Usable for People with Cognitive and Learning Disabilities".
  https://www.w3.org/TR/coga-usable/
- W3C IntersectionObserver. https://w3c.github.io/IntersectionObserver/
- W3C LVTF 2016. "Accessibility Requirements for People with Low Vision". https://www.w3.org/TR/low-vision-needs/
- W3C Understanding 1.4.4 and F69. https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html ;
  https://www.w3.org/WAI/WCAG22/Techniques/failures/F69
- W3C Understanding 1.4.10. https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- W3C Understanding 1.4.12. https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html
- W3C Understanding 2.5.8. https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- Wang 2019. Wang, Lin, Guo, Brain and Behavior. https://doi.org/10.1002/brb3.1216
- Wanscher 2026. Wanscher, Lorensen, Shafiq, Tourchi Moghaddam, Alipour, "From Blind Edits to Verified Repair", ICMI
  Companion. https://arxiv.org/abs/2608.24913
- web.dev RAIL. https://web.dev/articles/rail
- WebAIM low vision survey 2018. Survey of Users with Low Vision #2. https://webaim.org/projects/lowvisionsurvey2/
- WebAIM Million 2026. https://webaim.org/projects/million/
- WebAIM practitioners survey. https://webaim.org/blog/practitioners-survey-3/
- WebKit bug 290037. https://bugs.webkit.org/show_bug.cgi?id=290037
- WCXB 2026. Foley, "WCXB: A Multi-Type Web Content Extraction Benchmark" (preprint).
  https://arxiv.org/abs/2605.21097
- Whittaker & Lovie-Kitchin 1993. "Visual requirements for reading", OVS; summarised in `cal-vision.md` via
  https://pmc.ncbi.nlm.nih.gov/articles/PMC3974292/
- Willison 2025. "The lethal trifecta for AI agents". https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
- Wobbrock 2011. Wobbrock, Kane, Gajos, Harada, Froehlich, "Ability-based design", TACCESS 3(3).
  https://makeabilitylab.cs.washington.edu/media/publications/Wobbrock_AbilityBasedDesignConceptPrinciplesAndExamples_TACCESS2011.pdf
- Wobbrock 2018. Wobbrock, Gajos, Kane, Vanderheiden, "Ability-based design", CACM 61(6).
  https://faculty.washington.edu/wobbrock/pubs/cacm-18.pdf
- Yu 2007. Yu, Cheung, Legge, Chung, "Effect of letter spacing on visual span and reading speed", J Vision.
  https://doi.org/10.1167/7.2.2
- Yu 2025. Yu, Ryskeldiev, Tsutsui, Gillingham, Wang, "LLM-Driven Optimization of HTML Structure to Support Screen
  Reader Navigation". https://arxiv.org/abs/2502.18701
- Zhai & Liu 2005. "Web data extraction based on partial tree alignment" (DEPTA), WWW.
  https://archives.iw3c2.org/www2005/proceedings/docs/p76.pdf
