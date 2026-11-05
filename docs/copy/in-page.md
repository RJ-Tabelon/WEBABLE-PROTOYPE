# In-page sheet and toolbar popup: every word

Plain words for the small WebAble button, its sheet, the toolbar popup, the pop-up restore line and the "What changed"
list. Written by Wren (Sid's Claude) for round 8, for the Codex task on `codex/simple-ui` (`ui/panel`, `popup`,
`ui/offers`, `ui/explain`) and for Lucius where engine titles change. Spec: `docs/agents/ROUND8.md` §1–2.

**Voice:** the same as `docs/copy/onboarding.md`. Past tense for what WebAble did ("Made the text bigger"), present tense
for settings ("Text size"). Never in the sheet or popup: Calm view, Lens, Jev, fit, tailor, ledger, verify, rollback,
decision, confidence, probability, percentages. Those words stay inside "How WebAble read this page".

`{curly}` marks a value filled in by the code.

---

## The small button

- **Accessible name:** WebAble
- **Tooltip:** WebAble: what changed on this page
- **When paused on this site:** the button is greyed, accessible name "WebAble, paused on this site"

## The sheet

From top to bottom:

1. **Site line:** WebAble is on for {site} · paused: WebAble is paused on {site}
2. **Original page switch** (only where the simplified page is in use)
   - Label: Original page
   - Helper under it, when off: You're seeing a simplified version of this page.
   - Helper under it, when on: Showing the page as the site made it. WebAble will remember this for {site}.
3. **Text size**
   - Label: Text size
   - Buttons: Smaller · Bigger (accessible names "Make text smaller", "Make text bigger")
   - After a press: Text is now {px} px on {site}.
   - At the limit: That's as small as it goes. · That's as big as it goes on this page.
4. **What changed**
   - Heading: What changed
   - Up to five lines (see "What changed lines" below), each with an **Undo** button (accessible name "Undo: {line}")
   - After an Undo: Undone. **Redo**
   - More than five changes: "and {n} more" as a link that opens "How WebAble read this page"
   - Nothing changed: Nothing needed changing on this page.
5. **Pause on this site**
   - Button: Pause on this site · when paused: Turn back on for this site
   - After pausing: Paused. {site} is back to normal until you turn WebAble on here again.
6. **Link at the bottom, small:** How WebAble read this page

## The toolbar popup

- **Title line with switch:** WebAble is on · when off: WebAble is off
  - Switch accessible name: Turn WebAble on or off
- **Button:** Pause on this site · when paused: Turn back on for this site
- **Link:** Your settings (opens the results page of the onboarding)
- **When WebAble is off:** WebAble is off on every site. Turn it on to fit pages to you again.

## A pop-up WebAble moved aside

One plain line in the corner where it went, with one button:
- Line: Moved a {thing} out of the way.
  - `{thing}` is one of: pop-up, sign-up box, survey, chat window, banner
- Button: Show it again
- Cookie notice: Cookie choices for this site, with the site's own buttons beside it. WebAble never answers it.

## Explain card (`ui/explain`)

- Button on a selected passage: Explain this
- Card title: In plain words
- While writing: Writing a plain version…
- Footer: Checked against the original. Anything that might be missed is shown in the site's own words.
- When it can't: Couldn't write a plain version of this one.
- Close button: Close

---

## "What changed" lines

One plain line for each change the engine can make, taken from the titles it writes today
(`apps/extension/src/engine/tailor.ts`, `controller.ts`, `overlays.ts`). **Sheet** means it can appear in "What
changed"; **Read view** means it belongs only in "How WebAble read this page". Keep numbers only where a person would
care about them.

### Changes WebAble makes (sheet)

| Engine today | Plain line |
|---|---|
| `Zoomed this page to {z}% (was {from}%)` | Made the text bigger |
| `Text larger: page zoom {z}%` / `Text smaller: …` (the person's own press) | Made the text bigger · Made the text smaller |
| `Lines in paragraphs are spaced {L}× …` | Added space between lines |
| `Made {n} heading(s) larger so they stand out from the text` | Made headings stand out |
| `Held the page to a {w} px column so lines stay a readable length` | Narrowed the page so lines are easier to follow |
| `Long lines are shorter (about {n} letters)` | Made long lines shorter |
| `Thin text is a little heavier (at least {w})` | Made thin text bolder |
| `Darkened {n} faint text item(s) to at least {r}:1 contrast` | Made faint text darker |
| `Made {n} button(s) and link(s) easier to hit ({T} px hit area)` | Made buttons easier to hit |
| `Steady clicks: a small slip while clicking still counts` | A small slip while clicking still counts |
| `Ignoring accidental double clicks on buttons and links` | Accidental double clicks count once |
| `Animations and transitions jump straight to their end` (detail lists paused videos and banners) | Stopped things moving · or, when the detail says so: Paused {n} video(s) that played by themselves · Paused a moving slideshow |
| `Keyboard focus shows a clear ring` | Made it clear where the keyboard is |
| `Let the top bar scroll away (it covered {s}% of the screen)` | Let the top bar scroll away |
| `Dimmed {what}{label} ({role} {p})` | Hid {n} ad(s) · Hid {n} offer(s) · Hid {n} link(s) to other stories (group them; never show the probability) |
| `Moved the cookie notice into a short bar (it covered …)` | Moved the cookie notice into a small bar |
| `Tucked away the chat window that opened by itself …` / `Minimised the chat window that opened by itself …` | Tucked away a chat window that opened by itself |
| `Tucked away the {noun} pinned to the …` / `… that floated over the page` | Moved a {pop-up · banner · sign-up box} out of the way |
| `A calmer layout of this page is ready: open Calm view` / Calm view opened | Simplified this page (and the "Original page" switch appears) |
| `The moving banner stopped` | Paused a moving banner |
| `Things you move to with the keyboard scroll clear of pinned bars` | Kept pinned bars from covering what you're on |
| `Kept {n} heading(s) at the site's own size where a larger one did not fit` | Read view only |
| `Kept {n} click area(s) at the original size where a larger one would not reach` | Read view only |

### Things WebAble put back, or chose not to do (read view, with one exception)

| Engine today | Where | Plain line |
|---|---|---|
| `Reversed {thing}: {check}` | Sheet, once per page, only if the person would notice the change disappear | Put back {the bigger text · the darker text · …}: it didn't fit this page |
| `Kept the page as it was: …` / `Kept this page at its own size …` | Read view | Kept this page at its own size: a bigger one didn't fit |
| `Kept your own zoom ({z}%)` | Sheet | Kept the zoom you set |
| `Could not apply {thing}` | Read view | Couldn't change {thing} on this page |
| `Kept this page at full width …` / `Page width is automatic …` / `Showing {site} at full width` | Read view | Kept this page at full width |
| `Kept the page as it was: a {px} px column did not fit` | Read view | Kept this page at full width: a narrower one didn't fit |
| `Text is {eff} px here; your size is {target} px` | Read view | Text here is {eff} px; your size is {target} px |
| `Left the cookie notice for you to answer` / `You answered the cookie notice with the site's own button` | Read view | The cookie notice is yours to answer |
| `Kept {what} in front{task}` / `{what} covers this page; WebAble left it as it is` | Read view | Left {what} where it is because you may need it |
| `Kept "{name}" in view (help …)` / `Protected {n} more item(s) the task needs` | Read view | Kept help and the things this page needs in view |
| `Calm view is not offered on this page: {reason}` / `Calm view did not open: …` | Read view | Didn't simplify this page: the simple version would leave out something it's for |

### Status and learning lines (read view, or the popup)

| Engine today | Where | Plain line |
|---|---|---|
| `WebAble is turned off` | Popup | WebAble is off |
| `WebAble is paused on this site` | Sheet site line | WebAble is paused on {site} |
| `No warm-up yet: …` | Sheet, once, above What changed | Using your browser's settings for now. Play the five quick games to fit pages to you. (link: Play now) |
| `Offered: {question}` / `You accepted: {question}` | Offer line in the corner | {question as written}, then: Done. You can change it any time in Your settings. |
| `WebAble noted that {thing} did not help` | Read view | Noted that {thing} didn't help here |
| `Did not offer bigger buttons: your fit already makes them large here` | Read view | Buttons here are already big enough for you |
| `Watching, not acting yet: …` | Read view | Watching this page; nothing to change yet |
| `Undid: {title}` | Sheet, as the Undo result | Undone. Redo |
| `Closed Calm view` / `Showing the original page` / `Back to your fitted page` | Sheet switch state only | (no line; the "Original page" switch shows the state) |

### Read view only (the curious and judges)

These stay as they are, in "How WebAble read this page", where the technical words are allowed:
- `Read the page: {n} items in {ms} ms`
- `Jev read this page: {n} decisions in {s} s (${cost})` and the cached version
- `Jev is now sure this page is {kind} ({p})`, `Jev read {n} new items …`
- `Nothing on this page needed a decision`
- `Jev could not be reached, so only your fit was applied` (in the sheet, show instead: "Couldn't read this page right now. Text size and buttons still work.")
- `Jev found {n} distractions; your fit leaves them as they are`
- The layout lines (`A layout picked by Jev is ready …`, `Jev kept the simple layout …`, `AI layouts are off …`, `This page has password or payment fields, so no AI sees it …`, `No other layout was available …`)
- The screenshot-check lines (`Jev checked the new layout against a screenshot …`, `Reversed the new layout …`, `The screenshot check was not available`)
- `{Jev checked · Checked} that Calm view keeps what this page is for: it leads with …`

---

## Notes for the build

- The plain line can come from the op kind plus a count, so `ui/panel` doesn't have to parse engine titles. If that
  needs a field, add it as optional in `ui/panel` and tell Lucius (contracts change only through him).
- Group same-kind lines: "Hid 6 ads", not six lines.
- Order: the change the person is most likely to notice first (simplified page, bigger text, hidden ads), then the rest.
