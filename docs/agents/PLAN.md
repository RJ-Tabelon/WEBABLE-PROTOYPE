# Round 7 plan: understand the page first, for five demo pages

Shared by all the agents in #claude-grok: Lucius (Caden's Claude Code, orchestrator), Alfred (Grok + Cursor), Wren (Sid's
Claude) and Sid's Codex. Repo: `github.com/cadenshokat/gatorhack`, branch `main`. Pull before you start.

## Why we're changing course

Gator Hack's challenge is "Fresh off the frontier": build with something made public in the last 12 months, make it
central, and be ready to show what it does, what was hard, and why it's recent. Our frontier technology is Jev, TypeSafe
AI's decision model (released Sept 15 2026; image input Oct 14).

Today WebAble is underwhelming in two ways:
1. On many pages it only zooms, which other tools already do.
2. Calm view can get the page's meaning wrong. On floridagators.com's Kentucky opponent-history page it led with an
   unrelated news teaser and a photo, and dropped the record (wins 54, losses 22, home 30-6, away 22-13, last matchup 7-38)
   and the team logos, which are what the page exists to show.

## The new direction

**Jev reads the page the way a person does, then WebAble rebuilds it around what the page is for.**

- **Jev page model v2 (Lucius):** for every page Jev decides
  - the page's purpose, from about 30 kinds (record/stats, article, recipe, form/task, schedule, product, results...);
  - which region is the information the page exists to show;
  - a fine role for every element from about 50 (stat value, stat label, scoreboard, team logo, data table, schedule
    row, recipe ingredient, recipe step, byline, teaser for other content, ad, form field, main action, help...);
  - how important each region is to the page's purpose.
  Each answer comes with a probability, and WebAble only acts on the confident ones.
- **Meaning check:** before Calm view shows anything, Jev compares it with the original: does it lead with what the
  page exists to show, and is anything from the main information missing? If not, Calm view isn't offered on that page.
- **Components for meaning (Alfred):** stats as a clear grid, a scoreboard with the team logos, readable data tables,
  schedules, recipes as ingredients and steps. Logos that identify things are content, not decoration.
- **Five demo pages we optimise for (Wren specifies, Lucius builds against them):**
  1. Alderra pharmacy refill (our demo page; a task, small buttons)
  2. floridagators.com, football opponent history vs Kentucky (data and stats; UF judges know it)
  3. Allrecipes, Best Chocolate Chip Cookies (a cluttered recipe everyone recognises)
  4. A CNN news article (reading, pictures, clutter)
  5. IRS "Where's My Refund?" (an essential government task)

## Who does what

| Agent | Task | Where it lands |
|---|---|---|
| Lucius | Jev page model v2, reading tables, stats, logos and recipes from pages, the meaning-first Calm planner, the meaning check, wiring Alfred's components, testing on the five pages | `main` |
| Alfred | The Calm view components in `apps/extension/src/ui/calm/components/` (see `docs/agents/ALFRED.md`) | branch `alfred/calm-components` |
| Wren | The five pages' specs and the "Fresh off the frontier" story for the video and Devpost (see `docs/agents/WREN.md`) | branch `wren/demo-specs` |
| Sid's Codex | To be assigned once it's set up | |

## Rules for everyone
- All code is written during the hackathon. Never paste code from anywhere else.
- Only touch the files your task names. Push your own branch; Lucius merges.
- Never commit keys or `.env`.
- Plain, specific language in anything a person reads. No hype words.
- Reply in the Slack thread under the task message: the branch name, what you did, what you couldn't do.
