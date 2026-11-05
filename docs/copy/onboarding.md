# Onboarding and results page: every word

Every string a person sees in the onboarding and on the results page. Written by Wren (Sid's Claude) for round 8, for
Alfred's build on `alfred/onboarding` (`apps/extension/entrypoints/fitting/**`). The research behind each section is in
`docs/onboarding/research.md`.

**Voice:** plain, warm, short. Talk to one person. Say what to do and what happens, nothing else.
**Never in the UI:** a condition or diagnosis, age, health, "calibration", "fit", "profile", "test", "score", "Calm
view", "Lens", "Jev", "staircase", "threshold", "probability", "pass", "fail". A section is a "game", "step" or by its
name; a result is "what WebAble will do".

`{curly}` marks a value filled in by the code. `·` separates alternatives the code picks between.

---

## Welcome screen

- **Title:** Let's fit the web to you
- **Body:** Five quick games, about three minutes in all. They show WebAble how you like to read, click and find things,
  so every site can work that way for you.
- **Line under the body:** What you do here stays on this computer.
- **Main button:** Start
- **Quiet link:** Skip for now and use the standard settings
- **Small print under the link:** You can play the games any time from WebAble's menu.

## Header (the five steps)

Reading size · Faint words · Pop the bubbles · Find it · Sort the colours

- Screen reader label for the header: Step {n} of 5: {step name}
- A skipped step shows: Skipped

---

## Instruction cards

Each card has a title, what to do, what success looks like, a small looping example, a Start button and a skip line.

### 1. Reading size

- **Title:** Reading size
- **What to do:** Read each sentence the way you normally would, then press **Done reading**. The sentences get smaller as
  you go.
- **Before you start:** Sit as you usually do, and wear your usual glasses if you use them.
- **What success looks like:** There's no right speed. Every few sentences we'll ask a quick question about what you read,
  just to check the sentence came through.
- **Button:** Start
- **Skip line:** Skip this one

**During the step**
- Button under each sentence: Done reading
- Check question (template): Was there {thing} in that sentence? → **Yes** · **No**
- If the text gets too small to read: a quiet link, **I can't read this one**
- When it stops: That's enough. We have your reading size.

### 2. Faint words

- **Title:** Faint words
- **What to do:** A word appears, then fades a little each time. Pick the matching word from the three below it.
- **What success looks like:** Keep going until it's too faint to tell. Guessing is fine; it's meant to get hard.
- **Button:** Start
- **Skip line:** Skip this one

**During the step**
- Prompt above the choices: Which word did you see?
- If they can't tell: a quiet button, **I can't tell**
- Closing question: Which is easier to read? → **This one** (under the light version) · **This one** (under the dark
  version) · **Both are fine**

### 3. Pop the bubbles

- **Title:** Pop the bubbles
- **What to do:** Tap each bubble as it appears. Some are small and some are far apart.
- **What success looks like:** Go at your own pace. Near misses are fine; they help WebAble learn.
- **Keyboard version:** Press Tab to move to the next bubble and Enter to pop it.
- **Button:** Start
- **Skip line:** Skip this one

**During the step**
- Counter, quiet, top right: {popped} of {total}
- No message on a miss. Just let the bubble wait.

### 4. Find it

- **Title:** Find it
- **What to do:** We'll name something on a small page. Find it and press it. There are three short rounds.
- **What success looks like:** Just find it as you normally would. The pages change a little between rounds; that's on
  purpose.
- **Button:** Start
- **Skip line:** Skip this one

**During the step**
- Prompt, round 1: Find the train times
- Prompt, round 2: Find the train times
- Prompt, round 3: Find the train times
- Between rounds: Round {n} of 3
- If they take a long time: a quiet link after 20 seconds, **I can't find it**

### 5. Sort the colours

- **Title:** Sort the colours
- **What to do:** Put the colour chips in order, so each one is next to the one most like it. Start from the one that's
  already in place.
- **What success looks like:** Some are close. Go with what looks right to you.
- **Keyboard version:** Use the arrow keys to pick a chip and Enter to place it.
- **Button:** Start
- **Skip line:** Skip this one
- **When done:** Button **Done**

---

## Between the steps

One line each, shown for a moment before the next instruction card.

- After Reading size: Nice. That's your reading size.
- After Faint words: Got it. Now WebAble knows how faint is too faint.
- After Pop the bubbles: Good. That sets how big buttons should be.
- After Find it: Thanks. That tells WebAble how busy is too busy.
- After Sort the colours: All done. Here's what we found.
- After any skipped step: No problem. On to the next one.

---

## Results page

### Top

- **Headline:** Here's how WebAble will fit the web to you
- **Subline:** Based on the five games. WebAble keeps adjusting as you browse, and you can change anything, any time.

### The chart

- **Chart title (for screen readers and the table fallback):** What helps you most
- **Chart caption:** Longer petals mean WebAble helps more there.
- **Table fallback column headings:** What · How much WebAble helps
- **Value words in the table:** A lot · Some · A little · Not needed

**The eight petals: label and one-line explanation**

| Petal label | One-line explanation (shown on hover or tap, and in the table) |
|---|---|
| Small text | How much larger text makes reading easier for you. |
| Faint text | How much darker grey and pale text needs to be. |
| Small buttons | How much bigger buttons and links should be. |
| Steady clicking | How much a slip or a double press should be forgiven. |
| Moving things | How much slideshows, autoplay and moving banners get in your way. |
| Busy pages | How much ads, teasers and clutter slow you down. |
| Long reading | How much extra spacing helps on long articles. |
| Telling colours apart | How much pages that use colour alone need a label or pattern too. |

### "What WebAble will do for you"

Up to four rows, the most helpful first. Each row: the need in plain words, what changes on every site, a tiny
before/after, and a one-tap adjust.

- **Section title:** What WebAble will do for you
- **One-tap adjust on each row:** Less · More · Turn off
- **After an adjust:** Changed. You'll see it on the next page you open.

**Lines by need and level.** Low means the petal is short; show a row only if the need is medium or high, unless fewer
than two rows qualify.

**Small text** (from `text.bodyPx`)
- Low: Text stays close to each site's own size, and never smaller than {bodyPx} px.
- Medium: Text will be {bodyPx} px on every site, with headings kept in proportion.
- High: Text will be {bodyPx} px everywhere. Pages switch to one column so nothing runs off the side.

**Faint text** (from `contrast.band`, and `polarity`)
- Low: Very faint text will be darkened so it's easy to read.
- Medium: Grey and pale text will be made darker on every site.
- High: All text will be as dark as it can go against its background, and a little bolder.
- Dark pages chosen: Where a site offers it, pages will use a dark background.

**Small buttons** (from `targets.minPx`)
- Medium: Buttons and links will be at least {minPx} px tall, so they're easier to hit.
- High: Buttons and links will be at least {minPx} px, with more space between them.

**Steady clicking** (from `clicks.steady` and `clicks.debounce`)
- Medium: If the pointer slips a little while you click, it still counts as the click you meant.
- High: That, plus an accidental second press counts as one.

**Moving things** (from `attention.motion.on`)
- Medium or high: Slideshows, videos that play on their own and moving banners will be paused. Press play when you want
  them.

**Busy pages** (from `attention.structureLevel`)
- Level 1: Busy pages will put the main content first and move ads and teasers out of the way.
- Level 2: News, recipes and other busy pages will open simplified: just what the page is for. You can switch to the
  original page any time.

**Long reading** (from `spacing.lineHeight` and the reading support flag)
- Medium or high: Long articles will get more space between lines ({lineHeight}× spacing) and lines that aren't too long
  to follow.

**Telling colours apart**
- Medium or high: Where a page uses colour alone to say something, WebAble will add a word or a pattern too.

**When no need is above low:**
- Most pages already work well for you. WebAble will keep an eye out and only step in when a page makes something hard,
  like tiny text or a pop-up in the way.

### "See it on a page like…"

- **Label:** See it on a page like…
- **Slider labels:** Original · With WebAble
- **Slider hint (first time only):** Drag to compare.

| Option | Caption under the preview |
|---|---|
| News site | A news story with ads and related links all around it. |
| Online class | A course page with a video, a reading and a due date. |
| Pharmacy refill | Refilling a prescription: small buttons and lots of fine print. |
| Bank statement | A statement with a table of payments. It keeps its layout; only the text and buttons change. |
| Recipe | A recipe under a long story and a lot of ads. |

### Status at the end

- **Status line:** You're set. WebAble is on.
- **Under it:** It works on every site you visit. Look for the small WebAble button in the corner of the page.
- **Quiet links:** Change a setting · Retake the games
- **If any step was skipped:** You skipped {step name}. WebAble will learn that part as you browse, or you can
  [play it now].
- **If they skipped everything:** WebAble is on with standard settings, and will learn what helps as you browse.

---

## Small things

- **Reduced motion on:** the examples on instruction cards show one still frame, with no extra text.
- **Leaving partway (close or Back):** Want to stop here? What you've done so far is saved. → **Keep going** · **Stop for
  now**
- **Coming back later:** Welcome back. Pick up where you left off? → **Continue** · **Start over**
- **Something went wrong saving:** That didn't save. Try once more? → **Try again**
