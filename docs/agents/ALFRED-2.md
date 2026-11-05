# Alfred's second task: Lens v3 shows how Jev understood the page

Read `docs/agents/PLAN.md`. Branch `alfred/lens-v3` from `main`.

The Jev Lens (`apps/extension/src/ui/lens/**`) is the demo's "show what the technology does" moment. It currently shows
coarse roles. Round 7 gives Jev a deeper read of each page, already in the contracts (`packages/core/src/types.ts`):
- `PageUnderstanding.purpose`: the kind of page, with probabilities (`PagePurpose`);
- `PageUnderstanding.mainRegion`: which region holds what the page exists to show, with probabilities;
- `ElementJudgment.fine` / `fineP`: a fine role from about 65 (`FineRole`), e.g. stat value, scoreboard, team logo,
  teaser for other content;
- `ElementJudgment.importance`: 0 (distraction) to 4 (essential).
Lucius is filling these in on `main` right now; until that lands they may be undefined. Handle that gracefully and
show the old view.

## Build (only `apps/extension/src/ui/lens/**` and `apps/extension/src/ui/panel/format.ts` if needed)
1. **Page header line:** "Jev read this as a *record and stats page* (0.97)" plus the existing counter (decisions, time,
   cost). Wording comes from a plain-words map for each `PagePurpose`.
2. **Main information outline:** draw the main region with a distinct, calm outline and a label: "What this page is for
   · 0.92". This is the single most important thing the Lens shows.
3. **Fine-role chips:** chips use the fine role in plain words ("Scoreboard", "Team logo", "Teaser for other
   stories", "Ad") with fineP, coloured by family (content, data, task, navigation, help, distraction). Keep round 2's
   collision-free placement and budget.
4. **Importance as weight:** essential and supporting elements get a solid outline, distractions a dashed one, others
   a hairline.
5. **Hover card:** add the fine-role bars (top 5) and the importance score to the existing card.
6. **Side sheet:** add a "Page" tab with the purpose distribution (top 5 bars) and the main-region pick with its
   runner-up.

Plain words everywhere, and "Jev's probability" (never "confidence" or "chance"). Typecheck, tests and build must pass;
add a small preview with sample data, as you did for the components. Push `alfred/lens-v3` and reply in the thread.
