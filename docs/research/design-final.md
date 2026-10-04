# WebAble design language, FINAL: "Made to Measure"

Date: 2026-09-28. Status: decision document. It supersedes proposals A ("Quiet Precision"), B ("Instrument") and C ("Humane Adaptive") and is the single source for the website, the web app, the calibration flow, the extension popup and the in-page layer.

**Inputs**
- The five measured reference analyses (`design-openai.md`, `design-linear.md`, `design-gemini.md`, `design-polestar.md`, `design-xai.md`).
- The three proposals (`design-proposal-a.md`, `-b.md`, `-c.md`).
- Calibration constraints from `cal-vision.md`, `cal-motor.md` and `cal-attention.md`.
- The current popup prototype (`apps/extension/entrypoints/popup/`).

**New measurements this session** (scripts in `scratchpad/design-final/`)
- **Font metrics** were read with fontTools 4.66 from the Google Fonts repository files `AtkinsonHyperlegibleNext[wght].ttf` and `AtkinsonHyperlegibleMono[wght].ttf`, and compared with macOS Arial (`metrics.py`).
- **Latin subsets** were built as WOFF2 with pyftsubset, and their sizes were measured.
- **Contrast.** Every text/background pair and every focus-ring/background pair was computed with the WCAG 2.x relative-luminance formula in Node 24 (`contrast.mjs`, `table.mjs`). The table in §6 is that script's output.
- **Colour-vision distances.** Status colours were checked under Machado 2009 severity-1.0 simulation, with distances in OKLab (`cvd.mjs`).

---

## 0. Decisions at a glance

1. **Base: Proposal A.** It scored 53/70, against C at 51 and B at 48. It supplies the structure, the fit-mark signature, the popup geometry, the motion system and the copy rules. Grafts from B and C are listed in §1.3.
2. **Typeface: Atkinson Hyperlegible Next** for every role, with **Atkinson Hyperlegible Mono** for values. Both are OFL and variable (weight 200–800).
   - This reverses A's Inter choice. Next separates I/l/1 and O/0 by default, so no custom font build is needed.
   - It pairs natively with the Mono that A had already chosen.
   - It removes the biggest "generic SaaS" risk.
3. **Colour.** Warm stone neutrals, on a `#FAFAF7` paper canvas with `#1A1A17` ink.
   - **One accent, fern (`#2D6A3E` light, `#8FCB9B` dark), has exactly one meaning: "WebAble changed this, or offers to."**
   - Buttons, links, focus and selection are ink, never accent.
4. **Floors, all computed (§6):**

   | Role | Minimum contrast |
   |---|---|
   | Body text | 10.43:1 (8.24:1 on the text-selection highlight) |
   | Secondary text | 7.24:1 |
   | Tertiary text | 4.86:1 |
   | Accent text | 5.28:1 |
   | Control boundaries | 3.11:1 |
   | Focus ring | 8.24:1 |

   These hold on every surface in both themes.
5. **Sizes.**
   - Text never goes below **15 px**. The UI is 16 px, and reading text is 18 px.
   - Targets default to 44 px, primary buttons are 48 px, and calibration controls are 64 px.
   - Everything is in rem and is bound to the user's calibrated text scale and target minimum.
6. **Shape encodes role.** A pill is an action. An 8 px rectangle is a field. A 12 px rectangle is a panel. A 20 px rectangle is a modal. A 0-radius hairline is a measurement.
7. **Flat.** Depth comes from tone and hairlines. A shadow means the layer floats. The only blur in the system is the site/app header.
8. **Motion.**
   - One curve, with durations of 100, 160, 220 and 300 ms, and at most 8 px of travel.
   - No showpiece except a one-time, 600 ms fit-mark draw on the website hero.
   - WebAble never animates someone else's page. Calibration stimuli appear instantly.
9. **The product obeys its own profile.** Text scale, target minimum, extra leading, spacing, motion, contrast and theme all come from the WebAble profile.
10. **Copy.** Describe pages and functions, never people. Offer, don't announce. Give real numbers with units. Undo always sits beside the change. Never claim conformance, never diagnose, and never say "test" or "score".

---

## 1. Proposal scorecard

Scores run from 1 to 10, and 10 is best on every row. On the last criterion, 10 means the *lowest* risk of looking generic.

| Criterion | A "Quiet Precision" | B "Instrument" | C "Humane Adaptive" |
|---|---|---|---|
| Fidelity to shared principles (restraint, typographic confidence, whitespace, precision) | **9**: maps all 13 shared principles; two weights; flat; one ink button; drops the showpiece | **8**: disciplined, but adds a lamp glow, a key-light edge and a "bench light" pool, three effects that none of the references use | **7**: faithful analysis, but a radial accent wash, 16–24 px card radii and a 152 px status card soften the precision |
| Distinctiveness (feels like WebAble, not a clone) | **6**: the fit mark and tailed-l wordmark are ownable, but Inter plus cobalt on warm white is the house style of countless SaaS sites | **7**: graphite plus signal yellow plus corner brackets is unclaimed, but it reads as a HUD/dev tool, close to dark Linear and xAI | **8**: Atkinson Next plus fern plus a profile-driven page glyph is the most WebAble-specific set |
| Accessibility robustness | **9**: every pair verified, tertiary text ≥ 5:1, 3 px focus, targets bound to the motor ladder, reduced motion honoured three ways. Weakness: I/l/1 separation depends on a feature-frozen custom build | **8**: strong floors and a CVD simulation, but the dark-first posture fights the positive-polarity advantage most readers have, and the accent can never be text in the light theme | **8**: glyph disambiguation by default, verified floors, ink focus ≥ 12:1. But the gradient wash sits behind text, and the analyzing state loops |
| Consumer (not enterprise) character | **7**: calm, editorial, humane copy; ink plus cobalt reads slightly institutional | **4**: "technician", "readings", graphite and mono readouts feel like a professional instrument | **9**: warm and plain-spoken, "a friend who is good with computers" |
| Fit for a compact extension popup | **9**: coordinate-level 380 px layout, fixed header and footer, 56 px rows, inline fit marks, a full state table, and width that grows with text scale | **8**: the fixed geometry and equal-size decline pair are excellent, but a ⋯ menu hides Settings and brackets on every row add noise | **6**: the status card (glyph, wash and compare control) takes 152 of 600 px, and "What changed" is collapsed by default |
| Implementability with plain CSS custom properties | **8**: complete, literal token file. Needs a feature-frozen Inter build and a build-time mixin to emit the dark block twice | **6**: the light-theme and reduced-motion blocks are placeholders ("same block as below"), and the fallback metrics are unmeasured | **7**: clean `light-dark()` file, but the signature morph needs JavaScript SVG interpolation, and the fallback metrics are placeholders |
| Risk of looking generic / AI-generated (10 = lowest risk) | **5**: without the fit mark it is the default "tasteful AI product" look: Inter, off-white, one blue, pills | **7**: dark plus mono is common; yellow on graphite is not | **6**: cream plus sage plus rounded cards plus a soft gradient wash is the current wellness-app template |
| **Total (out of 70)** | **53** | **48** | **51** |

### 1.1 Justification in brief

**A.** It is the most rigorous and complete proposal.
- It measured the typefaces (x-height, glyph-overlap IoU), which led to the finding that Google Fonts silently drops Inter's `cv05`/`cv08`.
- It verified a full contrast matrix and specified the popup at coordinate level.
- It invented the strongest signature: the fit mark, a dimension line showing real before and after values, which doubles as the transparency feature.

Its weaknesses are all in *identity*:
- Inter is the component-library default.
- The cobalt accent carries four meanings (links, focus, selection, adapted), which dilutes it.
- It needs a custom font build just to make I and l distinct.

**B.** It has the best interaction ideas:
- a decline button the same size as the accept button;
- toasts with an action that never time out;
- `hidden="until-found"`;
- a keyboard command into the in-page layer;
- casings, so marks stay visible on any page;
- a sticky header only on tall viewports;
- calibration stimuli exempt from theme.

Its visual thesis is wrong for this audience, though:
- Dark-first reverses the positive-polarity default, which `cal-vision.md` §2.4 supports.
- Yellow can't be used as text on light surfaces.
- "Instrument" reads as enterprise.
- Its token file leaves whole blocks as comments.

**C.** It has the best *meaning* system:
- The rule "colour means change".
- "We wear our own adaptations".
- The four density postures.
- Rollback shown neutrally, not as an alarm.
- A warm consumer voice and the Atkinson choice.

Its execution is softer. The gradient wash, 16–24 px card radii, a heavy status card and a second morphing signature push it toward a wellness-app template, and it fits the popup least well.

### 1.2 Verdict

**Base: A.** It has the strongest system, the precision and the popup. From B and C we graft the identity decisions that fix A's weak scores (typeface, accent meaning, consumer voice) and the interaction details that raise its robustness.

### 1.3 Grafts

| Graft | Source | What it replaces in A | Why |
|---|---|---|---|
| Atkinson Hyperlegible Next as the only sans | B, C | Inter 4.1 plus a feature-frozen custom build | I/l/1 are distinct by default, including in canvas, SVG, copied text and fallback paths. It is one family with the Mono A already chose. It has the most open apertures in A's own measurements (c/o IoU 0.60 against Inter's 0.75). It removes the generic-Inter risk. |
| Fern accent with one meaning: "WebAble changed this, or offers to" | C, principle P1 | Cobalt with four meanings | A single meaning can be learned in one visit. It avoids the blue overlay-widget association. It continues the prototype's green (`#176b46`). |
| Ink focus ring; ink, underlined links; ink selection | C, Gemini, Polestar | Accent focus and links | Keeps the accent to one meaning. Focus reaches 16.68:1 on the canvas. |
| "Not now" as a full secondary button, the same size as "Try it" | B | A's ghost "Not now" | Declining costs the same motor effort and has the same visual weight (offer, never impose). |
| Rollback shown as a neutral "undone" row. "Needs attention" only for problems the user can act on | C | A's "Needs attention" on rollback | The verifier doing its job is not an alarm. |
| Four densities: Reading, Working, Task, Compact | C | A's per-surface table | Named postures keep one token set honest. |
| Profile hooks `--wa-leading-add` and `--wa-space-scale` | B, C | A had only text scale and target minimum | Spacing is a vision-calibration output. |
| First-run quick switches, which the user turns on | C | A's list-only first run | Value on the first visit without imposing anything. |
| A toast with an action never times out | B | A's 10 s | WCAG 2.2.1, and it protects the undo guarantee. |
| Disclosures use `hidden="until-found"` | B | — | Find-in-page reaches collapsed text. |
| In-page outlines drawn with a white casing | B | — | Visible on any page colour (6.48:1 between line and casing). |
| In-page layer reached by a keyboard command, with its controls at `tabindex="-1"` | B | — | The host page's tab order is never touched. |
| Sticky header only when the viewport is at least 37.5 em tall | B | Always sticky | At 400% zoom the header scrolls away instead of taking the viewport. |
| Eyebrows state a fact ("3 short tasks · about 6 min"), not a category | B | A's category label | Measured copy. |
| The analyzing arc stops after 5 s and becomes text | B | Infinite loop | No endless motion. |
| Calibration stimuli fixed at `#111111` on `#FFFFFF` in both themes, exempt from the profile | B, `cal-vision.md` | — | Measurement integrity. Contrast is never measured in dark polarity. |
| An honesty line in the footer | B, C | — | Keeps the no-conformance-claims invariant visible. |
| Dark-theme compensation: +0.008 em tracking, weight −20, antialiased | A, B | — | Limits halation and blooming. |
| **Arrows drawn as SVG, never typed** | New finding (§3.4) | A, B and C all typed "→" | Atkinson Next and Mono have no U+2192, U+2197, U+21BA or U+2713. |

### 1.4 Rejected, and why

| Rejected | From | Reason |
|---|---|---|
| Signal yellow, dark-first posture, lamp glow, key light, bench light | B | Wrong polarity default for most readers. Yellow can't be text on light surfaces. Three effect layers break restraint. |
| Radial fern "field" wash behind content | C | A gradient behind text. It survives only as a flat 6% fill *inside* an adapted outline. |
| Page-shape glyph as a second, morphing signature | C | Two signatures dilute each other, and the morph needs JavaScript interpolation. Parked for v2 logo exploration. The final mark borrows its text bars (§11.3). |
| Fern "Adapt" button variant | C | Buttons stay ink. The accent marks *results*, not controls. |
| 16 and 24 px card radii; the status card in the popup | C | The popup has no cards except the offer block. |
| Inter; cobalt; accent as focus colour; 14 px text floor | A | See the grafts. The floor rises to 15 px because Atkinson's x-height is 9% smaller than Inter's. |

---

## 2. Principles

Each principle has a check that can be tested.

1. **Legibility is the luxury.** Restraint comes from fewer elements and more space, never from fainter text.
   - *Check:* the token contrast matrix runs in CI (§6). No text below 15 px. Body text ≥ 7:1.
2. **Colour means change.** Fern appears only where WebAble has changed something or offers to:
   - the after-value in a fit mark;
   - the adapted status disc;
   - the track of a switch that changes the page;
   - the fit outline on a page;
   - the offer rule;
   - the "applied" glyph in a toast.

   Headings, buttons, links, focus, selection, nav and decoration stay neutral.
   - *Check:* grep for `--accent` outside that list of components. The answer must be zero.
3. **We wear our own adaptations.** The website, app, calibration flow and popup apply the user's text scale, target minimum, extra leading, spacing, motion, contrast and theme.
   - *Check:* screenshot diffs at `--wa-text-scale` 1, 1.5 and 2 show no clipping.
4. **One family, tuned by role and polarity.** Atkinson Next at 400 and 540 (520 in dark), and the Mono only for values.
   - *Check:* no third family, except `system-ui` in the in-page layer and Noto Sans in reading stimuli.
5. **Depth from tone and hairlines; a shadow means floating.**
   - *Check:* no `box-shadow` outside the `--elev-*` tokens, and at most one level of containment.
6. **Shape encodes role.** Pill = act; 8 = field; 12 = panel; 20 = modal; 0 = measurement. Nested radius = outer − padding.
   - *Check:* nothing pill-shaped is inert.
7. **One decision per view, and declining is the same size.** One ink button per region. An offer shows [Try it] as primary and [Not now] as secondary, at equal width and height.
   - *Check:* declining takes one activation of a target ≥ 44 px.
8. **Show the real thing, measured.** Real pages, before and after, annotated with fit marks that carry real values.
   - *Check:* every number in a fit mark comes from the live system or from a recorded session.
9. **Short copy, detail on request, nothing important hidden.** Help, "What changed" and "What was sent" are never more than one activation away and are never collapsed by default.
   - *Check:* UI strings at grade 8 or below in CI.
10. **Quiet, fast motion. Never move what someone is reading. Never animate someone else's page.**
    - *Check:* under reduced motion, Playwright finds zero transform animations, and in-page apply, rollback and undo each take one frame.
11. **Chrome stays put.** Headers never hide based on scroll direction, and the popup's header and footer never move between states.

---

## 3. Typeface

### 3.1 Decision

**WebAble Sans = Atkinson Hyperlegible Next (OFL 1.1), variable weight 200–800, default 400.**
**WebAble Mono = Atkinson Hyperlegible Mono (OFL 1.1), variable weight 200–800.**
- Both are self-hosted on the web and bundled in the extension. Nothing loads remotely.
- The in-page layer uses `system-ui` (§3.6).
- Reading stimuli in calibration use bundled **Noto Sans 400**, a typical web text face, per `cal-vision.md` §3.

### 3.2 Measured this session (fontTools, Google Fonts repository files)

| Metric | Atkinson Next | Atkinson Mono | Arial (fallback) |
|---|---|---|---|
| Units per em | 1000 | 1000 | 2048 |
| x-height / em | **0.496** | 0.496 | 0.519 |
| Cap height / em | 0.668 | 0.668 | 0.716 |
| Ascent / descent (hhea = typo; `USE_TYPO_METRICS` set) | 0.984 / 0.316 | 0.984 / 0.316 | 0.905 / 0.212 |
| Line gap | 0 | 0 | 0.033 |
| Average advance (sample sentence) | 0.463 em at 400; 0.480 em at 540 | 0.632 em | 0.468 em |
| Advance of "0" | 0.648 em (so avoid `ch` units) | 0.632 em | 0.556 em |
| OpenType GSUB features | `case`, `frac`, `ordn`, `pnum`, **`tnum`**, `sups`, `locl`, `ccmp` | `zero`, `case`, `frac`, `sups` | — |
| Latin WOFF2 subset (U+0000–017F plus punctuation, all layout features) | **38,496 B** | **19,784 B** | system |

Both brand files together weigh **58.3 KB**, well inside the extension budget.

**x-height at each size** (Atkinson Next, 0.496):

| Font size | 15 px | 16 px | 18 px | 20 px | 24 px |
|---|---|---|---|---|---|
| x-height | 7.44 px | 7.94 px | 8.93 px | 9.92 px | 11.90 px |

The 15 px floor gives about the x-height that A's 14 px Inter floor gave (7.6 px).

**Letterform evidence**, from A's canvas measurements of the same face:
- I vs l IoU 0.38, l vs 1 IoU 0.08, O vs 0 IoU 0.52. Lower means easier to tell apart.
- c/o IoU 0.60, the most open apertures of the 12 faces A measured.

### 3.3 Why Atkinson over A's Inter

1. **Disambiguation is built in**, so it survives user stylesheets, canvas, SVG, copied text and system fallback.
   - It matters most where it is security-relevant: the domain line in the popup (`paypaI.com` vs `paypal.com`).
   - Inter needs `cv05`/`cv08`, which the Google Fonts build silently strips (A, §3.2).
2. **One family.** A already chose Atkinson Mono. Atkinson Next makes sans and mono one design with identical vertical metrics, so no `size-adjust` is needed between them.
3. **Identity.** Inter is the component-library default and Linear's signature. Atkinson Next is used by none of the five references.
   - A's own signature idea is that "WebAble"'s tailed **l** makes legibility visible. That tail is native here.
4. **The cost is x-height.** Atkinson is 9% smaller than Inter. We pay for it in the scale:
   - floor 15 px (not 14);
   - reading text 18 px;
   - display capped at 64 px, weight 540, −0.022 em, so the face's quirks never reach 80 px+.

### 3.4 Glyph-coverage finding (affects all three proposals)

Neither Atkinson file contains **→ (U+2192), ↗ (U+2197), ↺ (U+21BA) or ✓ (U+2713)**. Both do contain · … × − › ‹ – — ’.

Rule: **arrows, checks and undo glyphs are always inline SVG** (§11), never typed characters. Typed characters would fall back to another font and render inconsistently.

A fit mark is marked up as:

```html
<span class="wa-fit-value">
  13<span class="sr-only"> to </span>
  <svg aria-hidden="true">…</svg>
  18&nbsp;px
</span>
```

### 3.5 Roles

| Role | Family | Weight (light / dark) | Notes |
|---|---|---|---|
| Display, H1–H3, title, label, nav, button | Next | 540 / 520 | Headings take negative tracking only at 22 px and above |
| Lead, body, UI, meta, inputs | Next | 400 / 400 | Tracking 0 in light; +0.008 em in dark (meta +0.006 / +0.012 em) |
| Inline emphasis (`<strong>`) | Next | 700 | Only in running text. Never in headings or buttons |
| Values: fit marks, readouts, "What was sent", `<kbd>` | Mono | 450 / 450 | 15 px or larger; tabular by construction |
| Numbers inside Next (counts, tables) | Next | — | `font-variant-numeric: tabular-nums` (`tnum` verified) |

Further rules:
- **No all caps, no letter-spaced eyebrows, no italics in UI.** Italic files are not shipped.
- **Never below weight 400.**
- **`text-wrap: balance`** on h1–h3 and **`pretty`** on paragraphs.

### 3.6 Loading

- **Web and app.**
  - One `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the sans.
  - `font-display: swap`.
  - A metric-matched Arial fallback computed from the table above:
    - `size-adjust` = 0.463 / 0.468 = **98.9%**
    - `ascent-override` = 0.984 / 0.989 = **99.5%**
    - `descent-override` = 0.316 / 0.989 = **32.0%**
    - `line-gap-override` = **0%**
  - No third-party font requests.
- **Extension pages** (popup, side panel, options): files in `public/fonts/`, served from the extension origin.
- **In-page layer** (content-script UI in WebAble's shadow root): `--font-layer` (`system-ui`).
  - Brand fonts there would need `web_accessible_resources`, which lets pages detect the extension, and entries in the page's `document.fonts`, which pages can read.
  - Size, weight and spacing tokens still apply.

### 3.7 Validation gate and fallback

The font is locked only after this half-day test:

1. **Glyph test.** Render `Il1| O0o rn/m cl/d 5S 8B 6b paypal.com paypaI.com`:
   - at 15, 16 and 18 px, weights 400 and 540;
   - in both themes;
   - with Gaussian blur σ 0.8 and σ 1.6.
2. **Confusion count.** Five people read each set cold. Count confusions against Inter 4.1 (upstream rsms build with `cv05`, `cv08` and `ss02` frozen on).
3. **Reading test.** An MNREAD-style reading-speed comparison at matched x-height with 3 or more participants from the persona pool with reduced contrast sensitivity.

**Decision rule:** keep Atkinson unless Inter produces materially fewer confusions or faster reading.
- If it does, switch the *whole* system to Inter. Never mix the two.
- Load Inter only from the upstream file; the Google Fonts build drops the variants.

---

## 4. Tokens: complete CSS custom-properties file

Proposed path: `packages/tokens/tokens.css`. A generated `tokens.ts` mirrors it for JavaScript (for example, toolbar badge colours).

**How the file works**
- Components reference semantic tokens only.
- **Theme resolution:**
  1. `<html data-theme="light|dark">` is the user's choice, synced in the profile.
  2. Otherwise `prefers-color-scheme` decides.
- The dark block is written out twice on purpose: once under the media query and once for the attribute. That keeps the file plain CSS with no build step.

```css
/* =========================================================================
   WebAble design tokens — FINAL v1.0 — 2026-09-28
   One file: website, web app, calibration flow, extension popup/side panel,
   and (with --font-layer) the in-page layer. Values verified in §6.
   ========================================================================= */

/* ---------- Fonts ---------- */
@font-face {
  font-family: "WebAble Sans";                       /* Atkinson Hyperlegible Next, OFL, Latin subset 38,496 B */
  src: url("/fonts/atkinson-hyperlegible-next-latin.var.woff2") format("woff2");
  font-weight: 200 800; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "WebAble Mono";                       /* Atkinson Hyperlegible Mono, OFL, Latin subset 19,784 B */
  src: url("/fonts/atkinson-hyperlegible-mono-latin.var.woff2") format("woff2");
  font-weight: 200 800; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "WebAble Sans Fallback";              /* metrics measured 2026-09-28 (fontTools) */
  src: local("Arial"), local("ArialMT");
  size-adjust: 98.9%;                                /* avg advance 0.463em / 0.468em */
  ascent-override: 99.5%;                            /* 0.984 / 0.989 */
  descent-override: 32%;                             /* 0.316 / 0.989 */
  line-gap-override: 0%;
}

:root {
  color-scheme: light;

  /* ---------- 0. Profile hooks (written from the user's WebAble profile) ---------- */
  --wa-text-scale: 1;         /* vision calibration or manual; multiplies the root size   */
  --wa-target-min: 44px;      /* motor ladder {24,32,44,56,72,96}; floors never go below 44 */
  --wa-leading-add: 0;        /* added to reading line-heights (spacing preference)        */
  --wa-space-scale: 1;        /* multiplies stack gaps only                                */

  /* ---------- 1. Colour: light ---------- */
  --canvas:                #FAFAF7;   /* paper */
  --surface-raised:        #FFFFFF;   /* inputs, popovers, selected segment, in-page chip */
  --surface-tonal:         #F2F1EC;   /* footer, offer block, wells, segmented track, status pill */
  --surface-hover:         #E9E8E2;
  --surface-press:         #DFDED7;
  --surface-inverse:       #1F1F1C;   /* toast, tooltip */
  --surface-inverse-hover: #34342F;
  --ink:                   #1A1A17;   /* 16.68 on canvas */
  --ink-2:                 #45443E;   /*  9.34 on canvas; ≥ 7.24 everywhere */
  --ink-3:                 #5E5D56;   /*  6.32 on canvas; ≥ 4.90 everywhere */
  --on-inverse:            #F3F2EC;
  --on-inverse-2:          #C9C8C0;
  --on-inverse-accent:     #9DD1A6;
  --line:                  #E0DFD8;   /* decorative hairline, 1.28:1 — never a control's only edge */
  --line-strong:           #7D7C73;   /* control boundary, ≥ 3.11 on every surface */
  --accent:                #2D6A3E;   /* fern: "WebAble changed this, or offers to" */
  --accent-hover:          #22552F;
  --accent-tint:           #E4EFE6;
  --on-accent:             #FFFFFF;
  --action:                #1A1A17;   /* primary button fill */
  --action-hover:          #3A3934;
  --action-press:          #000000;
  --on-action:             #FFFFFF;
  --warning:               #7A4800;   /* text */
  --warning-icon:          #A36200;   /* glyph */
  --warning-tint:          #FAEFD9;
  --danger:                #A3241C;
  --danger-hover:          #85190F;
  --danger-tint:           #FBE9E6;
  --on-danger:             #FFFFFF;
  --selection:             #CFE2D3;
  --focus:                 #1A1A17;
  --focus-inverse:         #F3F2EC;   /* applied inside .wa-inverse */
  --scrim:                 rgb(26 26 23 / 0.48);
  --header-bg:             rgb(250 250 247 / 0.92);
  --fit-fill:              rgb(45 106 62 / 0.06);
  --font-smoothing:        auto;
  /* Fixed in both themes */
  --stage:                 #FFFFFF;   /* calibration stimulus field */
  --stimulus:              #111111;   /* 18.88:1 */
  --inpage-accent:         #2D6A3E;   /* fit outline on host pages */
  --inpage-casing:         #FFFFFF;   /* 1px casing each side of in-page marks */
  --badge-accent:          #2D6A3E;   /* chrome.action badge: change count (white text) */
  --badge-warn:            #F0B45C;   /* chrome.action badge: "!" (ink text) */

  /* ---------- 2. Type ---------- */
  --font-sans:  "WebAble Sans", "WebAble Sans Fallback", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono:  "WebAble Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --font-layer: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;   /* in-page layer only */
  --weight-regular: 400;
  --weight-medium:  540;
  --weight-strong:  700;     /* inline <strong> only */
  --weight-mono:    450;

  --text-display: 2.5rem;    /* 40 → 64 at ≥64em */
  --text-h1:      2rem;      /* 32 → 44 */
  --text-h2:      1.625rem;  /* 26 → 32 */
  --text-h3:      1.375rem;  /* 22 → 24 */
  --text-title:   1.25rem;   /* 20 */
  --text-lead:    1.25rem;   /* 20 */
  --text-body:    1.125rem;  /* 18 reading */
  --text-ui:      1rem;      /* 16 */
  --text-label:   1rem;      /* 16 @ medium */
  --text-meta:    0.9375rem; /* 15 — THE FLOOR */
  --text-mono:    0.9375rem; /* 15 */
  --text-readout: 1.75rem;   /* 28 mono, results page */

  --leading-display: 1.04;
  --leading-h1:      1.08;
  --leading-h2:      1.15;
  --leading-h3:      1.25;
  --leading-title:   1.3;
  --leading-lead:    calc(1.5 + var(--wa-leading-add));
  --leading-body:    calc(1.6 + var(--wa-leading-add));
  --leading-ui:      calc(1.5 + var(--wa-leading-add));
  --leading-label:   1.25;
  --leading-meta:    calc(1.45 + var(--wa-leading-add));
  --leading-mono:    1.45;
  --leading-readout: 1.1;

  --track-display: -0.022em;
  --track-h1:      -0.018em;
  --track-h2:      -0.012em;
  --track-h3:      -0.006em;
  --track-readout: -0.01em;
  --track-text:    0;          /* title, lead, body, ui, label */
  --track-meta:    0.006em;

  /* ---------- 3. Space (4px base; rem, so it scales with text) ---------- */
  --space-0:   0;
  --space-px:  1px;
  --space-0-5: 0.125rem;  /*   2 */
  --space-1:   0.25rem;   /*   4 */
  --space-2:   0.5rem;    /*   8 */
  --space-3:   0.75rem;   /*  12 */
  --space-4:   1rem;      /*  16 */
  --space-5:   1.25rem;   /*  20 */
  --space-6:   1.5rem;    /*  24 */
  --space-8:   2rem;      /*  32 */
  --space-10:  2.5rem;    /*  40 */
  --space-12:  3rem;      /*  48 */
  --space-16:  4rem;      /*  64 */
  --space-20:  5rem;      /*  80 */
  --space-24:  6rem;      /*  96 */
  --space-32:  8rem;      /* 128 */
  --stack-tight: calc(0.5rem * var(--wa-space-scale));
  --stack:       calc(1rem   * var(--wa-space-scale));
  --stack-loose: calc(1.5rem * var(--wa-space-scale));
  --gutter:      1rem;      /* 16 → 24 at ≥48em → 48 at ≥64em */
  --section-y:   4rem;      /* 64 → 96 at ≥48em → 128 at ≥64em */
  --section-head-gap: 3rem; /* section header → content */

  /* ---------- 4. Layout ---------- */
  --w-prose:   35rem;       /* 560 ≈ 67 characters at 18px (avg advance 0.463em) */
  --w-form:    30rem;       /* 480 sign-in, account forms */
  --w-task:    45rem;       /* 720 calibration column */
  --w-content: 76rem;       /* 1216 */
  --w-wide:    90rem;       /* 1440 hero media */
  --w-modal:   35rem;       /* 560 */
  --w-rail:    15rem;       /* 240 app rail */
  --w-popup:   23.75rem;    /* 380 at scale 1; 570 at 1.5; 760 at 2 (Chrome cap 800) */
  --h-popup-max: 600px;     /* Chrome cap */
  --w-toast:   27.5rem;     /* 440 */
  --w-tooltip: 17.5rem;     /* 280 */
  --w-inpage-chip: 25rem;   /* 400 */
  --header-h:  3.5rem;      /* 56 → 64 at ≥64em */
  --popup-header-h: 3.5rem; /* 56 */
  --popup-footer-h: 3rem;   /* 48 */
  --popup-pad: 1rem;        /* 16 → content 348 at scale 1 */
  --task-bar-h: 4rem;       /* 64 calibration top bar */
  --task-actions-h: 6rem;   /* 96 calibration action bar */
  --stage-min-h: 22.5rem;   /* 360 */

  /* ---------- 5. Targets and controls ---------- */
  --target-min:   max(2.75rem, var(--wa-target-min));   /* 44 default; profile can raise */
  --control-sm:   2.25rem;  /* 36 visual, hit area = --target-min (dense app tables only) */
  --control-md:   2.75rem;  /* 44 icon buttons, nav, row actions, toast, in-page chip */
  --control-lg:   3rem;     /* 48 default button, input, popup primary, offer pair */
  --control-task: 4rem;     /* 64 calibration responses and navigation */
  --row-min:      3.5rem;   /* 56 list, switch, disclosure rows */
  --switch-w:     3.25rem;  /* 52 */
  --switch-h:     2rem;     /* 32 */
  --switch-thumb: 1.25rem;  /* 20 */
  --checkbox:     1.25rem;  /* 20 */
  --slider-track: 0.375rem; /* 6 */
  --slider-thumb: 1.75rem;  /* 28 */
  --focus-width:  3px;
  --focus-offset: 2px;
  --focus-halo:   7px;      /* white halo behind the ring, in-page layer only */

  /* ---------- 6. Shape ---------- */
  --radius-0:    0;         /* measurement: fit marks, index rule, ruler */
  --radius-1:    4px;       /* checkbox, kbd, tooltip, fit-mark plate */
  --radius-2:    8px;       /* input, select, media, row hover, payload well */
  --radius-3:    12px;      /* panel, popover, toast, offer block, in-page chip */
  --radius-4:    20px;      /* modal, sheet, hero/preview frame */
  --radius-pill: 999px;     /* every action: button, switch, segmented, status pill */
  --bw-hair:     1px;
  --bw-control:  1px;
  --bw-strong:   2px;

  /* ---------- 7. Elevation (floating layers only) ---------- */
  --elev-0:      none;
  --elev-float:  0 0 0 1px var(--line), 0 1px 2px rgb(26 26 23 / 0.06), 0 12px 32px -12px rgb(26 26 23 / 0.22);
  --elev-modal:  0 0 0 1px var(--line), 0 24px 64px -16px rgb(26 26 23 / 0.32);
  --elev-inpage: 0 0 0 1px var(--line-strong), 0 2px 4px rgb(26 26 23 / 0.10), 0 16px 40px -12px rgb(26 26 23 / 0.36);
  --blur-header: 12px;      /* the only blur */

  /* ---------- 8. Motion ---------- */
  --dur-1:      100ms;      /* colour/opacity: hover, press tint */
  --dur-2:      160ms;      /* switch thumb, segmented indicator, checkbox, chevron */
  --dur-3:      220ms;      /* popover, menu, tooltip, toast, popup sub-view enter */
  --dur-3-exit: 150ms;
  --dur-4:      300ms;      /* modal, sheet enter */
  --dur-4-exit: 210ms;
  --dur-expand: 220ms;      /* disclosure height */
  --dur-draw:   600ms;      /* fit-mark draw: website hero only, once per session */
  --delay-status:  300ms;   /* "Checking…" appears only if work exceeds this */
  --delay-tooltip: 500ms;
  --loop-analyzing: 1000ms; /* arc rotation period */
  --stop-analyzing: 5000ms; /* arc stops; label becomes "Still checking" */
  --ease:       cubic-bezier(0.22, 0.8, 0.26, 1);   /* the one curve: decisive start, soft settle */
  --ease-exit:  cubic-bezier(0.4, 0, 1, 1);
  --ease-linear: linear;                            /* progress arc only */
  --shift-1:    4px;
  --shift-2:    8px;        /* maximum travel for anything */
  --scale-enter: 0.98;
  --press-shift: 1px;

  /* ---------- 9. Layers ---------- */
  --z-base:     0;
  --z-raised:   10;
  --z-sticky:   100;
  --z-header:   200;
  --z-dropdown: 300;
  --z-popover:  350;
  --z-scrim:    400;
  --z-modal:    410;
  --z-toast:    500;
  --z-tooltip:  600;
  --z-skip:     700;
  --z-inpage:   2147483600; /* WebAble's shadow host on third-party pages */
}

/* ---------- Breakpoints (em: respond to the browser's default size) ----------
   sm 30em (480) · md 48em (768) · lg 64em (1024) · xl 80em (1280)
   Popup/side-panel components use container queries: stack pairs below 21.25rem (340). */
@media (min-width: 48em) {
  :root { --gutter: 1.5rem; --section-y: 6rem; }
}
@media (min-width: 64em) {
  :root {
    --gutter: 3rem; --section-y: 8rem; --header-h: 4rem;
    --text-display: 4rem; --text-h1: 2.75rem; --text-h2: 2rem; --text-h3: 1.5rem;
  }
}

/* ---------- Dark theme: system preference (unless the user chose light) ---------- */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --canvas:                #141412;
    --surface-raised:        #1C1C19;
    --surface-tonal:         #232320;
    --surface-hover:         #2C2C28;
    --surface-press:         #35352F;
    --surface-inverse:       #EDECE6;
    --surface-inverse-hover: #D6D5CE;
    --ink:                   #EDECE6;
    --ink-2:                 #C9C8BF;
    --ink-3:                 #A4A399;
    --on-inverse:            #141412;
    --on-inverse-2:          #45443E;
    --on-inverse-accent:     #2D6A3E;
    --line:                  #2F2F2A;
    --line-strong:           #85847B;
    --accent:                #8FCB9B;
    --accent-hover:          #A9D9B2;
    --accent-tint:           #1B2B1F;
    --on-accent:             #0F1A12;
    --action:                #EDECE6;
    --action-hover:          #FFFFFF;
    --action-press:          #D3D2CA;
    --on-action:             #141412;
    --warning:               #F2B75E;
    --warning-icon:          #F2B75E;
    --warning-tint:          #2E2412;
    --danger:                #FF9D93;
    --danger-hover:          #FFB7AF;
    --danger-tint:           #3A1B18;
    --on-danger:             #141412;
    --selection:             #2F4A36;
    --focus:                 #EDECE6;
    --focus-inverse:         #141412;
    --scrim:                 rgb(0 0 0 / 0.64);
    --header-bg:             rgb(20 20 18 / 0.92);
    --fit-fill:              rgb(143 203 155 / 0.10);
    --font-smoothing:        antialiased;
    --weight-medium:         520;
    --track-text:            0.008em;
    --track-meta:            0.012em;
    --elev-float:  inset 0 1px 0 rgb(255 255 255 / 0.06), 0 0 0 1px rgb(255 255 255 / 0.08), 0 16px 40px -12px rgb(0 0 0 / 0.70);
    --elev-modal:  inset 0 1px 0 rgb(255 255 255 / 0.06), 0 0 0 1px rgb(255 255 255 / 0.08), 0 24px 64px -16px rgb(0 0 0 / 0.75);
    --elev-inpage: 0 0 0 1px var(--line-strong), 0 16px 40px -12px rgb(0 0 0 / 0.60);
  }
}

/* ---------- Dark theme: explicit user choice ---------- */
:root[data-theme="dark"] {
  color-scheme: dark;
  --canvas:                #141412;
  --surface-raised:        #1C1C19;
  --surface-tonal:         #232320;
  --surface-hover:         #2C2C28;
  --surface-press:         #35352F;
  --surface-inverse:       #EDECE6;
  --surface-inverse-hover: #D6D5CE;
  --ink:                   #EDECE6;
  --ink-2:                 #C9C8BF;
  --ink-3:                 #A4A399;
  --on-inverse:            #141412;
  --on-inverse-2:          #45443E;
  --on-inverse-accent:     #2D6A3E;
  --line:                  #2F2F2A;
  --line-strong:           #85847B;
  --accent:                #8FCB9B;
  --accent-hover:          #A9D9B2;
  --accent-tint:           #1B2B1F;
  --on-accent:             #0F1A12;
  --action:                #EDECE6;
  --action-hover:          #FFFFFF;
  --action-press:          #D3D2CA;
  --on-action:             #141412;
  --warning:               #F2B75E;
  --warning-icon:          #F2B75E;
  --warning-tint:          #2E2412;
  --danger:                #FF9D93;
  --danger-hover:          #FFB7AF;
  --danger-tint:           #3A1B18;
  --on-danger:             #141412;
  --selection:             #2F4A36;
  --focus:                 #EDECE6;
  --focus-inverse:         #141412;
  --scrim:                 rgb(0 0 0 / 0.64);
  --header-bg:             rgb(20 20 18 / 0.92);
  --fit-fill:              rgb(143 203 155 / 0.10);
  --font-smoothing:        antialiased;
  --weight-medium:         520;
  --track-text:            0.008em;
  --track-meta:            0.012em;
  --elev-float:  inset 0 1px 0 rgb(255 255 255 / 0.06), 0 0 0 1px rgb(255 255 255 / 0.08), 0 16px 40px -12px rgb(0 0 0 / 0.70);
  --elev-modal:  inset 0 1px 0 rgb(255 255 255 / 0.06), 0 0 0 1px rgb(255 255 255 / 0.08), 0 24px 64px -16px rgb(0 0 0 / 0.75);
  --elev-inpage: 0 0 0 1px var(--line-strong), 0 16px 40px -12px rgb(0 0 0 / 0.60);
}

/* ---------- Reduced motion: OS setting ---------- */
@media (prefers-reduced-motion: reduce) {
  :root {
    --dur-2: 0ms; --dur-3: 100ms; --dur-3-exit: 100ms; --dur-4: 100ms; --dur-4-exit: 100ms;
    --dur-expand: 0ms; --dur-draw: 0ms; --loop-analyzing: 0ms;
    --shift-1: 0px; --shift-2: 0px; --scale-enter: 1; --press-shift: 0px;
  }
  *, *::before, *::after {
    animation-duration: 1ms !important; animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
  }
}
/* ---------- Reduced motion: WebAble profile (same values) ---------- */
:root[data-wa-motion="reduce"] {
  --dur-2: 0ms; --dur-3: 100ms; --dur-3-exit: 100ms; --dur-4: 100ms; --dur-4-exit: 100ms;
  --dur-expand: 0ms; --dur-draw: 0ms; --loop-analyzing: 0ms;
  --shift-1: 0px; --shift-2: 0px; --scale-enter: 1; --press-shift: 0px;
}
:root[data-wa-motion="reduce"] *, :root[data-wa-motion="reduce"] *::before, :root[data-wa-motion="reduce"] *::after {
  animation-duration: 1ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important;
}

/* ---------- More contrast: OS setting or profile. Specificity (0,2,0) and placed after
   the theme blocks so it wins over them; data-wa-contrast="standard" opts out. ---------- */
@media (prefers-contrast: more) {
  :root:not([data-wa-contrast="standard"]) {
    --ink-2: var(--ink); --ink-3: var(--ink); --line: var(--line-strong);
    --focus-width: 4px; --fit-fill: transparent;
  }
}
:root[data-wa-contrast="more"] {
  --ink-2: var(--ink); --ink-3: var(--ink); --line: var(--line-strong);
  --focus-width: 4px; --fit-fill: transparent;
}

/* ---------- Reduced transparency: solid header, no blur ---------- */
@media (prefers-reduced-transparency: reduce) {
  :root:not([data-wa-transparency="standard"]) { --header-bg: var(--canvas); --blur-header: 0px; }
}

/* ---------- Forced colours (Windows contrast themes) ---------- */
@media (forced-colors: active) {
  :root:not([data-wa-forced="off"]) { --fit-fill: transparent; }   /* (0,2,0): wins over the theme blocks */
  :focus-visible { outline-color: Highlight; }
  .wa-btn, .wa-input, .wa-switch__track, .wa-segmented, .wa-checkbox { border-color: ButtonText; }
  .wa-status-glyph, .wa-fit-mark, .wa-ruler { forced-color-adjust: auto; }
}

/* ---------- Base ---------- */
html {
  font-size: calc(100% * var(--wa-text-scale));   /* honours the browser default, then the profile */
  -webkit-text-size-adjust: 100%;
  background: var(--canvas); color: var(--ink);
}
body {
  margin: 0;
  font-family: var(--font-sans); font-weight: var(--weight-regular);
  font-size: var(--text-ui); line-height: var(--leading-ui); letter-spacing: var(--track-text);
  -webkit-font-smoothing: var(--font-smoothing);
  background: var(--canvas); color: var(--ink);
}
:focus-visible { outline: var(--focus-width) solid var(--focus); outline-offset: var(--focus-offset); }
.wa-inverse { --focus: var(--focus-inverse); }             /* toast, tooltip */
.wa-layer :focus-visible {                                  /* in-page shadow root */
  outline: var(--focus-width) solid var(--focus);
  outline-offset: var(--focus-offset);
  box-shadow: 0 0 0 var(--focus-halo) var(--surface-raised);
}
::selection { background: var(--selection); color: var(--ink); }
h1, h2, h3 { text-wrap: balance; }
p { text-wrap: pretty; }
.wa-num, td { font-variant-numeric: tabular-nums; }
```

---

## 5. Scales at a glance

### 5.1 Type scale (Atkinson Next unless marked Mono)

| Token | Size, base | Size, ≥ 64em | Line height | Tracking (light / dark) | Weight (light / dark) | Use |
|---|---|---|---|---|---|---|
| `--text-display` | 40 | 64 | 1.04 | −0.022em | 540 / 520 | Website hero only |
| `--text-h1` | 32 | 44 | 1.08 | −0.018em | 540 / 520 | Page title; calibration task title |
| `--text-h2` | 26 | 32 | 1.15 | −0.012em | 540 / 520 | Section title; app page title |
| `--text-h3` | 22 | 24 | 1.25 | −0.006em | 540 / 520 | Modal title, subsection |
| `--text-title` | 20 | 20 | 1.3 | 0 / +0.008em | 540 / 520 | Popup state line, row titles, wordmark |
| `--text-lead` | 20 | 20 | 1.5 + add | 0 / +0.008em | 400 | Intro paragraphs |
| `--text-body` | 18 | 18 | 1.6 + add | 0 / +0.008em | 400 | Reading text: website, calibration, explanations |
| `--text-ui` | 16 | 16 | 1.5 + add | 0 / +0.008em | 400 | App forms, popup body, inputs |
| `--text-label` | 16 | 16 | 1.25 | 0 / +0.008em | 540 / 520 | Buttons, field labels, nav, row labels |
| `--text-meta` (floor) | 15 | 15 | 1.45 + add | +0.006 / +0.012em | 400 | Hints, captions, domain line, legal |
| `--text-mono` (Mono) | 15 | 15 | 1.45 | 0 / +0.008em | 450 | Fit values, payload, `<kbd>` |
| `--text-readout` (Mono) | 28 | 28 | 1.1 | −0.01em | 450 | Big values on "Your fit" |

The fluid-size ratio is at most 1.6× (display), well under 2.5×, so 200% zoom still enlarges text (WCAG 1.4.4). The popup never reaches the ≥ 64em sizes.

### 5.2 Spacing

| Token | rem | px at scale 1 |
|---|---|---|
| `--space-0-5` | 0.125 | 2 |
| `--space-1` | 0.25 | 4 |
| `--space-2` | 0.5 | 8 |
| `--space-3` | 0.75 | 12 |
| `--space-4` | 1 | 16 |
| `--space-5` | 1.25 | 20 |
| `--space-6` | 1.5 | 24 |
| `--space-8` | 2 | 32 |
| `--space-10` | 2.5 | 40 |
| `--space-12` | 3 | 48 |
| `--space-16` | 4 | 64 |
| `--space-20` | 5 | 80 |
| `--space-24` | 6 | 96 |
| `--space-32` | 8 | 128 |

Semantic spacing:

| Token | Value |
|---|---|
| `--gutter` | 16 / 24 / 48 px (base / ≥ 48em / ≥ 64em) |
| `--section-y` | 64 / 96 / 128 px |
| `--section-head-gap` | 48 px |
| `--stack-tight` / `--stack` / `--stack-loose` | 8 / 16 / 24 px × `--wa-space-scale` |

**Vertical stack inside a block:** eyebrow → 8 → heading → 16 → deck → 32 → actions.

### 5.3 Radii

| Token | Value | Holds |
|---|---|---|
| `--radius-0` | 0 | Fit marks, index rule, calibration ruler |
| `--radius-1` | 4 px | Checkbox, `<kbd>`, tooltip, fit-mark label plate |
| `--radius-2` | 8 px | Input, select, media, row hover, payload well |
| `--radius-3` | 12 px | Panel, popover, toast, offer block, in-page chip, calibration stage |
| `--radius-4` | 20 px | Modal, sheet, hero and preview frame |
| `--radius-pill` | 999 px | Every button, switch, segmented control, status pill |

Nested radius = outer − padding. For example, the segmented container (pill) has 4 px padding and pill segments.

### 5.4 Elevation

| Token | Light | Dark | Used on |
|---|---|---|---|
| `--elev-0` | none | none | Everything by default |
| `--elev-float` | 1 px `--line` ring, 0 1 2 at 6%, 0 12 32 −12 at 22% | 6% top highlight, 8% white ring, 0 16 40 −12 at 70% black | Popover, menu, toast, select list |
| `--elev-modal` | 1 px ring, 0 24 64 −16 at 32% | top highlight, ring, 0 24 64 −16 at 75% | Modal, sheet |
| `--elev-inpage` | 1 px `--line-strong` ring, 0 2 4 at 10%, 0 16 40 −12 at 36% | 1 px `--line-strong`, 0 16 40 −12 at 60% | In-page chip and toast on host pages |

The only blur is `--blur-header` (12 px) on the site and app header. It becomes 0 under reduced transparency.

### 5.5 Motion

| Token | Value | Reduced motion |
|---|---|---|
| `--dur-1` | 100 ms (colour, opacity) | 100 ms (colour isn't motion) |
| `--dur-2` | 160 ms (switch, segmented, checkbox, chevron) | 0 ms |
| `--dur-3` / `--dur-3-exit` | 220 / 150 ms (popover, tooltip, toast, popup sub-view) | 100 / 100 ms, opacity only |
| `--dur-4` / `--dur-4-exit` | 300 / 210 ms (modal, sheet) | 100 / 100 ms, opacity only |
| `--dur-expand` | 220 ms (disclosure height) | 0 ms |
| `--dur-draw` | 600 ms (hero fit mark, once per session) | 0 ms (static) |
| `--delay-status` | 300 ms | 300 ms |
| `--delay-tooltip` | 500 ms | 500 ms |
| `--loop-analyzing` / `--stop-analyzing` | 1000 ms / 5000 ms | static half-ring |
| `--ease` | `cubic-bezier(0.22, 0.8, 0.26, 1)` | — |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | — |
| `--shift-1` / `--shift-2` | 4 / 8 px | 0 / 0 px |
| `--scale-enter` | 0.98 | 1 |
| `--press-shift` | 1 px | 0 px |

### 5.6 Z-index

| Token | Value |
|---|---|
| `--z-base` | 0 |
| `--z-raised` | 10 |
| `--z-sticky` | 100 |
| `--z-header` | 200 |
| `--z-dropdown` | 300 |
| `--z-popover` | 350 |
| `--z-scrim` | 400 |
| `--z-modal` | 410 |
| `--z-toast` | 500 |
| `--z-tooltip` | 600 |
| `--z-skip` | 700 |
| `--z-inpage` | 2147483600 (the extension's shadow host) |

### 5.7 Breakpoints

All breakpoints are in em, so they respond to the user's browser default size. They are written as `min-width` queries.

| Name | Value | What changes |
|---|---|---|
| base | < 30em | One column. Button pairs go full width. Mobile header 56. |
| sm | 30em (480 px) | Pairs keep their natural width. |
| md | 48em (768 px) | Gutter 24. Section spacing 96. Footer in 2 columns. |
| lg | 64em (1024 px) | Header 64 with inline nav. App rail. Heading steps up. Gutter 48. Section spacing 128. Footer in 4 columns. |
| xl | 80em (1280 px) | Content capped at `--w-content`. Hero uses `--w-wide`. |
| container | 21.25rem (340 px) inline size | Popup and side panel: offer and action pairs stack full width below this. |
| height | min-height 37.5em (600 px) | Site/app header is `position: sticky` only at or above this height. |

**Reflow:** every layout works at 320 CSS px wide (1280 at 400% zoom) with no horizontal scroll. The popup works down to 280 CSS px.

### 5.8 Containers and fixed dimensions

| Token | Value | Use |
|---|---|---|
| `--w-prose` | 35rem (560) | Reading measure, about 67 characters at 18 px |
| `--w-form` | 30rem (480) | Sign-in and account forms |
| `--w-task` | 45rem (720) | Calibration column |
| `--w-content` | 76rem (1216) | Site and app content |
| `--w-wide` | 90rem (1440) | Hero media |
| `--w-modal` | 35rem (560) | Modal |
| `--w-rail` | 15rem (240) | App rail |
| `--w-popup` | 23.75rem (380 at scale 1) | Popup width. Grows with text scale up to Chrome's 800 cap |
| `--h-popup-max` | 600 px | Chrome's popup height cap |
| `--w-toast` | 27.5rem (440) | Toast |
| `--w-tooltip` | 17.5rem (280) | Tooltip |
| `--w-inpage-chip` | 25rem (400) | In-page offer chip |
| `--header-h` | 56 → 64 at ≥ 64em | Site/app header |
| `--popup-header-h` | 56 | Popup header |
| `--popup-footer-h` | 48 | Popup footer |
| `--popup-pad` | 16 | Popup side padding (content 348 at scale 1, about 47 characters at 16 px) |
| `--task-bar-h` | 64 | Calibration top bar |
| `--task-actions-h` | 96 | Calibration action bar |
| `--stage-min-h` | 360 | Calibration stage |

### 5.9 Targets and controls

| Token | Value | Rule |
|---|---|---|
| `--target-min` | `max(2.75rem, var(--wa-target-min))` | 44 px by default. The profile raises it to 56, 72 or 96. |
| `--control-sm` | 36 visual | Hit area extended to `--target-min` by `::after`. Dense app tables only. |
| `--control-md` | 44 | Icon buttons, nav, row actions, toast, in-page chip |
| `--control-lg` | 48 | Default buttons, inputs, popup primary, offer pair |
| `--control-task` | 64 | Calibration responses and navigation, with ≥ 16 px gaps (`cal-vision.md` §3) |
| `--row-min` | 56 | List, switch and disclosure rows |
| Adjacent targets | ≥ 8 px apart | — |

Every control uses `min-height: max(<control>, var(--target-min))`. Nothing that contains text has a fixed `height`, so WCAG 1.4.12 text-spacing overrides and extra leading never clip.

---

## 6. Contrast verification (computed)

Method: the WCAG 2.x relative luminance with sRGB linearization and ratio (L1 + 0.05) / (L2 + 0.05), computed in Node 24 by `scratchpad/design-final/table.mjs` from `tokens-final.json`. The values are identical to the CSS in §4.

**Targets**

| Kind | Target |
|---|---|
| Body and secondary text | ≥ 7:1 |
| Tertiary, accent and status text | ≥ 4.5:1 |
| Non-text (WCAG 1.4.11) and focus rings | ≥ 3:1 |
| Calibration stimuli | ≥ 15:1 |

**Result: 81 token pairs, each computed in both themes (162 ratios), 0 failures.**

| Pair | Kind | Light fg / bg | Light ratio | Dark fg / bg | Dark ratio | Target | Result | Used for |
|---|---|---|---|---|---|---|---|---|
| `ink` on `canvas` | text | #1A1A17 / #FAFAF7 | **16.68** | #EDECE6 / #141412 | **15.58** | 7 | pass | Body, headings, labels, links |
| `ink` on `raised` | text | #1A1A17 / #FFFFFF | **17.44** | #EDECE6 / #1C1C19 | **14.43** | 7 | pass | Body, headings, labels, links |
| `ink` on `tonal` | text | #1A1A17 / #F2F1EC | **15.42** | #EDECE6 / #232320 | **13.31** | 7 | pass | Body, headings, labels, links |
| `ink` on `hover` | text | #1A1A17 / #E9E8E2 | **14.21** | #EDECE6 / #2C2C28 | **11.84** | 7 | pass | Body, headings, labels, links |
| `ink` on `press` | text | #1A1A17 / #DFDED7 | **12.93** | #EDECE6 / #35352F | **10.43** | 7 | pass | Body, headings, labels, links |
| `ink-2` on `canvas` | text | #45443E / #FAFAF7 | **9.34** | #C9C8BF / #141412 | **10.98** | 7 | pass | Secondary text, decks, hints, nav links |
| `ink-2` on `raised` | text | #45443E / #FFFFFF | **9.77** | #C9C8BF / #1C1C19 | **10.16** | 7 | pass | Secondary text, decks, hints, nav links |
| `ink-2` on `tonal` | text | #45443E / #F2F1EC | **8.64** | #C9C8BF / #232320 | **9.38** | 7 | pass | Secondary text, decks, hints, nav links |
| `ink-2` on `hover` | text | #45443E / #E9E8E2 | **7.96** | #C9C8BF / #2C2C28 | **8.34** | 7 | pass | Secondary text, decks, hints, nav links |
| `ink-2` on `press` | text | #45443E / #DFDED7 | **7.24** | #C9C8BF / #35352F | **7.34** | 7 | pass | Secondary text, decks, hints, nav links |
| `ink-3` on `canvas` | text | #5E5D56 / #FAFAF7 | **6.32** | #A4A399 / #141412 | **7.27** | 4.5 | pass | Meta, placeholders, disabled labels |
| `ink-3` on `raised` | text | #5E5D56 / #FFFFFF | **6.61** | #A4A399 / #1C1C19 | **6.73** | 4.5 | pass | Meta, placeholders, disabled labels |
| `ink-3` on `tonal` | text | #5E5D56 / #F2F1EC | **5.85** | #A4A399 / #232320 | **6.21** | 4.5 | pass | Meta, placeholders, disabled labels |
| `ink-3` on `hover` | text | #5E5D56 / #E9E8E2 | **5.39** | #A4A399 / #2C2C28 | **5.53** | 4.5 | pass | Meta, placeholders, disabled labels |
| `ink-3` on `press` | text | #5E5D56 / #DFDED7 | **4.90** | #A4A399 / #35352F | **4.86** | 4.5 | pass | Meta, placeholders, disabled labels |
| `accent` on `canvas` | text | #2D6A3E / #FAFAF7 | **6.19** | #8FCB9B / #141412 | **9.82** | 4.5 | pass | After-value in fit marks, "Adapted" label |
| `accent` on `raised` | text | #2D6A3E / #FFFFFF | **6.48** | #8FCB9B / #1C1C19 | **9.10** | 4.5 | pass | After-value in fit marks, "Adapted" label |
| `accent` on `tonal` | text | #2D6A3E / #F2F1EC | **5.73** | #8FCB9B / #232320 | **8.39** | 4.5 | pass | After-value in fit marks, "Adapted" label |
| `accent` on `hover` | text | #2D6A3E / #E9E8E2 | **5.28** | #8FCB9B / #2C2C28 | **7.47** | 4.5 | pass | After-value in fit marks, "Adapted" label |
| `accent` on `accent-tint` | text | #2D6A3E / #E4EFE6 | **5.49** | #8FCB9B / #1B2B1F | **7.92** | 4.5 | pass | After-value in fit marks, "Adapted" label |
| `accent-hover` on `canvas` | text | #22552F / #FAFAF7 | **8.34** | #A9D9B2 / #141412 | **11.64** | 4.5 | pass | Accent text on hover |
| `accent-hover` on `raised` | text | #22552F / #FFFFFF | **8.72** | #A9D9B2 / #1C1C19 | **10.78** | 4.5 | pass | Accent text on hover |
| `accent-hover` on `tonal` | text | #22552F / #F2F1EC | **7.71** | #A9D9B2 / #232320 | **9.95** | 4.5 | pass | Accent text on hover |
| `warning` on `canvas` | text | #7A4800 / #FAFAF7 | **7.29** | #F2B75E / #141412 | **10.29** | 4.5 | pass | Warning message text |
| `warning` on `raised` | text | #7A4800 / #FFFFFF | **7.62** | #F2B75E / #1C1C19 | **9.52** | 4.5 | pass | Warning message text |
| `warning` on `tonal` | text | #7A4800 / #F2F1EC | **6.74** | #F2B75E / #232320 | **8.79** | 4.5 | pass | Warning message text |
| `warning` on `warning-tint` | text | #7A4800 / #FAEFD9 | **6.68** | #F2B75E / #2E2412 | **8.50** | 4.5 | pass | Warning message text |
| `danger` on `canvas` | text | #A3241C / #FAFAF7 | **7.11** | #FF9D93 / #141412 | **9.22** | 4.5 | pass | Error message text, destructive outline button |
| `danger` on `raised` | text | #A3241C / #FFFFFF | **7.43** | #FF9D93 / #1C1C19 | **8.54** | 4.5 | pass | Error message text, destructive outline button |
| `danger` on `tonal` | text | #A3241C / #F2F1EC | **6.57** | #FF9D93 / #232320 | **7.88** | 4.5 | pass | Error message text, destructive outline button |
| `danger` on `danger-tint` | text | #A3241C / #FBE9E6 | **6.33** | #FF9D93 / #3A1B18 | **7.78** | 4.5 | pass | Error message text, destructive outline button |
| `ink` on `accent-tint` | text | #1A1A17 / #E4EFE6 | **14.77** | #EDECE6 / #1B2B1F | **12.57** | 7 | pass | Text on tints and selection |
| `ink` on `warning-tint` | text | #1A1A17 / #FAEFD9 | **15.29** | #EDECE6 / #2E2412 | **12.88** | 7 | pass | Text on tints and selection |
| `ink` on `danger-tint` | text | #1A1A17 / #FBE9E6 | **14.87** | #EDECE6 / #3A1B18 | **13.14** | 7 | pass | Text on tints and selection |
| `ink` on `selection` | text | #1A1A17 / #CFE2D3 | **12.85** | #EDECE6 / #2F4A36 | **8.24** | 7 | pass | Text on tints and selection |
| `ink-2` on `accent-tint` | text | #45443E / #E4EFE6 | **8.28** | #C9C8BF / #1B2B1F | **8.85** | 7 | pass | Secondary text on tints |
| `ink-2` on `warning-tint` | text | #45443E / #FAEFD9 | **8.57** | #C9C8BF / #2E2412 | **9.07** | 7 | pass | Secondary text on tints |
| `ink-2` on `danger-tint` | text | #45443E / #FBE9E6 | **8.33** | #C9C8BF / #3A1B18 | **9.26** | 7 | pass | Secondary text on tints |
| `on-action` on `action` | text | #FFFFFF / #1A1A17 | **17.44** | #141412 / #EDECE6 | **15.58** | 7 | pass | Primary button label (default / hover / active) |
| `on-action` on `action-hover` | text | #FFFFFF / #3A3934 | **11.57** | #141412 / #FFFFFF | **18.44** | 7 | pass | Primary button label (default / hover / active) |
| `on-action` on `action-press` | text | #FFFFFF / #000000 | **21.00** | #141412 / #D3D2CA | **12.16** | 7 | pass | Primary button label (default / hover / active) |
| `on-accent` on `accent` | text | #FFFFFF / #2D6A3E | **6.48** | #0F1A12 / #8FCB9B | **9.50** | 4.5 | pass | Check glyph and label on accent fills |
| `on-accent` on `accent-hover` | text | #FFFFFF / #22552F | **8.72** | #0F1A12 / #A9D9B2 | **11.26** | 4.5 | pass | Check glyph and label on accent fills |
| `on-danger` on `danger` | text | #FFFFFF / #A3241C | **7.43** | #141412 / #FF9D93 | **9.22** | 4.5 | pass | Filled destructive confirm button |
| `on-danger` on `danger-hover` | text | #FFFFFF / #85190F | **9.80** | #141412 / #FFB7AF | **11.11** | 4.5 | pass | Filled destructive confirm button |
| `on-inverse` on `inverse` | text | #F3F2EC / #1F1F1C | **14.73** | #141412 / #EDECE6 | **15.58** | 7 | pass | Toast and tooltip text; toast action on hover |
| `on-inverse` on `inverse-hover` | text | #F3F2EC / #34342F | **11.16** | #141412 / #D6D5CE | **12.53** | 7 | pass | Toast and tooltip text; toast action on hover |
| `on-inverse-2` on `inverse` | text | #C9C8C0 / #1F1F1C | **9.84** | #45443E / #EDECE6 | **8.25** | 4.5 | pass | Toast secondary text |
| `on-inverse-accent` on `inverse` | text | #9DD1A6 / #1F1F1C | **9.52** | #2D6A3E / #EDECE6 | **5.47** | 4.5 | pass | Toast "applied" glyph |
| `badge-accent-ink` on `badge-accent` | text | #FFFFFF / #2D6A3E | **6.48** | #FFFFFF / #2D6A3E | **6.48** | 4.5 | pass | Toolbar badge: change count |
| `badge-warn-ink` on `badge-warn` | text | #1A1A17 / #F0B45C | **9.46** | #1A1A17 / #F0B45C | **9.46** | 4.5 | pass | Toolbar badge: "!" |
| `stimulus` on `stage` | text | #111111 / #FFFFFF | **18.88** | #111111 / #FFFFFF | **18.88** | 15 | pass | Calibration stimuli (fixed in both themes) |
| `line-strong` on `canvas` | non-text | #7D7C73 / #FAFAF7 | **4.01** | #85847B / #141412 | **4.90** | 3 | pass | Control boundaries: inputs, secondary buttons, switch-off track, checkbox, upcoming ruler |
| `line-strong` on `raised` | non-text | #7D7C73 / #FFFFFF | **4.20** | #85847B / #1C1C19 | **4.54** | 3 | pass | Control boundaries: inputs, secondary buttons, switch-off track, checkbox, upcoming ruler |
| `line-strong` on `tonal` | non-text | #7D7C73 / #F2F1EC | **3.71** | #85847B / #232320 | **4.19** | 3 | pass | Control boundaries: inputs, secondary buttons, switch-off track, checkbox, upcoming ruler |
| `line-strong` on `hover` | non-text | #7D7C73 / #E9E8E2 | **3.42** | #85847B / #2C2C28 | **3.73** | 3 | pass | Control boundaries: inputs, secondary buttons, switch-off track, checkbox, upcoming ruler |
| `line-strong` on `press` | non-text | #7D7C73 / #DFDED7 | **3.11** | #85847B / #35352F | **3.28** | 3 | pass | Control boundaries: inputs, secondary buttons, switch-off track, checkbox, upcoming ruler |
| `accent` on `canvas` | non-text | #2D6A3E / #FAFAF7 | **6.19** | #8FCB9B / #141412 | **9.82** | 3 | pass | Switch-on track, fit outline, adapted status disc, offer rule |
| `accent` on `raised` | non-text | #2D6A3E / #FFFFFF | **6.48** | #8FCB9B / #1C1C19 | **9.10** | 3 | pass | Switch-on track, fit outline, adapted status disc, offer rule |
| `accent` on `tonal` | non-text | #2D6A3E / #F2F1EC | **5.73** | #8FCB9B / #232320 | **8.39** | 3 | pass | Switch-on track, fit outline, adapted status disc, offer rule |
| `warning-icon` on `canvas` | non-text | #A36200 / #FAFAF7 | **4.67** | #F2B75E / #141412 | **10.29** | 3 | pass | Warning triangle glyph |
| `warning-icon` on `raised` | non-text | #A36200 / #FFFFFF | **4.88** | #F2B75E / #1C1C19 | **9.52** | 3 | pass | Warning triangle glyph |
| `warning-icon` on `tonal` | non-text | #A36200 / #F2F1EC | **4.31** | #F2B75E / #232320 | **8.79** | 3 | pass | Warning triangle glyph |
| `warning-icon` on `warning-tint` | non-text | #A36200 / #FAEFD9 | **4.28** | #F2B75E / #2E2412 | **8.50** | 3 | pass | Warning triangle glyph |
| `ink-2` on `canvas` | non-text | #45443E / #FAFAF7 | **9.34** | #C9C8BF / #141412 | **10.98** | 3 | pass | Switch-off thumb, status glyphs |
| `ink-2` on `tonal` | non-text | #45443E / #F2F1EC | **8.64** | #C9C8BF / #232320 | **9.38** | 3 | pass | Switch-off thumb, status glyphs |
| `on-inverse-2` on `inverse` | non-text | #C9C8C0 / #1F1F1C | **9.84** | #45443E / #EDECE6 | **8.25** | 3 | pass | Toast action button ring |
| `focus` on `canvas` | focus | #1A1A17 / #FAFAF7 | **16.68** | #EDECE6 / #141412 | **15.58** | 3 | pass | Focus ring (3px, 2px offset) on every surface it can sit on |
| `focus` on `raised` | focus | #1A1A17 / #FFFFFF | **17.44** | #EDECE6 / #1C1C19 | **14.43** | 3 | pass | Focus ring (3px, 2px offset) on every surface it can sit on |
| `focus` on `tonal` | focus | #1A1A17 / #F2F1EC | **15.42** | #EDECE6 / #232320 | **13.31** | 3 | pass | Focus ring (3px, 2px offset) on every surface it can sit on |
| `focus` on `hover` | focus | #1A1A17 / #E9E8E2 | **14.21** | #EDECE6 / #2C2C28 | **11.84** | 3 | pass | Focus ring (3px, 2px offset) on every surface it can sit on |
| `focus` on `press` | focus | #1A1A17 / #DFDED7 | **12.93** | #EDECE6 / #35352F | **10.43** | 3 | pass | Focus ring (3px, 2px offset) on every surface it can sit on |
| `focus` on `accent-tint` | focus | #1A1A17 / #E4EFE6 | **14.77** | #EDECE6 / #1B2B1F | **12.57** | 3 | pass | Focus ring (3px, 2px offset) on every surface it can sit on |
| `focus` on `warning-tint` | focus | #1A1A17 / #FAEFD9 | **15.29** | #EDECE6 / #2E2412 | **12.88** | 3 | pass | Focus ring (3px, 2px offset) on every surface it can sit on |
| `focus` on `danger-tint` | focus | #1A1A17 / #FBE9E6 | **14.87** | #EDECE6 / #3A1B18 | **13.14** | 3 | pass | Focus ring (3px, 2px offset) on every surface it can sit on |
| `focus` on `selection` | focus | #1A1A17 / #CFE2D3 | **12.85** | #EDECE6 / #2F4A36 | **8.24** | 3 | pass | Focus ring (3px, 2px offset) on every surface it can sit on |
| `focus-inverse` on `inverse` | focus | #F3F2EC / #1F1F1C | **14.73** | #141412 / #EDECE6 | **15.58** | 3 | pass | Focus ring inside toast/tooltip (scoped override) |
| `ink` on header (92% canvas over worst-case content) | text | #1A1A17 / #E6E6E3 | **13.95** | #EDECE6 / #272725 | **12.64** | 7 | pass | Sticky header over scrolled content |
| fit-outline `accent` vs its `#FFFFFF` casing (in-page) | non-text | #2D6A3E / #FFFFFF | **6.48** | same (in-page layer always uses light accent) | **6.48** | 3 | pass | Outline visible on any page colour |
| in-page focus `focus` vs `#FFFFFF` halo | focus | #1A1A17 / #FFFFFF | **17.44** | #EDECE6 / #1C1C19 halo | **14.43** | 3 | pass | Focus inside WebAble's layer on arbitrary pages |
| in-page chip edge `line-strong` vs white page | non-text | #7D7C73 / #FFFFFF | **4.20** | #85847B / #FFFFFF | **3.76** | 3 | pass | Chip boundary on host pages |

### 6.1 Defects found and fixed during computation

| Defect | Measured | Fix | After |
|---|---|---|---|
| Dark `--ink-2` `#C4C3BA` on `--surface-press` | 6.97:1 (below 7) | Lightened to `#C9C8BF` | 7.34:1 |
| Light `--line-strong` `#85847B` on `--surface-press` | 2.79:1 (below 3) | Darkened to `#7D7C73` | 3.11:1 |
| Dark `--line-strong` `#7C7B72` on `--surface-press` | 2.90:1 | Lightened to `#85847B` | 3.28:1 |
| **Ink focus ring inside the inverse toast/tooltip surface** | **1.06:1 light, 1.00:1 dark** | Scoped override `.wa-inverse { --focus: var(--focus-inverse) }` | 14.73 / 15.58:1 |
| Typed arrow glyphs (→ ↗ ↺ ✓) missing from both fonts | fallback rendering | Always inline SVG (§3.4, §11) | — |

`--line` (1.28:1 light, 1.37:1 dark) is **decorative only**. It is never the only boundary of a control; control boundaries use `--line-strong`.

### 6.2 Colour-vision check (OKLab distance × 100, Machado 2009 severity 1.0)

Scale: below 5 is hard to tell apart; above 10 is clearly different.

| Pair | Light: normal / protan / deutan / tritan | Dark: normal / protan / deutan / tritan |
|---|---|---|
| adapted (accent) vs warning | 17.1 / 5.4 / 12.0 / 21.6 | 13.8 / 7.1 / 9.3 / 17.3 |
| adapted vs danger | 22.9 / 11.0 / **5.1** / 26.6 | 18.6 / 7.1 / **2.5** / 20.3 |
| adapted vs neutral glyph | 12.4 / 11.9 / 9.2 / 11.4 | 9.4 / **4.8** / 5.1 / 8.5 |

Green against red collapses for deuteranopes in the dark theme (2.5). This is unavoidable for any green/red pair, so **every state is carried by glyph shape first, then by a word, and only then by colour** (§7.13), and colour is never the only cue (WCAG 1.4.1). Danger colour appears only in error messages, never next to an adapted disc.

---

## 7. Component anatomy

**Rules for every component**
- Semantic tokens only.
- `min-height`, never `height`.
- The hit area is at least `--target-min`.
- `:focus-visible` = 3 px `--focus` outline with a 2 px offset (4 px under more contrast).
- Hover styles sit under `@media (hover: hover) and (pointer: fine)`.
- Pressed = the press surface plus `translateY(var(--press-shift))`, never a scale.
- **Disabled is never faded.** Use `aria-disabled="true"`, an `--ink-3` label, a **dashed** 1 px `--line-strong` edge, `cursor: not-allowed`, and a one-line reason in `--text-meta`/`--ink-2`, linked with `aria-describedby`.
- Prefer an enabled control that explains itself when activated.

### 7.1 Buttons

**Sizes**

| Size | Min height | Padding-inline | Label | Icon | Gap | Use |
|---|---|---|---|---|---|---|
| sm | 36 visual (hit `--target-min` via `::after` with inset −4 px 0) | 14 | 15 / medium | 16 | 6 | Dense app tables only. Never in the popup or calibration |
| md | `max(44, --target-min)` | 16 | 16 / medium | 20 | 8 | Nav, popup row actions, toast, in-page chip, icon buttons |
| lg (default) | `max(48, --target-min)` | 20 | 16 / medium | 20 | 8 | Everywhere else, including the popup primary and the offer pair |
| task | `max(64, --target-min)` | 28 | 18 / medium | 24 | 10 | Calibration only |

**Shared anatomy**
- `inline-flex`, pill radius, `line-height: var(--leading-label)`.
- A 1 px border in every variant (transparent where invisible), so states never shift layout and forced colours draw an edge.
- Width is intrinsic. Buttons go full width below 30em, in popup pairs, and in the calibration action bar on mobile.
- Pairs: primary first, left-aligned, 12 px gap (8 px in the popup). They stack below the 340 px container width.
- A trailing arrow-right SVG (20 px) means "goes somewhere". Arrow-up-right (16 px) plus sr-only "(opens in a new tab)" means "opens elsewhere".

**States**

| Variant | Default | Hover | Active (pressed) | Focus-visible | Disabled |
|---|---|---|---|---|---|
| **Primary** (one per region) | `--action` fill, `--on-action` text, transparent border | `--action-hover` over `--dur-1` | `--action-press` + 1 px down | Ring on the surrounding surface (16.68:1 on canvas) | `--surface-tonal` fill, `--ink-3` text, dashed `--line-strong`, reason line |
| **Secondary** | Transparent, `--ink` text, 1 px `--line-strong` | `--surface-hover` fill | `--surface-press` + 1 px down | Ring | `--ink-3` text, dashed border |
| **Ghost** (tertiary, nav, "Show on page") | Transparent, `--ink` text, transparent border | `--surface-hover` fill | `--surface-press` + 1 px down | Ring | `--ink-3` text; reason line |
| **Danger (outline)** | Transparent, `--danger` text, 1 px `--danger` | `--danger-tint` fill | `--danger-tint` + 1 px down | Ring | `--ink-3` text, dashed border |
| **Danger (filled)**, final confirm in a modal only | `--danger` fill, `--on-danger` text | `--danger-hover` | `--danger-hover` + 1 px down | Ring | not used |
| **Icon button** (md, 44 × 44, circle) | Ghost, 20 px glyph in `--ink-2`, `aria-label` plus tooltip | `--surface-hover` fill, glyph `--ink` | `--surface-press` | Ring (circular) | Glyph `--ink-3` |

**Busy:** the label changes to the gerund ("Saving…"), width is locked, and `aria-busy="true"` is set. No spinner inside buttons.

### 7.2 Link

| State | Treatment |
|---|---|
| Default | `--ink`, underline 1 px, `text-underline-offset: 0.18em` |
| Hover | Underline 2 px |
| Active | `--ink-2` |
| Focus-visible | Ring with `border-radius: 4px` |
| Visited | Same as default |
| Disabled | Not used. Remove the link and state why |

- **External:** a 16 px arrow-up-right SVG after the text, plus sr-only text.
- Links inside `--ink-2` text stay `--ink`.

### 7.3 Switch

```
┌───────────────────────────────────────────────────────── row ≥ 56 ─┐
│ WebAble on this site                               On   ╭──────╮   │
│ (optional 15/ink-2 description)                         │   ✓● │   │  track 52×32, border 2
└────────────────────────────────────────────────────────────────────┘ ╰──────╯
```

**Anatomy**
- The whole row is one `<button role="switch" aria-checked>`. Padding 8 0; grid `1fr auto auto`; gap 12.
- The label (16 / medium, `--ink`) is the accessible name.
- A state word ("On" / "Off", 15 / medium, `--ink-2`) is always visible.
- Track 52 × 32 with a 2 px border; inner 48 × 28. Thumb 20 px, inset 4 px. Travel 20 px over `--dur-2` with `--ease`.
- **Accent rule:** the on-track is `--accent` only when the switch changes a page (for example "WebAble on this site", "Bigger click targets"). Settings switches use `--action`.

| State | Off | On |
|---|---|---|
| Default | Track `--surface-raised`, border `--line-strong`; thumb `--ink-2` at left | Track and border `--accent` (or `--action`); thumb `--on-accent` at right, containing a 12 px check SVG (stroke 2) in `--accent` |
| Hover | Row fill `--surface-hover`, radius 8 | Same |
| Active | Row fill `--surface-press` | Same |
| Focus-visible | Ring around the row, radius 8 | Same |
| Disabled | Border dashed `--line-strong`, thumb `--ink-3`, state word `--ink-3`, reason line | Track `--surface-tonal`, dashed border, thumb `--ink-3` |

### 7.4 Checkbox

**Anatomy**
- Box 20 × 20, radius 4, 2 px `--line-strong` border, `--surface-raised` fill.
- Row min-height 44, label 16 `--ink`, gap 12. The label is the hit area.

| State | Treatment |
|---|---|
| Checked | `--action` fill and border, 14 px check SVG in `--on-action`, stroke 2 |
| Indeterminate | 10 × 2 bar in `--on-action` |
| Hover | Border `--ink-2` |
| Active | Unchecked fill `--surface-press` |
| Focus | Ring on the box, offset 2 |
| Disabled | Dashed border; label `--ink-3` |

### 7.5 Segmented control

```
╭──────────────────────────────────────────────────╮
│ ╭─────────────╮                                  │  container: --surface-tonal, pill, padding 4, min-height 52
│ │  Original   │    Fitted        Compare         │  segments: min-height 44, padding 0 16, 16/medium --ink-2
│ ╰─────────────╯                                  │  selected: --surface-raised, 1px --line-strong, --ink
╰──────────────────────────────────────────────────╯
```

**Behaviour**
- Radio-group semantics with a roving tabindex. Arrow keys move the selection; Tab leaves the group.
- The indicator slides over `--dur-2` with `--ease`, and jumps under reduced motion.
- 2 to 4 segments. With more, or if a label would wrap at 20em, use a native `<select>`.

| State | Treatment |
|---|---|
| Default (unselected) | `--ink-2` text |
| Hover (unselected) | `--ink` text plus a `--surface-hover` pill |
| Active | `--surface-press` |
| Focus | Ring on the segment |
| Disabled | `--ink-3` text, no hover |
| Selected | Raised fill plus a line-strong edge (a shape cue, so it isn't colour alone) |

### 7.6 Slider, always with a stepper

```
Text size                                                  18 px      ← label 16/medium · value Mono 15, accent if it changes the page
╭────╮   ├────┼────┼────●━━━━┼────┼────┼────┤   ╭────╮
│ −  │   14             18                  32   │ +  │               ← − / + : secondary md icon buttons, 44×44
╰────╯                                          ╰────╯
```

**Anatomy**
- **Track:** 6 px, pill, `--line-strong`. Fill `--accent` (page-changing) or `--ink`.
- **Thumb:** 28 px circle, `--surface-raised` fill, 2 px `--ink` border, 44 px hit area.
- **Ticks:** 1 × 8 px, `--line-strong`, at every allowed step, because profile values are ladders. End labels are meta 15 `--ink-3`; intermediate labels show only at ≥ 30em.
- **Keyboard:** arrows ±1 step, Page Up/Down ±3, Home/End go to the ends. `aria-valuetext="18 pixels"`.
- **Preview:** the live preview commits after 150 ms without movement. It never animates the page while dragging.

| State | Treatment |
|---|---|
| Hover | Thumb border 3 px |
| Active | Thumb fill `--surface-press` |
| Focus | Ring on the thumb |
| Disabled | Fill `--line-strong`, thumb border dashed, steppers `aria-disabled` |

The stepper is mandatory, because WCAG 2.5.7 requires a single-pointer alternative to dragging.

### 7.7 Text input and select

```
Email                                        ← label 16/medium --ink, above; "(required)" in words
┌──────────────────────────────────────┐
│ name@example.com                      │   min-height 48 · radius 8 · padding 0 14 · --surface-raised
└──────────────────────────────────────┘   1px --line-strong · text 16/400 --ink · placeholder --ink-3 (examples only)
We'll send a sign-in link. No password.     ← hint meta 15 --ink-2, 8 below
```

| State | Treatment |
|---|---|
| Default | As drawn |
| Hover | Border `--ink-2` |
| Focus-visible | Ring plus border `--ink` |
| Error | Border `--danger` plus `inset 0 0 0 1px var(--danger)` (2 px total, no shift). A message row below: a 20 px triangle-alert SVG and 15 / medium `--danger` text that says what to do ("Add the @ and the domain, like name@example.com"). `aria-invalid`, `aria-describedby`. The value is kept |
| Disabled | `--surface-tonal` fill, dashed `--line-strong`, text `--ink-3` |
| Read-only | `--surface-tonal` fill, solid `--line` |

- **Success:** no green border, only inline text where it matters.
- Autocomplete attributes are always set. Paste is never blocked.
- **Select:** same box, a 20 px chevron-down SVG at the right, 14 px in; right padding 44. Always the native element.

### 7.8 Site header (nav bar)

```
≥64em · 64 · sticky only if viewport ≥ 37.5em tall · --header-bg + blur 12 · hairline after 8px scroll
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ [mark] WebAble     How it works   Privacy   Research   Help            Sign in  [Add to Chrome →] │
└──────────────────────────────────────────────────────────────────────────────────────────┘
  mark 24 + wordmark 20/medium    links 16/medium --ink-2, hit 44, padding 0 12, gap 8     ghost md   primary md
```

**Links**

| State | Treatment |
|---|---|
| Default | `--ink-2` |
| Hover | `--ink` |
| Active | `--ink`, pressed fill `--surface-press`, radius 8 |
| Current | `--ink`, a 2 px `--ink` underline 6 px below the baseline, `aria-current="page"` |
| Focus | Ring, radius 8 |

**Header behaviour**
- It **never hides based on scroll direction.**
- It has no border at rest. A 1 px `--line` appears after 8 px of scroll.

**Below 64em (56 tall)**
- Mark and wordmark, then [Add to Chrome] primary md (hidden below 30em), then a 48 × 48 **Menu** button with the visible word "Menu" and a 20 px menu SVG.
- The sheet is full screen on `--canvas`:
  - a Close button (48 × 48) at the top right;
  - rows 56 tall at 20 / medium, separated by hairlines;
  - the primary lg button pinned at the bottom, full width, with 16 px plus safe-area padding.
  - Esc closes it, and focus returns to Menu.

**Skip link:** the first tab stop, "Skip to content", a primary md pill at 8, 8. Visible only on focus, at `--z-skip`.

### 7.9 App navigation

- **At ≥ 64em:** a 240 px left rail with 48 px items: 20 px icon, then a 16 / medium label, padding 0 12, radius 8.
- **Order:** Your fit · Changes · Sites · Privacy · Settings, with **Help** pinned at the bottom (never hidden, WCAG 3.2.6).

| State | Treatment |
|---|---|
| Default | `--ink-2` |
| Hover | `--surface-hover`, `--ink` |
| Active | `--surface-press` |
| Current | `--surface-tonal` fill, a 3 px `--ink` inset left bar, `--ink` text, `aria-current="page"` |
| Focus | Ring |

- **Below 64em:** a 56 px top bar with a Menu sheet; same items and anatomy.
- App pages are **documents, not dashboards**: h2 page title, then sections separated by index rules (§7.11), then hairline rows. No KPI tiles, no card grids.

### 7.10 Footer

- **Surface:** `--surface-tonal` band, a 1 px `--line` top edge, padding-block `--section-y` / 2.
- **Columns:** 4 at ≥ 64em, 2 at ≥ 48em, 1 below that.
- **Column heads:** 15 / medium `--ink-2`, sentence case.
- **Links:** 16 / 400 `--ink`, 40 px rows (44 below 48em).

**Must contain:**
- Help / Contact
- Privacy
- "What WebAble sends"
- Accessibility statement: how we test our own pages; it never claims conformance
- Research
- A theme segmented control: System · Light · Dark

**The honesty line**, in body 18 `--ink-2`, max `--w-prose`: "WebAble changes how pages look and work for you. It doesn't make any site accessible or compliant."

**Legal row:** meta 15 `--ink-2`.

### 7.11 Section header ("index rule")

```
━━━━─────────────────────────────────────────────────────────────── 1px --line; first 24px is 2px --ink
3 short tasks · about 6 min                          See the research →    eyebrow: meta 15/medium --ink-2 (a FACT)
Three short tasks. Then every site fits.                                     h2, max 2 lines
WebAble measures how you read, point and focus. It never asks for a diagnosis.   deck: body 18 --ink-2, ≤ 2 lines, --w-prose
```

- **Spacing:** rule → 16 → eyebrow → 8 → h2 → 16 → deck → 48 → content (32 below 48em).
- The optional link is a ghost text link on the eyebrow's baseline, aligned right.
- Left-aligned on the page's one text edge. Centring is only for the hero and the final CTA band.

### 7.12 Disclosure

```
───────────────────────────────────────────────────────────────── 1px --line
 What does WebAble send?                                    ⌄    row ≥ 56 · 18/medium (16/medium in the popup) · chevron 20 in a 44 hit
─────────────────────────────────────────────────────────────────
 Page structure only. Never page text, what you type, or your      panel: padding 8 0 24 · body 18 --ink-2 (16 in popup) · --w-prose
 browsing history.
```

**Behaviour**
- A `<button aria-expanded aria-controls>`; the panel has `hidden="until-found"`.
- Height animates over `--dur-expand`; the chevron rotates 180° over `--dur-2`. Both are 0 ms under reduced motion.
- Nothing auto-collapses. Never nested more than one level.
- **Never used** for Help, contact, or the first view of "What changed".

| State | Treatment |
|---|---|
| Hover | Row fill `--surface-hover`, radius 8 |
| Active | `--surface-press` |
| Focus | Ring, radius 8 |
| Disabled | Not used |

### 7.13 Status indicator (extension states)

**Anatomy**

| Size | Anatomy | Where |
|---|---|---|
| Pill | Height 32, padding 0 12 0 10, radius pill, `--surface-tonal`; 16 px glyph, gap 8, label 15 / medium `--ink` | App "Sites" list |
| Line | 20 px glyph, gap 8, title 20 / medium | Popup state line |

Not interactive unless it is wrapped in a link to detail.

**States.** Glyphs are custom SVG on a 16 grid with a 1.75 stroke, and **shape carries the state**.

| State | Glyph | Colour | Label |
|---|---|---|---|
| On | Ring r 6 plus a centre dot r 2 | `--ink-2` | "On" |
| Checking | Ring r 6 in `--line-strong` plus a 90° arc in `--ink-2`, rotating over `--loop-analyzing`. Stops at `--stop-analyzing` and becomes a static half ring | `--ink-2` | "Checking this page…" → "Still checking" |
| Adapted | Filled disc r 6 | `--accent` | "Adapted · 3" |
| Paused | Two 2 × 8 bars | `--ink-2` | "Paused on this site" |
| Needs attention | Triangle 12 wide with "!" | `--warning-icon` | "Needs a look" |
| Can't run here | Ring r 6 with a 45° slash | `--ink-2` | "Can't change this page" |
| Change undone (row glyph, not a status) | rotate-ccw 16 | `--ink-2` | "…was undone" |

In forced colours the glyphs render in `CanvasText`.

### 7.14 Toast

```
╭────────────────────────────────────────────────────────────╮
│ ✓  Text size is now 18 px on this site.   [ Undo ]   ✕    │  .wa-inverse · --surface-inverse · radius 12 · --elev-float
╰────────────────────────────────────────────────────────────╯  min-height 56 · padding 6 8 6 16 · gap 12 · max --w-toast
```

**Anatomy**
- 20 px check SVG in `--on-inverse-accent` (applied changes only).
- Text 16 / 400 `--on-inverse`.
- Action: md pill, 1 px `--on-inverse-2` border, 16 / medium `--on-inverse`. Hover `--surface-inverse-hover`; active the same plus 1 px down; focus ring in `--focus-inverse`.
- Close: a 44 px icon button.

**Placement**
- Site and app: bottom-centre, 24 px from the edge.
- Popup: above the footer, 8 px gap.
- In-page layer: bottom-right, 16 px.

**Behaviour**
- `role="status"`. It never takes focus.
- **A toast with an action stays until dismissed or the page changes.** Without an action it stays 6 s and pauses on hover or focus.
- One at a time; a new one replaces the old.
- Enters over `--dur-3` with fade and `--shift-2` rise; exits over `--dur-3-exit` with a fade.

### 7.15 Tooltip

- **Visuals:** `.wa-inverse`, radius 4, meta 15 / 1.45 `--on-inverse`, padding 8 10, max `--w-tooltip`, offset 8, no arrow.
- **Timing:** appears after `--delay-tooltip` on hover, and immediately on keyboard focus.
- **Behaviour:** hoverable, persists while hovered, Esc dismisses it (WCAG 1.4.13).
- It is supplementary only: never the only copy of a label, and never contains a link. There are no tooltips on touch.

### 7.16 Modal and sheet

**Modal**
- Native `<dialog>`, `--surface-raised`, radius 20, padding 32 (24 below 48em), max `--w-modal`, `--elev-modal`, `--scrim` behind (no blur).
- Title h3; body 18 `--ink-2`; a close icon button (44) at top right.
- Actions left-aligned, primary first, 12 px gap. The destructive verb is explicit: [Delete my data] as filled danger, [Keep my data] as secondary.
- Initial focus goes to the title (`tabindex="-1"`). Focus is trapped, Esc closes, and focus returns to the opener.
- Enters over `--dur-4` (fade, `--shift-2` rise); exits over `--dur-4-exit`.
- Used only for irreversible or global actions. **Offers are never modal.**

**Sheet** (below 48em)
- A bottom sheet with radius 20 20 0 0, max-height 92dvh, and a Close button always present.
- There is no drag handle requirement (WCAG 2.5.7).
- **The popup never uses modals.** Detail views push in as sub-views with a 44 px Back button.

### 7.17 Offer block (popup) and offer chip (in-page)

**Popup offer block:** the only contained surface in the popup.

```
╭┃────────────────────────────────────────────────────────────╮
│┃ Buttons on this page are small. Make them bigger here?     │  16/medium --ink
│┃ You tapped next to 3 buttons in the last minute.           │  meta 15 --ink-2 (the reason, in plain words)
│┃ ╭──────────────────────╮  ╭──────────────────────╮         │  EQUAL: lg 48, two equal columns, gap 8 (152 each at scale 1)
│┃ │       Try it         │  │       Not now        │         │  primary · secondary
│┃ ╰──────────────────────╯  ╰──────────────────────╯         │
│┃ Don't suggest this here                                    │  ghost md, left
╰┃────────────────────────────────────────────────────────────╯
 --surface-tonal · radius 12 · padding 16 · inset 3px --accent left rule (box-shadow) · content height (240 at scale 1 with two-line text)
```

- "Not now" snoozes that offer on that site for 7 days.
- "Don't suggest this here" is permanent and can be edited in the app.
- **In-page chip** (on host pages, WebAble's shadow root):
  - **Placement and look:** bottom-right, 16 px from the edges, max `--w-inpage-chip`. `--surface-raised`, radius 12, `--elev-inpage` (which includes a 1 px `--line-strong` edge at 4.20:1 against a white page), `--font-layer` 16.
  - **Content:** the question, then [Try it] primary md and [Not now] secondary md at equal width, then ✕ (44).
  - **When it appears:** only after a behaviour trigger, and at most once per page visit. It never appears on first paint and never covers focused content.
  - **Focus:** it **never takes focus**. Its controls have `tabindex="-1"`, so the host's tab order is untouched. The command `Alt+Shift+W` (`chrome.commands`) moves focus into the layer, and Esc returns focus to where it was.
  - **Timeout:** it auto-hides after 20 s without action, which counts as "Not now".
  - **Never** a floating person icon, a persistent launcher or an injected toolbar.

### 7.18 Empty and error states

**Empty**
- A 48 px fit-mark glyph in `--line-strong`.
- A title of 5 words or fewer (20 / medium).
- One sentence (body 18 `--ink-2`; 16 in the popup).
- One action.
- Example: "No sites yet." / "Sites where you change settings show up here." / [Open a sample page].

**Error:** a panel with `--danger-tint` fill, radius 12, padding 16, containing:
- a 20 px triangle-alert SVG in `--danger`;
- a title (18 / medium `--ink`);
- *what happened · what is safe · what to do* (16 `--ink`);
- one secondary action.

Codes go behind a "Details" disclosure. The user is never blamed. **A verifier rollback is not an error** (§10.2).

### 7.19 `<kbd>` hint

Mono 15, `--surface-tonal`, 1 px `--line`, radius 4, padding 2 6. Used inside calibration response buttons ("True  T").

### 7.20 Fit mark: component form (the signature is described in §8)

- **Inline** (lists, popup rows):
  - label 16 / medium `--ink`;
  - value in Mono 15: *before* in `--ink-2`, a fit-arrow SVG (12 × 8, stroke 1.75, `--ink-2`), *after* in `--accent` at 540 weight, then a no-break space and the unit;
  - sr text: "13 to 18 pixels".
- **Block** (annotations on captures): a 1 px `--ink-2` line with 1 × 8 end ticks and radius 0. The label sits centred above in Mono 15. Over imagery, the label sits on a radius-4 `--canvas` plate.

---

## 8. Signature: "Made to measure" (the fit mark)

**Idea.** Responsive design adapts to the screen; WebAble adapts to the person. The brand shows this the way a tailor or typesetter would: **a dimension line with a before value and an after value.** The picture of "WebAble changed something" and the explanation of what changed are the same object. So the signature *is* the transparency feature.

**The elements**

1. **Fit mark:** §7.20, for example `Text size  13 → 18 px`.
2. **Ghost and fit pair** (in-page "Show on page" and hero captures):
   - The original bounds are a 1 px dashed `#1A1A17` line.
   - The adapted bounds are a 2 px solid `--inpage-accent` line with a `--fit-fill` interior.
   - **Both lines have a 1 px `--inpage-casing` on each side** (6.48:1 against the accent), so they read on any page colour.
   - A delta tag (a fit mark on a radius-4 plate) is attached 4 px outside the top-left corner.
   - Drawn in WebAble's shadow-root layer from measured rects, with `pointer-events: none` and `aria-hidden`. It never touches page nodes, ARIA or focus.
   - Shown only when the user asks. Esc or the toggle removes it.
3. **Index rule:** the section-header hairline, whose 24 px ink segment is the fit mark's tick (§7.11).
4. **Ruler:** the calibration progress track (§9.3). It is the same object, stretched.

**The wordmark.** "WebAble" in WebAble Sans at medium weight, −0.01em. The **tailed l** is the brand's small ownable quirk: legibility made visible. It is native to Atkinson, so no custom build is needed.

**Rules that stop it becoming a gimmick**
- Only real values; a fit mark with invented numbers is a bug.
- At most 3 fit marks per viewport on marketing pages.
- It animates once, only on the website hero (`--dur-draw`, `stroke-dashoffset`, then a 100 ms label fade), and is static under reduced motion.
- Accent appears only on the after-value and the fit outline.
- Never used as a background pattern or loading animation, and never inside calibration stimuli.

---

## 9. Calibration-flow visual system (Task density)

### 9.1 Layout

```
DESKTOP (≥48em)
┌ top bar 64 · --canvas · hairline below ───────────────────────────────────────────────────────┐
│ WebAble                 Reading ━━━━━━━●┅┅┿┅┅┅┅○─────────────○ Focus     Part 2 of 3 · Pointing · about 1 min left │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
                 ┌─ column --w-task (720), centred ─────────────────────────────┐
                 │ Click each circle as it appears.                h1 (32/44)    │  ≤ 8 words
                 │ Take your time. There's no right speed.         body 18 ink-2 │  ≤ 2 lines
                 │ ┌ stage ─────────────────────────────────────────────────────┐ │
                 │ │  #FFFFFF, radius 12, padding 32, min-height 360             │ │  fixed in both themes;
                 │ │                  stimulus (#111111)                         │ │  1px --line-strong edge in dark
                 │ └────────────────────────────────────────────────────────────┘ │
                 │ [ True   T ]  [ False   F ]  [ Can't read it   C ]            │  task 64 · gap 16 (reading only)
                 └───────────────────────────────────────────────────────────────┘
┌ action bar 96 · sticky bottom · --canvas · hairline above ───────────────────────────────────────┐
│ [ Pause ]  [ Skip this part ]              Take your time, or skip this part.  (idle note, meta)   │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
MOBILE (<48em): the top bar becomes 88 (wordmark row 40 + ruler row 48, labels hidden except the current one);
response buttons stack full width; the action bar holds [Pause] [Skip this part] at equal width, 64 each.
```

### 9.2 Rules

**Stimuli**
- Stimuli are **exempt from theme and profile.**
  - The stage is `--stage` `#FFFFFF`, with stimuli in `--stimulus` `#111111` (18.88:1) in both themes. Contrast is never measured in dark polarity (`cal-vision.md` decision 4).
  - The polarity task shows both polarities *inside* the stage.
  - Reading stimuli use bundled Noto Sans 400.
  - `--wa-*` hooks never scale the stage.
- **Stimuli appear instantly,** on the first frame after paint, with no entrance motion. Animation would contaminate the timing data.

**Controls around the stage**
- All are `--control-task` (64) with ≥ 16 px gaps (`cal-vision.md` §3).
- **Pause** and **Skip this part** are always present. Esc pauses.
- Pause opens a sheet with [Resume] (primary) and [Save and finish later] (secondary): "Your answers so far are saved."
- Skipping is recorded without penalty.

**No clock**
- No timers, countdowns, percentages or scores. Time is estimated in words ("about 1 min left"), rounded up.
- After 20 s idle, the note "Take your time, or skip this part." appears in meta 15 `--ink-2` with a `--dur-1` fade (`cal-motor.md` §4).

**Keyboard**
- Reading uses T / F / C, with `<kbd>` hints shown inside the buttons.
- Every screen can be finished by keyboard through Skip. No drag is required anywhere.

**Transitions**
- Moving between screens takes 0 ms. Focus moves to the new h1, and a polite live region announces the section change.

**The profile applies at once**
- The first screen ("Make this comfortable to read") starts its paragraph at max(1.5 × browser default, 24 px), with −/+ task buttons and [This is comfortable].
- From then on, the *chrome* uses the chosen `--wa-text-scale`. Stimuli do not.

**Module specifics**

| Module | Stimuli | Extra controls |
|---|---|---|
| **Reading** | Sentences of 55–60 characters in a box 20–24 characters wide. Responses: [True] [False] [Can't read it] | — |
| **Pointing** | Filled circles in `#111111`, from the ladder {72, 56, 44, 32, 24} px; home marker is a 2 px `#111111` ring. No hover or hit effects; silent misses. The stage is exempt from the 44 px floor; everything around it is 64 | — |
| **Focus** | Mock pages drawn in the stage, in greyscale plus the one element under test | In motion conditions, a [Stop motion] secondary task button at the stage's top right. **Motion trials are never shown when `prefers-reduced-motion: reduce` or the profile's reduced motion is set** (`cal-attention.md` decision 5) |

### 9.3 Progress ruler

**Geometry**
- An SVG 24 px tall with a max width of 30rem, centred in the top bar.
- Sections are proportional to their task counts and named by *activity*: **Reading · Pointing · Focus**, never by condition.

**Marks**
- Done: a 2 px `--ink` line with section ticks 1 × 12 `--ink`.
- Upcoming: a 1 px `--line-strong` line (≥ 3.11:1) with ticks in `--line-strong`.
- Current section: sub-ticks 1 × 6, one per task, `--ink` when done and `--line-strong` when upcoming.
- Current position: a 12 px `--ink` dot.

**Labels**
- Module names under the ticks in meta 15: current in `--ink` at medium weight, others `--ink-2`. Below 48em only the current label shows.
- The text line "Part 2 of 3 · Pointing · about 1 min left" is the accessible source.

**Accessibility and motion**
- The graphic is `aria-hidden`. An `<ol>` with `aria-current="step"` backs it.
- The dot jumps between ticks with no animation. The ruler is **never accent**: calibration measures, it doesn't change the page.

### 9.4 Results: "Your fit"

- **Heading:** h1 "Your fit". Deck (body 18 `--ink-2`): "Here's what WebAble will change, and why. You can adjust any of it."
- **Rows** (min 72, hairlines between). Each row has:
  - a label (18 / medium);
  - a plain-language line (16 `--ink-2`, for example "You read most comfortably at 19 px or larger.");
  - a fit mark from the browser default to yours, as a Mono 28 readout (`16 → 19 px`, after-value in accent);
  - a source line (meta 15 `--ink-3`: "Measured today" or "Set by you");
  - an [Adjust] ghost md button.
- **Preview:**
  - A real sample page in a radius-20 frame with a 1 px `--line` edge.
  - An **Original / Fitted** segmented control above it.
  - Ghost-and-fit outlines on up to 3 regions.
- **Actions:** [Use this fit] primary task, [Adjust first] secondary task.
- **Never** "results", "score", "normal" or "below average".

### 9.5 Recalibration

The same row anatomy shows the diff: `Targets  44 → 56 px  (since Jun 12)`, with a per-row segmented control [Keep new | Keep old] (the new value is selected by default). The primary action is [Save my fit].

---

## 10. Extension popup (Compact density)

### 10.1 Layout: Adapted state at text scale 1 (380 × 600 max)

```
 x: 0   16                                                              364  380
 ┌────────────────────────────────────────────────────────────────────────┐ y 0
 │  [mark 20] WebAble                                             [ ⚙ ]   │ HEADER 56, fixed: mark at (16,18); wordmark 20/medium;
 │                                                                        │   Settings icon button 44×44 at (320,6)
 ├────────────────────────────────────────────────────────────────────────┤ 56  1px --line
 │  news.example.com                                                      │ 73–95   meta 15 --ink-2; wraps, never truncated
 │  ● Adapted · 3 changes                                                 │ 99–125  glyph 20 --accent + title 20/medium  (h1, tabindex −1)
 │  Each one passed WebAble's checks.                                     │ 129–153 ui 16 --ink-2
 │                                                                        │
 │  WebAble on this site                               On  ╭──────╮       │ 165–221 switch row 56 (accent track)
 │                                                         ╰──────╯       │
 ├────────────────────────────────────────────────────────────────────────┤ 221 1px --line
 │  ━━──────────────────────────────────────────────────────────────────  │ 237 index rule
 │  What changed                                         [Show on page]   │ 247–291 meta 15/medium --ink-2 · ghost md
 │  Text size          13 → 18 px                              [ Undo ]   │ 291–347 row 56: label col 8rem · fit value Mono 15 · ghost md
 │  ────────────────────────────────────────────────────────────────────  │
 │  Click targets      24 → 44 px                              [ Undo ]   │ 347–403
 │  ────────────────────────────────────────────────────────────────────  │
 │  Moving things      2 paused                                [ Undo ]   │ 403–459
 │                                                                        │
 │  Adjust for this site                                             ⌄    │ 471–527 disclosure row 56
 ├────────────────────────────────────────────────────────────────────────┤ 551 1px --line
 │  [What was sent]                                          [Undo all]   │ FOOTER 48, fixed: ghost md ×2
 └────────────────────────────────────────────────────────────────────────┘ 600
```

**Geometry**
- **Width** `--w-popup` = 23.75rem: 380 px at scale 1, 475 at 1.25, 570 at 1.5, 760 at 2.0 (under Chrome's 800 cap).
- **Height** is capped at 600. The header and footer (rem-based) grow with scale, and the body between them scrolls. At scale 1 the body is at most 495 px.
- **Content width** is 348. The change row is a grid `minmax(0, 8rem) 1fr auto`, gap 8. Labels wrap, and rows grow from their 56 minimum.
- **Container query:** below 340 px inline size (browser zoom), button pairs stack and the fit value moves under its label.

**Surfaces and behaviour**
- **No cards**, except the offer block. Rows are separated by hairlines on `--canvas`.
- **Fixed geometry, changing content.** The header, the state-line position and the footer never move between states.
- **On open,** focus goes to the state title (the h1), so the state is announced first. Tab then follows the visual order.
- A **row tap** (on the label) highlights that element on the page. It is the same as "Show on page", scoped to that element.

### 10.2 Every state

Block order is always: domain → state line → sentence → state body → (offer) → What changed → Adjust → footer. Only the listed parts change.

| State | Glyph | State line (20 / medium) | Sentence (16 `--ink-2`) | State body | Footer | Toolbar icon / badge / title |
|---|---|---|---|---|---|---|
| **First run** (no account, no profile) | On | "Basic fit is on" | "Small safe fixes work on every site. Tune WebAble to you for more." | If OS settings were applied, their rows with Undo (e.g. "Moving things · 2 paused · from your system setting"). Then "Quick changes for this site" (meta 15 / medium) and three switch rows (accent when on, applied instantly): **Larger text · Bigger click targets · Calmer page**. Then [Tune WebAble to you] primary lg full width, and the meta line "About 6 minutes. Skip any part." | What was sent · Sign in | Mark / none / "WebAble: on" |
| **Checking** (shown only after `--delay-status`) | Checking | "Checking this page…" | "The page stays as it is until WebAble is sure." | The previous content stays where it is. No skeletons, no shimmer | unchanged | unchanged (no toolbar animation) |
| **Still checking** (after 5 s) | Static half ring | "Still checking" | "Keep reading. Nothing changes until it's done." | unchanged | unchanged | unchanged |
| **Adapted** | Adapted (accent) | "Adapted · 3 changes" | "Each one passed WebAble's checks." | Switch row On (accent); What changed (expanded); Adjust disclosure | What was sent · Undo all | Mark / "3" on `#2D6A3E`, white text (6.48:1) / "WebAble: 3 changes on this page" |
| **Nothing to change** | On | "This page already fits you" | "WebAble checked it against your fit." | Switch row On; Adjust disclosure | What was sent · Your fit ↗ | Mark / none / "WebAble: on" |
| **Offer pending** (behaviour-triggered) | current | current | current | Offer block (§7.17) inserted after the switch row, 16 px margins. What changed collapses to one disclosure row, "What changed · 3". Accepting in the popup clears the in-page chip too, and vice versa | unchanged | unchanged (offers never badge) |
| **A change undone by the checks** | current (the count excludes undone changes) | "Adapted · 2 changes" | unchanged | **A neutral row at the top of What changed:** rotate-ccw 16 `--ink-2`, "Line spacing was undone" (16 / medium), "It made text overlap here, so WebAble put it back." (meta 15 `--ink-2`), and a [Why?] disclosure. **Not** needs-attention | unchanged | unchanged |
| **All changes undone** | On | "WebAble undid its changes here" | "They didn't pass its checks on this page. The page is as the site made it." | Undone rows only | What was sent · Your fit ↗ | Mark / none |
| **Paused on this site** | Paused | "Paused on this site" | "news.example.com looks the way the site made it." | [Resume on this site] primary lg full width; switch row Off | What was sent · Your fit ↗ | Tile in `#7D7C73` with bars / none / "WebAble: paused on this site" |
| **Off everywhere** | Paused | "WebAble is off" | "No site is being changed." | [Turn WebAble on] primary lg full width | Your fit ↗ | Grey tile with bars / none / "WebAble: off" |
| **Needs attention** (user action only) | Needs attention | "Sign in again to sync" | "Your fit still works on this device." | [Sign in] secondary lg, then the rest of the underlying state (e.g. the adapted list) below | unchanged | Mark / "!" on `#F0B45C`, ink text (9.46:1) / "WebAble: sign in again to sync" |
| **Can't run here** (chrome://, Web Store, PDF viewer) | Can't run | "WebAble can't change this page" | "Chrome doesn't let extensions change its own pages or the Web Store." | [Open your fit ↗] ghost md | What was sent | Grey tile with slash / none / "WebAble can't change this page" |
| **Couldn't read the page** | Needs attention | "WebAble couldn't read this page" | "Reload the page to try again. Nothing was changed." | [Reload page] secondary lg | unchanged | Mark / none |
| **Signed out** (sync off) | unchanged | unchanged | unchanged | A meta line above the footer: "Your fit is on this device only. Sign in to use it elsewhere." | unchanged | unchanged |
| **On-device only** (the cloud tier is off or unavailable) | unchanged | unchanged | unchanged | A meta line: "Suggestions run on this device only." | unchanged | unchanged |

### 10.3 Sub-views

These are pushed views. The header's left side becomes a 44 px [‹ Back] ghost button with its word visible. They enter with a fade and `--shift-2` over `--dur-3`, or fade only under reduced motion.

**What was sent**
- Title "What was sent", then the meta line "Last sent 2:41 PM to WebAble's server" or "Nothing was sent from this page."
- Two plain lines:
  - "Sent: page structure — 41 headings, 3 forms, 12 buttons."
  - "Not sent: page text, anything you typed, your browsing history."
- A [Show the exact data] disclosure opens the payload: Mono 15 on `--surface-tonal`, radius 8, padding 12, wrapped, no horizontal scroll.

**Settings** (the gear)
- Theme: segmented System · Light · Dark.
- Motion: switch "Reduce motion in WebAble" (ink track).
- [Open your fit ↗], [Help ↗].
- [Turn WebAble off everywhere] as a danger outline button, with confirmation inline and no modal.

**Adjust for this site** (the disclosure, expanded)
- Text size: slider plus stepper on the {14, 16, 18, 21, 24, 28, 32} px ladder.
- Line spacing: slider plus stepper on {1.5, 1.6, 1.8, 2.0}.
- Switch rows: Bigger click targets ("At least 44 px") and Pause moving things.
- [Use these on every site] secondary lg, full width.

### 10.4 Toolbar icon

- **Sizes:** 16, 24 and 32 px. **Title:** always set with `chrome.action.setTitle`, so the state exists as text.
- **Tile:** an ink tile (`#1A1A17`, radius 4 at 16 px) carrying the mark in `#FAFAF7`, so it shows on both light and dark toolbars. Paused and can't-run states use a `#7D7C73` tile.
- **Badges:** only the change count and "!".
- **No toolbar animation.**

---

## 11. Iconography

### 11.1 Set and stroke

**Lucide** (ISC licence).
- Pin the exact version in `package.json` and import icons individually (`lucide-react`, tree-shaken).
- Always pass `strokeWidth={1.75}` with **`absoluteStrokeWidth`**, so the rendered stroke is 1.75 px at every size. 24 px glyphs use 2 px.
- Round caps and joins. `currentColor` only. Nothing is filled except the custom status disc.
- **Sizes:** 16 (inline with 15–16 px text; the minimum), 20 (the default in buttons, rows and the rail), 24 (standalone and nav sheet).
- **Colour:** `--ink-2` by default, and `--ink` when it sits beside an ink label. Accent only for the Adapted disc and the fit mark.

**Why Lucide:** it is the largest actively maintained open set, has adjustable absolute stroke and keeps its terminals consistent. The "shadcn default" risk is controlled by using icons rarely: words lead, and icons never appear without a visible label except for Close, Back, Settings and the popup's per-row controls.

### 11.2 Allowlist (these 26 names are the only Lucide icons in the product)

`arrow-right`, `arrow-up-right`, `chevron-down`, `chevron-left`, `chevron-right`, `check`, `x`, `minus`, `plus`, `rotate-ccw` (undo / undone), `rotate-cw` (redo), `pause`, `play`, `settings`, `menu`, `lock`, `info`, `triangle-alert`, `circle-help`, `refresh-cw` (reload), `sun`, `moon`, `monitor`, `sliders-horizontal` (Adjust), `square-dashed` (Show on page), `trash-2`.

Adding an icon needs a design review.

### 11.3 Custom glyphs (same 24 grid, same stroke)

- **Fit arrow:** 12 × 8, a horizontal line with a 45° open head. It replaces the typed → everywhere.
- **Status glyphs:** On, Checking, Adapted, Paused, Needs attention, Can't run (§7.13), on a 16 grid.
- **Mark** (interim; logo exploration is out of scope):
  - on a 24 grid, a dimension line at y 8 from x 6 to x 18 with end ticks from y 5 to y 11;
  - above two text bars, at y 14 (x 6–18) and at y 18 (x 6–14);
  - stroke 2 at 24 px and 1.5 at 16 px, round caps.
  - It reads as "a page, measured". The text bars are borrowed from C's page glyph.

### 11.4 Forbidden

Person or figure, wheelchair, eye, ear, brain, hand, heart, sparkles or stars, magic wand, robot, shield-check or badge-check (they imply compliance), and emoji. No illustrations of people anywhere.

---

## 12. Motion principles

1. **Motion explains cause and effect, and never decorates.** Every animation connects an action to its result.
2. **One curve (`--ease`) and four durations.** Exits run at about 70% of the enter duration. Nothing bounces or overshoots, and there are no springs.
3. **Small distances.** Travel is at most 8 px. Popovers scale from 0.98 at the smallest. There are no blur-ins.
4. **Never move what someone is reading.** No scroll-linked effects, parallax, reveal-on-scroll, autoplay, self-advancing carousels or hover zoom. Content is there at load.
5. **Never animate someone else's page.** Adaptations, rollbacks and undo apply in one frame. Before applying, WebAble records the top visible element and its offset, and restores them afterwards.
6. **Calibration stimuli are instant** (§9.2).
7. **Reduced motion is honoured from the OS setting, the WebAble profile, and the app and popup settings.** Transforms go to 0, fades are capped at 100 ms, the hero draw is static, and the analyzing arc becomes a static half ring. In code, animations are written inside `@media (prefers-reduced-motion: no-preference)` and also read the tokens.
8. **Nothing loops.** The single exception is the analyzing arc, which stops after 5 s.

| Interaction | Duration | Properties | Reduced motion |
|---|---|---|---|
| Hover, colour | `--dur-1` | color, background-color, border-color | same |
| Press | `--dur-1` | background plus `translateY(--press-shift)` | colour only |
| Switch, checkbox, segmented indicator, chevron | `--dur-2` | transform | instant |
| Disclosure | `--dur-expand` / 150 ms | height (grid rows), opacity | instant |
| Popover, menu, tooltip, toast, popup sub-view | `--dur-3` / `--dur-3-exit` | opacity, `translateY(--shift-1 or --shift-2)`, scale 0.98→1 | opacity, 100 ms |
| Modal, sheet | `--dur-4` / `--dur-4-exit` | opacity, `translateY(--shift-2)` | opacity, 100 ms |
| Route change (site, app, calibration) | 0 ms | none; focus moves to the h1 | same |
| Hero fit-mark draw (once per session) | `--dur-draw` + 100 ms | stroke-dashoffset, opacity | static |
| Analyzing arc | `--loop-analyzing` linear, stops at `--stop-analyzing` | rotate | static half ring |
| In-page adaptation, rollback, undo | 0 ms | none | same |

---

## 13. Copy tone

**Voice:** calm, exact and on the person's side. Something like a good optician's assistant, not a doctor, a robot or a salesperson. Aim for grade 7–8.

### 13.1 Rules

1. **Talk about pages and functions, never people or conditions.** Write "Larger click targets", not "for people with tremors". Never apply these words to the user: disability, impairment, low vision, ADHD, patient, symptom, diagnosis.
2. **Offer; don't announce.** A behaviour-triggered change is a question with two equal answers: "Make text larger on this site?" [Try it] [Not now].
3. **Say what changed, by how much, and how to undo it, in that order.** Numbers are digits with units and a no-break space ("18 px"). Arrows are SVG.
4. **Undo sits next to every change.** Never "Are you sure?" for a reversible action.
5. **No exam language.** Calibration consists of "tasks", and you "tune" WebAble. The result is "your fit". Never test, score, assessment, acuity, results, normal or below average.
6. **Never claim conformance or fixing.** Don't say "WCAG compliant", "makes any site accessible" or "fixes accessibility". Do say "changes how pages look and work for you", and "WebAble can't change everything on every site".
7. **Short.** Headlines 8 words or fewer. Sentences 20 words or fewer. Buttons 1–3 words, starting with a verb. One idea per sentence.
8. **Style:** sentence case, no all caps, no exclamation marks, no "Oops", no emoji, no blame.
9. **Privacy in plain nouns.** Say exactly what is sent and what isn't. Never "Nothing leaves your device" while a cloud tier exists. Always link to "What was sent".
10. **Honest about the AI, with no persona.** Write "Suggested by WebAble", never "I think…". Mention AI only where it informs a privacy or trust decision. No "magic", "smart", "seamless", "effortless", "revolutionary" or "empower".
11. **Errors:** what happened, what is safe, what to do. Codes go behind "Details".
12. **Name the escape hatch.** "Pause on this site" and "Turn WebAble off" are always one step away and said plainly.

### 13.2 Fixed vocabulary

| Word | Means |
|---|---|
| *change* | One adaptation WebAble made |
| *undo* | Reverse one change, or all of them |
| *undone* | Reversed by WebAble's checks |
| *pause* | Stop on one site |
| *turn off* | Stop everywhere |
| *your fit* | The profile |
| *tune* | Run the calibration tasks (the word "calibration" appears only in docs) |
| *offer* | Internal word only. The UI asks a question |

### 13.3 Examples

| Moment | Write | Don't write |
|---|---|---|
| Hero | "The web, made to measure." | "AI-powered accessibility for everyone!" |
| Hero support | "WebAble learns how you read, point and focus, then adjusts each site to fit. You see every change and can undo it." | "Our intelligent engine fixes inaccessible websites." |
| Tune intro | "3 short tasks, about 6 minutes. There's no passing or failing. Skip any part." | "Let's assess your abilities." |
| Task | "Click each circle as it appears. Take your time." | "Test 2: motor precision. Hurry!" |
| Your fit | "Text reads best for you at 19 px or larger." | "Your visual acuity is below average." |
| Offer | "You zoomed in 3 times here. Make text larger on this site?" | "We noticed you're struggling to read." |
| Applied | "Click targets 24 → 44 px. Undo" | "Motor accessibility mode activated!" |
| Undone by checks | "Line spacing was undone. It made text overlap here, so WebAble put it back." | "Error: adaptation failed verification (code 17)." |
| Nothing to change | "This page already fits you." | "No accessibility issues found." |
| Paused | "Paused on this site. news.example.com looks the way the site made it." | "Accessibility features disabled!" |
| Can't run | "Chrome doesn't let extensions change its own pages or the Web Store." | "Unsupported URL." |
| Privacy | "Sent: page structure. Not sent: page text, anything you typed, your history." | "We take your privacy seriously." |
| Sign-in nudge | "Sign in to use your fit on other devices." | "Create an account to unlock all features!" |
| Footer honesty | "WebAble changes how pages look and work for you. It doesn't make any site accessible or compliant." | "Makes any website WCAG 2.2 compliant." |

---

## 14. Surfaces: one token set, four densities

| Density | Where | Body | Largest heading | Primary target | Column | Rhythm | Chrome |
|---|---|---|---|---|---|---|---|
| **Reading** | Public website; privacy and research pages | 18 / 1.6 | display 40 → 64 | lg 48 | `--w-prose`, within `--w-content` | `--section-y` 64 / 96 / 128; one idea per viewport | Header 56 / 64, sticky only if tall enough, never hides |
| **Working** | App: Your fit, Changes, Sites, Privacy, Settings | 16 / 1.5 (18 for explanations) | h2 26 → 32 as the page title | lg 48 (sm 36 in dense tables) | `--w-content`, with a 240 rail at ≥ 64em | 48 between sections, index rules | Rail or 56 top bar |
| **Task** | Sign-up, onboarding, calibration, recalibration | 18 / 1.6 | h1 32 → 44 | task 64 | `--w-task`, centred | One task per screen | 64 top bar with ruler; 96 action bar |
| **Compact** | Extension popup and side panel | 16 / 1.5 | title 20 | lg 48; rows 56 | Full width minus 16 padding | 12 / 16 stacks | 56 header and 48 footer, fixed |
| **Layer** | In-page chip, toast, "Show on page" | 16 `system-ui` | 16 / medium | md 44 | `--w-inpage-chip` | — | None; `--elev-inpage` |

**Website hero**
- Left-aligned display type on the text edge.
- Beside it (≥ 64em) or below it, a real captured article page in a radius-20 frame, with an **Original / Fitted** segmented control.
- In "Fitted" view, three block fit marks draw once: `13 → 18 px` text, `24 → 44 px` targets, `3 → 0` moving elements.
- One ink CTA, [Add to Chrome →].
- No video, no autoplay, and no gradient except the flat `--fit-fill`.

---

## 15. Acceptance criteria (CI and review)

| Criterion | Target | Check |
|---|---|---|
| Text contrast | Every text token ≥ 4.5:1 on every surface it can sit on; body and secondary ≥ 7:1 | Port `table.mjs` to CI. Fail on any pair below target |
| Non-text and focus | Control edges, accent fills, glyphs and focus ≥ 3:1 | Same |
| Focus | 3 px ring, 2 px offset, `:focus-visible` only; 4 px under more contrast; the inverse-scope override is present | Playwright keyboard pass with screenshots, both themes |
| Targets | ≥ `--target-min` (44), ≥ 8 px apart, calibration controls 64 | axe `target-size` plus a bounding-box script |
| Text floor | No computed font-size below 15 px except sr-only | DOM scan |
| Reflow | No horizontal scroll at 320 px; popup usable at 280 CSS px and at `--wa-text-scale` 2 | Playwright |
| Text spacing | No clipping under WCAG 1.4.12 overrides plus `--wa-leading-add` 0.3 | Injected stylesheet in e2e |
| Motion | Zero transform animations under OS or profile reduced motion; in-page apply takes 1 frame | Computed-style assertions |
| Forced colours | State readable from shape alone; focus visible | Chromium forced-colors emulation snapshots |
| Glyphs | No U+2192, U+2197, U+21BA or U+2713 in rendered strings | String lint |
| Accent budget | `--accent` referenced only by the allowlisted components (§2, principle 2) | Stylelint rule |
| Page invariants | The layer never changes page ARIA, accessible names, focus order or key handling | Accessibility-tree diff before and after apply, excluding WebAble's host |

---

## 16. Open items to validate (they don't block building tokens)

1. **Typeface gate** (§3.7). Atkinson Next against Inter-cv at matched x-height. It is one token to switch.
2. **Fern in the field.** Test that no one reads the green Adapted disc as "success/finished", and that "Adapted" is understood. Fallback: keep the hue and change the word.
3. **Paper `#FAFAF7` vs white** with light-scatter participants. Dark theme remains available either way.
4. **Popup growth** (380 → 760 px at scale 2) against keeping 380 px and scrolling. Test at scales 1.5 and 2.
5. **Fit marks in the hero.** Run a 5-second test: do visitors understand "13 → 18 px"? Fallback: a plain caption under each mark.
6. **`@font-face` in shadow roots.** The in-page layer deliberately uses `system-ui`. Confirm this with the extension lead.
