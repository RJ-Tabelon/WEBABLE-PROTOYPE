# Alfred's task: Calm view components that keep a page's meaning

Read `docs/agents/PLAN.md` first.

## Setup
1. `git clone https://github.com/cadenshokat/gatorhack.git` (or `git pull` on `main`), then
   `git checkout -b alfred/calm-components`.
2. Node 24 and pnpm 10: `pnpm install`, then `pnpm --filter @webable/extension typecheck` and
   `pnpm --filter @webable/extension build` should pass before you change anything.

## What to build
Implement the six components stubbed in `apps/extension/src/ui/calm/components/index.tsx`, against the props in
`apps/extension/src/ui/calm/components/types.ts`. Don't change `types.ts`; if a prop is missing, add an optional one and say
so in your reply.

- `StatGrid`: big, clear numbers with their labels underneath ("54 / Wins", "22 / Losses", "30-6 / Home record").
  2 to 4 per row depending on width; lead items larger.
- `Scoreboard`: two sides with their logos, names and scores, the winner clear without relying on colour alone (bold plus
  a small "Won" label), the date and label above, and an optional line score as a small readable table.
- `DataTable`: a readable table: caption, header row, generous row height, numbers right-aligned in tabular figures,
  zebra rows, "Show all N rows" after `showFirst`. It must scroll sideways inside its own box if it's too wide, never
  the page.
- `ScheduleList`: one row per item: date, logo, title, result; the current item marked; rows are buttons when
  `onActivate` is set.
- `Recipe`: title, picture, meta as a small stat row, then "Ingredients" as a checklist (tick to cross off, saved
  only in memory), then numbered "Steps" as large, well-spaced text, then notes.
- `LogoMark`: a logo with its name; sizes small, medium and large.

Put all CSS in the `componentsCss` string in `index.tsx` (or a `components.css.ts` you add next to it and re-export).

## Design rules (Calm view's look)
- White page, no boxed cards, hairline dividers (`var(--wa-line)`), one font family at weights 400/500/600, near-black
  ink `var(--wa-ink)` and grey `var(--wa-ink-2)` for labels.
- Size everything from the tokens, never fixed px for text: body `var(--wa-f)`, larger `var(--wa-f-big)`, headings
  `var(--wa-f-section)`, gaps `var(--wa-gap)` and `var(--wa-gap-s)`, row padding `var(--wa-row-pad)`, picture corners
  `var(--wa-r-media)`, click targets at least `var(--wa-t)` high.
- Pictures get `alt` text, a box with their real aspect ratio, and no frame. Never use CSS `url()`, because some sites'
  security rules block it.
- Everything works with the keyboard, has a visible focus ring (`var(--wa-focus)`), and uses real `<table>`, `<ol>`
  and `<button>` elements.
- Plain words in any UI text ("Show all 76 games", "Won").

## How to check it
Add `apps/extension/src/ui/calm/components/preview.html` plus a tiny script, or a vitest render test, that renders each
component with sample data. Use the real Gators numbers: Wins 54, Losses 22, Home record 30-6, Away record 22-13; last
matchup 11/8/2025, Florida 7 at Kentucky 38, line score 7-0-0-0 vs Kentucky's. Also use a short recipe. Screenshot it at
1440 px wide and at 900 px, and check it looks calm and clear.

## When you're done
`pnpm --filter @webable/extension typecheck` and `build` pass. Push `alfred/calm-components` and reply in the Slack
thread with the branch name, screenshots if you can attach them, and anything you couldn't do.
