# Fresh off the frontier: the story for the video and Devpost

Gator Hack asks every team to show what their new technology does, what was hard, and why it's recent. This is ours,
in plain spoken language. Every number in it comes from the "Say now" section of `docs/CLAIMS.md`; if a number changes
there, change it here. Written by Wren (Sid's Claude) for round 7, updated for round 8.

## What Jev is, and why it's recent

Jev is a decision model from TypeSafe AI. It doesn't write text. You give it a description of a situation and typed
questions about it: yes or no, pick one of these options, or rate on a scale. It answers every question with a
probability, quickly and cheaply, in a form code can use directly.

It is very new:
- TypeSafe announced Jev on **September 15, 2026**. Its developer libraries went public the same week (JavaScript on
  September 11, Python on September 14).
- **Jev 1.14** came out on **October 14, 2026**, ten days before Gator Hack. It added image input and a question type that
  finds things in a picture. TypeSafe calls both experimental: they're off unless you send a special "Danger Zone"
  header, and its docs say they "aren't yet up to our standards to call ready for production."

So everything WebAble does with Jev was built on a model that's about six weeks old, and the image part on one that's
ten days old.

Sources: `docs.typesafe.ai/models`, `docs.typesafe.ai/images`, and the SDK changelogs at
`docs.typesafe.ai/sdk/javascript/changelog` and `docs.typesafe.ai/sdk/python/changelog`.

## What it does in WebAble

WebAble fits web pages to the person using them: larger text, bigger click targets, fewer distractions. Code does the
fitting. Jev does the part code can't: it reads the page and says what each part is for.

- **Jev reads the page.** For every part of a page, WebAble asks Jev what job it does (the page's content, a form field,
  the main button, navigation, an ad, a teaser for other content, a pop-up, help...), whether it's part of the page's main
  task, whether it's the main action, and whether it's a way to get help. A typical read is about 178 of these decisions.
- **Code decides, and only on confident answers.** WebAble folds something away only when Jev is at least 90% sure it's
  an ad, a teaser or a pop-up, and less than 20% sure it's part of the task. Anything that might be content, a field or
  help is protected and never folded. It outlines a main button only when Jev is at least 90% sure.
- **The page's meaning.** Jev also says what the page is for (a record, an article, a recipe, a form...), which region
  holds the information the page exists to show, and a finer role for each part (a stat, a team logo, a recipe step).
- **One WebAble, no modes.** On busy pages (news, articles, recipes, sports records, guides) you simply get the
  simplified page, built around what the page is for, the moment WebAble understands it. Everywhere else it adjusts the
  page in place. One switch, "Original page", brings the site's own version back, and WebAble remembers it per site.
  Sign-in, checkout, account and statement pages are never replaced, and once you start scrolling or clicking WebAble
  never swaps the page on its own.
- **A meaning check.** Before the simplified page shows, Jev compares it with the original: does it lead with what the
  page exists to show, and is anything from it missing? If it fails, you get the original page, adjusted in place.
- **One small button.** On every page there's one small WebAble button. It opens a short sheet: text size, the
  "Original page" switch, up to five plain lines saying what changed (each with Undo), and "Pause on this site".
- **It starts with five quick games.** About three minutes: Reading size, Faint words, Pop the bubbles, Find it and Sort
  the colours. Each borrows from a published measure (the MNREAD reading test, the Pelli-Robson contrast chart, Fitts's
  law and the ISO pointing test, research on visual clutter and motion, and the Farnsworth D-15) and stops as soon as
  it's sure. The results page shows a petal chart of what helps you most and says, in plain words, what WebAble will
  do on every site. It measures needs, never conditions, and keeps learning as you browse. The research is in
  `docs/onboarding/research.md`.
- **Every change is checked.** After each change, code checks the page for text that's cut off, overlapping or
  scrolling sideways, and puts the change back if a check fails.

## What was hard

- **Jev reads text, not pages.** It can't see a website, so we turn each page into structured evidence: for every part,
  its tag, role, landmark, position, size, how much text it has, and where its links go. Names and numbers are taken out
  before anything leaves the laptop.
- **Its answers shifted with the order of the page's parts.** When we listed every part in one shared description, the
  same part got a different answer depending on what came before it. We fixed it by putting each part's evidence inside
  its own questions. Answers stopped depending on order, and we can split a page across parallel calls.
- **It can be steered by the page.** A website can label a button "Close" when it actually subscribes you. So Jev judges
  mainly from structure (tag, role, size, where the link goes), and on pages with ad frames or links to other sites each
  question carries a note that labels are written by the website and may be misleading.
- **Its accuracy is mid-tier.** It's fast and cheap, not perfect. So WebAble acts only on high probabilities, protects
  anything that might matter, and checks every change on the page afterwards.
- **Its server won't take calls from a browser extension.** So we built a small server that runs on the laptop, holds
  the API key, caches answers and talks to Jev. The extension only talks to that server.
- **Its image input is experimental.** We use it for one extra check, comparing screenshots before and after a change.
  The code checks are still what decide whether a change stays.
- **We built it like engineers.** When Caden and Sid tested round 7, the simplified page was the best thing WebAble had
  done, but everything around it had too many named features, buttons nobody understood, and an onboarding that felt
  like a chore. Round 8 cut it to one WebAble, one small button and plain words, and rebuilt the onboarding as five short
  games backed by published measures.

## The numbers we can say

From `docs/CLAIMS.md`, "Say now". Use these words, not stronger ones.

- "We pointed WebAble at 50 sites people use every day. On 32 of them it made the text larger and left nothing broken."
- "Every change gets checked, and when a change breaks something, WebAble puts it back by itself." (On the 50-site run it
  undid 22 of its own changes on 15 sites.)
- "Jev reads the page before you do. On the 50-site run the typical read took under half a second and cost about a third
  of a cent."
- "We asked Jev and GPT-6 Sol the same questions about the same ten pages. Jev answered in under a third of a second for
  a third of a cent. GPT took twelve seconds and five cents." Never "more accurate than GPT": we measured speed, cost and
  agreement, not accuracy.
- "What WebAble learns about you never leaves your laptop. To read a page, it sends the page's structure, with names and
  numbers taken out."
- Simulation numbers (missed clicks, the warm-up) only with the word "simulation".

## The 2-minute video

The onboarding, then five pages, about 260 words of narration. Record the screen in Chrome at 1440×900 with the URLs
from `docs/demo/pages.md`. Each page shows the original for a moment, then WebAble's version. Lines in brackets are
on-screen text, not narration.

The storyboard shows what round 8 is meant to do. Before recording, check each shot against what actually ships, and
cut any line the build doesn't back up.

| Time | Shot | On screen | Narration |
|---|---|---|---|
| 0:00–0:10 | Title, then the onboarding welcome | [WebAble · built on Jev, TypeSafe AI, Sept 2026] "Let's fit the web to you" | "A lot of the web is hard to use if you need bigger text, steadier clicks or fewer distractions. WebAble fits every page to you." |
| 0:10–0:28 | Onboarding: a few seconds of each game, then the results page | Reading size, Faint words, Pop the bubbles in quick cuts; the petal chart grows in; "What WebAble will do for you" rows | "It starts with five quick games, each borrowed from a published test: how small you can read, how faint is too faint, how big a button needs to be. Then it shows what it will do for you, in plain words." |
| 0:28–0:45 | Alderra refill | Original, cursor over the small grey Confirm; then the carousel stops, offers fold, prescriptions move up, Confirm refill grows; click it, "Refill requested ✓" | "On this pharmacy page, the button that matters is small and grey. Jev, a decision model TypeSafe released in September, reads every part of the page, and WebAble acts only on what Jev is very sure of. Confirm becomes the button you can't miss." |
| 0:45–1:00 | floridagators.com, Kentucky history | Original with the scoreboard slider and menus; the simplified page opens on both logos, the 7–38 scoreboard and the stat grid | "This page exists to show a record. WebAble opens with it: 54 wins, 22 losses, last year's 7 to 38, and both team logos." |
| 1:00–1:14 | Allrecipes, Best Chocolate Chip Cookies | Scroll fast past the video and ads to show the distance; reload with WebAble: it opens on ingredients and steps; flip the "Original page" switch and back | "On busy pages like this recipe, you just get the simplified page: ingredients and steps first, the ads gone. One switch brings back the original." |
| 1:14–1:28 | CNN article | Zoom in with Ctrl +; WebAble's offer appears; accept; the article reflows at the larger size with its photos | "On a news article, the story is what matters. You zoomed in on two sites, so WebAble offers larger text everywhere, and keeps the photos." |
| 1:28–1:40 | IRS refund page | Original with both buttons below the fold; WebAble brings up the two large buttons and the "what you'll need" list | "On the IRS refund page, the two ways to check are just below the first screen. WebAble brings them up and makes them easy to press." |
| 1:40–2:00 | Results card, then the five pages side by side | [32 of 50 sites · under half a second per read · about a third of a cent] | "We pointed WebAble at 50 sites people use every day. On 32 it made the text larger and left nothing broken, and when a change breaks something, WebAble puts it back by itself. Jev reads a typical page in under half a second. And what WebAble learns about you never leaves your laptop." |

Notes for the shoot:
- The CNN shot is the live "zoomed in on two sites" moment. `docs/CLAIMS.md` says to run it three times in a row from a
  fresh profile first; it worked on 2 of 4 tries in testing. If it doesn't hold, film the larger text without the zoom
  and change the line to "WebAble sets the text at the size you need, and keeps the photos."
- In the onboarding shot, don't show the games' instructions in full; show a person playing, then the results page.
  Never show a petal labelled with anything but the eight plain labels.
- Fix the IRS body-text measurement first (see `docs/demo/pages.md`), or the IRS shot shows no change.
- Accept or reject cookie notices before each take. WebAble never answers them, and the bar it shows instead would be
  in the shot.
- Keep the narration in this voice: say what's on screen and what changed. No "revolutionary", no "seamless", nothing
  about compliance, and never name a condition.
