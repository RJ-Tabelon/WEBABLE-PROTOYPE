# WebAble AI decision architecture, designed from first principles around TypeSafe Jev

Design document, 2026-09-28.

**Inputs (read in full):** `jev-official.md` (API contract), `jev-field.md` (independent measurements), `platform.md` (MV3 and Supabase), `engine.md` (extraction, primitives, verification) and `personalization.md` (learning loop), all in `scratchpad/research/`. I also checked the live OpenAPI schema capture (`raw/openapi.json`) for required and optional fields, and the current repo (`packages/shared/src/index.ts`, `apps/extension/lib/*`).

**Labels:**
- **[OFFICIAL]**: TypeSafe docs or spec.
- **[FIELD]**: independent measurement, from `jev-field.md`.
- **[EST]**: my estimate, to be replaced by a measurement.
- **[SPIKE]**: must be verified in a spike of one day or less before relying on it.
- **[DECISION]**: a design choice this document makes.

---

## 0. The answer in one screen

1. **Most of WebAble's "AI decisions" are not model decisions.** Of the 16 responsibilities in the brief:
   - 6 are deterministic transformation or computation.
   - 7 are decisions that deterministic code or learned Beta/Kalman state makes better than any model. They are either measurable facts or facts about the user, and Jev sees neither.
   - 1 is genuinely generative: plain-language simplification.
   - **Jev owns 1 and is a fallback for 1 more**. It owns region-role classification, including main-content disambiguation, but only for regions local rules cannot decide. It is a fallback for page type. (Optional P2: routing free-text feedback in the web app.)

   This is not a hedge. Jev reads short text and structure well and derives badly: it is poor at counting, geometry and anything visual [FIELD §3, §7]. WebAble's hard problems are mostly geometric (clipping, contrast, target spacing) or personal (what this user wants).
2. **One Jev call per page view at most, and only when it can change the outcome.** A call happens only if all of these hold:
   - The user is signed in and opted in to cloud analysis.
   - At least one enabled op consumes Jev answers (dim region, spotlight main, line length or spacing on main, unpin sticky).
   - Local rules left something ambiguous.
   - The local answer cache missed.

   Expected: about 0.25 calls per page view [EST].
3. **Jev never sees the user.**
   - The state is a vocabulary-filtered structural sketch of the page. It carries no body text, URL, domain, title or profile.
   - The request content is identical for every user who sees the same page structure. Only whether a call happens depends on the profile.
   - The user's desirability for an op (θ̄, a Beta posterior) and its intensity (Kalman) are combined **after** the call, in the service worker, as `P(helpful) = A(page) × θ̄(user)`. `A` comes from Jev only after binning into calibrated labels.
4. **Latency.**
   - The instant path uses registered CSS before first paint, then local extraction, policy, apply and verify at about DOMContentLoaded + 60–90 ms, with no network.
   - The Jev refinement path runs extension → Supabase Edge Function pinned near TypeSafe's US-West service → Jev, and back.
   - Budget: **≤ 600 ms p95 from service-worker dispatch to parsed answers**. Estimated p50 is about 180 ms in the US and 280 ms in the EU on a warm connection; p95 is about 420 ms in the US and 540 ms in the EU [EST from FIELD latencies, §6.2].
   - Late answers never cause layout changes after the user starts interacting. They are cached for the next visit to the same template.
5. **Cost.**
   - About 7.3k input tokens for a typical call (6 ambiguous regions, page type and main pick) costs about **$0.00031**.
   - Expected **≈ $0.08 per 1,000 page views** (at most $0.49 if every page view made a maximum call).
   - A generative LLM doing the same job (Claude Haiku 4.5, `claude-haiku-4-5`, $1/$5 per MTok) costs 10–30× more and takes seconds.
6. **Questions are built only on the server, from a fixed versioned catalog.** The client sends typed evidence, never question text. The API key cannot be turned into a general-purpose Jev proxy. The model is **pinned to `jev-1.13.0`** because thresholds are calibrated per version [OFFICIAL §5].
7. **Chrome's Prompt API has no role in the decision layer.** Its one remaining role is **on-device plain-language simplification**, which is user-initiated and keeps body text on the device. The cloud fallback for that feature is a separate, explicit-consent Edge Function.
8. **Supersedes** the earlier plan in `docs/02` and `docs/06`, in which a cloud LLM (Haiku) or Gemini Nano "returns a JSON adaptation plan and CSS strings". Under this design no model emits CSS, selectors, colours or intensities. Jev emits probabilities over options WebAble wrote.

---

## 1. First principles: what each responsibility actually is

Three kinds:
- **(1)** decision, classification or scoring
- **(2)** deterministic transformation or computation
- **(3)** generative language

Where things run:
- **CS**: content script, plain TypeScript, ISOLATED world.
- **SW**: MV3 service worker, the only auth client and the owner of learning state.
- **EF**: Supabase Edge Function.
- **WA**: web app.
- **SP**: side panel (React).

| # | Responsibility | Kind | Owner and exact location | Jev? | Why (evidence) |
|---|---|---|---|---|---|
| 1 | **Page-type classification** (8 categories matching the prior table in `personalization.md` §13.1) | (1) | **Local structural classifier in the CS**: JSON-LD `@type`, `og:type`, `isProbablyReaderable`, `[role=feed]`, search input plus repeated results, password or `cc-*` fields, a large `video` in main. If local `p_max < 0.75` *and* a Jev call is already happening, add the speculative `page_type` Choice (about 430 tokens, no extra latency) | **Fallback only** | Rules are near-certain on the common cases. Page type feeds only prior-table cells and risk modifiers, which are cheap to get wrong (`personalization.md` §17.3). Never trigger a call just for page type. |
| 2 | **Region-role classification** (main content, navigation, promo/ad, recommendations, chat widget, consent banner, help/contact, form, footer, other) | (1) | **CS high-precision rules first**: known CMP roots, chat-vendor hosts and ids, ad iframe hosts plus IAB sizes, landmarks (`engine.md` §2.10–2.12). A rule decides a region when its corpus precision is ≥ 0.90. **Jev Choice `role_<rid>` plus Noul `task_<rid>`** handle the remaining ambiguous regions that are candidates for an attention op (≤ 10 per call). **Main-content disambiguation** (`main_pick` Choice) runs only when Readability-lite's top two candidates are within 25% of each other | **Yes, ambiguous only** | This is Jev's measured sweet spot: closed-set labelling of text plus structure with an escape option and contrastive criteria [FIELD §8]. The rules already cover the high-volume vendors. |
| 3 | **Whether each candidate adaptation applies here** | (1) | **SW policy.** L1 ops (text floor, spacing, contrast, focus ring, motion, targets) use deterministic applicability from measured features, for example the share of characters below the floor or the number of failing targets. L2 ops use a deterministic function of region role (rule or Jev), the `task` Noul and a protected-set veto (§3.6) | Indirect: inputs only | Applicability of L1 ops is a measurement, so asking a model would only add error [FIELD §3.4 counting; `engine.md` §0.1]. |
| 4 | **Intensity selection** | (2) | **SW**: Learner B, a Kalman/probit filter in log space, snaps to the nearest reviewed level with hysteresis (`personalization.md` §7). **CS**: the geometric clamp at plan time, e.g. hit pad = min(profile pad, ⌊gap/2⌋ − 1), and the contrast solver's target ratio | **No** | "Jev is not a calculator … do not interpolate exact magnitudes from a Score" [OFFICIAL §7]. Intensity is a fact about the user, learned from their own adjustments. |
| 5 | **Risk scoring** | (1)+(2) | **SW.** Combines the static op risk class (`paint`, `layout` or `behavior`; `engine.md` §3.2), the category odds modifiers from the reviewed prior table, and the engine-reliability Beta `P_ok`. `P_ok` has a CI-corpus prior per (op, category) plus local verifier counts per (op, site) (`personalization.md` §6) | **No** | Breakage risk is geometric and cascade-dependent, and Jev is visually blind [FIELD §3.12]. The verifier measures it directly. |
| 6 | **Expected usefulness** | (1) | **SW**: `P = A × θ̄`, then the EU ladder `EU_auto = P_ok[P − 2.33(1−P)] − 0.1(1−P_ok)` (`personalization.md` §5.1) | Supplies `A` for L2 only | Usefulness has a page part (A) and a user part (θ̄). Only the page part is a model question. |
| 7 | **Confidence gating** | (1) | **SW**: per-family isotonic recalibration of Jev probabilities, then bins into `clear`/`likely`/`unsure`, then a learned label→A table, then the EU thresholds τ_auto 0.70 and τ_offer 0.40 | Consumes | Never threshold Jev's `confidence` field; use probabilities [FIELD §2]. Choice probabilities are overconfident and need local calibration [FIELD §2]. |
| 8 | **Ambiguity routing** | (1) | **CS** selects what goes to Jev: regions below rule confidence, ranked by area × op relevance, capped at 10. **SW**: a low-confidence Jev answer means *no L2 action on that region*, never a cascade to another model | No | Cascading Jev's low-confidence cases to an LLM made results *worse* (+211 errors vs 84 fixes on Banking77) [FIELD §5]. |
| 9 | **Comparing alternative strategies** | (1) | **SW/CS deterministic strategy table** from measured features (§3.8). **Learned per-op desirability** picks among offered alternatives over time | No | The choice between alternatives is either physics (background kind picks solve vs backplate) or preference (dim vs spotlight). Jev knows neither. |
| 10 | **Retain after verification** | (2) | **CS verifier** (`engine.md` §4): baseline, apply, 2×rAF plus fonts, diff, per-op rollback, then bisect by risk. The acceptance rule is: keep only if the targeted metric improved **and** no new failure class appeared (Wanscher et al.). **SW** updates the E channel | **No** | Needs 10–30 ms and pixel geometry. Jev takes 200+ ms and cannot see layout. |
| 11 | **Incorporating learned preferences** | learned state | **SW**: Learner A (Beta per op, personal ▸ domain), Learner B (Kalman), hard rules, and the label→A table. Domain-free deltas sync to Supabase `learning_state` (RLS) | **Never sees it** | Keeps browsing history out of inference and avoids double counting (`personalization.md` §6). |
| 12 | **Profile derivation from calibration** | (2) | **WA client (TypeScript)**: psychometric fits (staircase/QUEST thresholds, Fitts/effective-width regression, reading-speed plateau, slip distances), producing dimension values plus confidence and quantised need levels 0/1/2. A versioned write to Supabase `profiles`, with check constraints on bounds | **No** | Numeric estimation that must be reproducible and explainable. A model here risks inferring a diagnosis, which the invariants prohibit. |
| 13 | **Feature extraction** | (2) | **CS**: a budgeted walk (≤ 30 ms), contrast sampling, the target circle test, motion inventory, light-VIPS regions, and the **vocabulary filter** (§3.2.3) | **No** | Deterministic and local by construction (`engine.md` §2). |
| 14 | **Verification** | (2) | **CS** geometry, contrast and focus diffs. axe runs only in CI and on-demand deep checks | **No** | As for row 10. |
| 15 | **Plain-language simplification** | **(3)** | **SP**: user-initiated per passage. **On-device Prompt API** when `LanguageModel.availability()` is `available`. Otherwise **EF `simplify`** with `claude-haiku-4-5`, shown the exact text before it is sent. Output is shown side by side and never replaces page text | **No** (cannot generate) | The only responsibility that needs generation. It needs body text, so it must be explicit and per request (§11). |
| 16 | **"Why this changed" explanations** | (3) on the surface, solved as (2) | **SP** templates rendered from the structured `DecisionTrace` (§11.2) | **No** | The explanation must be *faithful* to the actual decision, and an LLM paraphrase can confabulate. Jev cannot generate text anyway. |
| + | *Optional P2*: the web app's free-text "what's hard for you?" | (1) | **WA → EF `route-feedback`**: Jev Choice over functional dimensions, giving a *suggestion the user confirms* (§4.5) | Yes (optional) | Closed-set intent routing is where Jev is strongest [FIELD §8]. It replaces the "LLM turns free text into profile deltas" job in `docs/06`. |

**Tally.** Jev: 1 core (row 2, including `main_pick`), 1 fallback (row 1), 1 optional. Generative LLM: 1, user-initiated. The other 13 rows are deterministic code or learned state. **Of the 15 v1 ops, 5 consume Jev answers** (§3.8), 2 of them only when main content is ambiguous, and only for regions the rules could not decide.

---

## 2. End-to-end sequence

```
 Content script (CS)              Service worker (SW)                 EF "decide" (pinned us-west)          TypeSafe Jev        Postgres
 ─────────────────────            ───────────────────                 ────────────────────────────          ────────────        ────────
 [navigation commit]
 registered CSS files (profile-level L1: focus ring, motion reset, spacing floor tokens) apply BEFORE first paint, no script
 document_start
   ── hello{} ─────────────────────►│ (wakes SW if asleep; cost hidden behind HTML parsing)
                                    │ sender.tab.url → eTLD+1 → siteKey = HMAC(installSecret, eTLD+1)   (local only)
                                    │ getSession(): refresh JWT if < 5 min to expiry
                                    │ if connection idle > 60 s: warm-up GET /functions/v1/decide/health ──►│ (TLS+h2 ready)
   ◄── ack{enabled ops, levels} ────│
 …HTML parsing…
 DOMContentLoaded
   extract viewport features ≤15 ms; local classify (page type, rule roles, main content); vocab-filter labels
   ── planRequest{features, structuralDigest} ─►│
                                    │ pageSig = HMAC(installSecret, siteKey‖digest); answer-cache lookup per component key
                                    │ INSTANT PLAN = local policy (rules + cached Jev answers) × θ̄ × P_ok × hard rules
   ◄── plan{ops, scopes, levels, modes} ─│   (~5 ms)
   apply (one write phase) → settle 2×rAF → verify ≤30 ms → per-op rollback     ≈ DCL + 60–90 ms, zero network
                                    │
                                    │ IF signed-in ∧ opted-in ∧ Jev-consuming op enabled ∧ ambiguous regions uncached
                                    │    ∧ not excluded origin/login/checkout ∧ lang=en ∧ circuit breaker closed:
                                    │ build DecideRequestV1 (evidence only, ≤10 regions)
                                    │── POST /functions/v1/decide  (Bearer JWT, x-region pinned) ──────────►│
                                    │                                     verify JWT (JWKS cached), Zod strict,
                                    │                                     vocab re-check, catalog version check,
                                    │                                     build questions from catalog
                                    │                                     │── rpc consume_ai_quota ─────────────────────────────────►│ (concurrent)
                                    │                                     │── POST /v1/systemone {model:"jev-1.13.0",state,questions} ──►│
                                    │                                     │◄─────────── {model, answers, usage}  (~70–200 ms) ───────────│
                                    │                                     │◄──────────────────────────────── {user_ok, global_ok} ───│
                                    │                                     shape-check, model == pinned?, drop `confidence`
                                    │◄── DecideResponseV1 {probabilities per question} ────────────────────│
                                    │ recalibrate (isotonic per family) → labels → A via label table
                                    │ P = A × θ̄ (Beta) ; EU ladder with P_ok (engine Beta) ; hard rules ; level from Learner B
                                    │ store answers in cache (keyed by component key; profile-free)
   ◄── planDelta{added ops, scopes, modes} ─│
   deadline rule: paint-only ops apply if no user interaction yet and ≤1.5 s after DCL; layout ops wait for next visit
   apply → settle → verify → per-op rollback
   ── outcome events (verifier, undo+reason chip, adjust, keep) ─►│ Learner A/B, engine Beta, label→A table, component exceptions
                                    │ (separately) domain-free learning deltas → Supabase learning_state (RLS)
 Side panel: "Why this changed" (template from DecisionTrace) · Undo · "What was sent" receipt (exact JSON, local only)
```

---

## 3. The Jev call

### 3.1 When a call happens (gating and ambiguity routing) [DECISION]

A call is made only when **all** of the following hold. Each condition is evaluated locally.

| # | Condition | Evaluated in | Reason |
|---|---|---|---|
| G1 | Signed in (the SW holds a Supabase session) **and** the user opted in to "Cloud page analysis" | SW | The proxy needs a JWT for abuse control. The CWS Limited Use policy requires affirmative consent for website content (`platform.md` §2.3). |
| G2 | At least one enabled op consumes Jev answers: `dim_region`, `spotlight_main`, `line_length` or `text_spacing` on main, or `unpin_sticky`. An op counts as enabled when it is pinned or profile-derived, or when its offer probability can reach τ_offer given θ̄ | SW | Most motor-only and many low-vision profiles never need Jev. |
| G3 | Not an excluded origin (user list plus defaults: banking, health portals, `chrome://`). The page has no password or `cc-*` field. Local page type is not `form_checkout` with p ≥ 0.75 | CS/SW | Privacy (`engine.md` §2.15). L2 attention ops on checkout and login pages are low value and high risk. |
| G4 | ≥ 1 **ambiguous candidate** exists. A candidate is a region that could receive a Jev-consuming op: area ≥ 1.5% of the viewport **or** fixed/sticky, not the rule-decided main content, and no required form fields. It is ambiguous when no high-precision rule fired (rule precision < 0.90 on the corpus). Alternatively, main content is ambiguous: no `main` landmark with ≥ 500 chars, no single `article`, and Readability-lite top1 < 1.25 × top2 | CS | Asking about decided regions buys nothing. |
| G5 | Answer cache miss for **those** regions. Cached component keys are removed from the request, so partial calls are normal | SW | §5 |
| G6 | `lang` starts with `en` | CS | Jev is English-primary, with −3 to −11 pp accuracy on non-English state [FIELD §3.10]. The v1 vocabulary is English. Other languages get local rules only until piloted. |
| G7 | Circuit breaker closed. Per tab: ≤ 1 call per 10 s and ≤ 3 per page lifetime (SPA routes, large mutations). Mutation-driven re-asks happen only when the user is idle | SW | Keeps Jev out of hot loops [FIELD §5]. |

**Region priority when more than 10 candidates are ambiguous:** `score = areaPct × opRelevance`, where opRelevance is 2 for fixed/sticky, 1.5 for zones `left_rail`, `right_rail` and `header_band`, and 1 otherwise. Ties break by DOM order. Regions that do not make the cut get no L2 action this page view, and the next page view asks about them if still uncached.

### 3.2 State JSON [DECISION]

**Shape principles:**
- **Page context goes in `state`; each region goes inside its own question's `instructions` object.**
  - Packing N rows into `state` and asking per-row questions degrades by position beyond about 8 items (mean |Δp| 0.26, 77/360 flips) [FIELD §3.6].
  - Questions are isolated branches over *state + that question* [FIELD §0, Hume], so region data placed in a question is private to it and has no position.
  - This is pattern (d) in `jev-field.md` §4. It is untested for accuracy, so **§12 pilots it against pattern (c), one request per region, before auto-apply is enabled.**
  - Latency grows with state + the longest question, not with the question count (flat up to about 100 questions) [FIELD §1]. This design keeps both small: state about 135 tokens, the longest question about 800.
- **Evidence, never conclusions.**
  - The local rule's guess is *not* sent, which avoids anchoring Jev on our own error.
  - The two opinions combine in code: a region goes to Jev only when the rules could not decide it, and then Jev's recalibrated distribution is used, subject to local protective vetoes.
- **Canonical key order, decisive fields first** [FIELD §3.8 jevfuzz, pi-heed anchoring]. The serializer emits keys in the order the TypeScript interfaces declare them and never sorts or reorders dynamically.
- **No free text leaves the device.** Every string is either an enum value from this document or a word from the bundled, published UI vocabulary (§3.2.3).

#### 3.2.1 `state` (page context), about 110–140 tokens

```json
{
  "page": {
    "signals": ["og_type_article", "readerable", "has_site_search", "has_comments_section"],
    "main": { "found_by": "readability", "zone": "center_column", "width": "30-60%" },
    "counts": {
      "regions": "10-20", "links": "100-300", "buttons": "10-30", "text_inputs": "1-3", "forms": "1",
      "required_fields": "0", "headings": "10-30", "images": "10-30", "videos": "0", "text_amount": "10k-50k chars"
    },
    "layout": { "viewport": "desktop", "page_height": "3-10 screens", "pinned_bars": "2" }
  }
}
```

**Enumerations:**
- `signals` is a subset of a fixed 40-token list, in this order:
  - `jsonld_article`, `jsonld_product`, `jsonld_video`, `og_type_article`, `og_type_video`, `readerable`, `role_feed`, `infinite_scroll`, `has_site_search`, `search_results_pattern`, `has_password_field`, `has_payment_fields`, `multi_step_form`, `has_comments_section`, `large_video_in_main`, `map_container`, `rich_text_editor`, `data_grid`, `code_blocks`, `many_tables`, …
- Count buckets use the fixed edges shown in the example. Counts are strings, because Jev reads bucket labels better than raw numbers and exact numbers add nothing [FIELD §3.4].
- `main.found_by` is one of `landmark`, `single_article`, `readability` or `ambiguous`.

#### 3.2.2 Region evidence object (inside each region question), about 110–135 tokens

```json
{
  "zone": "right_rail", "width": "15-30%", "height": "1-3 screens", "pinned": "no",
  "landmark": "complementary", "tag": "aside", "dom_position": "after_main",
  "links": "11-30", "link_density": "high", "text_amount": "500-2k chars",
  "buttons": "0", "inputs": "0", "required_fields": false, "repeated_cards": "4-8",
  "images": "4-10", "video": false, "iframe_kind": "none", "motion": "none",
  "class_words": ["sidebar", "related", "widget"], "heading_words": "most popular", "control_words": []
}
```

| Field | Values | Computed from (CS) |
|---|---|---|
| `zone` | `header_band`, `left_rail`, `right_rail`, `center_column`, `full_width_mid`, `footer_band`, `overlay_top`, `overlay_bottom`, `overlay_center`, `overlay_corner` | Bounding box as % of document and viewport, plus fixed/sticky |
| `width` / `height` | `<15%`, `15-30%`, `30-60%`, `60-90%`, `>90%` (of viewport width) / `<0.1`, `0.1-0.3`, `0.3-1`, `1-3`, `>3 screens` | rect |
| `pinned` | `fixed`, `sticky`, `no` | computed `position` |
| `landmark` | `banner`, `navigation`, `main`, `complementary`, `contentinfo`, `search`, `form`, `region`, `dialog`, `none` | role/element; read-only, never modified |
| `tag` | `div`, `section`, `aside`, `nav`, `header`, `footer`, `form`, `iframe`, `ul`, `article`, `dialog`, `other` | root element |
| `dom_position` | `before_main`, `inside_main`, `after_main`, `unknown` | DOM order vs the main candidate |
| `links`, `buttons`, `inputs`, `images`, `repeated_cards` | buckets | walk; repeated cards = ≥ 2 siblings with the same tag path and class signature (`engine.md` §2.12) |
| `link_density` | `none` (<0.05), `low` (<0.3), `mid` (<0.6), `high` | Readability link density |
| `text_amount` | `0`, `<100`, `100-500`, `500-2k`, `>2k chars` | direct text-node lengths (no `innerText`) |
| `iframe_kind` | `none`, `ad_network`, `chat_vendor`, `video_host`, `social_embed`, `map`, `other` | iframe host looked up in a bundled host→category table. **The hostname itself is never sent.** |
| `motion` | `none`, `transition`, `loop`, `autoplay_video`, `carousel` | motion inventory |
| `class_words` | ≤ 6 vocab words | tokenized `id` and `class` of the root and first child |
| `heading_words` | ≤ 6 vocab words, dropped words shown as `·` | first heading or `aria-label` inside the region |
| `control_words` | ≤ 4 entries of ≤ 4 vocab words each | accessible names of the first 4 controls |

#### 3.2.3 The vocabulary filter (privacy and injection control) [DECISION]

- **Vocabulary.** `VOCAB_V1` is a bundled, reviewed, public list of about 1,500 lowercase English UI and web-structure words: `accept`, `ad`, `advertisement`, `banner`, `cart`, `chat`, `close`, `consent`, `contact`, `cookie`, `faq`, `feedback`, `filter`, `footer`, `help`, `launcher`, `menu`, `messenger`, `more`, `newsletter`, `popular`, `privacy`, `promoted`, `recommended`, `related`, `sidebar`, `sponsored`, `subscribe`, `support`, `trending`, `widget`, `you`, `may`, `also`, `like`, `with`, `us`, …
- **Review rules.** Health, finance, religion, sexuality and politics terms, and all proper nouns, are **excluded** by review.
- **Tokenization.** Split on non-letters and camelCase, then lowercase. Drop tokens shorter than 2 or longer than 20 characters, and all digits. Keep only tokens in `VOCAB_V1`. Collapse runs of dropped tokens to one `·`. Cap at 6 words.
  - `"Welcome back, Caden"` → `"welcome back ·"`
  - `"nyt-RelatedLinks css-1x9k2"` → `["related", "links"]`
- **Server enforcement.** The Edge Function re-validates every word against the same `VOCAB_V1` and returns 422 on any unknown token. A modified client therefore cannot use the proxy to send free text.
- **Effect on privacy.** The set of possible payload strings is enumerable from a public list, so **no novel text can leave the device**.
- **Effect on injection.**
  - Evidence-framed injection is Jev's real weakness (96.5% → 26.5% on one task; 61.4% flips) [FIELD §3.9].
  - A page cannot get an instruction sentence through a six-word bag of dictionary words.
  - The residual risk is a site mislabelling *its own* regions (for example, calling main content "sponsored"). That is bounded by the protected-set veto, the local main-content protection, dims that restore on hover and focus, and one-tap undo.

#### 3.2.4 Budgets and caps

| Item | Cap | Measured size (chars/3.3, a conservative estimate for this JSON) |
|---|---|---|
| `state` | ≤ 200 tokens | about 135 |
| `page_type` question | ≤ 450 | about 430 |
| `role_<rid>` question (region object plus 10 contrastive options) | ≤ 850 | about 785 |
| `task_<rid>` Noul | ≤ 300 | about 275 |
| `main_pick` (≤ 4 candidates + `none`) | ≤ 700 | about 340 with 2 candidates |
| **Regions per call** | **≤ 10** | — |
| Whole request | ≤ 12,000 tokens (the EF trims the lowest-priority regions above this) | 1 region ≈ 1.6k; 3 ≈ 3.8k; 6 + main ≈ 7.3k; 10 + main ≈ 11.6k |
| HTTP body, extension → EF | ≤ 16 KB (EF returns 413 above this) | 6 regions ≈ 5 KB, because the client sends evidence only and the server adds criteria |

All sizes are well inside Jev's 32k "state + longest question" budget. That budget is route-dependent, so budget for 32k total [FIELD §9]. **Replace these estimates with `usage.input_tokens` from the pilot.**

#### 3.2.5 Why the profile is *not* in the state [DECISION]

The brief assumed a compact profile in the state. It is deliberately absent, for five reasons:

1. **Factorization.** Jev knows the page and the learners know the user. Sending need levels to both counts the user twice (`personalization.md` §6).
2. **Jev cannot do the arithmetic.** Questions like "is 14 px too small for someone whose floor is 17 px" are comparisons that the code already computes exactly.
3. **Privacy.** Functional needs are health-adjacent data (GDPR Art. 9; Washington MHMDA, `personalization.md` §14.5). Keeping them out of every Jev payload supports a crisp, checkable claim: *the page-analysis request content never depends on who you are.*
4. **Cache.** Answers survive recalibration, and a profile change triggers no new calls.
5. **No persona inference.** Jev is never asked a question about a person.

The only profile-dependent fact is *whether* a call happens (G2). The EF sees the user id from the JWT regardless. It is needed for quota enforcement and is never forwarded.

The compact profile still exists, locally, as input to the SW policy:

```ts
// SW only. Never serialized into any network payload except the (separate) profile sync.
interface PolicyProfileV1 {
  version: number;                                   // profileVersion, part of the plan-memo key (§5)
  need: Record<'text' | 'contrast' | 'targets' | 'clicks' | 'motion' | 'distraction' | 'spacing' | 'lineLength', 0 | 1 | 2>;
  confidence: number;                                // calibration confidence c ∈ [0,1] → prior strength m0 = 4 + 6c
  dims: Record<DimId, { m: number; v: number }>;     // Learner B state (log space)
}
```

### 3.3 Question catalog `wa-cat-1.0.0` [DECISION]

General rules, all from the evidence:
- Every Choice has an escape option (`other`/`none`). This is the single highest-leverage fix [FIELD §3.1, §4.3].
- Criteria use `{what, not_for}` contrastive objects [OFFICIAL §3; FIELD §4.1].
- Option names are meaningful and consistent with their descriptions [FIELD §3.2, Sun & Xu].
- Option order is fixed as listed [FIELD §3.8].
- A Noul is phrased so that yes means the risky fact [OFFICIAL §3].
- Question ids are ours and not sent to the model.

**No Score primitive in v1.** Nothing in WebAble needs a magnitude from Jev, because degrees (motion area, pinned height, clutter share) are computed. Score confidence also clusters mid-range and does not share thresholds with Choice [FIELD §2].

#### Q1 `page_type`: Choice, asked only if local p_max < 0.75

`instructions`: ``"What kind of page is described in `page`? Judge only from its structural signals and counts."``

| Option | `what` | `not_for` |
|---|---|---|
| `article` | A page mainly for reading one piece of prose: a news story, blog post, essay or long help article. | Lists of many stories; reference docs full of code or tables. |
| `feed_social` | A stream of posts or cards from many authors or sources, endless or paginated. | A single article; results for a search query. |
| `search_results` | Results returned for a query, usually with a search box and filters. | A category page or feed with no query. |
| `form_checkout` | A page whose main purpose is filling in and submitting a form: checkout, sign-up, sign-in, application, booking. | A page that only has a small newsletter or search form. |
| `web_app` | An interactive application: email, editor, dashboard, map, calendar or chat app. | A document that happens to have some buttons. |
| `docs_reference` | Technical or reference documentation: API docs, manuals, wikis with many sections, tables or code. | A news article or blog post. |
| `media_video` | A page built around playing one video or audio item. | An article with an embedded video. |
| `other` | Anything else, including home pages and product pages, or too little evidence to tell. | `null` |

#### Q2 `role_<rid>`: Choice, one per ambiguous region (≤ 10)

`instructions` (structured, holding this region's evidence):

```json
{ "question": "What job does the block described in `region` do on the page described in `page`?",
  "region": { "...": "RegionEvidenceV1 (§3.2.2)" } }
```

| Option | `what` | `not_for` |
|---|---|---|
| `main_content` | The primary content the page exists for: the article body, the result list, the product details, the working area of an app, or the main form. | Side panels, teasers for other pages, site-wide menus. |
| `navigation` | Site or section menus, a header with menu links, breadcrumbs, pagination, a table of contents, or filters and sorting for a list. | Rails of teaser cards for other articles or products. |
| `promo_ad` | Advertising, sponsored or promoted items, marketing or sale banners, newsletter or app-install prompts. | Links to related articles with no sales purpose; cookie or privacy notices. |
| `recommendations` | Teasers pointing to other content: related, recommended, trending, popular, more-from or you-may-also-like rails. | The main list on a feed or search page; paid advertising. |
| `chat_widget` | A floating chat launcher or chat window run by a support or sales chat service. | A help or contact section that is part of the page layout. |
| `consent_banner` | A cookie, privacy or consent notice asking the visitor to accept, reject or manage settings. | A sign-in prompt or a newsletter popup. |
| `help_contact` | Ways to get help: help or support links, contact details or a contact form, FAQ, accessibility or feedback links. | A floating chat launcher; the site footer as a whole. |
| `form` | Fields the visitor fills in and submits to do the page's task: checkout, sign-in, booking, application, advanced search. | A single newsletter box; the site search box in the header. |
| `footer` | The site footer: the bottom block of site links, legal notices, copyright and social links. | A help or contact block that stands on its own. |
| `other` | A clear job not listed here, such as comments, a media player, an author bio or a logo-only header, or too little evidence to tell. | `null` |

#### Q3 `task_<rid>`: Noul, paired with every Q2

`instructions`:

```json
{ "question": "Would a visitor doing the main thing this page is for need to read or use the block described in `region`?",
  "region": { "...": "same RegionEvidenceV1" } }
```

`criteria`:
- `true`: "The block holds content or controls needed for the page's main task, such as filters, the cart, player controls, form fields, pagination or help."
- `false`: "The block can be ignored without affecting the main task, such as ads, teasers for other pages or decorative banners."

**Why a separate Noul:**
- Role taxonomies miss task-critical blocks. A search filter rail can look like "navigation" or "recommendations".
- Noul probabilities track true proportions about 2× better than Choice probabilities [FIELD §2].
- The role and task questions are *independent* factors, so they are split, which is the phishing-bench result (62.6% → 95.0%) [FIELD §4.4]. They are not dependent sub-decisions of one move.

#### Q4 `main_pick`: Choice, only when main content is ambiguous (G4)

`instructions`: ``"Which candidate block is the main content of the page described in `page`, the part the page exists for?"``

`criteria`:
- `{"c1": RegionEvidenceV1, "c2": RegionEvidenceV1, …up to c4, "none": "None of these blocks is the main content."}`
- Candidates are listed in DOM order, with neutral names.
- This is jevnav's validated "pick from a shortlist plus none" pattern (41/41) [FIELD §1, §8].
- Only the argmax and its probability are used. Probabilities are **not** per-candidate scores (IIA fails) [FIELD §4].

#### Catalog summary

| id | primitive | when | max per call | est. tokens each |
|---|---|---|---|---|
| `page_type` | Choice (8) | local page type p_max < 0.75 | 1 | 430 |
| `role_<rid>` | Choice (10) | ambiguous candidate region | 10 | 785 |
| `task_<rid>` | Noul | with every `role_<rid>` | 10 | 275 |
| `main_pick` | Choice (≤ 4 + none) | main content ambiguous | 1 | 340–700 |

At most 22 questions per call. Question count is latency-flat at this scale [FIELD §1: 1→12 questions −9 ms; 16 vs 1 +14 ms].

### 3.4 Worked example (one region, abbreviated)

**Request that the EF sends to TypeSafe:**

```json
{
  "model": "jev-1.13.0",
  "state": { "page": { "signals": ["og_type_article", "readerable", "has_site_search"],
                       "main": { "found_by": "readability", "zone": "center_column", "width": "30-60%" },
                       "counts": { "regions": "10-20", "links": "100-300", "buttons": "10-30", "text_inputs": "1-3",
                                   "forms": "1", "required_fields": "0", "headings": "10-30", "images": "10-30",
                                   "videos": "0", "text_amount": "10k-50k chars" },
                       "layout": { "viewport": "desktop", "page_height": "3-10 screens", "pinned_bars": "2" } } },
  "questions": {
    "role_r4": {
      "type": "choice",
      "instructions": { "question": "What job does the block described in `region` do on the page described in `page`?",
                        "region": { "zone": "right_rail", "width": "15-30%", "height": "1-3 screens", "pinned": "no",
                                    "landmark": "complementary", "tag": "aside", "dom_position": "after_main",
                                    "links": "11-30", "link_density": "high", "text_amount": "500-2k chars",
                                    "buttons": "0", "inputs": "0", "required_fields": false, "repeated_cards": "4-8",
                                    "images": "4-10", "video": false, "iframe_kind": "none", "motion": "none",
                                    "class_words": ["sidebar", "related", "widget"], "heading_words": "most popular",
                                    "control_words": [] } },
      "criteria": { "main_content": { "what": "…", "not_for": "…" }, "navigation": { "what": "…", "not_for": "…" },
                    "promo_ad": { "…": "…" }, "recommendations": { "…": "…" }, "chat_widget": { "…": "…" },
                    "consent_banner": { "…": "…" }, "help_contact": { "…": "…" }, "form": { "…": "…" },
                    "footer": { "…": "…" }, "other": { "what": "…", "not_for": null } }
    },
    "task_r4": { "type": "noul",
                 "instructions": { "question": "Would a visitor doing the main thing this page is for need to read or use the block described in `region`?",
                                   "region": { "…": "same object" } },
                 "criteria": { "true": "…", "false": "…" } }
  }
}
```

**Illustrative response.** The shape is exact; the numbers are invented.

```json
{ "model": "jev-1.13.0",
  "answers": {
    "role_r4": { "type": "choice", "choice": "recommendations", "confidence": 0.9,
                 "probabilities": { "main_content": 0.0, "navigation": 0.02, "promo_ad": 0.05, "recommendations": 0.91,
                                    "chat_widget": 0.0, "consent_banner": 0.0, "help_contact": 0.0, "form": 0.0,
                                    "footer": 0.0, "other": 0.02 } },
    "task_r4": { "type": "noul", "noul": 0.06 } },
  "usage": { "input_tokens": 1402, "output_tokens": 31 } }
```

The mapping (§3.6):
1. P_elig = 0.05 + 0.91 = 0.96 and P_prot = 0.02, which is under 0.05, so there is no veto.
2. The task Noul is 0.06, which is ≤ 0.10, so the label is **`clear`**.
3. A = labelTable[`dim_region`][`clear`], initially 0.80 or the corpus Wilson bound.
4. With θ̄ = 0.90, P = 0.72 > 0.70, so the region is auto-dimmed if the op is profile-derived or pinned, and offered otherwise.

### 3.5 Thresholds

All thresholds apply to **recalibrated** values. Recalibration uses per-family isotonic maps fitted on the labelled corpus (§12), keyed by `(catalog, model)`. Before a fit exists, the maps are the identity and the conservative thresholds below apply. **The `confidence` field is never used** [FIELD §2: never better than max-probability, sometimes much worse].

| Quantity | Definition | `clear` | `likely` | `unsure` | otherwise |
|---|---|---|---|---|---|
| Region dimmable | P_elig = Σ p(role ∈ {promo_ad, recommendations, chat_widget}) | P_elig ≥ 0.90 ∧ task ≤ 0.10 | P_elig ≥ 0.75 ∧ task ≤ 0.20 | P_elig ≥ 0.50 ∧ task ≤ 0.20 | not applicable |
| **Veto** (checked first) | P_prot = Σ p(role ∈ {main_content, navigation, form, help_contact, consent_banner, footer}) | P_prot ≥ 0.05 **or** task ≥ 0.20 **or** a local protective rule fires (required fields, focus inside, search input, help/contact vocab words, `inside_main`) → the region is protected for this page view | | | |
| Feed and search special case | page ∈ {feed_social, search_results} ∧ zone = center_column | protected (recommendations *are* the content there) | | | |
| Main content (`main_pick`) | p(top) where top ≠ none | ≥ 0.80: main scope = candidate | 0.60–0.80: paint-only overlays (spotlight *offer*) only | — | no main-scoped L2 ops; all candidates protected |
| Page type (Jev fallback) | p_max | ≥ 0.80: category for priors **and** risk modifiers | 0.60–0.80: priors only | — | `other` |
| Sticky header unpin role | P(navigation) with a sticky/fixed top band > 20% of viewport height after zoom | ≥ 0.80 → `unpin_sticky` applicable | — | — | never unpin (and never unpin consent or chat) |

**Rationale for the numbers:**
- Field thresholds that actually separated right from wrong were high:
  - 0.99 in PriorBench;
  - p ≥ 0.9 gave a 1.000 hit rate at 21–32% coverage in jev-exploration;
  - in phishing, the 0.85–0.95 band was only about 60% accurate [FIELD §2].
- A *wrong* dim of needed content is costly, while a *missed* dim costs little. The veto side is therefore deliberately hair-trigger (0.05 / 0.20) and the act side strict.
- Noul values are under-confident [FIELD §2, T 0.66], so a stated 0.20 is conservative.
- No threshold sits at exactly 0.5 (Noul jitter is 0.46–0.54) [FIELD §1].

### 3.6 How answers map into the adaptation plan (SW)

```ts
// apps/extension/lib/ai/plan.ts (SW). Pure function; unit-tested with recorded Jev fixtures.
type RegionRole = 'main_content' | 'navigation' | 'promo_ad' | 'recommendations' | 'chat_widget'
                | 'consent_banner' | 'help_contact' | 'form' | 'footer' | 'other';
type Label = 'clear' | 'likely' | 'unsure';
const DIMMABLE: readonly RegionRole[] = ['promo_ad', 'recommendations', 'chat_widget'];
const PROTECTED: readonly RegionRole[] = ['main_content', 'navigation', 'form', 'help_contact', 'consent_banner', 'footer'];

interface RegionVerdict { rid: string; componentKey: string; label: Label | null; protected: boolean; source: 'rule' | 'jev' }

function verdictFromJev(rid: string, ck: string, role: Record<RegionRole, number>, task: number,
                        page: PageCategory, ev: RegionEvidenceV1, localProtect: boolean, cal: Recalibration): RegionVerdict {
  const sum = (s: readonly RegionRole[]) => s.reduce((a, r) => a + (role[r] ?? 0), 0);
  const pElig = cal.dimEligible(sum(DIMMABLE));          // isotonic; identity before corpus fit
  const pProt = cal.protectedRole(sum(PROTECTED));
  const pTask = cal.taskNeed(task);
  const feedCenter = (page === 'feed_social' || page === 'search_results') && ev.zone === 'center_column';
  if (localProtect || feedCenter || pProt >= 0.05 || pTask >= 0.20) return { rid, componentKey: ck, label: null, protected: true, source: 'jev' };
  const label: Label | null =
      pElig >= 0.90 && pTask <= 0.10 ? 'clear'
    : pElig >= 0.75 ? 'likely'
    : pElig >= 0.50 ? 'unsure' : null;
  return { rid, componentKey: ck, label, protected: false, source: 'jev' };
}

// Applicability A for an L2 op on a region, then the personalization policy decides auto/offer/skip.
function applicability(op: OpId, v: RegionVerdict, labelTable: LabelTable, rulePrecision: RulePrecisionTable, ruleId?: string): number {
  if (v.protected || v.label === null) return 0;
  return v.source === 'rule' ? rulePrecision[op][ruleId!]          // e.g. known ad-iframe host: ~0.98 from the corpus
                             : labelTable.mean(op, v.label);        // Beta per (op,label), monotone clear ≥ likely ≥ unsure
}
// Then, per candidate (op, scope): decide(ctx, userState, domainState, op, now) from personalization.md §11
// with A injected, giving { action: 'auto' | 'offer' | 'skip', level, why } and a DecisionTrace (§11.2).
```

**Plan assembly:**
- The instant plan runs at DCL with rule verdicts and cached Jev verdicts.
- The PlanDelta arrives after Jev and contains only ops whose decision changed from `skip` to `auto` or `offer`.
- **Jev never removes an already-applied op.** A later Jev verdict of "protected" on a region the rules dimmed does undo that op, because protection wins, and records an E-channel note.
- The plan is a list of `{ op, scope: componentKey[] | 'page', level, mode, trace }`. The CS resolves component keys to elements through its local registry, then applies, verifies and rolls back.

### 3.7 The deterministic strategy table (responsibility 9)

| Situation (measured) | Strategy chosen deterministically | Alternatives the learner can prefer (separate ops) |
|---|---|---|
| Small text: ≥ 30% of main-text characters below the floor on a responsive layout | `text_scale` (per-origin zoom) | `text_floor` |
| Small text: < 30% of characters below the floor (outliers) | `text_floor` (per-element tokens) | `text_scale` |
| Contrast failure, background `solid`/`translucent` | per-pair OKLCH lightness solve | — |
| Contrast failure, background `image`/`gradient`/`overlap` | backplate | skip if the verifier fails |
| Contrast failure, background `unknown` | skip | — |
| Distraction on `article`/`docs_reference` | dim `promo_ad`/`recommendations` regions; offer `spotlight_main` | `line_length` |
| Distraction on `feed_social`/`search_results` | dim `promo_ad` only (recs are content) | — |
| Sticky top band > 20% of viewport height after zoom | `unpin_sticky` if the role is navigation | dim if the role is promo_ad |
| Consent banner detected | **never answer, never dim, never unpin**; exclude it from other ops | — |
| Chat widget | dim (opacity 0.35, restored on hover or focus-within), never hidden | — |

### 3.8 v1 op library and which ops consume Jev

| op | group | Jev input | risk |
|---|---|---|---|
| `text_scale`, `text_floor`, `contrast_fix`, `focus_ring`, `target_expand`, `target_gap`, `click_stabilize`, `hover_keep`, `reduce_motion`, `pause_media` | vision / motor / attention | **none** | paint / layout / behavior |
| `text_spacing` | vision, attention | `main_pick` only if main content is ambiguous | layout |
| `line_length` | attention, vision | `main_pick` only if main content is ambiguous | layout |
| `spotlight_main` | attention | `main_pick` | paint (overlay) |
| `dim_region` | attention | `role_*`, `task_*` | paint |
| `unpin_sticky` | vision under zoom | `role_*` only if the sticky band is ambiguous | layout |

---

## 4. TypeScript: the Jev adapter (exact API contract) and WebAble's wire types

### 4.1 TypeSafe System One API types (`packages/shared/src/jev/api.ts`)

These match `POST https://api.typesafe.ai/v1/systemone` as documented [OFFICIAL §2] and the OpenAPI 3.1 schema, `info.version` 0.2.0 (`raw/openapi.json`, checked field by field).

```ts
/** Any JSON value (used inside structured entries). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** "EntryType": string | object | array | null. Used by `instructions`, Choice option descriptions, Noul true/false. */
export type JevEntry = string | { [key: string]: JsonValue } | JsonValue[] | null;
/** Score level entry: string | object | array (the spec does not allow null here). */
export type JevLevel = string | { [key: string]: JsonValue } | JsonValue[];
/** `state`: string | object | array. A bare number or boolean returns 422 [FIELD §0]. */
export type JevState = string | { [key: string]: JsonValue } | JsonValue[];

export interface JevNoulQuestion {
  type: 'noul';
  /** Spec: optional and nullable. Docs: required. WebAble always sends it. */
  instructions?: JevEntry;
  /** Optional. "What a yes (value near 1) means" / "What a no (value near 0) means". */
  criteria?: { true?: JevEntry; false?: JevEntry } | null;
}
export interface JevChoiceQuestion<O extends string = string> {
  type: 'choice';
  instructions?: JevEntry;
  /** Required. Option name → description (null = self-explanatory). Docs: ≤ 255 options (400 "Too many choices"). */
  criteria: Record<O, JevEntry>;
}
export interface JevScoreQuestion {
  type: 'score';
  instructions?: JevEntry;
  /** Required. Ordered low → high. Docs: 2–10 levels (spec minItems 1; the SDKs reject < 2). */
  criteria: [JevLevel, JevLevel, ...JevLevel[]];
}
export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;

/** Accepted model names. WebAble pins the versioned id; aliases move on release [OFFICIAL §5]. */
export type JevModelId = 'jev-1.13.0' | 'jev-latest' | 'jev-preview';

export interface JevRequest<Q extends Record<string, JevQuestion> = Record<string, JevQuestion>> {
  state: JevState;          // required
  model: JevModelId;        // required
  questions: Q;             // required, minProperties 1. Keys are yours and are NOT sent to the model.
}
// The API has no temperature, seed, top_p, stream, system or batch fields. Never send unknown fields.

export interface JevNoulAnswer { type: 'noul'; noul: number }                 // P(yes) in [0,1]; no confidence field
export interface JevChoiceAnswer<O extends string = string> {
  type: 'choice';
  choice: O;                                   // argmax option
  confidence: number;                          // = (n·p_max − 1)/(n − 1) on jev-1.13.0 (derived; do not threshold)
  probabilities: Record<O, number>;            // sum ≈ 1, quantised to 0.01
}
export type JevLevelKey = `${number}`;         // "0" … "n-1"
export interface JevScoreAnswer {
  type: 'score';
  score: number;                               // Σ i·p_i over level indices (not 0–1)
  confidence: number;
  legend: Record<JevLevelKey, JevLevel>;       // echoes the criteria exactly as sent (objects stay objects)
  probabilities: Record<JevLevelKey, number>;
}
export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export type AnswerFor<Q> =
  Q extends JevChoiceQuestion<infer O> ? JevChoiceAnswer<O> :
  Q extends JevScoreQuestion ? JevScoreAnswer :
  Q extends JevNoulQuestion ? JevNoulAnswer : never;

export interface JevUsage { input_tokens: number; output_tokens: number }    // output tokens are not billed

export interface JevResponse<Q extends Record<string, JevQuestion> = Record<string, JevQuestion>> {
  model: string;                               // resolved version, e.g. "jev-1.13.0" (may differ from an alias)
  answers: { [K in keyof Q]: AnswerFor<Q[K]> };  // minProperties 1, keyed by your question ids
  usage: JevUsage;
}

/** 422 (FastAPI-style). */
export interface JevValidationErrorBody {
  detail: Array<{ loc: Array<string | number>; msg: string; type: string; input?: unknown; ctx?: Record<string, unknown> }>;
}
/** Observed: 401 for an invalid key, 403 for a missing key (docs list 401 only). */
export interface JevAuthErrorBody { detail: { error_type: 'authentication_error'; message: string } }

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const JEV_REQUEST_ID_HEADER = 'x-typesafe-request-id';
/** Documented: 401, 422, 429, 529. Also seen: 400 ("Too many choices"; max_tokens_exceeded on some routes), 403, 5xx. */
export type JevHttpStatus = 400 | 401 | 403 | 404 | 422 | 429 | 529 | 500 | 502 | 503 | 504;
```

### 4.2 The adapter (`packages/shared/src/jev/client.ts`, used by the Edge Function)

The adapter uses raw `fetch` so it runs unchanged in Deno. The official `@typesafe-ai/sdk` 0.6.0 would also work with `retry: { maxRetries: 0 }` and a `timeout`, but its default of 2 retries with 500 ms backoff would destroy the latency budget.

```ts
import { JEV_ENDPOINT, JEV_REQUEST_ID_HEADER, type JevQuestion, type JevRequest, type JevResponse } from './api.ts';

export type JevFailure =
  | { kind: 'timeout' } | { kind: 'network' }
  | { kind: 'rate_limited'; retryAfterMs?: number }       // 429
  | { kind: 'overloaded' }                                // 529
  | { kind: 'auth'; status: 401 | 403 }
  | { kind: 'invalid'; status: 400 | 422; body: unknown } // our bug: alert, never retry
  | { kind: 'server'; status: number }
  | { kind: 'shape'; issue: string }                      // response failed runtime validation
  | { kind: 'model_drift'; got: string };                 // resolved model ≠ pinned

export type JevResult<Q extends Record<string, JevQuestion>> =
  | { ok: true; data: JevResponse<Q>; requestId: string | null; ms: number }
  | { ok: false; error: JevFailure; requestId: string | null; ms: number };

export async function callJev<Q extends Record<string, JevQuestion>>(
  req: JevRequest<Q>,
  opts: { apiKey: string; timeoutMs: number; pinnedModel: string; signal?: AbortSignal },
): Promise<JevResult<Q>> {
  const t0 = performance.now();
  const signal = AbortSignal.any([AbortSignal.timeout(opts.timeoutMs), ...(opts.signal ? [opts.signal] : [])]);
  let res: Response;
  try {
    res = await fetch(JEV_ENDPOINT, {
      method: 'POST', signal,
      headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(req),               // key order preserved as built: canonical by construction
    });
  } catch (e) {
    const kind = (e as Error).name === 'TimeoutError' ? 'timeout' : 'network';
    return { ok: false, error: { kind }, requestId: null, ms: performance.now() - t0 };
  }
  const requestId = res.headers.get(JEV_REQUEST_ID_HEADER);
  const fail = (error: JevFailure) => ({ ok: false as const, error, requestId, ms: performance.now() - t0 });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (res.status === 429) {
      const ms = Number(res.headers.get('retry-after-ms')) || Number(res.headers.get('retry-after')) * 1000 || undefined;
      return fail({ kind: 'rate_limited', retryAfterMs: ms });
    }
    if (res.status === 529) return fail({ kind: 'overloaded' });
    if (res.status === 401 || res.status === 403) return fail({ kind: 'auth', status: res.status });
    if (res.status === 400 || res.status === 422) return fail({ kind: 'invalid', status: res.status, body });
    return fail({ kind: 'server', status: res.status });
  }
  const body = (await res.json().catch(() => null)) as JevResponse<Q> | null;
  const issue = checkShape(req.questions, body);
  if (issue) return fail({ kind: 'shape', issue });
  if (body!.model !== opts.pinnedModel) return fail({ kind: 'model_drift', got: body!.model });
  return { ok: true, data: body!, requestId, ms: performance.now() - t0 };
}

/** Runtime check: every asked id answered with the same type, choices within the option set, probabilities in [0,1]. */
function checkShape(qs: Record<string, JevQuestion>, body: any): string | null {
  if (!body || typeof body.model !== 'string' || typeof body.answers !== 'object' || !body.usage) return 'envelope';
  for (const [id, q] of Object.entries(qs)) {
    const a = body.answers[id];
    if (!a || a.type !== q.type) return `missing_or_type:${id}`;
    const in01 = (x: unknown) => typeof x === 'number' && x >= 0 && x <= 1;
    if (q.type === 'noul' && !in01(a.noul)) return `noul:${id}`;
    if (q.type === 'choice') {
      const opts = Object.keys(q.criteria);
      if (!opts.includes(a.choice)) return `choice:${id}`;
      if (!Object.entries(a.probabilities ?? {}).every(([k, p]) => opts.includes(k) && in01(p))) return `probs:${id}`;
    }
    if (q.type === 'score') {
      const n = q.criteria.length;
      if (!Object.entries(a.probabilities ?? {}).every(([k, p]) => Number(k) >= 0 && Number(k) < n && in01(p))) return `levels:${id}`;
    }
  }
  return null;
}
```

### 4.3 WebAble wire types, extension ↔ proxy (`packages/shared/src/decide/v1.ts`)

```ts
export const CATALOG_VERSION = 'wa-cat-1.0.0' as const;
export const JEV_PINNED_MODEL = 'jev-1.13.0' as const;

export type PageCategory = 'article' | 'feed_social' | 'search_results' | 'form_checkout' | 'web_app'
                         | 'docs_reference' | 'media_video' | 'other';
export type Zone = 'header_band' | 'left_rail' | 'right_rail' | 'center_column' | 'full_width_mid' | 'footer_band'
                 | 'overlay_top' | 'overlay_bottom' | 'overlay_center' | 'overlay_corner';
type CountBucket = '0' | '1' | '1-3' | '4-10' | '11-30' | '10-30' | '30-100' | '100-300' | '>300';   // fixed per field
type VocabWord = string & { readonly __vocab: unique symbol };   // only produced by vocabFilter(); Zod-refined server-side

export interface RegionEvidenceV1 {                 // key order is part of the contract (canonical serialization)
  zone: Zone;
  width: '<15%' | '15-30%' | '30-60%' | '60-90%' | '>90%';
  height: '<0.1 screens' | '0.1-0.3 screens' | '0.3-1 screens' | '1-3 screens' | '>3 screens';
  pinned: 'fixed' | 'sticky' | 'no';
  landmark: 'banner' | 'navigation' | 'main' | 'complementary' | 'contentinfo' | 'search' | 'form' | 'region' | 'dialog' | 'none';
  tag: 'div' | 'section' | 'aside' | 'nav' | 'header' | 'footer' | 'form' | 'iframe' | 'ul' | 'article' | 'dialog' | 'other';
  dom_position: 'before_main' | 'inside_main' | 'after_main' | 'unknown';
  links: CountBucket; link_density: 'none' | 'low' | 'mid' | 'high';
  text_amount: '0' | '<100 chars' | '100-500 chars' | '500-2k chars' | '>2k chars';
  buttons: CountBucket; inputs: CountBucket; required_fields: boolean;
  repeated_cards: '0' | '2-3' | '4-8' | '>8';
  images: CountBucket; video: boolean;
  iframe_kind: 'none' | 'ad_network' | 'chat_vendor' | 'video_host' | 'social_embed' | 'map' | 'other';
  motion: 'none' | 'transition' | 'loop' | 'autoplay_video' | 'carousel';
  class_words: VocabWord[];                         // ≤ 6
  heading_words: string;                            // ≤ 6 VocabWords joined by ' ', '·' for dropped runs
  control_words: string[];                          // ≤ 4 entries × ≤ 4 VocabWords
}

export interface PageContextV1 {
  signals: PageSignal[];                            // fixed 40-token enum, emitted in enum order
  main: { found_by: 'landmark' | 'single_article' | 'readability' | 'ambiguous'; zone: Zone | 'unknown'; width: RegionEvidenceV1['width'] | 'unknown' };
  counts: Record<'regions' | 'links' | 'buttons' | 'text_inputs' | 'forms' | 'required_fields' | 'headings' | 'images' | 'videos' | 'text_amount', string>;
  layout: { viewport: 'phone' | 'tablet' | 'desktop'; page_height: '<1 screen' | '1-3 screens' | '3-10 screens' | '>10 screens'; pinned_bars: '0' | '1' | '2' | '3+' };
}

/** Extension SW → EF. Evidence only: no question text, no URL/domain/title/profile/ids beyond ephemeral rids. */
export interface DecideRequestV1 {
  v: 1;
  catalog: typeof CATALOG_VERSION;
  lang: 'en';
  page: PageContextV1;
  regions: Array<{ rid: `r${number}`; ev: RegionEvidenceV1 }>;            // 0..10 (ephemeral per page view)
  mainCandidates?: Array<{ cid: 'c1' | 'c2' | 'c3' | 'c4'; ev: RegionEvidenceV1 }>;  // 2..4 when main is ambiguous
  ask: { pageType: boolean };
}

/** EF → extension SW. Probabilities only; `confidence`, `legend` and the `choice` echo are dropped. */
export type DecideResponseV1 =
  | { v: 1; ok: true; catalog: typeof CATALOG_VERSION; model: string;
      pageType?: Record<PageCategory, number>;
      mainPick?: Partial<Record<'c1' | 'c2' | 'c3' | 'c4' | 'none', number>>;
      regions: Record<`r${number}`, { role: Record<RegionRole, number>; task: number }>;
      inputTokens: number; ms: { jev: number; edge: number } }
  | { v: 1; ok: false;
      degraded: 'timeout' | 'rate_limited' | 'overloaded' | 'upstream' | 'model_drift' | 'catalog_mismatch' | 'quota' | 'bad_input';
      retryAfterMs?: number };
```

### 4.4 Edge Function `decide` (condensed; `supabase/functions/decide/index.ts`)

```ts
// config.toml: [functions.decide] verify_jwt = true
import { createSupabaseContext, fromSupabaseUrl } from 'npm:@supabase/server@1.8.1';
import { DecideRequestV1Schema } from '../_shared/decide-v1.zod.ts';     // z.strictObject everywhere; words refined against VOCAB_V1
import { buildQuestions } from '../_shared/catalog.ts';                  // wa-cat-1.0.0: the ONLY place question text exists
import { callJev } from '../_shared/jev-client.ts';
import { CATALOG_VERSION, JEV_PINNED_MODEL } from '../_shared/decide-v1.ts';

const KEY = Deno.env.get('TYPESAFE_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

export default {
  async fetch(req: Request): Promise<Response> {
    const t0 = performance.now();
    const h = corsFor(req.headers.get('origin'));                         // allowlist incl. chrome-extension://<id> (platform.md §3.5)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (new URL(req.url).pathname.endsWith('/health')) return new Response(null, { status: 204, headers: h }); // connection warm-up
    if (Number(req.headers.get('content-length') ?? 0) > 16_384) return new Response(null, { status: 413, headers: h });

    const { data: ctx, error } = await createSupabaseContext(req, { auth: 'user', issuer: fromSupabaseUrl(SUPABASE_URL), audience: 'authenticated' });
    if (error) return Response.json({ code: error.code }, { status: error.status, headers: h });

    const parsed = DecideRequestV1Schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ v: 1, ok: false, degraded: 'bad_input' }, { status: 422, headers: h });
    if (parsed.data.catalog !== CATALOG_VERSION) return Response.json({ v: 1, ok: false, degraded: 'catalog_mismatch' }, { status: 409, headers: h });

    const { state, questions } = buildQuestions(parsed.data);             // trims to ≤ 12k tokens by region priority
    const abort = new AbortController();
    // Quota and Jev run concurrently; quota denial aborts Jev. One RPC checks per-user (30/min, 1,500/day) and global (1,000/min).
    const quotaP = ctx.supabaseAdmin.rpc('consume_ai_quota_v2', { p_user: ctx.userClaims!.id })
      .then(({ data, error }) => { if (error || !data?.user_ok || !data?.global_ok) abort.abort(); return data; });
    const jevP = callJev({ model: JEV_PINNED_MODEL, state, questions }, { apiKey: KEY, timeoutMs: 2_000, pinnedModel: JEV_PINNED_MODEL, signal: abort.signal });
    const [quota, jev] = await Promise.all([quotaP, jevP]);

    if (!quota?.user_ok || !quota?.global_ok) return Response.json({ v: 1, ok: false, degraded: 'quota', retryAfterMs: 60_000 }, { status: 429, headers: h });
    if (!jev.ok) {
      const d = jev.error.kind === 'timeout' ? 'timeout' : jev.error.kind === 'rate_limited' ? 'rate_limited'
              : jev.error.kind === 'overloaded' ? 'overloaded' : jev.error.kind === 'model_drift' ? 'model_drift' : 'upstream';
      console.error(JSON.stringify({ evt: 'jev_fail', kind: jev.error.kind, rid: jev.requestId }));  // codes only, never bodies
      return Response.json({ v: 1, ok: false, degraded: d }, { status: 200, headers: h });           // 200: degrade, don't retry
    }
    return Response.json(compact(jev.data, parsed.data, performance.now() - t0), { headers: h });
  },
};
// No retries to TypeSafe on 429/529. There is no server-side cache, and no feature or answer is persisted or logged.
```

`consume_ai_quota_v2` extends the RPC in `platform.md` §3.5 by also incrementing a global per-minute row. It returns `{user_ok, global_ok}` and is callable by `service_role` only.

### 4.5 Optional catalog B: `route-feedback` (web app, P2)

- **State:** `{ "feedback": "<the user's own text>" }`. It is sent only after the user presses Send, beside a notice. It is stateless and never stored.
- **Questions:**
  - `fb_dimension`: Choice over `text_size`, `contrast`, `spacing_line_length`, `targets_clicking`, `motion`, `clutter_distraction`, `reading_difficulty`, `none_of_these`.
  - `fb_direction`: Choice over `wants_more_help`, `wants_less_change`, `unclear`.
  - `fb_about_webable`: Noul, "Is the person describing a problem caused by WebAble's own changes rather than by websites?"
- **Mapping:** the result is one suggestion card ("Try the text-size check again?" or "Open settings for dimming"), shown only when p ≥ 0.80. It is never a silent profile change.
- **Fallback:** non-English text, or p < 0.80, gets a manual dimension picker.

---

## 5. Caching

Two layers, both local, in `chrome.storage.local` restricted to `TRUSTED_CONTEXTS`. **There is no server cache.** TypeSafe has none either [FIELD §1], and a server-side cache keyed by page would store browsing traces.

| Cache | Key | Value | Size / TTL | Invalidated by |
|---|---|---|---|---|
| **Answer cache** (persisted) | `HMAC(installSecret, siteKey ‖ componentKey ‖ catalogVer ‖ resolvedModel)` for region answers; `HMAC(… ‖ pageSig ‖ …)` for page-type and main-pick answers | recalibration-free raw probabilities (≈ 150 B per region) | LRU 5,000 entries ≈ 0.75 MB; TTL 14 days | catalog or model change; "Forget this site"; "Clear page-analysis cache" |
| **Plan memo** (per session, `storage.session`) | `(siteKey, pageSig, profileVersion, learningVersion)` | assembled plan (ops, scopes by component key, levels, modes) | per browser session | any key component change |

**Key definitions:**
- `siteKey = HMAC-SHA256(installSecret, eTLD+1)`, truncated to 64 bits (`engine.md` §2.15).
- `componentKey = HMAC(installSecret, siteKey ‖ landmark ‖ tagPathShape ‖ sanitized class tokens)`. It is stable across pages of the same template, so the "most popular" rail on every article of a site shares one key and **one** Jev answer.
- `pageSig = HMAC(installSecret, siteKey ‖ canonical({signals, main.found_by, main.zone, sorted [(zone, landmark, tag, pinned, class_words)]}))`. Counts and heading words are deliberately excluded, so that all articles on a site share one signature.

**Behaviour:**
- **Why the persisted key excludes the profile.** Jev's answers are page facts, so a recalibration or learning update must not force re-asking. The *effective* plan key, which is the plan memo, does include `profileVersion`, as the brief requires.
- **Partial calls.** Only regions whose component keys miss the cache are sent. On a warm cache most page views of a known site make **no** call, and the Jev-derived ops apply in the instant path at DCL, so there is no flash of refinement.
- **Hit rate.** Assumed 50% of eligible page views [EST]. The real rate is counted locally and shown in the debug panel; it is not sent as telemetry.

---

## 6. Latency budget

### 6.1 Instant path (no network): DOMContentLoaded + about 60–90 ms

| Stage | Where | Budget (main thread) | Source |
|---|---|---|---|
| Profile-level L1 CSS (focus ring, motion reset, spacing-floor tokens) | `registerContentScripts({css, runAt:'document_start'})` | 0 ms of script, before first paint | `platform.md` D3; `engine.md` §0.2 |
| `hello` → SW wake, token refresh, connection warm-up | CS → SW, at document_start | off the critical path (SW cold start ≈ 50–150 ms [EST], hidden behind parsing) | §2 |
| Viewport extraction + local classification + vocab filter | CS | ≤ 15 ms (p95 ≤ 25) | `engine.md` §5 |
| `planRequest` → SW policy (rules + cached answers) → plan | CS ↔ SW | ≈ 5 ms | — |
| Apply (one write phase) | CS | ≤ 5 ms | `engine.md` §3.3 |
| Settle (2×rAF + `fonts.ready` race) + verify | CS | ≈ 33 ms wall + ≤ 30 ms work | `engine.md` §4.1 |

### 6.2 Jev refinement path (runs in parallel, dispatched at about DCL + 20 ms)

Assumptions:
- The EF and the Supabase project are **pinned to the region nearest TypeSafe's US-West service** (us-west-1 or us-west-2; the choice is [SPIKE]; `x-region` / `forceFunctionRegion` pinning is also [SPIKE]).
- The SW ↔ EF HTTP/2 connection is warm, from the `hello` warm-up and Chrome's connection pool.

| # | Step | p50 | p95 | Notes |
|---|---|---|---|---|
| R1 | CS → SW `decide` message | 1 ms | 3 | SW already awake |
| R2 | answer-cache lookup (`storage.local.get`) | 2 | 6 | a hit skips R3–R8 |
| R3 | build `DecideRequestV1`; attach the in-memory JWT | 1 | 2 | the token was refreshed at `hello` |
| R4 | SW ⇄ EF transit (one RTT + about 5 KB up, 2 KB down) | US 20–70 · EU 150 · APAC 120–180 | US 110 · EU 230 · APAC 260 | warm connection. A cold TLS handshake adds about 2 RTT, which is why `hello` warms it |
| R5 | EF: JWT (cached JWKS), Zod, vocab check, build questions | 4 | 12 | EF isolate cold start is [SPIKE] |
| R6 | EF ⇄ TypeSafe transit (same coast) | 8 | 40 | the co-location is what bounds the cold-TLS penalty (FIELD: +370 ms cold transatlantic) |
| R7 | Jev inference | 100 | 200 | measured server time 70–116 ms at ≤ 5 questions and ≤ 540 tokens [FIELD §1]; + about 8.5 µs per token of state + longest question (about 1k tokens here) → small; question count flat |
| R8 | EF parse, shape-check, compact | 1 | 3 | quota RPC concurrent, off the path |
| R9 | SW: recalibrate, map, policy | 1 | 3 | pure functions |
| R10 | SW → CS PlanDelta | 1 | 3 | — |
| **Σ R1–R10** | **dispatch → answers in the CS** | **≈ 180 US · ≈ 280 EU** | **≈ 420 US · ≈ 540 EU** (sum of p95s, conservative) | **meets ≤ 600 ms p95** for warm connections |
| R11 | apply + settle + verify | 45 | 70 | same as the instant path |

**Deadlines and late answers [DECISION]:**
- **Soft deadline.** Answers arriving **before the first user interaction** (pointerdown, keydown or scroll) **and within 1,500 ms of DCL** apply at once. Paint-only ops (dim, spotlight offer) use a 150 ms opacity fade.
- **Layout ops** (`unpin_sticky`, `line_length`, `text_spacing` scope) from a late answer are **not applied on this page view**. They are cached and applied at the next DCL for the same template. This avoids layout shift during reading, which both the verifier's CLS rule and the user care about.
- **Hard timeouts.** The EF → TypeSafe call times out at 2,000 ms, and SW `fetch` uses `AbortSignal.timeout(3_000)`. Answers that arrive between 1.5 s and 3 s are **cached, not applied**.
- **No retries on the page-view path.** A 429 or 529 degrades immediately, because a retry cannot land inside the budget. The breaker (§7) prevents hammering.
- **Tail note.** Far-from-US users on cold connections can exceed 600 ms. The design absorbs this, because nothing waits on Jev.

---

## 7. Fallbacks

| Condition | Detected | Behaviour | What the user sees |
|---|---|---|---|
| Signed out / no account (Tier 0 or a local-only Tier 1 profile) | SW | **No network at all.** L1 ops fully work. L2 ops apply only to rule-decided regions (precision ≥ 0.90): auto if profile-derived, otherwise offer | Nothing is missing, except that "Smarter page analysis" is shown as available with sign-in |
| Signed in but cloud analysis not consented | SW | same as signed out | a toggle in the side panel, with the exact field list (§9) |
| Offline (`fetch` TypeError) | SW | same; the breaker opens | none |
| Excluded origin / password or payment fields / local `form_checkout` / non-English | CS | no call; rules only | none |
| Timeout, 5xx, `upstream`, `overloaded`, `rate_limited` | SW / EF | keep the instant plan. Breaker: 3 consecutive failures → pause calls for 5 min, doubling to 60 min; honour `retryAfterMs` | none (debug panel shows the state) |
| Per-user quota (30/min, 1,500/day) or global cap (1,000/min, under TypeSafe's 1,200 req/min) | EF | `degraded:'quota'` → breaker for `retryAfterMs` | none |
| `model_drift` (resolved model ≠ `jev-1.13.0`) | EF | returns degraded. Answers are **not** used, because the calibration belongs to another version. Alert from the daily probe (§12) | none |
| `catalog_mismatch` (old extension, new EF) | EF (409) | rules only until the extension updates. The EF supports N and N−1 catalogs during rollout | none |
| First-party waitlist paused or key revoked | EF (401/403) | rules only; pages the team | none |
| OpenRouter as a backup route | ops decision | **not in v1.** p90 of 1,739 ms vs 423 ms first-party, and the context is capped at 32k [FIELD §1, §6]. Vercel's gateway does not expose the model version, so it is incompatible with pinned calibration [FIELD §0] | — |

**Quality under fallback.** Everything for the low-vision and fine-motor groups is unaffected, because those ops consume no Jev answers. The attention group loses dimming of *ambiguous* regions only. The fixture corpus measures what share of dim-worthy area the rules alone cover (§12 metric M4).

---

## 8. Cost per 1,000 page views

- **Unit price:** $0.042 per million input tokens; output is free [OFFICIAL §5]. The measured per-call billing matched to six decimals [FIELD §1].
- **Token counts** are from §3.2.4 (chars/3.3, conservative).

| Call shape | Input tokens | Cost per call |
|---|---|---|
| 1 region + page type | ≈ 1,650 | $0.000069 |
| 3 regions | ≈ 3,780 | $0.000159 |
| **6 regions + page type + main pick (typical)** | **≈ 7,310** | **$0.000307** |
| 10 regions + page type + main pick (max) | ≈ 11,570 | $0.000486 |

| Scenario per 1,000 page views | Calls | Jev cost | Supabase EF invocations (≈ $2 per 1M beyond plan quota; *not re-verified this session*) | Total |
|---|---|---|---|---|
| Upper bound: every page view makes a max call | 1,000 | $0.49 | $0.002 | **≈ $0.49** |
| No gating, no cache, typical calls | 1,000 | $0.31 | $0.002 | ≈ $0.31 |
| **Expected: 50% of page views pass G1–G6 × 50% cache miss** [EST] | 250 | $0.077 | $0.0005 | **≈ $0.08** |
| Warm-cache heavy user (partial calls average 2 regions) | 250 | ≈ $0.03 | $0.0005 | ≈ $0.03 |

**Comparison: generative LLM doing the same classification.** Claude Haiku 4.5 (`claude-haiku-4-5`) at $1 / $5 per MTok, with about 7.3k tokens in (the same evidence and instructions) and about 400 tokens of JSON out, costs about $0.0093 per call, or **≈ $2.30 per 1,000 page views** at 250 calls. That is roughly **30×** Jev, or about 10× with prompt caching of the static instructions. `docs/02` measured cloud small-model latency at about 6–7 s.

**Other costs:**
- **Product-wide rate ceiling.** 1,200 req/min at 0.25 calls per page view supports about 4,800 page views/min, or about 80/s. That is ample for the thesis and early access; higher tiers come via TypeSafe sales.
- **Pricing risk.** TypeSafe "can't prove the pricing isn't subsidized" [FIELD §1]. Even at 10× the price the expected cost is about $0.80 per 1,000 page views.

---

## 9. Exactly what leaves the device

| Hop | Destination | Contents | Never included |
|---|---|---|---|
| A. Page-analysis call | Supabase EF `decide` (WebAble, US-West) over HTTPS | **Headers:** `Authorization: Bearer <Supabase access JWT>` (user id, email and session claims; needed for auth and quota), `apikey: sb_publishable_…`, `Content-Type`. **Body:** exactly `DecideRequestV1` (§4.3): enum values, bucketed counts, ephemeral `r#`/`c#` ids, and ≤ 6-word bags of **public-vocabulary words**. **Network:** client IP and User-Agent are seen by Supabase and Cloudflare; platform logs keep request metadata for 1 day (Free) or 7 days (Pro), not bodies | URL, path, query, domain, eTLD+1, `siteKey`, `pageSig`, `componentKey`, title, headings text, body text, form values, alt text, profile, need levels, learning state, domain history, tab ids, device id, precise timestamps |
| B. Jev call | TypeSafe `api.typesafe.ai` (from the EF) | `{model, state, questions}`: the same evidence plus WebAble's question text | the user id, JWT, email and IP (TypeSafe sees the EF's IP) |
| C. Warm-up | EF `/health` | an empty GET with the JWT | anything else |
| D. Learning sync (separate, existing design) | Supabase `learning_state` (RLS) | domain-free deltas (`personalization.md` §13.2) | domains, events |
| E. Simplify (user-initiated, per request) | EF `simplify` → Anthropic API | the passage the user selected, shown before sending | anything not shown |

**Server-side persistence:** only the quota counters `(user_id, window_start, used)` and the global per-minute counter. `decide` writes nothing else, and it logs error codes and TypeSafe request ids, never bodies.

**Third-party retention:** TypeSafe states that Jev is not trained on customer requests. Zero data retention is enterprise-only, and retention for other plans is governed by its DPA [OFFICIAL §5]. The privacy notice must say this plainly.

**On-device records:**
- The answer cache.
- A **"What was sent" receipts log**: the last 50 exact request bodies, labelled locally with the domain, auto-deleted after 7 days, and viewable in the side panel. This makes the privacy claim inspectable (`docs/06`).

**Residual risk, stated honestly:** a structural sketch can let a determined server operator guess the *kind* of site, and in rare cases a specific popular template. Mitigations: vocabulary-only words, no retention, and opt-in consent.

---

## 10. How Jev confidence combines with learned Beta preferences and verification

There are four independent channels, and each outcome updates exactly one (or a declared split):

```
                    Jev probabilities ──isotonic──► label ∈ {clear, likely, unsure} ──label table (Beta per op×label)──► A
 rule-decided region ────────────── rule precision (CI corpus) ──────────────────────────────────────────────► A
 user signals ─────────────────────────────────────────────── Learner A: θ̄ (Beta, personal ▸ domain, 90-day half-life)
 verifier results ─────────────────────────────────────────── Engine channel: P_ok (Beta per op×category, op×site)
 user pins/blocks, "never here", component exceptions ──────── Hard rules (deterministic, highest precedence)

 P = A × θ̄          EU_auto = P_ok·[P − 2.33·(1 − P)] − 0.1·(1 − P_ok)     auto iff source eligible ∧ EU_auto > 0 (≈ P > 0.70)
 offer iff logit(P) + ln LR_friction ≥ logit(0.40) ∧ budgets ∧ cooldowns    level = Learner B → nearest reviewed level
```

| Outcome after an L2 op on a Jev-labelled region | Updates | Weight |
|---|---|---|
| Verifier **fail**, rolled back | **E only** (P_ok F += 1). The label table and θ̄ are untouched | Verifier outcomes are engine facts, not preference or target evidence (`personalization.md` §4) |
| Verifier pass, kept ≥ 5 min, no negative chip | label table S += 1 for (op, label); θ̄ gets its usual silence/accept weight | label outcome as defined in `personalization.md` §6 |
| Undo with chip **"I needed that"** | label table F += 1; a **component exception** is stored locally `(siteKey, componentKey, op) → never` | a wrong *target* is not a preference |
| Undo with chip **"Don't want this"** | θ̄ F per the undo-timing weights | a preference |
| Undo with chip **"Too much / too little"** | Learner B probit nudge on the dim level | intensity |
| Undo with chip **"Broke the page"** | E F += 1 | engine |
| Undo within 10 s, **no chip** | split: θ̄ F += 0.5 and label table F += 0.5 | ambiguous attribution, the same pattern as the CLS split in `personalization.md` §10.4 |

**The label table**, `LabelTable[op][label]`, is Beta(a₀, b₀):
- The prior is centred on the **lower 90% Wilson bound of the bin's precision on the labelled corpus**, with strength 10. Before the corpus exists it is centred on 0.80 / 0.55 / 0.25, as in `personalization.md` §6.
- A monthly pool-adjacent-violators pass enforces clear ≥ likely ≥ unsure.
- Local counts use the same 90-day decay.

This is the mechanism that turns Jev's miscalibrated-by-task probabilities [FIELD §2] into empirically grounded applicability for *this* user's browsing. **Jev probabilities never touch θ̄, and θ̄ never reaches Jev.**

---

## 11. The generative piece and the explanation piece

### 11.1 Plain-language simplification (the only responsibility that needs generation)

- **Trigger.** Only the user can start it: select text, or use the side-panel "Simplify this section". The passage is ≤ 1,500 characters and is shown in the panel before anything happens.
- **Path 1, on-device (preferred).**
  - The Chrome Prompt API (`LanguageModel`, stable in extensions since Chrome 138) runs in the **side panel**, not the SW, because SW availability is undocumented [SPIKE, `platform.md` §2.13].
  - Used only if `availability()` is `'available'`. The download is never triggered silently: it needs user activation and ≥ 22 GB free.
  - Structured output uses `responseConstraint`: `{ simplified: string, kept_terms: string[] }`.
- **Path 2, cloud.**
  - EF `simplify` calls **Claude Haiku 4.5 (`claude-haiku-4-5`, $1/$5 per MTok)**, the model `docs/06` already names, using the Anthropic SDK and structured output (`output_config.format`).
  - Per-request consent shows the exact text. The function is stateless and logs nothing.
  - About 750 tokens in and 500 out costs about $0.003 per request.
  - Keep the model swappable. Before launch, run a small fidelity eval (meaning preserved, numbers and names kept verbatim) of Haiku 4.5 against `claude-sonnet-5`; the model choice is the team's call.
- **Presentation.** Output appears **side by side in the panel**, labelled "Simplified by AI; may contain mistakes". It never replaces page text, so page content and accessible names stay untouched.
- **Why not Jev:** it cannot generate [OFFICIAL §7].

### 11.2 "Why this changed": deterministic templates

```ts
interface DecisionTrace {
  op: OpId; mode: 'auto' | 'offer'; source: 'profile' | 'pinned' | 'os' | 'friction' | 'manual';
  level?: number; scope: 'page' | { componentKey: string; localLabel: string /* local-only text for display */ };
  evidence: Array<
    | { kind: 'small_text_share'; share: number; floorPx: number }
    | { kind: 'contrast_failures'; count: number; targetRatio: number }
    | { kind: 'target_failures'; count: number; targetPx: number }
    | { kind: 'region_role'; role: RegionRole; by: 'rule' | 'page_analysis'; label?: Label }
    | { kind: 'motion_sources'; count: number }
    | { kind: 'learned'; note: 'kept_before' | 'site_pin' | 'os_setting' }>;
}
// "Dimmed the 'most popular' side panel. It looks like links to other articles (page analysis: clear).
//  Hover over it or tab into it to bring it back.  [Undo] [Not on this site] [Why?]"
```

**Template review checklist:**
- Never name a condition or diagnosis.
- Never claim WCAG conformance.
- Always offer undo.
- Say "page analysis", not "AI decided", for Jev-derived facts.

Templates are faithful by construction and cost nothing.

---

## 12. What NOT to use Jev for

| Do not use Jev for | Reason |
|---|---|
| Verification, contrast, clipping, overlap, "does this look broken" | Text-only and visually blind [FIELD §3.12]. The verifier needs 10–30 ms, and Jev takes 200+ ms. |
| Intensities, pixel values, colours, CSS, selectors | "Not a calculator" [OFFICIAL §7]. Solvers are exact. The model emits no CSS at all in this design (stricter than AD-3). |
| Counting ("how many small targets", "what share of text is below X") | 48–72% accuracy on list counting [FIELD §3.4]. Code counts exactly. |
| Anything about the user: desirability, "would this help someone like X", need levels, persona | Jev knows only the state. Per-user Beta and Kalman state is calibrated to this user. Keeps health-adjacent data out of payloads. Diagnosis inference is prohibited. |
| Profile derivation from calibration trials | Numeric psychometrics that must be reproducible. |
| Friction detection and behaviour-triggered decisions in hot loops (per click or scroll) | About 300 ms network cost [FIELD §5 "keep Jev out of ≤300 ms loops"]. It would ship interaction traces. Offer-never-impose already routes behaviour to offers via deterministic likelihood ratios. |
| Page-type or region decisions the rules already make with ≥ 0.90 precision | "Don't ask Jev what rules already know" [FIELD §4.7]. |
| Answering or dismissing consent banners | A legal decision reserved to the user. No model is involved. |
| Low-confidence escalation to an LLM | The measured cascade was worse than Jev alone [FIELD §5]. Low confidence means no L2 action. |
| Many items packed as rows in `state` | Position effect beyond about 8 items [FIELD §3.6]. |
| Thresholding on `confidence` | A derived statistic, never better than max-probability [FIELD §2]. |
| Client-supplied questions, or any free text from pages | Key abuse (a general-purpose proxy on our bill) and evidence-framed injection [FIELD §3.9]. The catalog is server-only and the vocabulary is enforced on both ends. |
| Plain-language rewriting, summaries, explanations | Cannot generate [OFFICIAL §7]. Explanations must be faithful. |
| Non-English pages (v1), password/payment pages, excluded origins | Accuracy [FIELD §3.10] and privacy. |
| Per-mutation re-classification in SPAs and feeds | New nodes matching cached component keys reuse answers. New ambiguous regions batch at ≤ 1 call per 10 s while the user is idle. |

---

## 13. Does Chrome's built-in Prompt API still have a role?

| Candidate role | Verdict | Reasoning |
|---|---|---|
| Decision layer, primary | **No** | Covered by Jev plus the rules. Nano returns no calibrated probabilities over options, so every threshold would need separate tuning and a separate test matrix. Hardware gating (≥ 22 GB free disk, > 4 GB VRAM or 16 GB RAM, desktop only; `platform.md` §2.13) excludes many target users' machines. The model download violates value-on-first-visit. |
| Decision layer, offline or "strict privacy" fallback | **No in v1; optional v2 experiment** | The deterministic local policy is already the offline tier and is always available. A Nano-labelled region would enter as `unsure` (A ≈ 0.25), so A × θ̄ < τ_offer and it would change nothing unless separately calibrated. That is not worth the cost in the semester. |
| Plain-language simplification | **Yes, the preferred path** | Keeps body text on the device. It runs in the side panel, falls back to the cloud with consent, and is optional by nature. |
| "Why this changed" | **No** | Templates are faithful and free. |
| Local fallback for `route-feedback` | Possible (P3) | Only if catalog B ships and the user declines cloud processing. |

**Net:** the tiered-inference abstraction from `docs/02` (Nano → native → cloud) is **retired for decisions** and **kept, in two tiers, for simplification only**. The Mac-app native tier is unnecessary for AI.

---

## 14. Validation plan (what must be true before Jev-derived ops auto-apply)

| # | Step | Metric / gate | Cost |
|---|---|---|---|
| V1 | **Labelled corpus**: 150 archived pages (top sites plus seeded fixtures), about 1,500 regions. Two team members label roles and task-need independently | Cohen's κ ≥ 0.7; disagreements → `other` | about 10 person-hours |
| V2 | **Pattern pilot**: (d) region-in-instructions, one call, vs (c) one request per region vs (c′) 3 parallel requests of ≤ 4 regions | Adopt (d) if macro-F1 is within 2 pts of (c) **and** ECE is within 0.02 on P_elig. Otherwise use (c′). The EF fans out in parallel; watch the 1,200 req/min limit | < $1 |
| V3 | **Isotonic fit** per family (`dimEligible`, `protectedRole`, `taskNeed`, `mainPick`, `pageType`) on a 70/30 split | Report coverage vs precision. Set `clear` so that the Wilson lower bound on precision is ≥ 0.95 on held-out data | — |
| V4 | **Rules-only coverage**: share of dim-worthy area decided by rules alone (metric M4) | Quantifies Jev's marginal value for the thesis | — |
| V5 | **Robustness**: 5 repeats per request, key-order and option-order shuffles (production stays canonical), vocabulary-constrained injection probes (e.g. class words `sponsored` on main content), non-English samples | Label flip rate < 3% across repeats; injection cannot flip a protected region to `clear` | < $1 |
| V6 | **Baseline comparison** (thesis evidence): rules-only vs Jev vs Claude Haiku 4.5 structured output on the same evidence JSON | accuracy, ECE, p50/p95 latency, $ per 1,000 page views | a few dollars |
| V7 | **Shadow week**: team dogfooding with Jev labels computed and shown in the debug panel but not auto-applied (offers only) | undo and "needed that" rates per label bin → initial label table | — |
| V8 | **Daily drift probe** (GitHub Action): 20 fixed requests against `jev-1.13.0` and `jev-latest` | alert if any |Δp| > 0.10, or if `jev-latest` resolves to a new version (re-run V3 before re-pinning) [FIELD §5] | about $0.005/day |
| V9 | **CI without the key**: recorded Jev responses as fixtures behind a `JevClient` interface. `typesafe-ai/system-one-adapter-python` is available as a dev stub if first-party access lapses [OFFICIAL §6] | policy property tests (`personalization.md` §15) plus the plan-mapping unit tests | — |

---

## 15. Changes this document makes to earlier project decisions

| Earlier (`docs/02`, `docs/06`, `personalization.md`) | Now | Why |
|---|---|---|
| A cloud LLM (Haiku) or Nano returns "a JSON adaptation plan and CSS strings" | Jev returns probabilities over options WebAble authored. Deterministic code builds the plan. No model emits CSS | Wanscher et al.: blind LLM CSS improves and regresses at about equal rates (`engine.md` §0.1). Jev is typed by construction. |
| Tiered decision inference: Nano → native → cloud | Rules (always) plus Jev (opt-in cloud). Nano is kept for simplification only | §13 |
| FastAPI intelligence layer | Supabase Edge Functions (`decide`, `simplify`, optional `route-feedback`) | Matches the brief and `platform.md`. One language (TypeScript/Zod) and no codegen seam. |
| The model sees "page features and the need-level summary" (`personalization.md` §6) | The model sees page evidence only, never need levels | §3.2.5 |
| AI emits a categorical label clear/likely/unsure | Jev emits probabilities. The SW **bins** them into the same three labels, so `personalization.md`'s label→A machinery is unchanged | §10 |
| Label outcome = "verifier pass ∧ not undone ∧ no wrong-thing chip" | Verifier failures go to the E channel only and are excluded from the label table | keeps the channels orthogonal |
| Onboarding: an "LLM turns free text into profile deltas" | Optional Jev routing to a *suggestion the user confirms* | closed-set routing; no silent profile writes |

---

## 16. Open spikes (one day or less each)

1. **Region pinning.** Confirm Supabase Edge Function region pinning (`x-region` header or `forceFunctionRegion`), and which US-West region has the lowest RTT to `api.typesafe.ai`. Measure EF isolate cold start and the TLS reuse from EF to TypeSafe.
2. **Pattern (d) accuracy** vs (c), on the V1 corpus (§14 V2). This is the one untested assumption the design leans on [FIELD §4].
3. **Real `usage.input_tokens`** for the catalog. Replace the chars/3.3 estimates in §3.2.4 and §8.
4. **SW warm-up effectiveness.** Does a `hello`-triggered GET keep the HTTP/2 connection warm across page views in Chrome 154's extension network context?
5. **Prompt API from the side panel.** Availability, latency for a 1,500-character rewrite on a mid-range laptop, and `responseConstraint` fidelity (`platform.md` spike 5).
6. **Vocabulary coverage.** Share of region label tokens retained by `VOCAB_V1` on the corpus, and the accuracy drop vs unfiltered labels. The unfiltered run happens offline on archived pages only.
7. **TypeSafe early-access terms.** Rate-limit scope (key, org or account), `retry-after` presence, and the non-enterprise retention period [OFFICIAL §8].
