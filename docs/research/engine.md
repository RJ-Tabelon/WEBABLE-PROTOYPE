# WebAble in-page engine: feature extraction, adaptation primitives, verification

Research report, 2026-09-28. Scope: the Chrome MV3 content-script engine, written in plain TypeScript. It extracts page features, applies bounded adaptation operations and verifies them, with rollback on failure.

Legend: **[V]** marks a behaviour I could not confirm from a primary source. Verify it in a spike before relying on it. **(est.)** marks an order-of-magnitude cost estimate. Measure it on the fixture corpus.

---

## 0. Decisions in brief

1. **Send the model a feature vector, not a DOM.** The payload is about 2–4 KB of JSON (~600–1,200 tokens): histograms, counts, bucketed geometry, region and cluster ids, and classifier flags. It contains no body text and no raw URL. The model chooses `op(params, scope=id)` from the reviewed library. Colours, pixel values and selectors are computed by deterministic solvers in the engine. Wanscher et al. (2026) found that small LLMs writing CSS "blind" improved and regressed pages at almost the same rate (24 improvements vs 20 regressions). Every metric that needed element-specific perceptual judgement, such as contrast or colour-only conveyance, was "essentially never improved". Their conclusion is a hybrid design with rules for what rules can do, perceptual grounding, and a verify loop. That is WebAble's architecture.
2. **Apply profile-level ops before first paint.** Profile-level ops include the focus ring, text-spacing floor and motion reset. Pre-package reviewed CSS files per op and parameter bucket, and register them with `chrome.scripting.registerContentScripts({css, runAt:'document_start', persistAcrossSessions:true})`. This delivers value on the first visit with no model round-trip and no flash. The model-selected, page-specific ops follow after extraction and are applied in one batch.
3. **Use one style layer per tree scope.** Put a constructed `CSSStyleSheet` in `document.adoptedStyleSheets` and in each shadow root, and mark elements with a single `data-wa` token attribute. Keep a `WeakMap` for any inline state you must touch. Undoing an op means removing its rule block and its tokens. Wanscher et al. use adopted sheets for the same one-step undo. Dark Reader splices override sheets into `adoptedStyleSheets`. Stylus appends `<style>` elements after `<body>` and restores their order with a MutationObserver.
4. **Increase text size with browser zoom where possible.** Per-origin `chrome.tabs.setZoom` reflows responsive layouts correctly. Use per-element font floors only for outlier small text, and verify every floor for clipping and overlap.
5. **Contrast.** Adjust text colour per element, keeping the hue and moving lightness until the pair reaches the target. Add a "backplate" for text over images. Do not use a global `filter`, and do not use the prototype's "make every background transparent" approach. Use the WCAG 2 ratio as the metric. **Do not ship APCA.** The apca-w3 licence allows only non-commercial use and use "for WCAG" content. APCA is not in the WCAG 3 Working Draft (removed July 2023, still absent in 2026).
6. **Enlarge hit areas with an absolutely positioned `::after` using negative `inset`.** The pad is capped at half the gap to the nearest neighbour, so layout does not move and expanded areas do not overlap. Apply it only where `::after` is unused and adding `position:relative` is safe. Measure spacing with the WCAG 2.5.8 circle test (axe's `getOffset` algorithm), parameterised by the user's calibrated target size rather than 24 px.
7. **Click stabilisation can use trusted events.** On `pointerdown`, call `target.setPointerCapture(id)`. Since Chrome 135 the resulting `click` is dispatched to the capture target, not the common ancestor, so slips between down and up still activate the intended control. No synthetic events are needed. This is the web equivalent of Steady Clicks (Trewin et al., ASSETS'06). Act only on pointer events, never on keyboard input.
8. **Dim distracting regions with `opacity` only.** Restore them on `:hover` and `:focus-within`. Never use `display:none`, `visibility:hidden` or `inert`, because all three change the accessibility tree or focus order. Hiding ads or cookie banners therefore conflicts with the invariants, so the library dims them instead. Avoid `filter` on regions that contain fixed descendants, because it creates a containing block.
9. **Motion.** Apply the CSS reduced-motion reset (duration ≈0, iteration count 1) to CSS animations. In a WAAPI sweep, call `finish()` on finite animations and `pause()` on infinite ones. Pause autoplaying muted videos and re-pause them only when the user has not interacted. Freeze GIFs with a canvas overlay, which avoids CSP problems with `blob:` images. Call `svg.pauseAnimations()` for SMIL. Treat carousels and canvas/rAF loops as detect-and-offer only: they cannot be paused reliably from the isolated world.
10. **Keep verification native and geometry-based, within a 10–30 ms budget per apply.** Take a baseline snapshot, apply, wait two rAFs (plus `document.fonts.ready`), then run diffs for clipping, obscured or collapsed controls, horizontal overflow, hidden focusables, contrast, lost focus and reading-position shift. Attribute each failure to an op through its tokens, roll that op back, and bisect when attribution is ambiguous. **Keep axe-core out of the real-time loop.** It is 561 KB minified (151 KB gzipped). It always builds the flat tree and grid for the *whole* document even when scoped, and pages over 50k nodes take more than 10 s. Use it in CI (Playwright) and for an on-demand "deep check". MPL-2.0 allows bundling it unmodified in a proprietary extension.
11. **Privacy.** Plain hashes of domains or URLs can be reversed by dictionary attack. Use HMAC with a per-install secret that never leaves the device. Classify locally: the model receives `{kind:"cookie_banner", conf:.9}`, never the banner's text.

### 0.1 Gaps in the current prototype (`apps/extension/lib/*.ts`)

| Issue | Where | Fix |
|---|---|---|
| Sends `url`, `title`, a 2,000-char body `excerpt` and 25 heading texts in `PageSnapshot` | `page-reader.ts` `readPage()` | Replace with the §2.1 schema (no body text, no URL) |
| `isElementVisible` walks every ancestor with `getComputedStyle` for each element (O(n·depth)) | `page-reader.ts` | `el.checkVisibility()` plus subtree rejection in a TreeWalker (§2.2) |
| Runs `querySelectorAll('body *')` and `getComputedStyle` on every element, synchronously | fixed/sticky count | Fold into the single budgeted walk |
| Contrast modes set `background-color: transparent !important` on every div, section, span and so on | `rule-engine.ts` `RULE_CSS` | This destroys buttons, badges and text over images. Replace with per-pair colour solving (§3.4.3) |
| 16 px floor, line-height 1.5 and letter-spacing applied to `a, button, label, span` | `READABLE_TEXT_SELECTOR` | Controls overflow and clip. Scope to text blocks, bucket the values, and verify |
| Any mutation re-runs the full-page apply after 120 ms (strip attributes, then re-read all computed styles) | `reader.content.ts` | Incremental processing of added subtrees plus a huge-mutation fallback (§3.5) |
| Single `<style>` in `<head>` that the page can remove; no shadow-root coverage; no per-op undo; no verification | `ensureStyle` | Style layer, token marking, verifier and rollback (§3.2, §4) |

---

## 1. Engine architecture

```
document_start ─► [A] pre-registered reviewed CSS (profile-level ops, no measurement)       ~0 ms
DOMContentLoaded+idle ─► [B] budgeted extraction (viewport first) ─► features (2–4 KB) ─► SW ─► AI
                                                                          ◄─ ops[] (validated, clamped)
                    ─► [C] baseline snapshot ─► apply batch (single write phase)
                    ─► [D] settle (2×rAF, fonts) ─► verify diffs ─► rollback failing ops ─► report
MutationObserver / SPA nav ─► incremental [B'] on added subtrees ─► re-apply marks ─► [D'] scoped verify
IntersectionObserver ─► lazy verify for regions scrolled into view
```

- **Worlds.** Everything runs in the ISOLATED world. Use a MAIN-world script (`registerContentScripts({world:'MAIN'})`) only if you later need to observe constructed-stylesheet mutations or `attachShadow`, which is what Dark Reader's `stylesheet-proxy.ts` does (§3.1). V1 does not need it.
- **Frames.** Use `all_frames: true`. Each frame runs its own engine and features are aggregated per frame. Ads and chat iframes are handled from the parent frame by dimming the `<iframe>` element.
- **Budgets.** Keep each slice ≤5 ms. Extraction totals ≤30 ms of main-thread time (≤50 ms p95) and verification ≤30 ms per apply. Yield with `scheduler.yield()` (Chrome 129+), falling back to `setTimeout(0)`. Do no work in hidden tabs: rAF is paused there, so defer until `visibilitychange`.
- **Read/write discipline.** Measure everything first, then write everything, then measure again after settling. Interleaving reads and writes forces a layout per element.

---

## 2. Page feature extraction

### 2.1 Output schema (the only thing that leaves the tab)

```ts
// packages/shared: zod-validated, versioned. All numbers bucketed; no free text except ≤24-char control labels when strictly needed (default: none).
type Hist = number[];                          // fixed bucket edges declared per field
type Id = string;                              // ephemeral, per-page: "r3" region, "t5" target cluster, "m2" motion source
export interface PageFeaturesV2 {
  v: 2;
  frame: { top: boolean; vw: number; vh: number; dpr: number; zoom: number; docH_vh: number; hOverflow: boolean };
  pageType: { article: number; feed: number; search: number; product: number; form: number; app: number; video: number; map: number; checkout: number; login: number }; // 0..1 local classifier
  text: {
    chars: number;                               // bucketed: <500, <2k, <10k, <50k, ≥50k
    sizePx: Hist;                                // char-weighted: [<12,12-14,14-16,16-18,18-24,≥24]
    mainSizeP50: number; mainSizeP10: number;
    lineHeightRatioP50: number;                  // main text line-height/font-size
    cplP50: number; cplP90: number;              // chars per line, main content
    justifiedShare: number; allCapsShare: number; italicShare: number;
    iconFontShare: number;
  };
  contrast: {
    sampled: number;
    belowWcag: { r3: number; r45: number; r7: number };     // char-weighted share below ratio thresholds
    belowPersonal: number;                                   // share below the profile's target
    failures: Array<{ id: Id; region: Id; sizeB: number; bold: boolean; ratio: number; polarity: 'dol' | 'lod'; bg: 'solid' | 'translucent' | 'gradient' | 'image' | 'overlap' | 'unknown' }>; // ≤12
  };
  targets: {
    count: number; minSideHist: Hist;            // [<16,16-24,24-32,32-44,≥44]
    failWcag258: number;                         // 24px circle test
    failPersonal: number;                        // circle test at the profile's px
    inlineLinks: number; clusters: Array<{ id: Id; region: Id; n: number; minSide: number; minGap: number; kind: 'toolbar' | 'nav' | 'list' | 'form' | 'pager' | 'misc' }>; // ≤10
  };
  interaction: { dragSources: number; dndLib: string[]; sliders: number; hoverMenus: number; hoverOnlyContent: number; dblclick: boolean };
  motion: { infinite: number; long: number; entry: number; autoplayVideo: number; gif: number; smil: number; marquee: number; canvasLarge: number; carousels: number; motionAreaPct: number; sources: Array<{ id: Id; kind: string; areaPct: number; inMain: boolean }> };
  overlays: Array<{ id: Id; kind: 'cookie' | 'chat' | 'modal' | 'header' | 'footerbar' | 'promo' | 'unknown'; pos: 'fixed' | 'sticky'; edge: 't' | 'b' | 'l' | 'r' | 'c'; areaPct: number; conf: number }>;
  regions: Array<{ id: Id; role: 'main' | 'nav' | 'header' | 'footer' | 'aside' | 'ad' | 'promo' | 'recs' | 'comments' | 'form' | 'media' | 'feed' | 'other'; landmark: boolean; box: [number, number, number, number]; /* % of doc W/H */ linkDensity: number; textDensity: number; controls: number; conf: number }>; // ≤24
  forms: { count: number; fields: number; required: number; unlabeled: number; types: Record<string, number>; hasCaptcha: boolean; multiStep: boolean; hasErrors: boolean };
  perf: { nodes: number; walkedMs: number; truncated: boolean };
}
```

Size control: cap the arrays, round to 2 significant digits, and send ids instead of selectors. The engine keeps a local registry `Map<Id, WeakRef<Element>[]>` so that scopes in the model's ops resolve to elements.

### 2.2 Traversal and budget

One budgeted walk collects the per-element facts that every feature needs. It visits only rendered elements and rejects hidden subtrees wholesale.

```ts
const yieldToMain: () => Promise<void> =
  (globalThis as any).scheduler?.yield
    ? () => (globalThis as any).scheduler.yield()
    : () => new Promise((r) => setTimeout(r, 0));

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'svg', 'math', 'webable-ui']);

export interface WalkCtx { visit(el: Element, cs: CSSStyleDeclaration): void; sliceMs?: number; totalMs?: number; maxNodes?: number }

export async function walk(root: Element | ShadowRoot, ctx: WalkCtx): Promise<{ nodes: number; ms: number; truncated: boolean }> {
  const { sliceMs = 5, totalMs = 30, maxNodes = 8000 } = ctx;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(n) {
      const el = n as Element;
      if (SKIP.has(el.localName)) return NodeFilter.FILTER_REJECT;
      if (!el.checkVisibility({ contentVisibilityAuto: true })) {
        // display:contents has no box but its children do → skip self, keep walking children
        return getComputedStyle(el).display === 'contents' ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let nodes = 0, busy = 0, slice = performance.now();
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const el = n as Element;
    ctx.visit(el, getComputedStyle(el));          // one computed-style read per element; style is clean after the first
    if ((el as HTMLElement).shadowRoot || el.localName.includes('-')) queueShadowRoot(el); // walked later with its own style layer
    if (++nodes >= maxNodes) return { nodes, ms: busy, truncated: true };
    const now = performance.now();
    if (now - slice > sliceMs) {
      busy += now - slice;
      if (busy > totalMs) return { nodes, ms: busy, truncated: true };
      await yieldToMain();                       // the page may mutate between slices; the walker tolerates removals
      slice = performance.now();
    }
  }
  return { nodes, ms: busy + performance.now() - slice, truncated: false };
}
```

- **Viewport first.** Run the walk once with a visitor that records `getBoundingClientRect()` only for elements intersecting `[0, 2·vh]`, and compute everything above the fold from that. A second idle pass over the full page fills in the page-wide histograms. Mark the result `truncated` when caps are hit.
- **Costs (est.).** `getComputedStyle` on a clean style tree costs about 1–3 µs per element, and a `getBoundingClientRect` on a clean layout about 0.2–1 µs. The first read after the page mutates pays for one full style or layout pass, which can be several ms on large pages. 5,000 elements take about 10–20 ms, so large pages need sampling (`maxNodes`) plus the viewport-first pass.
- **Shadow roots.** For open roots, use `el.shadowRoot`. For closed roots, `chrome.dom.openOrClosedShadowRoot(el)` (Chrome 88+) is available to content scripts; Dark Reader uses it at `src/inject/dynamic-theme/index.ts:668`. `document.getAnimations()` and TreeWalkers do not cross shadow boundaries, so each root is walked separately.
- **Shadow roots attached later.** Nothing notifies the isolated world when a shadow root is attached. Re-check custom elements (tag names containing `-`) that appear in MutationObserver additions, and use `customElements.whenDefined`. Dark Reader patches `Element.prototype.attachShadow` in the MAIN world (`stylesheet-proxy.ts`, event `__darkreader__shadowDomAttaching`). Defer that approach.

### 2.3 Text-size distribution and spacing

In the visitor, for elements that have a direct non-whitespace text-node child:
- `len` = sum of the direct text nodes' `nodeValue.trim().length`, which is cheap. Do not use `innerText`, because it forces layout.
- Add `len` to the `fontSize` bucket, giving a character-weighted histogram. Record `lineHeight` (`normal` ≈ 1.2×), `letterSpacing`, `wordSpacing`, `textAlign==='justify'`, `textTransform==='uppercase'` and `fontStyle`.
- Flag icon fonts when `fontFamily` matches `/icon|awesome|material|glyph|symbols|fontello|ionicons/i`, or when the text consists of Private Use Area code points (U+E000–F8FF). Exclude those elements from text metrics and from all text ops.
- Compute `mainSize*` only for elements inside the main-content candidate (§2.8).

### 2.4 Contrast sampling (effective background, WCAG 2 vs APCA)

**Sampling.** Take up to 150 text elements, stratified by (region, font-size bucket, fg/bg pair). Prioritise the viewport and main content. Cache results by the pair key `fg|bg-chain-signature`; most pages have fewer than 30 distinct pairs.

**Colour parsing.** Computed styles can serialise as `oklch()`, `lab()` or `color(...)` when authored that way. Normalise with a 1×1 canvas and cache the result per string.

```ts
type RGBA = [number, number, number, number];
const c2d = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })!;
const colorCache = new Map<string, RGBA>();
export function toRGBA(css: string): RGBA {
  const hit = colorCache.get(css); if (hit) return hit;
  let v: RGBA;
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(css);
  if (m) v = [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]];
  else if (css === 'transparent') v = [0, 0, 0, 0];
  else { c2d.clearRect(0, 0, 1, 1); c2d.fillStyle = '#000'; c2d.fillStyle = css; c2d.fillRect(0, 0, 1, 1);
         const d = c2d.getImageData(0, 0, 1, 1).data; v = [d[0], d[1], d[2], d[3] / 255]; } // gamut-clipped sRGB
  colorCache.set(css, v); return v;
}
const over = (f: RGBA, b: RGBA): RGBA => { const a = f[3] + b[3] * (1 - f[3]); if (!a) return [0, 0, 0, 0];
  return [0, 1, 2].map(i => (f[i] * f[3] + b[i] * b[3] * (1 - f[3])) / a).concat(a) as RGBA; };
const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const lum = (c: RGBA) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
export const ratio = (a: RGBA, b: RGBA) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
```

**Effective background.** This is a hybrid of axe-core's approach and a cheap ancestor walk. axe-core (`lib/commons/color/get-background-color.js`, `get-background-stack.js`) builds the stack of elements beneath the text, composites translucent layers bottom-up (`flattenColors`), and returns `null` (incomplete) when it meets a background image, a partially obscuring element (`elmPartiallyObscured`/`bgOverlap`), or an unparseable colour. It treats text-shadow ≥ 0.1em as background and places the html/body backgrounds specially. axe uses its own 200 px spatial grid (`lib/core/constants.js` `gridSize: 200`, `lib/commons/dom/create-grid.js`) instead of `elementsFromPoint`. Its `elementsFromPoint` + `scrollIntoView` per element was the historical bottleneck: rendering twice per element on 10k+ node pages. After the grid rewrite, color-contrast takes about 5 s on 50k+ nodes and grid creation about 1 s (Klambert).

WebAble only needs **in-viewport** samples, so the native `elementsFromPoint` is acceptable. It is O(1) per call on a clean layout, at roughly 10–50 µs (est.).

```ts
type BgKind = 'solid' | 'translucent' | 'gradient' | 'image' | 'overlap' | 'unknown';
const WHITE: RGBA = [255, 255, 255, 1];
export function effectiveBackground(el: Element, r: DOMRect): { bg: RGBA; kind: BgKind } {
  // elementsFromPoint skips pointer-events:none elements (our overlays, but also decorative page scrims → a known blind spot)
  const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 12));
  let i = stack.findIndex(e => e === el || el.contains(e) || e.contains(el));
  if (i < 0) return { bg: WHITE, kind: 'unknown' };                 // e.g. text itself pointer-events:none → use ancestor walk instead
  let kind: BgKind = stack.slice(0, i).some(e => !isOurs(e) && !e.contains(el)) ? 'overlap' : 'solid';
  const layers: RGBA[] = [];
  for (; i < stack.length; i++) {
    const e = stack[i]; if (!(e === el || e.contains(el)) && kind !== 'overlap') { /* sibling underneath (positioned) */ }
    const cs = getComputedStyle(e);
    if (cs.backgroundImage !== 'none') { kind = /gradient\(/.test(cs.backgroundImage) ? 'gradient' : 'image'; break; }
    if (cs.mixBlendMode !== 'normal' || cs.filter !== 'none' || cs.backdropFilter !== 'none') { kind = 'unknown'; break; }
    const c = toRGBA(cs.backgroundColor);
    if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    if (e.localName === 'img' || e.localName === 'video' || e.localName === 'canvas') { kind = 'image'; break; }
  }
  let bg: RGBA = WHITE;                                             // canvas default under a transparent root
  for (let j = layers.length - 1; j >= 0; j--) bg = over(layers[j], bg);
  if (kind === 'solid' && layers.some(l => l[3] < 1)) kind = 'translucent';
  return { bg, kind };
}
// Foreground: toRGBA(cs.color); fold ancestor opacity<1 into alpha; mark 'unknown' if -webkit-text-fill-color/-webkit-text-stroke/text-shadow present.
```

- **Images and gradients (`kind` is `image`, `gradient` or `overlap`).**
  - Option (a): sample the gradient's colour stops and take the worst stop.
  - Option (b), for real pixels: in the service worker, `chrome.tabs.captureVisibleTab` (limited to `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND = 2`; needs `activeTab` or `<all_urls>`), then `createImageBitmap` → `OffscreenCanvas`. Read the text box (DPR-scaled) and take the luminance percentile farthest from the text colour as the background, which gives the worst case. The screenshot is processed in memory and never stored or sent.
  - Dark Reader's `image.ts` analyses background images offline in a similar way. It downscales to at most 32×32 = 1,024 pixels and classifies them as dark (<0.4 lightness on ≥70% of pixels), light (>0.7), transparent or large (>512²).
- **WCAG 2 or APCA.** WCAG 2 is `(L1+0.05)/(L2+0.05)` with sRGB linearisation, with thresholds 4.5:1 (normal text) and 3:1 (large text: ≥24 px, or ≥18.66 px bold). APCA is polarity-aware and models font weight and size, so it is perceptually better for dark themes and thin fonts. There are two blockers:
  1. **Licence.** apca-w3 is licensed to the W3C for WCAG use. The APCA licence permits non-commercial use without royalty, and commercial use needs "a written and signed commercial license agreement"; modification of the "essential elements … or specific approved constants" is prohibited.
  2. **Standards status.** APCA was removed from the WCAG 3 draft in July 2023, and the WCAG 3 contrast algorithm "is yet to be determined" as of 2026 (Roselli, April 2026).

  **Recommendation.** Use the WCAG 2 ratio as the exchanged metric. Model personal need from calibration as a target ratio per (size bucket, weight, polarity). This captures most of APCA's size, weight and polarity sensitivity without licensing risk. The product must never claim conformance.

### 2.5 Line length and spacing of main text

- **Exact method, for ≤30 sampled paragraphs in main.** `range.selectNodeContents(p); rects = range.getClientRects()`. Count distinct line tops, then `cpl = textLength / lines` (drop the last line). The cost is one layout-clean read per paragraph.
- **Cheap method.** Canvas `measureText` gives the average character width in the element's font: `ctx.font = \`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}\``, and `ctx.letterSpacing = cs.letterSpacing`. Then `cpl = contentWidth / (measureText(sample).width / sample.length)`. The sample is the element's own first 300 characters and never leaves the device. Use a document `<canvas>` so web fonts registered on `document.fonts` apply [V: OffscreenCanvas font access].
- **Output.** `cplP50`, `cplP90`, `lineHeightRatioP50` and `justifiedShare`. Readability guidance is roughly 50–80 cpl, and WCAG 1.4.8 (AAA) is 80.

### 2.6 Interactive targets and spacing (WCAG 2.5.8 algorithm)

**Candidates:** `a[href], button, input:not([type=hidden]), select, textarea, summary, label[for], [role=button|link|checkbox|radio|tab|menuitem|option|switch|slider|combobox], [tabindex]:not([tabindex="-1"]), [contenteditable=true]`. Add elements with computed `cursor:pointer` whose parent is not `cursor:pointer`; this catches `div`s with click handlers, which cannot be seen from the page. Collapse nested candidates: a label wrapping an input is one target.

**Normative test (SC 2.5.8).** A target passes if it is at least 24×24 CSS px. An undersized target passes the spacing exception if, "if a 24 CSS pixel diameter circle is centered on the bounding box of each, the circles do not intersect another target or the circle for another undersized target". Other exceptions: equivalent, inline ("in a sentence or … constrained by the line-height of non-target text"), user-agent control, and essential.

**axe-core implementation.** `lib/checks/mobile/target-offset-evaluate.js` uses `minOffset = 24`. It skips targets whose rect exceeds 10×minOffset, and keeps only neighbours with widget role that are focusable. `lib/commons/math/get-offset.js` takes the undersized target's centre and finds the closest point on each neighbour rect. For an undersized neighbour it uses the distance centre-to-centre minus that neighbour's radius. The result is compared against the radius (minOffset/2).

**WebAble.** Run the same test twice: at 24 px (reported as a WCAG-style metric only) and at the profile's calibrated `targetPx` (for example 36 or 44). The second is the one that drives ops. Use a uniform grid for neighbour search.

```ts
interface T { id: number; el: Element; r: DOMRect; cx: number; cy: number; small: boolean; inline: boolean }
const dPointRect = (x: number, y: number, r: DOMRect) =>
  Math.hypot(x - Math.max(r.left, Math.min(x, r.right)), y - Math.max(r.top, Math.min(y, r.bottom)));

export function spacingFailures(ts: T[], px: number): Map<number, number /* worst clearance */> {
  const cell = Math.max(2 * px, 64), g = new Map<number, T[]>();
  const k = (gx: number, gy: number) => gx * 100003 + gy;
  for (const t of ts) for (let gx = Math.floor(t.r.left / cell); gx <= Math.floor(t.r.right / cell); gx++)
    for (let gy = Math.floor(t.r.top / cell); gy <= Math.floor(t.r.bottom / cell); gy++) {
      const key = k(gx, gy); (g.get(key) ?? g.set(key, []).get(key)!).push(t);
    }
  const rad = px / 2, fails = new Map<number, number>();
  for (const a of ts) {
    if (!a.small) continue;
    let worst = Infinity; const seen = new Set([a.id]);
    for (let gx = Math.floor((a.cx - px) / cell); gx <= Math.floor((a.cx + px) / cell); gx++)
      for (let gy = Math.floor((a.cy - px) / cell); gy <= Math.floor((a.cy + px) / cell); gy++)
        for (const b of g.get(k(gx, gy)) ?? []) {
          if (seen.has(b.id) || a.el.contains(b.el) || b.el.contains(a.el)) continue; seen.add(b.id);
          const toRect = dPointRect(a.cx, a.cy, b.r);                                   // circle A vs target B
          const toCircle = b.small ? Math.hypot(a.cx - b.cx, a.cy - b.cy) - rad : Infinity; // circle A vs circle B
          worst = Math.min(worst, toRect, toCircle);
        }
    if (worst < rad) fails.set(a.id, worst);
  }
  return fails;
}
```

- **Inline links.** Mark a target `inline` when its computed display is `inline` and its parent block has non-link text siblings. Report inline links separately: WCAG exempts them, but a motor profile still cares about them.
- **Clusters.** Take connected components of failing targets whose gap is below `px`; these become the op scopes. The cluster `kind` comes from the landmark or ancestor role: toolbar, nav, list, pager or form. Record `minSide` and `minGap`.
- **Cost (est.).** Rects for ≤1,500 targets take about 1 ms on a clean layout, and the grid pass is well under 5 ms.

### 2.7 Drag-and-drop, sliders and double-click

These are detection only. The model uses them to offer alternatives.

| Signal | Detection |
|---|---|
| HTML5 DnD | `[draggable=true]` (excluding default-draggable `img` and `a`), `ondragstart` attributes |
| Libraries | dnd-kit: `[aria-roledescription="sortable"]` or `"draggable"`, `aria-describedby^="DndDescribedBy"`. react-beautiful-dnd / @hello-pangea/dnd: `[data-rbd-draggable-id]`, `[data-rfd-draggable-id]`. jQuery UI: `.ui-sortable, .ui-draggable`. SortableJS / Dragula only expose classes while dragging, so they are hard to detect |
| Sliders | `input[type=range]`, `[role=slider]` |
| Maps and canvases | `.leaflet-container`, `.mapboxgl-canvas`, `.gm-style`, large `canvas` |
| Double-click | `[ondblclick]` attribute only; listeners registered in JS are invisible from the page |

### 2.8 Hover-only menus and content

WCAG 1.4.13 requires such content to be dismissible, hoverable and persistent. Detection:
- **(a) Static CSS scan.** Scan readable `document.styleSheets` for selectors containing `:hover` whose declarations set `display`, `visibility`, `opacity` or `transform` on a *descendant* or sibling. Cross-origin sheets throw on `cssRules`; Dark Reader and Wanscher et al. re-fetch those from the service worker, which is optional here.
- **(b) Structure.** `nav li` or `[aria-haspopup]` containing a submenu (`ul`, `[role=menu]`) that currently fails `checkVisibility({visibilityProperty:true, opacityProperty:true})`.
- **(c) Missing focus path.** The CSS rule has no `:focus-within` counterpart, which means hover-only content that keyboard users cannot reach. Count it but do not fix it, because the fix would touch keyboard behaviour.

Output: `hoverMenus` and `hoverOnlyContent`.

### 2.9 Motion sources

```ts
export function motionInventory(roots: Array<Document | ShadowRoot>, vpArea: number) {
  const m = { infinite: 0, long: 0, entry: 0, transitions: 0, autoplayVideo: 0, gif: 0, smil: 0, marquee: 0, canvasLarge: 0, carousels: 0, area: 0 };
  for (const root of roots) for (const a of root.getAnimations()) {      // spec: descendants only → call per shadow root
    if (a.playState !== 'running') continue;
    if (a instanceof CSSTransition) { m.transitions++; continue; }
    const t = a.effect!.getComputedTiming();
    if (t.iterations === Infinity) m.infinite++; else if ((t.activeDuration as number) > 5000) m.long++; else m.entry++;
    const tgt = (a.effect as KeyframeEffect).target; if (tgt) m.area += visibleArea(tgt) / vpArea;
  }
  for (const v of document.querySelectorAll('video'))
    if (!v.paused && (v.autoplay || v.muted) && v.checkVisibility()) { m.autoplayVideo++; m.area += visibleArea(v) / vpArea; }
  for (const img of document.images) if (/\.gif(\?|$)/i.test(img.currentSrc) && img.width * img.height > 32 * 32) m.gif++;
  m.smil = document.querySelectorAll('svg animate, svg animateTransform, svg animateMotion').length;
  m.marquee = document.getElementsByTagName('marquee').length;
  for (const c of document.querySelectorAll('canvas')) if (c.width * c.height > 200 * 200 && c.checkVisibility()) m.canvasLarge++;
  m.carousels = document.querySelectorAll('[aria-roledescription="carousel" i], .swiper, .slick-slider, .splide, .glide, .flickity-enabled, .owl-carousel, .keen-slider, .embla').length;
  return m;
}
```

- `document.getAnimations()` returns CSS animations, CSS transitions and WAAPI animations. The spec limits it to *descendants* of the document or shadow root, so shadow roots must be queried separately. Each call triggers a style update, so sweep at most once per second while a motion op is active.
- **Animated images.** A `.gif` URL is only a heuristic, and animated WebP, APNG and AVIF are invisible to it. For certainty, fetch the bytes in the service worker and use `ImageDecoder`, where `tracks.selectedTrack.animated` and `frameCount` answer it. Cache the result per URL hash.
- **Carousels that advance on a timer.** Watch candidate elements with an attribute MutationObserver (`style`, `class`, `aria-hidden`). Changes that repeat at a steady 2–10 s interval mean the carousel advances by itself.
- **Canvas and rAF loops.** Their activity cannot be observed from the isolated world without a MAIN-world rAF probe, so report them only as `canvasLarge`.

### 2.10 Fixed and sticky overlays

These come from the main walk at no extra cost, because `cs.position` is already read there. For each fixed or sticky element with area ≥ 3% of the viewport, compute its edge (t/b/l/r/c) and area. Classify it:

| Kind | Signals |
|---|---|
| Cookie/consent | Known CMP roots: `#onetrust-banner-sdk`, `#onetrust-consent-sdk`, `#CybotCookiebotDialog`, `.qc-cmp2-container`, `#truste-consent-track`, `#didomi-host`, `#usercentrics-root` (shadow), `[id^="sp_message_container"]`, `.osano-cm-window`, `.cky-consent-container`, `#cmplz-cookiebanner-container`, `#iubenda-cs-banner`. Otherwise, fixed at top/bottom/centre, a local text match `/cookie|consent|gdpr|privacy/i` over ≤200 chars, and buttons matching `/accept|reject|agree|manage|settings/i`. The Consent-O-Matic rule set (MIT) and DuckDuckGo autoconsent (MPL-2.0) can be mined for CMP selectors. **Never auto-answer consent**; that is the user's legal decision. Offer "minimise" (dim and collapse visually) only |
| Chat widgets | Iframe or container hosts and ids: Intercom (`.intercom-lightweight-app`, `iframe[name^=intercom]`), Drift (`#drift-widget`), Zendesk (`#launcher`, `iframe[title*=Messaging]`), HubSpot (`#hubspot-messages-iframe-container`), Crisp (`.crisp-client`), Tawk, LiveChat (`#chat-widget-container`), Freshchat (`#fc_frame`), Tidio (`#tidio-chat`). Typically fixed, bottom-right, 50–400 px |
| Modal | `dialog[open]`, `[aria-modal=true]`, or fixed covering ≥50% of the viewport with a translucent backdrop |
| Header/footer bars | Sticky or fixed at top/bottom spanning ≥90% of the width. Their height as % of viewport matters under zoom |

### 2.11 Regions and main content

1. **Landmarks.** `header, nav, main, aside, footer, form[aria-label|aria-labelledby], section[aria-label|aria-labelledby], [role=banner|navigation|main|complementary|contentinfo|search|region]`.
2. **Main content.** Use `main, [role=main]` if it has ≥500 text chars. Otherwise use a single `article`. Otherwise run a live-DOM "Readability-lite" that does **not** clone the document. Readability's `parse()` mutates its input and needs `document.cloneNode(true)`, which is too costly per page.

```ts
// Constants and scoring are Mozilla Readability.js (Apache-2.0): tag base scores (_initializeNode), class weight ±25 (_getClassWeight),
// paragraph score 1 + commaCount+1 + min(floor(len/100),3), propagate to 5 ancestors with divider 1,2,level*3, final × (1 − linkDensity),
// hash links weighted 0.3 in link density. isProbablyReaderable: Σ sqrt(len − 140) over p/pre/article ≥ 20.
const UNLIKELY = /-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote/i;
const MAYBE = /and|article|body|column|content|main|mathjax|shadow/i;
const POS = /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i;
const NEG = /-ad-|hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|footer|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|widget/i;
const TAG_BASE: Record<string, number> = { DIV: 5, PRE: 3, TD: 3, BLOCKQUOTE: 3, ADDRESS: -3, OL: -3, UL: -3, DL: -3, DD: -3, DT: -3, LI: -3, FORM: -3, H1: -5, H2: -5, H3: -5, H4: -5, H5: -5, H6: -5, TH: -5 };
const classWeight = (e: Element) => { let w = 0; for (const s of [e.className?.toString?.() ?? '', e.id]) { if (!s) continue; if (NEG.test(s)) w -= 25; if (POS.test(s)) w += 25; } return w; };
const txt = (e: Element) => (e.textContent ?? '').replace(/\s+/g, ' ').trim();
function linkDensity(e: Element): number {
  const total = txt(e).length; if (!total) return 0; let l = 0;
  for (const a of e.getElementsByTagName('a')) l += txt(a).length * (/^#.+/.test(a.getAttribute('href') ?? '') ? 0.3 : 1);
  return l / total;
}
export function findMainContent(doc: Document, cap = 3000): Element | null {
  const lm = doc.querySelector('main, [role="main"]'); if (lm && txt(lm).length > 500) return lm;
  const arts = doc.querySelectorAll('article'); if (arts.length === 1 && txt(arts[0]).length > 500) return arts[0];
  const score = new Map<Element, number>(); let n = 0;
  for (const p of doc.querySelectorAll('p, pre, td, blockquote')) {
    if (++n > cap) break;
    const anc = p.parentElement; const sig = (anc?.className?.toString?.() ?? '') + ' ' + (anc?.id ?? '');
    if (UNLIKELY.test(sig) && !MAYBE.test(sig)) continue;
    const t = txt(p); if (t.length < 25) continue;
    const s = 1 + t.split(/[,，、]/).length + Math.min(Math.floor(t.length / 100), 3);
    let a: Element | null = p.parentElement;
    for (let level = 0; a && a !== doc.body && level < 5; level++, a = a.parentElement) {
      if (!score.has(a)) score.set(a, (TAG_BASE[a.tagName] ?? 0) + classWeight(a));
      score.set(a, score.get(a)! + s / (level === 0 ? 1 : level === 1 ? 2 : level * 3));
    }
  }
  let best: Element | null = null, bestS = 0;
  for (const [e, s] of score) { const f = s * (1 - linkDensity(e)); if (f > bestS) { bestS = f; best = e; } }
  return best;
}
```

Cost: `textContent` does not force layout, and linkDensity runs only on candidates. Expect about 2–8 ms on article pages (est.).

3. **Visual blocks (a light VIPS).** VIPS (Cai et al., MSR-TR-2003-79) segments top-down using visual cues: background changes, separators and font changes. The Webis-WebSeg-20 benchmark (Kiesel et al., 2020; 8,490 pages, 42,450 annotations) found that tuned VIPS is still the strongest classic method and that purely visual methods are competitive. The simplified version below reuses data already collected in the walk:
   - Start from `body` and recurse into a child only if its area is ≥1% of the document and it is a block-level box (`display` block, flex or grid; not inline).
   - Split a node into its children when they differ in background colour from the node, have borders or shadows, or are separated by vertical gaps ≥16 px. Stop at depth 6, at area <1%, or when the node is text-dominated (text density above a threshold).
   - Per block, output: bbox (% of document), link density, text density (chars per 1,000 px²), number of controls, fixed/sticky flag, landmark ancestry, and the role guess from §2.12. Keep ≤24 blocks, merging small siblings.
4. **Chrome Reading Mode** does main-content extraction on the *accessibility tree* (`AXTreeDistiller` in the renderer) with an on-device ML model, Screen2x, in a utility process. It renders the result in a side panel and never modifies the page. The lesson: a separate reading surface avoids verification risk entirely. It is a candidate later feature for the cognitive-load group.

### 2.12 Ad, promo, recommendation and other heuristics

| Kind | Signals (combine; each adds to a score) |
|---|---|
| Ad | `ins.adsbygoogle`, `[data-ad-slot]`, `[data-ad-unit]`, `div[id^="div-gpt-ad"]`, `[id*="google_ads"]`. Iframes whose host is in a short list (doubleclick.net, googlesyndication.com, adnxs.com, amazon-adsystem.com, criteo.*, taboola.com, outbrain.com, adsafeprotected.com, moatads.com). **IAB sizes** within ±2 px: 300×250, 336×280, 728×90, 970×90, 970×250, 160×600, 300×600, 120×600, 320×50, 320×100, 468×60, 250×250, 200×200. Class or id matching Readability's `NEG` plus `/\b(ad|ads|advert|adslot|ad-slot|dfp|sponsor)\b/i`. A short local label nearby (≤20 chars) matching `/^(advertisement|sponsored|ad|promoted|anzeige|publicidad|annonce)$/i` |
| Recommendations | `.trc_related_container`, `.OUTBRAIN`, `[data-widget-id]` (Taboola/Outbrain). A heading matching `/recommended|you may also like|related|more from|trending|popular/i` (local only). High link density with ≥4 repeated sibling card structures sharing the same tag path and class signature |
| Promo | Fixed or sticky and not a cookie or chat widget; newsletter forms (`input[type=email]` + `/subscribe|newsletter/i`); countdowns; "sale" banners |
| Comments | `#comments, .comments, #disqus_thread, [id*=comment]` plus repeated author/time structures |

**Licensing.** EasyList is dual-licensed GPLv3 / CC BY-SA 3.0. Shipping a derived subset of its cosmetic selectors triggers share-alike or copyleft obligations for that list. Hand-write about 50 generic signals, or ship the list as a separately licensed data file.

**Invariant conflict.** Ad blockers hide with `display:none`, which removes content from the accessibility tree and focus order. WebAble's invariants forbid that, so the only ad or clutter op is **dim** (§3.4.9).

### 2.13 Forms (never read values)

Record: form count, field types histogram (`input.type`, `select`, `textarea`, `[contenteditable]`), required count, unlabeled count (no `labels`, `aria-label` or `aria-labelledby`, and a placeholder only), and `autocomplete` coverage. Detect CAPTCHAs (`iframe[src*="recaptcha"|"hcaptcha"|"challenges.cloudflare.com"]`), multi-step signals (`[aria-current=step]`, progress bars, "Step n of m") and errors (`[aria-invalid=true]`, `[role=alert]`). The presence of a `password` field marks a *login* page. For payment fields (`autocomplete^=cc-`), send nothing beyond counts.

### 2.14 Page-type signals (local classifier, output probabilities)

| Type | Signals |
|---|---|
| Article | JSON-LD `@type` (`Article`/`NewsArticle`/`BlogPosting`), `og:type=article`, `isProbablyReaderable`, main-text share, headings |
| Feed | `[role=feed]`, repeated cards, infinite-scroll sentinels |
| Search | `input[type=search]`/`[role=search]` plus repeated result blocks |
| Product | JSON-LD `Product`, `itemprop=price` |
| App | Controls-to-text ratio |
| Video | Large `video` in main |
| Map | Map containers |
| Checkout / login | Form signals from §2.13 |

These are structural signals only.

### 2.15 Privacy rules for extraction

- **Nothing textual leaves the device** except optional ≤24-char control labels. Default to none, and send roles and icon-only flags instead. Local text reads (classification, `measureText`) stay in memory.
- **No URL or title.** For per-site learning, compute `siteKey = HMAC-SHA256(installSecret, eTLD+1)` truncated to 64 bits, with `installSecret` held in `chrome.storage.local` and never synced. A component key is `HMAC(installSecret, siteKey | landmark | tagPathShape | classTokens)`, where class tokens have digits and hash-like tokens (≥6 alphanumeric characters with mixed case) stripped. Unsalted SHA over domains can be reversed with a list of the top 10 million domains.
- **Exclusions.** Skip extraction entirely on excluded origins (the user's list, plus defaults such as banking, health portals and `chrome://`). On pages with password or payment fields, send counts only.
- **No raw DOM, screenshots or pixels** are persisted or transmitted. `captureVisibleTab` samples are processed and discarded within one task.

---

## 3. Adaptation primitives

### 3.1 How existing tools do it (primary-source notes)

| Tool | Mechanism | Lessons for WebAble |
|---|---|---|
| **Dark Reader** (`src/inject/dynamic-theme/`) | **Dynamic mode** parses every stylesheet (fetching cross-origin sheets through the background, `network.ts`) and generates override rules. `modify-colors.ts` has `modifyBackgroundColor`, `modifyForegroundColor`, `modifyBorderColor` and `modifyGradientColor`, working in HSL. Dark-theme poles use `MAX_BG_LIGHTNESS = 0.4` and `MIN_FG_LIGHTNESS = 0.55` with linear lightness scaling between poles, plus a per-colour cache. Inline styles are handled with `data-darkreader-inline-*` attributes plus `--darkreader-inline-*` custom properties (`inline-style.ts`). Adopted sheets: `adopted-style-manger.ts` inserts an override sheet right after each source sheet (`splice(sheetIndex + 1, 0, override)`), tracked in a `WeakMap`/`WeakSet`, and polls with rAF when the proxy is unavailable. A **MAIN-world proxy** (`stylesheet-proxy.ts`, injected at document_start via `mv3-proxy.ts`) patches `CSSStyleSheet.insertRule/deleteRule/addRule/removeRule/replace/replaceSync`, `Element.attachShadow` and `CustomElementRegistry.define`, and signals over DOM CustomEvents (`__darkreader__updateSheet`, `__darkreader__adoptedStyleSheetChange`, `__darkreader__shadowDomAttaching`). Shadow roots are observed in `watch/style-position.ts`; closed roots are reached with `chrome.dom.openOrClosedShadowRoot`. Mutation handling (`src/inject/utils/dom.ts`): `HUGE_MUTATIONS_COUNT = 1000` switches to a full rescan, otherwise it computes add/move/delete sets with nested duplicates removed; rAF-coalesced `throttle` (`src/utils/throttle.ts`); style-position watchdog with `MAX_ATTEMPTS_COUNT = 10` per 10 s, then backs off for 2 s. **Image analysis** (`image.ts`) is described in §2.4. | Full-page re-theming is expensive and has a long tail of breakage, which is why Dark Reader carries a `fixes.ts` layer. WebAble should adjust only failing text pairs. Reuse the huge-mutation fallback, the watchdog with back-off, and the `WeakMap` override tracking |
| **Stylus** (`src/content/style-injector.js`) | Appends `<style class="stylus">` elements to `document.documentElement`, *after* `<body>`, so they win cascade order among equal-specificity author rules. A `RootObserver` MutationObserver restores the order when the page inserts `<link>` or `<style>` after them. A `RewriteObserver` detects `documentElement` being rewritten. An optional `document.adoptedStyleSheets` mode is used for strict-CSP Firefox pages. It listens for `securitypolicyviolation` because `url()` resources (img, font) in injected CSS can be blocked by the page's CSP. Style ids are randomised to reduce fingerprinting | Place injected sheets last. Watch for removal and reordering. Page CSP can still block `url()` resources in our CSS, so avoid `content:url(blob:)` tricks. Do not expose identifiable ids |
| **Chrome Reading Mode** | Accessibility-tree distillation (`AXTreeDistiller`) plus the on-device Screen2x model, rendered in a side panel | A non-destructive surface. It needs no page verification |
| **Helperbird** (closed source) | Reading ruler, overlays, fonts, spacing and similar features. Implementation not inspectable | Product benchmark only |
| **Wanscher et al. 2026** (arXiv 2608.24913) | The LLM writes *additive CSS* from a condensed stylesheet. The condensation filters then ranks rules by "visual reach" into about 20k chars. The CSS is injected via **adopted style sheets** for one-step undo and cached per URL. The verified variant runs an audit, inject, verify loop that accepts a change only if violations strictly decrease and no new violation type appears, retrying up to 3 times. The auditor combines axe `color-contrast` and `link-in-text-block` with 5 custom probes: a cascade-aware outline-removal scan, a target-size check honouring the inline exception, and reflow tested by resizing the viewport to 320 px. Results: detected 57/57 seeded violations with 0 false positives on 12 clean pages, rejected 126/126 harmful candidates, and fully repaired 30/30 seeded pages. Unverified runs across 6 open 7–14B models: 24 improvements vs 20 regressions, with no significant effect | Adopt the acceptance rule (target metric improves **and** no new failure class) and perceptual grounding. The model should never pick colours or selectors |

### 3.2 Engine core: op registry, style layer, marking and undo

```ts
// One constructed sheet per tree scope (document + each adapted shadow root). Rule blocks keyed by op instance.
class StyleLayer {
  readonly sheet = new CSSStyleSheet();
  private blocks = new Map<string, string>();
  constructor(private scope: Document | ShadowRoot) {}
  attach() { const a = this.scope.adoptedStyleSheets; if (!a.includes(this.sheet)) a.push(this.sheet); } // ObservableArray (Chrome 99+)
  set(key: string, css: string) { this.blocks.set(key, css); this.flush(); }
  drop(key: string) { if (this.blocks.delete(key)) this.flush(); }
  private flush() { this.sheet.replaceSync([...this.blocks.values()].join('\n')); } // few KB → sub-ms
  watchdog() { /* 1 Hz while active or on MO childList of <head>: re-attach if the page replaced adoptedStyleSheets; back off after 10 re-attaches/10 s */ }
}

// Single marking attribute with tokens → one attribute per element, selectors use [data-wa~="tok"].
const ATTR = 'data-wa';
export function mark(el: Element, tok: string) { const v = el.getAttribute(ATTR); if (!v?.split(' ').includes(tok)) el.setAttribute(ATTR, v ? `${v} ${tok}` : tok); }
export function unmarkAll(scope: Document | ShadowRoot, tok: string) {
  for (const el of scope.querySelectorAll(`[${ATTR}~="${tok}"]`)) {
    const rest = el.getAttribute(ATTR)!.split(' ').filter(t => t !== tok);
    rest.length ? el.setAttribute(ATTR, rest.join(' ')) : el.removeAttribute(ATTR);
  }
}

// Inline state we must touch (rare: media.pause, img overlays) → originals in WeakMap for exact restoration.
const originals = new WeakMap<Element, Record<string, string | boolean>>();

export interface OpDef<P> {
  id: string;                                   // 'text.floor', 'target.expand', ...
  schema: import('zod').ZodType<P>;             // bounds; model output is parsed then clamped
  risk: 'paint' | 'layout' | 'behavior';        // verification depth + bisect order (layout first)
  plan(p: P, scope: Element[], f: Measurements): { css: string; marks: Array<[Element, string]>; imperative?: () => () => void };
}
export interface Applied { key: string; def: OpDef<any>; tokens: string[]; undoImperative?: () => void }
export function undo(a: Applied, layers: StyleLayer[], scopes: Array<Document | ShadowRoot>) {
  layers.forEach(l => l.drop(a.key)); a.tokens.forEach(t => scopes.forEach(s => unmarkAll(s, t))); a.undoImperative?.();
}
```

**Injection channels compared**

| Channel | Timing | Cascade | Page can remove? | Shadow DOM | Notes |
|---|---|---|---|---|---|
| `registerContentScripts({css})` | Before DOM is built | Author | No (not in DOM) | No | Static reviewed files only, which makes it ideal for profile-level ops. Persists across sessions |
| `scripting.insertCSS({origin:'USER'})` | Any time, from the SW | **User origin**: `!important` beats author `!important` | No | Does not reach shadow trees [V] | Removal needs an exact match of css + origin. Best for enforcement rules such as the focus ring. Cannot be per-op dynamic without churn |
| `document.adoptedStyleSheets` + constructed sheet | Any time | Author, ordered after `<style>`/`<link>` sheets | Only by reassigning the array, which the watchdog catches | Per root | Used by Wanscher et al. and Dark Reader. Not visible in DOM snapshots |
| `<style>` appended after `<body>` (Stylus) | Any time | Author, last in DOM order | Yes: frameworks and head managers can remove it, so it needs a watchdog | Must be inserted per root | Fallback |
| Inline `style` | Any time | Highest author (with `!important`) | Framework re-render overwrites it | n/a | Avoid |

**Specificity and layers.** Page `!important` rules inside `@layer` beat unlayered `!important` rules, so an author-origin override can lose. The text-spacing bookmarklet solves this with `*:not(#a #b #c #d #e #f #g #h #i)`, a nine-id specificity hack. Use either that pattern or the USER origin for rules that must win.

### 3.3 Scheduling writes

Apply all planned ops in **one write phase**: build every CSS block, then set every mark, then call `replaceSync` once per layer. A single style and layout pass follows. After that comes one layout shift, which scroll anchoring handles (§4). Never interleave the per-op measurement with writes.

### 3.4 Primitive catalogue

#### 3.4.1 Text size floor (low vision)

Prefer the mechanisms in this order:

1. **Per-origin browser zoom.** `chrome.tabs.setZoomSettings({mode:'automatic', scope:'per-origin'})` then `setZoom(tabId, f)`. Responsive layouts reflow correctly, and this is the path that WCAG 1.4.4 and 1.4.10 make sites support. It scales everything, including images, which is usually desired for low vision.
2. **`chrome.fontSettings.setMinimumFontSize({pixelSize})`** (`fontSettings` permission). This is the engine-level minimum and applies browser-wide, respecting `levelOfControl`. It is applied at the font-size computation and avoids per-element DOM work, but it is global, not per-site.
3. **Per-element floor**, for outliers such as tiny captions and legal text:
   - Mark only leaf text containers whose computed size is below the floor. Skip icon fonts, `svg`, `code/pre` (unless floored separately), form controls with fixed heights (unless the op allows it), and elements inside `[data-wa~="nofloor"]`.
   - Use bucketed tokens to keep the CSS small: `[data-wa~="fs16"]{font-size:16px!important}`, `fs18`, `fs20` and so on.
   - Fix line-height at the same time. When the computed `line-height` is in px and below 1.2× the new size, add `[data-wa~="lhn"]{line-height:1.35!important}`. Otherwise lines overlap.
   - Descendants that use `em` or `%` grow relative to the floored parent. Floored descendants are pinned by their own token. Accept the growth, which only goes up.
   - Risks: fixed-height containers with `overflow:hidden` or `-webkit-line-clamp`, absolutely positioned labels, and nav bars wrapping. The verifier catches them (§4). An optional companion op `unclip` sets `[data-wa~="unclip"]{height:auto!important;max-height:none!important}` on the clipped ancestor, but only if it is not a scroll container or carousel and only if the verifier then passes.

#### 3.4.2 Text spacing (low vision, attention)

WCAG 1.4.12 values are line-height ≥1.5×, paragraph spacing ≥2×, letter spacing ≥0.12×, and word spacing ≥0.16× the font size. Steve Faulkner's bookmarklet applies them to `*` with `!important`, plus `p{margin-bottom:2em!important}`, plus the `:not(#a…#i)` specificity booster. **Do not apply them globally.** Letter spacing on buttons, tabs and nav items causes overflow and clipping. Scope them to text blocks in main and in regions with text density above a threshold:

```css
:where([data-wa~="tsp"]) :is(p, li, dd, dt, blockquote, td, th, figcaption, h1, h2, h3, h4, h5, h6):not(:where(pre, code, kbd, samp, [class*=icon], [data-wa~="iconfont"])) {
  line-height: var(--wa-lh, 1.5) !important; letter-spacing: var(--wa-ls, 0.12em) !important; word-spacing: var(--wa-ws, 0.16em) !important;
}
:where([data-wa~="tsp"]) p { margin-block-end: var(--wa-ps, 2em) !important; }
```

Here `tsp` marks the region root. The custom properties come from the profile, which may use smaller personal values than WCAG's maxima.

#### 3.4.3 Contrast enhancement

| Approach | Pros | Cons |
|---|---|---|
| Global `filter: contrast(k)` on `html` | 1 rule, cheap; a filter on the *root* element does not create a containing block for fixed descendants (Filter Effects spec exception) | Alters images and brand colours; may push dark greys to black; can't reach a target ratio per pair; GPU compositing cost for the whole page |
| Global theme (Dark Reader-style) | Solves everything at once | Heavy, with a long breakage tail. Out of scope for v1 |
| **Per-pair colour solving (recommended)** | Changes only failing text; deterministic; verifiable | Needs the effective-background computation |
| **Backplate** for text over images or gradients | Robust when the background is unknown | Visible design change; apply to inline text only |

**Solver.** For each failing pair (fg, bg) with target ratio T, move the foreground's OKLCH lightness away from the background's lightness, keeping hue and reducing chroma if needed. Binary-search L in [0,1] for the smallest change that reaches T. If it cannot be reached, go to black or white. Bucket the results to ≤16 colours per page.

```ts
function solveFg(fg: RGBA, bg: RGBA, target: number): RGBA {
  if (ratio(fg, bg) >= target) return fg;
  const [L, C, H] = rgbToOklch(fg); const darker = lum(bg) > 0.18; // move away from bg
  let lo = darker ? 0 : L, hi = darker ? L : 1, best = darker ? [0, 0, 0, 1] as RGBA : [255, 255, 255, 1] as RGBA;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2, c = oklchToRgbClipped(mid, C, H);
    if (ratio(c, bg) >= target) { best = c; darker ? (lo = mid) : (hi = mid); } else { darker ? (hi = mid) : (lo = mid); }
  }
  return best;
}
// CSS: [data-wa~="fg3"]{color:rgb(18 32 64)!important; -webkit-text-fill-color:currentColor!important}
// Backplate: [data-wa~="bp"]{background-color:rgb(255 255 255 / .88)!important; box-decoration-break:clone; -webkit-box-decoration-break:clone}
```

Also consider non-text contrast (a 3:1 boundary for inputs): `[data-wa~="ibd"]{box-shadow: inset 0 0 0 1px <solved>!important}`, which is paint-only.

#### 3.4.4 Line-length limit (attention, low vision)

Apply to the main-content region only: `[data-wa~="ll"] :is(p, li, blockquote, dd){max-inline-size:var(--wa-cpl,68ch)!important}`. Skip elements that are flex or grid items or floats (checked at plan time). `1ch` is the width of "0", slightly wider than the average glyph, so 68ch gives roughly 72–78 characters per line. Keep the start alignment: centring moves figures and breaks alignment with headings. Verify horizontal and float regressions.

#### 3.4.5 Hit-area expansion (fine motor), with no layout movement

```css
/* Pad bucket chosen per element = min(profilePad, floor(nearestGap/2) − 1) so expanded areas never overlap neighbours. */
[data-wa~="hitpos"] { position: relative !important; }                                      /* only when computed position was static AND safe */
[data-wa~="hit4"]::after, [data-wa~="hit8"]::after, [data-wa~="hit12"]::after { content: "" !important; position: absolute !important; pointer-events: auto !important; background: none !important; }
[data-wa~="hit4"]::after { inset: -4px !important; } [data-wa~="hit8"]::after { inset: -8px !important; } [data-wa~="hit12"]::after { inset: -12px !important; }
```

Plan-time guards:
- Replaced and void elements (`input`, `img`, `select`, `textarea`, `video`, `iframe`) have no `::after`. Expand the associated `<label>` instead: `input.labels[0]`, or the wrapping label. For checkboxes and radios with no label, `transform: scale(1.4)` enlarges the box and its hit area without reflow, but only when the neighbours' clearance allows.
- Require `getComputedStyle(el,'::after').content === 'none'`. Never override a site's pseudo-element, which is often an icon.
- Adding `position:relative` makes the element the containing block for absolutely positioned descendants, which could move dropdowns inside nav links. Only add `hitpos` if the subtree has no `position:absolute|fixed` descendants (small subtrees, so the check is cheap). Already positioned elements need no change.
- Ancestors with `overflow:hidden` clip the pseudo hit area, because hit testing respects clipping. Later-painted positioned siblings can cover it. The verifier's ring probe (`elementFromPoint` at the 4 edge midpoints of the expanded rect must return the target or a descendant) confirms the gain. Drop the token for elements where it fails.
- Clicking the pseudo-element dispatches to the element itself, so the event target and `isTrusted` are unchanged.

Research context: Enhanced Area Cursors (Findlater et al., UIST'10), Bubble Cursor (Grossman & Balakrishnan, CHI'05), and SUPPLE's ability-based UI generation (Gajos, Wobbrock & Weld, CHI'08) all show that enlarging *effective* target width helps motor-impaired users. Expanding the DOM hit area is the deterministic web analogue of those methods.

#### 3.4.6 Spacing between adjacent controls

Margins reflow layout. The safe order is:
1. Hit expansion split at the half-gap (above), which separates hit regions without moving anything.
2. For flex or grid toolbars only, raise the gap: `[data-wa~="gap8"]{column-gap:max(8px,var(--x))!important;row-gap:…}`. `max()` with the existing value needs the plan-time measured value, so write the bucket directly. Verify for overflow and wrapping.
3. Never change margins on inline links.

#### 3.4.7 Focus ring (never alters focus order)

```css
:root[data-wa-focus] :focus-visible {
  outline: 3px solid var(--wa-ring-1, #111) !important; outline-offset: 2px !important;
  box-shadow: 0 0 0 5px var(--wa-ring-2, #ffd400) !important;   /* two-tone ⇒ ≥3:1 against any background */
}
```

Inject into each adapted shadow root as well. Overflow-clipped outlines fall back to `outline-offset:-3px` via a verifier-driven token. `:focus-visible` is a *selector* and does not change any focus behaviour. This is a good candidate for `insertCSS({origin:'USER'})` so page `outline:none !important` cannot win.

#### 3.4.8 Motion reduction

```ts
const RESET_CSS = `[data-wa-motion] *, [data-wa-motion] *::before, [data-wa-motion] *::after {
  animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; animation-delay: 0s !important;
  transition-duration: 0.001ms !important; transition-delay: 0s !important; scroll-behavior: auto !important; }`;
const pausedAnims = new Set<Animation>(), pausedMedia = new Set<HTMLMediaElement>();
export function reduceMotion(roots: Array<Document | ShadowRoot>): () => void {
  document.documentElement.setAttribute('data-wa-motion', '');  // CSS: jump to end state, animationend still fires → page state machines proceed
  for (const r of roots) for (const a of r.getAnimations()) {   // WAAPI animations are unaffected by CSS
    if (a instanceof CSSAnimation || a instanceof CSSTransition || a.playState !== 'running') continue;
    const t = a.effect?.getComputedTiming(); if (!t) continue;
    if (t.iterations === Infinity) { a.pause(); pausedAnims.add(a); } else { try { a.finish(); } catch { a.pause(); pausedAnims.add(a); } }
  }
  for (const v of document.querySelectorAll('video')) if (!v.paused && (v.autoplay || v.muted)) { v.pause(); pausedMedia.add(v); }
  const onPlay = (e: Event) => { const v = e.target as HTMLMediaElement; if (pausedMedia.has(v) && !recentUserIntent(v)) v.pause(); };
  document.addEventListener('play', onPlay, true);              // 'play' doesn't bubble; capture at document sees it
  document.querySelectorAll<SVGSVGElement>('svg').forEach(s => s.animationsPaused() || s.pauseAnimations());
  for (const mq of document.getElementsByTagName('marquee')) (mq as any).stop?.();
  return () => { document.documentElement.removeAttribute('data-wa-motion'); pausedAnims.forEach(a => a.play()); pausedMedia.forEach(v => void v.play().catch(() => {}));
                 document.removeEventListener('play', onPlay, true); pausedAnims.clear(); pausedMedia.clear(); };
}
```

- **Why not `animation-play-state: paused`.** Pausing an entry animation at t=0, such as a fade in from `opacity:0`, can leave content **invisible**. The duration-reset approach jumps to the end state instead. Call `finish()` on finite WAAPI animations for the same reason.
- **Tracking user intent.** `recentUserIntent` checks for a pointerdown or keydown within the element's box or controls in the last 1 s. It passively observes and does not alter keyboard events.
- **GIF freeze.** Draw the current frame with `drawImage(img)` into a `<canvas>` in our shadow-root overlay layer, positioned over the image and tracked with ResizeObserver and scroll. A cross-origin image taints the canvas, but tainted canvases still display. Set `opacity:0` on the image through a token, which keeps it in the accessibility tree with its alt text. Do **not** use `visibility:hidden`, which drops it from the accessibility tree. Do not use `content:url(blob:)` or swap `src`: page CSP `img-src` can block `blob:`/`data:` (the Stylus CSP listener exists because of this), and `srcset`/`<picture>` complicate a swap.
- **Carousels.** Click the site's own pause control when one exists (`button` inside the carousel with an accessible name matching `/pause|stop/i`; WCAG 2.2.2 requires one). Otherwise offer dimming or "cover" only.
- **Canvas.** Offer "cover" only in v1.
- **Limit of the CSS reset.** It cannot emulate `prefers-reduced-motion` for the page's JavaScript. Overriding `matchMedia` requires MAIN-world patching or `chrome.debugger` emulation (which shows an infobar), so it is out of scope.

#### 3.4.9 Dimming distracting regions (attention); never `inert`, never hide

```css
[data-wa~="dim"] { opacity: var(--wa-dim, .35) !important; transition: opacity .15s linear !important; }
[data-wa~="dim"]:is(:hover, :focus-within) { opacity: 1 !important; }            /* keyboard users see where focus went */
[data-wa~="dimg"] { filter: grayscale(1) !important; }                            /* only if subtree has no fixed/sticky descendants */
```

- `opacity < 1` creates a stacking context, which can reorder z-index of descendants relative to outside elements. This is rarely visible but the verifier's obscured-control probe covers it.
- `filter` creates a containing block for fixed descendants (except on the root element), which is why `dimg` is guarded.
- `inert`, `display:none`, `visibility:hidden` and `aria-hidden` are all forbidden by the invariants.

#### 3.4.10 Focus-mode spotlight and reading ruler (overlay, zero page mutation)

```ts
export function mountOverlay(): { root: ShadowRoot; host: HTMLElement } {
  const host = document.createElement('webable-ui');           // custom tag → page class selectors don't match; excluded from our walks
  host.setAttribute('aria-hidden', 'true');                    // our own decorative node, not page ARIA
  host.popover = 'manual';                                     // top layer: above any page z-index (Chrome 114+)
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>:host{all:initial!important;position:fixed!important;inset:0!important;margin:0!important;border:0!important;padding:0!important;background:none!important;pointer-events:none!important;overflow:visible!important}
    .hole{position:fixed;border-radius:6px;box-shadow:0 0 0 200vmax rgb(0 0 0 / var(--dim,.55));transition:all .12s}
    .ruler{position:fixed;left:0;right:0;height:var(--rh,2.2em);box-shadow:0 0 0 200vmax rgb(0 0 0 / .45)}</style>`;
  document.documentElement.append(host); host.showPopover();
  return { root, host };
}
// Spotlight: .hole box = main-content rect (ResizeObserver + passive scroll listener, rAF-throttled). Ruler: follows pointer Y (passive pointermove, rAF).
```

`pointer-events:none` means everything stays clickable, which satisfies offer-never-impose. WXT's `createShadowRootUi` gives the same isolation.

#### 3.4.11 Click stabilisation (fine motor): the Steady Clicks equivalent

Steady Clicks (Trewin, Keates & Moffatt, ASSETS'06) freezes the cursor during a click, suppresses overlapping button presses, and suppresses clicks made while moving fast. With 11 motor-impaired users it produced significantly fewer attempts, and faster task times for the 5 users with the highest slip rates. Web implementation:

```ts
const ACTIVATABLE = 'a[href],button,summary,label,select,input[type=checkbox],input[type=radio],input[type=submit],input[type=button],input[type=reset],[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch]';
const HANDS_OFF = '[draggable="true"],[role=slider],input[type=range],input:not([type]),input[type=text],input[type=search],input[type=email],textarea,[contenteditable=""],[contenteditable="true"],canvas,video,audio,iframe,.leaflet-container,.gm-style';
export function installClickStabilizer(p: { dragPx: number; dragMs: number; abandonPx: number }) {
  let press: { id: number; el: Element; x: number; y: number; t: number } | null = null;
  const down = (e: PointerEvent) => {
    if ((e.pointerType !== 'mouse' && e.pointerType !== 'pen') || e.button !== 0 || !e.isPrimary) return; // touch already has implicit capture
    const path = e.composedPath().filter((n): n is Element => n instanceof Element);
    if (path.some(n => n.matches(HANDS_OFF))) return;
    const el = path.find(n => n.matches(ACTIVATABLE)); if (!el) return;
    try { el.setPointerCapture(e.pointerId); press = { id: e.pointerId, el, x: e.clientX, y: e.clientY, t: e.timeStamp }; } catch { /* inactive pointer */ }
    // Registered in window capture phase → runs before page handlers; a page handler that calls setPointerCapture itself overrides ours (desired).
  };
  const move = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    const d = Math.hypot(e.clientX - press.x, e.clientY - press.y), dt = e.timeStamp - press.t;
    if ((d > p.dragPx && dt > p.dragMs) || d > p.abandonPx) {   // deliberate drag or deliberate cancel → hand the pointer back
      if (press.el.hasPointerCapture(press.id)) press.el.releasePointerCapture(press.id);
      press = null;
    }
  };
  const end = () => { press = null; };
  const selStart = (e: Event) => { if (press) e.preventDefault(); };  // no accidental text selection during a stabilized press
  addEventListener('pointerdown', down, true); addEventListener('pointermove', move, true);
  addEventListener('pointerup', end, true); addEventListener('pointercancel', end, true); document.addEventListener('selectstart', selStart, true);
  return () => { removeEventListener('pointerdown', down, true); removeEventListener('pointermove', move, true); removeEventListener('pointerup', end, true); removeEventListener('pointercancel', end, true); document.removeEventListener('selectstart', selStart, true); };
}
```

- **Why this works.** Chrome 135 ships the Pointer Events rule that when the pointer is captured during `pointerup`, "the `click` event will be dispatched to the captured target instead of the nearest common ancestor". A slip off the button between down and up therefore still produces a **trusted** click on the button, including link navigation and checkbox toggling. Gate the feature on Chrome ≥135.
- **Calibration.** `dragPx`, `dragMs` and `abandonPx` come from calibration: slip distances and press durations measured on the user's own clicks. Steady Clicks' freeze windows are in the same few-hundred-ms range as the brief's 200–400 ms.
- **Optional, higher-risk sub-features** (offer, never impose):
  - *Double-activation suppression.* A window-capture `click` listener calls `stopImmediatePropagation()` and `preventDefault()` for a second click on the same target within N ms, only when `e.detail>0` and the pointer type is mouse or pen. Keyboard-generated clicks have `detail===0`, so keyboard handling is untouched. Sites that rely on `dblclick` break, so skip when `[ondblclick]` or `interaction.dblclick` is set.
  - *High-velocity click suppression* (Steady Clicks' third component). Track pointer speed over the 50 ms before `pointerdown`.
- **Side effects of capture.** Hover effects on other elements are suppressed during a press, and `pointerleave` is delayed. Menus that use press-drag-release are excluded by the `HANDS_OFF` list.

#### 3.4.12 Hover persistence (fine motor, attention)

This is CSS only and needs no event interception. Transitions use the **after-change** style, so a delay placed only on the hidden state keeps submenus open briefly after the pointer leaves, while opening stays instant. `transition-behavior: allow-discrete` (Chrome 117+) makes `display` transitionable.

```css
[data-wa~="hoverkeep"] { transition: display 0s allow-discrete var(--wa-hk, 450ms), visibility 0s var(--wa-hk, 450ms), opacity 0s var(--wa-hk, 450ms) !important; }
:is(:hover, :focus-within) > [data-wa~="hoverkeep"], [data-wa~="hoverkeep"]:is(:hover, :focus-within) { transition-delay: 0s !important; }
```

`hoverkeep` marks submenu elements found in §2.8. If the page's trigger is not the direct parent, mark the trigger container and use `:has(:hover)`. For menus that JavaScript hides via inline style or class changes, the transition still applies because the computed-style change is what matters [V: verify per menu library]. Hover-to-open delays exist as well, but most sites open instantly already.

#### 3.4.13 Drag alternatives

- **v1: surface, do not synthesise.** For dnd-kit and react-beautiful-dnd, which have keyboard sensors, show an overlay hint derived from the library's own `aria-describedby` instructions, read locally ("Press Space to pick up…"). For `input[type=range]`, show large −/+ steppers in the overlay. They call the native value setter, `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el, v)`, and then dispatch `input` and `change` events. From the isolated world this bypasses React's value tracker, so React sees the change [V].
- **v2 (experimental; explicit per-use confirmation).** "Pick and place" for HTML5 DnD: synthesise `dragstart`, `dragenter`, `dragover` and `drop` with `new DataTransfer()`. Many handlers ignore `isTrusted`, but drops can be destructive (moving an item to trash), so never automate it. WCAG 2.5.7 (AA, 2.2) requires a single-pointer alternative, which many sites lack.

#### 3.4.14 Sticky and fixed de-pinning (low vision under zoom, attention)

`[data-wa~="unpin"]{position:static!important}` for sticky headers or footers above X% of the viewport height. The element stays in the accessibility tree and focus order and scrolls away with the page. The reflow is equal to its height, so capture the scroll anchor. Do not unpin cookie or modal overlays, because that breaks their layout. Dim or minimise them instead.

### 3.5 Mutations and SPA navigation

```ts
class MutationScheduler {
  private pending = new Set<Element>(); private huge = false; private first = 0; private timer = 0;
  private flushTimes: number[] = [];
  private mo = new MutationObserver(recs => this.onRecs(recs));
  constructor(private run: (roots: Element[] | 'all') => Promise<void>, private o = { debounce: 150, maxWait: 1000, huge: 1000 }) {}
  observe(root: Document | ShadowRoot) { this.mo.observe(root, { childList: true, subtree: true }); } // not attributes: our own marks don't feed back
  private onRecs(recs: MutationRecord[]) {
    let added = 0;
    for (const r of recs) for (const n of r.addedNodes) {
      if (n.nodeType !== 1 || (n as Element).localName === 'webable-ui') continue;
      if (++added > this.o.huge) { this.huge = true; break; }           // Dark Reader HUGE_MUTATIONS_COUNT pattern
      this.pending.add(n as Element);
    }
    const now = performance.now(); this.first ||= now;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), Math.max(0, Math.min(this.o.debounce, this.o.maxWait - (now - this.first))));
  }
  private async flush() {
    const roots: Element[] | 'all' = this.huge ? 'all' : [...this.pending].filter(e => e.isConnected && ![...this.pending].some(p => p !== e && p.contains(e)));
    this.pending.clear(); this.huge = false; this.first = 0;
    const now = performance.now(); this.flushTimes = this.flushTimes.filter(t => now - t < 10_000); this.flushTimes.push(now);
    if (this.flushTimes.length > 20) this.o.debounce = Math.min(this.o.debounce * 2, 2000); // tickers/feeds: back off
    await this.run(roots);                                             // incremental: extract + mark + scoped verify for these subtrees only
  }
}
```

- **Incremental processing.** Ops keep their plan functions, so new subtrees are classified and marked with the same tokens. The CSS already exists, which means no new rules are added. The scoped verify covers only those subtrees.
- **SPA route changes.** Listen to `navigation.addEventListener('currententrychange', …)`; per the Navigation API explainer, `navigate` also covers `history.pushState`/`replaceState`. Also listen to `popstate`. As a fallback, the service worker's `chrome.webNavigation.onHistoryStateUpdated` sends a message to the tab. Whether Navigation API events reach isolated-world listeners is [V]. On a route change, wait until the DOM has been quiet for 300–800 ms, re-extract, keep site-scoped ops, re-plan page-scoped ops, and verify.
- **Page removing our layer.** The style-layer watchdog re-attaches it, with back-off modelled on Dark Reader's `watchForNodePosition` (10 attempts per 10 s, then a 2 s pause).

---

## 4. Verification

### 4.1 Pipeline and timing

```ts
const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
async function settle(maxMs = 400) {
  await frame(); await frame();                                  // 1st rAF runs before the frame that renders our change; 2nd = after it
  if (document.fonts.status !== 'loaded') await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, maxMs))]);
}
export async function applyVerified(batch: Applied[], ctx: Ctx) {
  const base = snapshot(ctx.probeSet);                            // read-only; ≤10 ms
  const anchor = readingAnchor();                                 // first text block intersecting top 25% of viewport + its top
  writeAll(batch);                                                // one write phase
  await settle();
  restoreAnchor(anchor);                                          // scrollBy(delta) if |delta|>2px (overflow-anchor usually handles it)
  const fails = await diff(base, ctx.probeSet, { sliceMs: 5, totalMs: 30 });
  for (const op of attribute(fails, batch)) undo(op, ctx.layers, ctx.scopes);       // per-op rollback
  if (fails.unattributed.length) await bisect(batch.filter(o => o.def.risk === 'layout'), ctx);
  report(batch, fails);                                           // local outcome log → learning
}
```

- **Probe set.** Choose it at plan time: every marked element in the viewport, its nearest clipping ancestor, all interactive elements within the viewport plus 0.5×vh (capped at 200), and the contrast samples. Off-screen regions are verified lazily when an `IntersectionObserver` reports them entering the viewport.
- **Budget.** Keep total work per apply ≤30 ms, spread over ≤5 ms slices. The first read after the write pays for the layout (unavoidable), and everything else reads a clean layout.

### 4.2 Checks, method and cost

| Check | Method | Failure rule (relative to baseline) | Cost (est.) |
|---|---|---|---|
| **Text clipping** | For elements with a text leaf, walk up to 3 ancestors with `overflow` ≠ visible: `scrollWidth > clientWidth+1` or `scrollHeight > clientHeight+1`. Ellipsis case: `text-overflow:ellipsis` plus `scrollWidth>clientWidth`. Line clamp: `-webkit-line-clamp` ≠ none plus `scrollHeight>clientHeight` | Newly clipped relative to baseline (sites often clip by design) | ~1–3 µs per element; O(marked) |
| **Text overlap** | For floored or spaced text blocks, rect intersection with sibling text blocks and with positioned elements, sampling `elementsFromPoint` at 2–3 line centres | New intersection area ≥ 15% of the smaller rect | ~20–50 µs per sample |
| **Obscured or broken controls** | For probe targets: `elementFromPoint(cx,cy)` must return the target or a descendant (accept our `webable-ui` host). Also check `width*height ≥ 1`, `checkVisibility({opacityProperty:true, visibilityProperty:true})`, and computed `pointer-events` ≠ none | Previously OK and now failing | 200 × ~20 µs ≈ 4 ms |
| **Hit-expansion effectiveness** | Ring probe at the 4 edge midpoints of the expanded rect | Drop the `hit*` token on elements where the probe fails (not a rollback) | 4 probes per target |
| **Horizontal overflow** | `documentElement.scrollWidth > clientWidth`. To find the culprit, look for marked elements with `rect.right > innerWidth` | New overflow > 8 px | O(1) plus the culprit scan |
| **Hidden focusables** | Focusables in the probe set: `checkVisibility(...)` plus a non-zero rect | Any newly hidden → rollback (focus order invariant) | O(probe) |
| **Lost focus** | `document.activeElement` before and after. If focus is now `body` and the previous element is connected and visible, call `prev.focus({preventScroll:true})` | Previous element became hidden → rollback | O(1) |
| **Contrast regression** | Recompute `ratio` for the same samples, skipping unchanged pairs | Any sample falls below min(baseline, personal target) − 0.1 | ~30 µs per sample |
| **Layout shift / reading position** | Anchor delta; optionally `PerformanceObserver({type:'layout-shift'})` sources for attribution [V: delivery to isolated world]. Our changes also count toward the site's CLS field data (CrUX), which is another reason to apply pre-paint where possible | Anchor could not be restored, or shift score > 0.1 during reading → soft fail and offer undo | Negligible |
| **Behaviour ops** | Click stabiliser: log `click` targets vs press targets locally. Motion: `getAnimations()` count after 1 s | User undo within 10 s counts as a negative outcome | Passive |

**Attribution.** A failing element maps to ops through the `data-wa` tokens on itself and up to 5 ancestors, and failing controls map to hit or gap tokens. When a failure element is unmarked (for example, a neighbour pushed by reflow), roll back ops in `risk` order: text floor, then spacing, then line length, then gap, then unpin. Re-verify after each until the failure disappears; that is bisection by risk. Adopt Wanscher et al.'s acceptance rule: **keep a batch only if the targeted metric improves and no new failure class appears**.

### 4.3 axe-core: where it fits

| Property | Finding |
|---|---|
| **Size** | `axe.min.js` is about 561 KB (574,862 bytes) raw and about 151 KB gzipped; `axe.js` is 1.29 MB (issue #5176). 4.10.3's min is 540 KB (jsDelivr) |
| **Run time** | "Pages with >50K elements can take 10s+" (issue #5176). After the grid rewrite, color-contrast takes about 5 s on 50k+ node pages, grid creation about 1 s, and memory grew from 5.5 MB to 12.3 MB (Klambert) |
| **Rule subset** | `axe.run(context, { runOnly: { type: 'rule', values: ['color-contrast', 'target-size'] }, resultTypes: ['violations'], selectors: false, ancestry: false, iframes: false, elementRef: true })` |
| **Scoping does not make it cheap** | The `Context` constructor always calls `getFlattenedTree(getRootNode(spec))`, and `getRootNode` returns `item.ownerDocument.documentElement` for any Element include (`lib/core/base/context.js` lines 46 and 118–132). `createGrid` walks all of `document.body` once per run (`lib/commons/dom/create-grid.js`). Scoping to changed nodes limits *rule evaluation*, not the O(N) setup. `axe.setup()` can prebuild the tree, but it goes stale as soon as the page or our ops mutate |
| **Licence** | MPL-2.0 is file-level copyleft. You may bundle unmodified axe-core in a proprietary extension if you keep its notices and make the source of the MPL files available. Any modification to those files must be released under MPL. The rest of WebAble stays under its own licence |

**Recommendation.**
- **(1) CI.** Run Playwright plus `@axe-core/playwright` over a fixture corpus (static snapshots of top sites, plus seeded-violation pages as in Wanscher et al.). Run each fixture with every op applied and assert *no new axe violations* relative to baseline. This is the regression harness for the op library.
- **(2) On-demand "Deep check"** in the popup. Lazy-load axe with `chrome.scripting.executeScript({files:['axe.min.js']})` in the ISOLATED world, run the two-rule subset, and show a "may take a few seconds" indicator. This is a diagnostic only; it never gates rollback.
- **(3) Real-time loop.** Use the native checks in §4.2 only.

### 4.4 What automated verification cannot establish

The checks cannot tell whether the adapted page is *easier for this user*. Measure that through outcome signals: undo within N seconds, re-enable, task-level behaviour such as fewer mis-clicks or pointer corrections observed by the stabiliser, and periodic in-context prompts. Semantic breakage that doesn't change geometry, such as colour-coded status lost to a colour solve, is invisible to the checks. The solver therefore preserves hue: it changes only OKLCH L and, if needed, C. The verifier cannot see content inside cross-origin iframes except through that frame's own engine instance.

---

## 5. Budget summary

| Stage | Target (main-thread) | Technique |
|---|---|---|
| Pre-paint profile CSS | 0 ms script | `registerContentScripts` css, or `insertCSS` on `webNavigation.onCommitted` |
| Extraction (viewport) | ≤15 ms | Budgeted walk, `checkVisibility` subtree rejection, rect reads for the viewport only |
| Extraction (full, idle) | ≤30 ms total, ≤5 ms slices | `scheduler.yield()`, `maxNodes` cap, sampling |
| Plan and apply | ≤5 ms | Precomputed measurements, one write phase, `replaceSync` |
| Verify | ≤30 ms, ≤5 ms slices | Baseline and diff on the probe set, lazy verification off-screen |
| Mutation increments | ≤5 ms per flush | Added-subtree only; huge fallback; adaptive debounce |
| Motion sweep | ≤1 per second while active | `getAnimations()` triggers a style update |

---

## 6. Things to prove in a spike before committing ([V] items)

1. `setPointerCapture` click retargeting on real sites (Chrome ≥135): links, React buttons, and labels wrapping inputs; interaction with page code that also captures.
2. Whether `insertCSS({origin:'USER'})` applies inside shadow roots, and its interaction with `@layer !important`.
3. Delivery of Navigation API events and `PerformanceObserver('layout-shift')` to isolated-world listeners.
4. Whether document `<canvas>` vs `OffscreenCanvas` `measureText` uses page web fonts.
5. The `transition-behavior: allow-discrete` hover-keep on menus hidden by JavaScript through class or inline style.
6. Accessibility-tree invariance of every op. Take a Playwright `accessibility.snapshot()` before and after each op on the fixtures and assert equality of roles, names and focus order. Make this a CI gate for the invariants.
7. Adopted-sheet survival on frameworks that reassign `document.adoptedStyleSheets`.

---

## Sources

- Wanscher, Lorensen, Shafiq, Moghaddam, Alipour. "From Blind Edits to Verified Repair: Building Trustworthy User-Side LLM Agents for Web Accessibility." arXiv 2608.24913 (2026). https://arxiv.org/abs/2608.24913 · https://arxiv.org/html/2608.24913
- Dark Reader, `src/inject/dynamic-theme/`: https://github.com/darkreader/darkreader/tree/main/src/inject/dynamic-theme. Files used above: `stylesheet-proxy.ts`, `adopted-style-manger.ts`, `modify-colors.ts`, `image.ts`, `inline-style.ts`, `mv3-proxy.ts`, `index.ts`, `watch/style-position.ts`, plus `src/inject/utils/dom.ts` and `src/utils/throttle.ts`
- Stylus style injector: https://github.com/openstyles/stylus/blob/master/src/content/style-injector.js
- axe-core:
  - https://github.com/dequelabs/axe-core/blob/develop/lib/core/base/context.js
  - https://github.com/dequelabs/axe-core/blob/develop/lib/commons/dom/create-grid.js
  - https://github.com/dequelabs/axe-core/blob/develop/lib/checks/mobile/target-offset-evaluate.js
  - https://github.com/dequelabs/axe-core/blob/develop/lib/commons/math/get-offset.js
  - https://github.com/dequelabs/axe-core/blob/develop/lib/commons/color/get-background-color.js
  - https://github.com/dequelabs/axe-core/blob/develop/lib/commons/color/get-background-stack.js
  - API: https://github.com/dequelabs/axe-core/blob/develop/doc/API.md
  - Perf and size: https://github.com/dequelabs/axe-core/issues/5176
  - Color-contrast performance: https://stevenklambert.com/writing/axe-core-color-contrast-performance/
  - Licence: https://github.com/dequelabs/axe-core/blob/develop/LICENSE
  - jsDelivr 4.10.3: https://cdn.jsdelivr.net/npm/axe-core@4.10.3/
- Mozilla Readability: https://github.com/mozilla/readability/blob/main/Readability.js and https://github.com/mozilla/readability/blob/main/Readability-readerable.js
- WCAG 2.2:
  - SC 2.5.8: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
  - SC 1.4.12, 2.2.2, 2.5.7: https://www.w3.org/TR/WCAG22/
- Text spacing bookmarklet (S. Faulkner): https://codepen.io/stevef/pen/YLMqbo and https://stevefaulkner.github.io/Articles/Short%20note%20on%20getting%20spaced%20out%20with%20SC%201.4.12%20Text%20Spacing.html
- APCA:
  - Licence: https://git.apcacontrast.com/documentation/LICENSE.html
  - Code: https://github.com/Myndex/apca-w3
  - Standards status: Roselli, "WCAG3 Contrast as of April 2026", http://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html
- Chrome extension APIs:
  - scripting (insertCSS origin, worlds): https://developer.chrome.com/docs/extensions/reference/api/scripting
  - dom.openOrClosedShadowRoot: https://developer.chrome.com/docs/extensions/reference/api/dom
  - tabs (captureVisibleTab limit, setZoom): https://developer.chrome.com/docs/extensions/reference/api/tabs
  - fontSettings: https://developer.chrome.com/docs/extensions/reference/api/fontSettings
- Pointer capture click targeting (Chrome 135): https://groups.google.com/a/chromium.org/g/blink-dev/c/o1fXBdt94iA/m/NzBAK2o_AAAJ · Pointer Events L3: https://www.w3.org/TR/pointerevents3/
- Web Animations (`getAnimations` scope): https://drafts.csswg.org/web-animations-1/ · MDN: https://developer.mozilla.org/en-US/docs/Web/API/Document/getAnimations
- Navigation API explainer: https://github.com/WICG/navigation-api
- MDN `checkVisibility`: https://developer.mozilla.org/en-US/docs/Web/API/Element/checkVisibility
- `scheduler.yield` (Chrome 129): https://developer.chrome.com/blog/use-scheduler-yield
- `transition-behavior: allow-discrete` (Chrome 117): https://developer.chrome.com/blog/entry-exit-animations
- ImageDecoder explainer: https://github.com/dalecurtis/image-decoder-api/blob/master/explainer.md
- LayoutShift attribution: https://developer.mozilla.org/en-US/docs/Web/API/LayoutShift/sources
- Filter Effects (root-element containing-block exception): https://drafts.fxtf.org/filter-effects/#FilterProperty
- Chrome Reading Mode / Screen2x: https://groups.google.com/a/chromium.org/g/chromium-reviews/c/1_wEO1NZO-M
- VIPS (MSR-TR-2003-79): https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/tr-2003-79.pdf · Kiesel et al., Webis-WebSeg-20: https://downloads.webis.de/publications/papers/kiesel_2020b.pdf
- EasyList licence: https://github.com/easylist/easylist · uBlock filter list licences: https://github.com/gorhill/ublock/wiki/Filter-list-licenses
- Consent-O-Matic (MIT): https://github.com/cavi-au/Consent-O-Matic · DuckDuckGo autoconsent (MPL-2.0): https://github.com/duckduckgo/autoconsent
- Trewin, Keates, Moffatt. "Developing Steady Clicks." ASSETS 2006. https://doi.org/10.1145/1168987.1168993
- Findlater et al. "Enhanced Area Cursors." UIST 2010. https://faculty.washington.edu/wobbrock/pubs/uist-10.pdf
- Gajos, Wobbrock, Weld. "Improving the performance of motor-impaired users with automatically-generated, ability-based interfaces." CHI 2008. https://doi.org/10.1145/1357054.1357250
- Grossman & Balakrishnan. "The Bubble Cursor." CHI 2005. https://doi.org/10.1145/1054972.1055012
