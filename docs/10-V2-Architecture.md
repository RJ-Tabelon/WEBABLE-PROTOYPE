# WebAble v2: triage, holistic Tailor, and Fit view

_Written 2026-10-15 and revised after a five-lens design review (robustness, evidence, privacy and security, UX,
feasibility). Supersedes the per-element text floor in [08-System-Architecture.md](08-System-Architecture.md) and the
"no generative model" line in its §2. The invariants in [01-Positioning.md](01-Positioning.md) hold, with one
deliberate reversal (page scale, §5.1) and one new recipient (OpenAI, §8). Sources:
[research/v2-evidence.md](research/v2-evidence.md)._

## Build status (2026-10-16)

**Built** (where the build differs from the first draft, the sections below now say what was built):
- Triage (`core/triage`), with per-template hysteresis. Every † is still a default.
- Tailor: page scale (`sw/zoom.ts`: frozen per page view, zoom guard, the person's zoom wins) composed with the
  main-only `text_floor`, whole-op rollback and the new verifier checks.
- Read: layout features with `cs:signals` and the skeleton reader (`engine/skeleton`).
- Fit view: heuristic spec, validator, solver and type ramp, renderer (`content-scripts/fitview.js`), proxies with the
  MAIN-world key bridge, input firewall, live sync, peek, status strip; tab mode and keep/undo learning in the worker.
- Planner: the `compose` Edge Function and its Deno tests, the migration `20261015000000_v2_layout.sql`
  (`ai_layout`, `consume_compose_quota`), the worker client, the device cache, `layout_planning` receipts, and the
  local dev planner (`pnpm dev:compose`).
- Tests and evaluation: the Playwright project `v2` (fixtures) and the real-site harness `scripts/eval/*`. The results
  are in `research/v2-eval-2026-10-15.md` and `research/v2-planner-benchmark.md` (planner rubric 4.40–4.46 vs heuristic
  3.90–4.13; 60/60 valid; p50 3.4 s).
- Surfaces (WP 9): the popup's Fit view block, the web Privacy page's `ai_layout` consent row, the v1 notice and the dev
  planner switch.
- v2.1 (docs/11), built 2026-10-16: the structure need from Tune's Focus effects, `FitLayout.structure`, automatic
  restructuring on busy pages for level 2, the restructure rules R1–R8 and the before/after scorecard.

**Pending:** deploy. Run `pnpm db:push` for the migration, then `pnpm deploy:functions` for `compose` and its secret
(README).

## 1. Why v2

v1 works end to end (Tune → fit → every page). On real sites, though, its output is the thing WebAble was founded
against: one fixed rule set applied element by element.

| Screenshot | Mechanism (reproduced on live pages) |
| --- | --- |
| Gmail rows alternate between 18 px and 40 px; timestamps are bigger than subjects | `text_floor` sets every text element below the floor to exactly the floor (`ops/text.ts:84-104`; the ladder goes up to 48 px). Per-element rollback then reverts only text whose container *newly* clips, so long sender names revert and short ones stay. |
| YouTube metadata (48 px) is larger than titles (~20 px) | Titles sit in line-clamp boxes, so they clip and revert. Metadata sits in overflow-visible boxes, so it stays enlarged. |
| Meta's header links overlap | The overlap check only looks at text siblings up to 3 levels away (`verify/checks.ts:97-112`). Each nav label is wrapped 6 levels deep, so it found no neighbours. |
| Unread badges become giant blocks | Badges are text, and overlap with icons is never checked. |

On YouTube search and Wikipedia the same op was also rolled back whole, so people get either a patchwork or
nothing. The deeper problem is that "the fit" is a set of minimums. A minimum applied per element cannot preserve
a page's hierarchy, grouping or space.

What the evidence supports instead:

1. **Whole-layout generation against measured ability.** SUPPLE++ made motor-impaired users 26–28% faster with 73%
   fewer errors. Most of the gain was manipulation time (8.29 → 0.84 s), from substituting how controls are
   operated and laying out jointly with a per-person cost model. Enlarging elements was not the source. Its blocker
   was a hand-written functional spec per UI, and an LLM can now produce that spec.
2. **LLMs handle semantic structure well and geometry badly.** Vision-language models judge layout quality near chance
   (GPT-4V 51.6%). Unverified LLM CSS regressed pages about as often as it improved them (24 vs 20 of 100, with
   7–14B models). So the model decides *what things are*, and deterministic code decides *how big and where*.
3. **Scaling must preserve rank order.** iOS Dynamic Type and Android 14 scale text non-linearly but always
   order-preservingly. Whole-page magnification keeps hierarchy by construction, and a site's own responsive
   breakpoints handle the reflow.
4. **Clutter costs some people more.** Complex sites slowed search from 4.2 s to 7.3 s, more for people who prefer simple
   sites. Older adults are disproportionately slowed by interleaved distractor text.
5. **Offer by benefit and by kind of change.** Older adults preferred implicit change with undo for *high-benefit*
   adaptations and preview-then-confirm for low-benefit ones (MyUI, N=12, ages 49–73). Elective adaptation was
   faster and preferred over imposed adaptation (Gajos AVI 2006, split menus).

## 2. The v2 loop

```
 page load ─► Read (local) ─► Triage (service worker) ─┬─► fits:    nothing changes ("This page already fits you")
             signals +          person-relative gap,     ├─► tailor:  Tailor applies (in place, holistic, undoable)
             layout features    hysteresis, per template └─► compose: Tailor + Fit view offered (opened where chosen)

 Fit view = PageSpec   what the page is: enums and ids only, person-independent, cached per template
          × FitLayout  how big, how dense, how calm: computed from the fit in the service worker
          → WebAble renders the page's own visible content in its own layout; every control drives the original.

 PageSpec sources:  heuristic: local, instant, always available, works with no consent and no network
                    planner:   OpenAI, opt-in, only after the person opens Fit view; never sees page text
```

| Layer | Decides | Owner | When |
| --- | --- | --- | --- |
| **Triage** | Does this page need anything for *this* person, and how much? | `core/triage`, service worker | every page view (DCL signals) |
| **Tailor** | Make the original page fit: page scale, running text, hit areas, calm, reading | deterministic ops (v1 engine, fixed) | auto when confident, with undo |
| **Fit view** | Re-present the page for the person, keeping it working and losing nothing | spec + solver + renderer | offered; auto only where the person chose it |

Jev keeps its v1 role: region roles, main content, and page type when local rules are unsure. Its verdicts also
feed the heuristic spec. The planner only describes structure. Neither model sees the fit.

## 3. Triage

The question is person-relative. On Wikipedia, 99% of text is below an 18 px floor, so "anything below the floor"
would mark every page. Triage instead estimates **how big the gap is** and **whether the page can absorb a change**.

### 3.1 Features (content script, person-independent, sent with `cs:signals`)

The content script never sees the fit. It sends histograms and structure. Every person-relative share is
computed in the service worker.

| Feature | Meaning |
| --- | --- |
| `text.histogram` (v1) | [px, chars] pairs, main-weighted. `bodyPx` is derived from it. |
| `targets.below[24..72]`, `crowded` (v1) | target-size distribution |
| `layout.slack` | row slack (min 1/U over nowrap and flex rows that hold text), clip-risk share (ellipsis, line-clamp, overflow-hidden text), fixed-height text share, overlay-text share |
| `layout.occlusion` | viewport share covered by fixed or sticky boxes |
| `layout.density` | leaf boxes per 100k px², distinct block corners, distinct font sizes, competing regions |
| `layout.records` | detected collections: count, largest, share of main covered |
| `layout.readerable` | Mozilla `isProbablyReaderable` score |
| `layout.kind` | product JSON-LD, editor or `contenteditable`, `role=application`, canvas-dominant, video player, paywall, blocking overlay (consent, modal) |
| `layout.nav` | visible primary-nav link count, search-field visible (for the zoom guard, §5.1) |

### 3.2 Decision (`core/triage/triage.ts`)

`k = textMinPx / (bodyPx × currentZoom)` is the needed scale. Per need, there is a fits / tailor / compose band.
The † thresholds are unvalidated defaults, to be calibrated on the corpus (§10):

| Need | Fits | Tailor | Compose (offer Fit view) |
| --- | --- | --- | --- |
| Text | k ≤ 1.15† | 1.15 < k ≤ zMax (the breakpoint-safe zoom) | k > zMax |
| Targets | ≤ 10%† below T | > 10% with slack to grow hit areas | > 40%† below T on a records page with no slack |
| Clutter | below the person's comfort percentile | dim distractors | ≥ 90th percentile† and P(distraction benefit > 0) ≥ 0.8 |
| Occlusion | ≤ 15%† | offer to unpin | > 30%† |

Rules:
- Attention gates use the posterior P(benefit > 0) ≥ 0.8, never the mean.
- The verdict is cached per template with a 0.1 hysteresis margin, so it does not flip between visits.
- "Fits" suppresses the saved-fit auto rule (`matchesFit`) for that need. A page that fits gets nothing.

**Compose** also requires the page to be *re-presentable*:
- it is readerable, or has ≥ 5 records of a stable template covering ≥ 40% of main, or is a detail page (product
  JSON-LD);
- it is not an editor, application, canvas, video player, paywalled page, or password/payment page;
- no consent wall or blocking modal is open.

Output: `TriageVerdict {verdict, k, zoom, residual, needs[], reasons[], representable}`. The reasons render as
the popup's one-line explanation ("Small text and crowded buttons for your fit").

## 4. Fit view

### 4.1 PageSpec: what the page is

```
PageSpec {
  v: 1, page_type, primary_task,
  sections: [{ kind, importance: primary|secondary|tertiary|fold,
               node_ids: [id…], heading_ref: id|null, layout }],
  collections: [{ list_id, item_kind, open_slot: id|null,
                  fields: [{ slot_id, role, show: always|on_expand|hide }] }]
}
```

Every value is an enum or an id from the input (`^e[0-9]{1,4}$`), and every array is bounded. **There is no
free-text field.** Section titles come from the page's own heading (`heading_ref`) or WebAble's template for the
section kind.

The benchmark schema had a free `heading` string. The shipped schema is re-benchmarked before use: 12–20 pages,
validity, rubric, and the heuristic vs planner comparison. A CI test fails if any string field lacks an enum or
pattern.

**Sources.**
- The *heuristic* spec (`core/compose/heuristic.ts`) is built in milliseconds in the service worker from
  landmarks, Jev and rule region roles, main-content detection, and record detection with field-role rules.
- The *planner* spec comes from the `compose` Edge Function.
- Both pass the same validator.

**Validator** (`core/compose/validate.ts`, deterministic, run on every spec, including every cache reuse):
- Drop unknown or duplicate ids and ancestor/descendant overlaps.
- Exactly one primary section; fall back to local main content.
- Protected kinds can never be folded: search, account, cart, help/contact, legal, consent, pagination, forms, main.
- The section holding focus is never folded.
- **Trusted-slot rule.** Only these may go into the top strip (header, search, account and cart): elements outside
  main, records, article and comment subtrees, inside banner/nav or the top two viewports, whose links stay on the
  tab's site. Anything else stays in its own section, so a user-posted "Sign in" link can never become WebAble's
  account button.
- Every visible control or text block the spec leaves out goes to a generated "Everything else on this page"
  section. **Nothing on the page becomes unreachable.**

### 4.2 FitLayout: ability-parameterized rules (`core/fit/solver.ts`, service worker)

Every number comes from the person's fit. The constants marked † are unvalidated defaults that the study tunes. The
decision space is small and discrete, so closed-form rules replace search. That is not SUPPLE's optimizer, and the
docs say so. SUPPLE's active ingredient, control substitution, is in §4.4.

| Decision | Rule | From |
| --- | --- | --- |
| Body size F | `textMinPx` (in CSS px at 100%) | reading ladder (CPS × 1.26) |
| Type ramp | page heading, section heading and title as ratios of F that compress as F grows (1.8 / 1.45 / 1.25 at F=16, toward 1.25 / 1.15 / 1.08 at F≥40)†. Meta = max(0.85F, 14)†. Adjacent tiers must differ by ≥ 1.15× size or ≥ 200 weight; otherwise a structural cue carries the tier (space above ≥ 1.5F, a rule line, a tinted band). | Dynamic Type and Android 14 curves (product practice, not experiments) |
| Spacing | profile line height and word spacing; letter spacing only with ≥ equal word spacing; gaps in em; between-group gap ≥ 2× within-group | crowding research; Kubovy proximity |
| Measure | prose at most `maxLineCh`, at least 8 (low vision) / 13 characters per line | Atılgan et al. 2020 |
| Targets | hit area ≥ T = `minTargetPx` (measured S\*, not a fixed 44); visual control height follows the text; gap = max(8, `targetSpacingPx` − T) | pointing model |
| Grid | card min width by item kind (video/product ≈ 11F + padding)†; columns fit the width, capped at 2/3/4† by density benefit | display-size constraint |
| Lists | never paged. Primary collections load as you scroll; records are grouped visually every 6†, with a larger gap. "Show more" is used only for tertiary sections. | 07 D12 |
| Navigation | visible links plus a labelled "Site links (n)" for the rest (combo navigation, never a hamburger); 5 or 8† inline by distraction benefit | hidden navigation is used about half as often |
| Calm | tertiary sections collapsed when P(distraction benefit > 0) ≥ 0.8; folded sections always show a count | |
| Colour | polarity and contrast floor choose the palette (both are unused by v1's policy) | Tune's polarity trial |

The fit never leaves the service worker. The content script receives only these numbers.

### 4.3 Rendering

- **Order.** Sections keep the original page's reading order of their anchors (section-order τ ≥ 0.8 against the
  original). One fixed component vocabulary (search field, pill rows, cards, rows) is used on every site. Folded
  sections go last. The primary section must start within the first viewport; at large F, navigation compresses to
  "Site links (n)" so that it does.
- **Look.**
  - Atkinson Hyperlegible Next, registered from bytes the worker passes (`new FontFace`, no
    web-accessible resources), with `font-size-adjust` matched to Tune's measurement font.
  - A top strip with the favicon, the eTLD+1 computed by the worker (punycode shown raw; "Not secure" on http), and
    WebAble's own controls: **Original page**, **Text − / +**, **Always here**.
  - Fern marks only WebAble's own controls. The site's actions use ink.
- **Mechanics.** A `<dialog>` inside a closed shadow root on a `webable-ui` host, opened with `showModal()`:
  - it is in the top layer;
  - native focus containment and Esc;
  - the rest of the document becomes inert without touching a single site attribute.

  It uses a constructed stylesheet, builds DOM with `createElement` only, and sizes everything in px divided by the
  current zoom (§4.6). It lives in a separate content script (`content-scripts/fitview.js`), injected into the top
  frame the first time it opens, together with the key bridge (§4.4), so the engine that runs on every page stays
  small.

| Section kind | Component |
| --- | --- |
| header, account_and_cart, search | top strip: site identity, a large search field (site suggestions mirrored as rows below it), account/cart buttons |
| primary/secondary nav, tabs, chips, filters, sort | wrapping pill rows, plus "Site links (n)" |
| main_list (collection) | cards (video, product, image) in the solver's columns, or rows (messages, results, links). Fields by role: thumbnail (aspect-correct placeholder until loaded), title (opens the item), author/channel, meta, timestamp, duration/price/rating badges, actions. Hover-only record actions (⋮, archive) get a visible "Actions" control. |
| article | readable column rebuilt from an allowlist of tags (headings, paragraphs, lists, quotes, figures, inline links) |
| product_detail | title, price (visible text, cross-checked with JSON-LD, else every price with its label), rating, **options before actions**, then actions. Delivery, seller and returns are protected. |
| form | labelled fields proxied to the originals |
| media, as_is, iframe | a card that opens the original at that spot |
| clutter, ads | folded: "Folded by WebAble (3) · Show" |

**Text is never generated.** Every word in Fit view is *visible* page text (rendered, not clipped, not
screen-reader-only), read on this device at render time. Every control is labelled with its own accessible name.

### 4.4 Proxies: every control drives the original

**Control substitution** (SUPPLE's main lever, additive, the original untouched):
- a select with ≤ 12 options → a visible list of options;
- a hover menu → click to open;
- a small checkbox → the whole row toggles;
- a menu or listbox the site opens → rows inside Fit view.

**Identity.**
- Each rendered control carries a locator: section container + component key + slot path, plus a **record
  fingerprint** (the hashed visible texts of the record's slots).
- Before every dispatch, the original is re-resolved inside its section, and its fingerprint must match what the card
  shows. If it doesn't, the view re-resolves by fingerprint or refuses and shows the element on the page. **It never
  resolves by index.**
- Hrefs are pinned. If the original's href changed, the view navigates to the href that was shown.
- Only http(s), mailto and tel hrefs are rendered.

**Recipes.** Dispatched inside the person's real click, so transient activation carries over:
- **Link.** Our `<a href>` keeps middle-click and new tab. A plain click dispatches to the original, which keeps SPA
  routing.
- **Button.** `pointerdown → mousedown → pointerup → mouseup → click`, with `clientX/Y` at the original's centre and
  `detail: 1`.
- **Text input.**
  - Native value setter, then `input`.
  - On commit, `change` + `blur`.
  - Enter goes through a MAIN-world key bridge that sends keydown, keypress and keyup with `keyCode` and `which`.
    `form.requestSubmit()` runs only if nothing happens within 300 ms.
  - The bridge is a bundled file (`content-scripts/keybridge.js`), so page CSP allows it. It is not registered at
    `document_start`: the worker injects it on demand (`scripting.executeScript`, `world: 'MAIN'`, top frame) right
    after `fitview.js`, the first time Fit view opens in a document. It answers only a fixed set of keys.
- **Checkbox or radio.** `original.click()`, then the state is read back.
- **Select.** Native setter, then `change`.
- **Never proxied:** rich editors, payment iframes, maps, players, and anything behind a blocking overlay. These get
  "Do this on the page".

**Effect check.**
- Waits up to 3 s for navigation, target mutation, or an ARIA state read-back (`aria-pressed`, `aria-checked`).
- Never invites a blind retry, because a repeated Like or Add to cart is harmful.
- A failure shows the element on the page and logs a proxy defect.

**Irreversible actions** (buy now, place order, send, delete, pay) are never emphasized. They need a second press,
"Press again to buy now".

### 4.5 Staying live

- **Input firewall.** A window-capture listener installed at `document_start` catches events targeting the Fit view
  host: pointer, mouse, click, wheel, touch, key, beforeinput/input, composition, focus, and clipboard events. It
  calls `stopImmediatePropagation` (never `preventDefault`) and routes them to the view's own dispatcher. This means:
  - site shortcuts (Gmail `e`, `#`, `j/k`; YouTube `/`, `k`) never fire;
  - wheel hijackers can't block scrolling;
  - default actions such as typing still happen.

  Untrusted events are ignored, and WebAble's own listeners (`steady_clicks`) skip proxy events.
- **Routes.** Gmail-style `#inbox/…` hash routes count as navigation when no element has that id. When a proxied
  link or row is activated, the view immediately shows "Loading…" and re-reads once the DOM is quiet. It does not
  wait for the route watcher.
- **Mutations.** Re-reads cover only the record roots that changed, within 4 ms per frame, and patch by record key.
  Scroll and focus never jump. The view virtualizes its own list and keeps at most 500 records.
- **Lazy images and infinite lists.** The original stays laid out under the view; it is never `display:none`. One
  chunk ahead of the person, the hidden page is scrolled to the next records so the site loads them. Media that
  starts playing under the view is paused.
- **Site popups.** Peek is triggered by *state*, not cause: a top-layer entry, or a dialog, menu, listbox or
  aria-modal element that becomes visible.
  - Menus and listboxes are mirrored inside the view.
  - True dialogs peek: the view closes its own `<dialog>`, a "Back to Fit view" pill sits beside the popup, and
    focus moves into the popup.
  - Returning sends Escape to the popup first.
- **Status strip.** New `role=status`/`alert`/`aria-live` content, and fixed-position toasts that appear within 3 s
  of a proxied action, are mirrored with their buttons proxied ("Conversation archived · Undo").
- **Tab mode.** Fit view stays on in the tab until the person picks **Original page**. A page that can't be
  re-presented (for example a video player) shows one line ("Videos play best on the original page") and Tailor's
  calm set. The next re-presentable page in that tab reopens Fit view. Back/Forward restores the view's scroll by
  record key; closing scrolls the original to the record in view.
- **Covering.** If something covers Fit view's controls outside a peek (`trackVisibility`), proxies freeze with "Something
  on this page is covering Fit view". The toolbar popup and the shortcut always close it.

### 4.6 Zoom and Tailor while Fit view is open

- **Zoom.**
  - Opening the view returns the tab to the person's own zoom; the reflow happens hidden underneath.
  - Fit view reads the page there in measure mode, with all op blocks removed.
  - It renders in px ÷ (tab zoom × pinch).
  - On close, Tailor's zoom comes back.
- **Tailor is frozen** while the view is open: no replans, no incremental marks, no verification (its hit tests are
  blind under the view).
- Skeleton reads happen at the person's own zoom, so the template cache doesn't split by zoom.

### 4.7 Verification (verify-or-rollback)

- **Before showing:**
  - the validator passes (§4.1);
  - **conservation:** every visible original control and text block is in the view or in "Everything else", and
    records are counted by key across the session;
  - render health: no horizontal overflow, every control ≥ T, adjacent tiers distinguishable, body px × zoom = F ± 1.
- **After:** proxy effect checks.
- A failure falls back to the heuristic spec, then to the original page with Tailor.

## 5. Tailor: the fixed, research-backed layer, made holistic

### 5.1 Page scale (un-retires `page_zoom`, reversing the 2026-09-30 decision)

**Mechanism.**
- Per-tab zoom to `z = snap(min(k, zMax))`, where the snap is down to Chrome's presets (110/125/150/175/200%).
  `zMax = clamp(innerWidth / 800, 1, 2)`†: 800 CSS px stands in for the desktop layout class (`ZOOM_MIN_LAYOUT_PX`).
- z is a scale over the person's own zoom (their per-origin factor, the baseline): the tab is set to baseline × z.
- Text, targets and images scale together, so hierarchy cannot invert.
- The site's own breakpoints do the reflow: "responsive design adapts to the screen; WebAble adapts the screen to
  the person".

**Guards** (from the review):
- **Breakpoint guard.** zMax keeps `innerWidth / z` inside the current layout class. After applying, the number of
  visible primary-nav links and the visibility of the search field must not drop. If they do, step down one level.
  Any gap that remains is covered by the Fit view offer.

  Bigham's 1.6× and the probe's 1.94× were measured with CSS zoom, which does not move breakpoints. That is why the
  guard exists instead of a constant.
- **Frozen per page view.** The worker decides z once, at the first reading that has body text: DCL on most pages, later
  on an SPA shell whose text renders after DCL (a reading with no body text, k null, freezes nothing and is never
  cached for the template). Once the person has interacted with the page, a z still undecided stays as the tab shows
  it, so nothing jumps under their pointer. It changes only on Undo or a step-down, so there is no zoom → reflow →
  re-measure → re-zoom loop. It is never re-zoomed on SPA routes.
- **Repeat visits apply early.** The z cached per site + path shape + window-width bucket is applied in the
  `cs:hello` handler and again on `pageshow.persisted` and on prerender activation.
- **The person's zoom wins.** An `onZoomChange` to a factor WebAble didn't set means the person owns zoom: the scope
  returns to per-origin, their factor is kept, and the site stops getting `page_zoom` until they reset. Chrome's
  zoom-bubble Reset counts as Undo.
- **Undo** restores the person's previous zoom, not 100%.

**Known trade-off.** Over a personal zoom other than 100%, the tab factor is not a preset: 125% × 1.5 gives 187.5%.
Only z is snapped, so the factor a page can read (through `devicePixelRatio`) is a product of the person's zoom and a
preset, which is more distinctive than a preset alone. Snapping the product instead would change the scale the fit
asked for. Accepted for v2.

v1 retired it because zooming "changes the whole layout of a site they didn't ask to change". v2's premise is that
coherent whole-layout change is what helps, within these guards. The v1 alternative produced §1.

### 5.2 The other ops, fixed

| Op | v1 problem | v2 |
| --- | --- | --- |
| `text_floor` | every text element below the floor goes to the floor; per-element exemptions | **main region only.** One monotone map f(s) for the residual k / z. Running text reaches F; other roles in main (captions, bylines, buttons, badges) grow with the same map but never above body size. Template classes with clip risk (ellipsis, line-clamp, fixed height, overlay) are excluded **as a class**. Whole-op rollback, no exemptions. `level` keeps meaning effective px: the engine aims at level ÷ (the person's own zoom × z), the tab's whole zoom (`AdaptationPlan.ownZoom` × `zoom`). No text grows past a natively larger text in its region, except that a control's label caps no running text and a one- or two-character or icon label (a "+" button) caps no text; headings in controls still rank. |
| `target_size` | vertical growth unclamped; rolled back whole on one clip | vertical growth clamped by clipping ancestors; one decision per target template |
| verifier | text-sibling overlap only | adds hierarchy order (no size inversion within a region), template consistency (same field → same size), more truncation than before, overlap against non-text boxes |
| policy | `text_floor` and `page_zoom` are alternatives; the saved fit forces auto everywhere | **composition**: `page_zoom` = snap(z) and `text_floor` carries the residual; `AdaptationPlan.zoom`; a triage verdict of "fits" suppresses saved-fit auto; auto only when k > 1.15 (otherwise offer) |

Everything else (contrast, focus outline, calm motion, pause media, dim distractions, focus view, unpin bars,
steady clicks, menu grace, reading guide) is unchanged.

## 6. The planner (OpenAI)

**Call path.** Service worker → Supabase Edge Function `compose` → OpenAI Responses API. The function holds
`OPENAI_API_KEY` (deployed from `COMPOSE_OPENAI_API_KEY` when that planner-only key is set), verifies the JWT, checks
the `ai_layout` consent, applies the quota, and zod-validates the request.

**Order of checks** (`compose/handler.ts`):
1. CORS and origin; `GET …/health` answers 204.
2. Auth.
3. Kill switch: `COMPOSE_DISABLED=1` (a Supabase secret, read on every request) answers degraded `disabled` before
   the body is read.
4. Body ≤ 49 KB (the 48 KB wire skeleton plus the envelope), then the schema version, the strict schema, the
   vocabulary re-check and the record-words rule (Wire format, below).
5. No key: degraded `unconfigured`.
6. Consent read (1.5 s deadline).
7. The quota (2.5 s deadline) runs alongside the model call; a denial or a quota failure aborts the call.

**Model.**
- `gpt-6-sol`, reasoning `none`, temperature 0, strict `json_schema`, `store: false`, fast tier (`service_tier:
  'priority'`, which OpenAI serves as "fast").
- A constant `prompt_cache_key`; no `user`, `metadata` or `safety_identifier` is sent; `max_output_tokens` 1,800.
  One non-streaming request per model.
- The model is pinned in `versions.ts`. Fallback: `gpt-5.6-terra`, tried once and only when the pinned model is
  unavailable to the key (model not found, or it rejects one of the planner's fixed settings).
- **One 12 s deadline covers the pinned model and the fallback together.** No retries.
- Pilot (4 pages): best of 12 models at 4.89/5; p50 5.6 s, 4.2 s on the fast tier; about $0.011–0.024 per page.

**Responses.**
- Success: 200 `{ok: true, v: 1, schema, model, spec}`. `model` names the alias that answered (`gpt-6-sol` or
  `gpt-5.6-terra`); the worker treats any other value as model drift.
- Degraded: 200 `{ok: false, degraded}` with `disabled`, `unconfigured`, `timeout`, `model_error`, `invalid_output`
  or `refused`. Fit view keeps the heuristic spec and the worker decides when to ask again.
- Quota: **429** `{ok: false, degraded: 'quota', retryAfterMs}` plus `Retry-After`. A person's limit reopens at the
  top of the hour; the product-wide limit after 60 s.
- Bad input: **422** `{error: {code: 'bad_input'}}` (not the contract, a word outside the vocabulary, or words where
  the wire has none). Another schema version: **409** `schema_mismatch`. No consent: 403 `consent_required`.
  Oversize: 413.
- Logs carry stages, issue codes and counts only, never values.

**When.**
- Only after the person opens Fit view on a template with no planner spec, or on a site set to "Always here".
- Never on webmail or chat, never on v1's excluded sites, checkout, or pages with password or payment fields.
- The first open of a template renders the heuristic spec at once. When the planner spec arrives, a chip offers
  "A better layout is ready · Switch". It never swaps under someone reading. Later opens use the cached planner spec.

**Wire format.** A typed JSON tree, zod-validated at the edge. The server writes the outline the model reads, so
nothing page-supplied reaches the prompt unvalidated.
- **Tags:** an HTML enum, or `custom`, which maps to its role.
- **Roles and flags:** ARIA and WebAble enums.
- **Labels:** at most 6 `VOCAB_V1` tokens. Unknown words become `·`. There are no digits.
- **Text inside records and exemplars:** shapes only (`text` plus a length bucket, `pat:price` and similar). No
  samples.
- **Words where the wire has none are refused.** The server rejects the whole request (422) if any text node
  (`text`, `stext`) or any node inside a record (a collection's items, its exemplar and their slots) carries label
  words at all, even words from the vocabulary. This is stronger than the vocabulary check: a modified client cannot
  send record text one public word at a time.
- **Removed before sending:** tokens that appear in an input value or URL query.
- **Rounding and caps:** boxes rounded to 8 px, counts bucketed, at most 600 nodes, depth ≤ 24, wire skeleton
  ≤ 48 KB, request body ≤ 49 KB.

**Output.** A PageSpec with no free strings. The edge function rejects any response that contains unknown ids.

**Security.**
- No page text goes in, and only enums come out. That closes the text injection channel and the exfiltration channel.
- Adversarial *structure* is handled by protected kinds, the trusted-slot rule and conservation.

**Cost.** A separate quota, `consume_compose_quota`: 10 per hour and 60 per day per user; 30 per minute and 2,000 per
day globally. Usage and cached-token counts are never returned to clients.

**Cache.**
- Device-local; never uploaded or shared.
- Keyed `HMAC(secret, [site, path shape, schema, model])`, holding up to 3 structural variants. The one chosen is the
  variant with ≥ 80% locator resolution.
- Locators store structural paths, roles, and HMACs of names and of hrefs (with query and fragment removed).
- A spec is cached only after it passes conservation. It is evicted on a conservation failure, a proxy failure or a
  quick exit.
- Budget: 1.5 MB / 150 entries. Wired into Forget site and clear data.

## 7. Learning and control

- **When Fit view appears** (revised 2026-10-16 by docs/11 §2, which takes precedence):
  - It is **automatic on arrival** when the person's structure need is level 2 and the page is busy for them, and on
    sites where they chose "Always here". A one-time line explains it the first time.
  - It is **offered** ("Simplify this page") at structure level 1 on busy pages, and whenever triage says *compose*.
  - The popup's "Simplify this page" switch is on every page Fit view can represent.
  - Automatic opens go back to an offer:
    - on a site after 2 quick "Original page" exits with a keep rate below 0.5;
    - on a page type with at least 5 observations and a keep rate below 0.4;
    - in a tab after "Original page" there;
    - everywhere when "Simplify busy pages automatically" is off in Settings.
  - These thresholds are unvalidated defaults.
- **Signals.**
  - An explicit **Original page** within 30 s, with no proxied action, counts as an undo.
  - A proxied navigation counts as a keep.
  - A closure caused by a route change counts as neither.
  - Beta-Bernoulli per site and per page type.
- **Control.** One click back to the original page, always. Tailor changes keep their v1 Undo. Text − / + inside Fit
  view become overrides in Your fit.

## 8. Privacy, consent, policy

**New consent: `accounts.ai_layout`, "Better Fit view layouts (OpenAI)", off by default.** It is separate from
`cloud_analysis` because the recipient is different. The copy:

- *When:* Only after you open Fit view, once per kind of page. Later visits use the plan saved on this device.
  Never on mail, chat, banking, health or government sites, checkout, or pages with password or payment fields.
- *What is sent:* An outline: what each part is, where it sits, its size and text size, and roughly how long its
  text is. Up to 6 words per part, from a public list of common interface words like "menu" or "price". Other
  words become "·". No words from emails, results or products in lists.
- *To whom:* WebAble's server checks your account and limits, then sends the outline, without your account, to
  OpenAI. OpenAI returns a plan made only of fixed choices.
- *Never sent:* Other page words, anything you type, the address or title, your fit, or who you are.
- *Worth knowing:* The outline's shape can show which site it came from.
- *Kept:* WebAble's server keeps a count, not the outline. OpenAI doesn't train on it and may keep it for up to
  30 days for abuse checks. This device keeps the plan for 14 days.

**Other changes:**
- Receipts gain the destination `layout_planning`, with an exact-request view.
- A one-time v1 notice appears before any call.
- Disclosure, for page scale: "Sites can tell a page is zoomed or restyled, as with Chrome's own zoom."
- Chrome Web Store: the spec is configuration that selects bundled behaviour. The privacy policy names OpenAI and its
  retention, with a Limited Use statement, and the dashboard declares "Website content".
- Without consent, signed out, or offline, Fit view works on the heuristic spec.

**The local dev planner** (`pnpm dev:compose`: `scripts/dev-compose.ts` in front of `compose/dev.ts`):
- binds to 127.0.0.1 (port 54400 by default) and answers only when the Host header is `127.0.0.1:<port>` or
  `localhost:<port>`, so a DNS-rebound name never matches;
- requires the development extension's Origin on every POST. A page cannot forge it, and a no-cors POST can carry
  neither that Origin nor a JSON body;
- **requires no token by default**: the development build calls with no Authorization header, because the dev planner
  needs no account. With `--token <t>`, every request must also carry `Bearer <t>`. Any process on the machine can set
  the Origin header, so use `--token` on a shared machine;
- serves only `/compose` and `/functions/v1/compose` (and their `/health`);
- reuses the real compose handler with auth, consent and quota stubbed and the kill switch off;
- `--mock` answers with a deterministic planner and needs no key. Live mode reads `OPENAI_API_KEY` from the root
  `.env` at startup and never prints or logs it.

The extension uses it only in a development build whose `WXT_COMPOSE_URL` is a loopback address, with the dev planner
setting on; privacy gates (excluded sites, mail and chat, sensitive and checkout pages) still apply. Production builds
ignore `WXT_COMPOSE_URL` and compile loopback addresses out, and the package check fails on any loopback URL in the
service worker.

## 9. Contracts and work packages

**Step 0 (contracts, one owner):**
- `core/versions.ts`;
- `core/{skeleton,compose,fit,triage}/types-and-wire`;
- `policy/types.ts` (new verify codes, `AdaptationPlan.zoom`, `PolicyInput.triage`);
- `page/types.ts` (`PageSignals.layout`);
- the receipt destination;
- `extension/lib/protocol.ts`, `sw/ui.ts`, `engine/fitview/types.ts`;
- popup copy entries;
- the migration and DB types;
- the core bundle.

Then, with disjoint file ownership:

| WP | Owns | Depends on |
| --- | --- | --- |
| 1 Policy + triage | `core/triage/triage.ts`, `core/policy/{decide,measure}.ts`, `core/ops/catalog.ts`, priors, templates, `sw/profile.ts` | 0 |
| 2 Tailor engine | `engine/ops/{text,targets,registry}.ts`, `verify/checks.ts`, `engine.ts` | 0 |
| 3 Read | `engine/extract/*`, `engine/skeleton/*`, `engine/adapter.ts`, `core/skeleton/{outline,template,locate}.ts` | 0 |
| 4 Spec + solver | `core/compose/{heuristic,validate,prompt}.ts`, `core/fit/{solver,typeramp}.ts` | 0 |
| 5 Fit view render | `engine/fitview/{host,render,components,styles,fonts}.ts`, `entrypoints/fitview.content.ts`, engine harness, fixtures | 0 |
| 6 Proxies + live | `engine/fitview/{proxy,locate,sync,peek,status,firewall}.ts`, `entrypoints/engine.content.ts`, main-world bridge | 0, 5's interface |
| 7 Planner service | `supabase/functions/compose/*`, the migration's RPC, deploy/test scripts, `sw/compose.ts`, `storage/compose.ts`, the dev server | 0 |
| 8 Worker integration | `sw/{worker,main,router,tabs,gating,cachekeys,zoom,fitview}.ts`, storage keys/sites/receipts | 1, 3, 4, 7 |
| 9 Surfaces | popup, web privacy and consent, Your fit wording | 8 |
| 10 Evaluation | `scripts/eval/*` (real-site corpus, screenshots, metrics, planner re-benchmark) | 3, 4, 5 |

## 10. How we will know it works

**Release gates**, run on a fixed real-site corpus (`scripts/eval/sites.mjs`, loaded signed out):
- **Sites:** YouTube (channel videos and search), Wikipedia, Amazon (search and a product), Meta, Reddit, a BBC News
  article, two gov.uk pages, Craigslist, GitHub, NN/g and WebAIM articles. Plus local Gmail-like inbox and video-feed
  fixtures: the harness never signs in to anything, so signed-in Gmail checks need a seeded account, never real mail.
- **gov.uk is on the default exclusion list** (`core/page/excluded.ts`, with every government suffix). There it tests
  triage and Tailor only: Fit view is unavailable and the planner never runs.
- **Personas:** large text (F 24), large targets (T 56, steady clicks), calm (high distraction benefit), very large
  text (F 36), plus a reading-floor sweep (16–40 px) through triage on every page.
- **Seeded-fault fixtures** for the verifier and the privacy checks.

| Gate | Target |
| --- | --- |
| Hierarchy | Tailor: Kendall τ = 1 between original and adapted size ranks per region. Fit view: 0 inversions, and adjacent tiers distinguishable. |
| Consistency | same template field → same size; row heights within a template equal |
| Health | no new horizontal scroll, overlap or truncation (Tailor); none in Fit view; zoom never reduces visible nav |
| Conservation | 100% of visible controls and text blocks reachable in Fit view |
| Targets | 100% of Fit view controls ≥ T |
| Triage | each persona's verdict follows from its measured k and representability (for example, a Wikipedia article with ~14 px main text is *compose* at F=36, k ≈ 2.6 above zMax; at F=18 it is *tailor*, k ≈ 1.3). An excluded site can still get a *compose* verdict but never a Fit view offer. |
| Privacy | 0 seeded secrets (names, queries, subjects, injection labels) in any request; 0 promotions to trusted slots; 0 page shortcuts fired by typing in Fit view |
| Latency | read + triage ≤ 50 ms; heuristic Fit view ≤ 150 ms to first render; planner p95 ≤ 8 s; cache hit < 50 ms |
| Proxies | 0 wrong-target actions; ≥ 95% of actions take effect or fall back cleanly |
| UX | layout shift after open = 0; primary content within the first viewport |

**Study.** The phone study (docs/09) tests Tailor's motor claim only. Fit view claims need a desktop study:
- low-vision, motor, 65+ and ADHD groups, plus an age-matched comparison group, so that gap closure can be computed;
- conditions: the original with the person's own zoom, Tailor, heuristic Fit view, planner Fit view, and Chrome
  Reading mode for article tasks;
- real sites, crossed familiar × unfamiliar;
- SUPPLE's time split (search / navigation / manipulation), wrong-target errors, NASA-TLX, and perceived control;
- per-participant improve/regress sign tests.

The planner claims stay labelled "4-page pilot" until the re-benchmark runs.

## 11. What v2 refuses to do

- The model never writes text, CSS, HTML, selectors or code.
- Fit view never moves or deletes the site's nodes, never `display:none`s the original, and never writes the site's
  ARIA, focus order or keyboard handling.
- Nothing is hidden without a labelled way back.
- No compliance claims. No diagnosis.
- The fit never leaves the service worker.
- No irreversible action is emphasized.
- Nothing withheld by a paywall or consent wall is shown.
