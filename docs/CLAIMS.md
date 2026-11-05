# What we can claim, and how we know it

Measured on 2026-10-24 during Gator Hack. Every number below comes from a script in `scripts/claims/` or the eval
harness in `scripts/eval/`, and each section says how to run it again. Numbers from simulations are labelled as
simulations. Nothing here was measured on real users yet.

The extension runs used frozen builds of WebAble (copied aside, so other people's rebuilds couldn't change a run
halfway). Claims 1 to 3 come from the round-4 final build, taken at 19:46 (the integration commit adds only a ledger
line that says why a page kept its own size). Claims 4 and 5 and the first 50-site run used the 16:12 build of commit
`1cacf9a`. They ran in branded Google Chrome 149 at 1440×900, device scale 2, with the "rosa" demo fit (body text
22 px, bigger click areas, steadier clicks), a fresh browser profile for each run, and the WebAble server on this
laptop.

## Say now

### 1. It fitted 32 of 50 popular sites

**Say:** "We pointed WebAble at 50 sites people use every day. On 32 of them it made the text larger and left nothing
broken."

- **Number:** 32 of 50 on the final build (64%; the 95% interval is 50–76%). That's 32 of the 47 sites that loaded.
  The first run, on the 16:12 build, got 34 of 50. Say 32, the lower and newer number.
- **What counts as fitted:** the text stayed larger (the zoom WebAble chose held), nothing WebAble changed was left
  broken, no new overlapping text, and the page doesn't scroll sideways. "Nothing broken" on its own would be an empty
  claim, because undoing every change also breaks nothing.
- **Stricter count:** 28 of 50 on both runs. This also requires no extra text spilling out of its box, and no failed
  check that WebAble couldn't pin on one of its changes.
- **The sites:** 10 news, 10 health, 10 government, 3 utilities, 7 shops, 4 reference, 2 travel, 2 banks and 2
  universities. All are home pages or one public page, and we never signed in. Clean fits by group on the final build:
  news 7/10, health 9/10, government 7/10, utilities 3/3, banks 2/2, universities 1/2, reference 2/4, shops 1/7,
  travel 0/2.
- **Run to run:** between the two runs NBC News and eBay dropped out (both zooms WebAble tried failed a check against
  that day's page, so it put them back) and AP News moved up to the strict count. Live pages change between runs, so
  expect a site or two either way.
- **How:** `node scripts/eval/run.mjs --browser chrome --dpr 2 --size 1440x900 --sites real --sites-file
  scripts/claims/sites-50.json --skip lens,calm --no-ai --ext <frozen build> --out <dir>`, then
  `node scripts/claims/summarize.mjs <dir>`. It took 20 minutes. Pages that showed a bot check are listed in the run's
  `review.json` after looking at the screenshots.
- **Caveats:**
  - Target, Etsy and IMDb showed the automated browser a "prove you're human" page. They count as failures.
  - On 10 sites that loaded, the build that was measured didn't try a zoom at all and didn't say why, and on USA Today,
    NBC News and eBay every zoom it tried was undone. Those 13 are most of the misses, and they're a product gap, not bad
    luck (see "What the runs found").
  - Costco (558 px) and Publix (160 px) were left scrolling sideways.
  - This is one fit, one run per site and an automated browser, not a person using the page. AI layouts and Calm view
    were off, so it measures the page fitted in place.

### 2. It checks its own work

**Say:** "Every change gets checked, and when a change breaks something, WebAble puts it back by itself."

- **Number:** across the 47 sites that loaded on the final build, WebAble undid 22 of its own changes on 15 sites after
  a check failed. It also widened or dropped 8 column tries and kept 34 single elements (a click area or a heading) at
  the site's own size because the larger one didn't fit or couldn't be reached. (The first run: 17 changes on 13 sites.)
- **How:** the same run. Each reversal is in the page's ledger, with the check that failed.
- **Caveat:** the checks aren't perfect. Publix was left scrolling sideways with no failed check, and on 5 of the 47
  sites a check failed that WebAble couldn't pin on one change, so nothing was undone.

### 3. Jev reads a typical page in under half a second, for about a third of a cent

**Say:** "Jev reads the page before you do. On the 50-site run the typical read took under half a second and cost
about a third of a cent."

- **Number:** on the final build, median 430 ms per read, 29 of 46 pages under half a second, the 90th percentile at
  749 ms, and the range 123 ms to 3.8 s. The median cost was $0.0034 per read; all 46 reads cost $0.18 together. A
  typical read covers 178 decisions. The first run gave the same picture: median 431 ms and $0.0036.
- **How:** the same run. Only fresh reads count: each page's first read in a new profile is sent past the cache, and
  pages that only showed a bot check are left out.
- **Caveats:**
  - Read time is the round trip from the extension through the server on this laptop to Jev and back.
  - From page load to changes on screen took a median 4.4 s, because WebAble waits for the page to settle. Don't
    confuse the two.
  - The cost uses Jev 1.14's price today ($0.042 per million input tokens) and about 81,000 input tokens per read.

### 4. Same page, same questions: Jev was about 40 times faster than GPT-6 Sol and 18 times cheaper

**Say:** "We asked Jev and GPT-6 Sol the same questions about the same ten pages. Jev answered in under a third of a
second for a third of a cent. GPT took twelve seconds and five cents."

- **Number:** median 287 ms and $0.0029 per page for Jev. GPT-6 Sol took a median 12.2 s and $0.053, which makes Jev
  43 times faster and 18 times cheaper.
- **Did they agree:** they picked the same most likely role for 301 of 400 page elements (75%). WebAble would have made
  the same decision (hide, keep, protect or promote) from either model's answers for 309 of 400 (77%). They picked the
  same main action on 9 of 10 pages.
- **How they disagreed:** in 66 of the 91 disagreements, GPT's answer would have hidden something Jev kept. Jev would
  have hidden 5 things GPT kept.
- **How:** `node scripts/claims/export-decisions.mjs --urls scripts/claims/urls-jev-vs-gpt.txt --out <dir> --ext
  <frozen build>`, then `node scripts/claims/jev-vs-gpt.mjs --in <dir> --pages 10`. The ten pages were the two demo
  pages (Alderra refill, Benefits) and CNN, Drugs.com, Mayo Clinic, IRS, Medicare, Target, Wikipedia and Allrecipes.
  The GPT side cost $0.54.
- **Caveats:**
  - Agreement isn't accuracy. Nobody has labelled these pages yet, so we can't say which model is right, only that
    they mostly agree and that Jev is far faster and cheaper.
  - The setup favours GPT. It got each element's evidence once (about 7,000 tokens per page), while Jev's four
    questions repeat it (about 70,000).

### 5. What it learns about you stays on your laptop

**Say:** "What WebAble learns about you never leaves your laptop. To read a page, it sends the page's structure, with
names and numbers taken out."

- **Number:** we scanned what was sent for all ten pages above, 1,829 strings. Nothing matched a pattern for personal
  details (emails, phone, card, account or Rx numbers, addresses), and no field carried the fit or anything WebAble
  learned.
- **How:** `node scripts/claims/privacy-scan.mjs <export dir> --needles "<details known to be on the pages>"`. It checks
  each page twice, once as the extension sends it and once as the server passes it on to Jev.
- **Caveats:**
  - **Fixed after this run.** On the Alderra refill page the drug names got through: the visible labels said
    `[medication]`, but the checkbox ids still said `atorvastatin` and `lisinopril`. Class and id words are now kept only
    when they are interface or layout words (or 3 letters or fewer). A re-scan of Alderra on the final build found neither
    name anywhere in what was sent (`privacy-scan.mjs` with those needles).
  - The page's title and address path are sent (Drugs.com's title says "Metformin"). So Jev's server can tell which
    page is being read, though not who is reading it.
  - "Nothing leaves your laptop" is wrong. Say "nothing about you".

### 6. Simulation: it notices missed clicks without asking, and a bad day doesn't stick

**Say:** "In simulation, someone who misses about a quarter of their clicks gets offered bigger click areas within
their first page or two. A typical clicker almost never gets the offer, and one bad day never changes the default."

- **Numbers, simulated, through the shipped passive fit code:**
  - **Someone who misses 28% of clicks**, the rate Hurst (2008) measured for people with motor impairments: the offer
    came after a median 51 clicks (120 when the code only looks at the end of each page). Over two simulated weeks it
    turned on by default by day 2, and was on at the end in 97% of runs.
  - **A typical clicker** (6.3% misses) got an offer on 0.4% of simulated days and never had it turned on.
  - **A typical clicker with one bad day** (25% misses on day 3) got an offer that day in 38% of runs, and never had
    it turned on by default. The rule that "usual" needs 3 sites on 2 days is what stops it.
  - **A borderline clicker** (15% misses) got an offer in 78% of runs, around day 5.
- **How:** `node scripts/claims/sim-passive.mjs --runs 2000 --runs-a 1000`. It feeds simulated page views into
  `packages/core/src/fit/passive.ts`. The brief's own model (`python3 -I scripts/claims/sim/sim_passive_fit.py`)
  reproduces the signals brief, with the offer after a median 49 clicks and false offers on 11% of typical days. The
  shipped rules are stricter for typical clickers and about as fast for people who need help.
- **Caveats:**
  - These are simulated clickers, not people, and the miss rate is the only input.
  - The thresholds (offer at 70%, turn on at 90%) are our design choices.
  - The real offer rate during normal browsing still has to be measured (see below).

### 7. Simulation: the 70-second warm-up gets text size right more often than the old flow

**Say:** "In simulation, the new warm-up lands on the right text size, within one step, for 85% of people. The old
flow managed 43%. It also needs about half the presses to set click size."

- **Numbers, simulated:**

  | | Old flow | Warm-up |
  |---|---|---|
  | Text within one size step | 43% | 85% |
  | Same text size on a second try | 37% | 78% |
  | Presses to set click size | 23.5 | 13.6 |
  | Click size exact / within one level | 41% / 67% | 46% / 72% |
  | Click size set too small | 8% | 14% |

  Contrast kept the six-trial design: 81% land in the right band, and 77% land in the same band on a second try.
- **How:** `python3 -I scripts/claims/sim/sim_warmup.py` (the fitting brief's `sim_warmup2.py`; needs numpy and takes
  about 40 seconds).
- **Caveats:**
  - These are simulated readers, so they say nothing about how long real people take.
  - The "old flow" is a port that leaves out `derive.ts`'s two-part refinement.
  - The warm-up sets click size too small more often. The plan is for passive learning to correct that while the
    person browses.

## Measure with people before saying

| Claim we want | What it takes |
|---|---|
| "When WebAble hides something, it's an ad or a popup X% of the time. It hid 0 of Y help links." | Caden and Sid label the export blind, with WebAble off and without opening `jev.csv`. That's `to-label.csv`, about 60 rows a page and 1.5 hours for 30 pages. Then run `node scripts/claims/score.mjs --in <dir> --gpt <dir>/gpt-gpt-6-sol.csv`. |
| "It found the page's main button on X of 30 pages, and only outlined it when 90% sure or more." | Fill in `pages-blind.csv`; `score.mjs` reports the confident picks separately. Today Jev was 90% sure on 2 of 10 pages (both demo pages), and GPT picked the same button both times. |
| "When Jev says 90%, it's right about X% of the time." | `score.mjs` gives the Brier score and calibration error. Claim it only with 200 or more labelled rows. |
| "It offered help after N missed clicks, and made 0 offers in M minutes of normal browsing." | Three teammates browse normally for 10 minutes each with a fresh profile; count the offers. Then one person misses on purpose and we time the offer. The simulation isn't enough for this. |
| "WebAble works the moment it's installed." | A fresh install with no warm-up, on a profile with Chrome's default font set to 20 px. Check the text comes out larger on the first page. Checked once in automated Chrome: with the font at 24 px the Alderra page opened at 175% and the panel said "Text starts at 24 px because Chrome's default font size is 24 px". On sites that follow Chrome's font (Wikipedia, NPR) Chrome makes the text larger itself and WebAble only explains it, so demo it on a fixed-size page. |
| "You zoomed in on 2 sites, so it offered larger text everywhere." | The live demo moment. Run it three times in a row from a fresh profile before showing it. In automated Chrome (125% held on an NPR article, then a second site) it offered on 2 of 4 tries. The misses were honest: on BBC the zoom was over a consent screen, and on a Wikipedia page with a photo box in the middle Jev split text against picture (0.495), so that site didn't count. Zoom on article text. |
| "The warm-up takes about 70 seconds." | Use the warm-up's saved timings (`calibration` in the fit) from 10 or more people. The per-trial times in the brief are guesses. |
| "Calm view keeps the pictures that matter." | Not measured yet. |

## Never say

- Anything about compliance, the ADA or WCAG conformance. The FTC fined accessiBe $1M over claims like that.
- "Detects tremor", "detects dyslexia", or anything that names a condition. Say "noticed missed clicks" or "you zoomed
  in on 4 sites".
- Anything about age, health or how someone feels. WebAble learns the need, never the cause.
- "More accurate than GPT." We've measured speed, cost and agreement, not accuracy.
- "Works on any website." Say "32 of 50".
- "Nothing leaves your laptop." Say "nothing about you".
- SUPPLE's or anyone else's research numbers as if they were ours.
- Simulation numbers without the word "simulation".
- "186 decisions." A first read on a 40-element page is 161; the 50-site medians were 182 and 178.
- "70 million users", or any count of people we help. The CDC figures describe the population, not our users.

## How to label (Sid, about 90 minutes)

1. Caden runs the export with `--kit` and gives you only its `label-kit` folder, never `jev.csv`.
2. Double-click `label.html` in that folder. It opens in your browser with no install and no internet. Don't open the
   live pages: the pictures show them as the sites made them, with WebAble off.
3. First, for each of the 10 pages, click its main button in the picture, or press None.
4. Then, for each part in a red box, press Y (yes), N (no) or C (can't tell) for the three questions. It moves on by
   itself. ← goes back, V shows the whole page.
5. Your answers save in that browser as you go, so you can stop and come back. Keep using the same browser.
6. At the end press "Finish & download CSV", press both buttons, and send Caden `to-label.csv` and `pages-blind.csv`
   without opening them in Excel. Caden runs
   `node scripts/claims/score.mjs --in <dir> --labels <to-label.csv> --pages <pages-blind.csv>`.

## What the runs found that we should fix

- **No zoom on 10 sites.** On Fox News, Best Buy, IRS, Allrecipes, Amtrak and Delta (body text 13–16 px by the
  harness's count) and on WebMD, SSA, HealthCare.gov and UF (18–20 px), the measured builds planned no page zoom and
  wrote nothing about it in the ledger. The final build now says why in the ledger, and that shows the cause: WebAble's
  own body-text measure picks the wrong text on these pages. On Fox News and Delta it took the big headline links as
  the body (24 px, "main links"); on IRS it read 20 px where the harness reads 16. So it thought the text was already
  large enough. That gap is most of the distance between 32 and 47.
- **Every zoom undone.** On USA Today, NBC News and eBay both zoom tries failed a check (sideways scroll, overlapping
  text) and were put back. The checks did their job; a smaller zoom or the page column first might hold.
- **Sideways scroll left on.** Costco was left scrolling sideways (29 px on the first run, 558 px on the final build)
  after an overflow check failed but couldn't be pinned on one change. Publix was left scrolling 160 px with no failed check at all.
- **Drug names in class names.** Fixed; see claim 5.
- **Bot checks.** Target, Etsy and IMDb block the automated browser. That's a problem for our measurement, not the
  product, but it caps any automated "of 50".

## The files

- `scripts/claims/sites-50.json`: the 50 sites, merged into the harness with `--sites-file`.
- `scripts/claims/summarize.mjs`: the fit rate, self-reversals, and Jev read time and cost from a harness run.
- `scripts/claims/export-decisions.mjs`, `jev-vs-gpt.mjs`, `score.mjs`: export Jev's decisions, compare them with GPT,
  and score both against blind labels.
- `scripts/claims/privacy-scan.mjs`: what leaves the laptop.
- `scripts/claims/sim-passive.mjs`, `sim/sim_passive_fit.py`, `sim/sim_warmup.py`: the simulations.
- `scripts/eval/run.mjs`: the harness. For this work it gained `--sites-file`, `--skip`, `--no-ai`, `--site-timeout`,
  and a summary written after every site. Its `--dpr 2` screenshots are now true 2880×1800.
