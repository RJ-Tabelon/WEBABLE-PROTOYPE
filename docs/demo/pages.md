# The five demo pages

What each page is for, what has to survive, and what WebAble should make of it. Written by Wren (Sid's Claude) for
round 7. Lucius builds against this; the video and Devpost use the narrator lines.

Checked on 2026-10-24 between 21:45 and 22:15 ET in a 1280×800 window, unless a page says otherwise. Counts come from a
script run on the loaded page (what's visible, at the site's own size), so expect small changes between visits.

## Who it helps

We didn't find a "who it helps" table in the repo, so this is one built from Sid's research on who needs accessibility
help and which sites they use (CDC, Pew, WebAIM and AARP figures; Sid has the write-up). It uses the terms
`docs/CLAIMS.md` allows: what a person needs, never a condition, age or health detail.

| Need | What WebAble does about it | Best showcase |
|---|---|---|
| Larger text | Raises the text size it learned for this person, and switches to a single column when a larger size would make the page scroll sideways | CNN article |
| Bigger, steadier click targets | Enlarges click areas and makes the page's main button the clear one | Alderra refill |
| Fewer distractions (busy pages cost time) | Folds ads, offers, teasers and moving parts so the page opens with what it's for | Allrecipes |
| The main task first, one thing at a time | Puts the page's task and its main button at the top | IRS refund page |
| Keep what the page exists to show | Leads with the page's main information, in a form that stays readable at a larger size | floridagators.com |

The last row applies to everyone. It's the point of round 7: WebAble can't help anyone if Calm view drops the record.

---

## 1. Alderra Pharmacy: refill prescriptions

- **URL:** `http://127.0.0.1:41741/demo/alderra/refill.html?reset=1` (our own demo page, served by the WebAble server)
- **What it's for:** refilling the prescriptions that are ready and choosing how to get them.

**Must stay (the page's meaning):**
- Heading "Refill prescriptions", and "Showing prescriptions for Rosa M." with Switch patient.
- All three prescriptions with their state, in this order:
  - Atorvastatin 20 mg tablet: Rx #6214-0387, Qty 30, 2 refills left, last filled Sep 24, est. copay $4.00, Ready to refill (checked)
  - Lisinopril 10 mg tablet: Rx #6214-1152, 1 refill left, $2.50, Ready to refill (not checked)
  - Metformin ER 500 mg: Too soon to refill, available Oct 29, Not yet (disabled)
- How to get the order: in-store pickup in about 2 hours (Alderra #4127, 1880 Magnolia Pkwy), drive-thru, or delivery
  $5.99 (free with Alderra+). In-store is selected.
- The running summary ("1 prescription selected · Est. copay $4.00").
- The **Confirm refill** button, and after it the confirmation ("Refill requested ✓ Ready around 4:30 PM", order number).
- The fine print's warnings: billing your insurance on file, controlled substances can be delayed up to 1 business
  day, orders after 6 PM go to the next business day, and generic substitution may occur. These are safety and money
  facts, so they stay open, at a readable size.
- "Questions? Call your pharmacist at (352) 555-0147."

**What gets in the way today** (from `refill.html` and `alderra.css`):
- **The main button is the weakest thing on the form.** Confirm refill is 104×28 px, grey, 13 px text. Right next to it,
  "Continue shopping" is 210×48 px, teal and bold. The "Add flu shot to order" button above it is 200×48 px and orange.
- Small text where it matters: each prescription's details are 12 px grey and cut off with "…" when they don't fit,
  the intro is 13 px, the fine print and the pharmacist's phone line are 11 px. The checkboxes are 16×16 px.
- A carousel of three offers above the form that changes every 5 seconds (flu shot, Alderra+, Halloween).
- A promo bar, a nine-item menu with four drop-downs, and a "Recommended for you" rail of products with Add buttons.
- Two upsells inside the form, between the prescriptions and the Confirm button: the flu shot and an Alderra+ trial.

**Best showcase for:** bigger, steadier click targets. The task is only a few clicks, and every one of them is on a
small target next to a big decoy. This is also the page in our pilot protocol (`docs/CLAIMS.md`), so anything we show here
we can test with people.

**The ideal WebAble version:**
- First: the heading, the patient line and the three prescriptions as a short list, each with a large checkbox and its
  details in full (no "…"). Metformin stays visible but clearly marked "Not yet, available Oct 29".
- Then: the three ways to get the order as large choices, and the summary.
- The main button is **Confirm refill**: full width, the page's strongest color, at least 48 px tall. Continue shopping
  becomes a plain link below it.
- The warnings and the pharmacist's number stay open under the button, at the body text size.
- Folded: the carousel (stopped), the promo bar, the flu shot and Alderra+ upsells, the recommended rail, the "Manage your
  prescriptions" tiles. The refill FAQ stays reachable as a folded section.

**Narrator:** "On this pharmacy page the button that matters is small and grey, right next to a big one that takes you
shopping. WebAble puts the prescriptions first and makes Confirm the button you can't miss."

---

## 2. floridagators.com: football history vs Kentucky

- **URL:** `https://floridagators.com/sports/football/opponent-history/university-of-kentucky/32`
  (`/opponent-history/kentucky/32` also works)
- **What it's for:** showing Florida's all-time record against Kentucky, the last game, and every game since 1917.

**Must stay, exactly as the page shows it:**
- Both team logos. On the page their image descriptions are only "Team Logo" (Florida) and "Opponent Logo"
  (Kentucky), so the logos carry who is who. They are content, not decoration.
- **Last matchup, 11/8/2025:** Florida 7, at Kentucky 38. By quarter, Florida 7-0-0-0 and Kentucky 3-21-7-7. Links to the
  full box score and recap.
- **The record:**

  | Wins | Losses | Home | Away | Conference | Streak |
  |---|---|---|---|---|---|
  | 54 | 22 | 30-6 | 22-13 | 54-21 | L1 |

- **Notable games:** first matchup L 0-52 on 11/29/1917; last 10 matchups 5-5 (9/10/2016 to 11/8/2025); largest margin
  of victory W 73-7 on 9/10/1994; smallest W 28-27 on 9/23/2017; total points 2071, average 27.
- **The game-by-game table,** newest first: date, season, home/away/neutral and city, result (W/L and score), media
  links. 76 games.
- Don't add numbers the page doesn't show. Home and away add up to 52-19; the other 2-3 are neutral-site games in Tampa
  and Jacksonville, and the page doesn't list a neutral record.

**What gets in the way today:**
- A scoreboard slider of this season's games across the top of every page ("Pause All Rotators" is the first link),
  then the site's main menu, before any of the record.
- A cookie notice ("We use cookies and other technology") over the bottom of the page on first visit. WebAble moves
  consent notices aside and shows the site's own choices in a small bar, but never answers them; the person still
  chooses.
- A Google ad frame, plus Related Videos and Related News at the end (Coach Sumrall interviews, "SEC Nation set for
  Florida-Georgia Game").
- Small labels and small targets: 328 clickable things, 51 of them under 24 px. The record's labels are small next to
  its numbers.
- The table is wide. At a large text size it either wraps badly or scrolls sideways.
- From `docs/agents/PLAN.md`: our old Calm view led with an unrelated news teaser and a photo, and dropped the record and
  the logos.

**Best showcase for:** keeping what the page exists to show, and for larger text. A person who needs larger text gets
the record as a big, readable stat grid instead of a zoomed page that scrolls sideways.

**The ideal WebAble version:**
- First: "Florida vs Kentucky, 1917–2025" with both logos, then the last matchup as a scoreboard (logos, 7 at 38, the
  quarters, a link to the recap).
- Then: the record as a stat grid (Wins 54, Losses 22, Home 30-6, Away 22-13, Conference 54-21, Streak L1), and the
  notable games as a short list.
- Then: the game-by-game table as a readable table that fits the width (date, home/away, result), with the media links
  folded into each row.
- Folded: the scoreboard slider (stopped), the menus, the ad, related videos and news.
- There is no main button; this is a page you read. If Jev picks a main action here, it's wrong.

**Narrator:** "This page exists to show one record. Jev finds it, and WebAble leads with it: 54 wins, 22 losses, and
last year's 7 to 38, with both logos so you know who's who."

---

## 3. Allrecipes: Best Chocolate Chip Cookies

- **URL:** `https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/`
- **What it's for:** making the cookies: what you need, how long it takes and the steps.

**Must stay:**
- Title "Best Chocolate Chip Cookies", rating 4.6 (19,331 ratings), submitted by Dora.
- Prep 20 mins, cook 10 mins, total 30 mins, servings 48, yield 4 dozen cookies.
- **All 11 ingredients, in order:** 1 cup butter, softened; 1 cup white sugar; 1 cup packed brown sugar; 2 large eggs;
  2 teaspoons vanilla extract; 1 teaspoon baking soda; 2 teaspoons hot water; ½ teaspoon salt; 3 cups all-purpose flour;
  2 cups semisweet chocolate chips; 1 cup chopped walnuts.
- **All 9 steps, in order,** with the oven temperature (350°F / 175°C) and the timings in them. The step photos can be
  folded; the words can't.
- Nutrition facts, reachable (folded is fine).

**What gets in the way today:**
- The page is about 20,000 px long, and the ingredients start about 4,700 px down: roughly six screens of scrolling.
- Ahead of them: an app banner ("Never lose a recipe again!"), a sticky ad leaderboard in the header, a video that starts
  playing muted and then floats in the corner as you scroll, a "Why you'll love this recipe" essay, and a sticky square
  ad down the side.
- 39 ad-like elements, at least one Google ad frame.
- 107 of 197 clickable things are under 24 px; 10 blocks of text are under 14 px.

**Best showcase for:** fewer distractions. Everyone recognises this page, and everyone has scrolled past the story to
find the ingredients.

**The ideal WebAble version:**
- First: the title, rating, times and servings in one line.
- Then: the ingredients as a checklist with large tick boxes, then the steps numbered, in large text, one under another.
- Folded: the essay, the video (stopped), every ad, the app banner, reviews and "more recipes" rails. Nutrition facts
  and the photos stay one tap away.
- The main action is reading. If the page offers "Jump to Recipe", WebAble doesn't need it any more.

**Narrator:** "On this recipe the ingredients start six screens down, past a floating video and the ads. WebAble opens
with the ingredients and the steps, and keeps the times."

---

## 4. CNN: one news article

- **URL:** `https://www.cnn.com/2026/10/24/health/gen-z-stare-wellness`
- **Headline:** "How to respond to the 'Gen Z stare' without looking like a total boomer" (published Oct 24, 2026,
  updated 17:32 UTC the same day)
- **Why this one:** it's a light wellness feature, not breaking news, so it's very unlikely to be pulled or rewritten by
  Monday. It has photos, quotes and ordinary CNN clutter, and its topic is fine for any audience.
- **What it's for:** reading one article.

**Must stay:**
- Headline, byline, date.
- The whole article in order: about 1,350 words in 39 paragraphs, opening with Sabrina Grimaldi's story.
- The three photos that belong to the story, with their captions and credits.

**What gets in the way today** (from the page's HTML; see the warning below):
- Ad slots inside the article (5 in the HTML), 2 video players, related-story rails and newsletter sign-up prompts.
- CNN's header and menus ahead of the headline.

**Warning:** CNN blocked the browser we used to check the pages. The Claude desktop app's browser got only "Content
Unavailable For Legal Reasons" for every CNN page, while a plain request with a Chrome user agent got the full article.
So we couldn't measure text sizes or ads on the rendered page. Before recording, open it in the Chrome you'll demo in and
check it loads, and that no consent or paywall screen comes up.

**Best showcase for:** larger text. It's a long read, and reading is where text size matters most. It's also where the
"you zoomed in on 2 sites, so it offered larger text everywhere" moment fits (see `docs/CLAIMS.md`: zoom on article
text, and only show it if it works three times in a row from a fresh profile).

**The ideal WebAble version:**
- First: the headline, byline and date, then the article at the person's text size in a single readable column.
- The three story photos stay in place, with captions.
- Folded: the ads, the video players (stopped), related rails, newsletter prompts and the menus.
- No main button; this is a page you read.

**Narrator:** "On a news article, the story is what matters. WebAble sets the text at the size you need and keeps the
photos that go with it."

---

## 5. IRS: Where's My Refund?

- **URL:** `https://www.irs.gov/wheres-my-refund` (redirects to `https://www.irs.gov/refunds`)
- **What it's for:** checking the status of your tax refund, by signing in or with the refund tracker.

**Must stay:**
- "Where's my refund?" and when status is available: 24 hours after you e-file a current-year return, 3 days after you
  e-file a prior-year return, 4 weeks after you file a paper return.
- **Both ways to check:**
  - Check in your account: refund status, tax records, amended return status, refund email notifications. Button:
    **Sign in or create account**.
  - Check without signing in, and what you'll need: exact refund amount, Social Security number or ITIN, filing status,
    tax year. Button: **Use refund tracker**.
- Other ways: the IRS app, and the phone lines (refunds 800-829-1954, amended returns 866-464-2050).
- When to expect your refund: e-filed about 3 weeks, mailed 6 or more weeks, and that delays happen when a return needs
  corrections or review.
- The refund help topics (delayed, reduced, unexpected, lost or stolen check, mistakes), folded is fine.

**What gets in the way today:**
- Not ads: it's a clean government page. The problem is order. Before the task come the "official website" banner, the
  utility menu, the main menu, search, a language switcher with 8 languages and a block of related links.
- **Both buttons sit at 807 px, just below an 800 px-tall window.** On a laptop screen you see the explanation but not
  the way to act on it.
- The buttons are 38 px tall; 41 of the page's 101 clickable things are under 24 px.
- A chat widget fixed to the corner.
- From `docs/CLAIMS.md`: on the 50-site run WebAble planned no zoom on IRS, because it read the body text as 20 px where
  it's 16 px. Fix that before recording, or this page shows nothing.

**Best showcase for:** the main task first. It's an essential government task, and the page is calm already; WebAble's
job is to bring the task up and make the two buttons easy to press.

**The ideal WebAble version:**
- First: "Where's my refund?", then the two ways to check as two large buttons side by side (stacked on a narrow
  screen), each with its one-line explanation. Under "Use refund tracker", the four things you'll need.
- Then: when to expect your refund, and the phone numbers.
- The main button is **Use refund tracker**, since it needs no account. Sign in or create account sits next to it at
  the same size, not hidden.
- Folded: the menus, the language list (except a link to switch language), related links, the help topics.

**Narrator:** "On the IRS refund page, the two ways to check are just below the first screen. WebAble brings them up
and makes them easy to press."

---

## Before recording

- Use exactly these URLs, the same ones every take, so Jev's answers are cached and repeatable.
- Fresh Chrome profile per take. Accept or reject cookie notices by hand before filming; WebAble never answers them,
  and the bar it shows instead would be in the shot.
- Don't pause the floridagators slider or the Allrecipes video by hand. Let WebAble stop them, so the change shows on
  camera.
- Check CNN loads in the demo Chrome on the day.
- Run each page three times in a row before it goes in the video, as `docs/CLAIMS.md` asks for the live zoom moment.
