# Advisor Meeting 1 — Dr. Dung Tran

**Tuesday 2026-09-08, 3:30–4:00 PM, Zoom**
Caden Shokat (runs it), RJ Tabelon, Katie Boetig (notes), Fernando Fiallos, Belal Mansour

---

## Before we join

- [ ] Send a one-page pre-read by ~2:00 PM: roster with roles, thesis in three sentences, the tech
      stack table, the deliverables window, and the questions below. He arrives prepared, and we spend
      thirty minutes on his answers instead of our context.
- [ ] Katie takes notes in the Notes section at the bottom of this file.
- [ ] Caden watches the clock and calls transitions out loud.
- [ ] Everyone on at 3:27. No minutes spent on audio checks.

**Why every item is timeboxed:** seven meetings this semester — 9/8, 9/22, 10/6, 10/20, 11/3, 11/17,
12/1 — at thirty minutes each. Three and a half hours of advisor time in total, and he grades 50% of
the course. Anything we can write down, we write down. The meeting is for what only he can give us.

**This agenda is fully subscribed.** Seven items in thirty minutes leaves no slack. If any item runs
long, we cut from the bottom of section 6 — see _If we are behind schedule_ at the end.

---

# Agenda

|     | Item                                         | Time      |
| --- | -------------------------------------------- | --------- |
| 1   | Introductions                                | 0:00–0:03 |
| 2   | Project Overview                             | 0:03–0:06 |
| 3   | Planned Technologies and Methods             | 0:06–0:10 |
| 4   | Deliverables until next meeting (9/8 → 9/22) | 0:10–0:14 |
| 5   | AI Usage                                     | 0:14–0:17 |
| 6   | Questions                                    | 0:17–0:26 |
| 7   | Recap and Next Steps                         | 0:26–0:30 |

---

## 1. Introductions — 3 min

**1a. Team members + roles (60 seconds, all five).** Name, role, what you own. One sentence each.
Roles are in the pre-read and on the pitch title slide, so this is confirmation, not biography.

- Caden Shokat — team lead, full-stack, advisor contact
- RJ Tabelon — back-end lead, database design
- Katie Boetig — scrum master, front-end lead
- Fernando Fiallos — front-end, QA
- Belal Mansour — full-stack, integration tests

**1b. Advisor (2 minutes).** Worth the time, because his answer decides what we bring him for the next
thirteen weeks:

> "What's your research area, and where in a project like this do you most want to be involved —
> architecture, evaluation design, the writing, or something else?"

---

## 2. Project Overview — 3 min

No slides. Caden, verbatim, then stop talking:

- Responsive design adapts to the screen. **WebAble adapts to the person.**
- It is a **user agent extension, not an overlay**: the user installs it, we never claim conformance
  for any site, and we never touch ARIA, focus order, or keyboard handling. That distinction is legal
  as well as technical — the FTC fined accessiBe a million dollars in 2025 over conformance claims.
- The technical contribution is **the verifier**: no transformation applies unless a post-render check
  proves it did not clip text, reduce contrast, orphan a focusable element, or increase automated
  violation counts. Failures roll back and log an adaptation defect, and we report defects alongside
  successes.
- Two personas, deeply: low vision plus dexterity, and cognitive load.

Do not walk him through the research. It is in the pre-read.

---

## 3. Planned Technologies and Methods — 4 min

This is a required pitch slide **and he signs the pitch Friday**, so he needs to see the stack before
he approves it. Four minutes, presented as a commit-check — not an architecture seminar. The real
technical review happens 9/22 against running code.

### Technologies — three layers

Draw this, then talk to it. It is the whole architecture in one picture.

| Layer                  | Stack                                                        | What it does                                                                                        |
| ---------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **Command Center**     | Next.js 15, Supabase (Auth + Postgres + RLS), Vercel         | Profile editor, calibration replay, **adaptation-defect dashboard**, "what was sent" receipts, sync |
| **Intelligence Layer** | FastAPI + Pydantic, cloud model, Railway/Render              | Onboarding interpretation, page → adaptation plan, density summarization, **cloud inference proxy** |
| **Execution Engine**   | Chrome MV3, TypeScript, WXT, React 19 + React Aria, axe-core | Summarizer, on-device model, **the verifier**, renderer. Tier 0 fires with zero setup               |

**The sentence that distinguishes us, said out loud:**

> "In comparable tools the model's output goes straight to the DOM. In ours it goes to **the verifier**
> first — nothing applies unless a post-render check proves it didn't clip text, cut contrast, orphan a
> focusable element, or raise violation counts. That gate can't live on a server, because you can't
> measure rendering from one. It lives in the extension, and it's the contribution."

**Three rules the layering does not break:** the extension never depends on the other two layers (Tier 0
works with no account and no network); the dashboard mirrors the profile rather than owning it; the
model emits data, never code.

**Proposed, voted Monday** — full detail in
[06-Technologies-and-Methods.md](06-Technologies-and-Methods.md). Inference stays tiered: Chrome's
on-device Prompt API first, cloud second, Mac app demoted to a stretch goal now that the Command Center
owns the profile.

**Two points worth stating unprompted:**

- **An API key can never ship inside an extension** — anything bundled is readable by anyone who
  installs it. That is why the Intelligence Layer exists at all beyond sync.
- **The biggest open call is Python vs. TypeScript** for the Intelligence Layer. FastAPI and Pydantic
  fit RJ's role and our analysis stack, at the cost of a schema-codegen step between layers. A TS
  backend makes it one language and deletes that seam. If he has an opinion, this is the moment.

**Say the honest trade-off out loud** — it is the kind of thing he will otherwise ask about, and
volunteering it is worth more than defending it:

> "Cloud is actually _faster_ than local on most machines. Local-first is a values choice with a real
> latency cost, and we say so in the pitch rather than pretending otherwise."

### Methods

Scrum, with Katie as scrum master. GitHub, branch naming `username/feature-name`, lint and tests on
every PR, minimum one reviewer, secrets never committed. Discord for comms, team meeting Thursdays
4–5 PM, advisor meeting biweekly Tuesdays.

**Then ask:**

> "This is the Technologies and Methods slide you'll be signing Friday. Anything here you'd push back
> on before we commit to it?"

---

## 4. Deliverables until next meeting (9/8 → 9/22) — 4 min

### Due Friday 9/11

- **Project Pitch**
- **Address the signature needed for the assignment.** The assignment requires advisor review,
  approval, and electronic signature _before_ submission, and our next meeting is 9/22 — eleven days
  after the pitch is due. There is no second chance, so settle it here, out loud:

  > "The pitch needs your review and electronic signature before we submit Friday. We'll have it to
  > you **Wednesday evening**. Does a **Thursday end-of-day** turnaround work, and would you rather
  > see the slides, a one-page summary, or both? If an outline tonight is more useful, we'll send that
  > instead."

  Leave with four things: a yes, a send time, a return time, and the format he wants.

### Due Sunday 9/13 — Unit 1 Week 3

- Weekly Individual Report
- Weekly Team's Project Status Report

### Due Sunday 9/20 — Unit 2 Week 4

- Weekly Individual Report
- Weekly Team's Project Status Report

### What we will have built by 9/22

Technical work starts **Monday 9/14**. By the next meeting we intend to have the extension skeleton and
style engine running with the verifier underway — workstreams 1 and 2, the critical path. Say this out
loud: it is what makes 9/22 worth thirty minutes, because he will have something running to look at
rather than another conversation.

### Two standing offers

Copy him on the **weekly Team Status Report** every Sunday, and add him to the **GitHub repo**. He
grades Project/Code at 20% — better that it rests on more than two presentations and a demo, and it
costs zero meeting time.

---

## 5. AI Usage — 3 min

The pitch requires an AI usage plan, so we need his read before Friday. **Two different things, stated
separately** — conflating them invites exactly the wrong question.

**5a. AI inside the product** _(one sentence — the stack is already in item 3)_

> "The model chooses Tier 2 transformations, but it **emits data, never code** — JSON plans and CSS,
> interpreted by our own bundled code. Chrome's policy defines remote code as JS and WASM and
> explicitly excludes JSON and CSS, so running model-generated JavaScript would be a store violation.
> And every model output still passes the verifier before it touches a page. We are not training a
> model; the task is selection from a fixed menu."

**5b. AI in our processes.** Lead with the policy, not the percentage — same facts, and the number
then reads as governed rather than alarming:

- **No one commits code they can't explain.** That rule is in our signed team contract.
- Every PR gets at least one reviewer, plus lint and tests.
- Under those controls, our contract estimates roughly 80% AI-assisted code.
- The pitch assignment itself prohibits generative AI, and we are writing it ourselves.

**5c. Approval.** Ask for it explicitly, because this is a slide he is putting his signature on:

> "Does that AI plan read as reasonable to you as we've written it? Do you have expectations beyond
> the course policy — a disclosure standard you want, or a threshold that would concern you? You grade
> Project/Code and Individual Contribution, so we'd rather calibrate now than discover a mismatch in
> December."

Raising this ourselves is the point. It is far cheaper as our question in week one than as his
objection in week fourteen.

---

## 6. Questions — 9 min

### 6a. How we should work together — 4 min

**"Have you advised senior project teams before?"**

**If yes:**

1. What have groups done in the past that worked best?
2. What mistakes have groups made in the past — the ones you see coming before they do?
3. How did those teams use your time? What should land in your inbox versus be raised in a meeting?

**If no:**

1. How would you like the advisor–team relationship to work, and what do you expect from us?
2. Here is what we think we need from you: review of major design decisions, a read on scope, help
   finding evaluation participants, and feedback before the graded presentations. Is that the right
   list, and is any of it outside what you want to take on?

Either branch ends in the same place: a working agreement, not a vibe.

### 6b. The three that change our plan — 5 min

Ordered by lead time, not by interest. **If the clock runs out we lose the last one, and that is the
correct one to lose.**

**Q1. Review board timing and participant access.** _(Ask this even if we ask nothing else. Approval
is never granted retroactively, and recruiting is our largest external risk.)_

> "Our evaluation is a within-subjects study with real disabled participants, twelve to sixteen per
> persona. A 2026 systematic review found this field routinely evaluates _without_ disabled
> participants — closing that gap is what makes our result defensible rather than a class project.
> Two things follow. Does presenting at Senior Showcase make this regulated human-subjects research
> here, and if so should we file in week one? And does the department, the disability resource center,
> or your own network have a relationship we could use for recruiting?"

**Q2. What the contribution is, and how we split our time.**

> "Both readings are defensible and they imply different time allocation. Is the contribution the
> _verified adaptation engine_ — a systems and safety result — or the _user study_ — an HCI result?
> Our plan currently weights the engine and treats the study as validation. Is that the right balance
> for this program?"

**Q3. Whether the novelty delta is enough.**

> "A July 2026 paper built a Chrome extension with a very similar audit–inject–verify loop, but for
> accessibility _repair_. We extend it from repair to _personalized adaptation_, and add calibration
> and behavioral offers. Is that delta sufficient for this program's standard, or should we push
> harder on one axis?"

**If he answers fast and there is slack:**

> "You grade half the course. What does an A look like to you on Project/Code and Documentation?"

---

## 7. Recap and Next Steps — 4 min

The item that makes the previous twenty-six minutes stick. Katie reads it out; Caden confirms each one
with him while he is still on the call.

**a. Read back the commitments**, with names and dates, from the table below. Anything not read back
did not happen.

**b. Confirm the three we cannot leave without:** the signature timeline, his answer on review board
filing, and any objection to the tech stack or the AI plan before Friday.

**c. Lock the calendar.** Caden sends invitations for all seven meetings today: 9/22, 10/6, 10/20,
11/3, 11/17, 12/1.

**d. Flag the milestone collision now, while he is still on the call:**

> "One scheduling note — 9/22 is your last look before Presentation 1 on 10/4, and 10/20 the last
> before Presentation 2 on 11/1. Would you like a short check-in the week before each, or would you
> rather review by email?"

**e. Set the standing rhythm.** A one-page pre-read — progress, decisions made, open questions — lands
in his inbox the day before every meeting, so meeting time is never spent on status. Ask how to reach
him between meetings, and what response time we should assume before we unblock ourselves and tell him
afterward.

**f. Within one hour of hanging up:** Katie's notes go into this file, and Caden sends a short
thank-you email restating every commitment in writing. A verbal yes on a signature deadline is worth
much less than one sitting in his inbox.

---

## Commitments to capture

| Commitment                                  | Owner    | Due             |
| ------------------------------------------- | -------- | --------------- |
| Pitch sent for review                       | Caden    | Wed 9/9 evening |
| Signed approval returned                    | Dr. Tran | Thu 9/10 EOD    |
| Calendar invitations, all seven meetings    | Caden    | Today           |
| GitHub access + CC on weekly team report    | Caden    | Today           |
| Recap email restating commitments           | Caden    | Within 1 hr     |
| Answer on review board filing               | Dr. Tran | —               |
| Recruiting contacts, if any                 | Dr. Tran | —               |
| Language / framework / build tooling chosen | Team     | Mon 9/14        |
| Extension skeleton + verifier underway      | Team     | 9/22            |

---

## Deliberately not on this agenda

- **Deep architecture review.** Item 3 is a commit-check before he signs, not a design session. No code
  exists until Monday, and reviewing a stack in the abstract over Zoom spends his strongest skill on
  the weakest version of the question. The real review is 9/22, against a working skeleton.
- **Evaluation design in detail** — tasks, metrics, statistical tests. Depends on his answer to Q1.
  Bring it 9/22 as a written protocol he can mark up.
- **Co-authorship.** Premature at meeting one. If Q3 opens the door, follow it. Otherwise it waits
  until he has seen our work.
- **The full semester calendar.** Presentation 1 on 10/4, Presentation 2 on 11/1, final deliverables
  12/2, weekly reports every Sunday. It is in the pre-read. Narrating a calendar he can read is the
  most expensive way to transmit it.

---

## If we are behind schedule

At 0:20, cut in this order: **Q3, then Q2, then 6a's follow-up questions, then item 3's Methods half**
(it is the least contestable content in the meeting). Compress item 7 to the readback and the calendar.

**Never cut the signature ask, Q1, or 5c.** Those are the three with no second chance before 9/22.

---

# Notes

_Katie fills this in live. Answers go here verbatim where possible — paraphrase loses the thing we
came for._

**1. Advisor background / where he wants to be involved**

>

**2. Reaction to the project overview**

>

**3. Tech stack — objections, preferences, language/framework opinion**

>

**4. Signature: send time, return time, format he wants**

>

**5. AI usage: approval, disclosure standard, any threshold that concerns him**

>

**6a. Advised before? What worked, what failed, how to use his time**

>

**6b–Q1. Review board — regulated or not, file in week one? Recruiting contacts**

>

**6b–Q2. Engine or study? Time allocation**

>

**6b–Q3. Novelty delta / what an A looks like**

>

**7. Cadence, ad-hoc check-ins before 10/4 and 11/1, contact method + response time**

>

**Anything he raised that we did not anticipate** _(the most valuable line in this file)_

>

**Action items — owner, deadline**

>
