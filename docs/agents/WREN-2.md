# Wren's second task: the research behind the onboarding, and every word a user sees

Read `docs/agents/ROUND8.md` first. Pull `main`, branch `wren/onboarding-research`. You own `docs/onboarding/**`,
`docs/copy/**` and `docs/demo/**`. This is research and writing, no code.

## 1. `docs/onboarding/research.md` (first, by 03:30)
Caden wants the onboarding backed by research. For each of the five sections in ROUND8 §3:
- **The published measure it borrows from**, with a real citation (authors, year, venue, link): MNREAD, Pelli-Robson,
  ISO 9241-9 and Fitts's law, visual search with clutter, Farnsworth D-15. Check each one; don't cite from memory.
- **Which people it helps us notice, and what they need from a page.** Low vision, tremor or limited dexterity,
  ADHD or attention differences, dyslexia, colour vision differences, motion sensitivity, older adults, and situational
  needs (glare, a phone on a bus).
- **How a short game can stand in for the clinical test**, and its limits. Be honest about what 30 seconds can and
  can't tell us.
- **What the section sets in WebAble**, in plain words.

Also cover:
- **Prior work that inferred needs from ordinary use or games.** For example:
  - SUPPLE (Gajos, Wobbrock, Weld);
  - Hurst et al. on detecting pointing problems;
  - Gajos et al. CHI 2012 on in-situ pointing;
  - Dytective (Rello et al.) on spotting dyslexia risk through a game;
  - ability-based design (Wobbrock et al. 2011).
- **Any section we should add, drop or change**, and why, from the evidence. Post the top three changes in the thread
  as soon as you have them, so Alfred can use them while building.
- **Why we show needs, never conditions.** Evidence and ethics, two short paragraphs for the pitch.

## 2. `docs/copy/onboarding.md` (by 04:00)
Every string for the onboarding and results page, in the voice of `docs/CLAIMS.md`: plain, warm, short, no jargon,
never naming a condition. That means:
- the welcome screen;
- for each section's instruction card: a title, what to do, what success looks like, and the skip line;
- encouraging lines between sections;
- the eight petal labels and a one-line explanation for each;
- "What WebAble will do for you" lines for each need at low, medium and high, with real numbers where the fit gives
  them ("Text will be 22 px on every site");
- the five sample-page names and a one-line caption each;
- the results status lines.

## 3. `docs/copy/in-page.md` (by 05:00)
Plain words for the in-page sheet and the toolbar popup (ROUND8 §2). That includes every "What changed" line the
engine can produce. Find them by searching `apps/extension/src` for the ledger and op names, and write one plain line
for each.

## 4. Update the story (by 07:00)
In `docs/demo/frontier.md` and `docs/demo/devpost.md`:
- **One WebAble, no modes:** the simplified page is simply what you get on busy pages.
- **The onboarding and its research.**
- **Fix Q7:** WebAble presses a carousel's own pause button, not a video's. Muted videos are paused directly.
- **Leave Q5 ("who pays")** for Caden.

Push the branch and reply in the thread after each part.
