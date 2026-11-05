# Devpost write-up

Ready to paste into Devpost; due Sunday 5 PM. Built from `docs/demo/frontier.md`, `docs/agents/PLAN.md` and
`docs/CLAIMS.md`. Every number comes from the "Say now" section of `docs/CLAIMS.md`; if one changes there, change it
here. Written by Wren (Sid's Claude) for round 7, updated for round 8 (one WebAble, the onboarding games).

There's no separate positioning doc in the repo, so the positioning here is taken from those three files: WebAble fits
pages to one person, it's the person's own tool, it makes no compliance claims, and it only does what it can check.

---

## WebAble

**Web pages that fit the person reading them.** Built on Jev, TypeSafe AI's decision model, released in September 2026.

## Inspiration

A lot of the web is hard to use if you need bigger text, steadier clicks or fewer distractions. One in four US adults
reports a disability (CDC, 2022), and many more just find small grey text, tiny buttons and busy pages slow going. The
tools people have today mostly zoom the whole page, which often breaks the layout, or are overlays a website installs
for itself.

We wanted something that works the other way round: a tool the person owns, that learns what they need and fits each
page to them, without asking about their health and without breaking the page.

## What it does

WebAble is a Chrome extension. It learns what you need, then fits the pages you visit to you.

- **It starts with five quick games.** Reading size, Faint words, Pop the bubbles, Find it and Sort the colours, designed
  to take about three minutes. Each borrows from a published measure: the MNREAD reading test, the Pelli-Robson
  contrast chart, Fitts's law and the ISO pointing test, research on visual clutter and motion, and the Farnsworth D-15.
  Each stops as soon as it's sure. The results page shows a petal chart of what helps you most and says, in plain words,
  what WebAble will do on every site: "Text will be 22 px on every site", "Buttons and links will be at least 44 px".
- **It learns your needs, not your health.** It never names a condition. While you browse, it notices things like
  zooming in on several sites, or clicks that just miss, and offers a change. You can accept, undo or ignore it.
- **Jev reads the page before you do.** For each part of a page, Jev says what it's for: the page's content, a form field,
  the main button, an ad, a teaser for another page, a pop-up, help. It also says what kind of page it is and which part
  holds the information the page exists to show. Every answer comes with a probability.
- **WebAble fits the page in place.** Larger text, bigger click areas, the main button made clear, ads and offers folded
  away. It acts only on answers Jev is very sure of, and it never folds anything that might be content, a field you need,
  or a way to get help.
- **It makes room.** Pop-ups that open by themselves and cover what you're doing get tucked to the edge, one tap to
  bring back. Cookie notices are moved aside with the site's own choices in a small bar; WebAble never answers them for
  you.
- **On busy pages, you just get the simplified page.** News, recipes, sports records and guides open built around what
  the page is for: a sports record becomes a stat grid with both team logos, a recipe opens on the ingredients and steps.
  There are no modes to choose. One switch, "Original page", brings the site's version back, and WebAble remembers it
  per site. Sign-in, checkout, account and statement pages are never replaced.
- **It checks the meaning first.** Before the simplified page shows, Jev checks it against the original: does it lead
  with what the page exists to show, and is anything missing? If not, you get the original page, adjusted in place.
- **One small button.** On every page there's one small WebAble button. It opens a short sheet: text size, the
  "Original page" switch, up to five plain lines saying what changed (each with Undo), and "Pause on this site".
- **Every change gets checked.** After each change, WebAble checks the page for text that's cut off, overlapping or
  scrolling sideways. When a change breaks something, it puts it back by itself.
- **Hard passages, explained.** Select a dense paragraph and WebAble writes a plain version. Code checks that every number
  survived, and Jev checks that each original sentence is covered; anything that isn't is shown in the original words.

## How we built it

- **The extension** is TypeScript and Preact, built with WXT. It turns each page into structured evidence (for every part:
  its tag, role, landmark, position, size, how much text it has and where its links go), with names and numbers taken
  out, and applies the fit.
- **A small server on the laptop** (Node and Hono) holds the API keys, caches answers for 30 minutes and talks to Jev and
  OpenAI. The extension only talks to that server.
- **Jev** answers typed questions through TypeSafe's System One API: pick one of these roles, is this part of the main
  task, is this the main action, is this help. A typical page is about 178 of these decisions, asked in parallel.
- **Code makes every decision.** The thresholds (fold at 90% or more, protect at 5% or more that something matters,
  outline a main button only at 90% or more) live in one shared core package, with tests.
- **The onboarding is built on research.** Each of the five games borrows from a published measure and an adaptive
  method that stops once it's sure. We checked every source and wrote down what a 30-second game can and can't tell
  us (`docs/onboarding/research.md`).
- **GPT writes, Jev judges.** Where we need writing, OpenAI's models draft it: candidate layouts for the simplified page
  (GPT-6 Sol) and plain-language explanations (GPT-5.4 mini). Jev then judges each layout and checks each explanation against
  the original.
- **We measured as we went.** A Playwright harness runs WebAble over 50 popular sites in a fresh browser profile and
  checks the result. Separate scripts compare Jev with GPT-6 Sol on the same questions, scan everything sent for personal
  details, and simulate how the passive learning behaves.
- **How the team worked:** Caden and Sid, with several AI coding agents (Claude Code, Grok with Cursor, Codex) taking
  tasks in a shared Slack channel and pushing their own branches for review. All code was written during the hackathon.

## Challenges we ran into

- **Jev reads text, not pages.** It can't see a website, so we had to design the evidence it reads for every part of a
  page, and keep personal details out of it.
- **Its answers shifted with the order of the page's parts.** When every part sat in one shared description, the same part
  could get a different answer depending on what came before it. Putting each part's evidence inside its own questions
  fixed it, and let us split a page across parallel calls.
- **A page can try to steer it.** A website can label a button "Close" when it actually subscribes you. Jev judges mainly
  from structure, and on pages with ad frames or links to other sites each question carries a note that labels are
  written by the website and may be misleading.
- **Its accuracy is mid-tier.** It's fast and cheap, not perfect. So WebAble acts only on high probabilities, protects
  anything that might matter, and checks every change afterwards.
- **Its server won't take calls from a browser extension,** so we built the local server to hold the key.
- **Its image input is ten days old and experimental.** We use it for one extra before-and-after check; the code checks
  still decide whether a change stays.
- **The simplified page could get a page's meaning wrong.** On floridagators.com's Kentucky history page it led with a
  news teaser and dropped the record and the logos. That's why we built the page-purpose questions and the meaning check.
- **We built it like engineers.** When we tested it ourselves, the simplified page was the best thing WebAble did, but
  everything around it had too many named features, buttons nobody understood, and an onboarding that felt like a chore.
  We cut it to one WebAble, one small button and plain words, and rebuilt the onboarding as five short games.

## Accomplishments that we're proud of

- "We pointed WebAble at 50 sites people use every day. On 32 of them it made the text larger and left nothing broken."
- "Every change gets checked, and when a change breaks something, WebAble puts it back by itself." On that run it undid
  22 of its own changes on 15 sites.
- "Jev reads the page before you do. On the 50-site run the typical read took under half a second and cost about a third
  of a cent."
- "We asked Jev and GPT-6 Sol the same questions about the same ten pages. Jev answered in under a third of a second for
  a third of a cent. GPT took twelve seconds and five cents."
- "What WebAble learns about you never leaves your laptop. To read a page, it sends the page's structure, with names and
  numbers taken out." We scanned 1,829 strings sent for ten pages and found no personal details.
- In simulation, someone who misses about a quarter of their clicks gets offered bigger click areas within their first
  page or two, and one bad day never changes the default.

## What we learned

- **The evidence matters more than the wording.** How we laid out each part's evidence changed Jev's answers more than how
  we phrased the questions.
- **A probability is a product decision.** Choosing where to act (90% to fold, 5% to protect) is where safety lives, and
  it's code we can read and test, not a model's mood.
- **Fail closed.** If Jev doesn't answer, or isn't sure, WebAble leaves the page alone.
- **Agreement isn't accuracy.** Jev and GPT agreeing tells us they're consistent, not that either is right. That needs
  people labelling pages blind.
- **Count honestly.** "Nothing broken" alone is an empty claim, because undoing every change also breaks nothing. Our
  count requires the larger text to have held.

## What's next for WebAble

- **Measure accuracy.** Label pages blind and score Jev's answers, including how often "90% sure" is right.
- **Test with people.** A pilot: eight people refill a prescription on our demo pharmacy page using their non-dominant
  hand on the trackpad, with WebAble on and off.
- **Fix the misses.** On 10 of the 50 sites WebAble didn't try to enlarge the text at all. We traced it to misjudging
  which text on the page is the body text, and it's most of the gap between 32 and the 47 sites that loaded.
- **Validate the games.** Compare each game's result with the clinical test it borrows from, on the same people.
- **More kinds of simplified pages,** and pictures, once Jev's image input is ready for production.

## Built with

Jev 1.14 (TypeSafe AI, System One API) · OpenAI Responses API (GPT-6 Sol, GPT-5.4 mini) · TypeScript · Preact · WXT ·
Chrome extensions · Node.js · Hono · Zod · Vitest · happy-dom · Playwright · pnpm · Python and NumPy (simulations)

---

## The 10 hardest judge questions

**1. Isn't this an accessibility overlay?**
No. Overlays are installed by a website on itself, often with promises about compliance; WebAble is the person's own
extension, fits pages to that one person, and makes no compliance claims. It changes only what it can check, and puts
back anything that breaks the page.

**2. Why Jev and not GPT?**
On the same ten pages and the same questions, Jev answered in under a third of a second for a third of a cent, and
GPT-6 Sol took twelve seconds and five cents. WebAble has to read the page before you start reading, so we use Jev for
the 178 or so quick decisions on a typical page and GPT only where something has to be written, with Jev checking that writing.

**3. How accurate is it?**
We haven't measured accuracy yet, only speed, cost and agreement: Jev and GPT-6 Sol picked the same role for 75% of 400
page parts and the same main action on 9 of 10 pages. Because we don't know yet, WebAble acts only on answers Jev is very
sure of, checks every change, and blind labelling is the next thing we're doing.

**4. What happens to my data?**
What WebAble learns about you never leaves your laptop. To read a page it sends the page's structure with names and
numbers taken out; the page's title and address are sent, so Jev's server can tell which page is being read, but not who
is reading it.

**5. Who pays for this?**
Reading a page costs about a third of a cent at Jev's price today, so the running cost per person is small. We haven't
settled who pays; a personal subscription, or an organisation paying for its people, are the options we're weighing.

**6. What if it hides something I need?**
It folds something only when Jev is at least 90% sure it's an ad, a teaser or a pop-up, and anything that might be
content, a field or help is protected and never folded. Every change is listed in the sheet with an Undo, and the
simplified page isn't used if Jev's meaning check finds the page's main information missing.

**7. Can a website trick it?**
It could try, for example by labelling a "subscribe" button "Close". Jev judges mainly from structure rather than the
site's own labels, and WebAble only ever presses two kinds of button: a chat window's own minimise button (only when Jev
picks the same one with the options in both orders and code rules out links and submit buttons) and a slideshow's own
pause button, while videos that play muted are paused directly.

**8. Does it work on every site?**
No: on 32 of 50 popular sites it made the text larger and left nothing broken. Most misses are pages where it misjudged
the body text size, which we know how to fix, and a few sites blocked our automated browser outright.

**9. How do you know it helps real people?**
We don't yet: our numbers come from automated runs over real sites and from simulations. The next step is a pilot with
eight people doing a prescription refill with WebAble on and off.

**10. Why couldn't this be built a year ago?**
It needs a model that answers about 178 typed questions about a page in under half a second, for a fraction
of a cent, with a probability on every answer. Jev, released in September 2026, is the first we've used that does that;
a general chat model took twelve seconds on the same questions.

---

## Notes for Caden

- **Check before pasting:** "Hard passages, explained" and "GPT writes, Jev judges" describe code that's in the repo
  (`apps/server/src/routes/explain.ts`, `redesign.ts`). Cut them if they're not in the demo build.
- **"How the team worked"** names the AI agents. Keep it if you want to be open about how it was built; cut it if you'd
  rather not.
- **Question 5** is the one answer that isn't backed by `CLAIMS.md`. Change it to what you actually plan.
- **"Calm view" is gone from the user-facing story** (round 8: no modes). This file now says "the simplified page".
- **"About three minutes"** for the games is the design target, not a measured time. Say "designed to take" until it's
  timed on people.
- **Never say** (from `CLAIMS.md`): compliance, ADA or WCAG; condition names; age or health; "more accurate than GPT";
  "works on any website"; "nothing leaves your laptop" (say "nothing about you"); counts of people we help.
