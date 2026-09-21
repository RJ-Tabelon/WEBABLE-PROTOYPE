# WebAble — Accessibility Landscape and Persona Research

_Sprint 0 research brief — 2026-09-21_

## Executive recommendation

Build and validate WebAble for these three functional personas:

1. **Reduced fine-motor precision** — small or crowded controls cause mis-clicks, and dragging is
   difficult.
2. **Low vision and reduced contrast sensitivity** — text, contrast, spacing, and page reflow make
   otherwise usable content hard to perceive.
3. **Attention regulation and cognitive load** — motion, clutter, long lines, and inconsistent
   layouts make it difficult to find and stay with the main task.

These three work well together because each has a small set of reversible browser-side adaptations,
clear before/after measurements, and strong grounding in W3C guidance. They also exercise three
different parts of WebAble: pointing, visual presentation, and page understanding.

These personas are **hypotheses, not validated representations of whole disability communities**.
They must be revised after interviews and usability testing with people who have the relevant lived
experience. WebAble should store individual preferences, never a persona label or inferred diagnosis.

## What accessibility looks like now

Disability is common and diverse. The World Health Organization estimates that 1.3 billion people,
or 16% of the world, experience significant disability. It defines disability as an interaction
between a health condition and environmental and personal factors—not simply a trait located inside
a person. In the United States, the CDC reports that more than one in four adults has a disability;
its 2022 figures include cognition (13.9%), mobility (12.2%), and vision (5.5%). These categories
overlap and do not map one-to-one to product settings.

Sources: [WHO disability fact sheet](https://www.who.int/news-room/fact-sheets/detail/disability-and-health),
[CDC Disability Impacts All of Us](https://www.cdc.gov/disability-and-health/articles-documents/disability-impacts-all-of-us-infographic.html),
and [W3C on diverse abilities and barriers](https://www.w3.org/WAI/people-use-web/abilities-barriers/).

The web remains broadly inaccessible despite mature standards:

- The February 2026 WebAIM Million study found automatically detectable WCAG failures on **95.9%**
  of the top one million home pages. Because automated checks cannot detect every failure, this is a
  lower bound, not a complete conformance audit.
- The study found **56.1 detected errors per home page**, up 10.1% from 2025.
- **83.9%** of home pages had low-contrast text; 53.1% had missing image alternative text; 51% had
  missing form labels.
- The average home page contained 1,437 elements, a **22.5% one-year increase** and nearly double
  the 2019 level. More complexity creates more places for accessibility to fail.
- The same six error types accounted for 96% of detected errors for the seventh consecutive year.

Source: [WebAIM Million 2026](https://webaim.org/projects/million/).

There is stronger policy pressure than before. WCAG 2.2 is the current W3C Recommendation. In the
United States, the Department of Justice's Title II web rule requires state and local government web
content and mobile apps to meet WCAG 2.1 AA, with current compliance dates of April 26, 2027 for
larger entities and April 26, 2028 for smaller entities and special districts. The European
Accessibility Act has applied in EU member states since June 28, 2025. These rules matter, but they
do not instantly fix legacy content, cover every organization, or provide every user the same usable
experience.

Sources: [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/),
[ADA.gov Title II web rule update](https://www.ada.gov/title-ii-web-rule/), and
[European Commission overview of the European Accessibility Act](https://commission.europa.eu/strategy-and-policy/policies/justice-and-fundamental-rights/disability/union-equality-strategy-rights-persons-disabilities-2021-2030/european-accessibility-act-eaa_en).

## Why accessibility is still this way

There is no single technical explanation. The evidence supports a structural explanation:

1. **Accessibility is often treated as late compliance work, not a design input.** Knowledge,
   ownership, procurement, training, and testing are split across teams. A standard can define an
   outcome without ensuring that a team has the time, expertise, or incentive to achieve it.
2. **The web is becoming more complex faster than practices are improving.** Modern pages contain
   more components, third-party scripts, dynamic states, and custom controls. WebAIM found page
   elements up 22.5% in one year and ARIA attributes up 27%. ARIA is necessary for many custom
   interfaces, but incorrect ARIA can add barriers; its presence is not proof of accessibility.
3. **Automated tools catch only the machine-testable portion.** They are good at deterministic
   checks such as missing labels or contrast thresholds, but context-dependent questions—whether an
   alternative description is useful, instructions are understandable, or a workflow is actually
   operable—still require judgment and disabled-user testing.
4. **Conformance and personal usability are different.** A WCAG-conforming page is a crucial
   baseline, but two users can need opposing presentations. One may prefer dark text on light; another
   may need dark mode because of glare. W3C's WAI-Adapt work therefore treats personalization as a
   complement to accessible authoring.
5. **The repair dependency is badly distributed.** Today, the user usually waits for each site owner
   to fix each site. Browser settings and assistive technologies help, but sites can resist zoom,
   break under text spacing, expose poor semantics, or change their interface unexpectedly.
6. **Disabled people are still under-included in product research.** Teams can pass selected checks
   and still miss the strategies, assistive technologies, and failure modes people encounter in real
   tasks.

The short answer is: accessibility is not failing because the standards are absent. It is failing
because standards, incentives, production systems, automation, and lived-experience testing do not
consistently meet in the same delivery process. WebAble cannot repair that whole system, but it can
give the user controlled, portable adaptations while preserving the responsibility of authors to
build accessible sites.

Supporting sources: [W3C Introduction to Web Accessibility](https://www.w3.org/WAI/fundamentals/accessibility-intro/),
[W3C WAI-Adapt](https://www.w3.org/WAI/adapt/),
[W3C on involving users](https://www.w3.org/WAI/planning/involving-users/), and
[WebAIM's 2026 discussion of systemic inaccessibility](https://webaim.org/blog/tolerating-inaccessibility/).

## The three personas

The names and details below are fictional composites. The defining characteristic is a functional
interaction need, not a diagnosis. Each persona includes a first implementation that is deliberately
smaller than the person's full experience.

### 1. Maya — reduced fine-motor precision

**Snapshot.** Maya is 34 and works in customer operations. A hand tremor and fatigue make precise
pointer movement inconsistent. Some days she uses a mouse; on worse days she uses keyboard navigation
or voice input. Her goal is to complete forms and account tasks without accidental activation.

**Barriers.** Small icon buttons, controls placed close together, hover-only menus, drag-and-drop,
short timeouts, weak focus indicators, and destructive actions next to primary actions. W3C notes
that people with tremor or reduced precision are more likely to make clicking errors and benefit from
large clickable areas, sufficient time, keyboard support, and visible focus. WCAG 2.2's AA target
minimum is 24×24 CSS pixels or sufficient spacing; 44×44 is the enhanced AAA target.

**Current workarounds.** Browser zoom, moving slowly, tabbing through controls, voice control, or
asking another person to complete a precision-heavy interaction.

**First WebAble implementation.** Enlarge eligible control hit areas without changing their visible
geometry; increase space between adjacent controls; add a strong `:focus-visible` indicator; pause
moving controls; offer click stabilization after repeated slips. Do not rewrite keyboard behavior or
invent semantics.

**Success criteria.** On a repeated form task, reduce wrong-target activations and selection retries
without increasing completion time or hiding functionality. Every enlarged target must remain inside
its usable container, and tab order must be unchanged.

**Research questions.** Is 24×24 enough for this user, or is a 44×44 preference better? Does invisible
hit-area expansion create overlap? Is a 200–400 ms stabilization window helpful or frustrating? How
does the experience differ among mouse, trackpad, switch, keyboard, and voice users?

Sources: [W3C physical abilities and barriers](https://www.w3.org/WAI/people-use-web/abilities-barriers/physical/),
[WCAG 2.2 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), and
[WCAG 2.2 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html).

### 2. David — low vision and reduced contrast sensitivity

**Snapshot.** David is 58 and manages purchasing for a small business. He can see the screen but
loses text in low-contrast interfaces and struggles when zoom produces horizontal scrolling or
clipped controls. His goal is to compare information and complete purchases without constant manual
adjustment.

**Barriers.** Small or thin text, low contrast, meaning communicated by color alone, glare, long line
lengths, fixed-height containers, text that clips after zoom, and layouts that require two-dimensional
scrolling.

**Current workarounds.** Browser zoom, operating-system magnification, high-contrast or dark mode,
moving close to the display, and copying text into another app. These strategies vary by person; a
dark default is not universally better.

**First WebAble implementation.** Apply a user-chosen text-size floor, line height and text spacing;
enforce minimum text contrast; limit reading width; preserve 320 CSS-pixel reflow; allow light and
dark polarity rather than guessing. Verify every change for clipping, overlap, lost content, and
contrast regression.

**Success criteria.** Improve reading accuracy or time on the same article and form while producing
zero new clipping, overlap, horizontal page scrolling, or lost focus indicators at the user's zoom
level.

**Research questions.** Which combinations of size, contrast, polarity, spacing, and width are
comfortable together? Does WebAble cooperate with browser zoom and screen magnification? Which sites
break when styles are overridden?

Sources: [W3C visual abilities and barriers](https://www.w3.org/WAI/people-use-web/abilities-barriers/visual/),
[WCAG text spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html),
[WCAG contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), and
[WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

### 3. Priya — attention regulation and cognitive load

**Snapshot.** Priya is 27 and is completing graduate-school and benefits-administration tasks. She
has difficulty holding her place when pages contain animation, ads, multiple sidebars, dense text,
and unexpected changes. Her goal is to identify the next action and finish a task without repeatedly
re-orienting.

**Barriers.** Autoplay and carousels, pop-ups, visually competing regions, long unbroken passages,
unclear headings, inconsistent controls, timeouts, and multi-step forms that do not show location or
progress. Cognitive and learning disabilities do not imply low intelligence; they can selectively
affect attention, memory, reading, or processing.

**Current workarounds.** Reader mode, ad blockers, copying text into a document, text-to-speech,
reading rulers, browser extensions, and written notes about where a task stopped.

**First WebAble implementation.** Stop non-essential animation and autoplay; limit line length;
provide a reading ruler; dim—not delete—clearly separable promotional and recommendation regions;
show a reversible "focus view" and a simple location strip. The user chooses the mode. The first
version must not use AI to silently decide that content is unimportant.

**Success criteria.** Reduce task time, backtracking, and self-reported workload on a dense reading or
multi-step task while retaining every action and piece of source content. A user must be able to
restore the original page instantly.

**Research questions.** Does dimming help more than hiding? What content is incorrectly classified as
distraction? Which changes improve focus versus simply making the page unfamiliar? When is a summary
useful, and how should it link back to source text?

Sources: [W3C cognitive and learning abilities and barriers](https://www.w3.org/WAI/people-use-web/abilities-barriers/cognitive/),
[W3C cognitive accessibility guidance](https://www.w3.org/TR/coga-usable/), and
[W3C Stories of Web Users](https://www.w3.org/WAI/people-use-web/user-stories/).

## The AI opportunity for WebAble

WebAble's strongest opportunity is **not** "AI makes any website accessible." That claim is both
technically unsupported and dangerous. In 2025, the U.S. Federal Trade Commission finalized an order
requiring accessiBe to pay $1 million and barring unsupported claims that its automated product could
make any site WCAG-compliant. WebAble should position itself as a user-controlled adaptation layer,
not a replacement for accessible source code or expert evaluation.

AI is useful where context and variation defeat fixed rules:

1. **Convert a rendered page into a bounded adaptation plan.** The model can classify regions,
   estimate density and salience, and choose only from reviewed operations such as `increase_spacing`,
   `limit_line_width`, or `dim_region`. It returns data, never executable JavaScript.
2. **Match a page to an individual preference set.** Fixed rules perform the transformation; AI can
   decide which safe combination to offer on this page. The user accepts, rejects, or edits it.
3. **Offer source-linked simplification.** For the cognitive-load persona, AI can produce an
   optional outline, explain jargon, or rewrite a section in plain language. The original remains
   visible and each generated claim links back to its source passage.
4. **Detect likely struggle without diagnosing the user.** Repeated mis-clicks, rapid reversals, or
   repeated zoom changes may trigger a local suggestion such as "Make controls easier to select?"
   They must never produce or store labels such as "motor impaired" or "cognitively impaired."
5. **Learn from explicit outcomes.** Accept/undo, task success, and verifier results can tune future
   suggestions locally. A preference should travel across sites without exposing browsing history or
   disability status.

Current research supports a hybrid design. A 2026 empirical study found that LLM repairs improved
accessibility compliance in 80.2% of tested instances, but fully resolved fewer than 26% and made
structural changes in about 30%. A separate 2026 user-side browser-agent study found that unverified
generation improved and regressed pages at similar rates; an audit-inject-verify loop rejected all
126 deliberately harmful candidates in its benchmark. The lesson is not "AI does not work." It is
that generation must be constrained and independently verified.

Sources: [FTC final accessiBe order](https://www.ftc.gov/news-events/news/press-releases/2025/04/ftc-approves-final-order-requiring-accessibe-pay-1-million),
[LLM Based Web Accessibility Repair (2026)](https://arxiv.org/abs/2605.27716), and
[From Blind Edits to Verified Repair (2026)](https://arxiv.org/abs/2608.24913).

### AI boundaries for the product

WebAble should:

- use a versioned JSON plan with enumerated operations and bounded values;
- prefer deterministic CSS and reviewed DOM helpers for execution;
- run a post-render verifier and roll back on clipping, overlap, contrast regression, lost focus, or
  increased automated violations;
- show what changed, why it was offered, and a one-action undo;
- process locally by default and show a receipt for any data sent to a cloud service;
- evaluate benefit and harm with disabled participants, not only automated scores.

WebAble should not:

- claim WCAG or ADA compliance for a third-party page;
- generate or execute JavaScript;
- silently rewrite ARIA, accessible names, keyboard behavior, or reading order;
- infer a medical condition from behavior;
- invent image descriptions, labels, or instructions as if they came from the site author;
- remove content because a model judged it unimportant;
- replace original text with an AI summary by default.

## Recruitment and validation plan

Recruit by **functional experience and tools used**, not just diagnostic label. For example: "Do you
have difficulty selecting small or closely spaced controls?" is more useful than requiring a tremor
diagnosis. Ask what input method, zoom, magnifier, browser settings, or reading tools the participant
actually uses. Pay participants and let them test on their own equipment when possible.

Good recruiting routes are:

- [Knowbility AccessWorks](https://access-works.com/), a paid panel that tracks disability,
  assistive technology, age, and location;
- [Fable's community of accessibility testers](https://makeitfable.com/testers/), which can recruit by
  assistive technology and accommodation;
- local Centers for Independent Living through the federal
  [Disability Information and Access Locator](https://dial.acl.gov/home) or
  [ACL directory](https://acl.gov/programs/centers-independent-living/list-cils-and-spils);
- the university disability-resource center, occupational-therapy program, aging center, and local
  disability-led organizations, using an accessible paid recruitment notice;
- community groups for low vision, arthritis, tremor, ADHD, and cognitive accessibility, approached
  through organization leaders rather than scraping or cold-messaging members.

For formative work, start with 4–5 interviews per selected persona to challenge the assumptions in
this document. For comparative task metrics, use a within-subject design and conduct a power analysis
rather than assuming that five participants provides quantitative proof. Include people with
multiple disabilities, because the features must work together.

Suggested study sequence:

1. Interview participants about real tasks, current adaptations, failure recovery, and trust.
2. Observe the unmodified task using the participant's normal setup.
3. Let the participant choose or calibrate WebAble settings; do not assign a diagnostic preset.
4. Repeat counterbalanced tasks with and without WebAble.
5. Record completion, wrong activations, retries, reading/comprehension, task time, workload, and
   every adaptation defect or undo.
6. Ask what WebAble got wrong and update both the persona and the rules.

## Product implication

The defensible product thesis is:

> WebAble gives a person a portable, private preference layer that can propose and apply verified,
> reversible adaptations across websites.

It is not a compliance overlay and cannot repair missing author intent. It complements accessible
source code by addressing a different gap: the same technically accessible page is not equally usable
for every person, and people should not have to rebuild their preferred reading and interaction
environment on every site.
