# Alfred's third task: rebuild the onboarding

Read `docs/agents/ROUND8.md` first; sections 3 and 4 are your spec. Pull `main` (it now has your components and Lens v3
merged), then branch `alfred/onboarding`. You own `apps/extension/entrypoints/fitting/**` only.

## Where it is today
`entrypoints/fitting/` is a "70-second warm-up": one news-page stage that fits itself while the person taps along
(`App.tsx`, `stage/Read|Faint|Point|Find|Pick.tsx`, `screens/Start|Confirm.tsx`).

The measurement logic is worth keeping:
- `logic/quest.ts`: staircases;
- `logic/pointing.ts`: pointing analysis;
- `logic/raw.ts`: the raw collector;
- `logic/env.ts`: browser settings;
- `logic/storage.ts`.

Everything feeds core's `deriveFit()` and comes out as a `FitProfile` (`packages/core/src/types.ts`). Keep that output
contract exactly, so the rest of WebAble keeps working.

Caden's verdict: still "meticulous and unappealing". Sections aren't clear, nobody knows what to do or whether they did
it right, and the results page shows no benefit and no status.

## Build
1. **Flow:** welcome → five sections → results. A slim header shows the five section names with the current one lit.
   No timers or scores shown as pass or fail.
2. **Instruction card before every section.** A modal the person must press Start on. It has a title, one sentence on
   what to do, one on what success looks like, and a small looping animated example (static when reduced motion is
   on). Example: "Pop the bubbles. Tap each bubble as it appears. Small ones count too. Go at your own pace."
3. **The five sections as small games** (the table in ROUND8 §3). Make them feel alive: smooth transitions,
   satisfying feedback on each tap, and encouraging lines between sections ("Nice. That's your reading size."). Keep
   each section adaptive: stop as soon as the staircase or estimate is sure, about 30–40 s each.
   - **Reading size:** MNREAD-style sentences that step down about 0.1 log units. The person taps "Done reading" for
     each one. Every third sentence, ask a one-tap check ("Was there a dog in it?") so we know it was really read.
     Estimate the critical print size: the smallest size before reading slows by more than 20% from their top speed.
     Fill `text.cpsPx` and `bodyPx` (`bodyPx` is about 1.4× CPS, minimum 16) and set `reading_support` when their top
     speed is slow.
   - **Faint words:** a word appears, the person picks the matching word from three. Contrast falls on a 2-down 1-up
     staircase. Map the threshold to `contrast.band`. End with a one-tap "Which is easier to read?" light/dark choice
     for `polarity`.
   - **Pop the bubbles:** targets of 3 sizes at varied distances, about 24 taps. Reuse `pointing.ts` for misses,
     movement jitter, re-entries and hold time. Set `targets.minPx`, `clicks.steady` and `debounce`.
   - **Find it:** "Find the train times" on a clean mini page, then on a busy one with ads, teasers and one moving
     banner. The time cost of the busy version sets `attention.clutter.p`. Looking at or clicking the moving thing
     raises `attention.motion.p`. Also read `prefers-reduced-motion`.
   - **Sort the colours:** drag or tap 6 to 8 colour chips into order. This is a shortened Farnsworth D-15: crossings
     on the confusion axes set the colour need.
   - Keyboard-only path for every section, and "Skip this one" on every instruction card.
4. **Results page** (ROUND8 §4):
   - **The petal chart.** Hand-built SVG, no chart library. Eight petals, one per need, ordered and labelled in plain
     words. Each petal grows in on reveal, or is static with reduced motion. Give it an accessible table fallback.
     Put the mapping from `FitProfile` to a 0–100 "how much WebAble helps here" score per need in
     `logic/needs.ts`, with tests.
   - **"What WebAble will do for you".** Up to 4 ranked rows, each with a tiny before/after.
   - **"See it on a page like…".** A dropdown with News site, Online class, Pharmacy refill, Bank statement and Recipe.
     Each option is a mini page drawn twice, original and with their fit, behind a drag slider. Build the mini pages
     as small Preact components in `fitting/content/`, reusing `fitview.ts`'s `lookOf`. For News and Recipe, the
     "after" is the simplified page: lead content first, ads and teasers gone.
   - **Status.** "You're set. WebAble is on.", plus quiet "Change a setting" and "Retake" links.
5. **Look.** Light, modern and calm, but not vanilla. One accent colour, generous spacing, large type, soft depth.
   The bar is something Apple or Linear would ship.

## Words
Wren is writing the full copy in `docs/copy/onboarding.md` on `wren/onboarding-research`, ready around 04:00. Use the
wording in this brief and ROUND8 until then, then swap Wren's in. Never say "calibration", "fit profile", "Calm view",
"staircase" or a condition name in the UI.

## Done means
- typecheck, tests and build pass;
- screenshots of every screen at 1440 px and 390 px wide in the thread;
- push `alfred/onboarding` and reply with what you couldn't do.

Target: 07:00.
