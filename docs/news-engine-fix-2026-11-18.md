# News preservation and CSS text sizing

Follow-up: [0.1.2 presentation hardening](presentation-hardening-2026-11-18.md).

The extension is built as 0.1.1. Its onboarding remains the restored Gatorhack flow.

## Changes

- Page text is sized through a reversible CSS map. Small text grows toward the fit;
  headings retain their hierarchy. New content receives the same map without
  compounding previous scaling. Constrained controls can retain their own size,
  and unsafe changes are reduced or reversed.
- Automatic fitting and A+/A− no longer multiply Chrome zoom. The person's browser
  zoom is preserved, including a manually selected 200%. Explicit narrow columns
  use CSS and remain subject to layout checks.
- News typography uses story text rather than tiny credits/player labels when the
  source has no substantial running paragraphs.
- Calm view preserves headline destinations and paired editorial photos. A local
  inventory supplements stories omitted by remote outline limits. Games and
  streaming promotions remain reachable below the main news. Editorial stories
  retain source order, including a first story without a still photo.
- Cached photos become visible immediately; transient failures can recover.
  Auxiliary purpose widgets appear after the news index.
- Turning off AI layouts also prevents group composition requests.

## Verification

Live Fox News and CNN were opened in a disposable Google Chrome profile with the
production extension. The profile pointed at an unused loopback port, AI layouts
were disabled, and no reader profile was saved. These checks made no OpenAI calls
and did not modify account/database data. They exercised deterministic adaptation
and Calm view; paid AI-generated rewrites/layout responses were not exercised.

Fox's Calm view retained 184 links and displayed 32 loaded photos; CNN retained 43
links and displayed 22 loaded photos. Both stayed at 100% browser zoom. Counts are
from the loaded pages, including initially collapsed links, rather than a guarantee
about future publisher content or not-yet-loaded stories. Screenshots and JSON
measurements are in `output/news-engine-fix-2026-11-18/`.

`pnpm engine:verify-news` repeats a local browser regression without a running API
server. At 1440px and 390px it checks CSS body growth from 14px toward the fit
(about 22px initially, about 25px with the saved A+ step), headline hierarchy, no horizontal overflow, dynamically inserted text, linked
photos, editorial lead selection, and restoration through Original page. The
desktop case also checks that manual 200% zoom survives A+.

The engine, extension and server suites passed (830 tests total); all three
TypeScript checks passed, and the production extension built successfully.
`pnpm engine:check-source` verifies the frozen 319-file Gatorhack baseline with
12 explicit, documented adaptations. Original source hashes are retained.

Reload WebAble in `chrome://extensions`, then refresh existing news tabs. If Chrome
still remembers an excessive zoom chosen by an older build, use its zoom menu to
choose your preferred level once; the engine now preserves that setting.
