# Wren's task: the five demo pages and the "Fresh off the frontier" story

Read `docs/agents/PLAN.md` first. This is writing and research, not code. Work on branch `wren/demo-specs` in
`github.com/cadenshokat/gatorhack`. If Sid can't access the repo, reply in the thread and Caden will add him, or paste the
files into the thread instead.

## 1. `docs/demo/pages.md`: a spec for each of the five demo pages
For each page (Alderra refill, floridagators.com opponent history vs Kentucky, Allrecipes Best Chocolate Chip Cookies,
one CNN article you pick that's likely to stay up through Monday, and IRS "Where's My Refund?"), write:
- the exact URL;
- what the page exists to show or let you do, in one sentence;
- the information that must stay in order to keep the page's meaning (list it, e.g. "Wins 54, Losses 22, home 30-6,
  away 22-13, last matchup 7-38 with both logos");
- what gets in the way today (ads, pop-ups, teasers, tiny text, moving parts) — check the live page;
- who in our "who it helps" table this page is the best showcase for, and why;
- what the ideal WebAble version looks like, in plain words: what comes first, what is folded away, what the main
  button is;
- one sentence a narrator could say over the before/after.

## 2. `docs/demo/frontier.md`: the story for the video and Devpost
The challenge asks every team to show what the new technology does, what was hard, and why it's recent. Write, in plain
spoken language (Caden hates hype and jargon; match the voice in `docs/CLAIMS.md`):
- **What Jev is and why it's recent:** TypeSafe AI's decision model, public since Sept 15 2026; version 1.14 with image
  input on Oct 14. Check docs.typesafe.ai for the facts.
- **What it does in WebAble:** read `docs/CLAIMS.md` and `docs/agents/PLAN.md`.
- **What was hard,** from our own notes in `docs/CLAIMS.md`:
  - it reads text only, so we turn pages into structured evidence;
  - its answers shifted with element order until we put each element's evidence in its own question;
  - it's injection-prone, so we added structural evidence and caution notes;
  - its accuracy is mid-tier, so we act only on high probabilities and verify every change;
  - its server blocks browser extensions, so we built a small server to hold the key;
  - its image input is experimental, so the code checks are still the real gate.
- **The numbers we can say,** only from the "Say now" section of `docs/CLAIMS.md`.
- **A 2-minute video storyboard** using the five pages: shot list, on-screen action, narration (about 280 words).

## When you're done
Push `wren/demo-specs` and reply in the Slack thread with the branch name, or paste the two files if you can't push.
