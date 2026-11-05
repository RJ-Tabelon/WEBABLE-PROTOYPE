# Round 8: one WebAble, a real onboarding, plain words

Caden and Sid tested round 7. The simplified page on CNN was the best thing WebAble has done. What's wrong now is
everything around it: it feels built by engineers for engineers. Too many named features, too many buttons, technical
words, and an onboarding that feels like a chore with a results page that doesn't say what you get.

Deadline: submission Sunday 5 PM ET. Agent work lands by **08:00 Sunday**; we integrate until 11:00, then record.

## The product decisions (everyone builds to these)

### 1. There are no modes. There is just WebAble.
- No "Calm view", "Lens", "fit", "tailor", "ledger", "verify", "rollback" or "Jev" in anything an ordinary user sees.
- On busy pages (news, articles, recipes, sports records, guides, with lots of ads, teasers and competing parts),
  WebAble shows the simplified page **by default**, the moment the page is understood. Elsewhere it adjusts the page in
  place: text size, faint text, button size, steady clicks, moving things.
- The one control for this is a switch: **"Original page"**. WebAble remembers it per site.
- Sign-in, checkout, account and statement pages are never replaced; they only get in-place adjustments.
- Once you start scrolling or clicking, WebAble never swaps the page on its own.

### 2. The in-page control is one small button.
Clicking it opens a small sheet with only:
- "WebAble is on for {site}";
- the "Original page" switch (only where the simplified page is in use);
- text size, smaller and bigger;
- "What changed": at most five plain lines, each with Undo, like "Made the text bigger" or "Hid 6 ads";
- "Pause on this site";
- at the bottom, a small link, "How WebAble read this page", that opens the Jev view for curious people and judges.
  The Jev counter, gauges and probabilities live there, not in the main sheet.

### 3. Onboarding is a short, friendly set of games, then a results page that sells the benefit.
About 3 minutes:
1. A welcome screen;
2. Five sections. Each starts with an instruction card the person has to press Start on: what to do, what success looks
   like, and a tiny animated example;
3. A results page.

The five sections are each built on a published measure, with plain names:

| Section | What the person does | Based on | What it sets |
|---|---|---|---|
| Reading size | Read short sentences that get smaller, tap when done; now and then a one-tap check that they read it | MNREAD reading test (critical print size, reading speed) | text size, reading support |
| Faint words | Pick the word that matches as words fade | Pelli-Robson letter contrast, run as a staircase | contrast, light or dark preference |
| Pop the bubbles | Tap targets of different sizes and distances | ISO 9241-9 pointing tests and Fitts's law; tremor from movement jitter and misses | button size, steady clicks |
| Find it | Find a named item on a clean page, then on a busy page that has one moving thing | Visual search with clutter (Rosenholtz); distraction by motion | busy pages, moving things |
| Sort the colours | Put a few colour chips in order | Farnsworth D-15, shortened | colours |

Each section stops early once it's sure. Keyboard-only users get a keyboard path, and anyone can skip a section.
We **measure needs, never diagnoses**. The results never name a condition ("learns the need, never the cause").

### 4. The results page
- The top line is the benefit: "Here's how WebAble will fit the web to you."
- A chart of the person's needs: a **petal chart** (radial bars), one petal per need, longer meaning more help. It keeps
  the modern shape of a radar chart but avoids its known problem: a radar's filled area changes with axis order and
  exaggerates differences. The chart has 8 petals with plain labels:
  - Small text
  - Faint text
  - Small buttons
  - Steady clicking
  - Moving things
  - Busy pages
  - Long reading
  - Telling colours apart
- Under the chart, up to four "What WebAble will do for you" rows, ranked: the need in plain words, what changes on every
  site ("Text will be 22 px everywhere, with headings kept in proportion"), and a tiny before/after.
- "See it on a page like…", a dropdown with five options, shows that page before and after with their settings, using
  a slider:
  - News site
  - Online class
  - Pharmacy refill
  - Bank statement
  - Recipe
- Status at the end: "You're set. WebAble is on." with "Change a setting" and "Retake" as quiet links.

### 5. Adding things to a page is allowed, rarely
We add only something the page already says, said more clearly. We never invent information. For now:
- a green dot beside a "Live" label, pulsing only if moving things are fine for this person;
- an "Ad" tag on paid content that's styled to look like a story;
- "6 min read" on long articles that don't already show it.

### 6. Jev gets a finer vocabulary
Fine roles go from 65 to about 120, and new questions are added: "is this live or updating?" and "is this paid content
dressed as a story?". We measure it on pages we didn't tune on, so the accuracy claim is honest.

## Who does what

| Who | Branch | Owns (only these files) |
|---|---|---|
| Alfred | `alfred/onboarding` | `apps/extension/entrypoints/fitting/**` |
| Sid's Codex (or Alfred, if Codex isn't free) | `codex/simple-ui` | `apps/extension/src/ui/panel/**`, `apps/extension/entrypoints/popup/**`, `apps/extension/src/ui/offers/**`, `apps/extension/src/ui/explain/**` |
| Wren | `wren/onboarding-research` | `docs/onboarding/**`, `docs/copy/**`, `docs/demo/**` |
| Lucius (local) | `main` | engine, `ui/calm/**`, `ui/App.tsx`, core, server |

Contracts (`packages/core/src/types.ts`, `apps/extension/src/contracts.ts`) change only through Lucius. If you need a
field, add it as optional in your own files and say so in your reply.

Rules for everyone:
- Run `git pull` on `main` first.
- Node 24 and pnpm 10: `pnpm install`, then `pnpm -r typecheck`, `pnpm -r test` and
  `pnpm --filter @webable/extension build` must pass before you push.
- No new runtime dependencies without saying why.
- Plain words in every string. Read `docs/CLAIMS.md` for the voice.
- Respect reduced motion everywhere.
