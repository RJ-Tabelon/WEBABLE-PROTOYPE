# Onboarding and in-page UI: design spec (Lucius, round 8b)

Alfred's version is being replaced completely. This spec is the only source of truth for the onboarding; ignore
`docs/agents/ALFRED-3.md`, `docs/copy/**` and every file Alfred added. The measurement design comes from our own
fitting research, which `packages/core/src/fit/derive.ts` already implements: the flow fills a `FittingRaw` and calls
`deriveFit()`. Don't change core.

## What went wrong, and the bar
The person using this may have low vision, a tremor, or trouble with busy screens. An onboarding with small text,
small buttons, crowded screens, many choices and clever effects fails exactly those people, and it looks cheap to
everyone else. So the bar is:
- one thing on screen at a time;
- huge, quiet type;
- 64 px buttons;
- a clear "where am I and what do I do";
- one small reward after each step;
- an ending that shows, on pages they know, what WebAble will do for them.

Think Apple's Hearing Test and the first-run screens of Apple Health or Headspace. Not a game arcade.

## Look (shared tokens: `apps/extension/entrypoints/fitting/ui/tokens.css`)
- **Canvas and stage:** a warm off-white canvas (`--c-canvas #F5F4F0`). White stage cards (`--c-card`) with radius 28 and a
  soft two-layer shadow. Hairlines `--c-line`.
- **Ink:** near-black `--c-ink #16150F` and secondary ink `--c-ink-2 #5E5C55`.
- **Accent:** one accent, deep green `--c-accent #17694A`, used for three things only:
  - the values WebAble changes ("16 → 21 px");
  - the chart;
  - the "WebAble is on" state.

  Primary buttons are ink, not accent.
- **Type:** system UI font. h1 44/50 weight 600, tracking −0.02em. h2 30/36 weight 600. Deck 20/30 in ink-2. Body
  18/28. Nothing under 15 px.
- **Controls:**
  - primary pill: 64 px tall, ink background, white 18/600 label;
  - secondary pill: white with a hairline border;
  - answer buttons: 72 px tall, radius 20, 20 px label, 1.5 px line border, hover in canvas tint;
  - gaps of at least 16 px;
  - a visible focus ring, 3 px accent with 3 px offset.
- **Motion:** chrome moves at 200 ms `cubic-bezier(.2,.8,.2,1)`; with reduced motion, nothing moves. **Stimuli never
  animate in.** They appear on the first frame after paint, so timing stays clean.

## Structure
- **Top bar, 72 px:** the "WebAble" wordmark with a small accent dot on the left. In the centre, a progress ruler: three
  labelled segments, **Reading · Pointing · Finding**. The current one shows in ink with a dot, done ones get a check,
  and upcoming ones are light. On the right, a quiet "Skip for now" link.
- **Main:** a centred column, 760 px max, holding the current stage card.
- **"What we've learned" rail:** shown at 1180 px wide and up. A 280 px card on the right that fills in **one line per
  finished step**, like a tailor's measurement slip:
  - "Text · 16 → **21 px**"
  - "Faint text · **darker**"
  - "Buttons · **44 px**"
  - "Steady clicks · **on**"
  - "Moving things · **paused**"
  - "Busy pages · **simplified**"

  New lines slide in. It never changes while a task is running. Under 1180 px, the newest line shows as a chip on the
  next instruction card instead.

## The flow (about 2 minutes; every part skippable; no timers, scores or pass/fail shown)
0. **Welcome.**
   - h1 "Let's set up the web for you."
   - Deck: "Three short parts: reading, pointing and finding. About two minutes. There are no wrong answers."
   - Primary [Start] and the text link "Skip for now".
   - Below, a small line: "Sit how you usually do, and wear your glasses if you use them."
   - **Infer the input type; never ask.** Use `pointerType` from the first presses. If Start is pressed with Enter or
     Space and the pointer never moved, it's a keyboard user: skip Pointing and store `inputClass` accordingly.
   - Capture the environment silently (existing `logic/env.ts`).
1. **Before every task, an instruction card** (the modal Caden asked for).
   - Layout: a centred card, 560 px wide, radius 32, padding 48, over the canvas dimmed and blurred.
   - Eyebrow: "Reading · 2 of 4".
   - h2 title, then **one** sentence on what to do and **one** on what counts as success.
   - A 200 px demo panel with a tiny looping CSS illustration of the task (a static frame under reduced motion).
   - Buttons: "Skip this one" (text button, left) and [Start] (primary, right). Enter starts. Focus lands on the title.
2. **The tasks.** These are the measures our research and `deriveFit` already define; keep their trial counts and stop
   rules.

| # | Card title | What the person sees and does | Fills |
|---|---|---|---|
| R1 | "Pick a comfortable size" | One paragraph in the stage, with [Smaller] [Larger] under it and [This is comfortable]. The paragraph itself changes size. | `reading.seedPx` |
| R2 | "True or false?" | One short original sentence in the stage ("Fish can swim in water."). Answer buttons [True] [False] [I can't read it]. Each next sentence is 0.1 log smaller, starting just above the seed. Stop at 9 sentences, 35 s, or 2 misses in a row. | `reading.ladder` |
| R3 | "Which word is it?" | One word in the stage, fainter each time (1 easy, then up to 6 adaptive). Four word buttons plus "I can't see a word". | `reading.faint` |
| R4 | "Light or dark?" | Two true/false sentences on a light stage and two on a dark stage, near their size, then "Which felt easier to read?" [Light] [Dark] [About the same]. Skip it under forced colours. | `reading.polarity` |
| P1 | "Tap the dots" | A ring of 9 dots. One fills in; tap it, and the next one across the ring fills. 8 scored taps per block, up to 3 blocks, sizes from the existing ladder starting at 44 px (24/32/44/56/72/96 for a mouse, 44+ for touch). A press that starts inside but lets go outside counts as a slip. | `pointing.blocks` |
| F1 | "Find it" | A mock web page in the stage with a chip above it: "Find: **Gift cards**". 1 practice plus 8 trials, clutter × motion (2×2, yoked). After 12 s the target glows and the trial counts as not found. | `finding.trials` |
| F2/F3 | (same card) | "Which page was easier to find things on?" [The first] [About the same] [The second], over two thumbnails. Then "Did anything get in your way?" as large toggle chips: Moving things · Pop-ups · Too much on the page · Small text · Nothing. | `preferredCalm`, `gotInWay` |

   **Every press anywhere in the flow** goes into `allPresses` (slip and repeat), including Start buttons. That's how
   steady clicks are measured without a separate task.
3. **Small rewards.** After each answer, a 120 ms press-down and a soft check in the chrome, never in the stage. After
   each task, its line drops into the rail. When a part finishes, the next instruction card opens with "Reading is set."
   above the eyebrow.
4. **Finish.** Call `deriveFit(raw)`, save it with `logic/storage.ts`, then cross-fade to Results.

## Results (owned by `fitting/results/**`)

### Hero (two columns at ≥ 1000 px)
**Left column:**
- A status pill: green dot plus "WebAble is on".
- h1 "Here's what changes for you."
- Deck: "On every website you visit, WebAble will:"
- The **top three helps** as large lines, each with a 28 px line icon, chosen from these by value:
  - Text: "Show text at **{bodyPx} px**, with headings kept in proportion."
  - Faint text: "Make faint grey text darker."
  - Buttons: "Make buttons and links easier to hit, **{minPx} px** or larger."
  - Steady clicks: "Keep your click on the button you meant, even if your hand moves."
  - Moving things: "Pause slideshows and moving ads."
  - Busy pages: "Show busy pages, like news and recipes, as a clean, simple page." Always in the list, because it
    applies to everyone.
- Then [Try it on a news site] (primary; opens `https://www.cnn.com` in a new tab) and [Done] (secondary; closes the tab).

**Right column:**
- The **radar chart**: a modern hexagon with six axes:
  - Text size
  - Faint text
  - Button size
  - Steady clicks
  - Moving things
  - Busy pages

  Each value is "how much WebAble helps here", 0–100, computed in `results/needs.ts`. Busy pages is never below 35,
  because simplification is on for everyone.
- Drawing:
  - three faint concentric hexagon rings and hairline spokes;
  - the shape filled with accent at 14% and stroked with 2.5 px accent;
  - vertex dots 7 px white with an accent stroke;
  - labels outside in 15 px ink-2, with the top three labels in ink.
- It draws in from the centre over 600 ms, or appears instantly with reduced motion.
- `role="img"` with an aria-label summary, plus a visually hidden table.
- Title above: "Where WebAble helps you".

### "See it on a page like…"
- An h2, then a native `<select>`, 56 px tall and styled:
  - News site
  - Online class
  - Pharmacy refill
  - Bank statement
  - Recipe
- Next to it, a segmented control **[Before | With WebAble]**. No drag.
- Below, a **browser-window frame**: radius 20, a 44 px top bar with three grey dots and a URL pill, 560 px tall,
  content clipped with a bottom fade.
- The mini page inside is drawn from data by one renderer. It uses fictional brands only:
  - The Daily Ledger;
  - Northbridge Online;
  - Alderra Pharmacy;
  - Harbor Bank;
  - Home Table.
- **Before:**
  - 13 px grey body text and 12 px navigation;
  - 28 px buttons;
  - "Sponsored" boxes and a newsletter pop-up in the corner;
  - a moving strip (still, under reduced motion).
- **With WebAble:** uses the person's real values:
  - body at `bodyPx` and headings in proportion;
  - grey text darkened to the contrast floor;
  - controls at least `minPx`;
  - nothing moving;
  - News, Online class and Recipe become the simple single-column page, with ads, teasers and the pop-up gone;
  - Pharmacy keeps its form but loses the promo, with larger fields and buttons;
  - Bank statement keeps its table exactly, with only text and contrast changed. Label it "Statements keep their
    layout."
- Switching page kinds shows Before for 700 ms, then cross-fades to With WebAble. That switch happens once per change,
  and not at all under reduced motion.

### "Adjust anything"
Rows 76 px tall, separated by hairlines. Each row has:
- a label and a plain one-liner;
- the change as "16 → **21 px**" (the after-value in accent);
- the control on the right.

| Row | Control |
|---|---|
| Text size | − / + by one ladder step (16, 18, 20, 22, 24, 28, 32, 36) |
| Faint text | Off / Darker / Darkest |
| Light or dark | Light / Dark / As the site |
| Button size | Off / 32 / 44 / 56 / 72 / 96 |
| Steady clicks | switch |
| Moving things | switch |

Every change calls `onChange(nextFit)` (the App saves it) and updates the chart and preview live.

### Footer
- One line: "WebAble keeps learning as you browse. Change anything here, any time, from the WebAble button on any page."
- A quiet "Start over" link.

### Contract between the flow and results
```ts
// apps/extension/entrypoints/fitting/results/Results.tsx
export interface ResultsProps {
  fit: FitProfile;                    // what was just saved (or loaded)
  measured: boolean;                  // false when opened as settings without a fresh run
  onChange(next: FitProfile): void;   // App saves via logic/storage.ts and re-renders
  onRetake(): void;
  onDone(): void;                     // closes the tab
}
export function Results(props: ResultsProps): JSX.Element;
```
`fitting.html` opens at Welcome. `fitting.html#settings` opens Results with the saved fit and `measured = false`.

## The in-page UI (owned by `src/ui/panel/**`, `src/ui/App.tsx` button mount, `src/ui/offers/**`, `src/ui/explain/**`, `entrypoints/popup/**`)
**The button**
- A 52 px white circle, bottom-right, 20 px from the edges, with a soft shadow and the WebAble mark: an accent dot
  inside a ring.
- No count badge. When WebAble changed something on the page, the ring is accent; otherwise it's grey.
- Keyboard: Alt+W.

**The sheet**
A 360 px card anchored above the button, radius 24, padding 20, in the same tokens. Top to bottom:
1. "WebAble" in 17/600 and the site name in ink-2, with × to close.
2. A segmented control **[Simplified | Original]**, shown only where the simplified page is in use.
3. "Text size" with − / + buttons (44 px) and the current px between them.
4. "What WebAble did here": up to 5 lines, each with a 20 px icon, a plain sentence, and an "Undo" text button. If
   there are none: "Nothing needed changing here." Example lines:
   - "Made the text bigger"
   - "Made faint text darker"
   - "Made buttons easier to hit"
   - "Hid 6 ads"
   - "Paused a moving slideshow"
   - "Moved a pop-up out of the way" (with "Show it")
   - "Kept your clicks steady"
5. A "Pause on this site" switch.
6. Footer links: "How WebAble read this page" (opens the Jev view) · "Your settings" (opens `fitting.html#settings`).

**Everything else goes:**
- gauges, counters, "learned" lists, offer cards that ask the person to pick features, engineering words;
- the probabilities and the Jev counter, which now appear only in the Jev view.

If the page couldn't be read: "Couldn't read this page right now. Text size and buttons still work."

**The toolbar popup** (320 px) shows only:
- "WebAble" with an on/off switch;
- the site with a "Pause on this site" switch;
- [Your settings], which opens `fitting.html#settings`;
- one muted line: "WebAble adjusts each page to you automatically."

---

## Round 8c: Caden's feedback (this section wins wherever it conflicts with anything above)

1. **White, everywhere.** Every WebAble page background is pure white: the onboarding, the results page, the toolbar
   popup and the in-page sheet. `tokens.css` is already white. On white, cards need a 1 px `--c-line` border as well as
   the soft shadow. The modal dim is white at 82% with blur.
2. **No "what we learned" while it's running.**
   - Delete the right-hand rail and the chip fallback.
   - Delete any line that tells people a result before the end ("Text · 21 px" and the like).
   - Neutral transitions such as "Reading is done." stay.

   People see what we learned once, at the end.
3. **No pixels and no technical words in anything a person sees.** No "px", ratios, "contrast", "target",
   "threshold" or "setting values". Sizes are words, and an "Aa" sample drawn at the real size does the showing:
   - Text size: Standard · Larger · Large · Extra large · Largest
   - Button size: Standard · Larger · Largest

   This applies to the in-page sheet's text size too.
4. **The Finding part happens on real websites.** Fake pages aren't believable, and real sites tell us more.
   - **Instruction card:**
     - Title: "Now, some real websites"
     - What to do: "We'll open three websites, one at a time. On each one, find what we ask for and click it."
     - What success looks like: "WebAble stays off while you do this, so we see the web as it really is."
   - **The three sites, in order** (the site-task builder checks each target exists on the live page today and swaps
     in another obvious, stable target on the same page if not):
     1. Wikipedia, "Gainesville, Florida". Quiet. "Find and click: the link to the University of Florida."
     2. CNN home. Busy. "Find and click: Sports."
     3. Allrecipes, Best Chocolate Chip Cookies. Busy. "Find and click: Jump to Recipe."
   - **On each site,** a white card sits at the bottom centre, 24 px from the edge and 520 px wide. It shows "WebAble ·
     2 of 3", "Find and click: **Sports**" at 26/600, and a quiet "Skip this one" button. A found click shows a green
     check with "Found it" for 700 ms, then the next site loads in the same tab.
   - **During a task:**
     - link clicks never navigate;
     - buttons, menus and scrolling work normally;
     - WebAble's engine does not start on that tab, so nothing is changed or simplified.
   - **When it ends:** after the last site, the task tab closes and the onboarding tab comes back. If the person closes
     the task tab early, we use what we have. If a site doesn't load in 20 s, it's skipped.
   - **Back in the onboarding, two quick questions:**
     - "Which site was easier to find things on?" [Wikipedia] [About the same] [CNN]
     - "Did anything get in your way?" Chips: Moving things · Pop-ups · Too much on the page · Small text · Nothing.
   - **What goes into `FittingRaw.finding.trials`:** one trial per site, `{ clutter: busy, motion: motionSeen, ms,
     found }`. Site presses also go into `allPresses`, and their slips and near-misses count toward steady clicks and
     buttons.
5. **Results speak in problems, strongly, then the fix.** The page leads with what makes the web harder for this
   person, in their own numbers from `RunEvidence` (`fitting/logic/evidence.ts`). Only after that does it say what
   WebAble does. The fake sample pages are deleted.
   - **Heading.**
     - h1 "Here's what makes the web harder for you."
     - Deck: "From what you just did, including on real websites."
     - If nothing is strong: h1 "The web mostly works for you.", deck "A few things still get in the way. WebAble takes
       care of them."
   - **Struggle cards,** strongest first, at most four. Each card has:
     - a bold problem line in 26/600;
     - one evidence line in their own numbers, in ink-2;
     - a fix line with an accent check, starting "WebAble fixes this:".

| Struggle | Problem line | Evidence line (pick the first that has data) | Fix line |
|---|---|---|---|
| Small text | Small text slows you down. | "As the text got smaller, your reading slowed by about {pct}%." · "Some sentences were too small to read." | Text is made larger on every site, and headings stay in order. |
| Faint text | Faint grey text is hard for you to read. | "You couldn't make out words in the light grey many websites use." | Faint text is made darker. |
| Small buttons | Small buttons are easy to miss. | "You missed {n} of the {m} smaller dots." · "Some of your clicks on real sites landed just beside what you aimed for." | Buttons and links get easier to hit. |
| Click slips | Your clicks don’t always land where you meant. | "{n} of your presses slipped off what you were pressing." | Your clicks stay on what you meant to press. |
| Busy pages | Busy pages slow you down. | "Finding something on {busyName} took you {ratio} times as long as on {quietName}." · "You said there was too much on the page." | Busy pages become a clean, simple page. |
| Moving things | Moving things pull your attention away. | "You said moving things got in your way." · "Something was moving on {site} while you searched." | Moving things are paused. |

   - **Ratios and percentages** are rounded for speech: "about 40%", "twice as long", "three times as long",
     "1.5 times as long". Never show more than one decimal.
   - **The radar** is retitled "What gets in your way". Its six axes, in this order:
     - Small text
     - Faint text
     - Small buttons
     - Click slips
     - Busy pages
     - Moving things

     The values are how strong each struggle is. Show no numbers on the chart.
   - **"See it on real websites"** replaces the fake previews.
     - h2 "See it on real websites", deck "WebAble is on. Open any of these and it works by itself."
     - Four large link cards, each opening in a new tab:
       - CNN: "News, as a clean page with the story first"
       - Allrecipes: "Just the ingredients and the steps"
       - Florida Gators: "The score and the record, up front"
       - IRS: "The same page, easier to read"
   - **"Adjust anything"** uses the word levels from point 3:
     - Text size and Button size use those levels;
     - Faint text: Leave as is · Darker · Darkest;
     - Light or dark: Light · Dark · As the site;
     - "Keep my clicks steady" and "Pause moving things" are switches.

     No values in px. The "before → after" values become words ("Standard → Large").
   - The status pill "WebAble is on", the footer line and [Done] stay.
6. **The contracts are written; don't change them:**
   - `apps/extension/src/sitetask/types.ts`: the site tasks and messages;
   - `fitting/logic/evidence.ts`: `RunEvidence` and `buildEvidence`. The flow builder implements the body; the
     interface is fixed.
   - `Results` gains an optional prop, `evidence: RunEvidence | null`. The flow saves the evidence next to the settings
     (`logic/storage.ts`: `saveEvidence`/`loadEvidence`), and `#settings` loads it.
