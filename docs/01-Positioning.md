# WebAble — Positioning

_Written 2026-09-07. Every empirical claim is sourced in [03-Evidence-Base.md](03-Evidence-Base.md)._

---

## 1. The thesis

> Responsive design adapts to the screen. WebAble adapts to the person.

Accessibility today is a property each website is expected to implement correctly, independently, for
everyone. That model has failed in the aggregate, and it is structurally incapable of serving people
whose needs conflict with each other. A person with cataracts reads faster on a dark background. A
person with ordinary age-related contrast loss reads faster on a light one. No single site design
serves both. Only a layer that belongs to the _user_ can.

**WebAble is a user agent extension that carries a person's interface needs across the web**, applying
verified, reversible transformations to real websites while preserving every word of content and every
piece of functionality.

## 2. Why this is legitimate, not an overlay

This is the single most important distinction in the project, and it is a legal one as well as a
technical one.

Accessibility overlays are JavaScript widgets that a **site owner** installs, which claim to
automatically remediate that site for all visitors. The accessibility community rejects them, and so
does the Federal Trade Commission, which in 2025 ordered accessiBe to pay one million dollars over
claims that its widget could make a site conform to accessibility guidelines. Roughly a quarter of
United States web accessibility lawsuits in 2024 named sites that had an overlay installed. The
National Federation of the Blind formally condemned them in 2021.

WebAble inverts every property that makes overlays harmful:

| Property                                       | Overlay                             | WebAble                           |
| ---------------------------------------------- | ----------------------------------- | --------------------------------- |
| Who installs it                                | The site owner                      | The user                          |
| Who it serves                                  | Every visitor, uniformly            | One person, calibrated            |
| Compliance claim                               | "This site is now conformant"       | **None, ever**                    |
| Relationship to assistive tech                 | Competes with, overrides, conflicts | Yields to, never touches          |
| Touches ARIA / focus order / keyboard handling | Yes, and breaks them                | **Never**                         |
| Reversible                                     | No                                  | One click, always                 |
| Disability status                              | Detected and leaked cross-site      | Never inferred, never transmitted |

**This framing is standards-backed, not marketing.** The W3C's User Agent Accessibility Guidelines
(UAAG 2.0) describe exactly the responsibilities WebAble assumes: text configuration (1.4), user
stylesheets that override the author's (1.7), content linearization and maintaining point of regard
(1.8), an outline view of page structure (1.9), and persistent, restorable, _transferable_ preference
profiles (2.6). The HTML design principle of "priority of constituencies" places users above authors.
WebAble is a user agent doing its job.

And the W3C's own cognitive accessibility guidance asks for this directly. "Making Content Usable for
People with Cognitive and Learning Disabilities" Objective 8 is _Support Adaptation and
Personalization_, whose patterns include "Support Simplification" and "Enable APIs and Extensions."
The standard explicitly asks that content not disable the extensions people use as assistive
technology. WebAble is the extension that guidance anticipates.

## 3. What already exists, and the gap

**Consumer tools** fall into two buckets, and neither models the person.

- _Readers that delete the page._ Chrome Reading Mode, Safari Reader, Microsoft Immersive Reader, and
  as of 2025 Apple's system-wide Accessibility Reader. These extract an article and discard everything
  else. They cannot help you refill a prescription, submit a form, or find a button. **Apple shipping a
  system-wide reader makes reading mode table stakes, not a differentiator.**
- _Manual global knobs._ Helperbird, Dark Reader, Stylus, Arc's Boosts and Zap, OS text-size and
  pointer-size settings. All require the user to know what they need, find the control, and set it
  themselves, per site or globally. Helperbird is the closest feature-surface competitor and is purely
  a set of toggles.

**Overlays** already ship "Cognitive" and "ADHD" profiles, and one vendor already ships a
natural-language AI assistant. **WebAble therefore cannot differentiate on its feature list.**

**Agentic browsers** (Comet, the retired Atlas, Copilot in Edge) do the task _for_ the user. That is a
different product with a different value: it removes agency rather than restoring it.

**The academic lineage matters, and includes two cautionary failures.**

- IBM's Web Adaptation Technology (Hanson and Crayne, 2005) demonstrated user-side page
  personalization for older adults **twenty years ago**. The idea is not novel. What is new is the
  ability to _infer which adaptation a given page needs_.
- GPII, later Morphic (Vanderheiden), spent a decade building portable "needs and preferences" that
  auto-configure any device, including a Chrome extension that applied preference sets to web pages.
  It reached roughly ten thousand machines and won a Zero Project Award, but it stalled. Its own lead
  diagnosed why: portable preferences "doesn't help if people don't know about and can't find and
  don't use" the features, and the project pivoted to discovery.

**The gap.** A systematic review of thirty-eight papers at the Web for All conference in 2026 found the
research literature is text-centric, dominated by conformance guidelines, rarely considers cognitive
accessibility, and frequently evaluates _without disabled participants_. No shipped product combines
all four of:

1. user-owned and cross-site,
2. need inferred from calibration and interaction rather than declared from a menu,
3. transformations chosen by a model but **constrained and verified** rather than free-form,
4. help at the level of the _task_ (find the action, complete the form), not just the text.

That intersection is WebAble.

## 4. The three sentences that do the work

- **Versus overlays:** "The site never installs us, we never claim compliance for anyone, and we never
  touch ARIA, focus order, or keyboard handling. WebAble is the user's own extension, so it can never
  be redundant with their assistive technology, only additive."
- **Versus reader modes:** "Reader mode deletes the page. WebAble keeps the page working, so you can
  still check out, fill in the form, and find the button."
- **Versus agents:** "An agent does it for you. WebAble makes it doable by you."

## 5. The two design invariants that follow

Everything in the feature plan descends from two conclusions the research forces.

**Invariant 1 — Verify every transformation, and reject the ones that do harm.**
The overlay critique is fundamentally an empirical claim: automated accessibility repair is
unreliable. The answer is not to argue, it is to measure. A July 2026 paper by Wanscher and colleagues
built precisely this: a Chrome extension running an audit, inject, verify loop that accepts a change
only when accessibility violations strictly decrease. It caught all fifty-seven seeded violations and
rejected one hundred twenty-six harmful candidate edits. **WebAble adopts this as a hard invariant:
no transformation is applied unless a post-render check shows it did not clip text, did not reduce
contrast, did not orphan a focusable element, and did not increase automated violation counts.** This
is the project's central technical contribution and the direct answer to every overlay criticism.

**Invariant 2 — Offer, never impose.**
Three independent lines of evidence say silent adaptation is worse than none. Findlater and McGrenere
found static menus significantly outperformed adaptive ones, and users preferred _adaptable_
interfaces they controlled. Gajos and colleagues found that inaccurate adaptation is worse than no
adaptation at all. Lavie and Meyer found full adaptivity helped older users in routine situations but
sharply increased workload in unfamiliar ones. A 2026 study of sixty-six users found timer-triggered
help was perceived as a "gentle nudge" and more helpful than help you have to ask for, and that
seventy-seven percent wanted the system framed as a tool rather than a teammate.

**So behavioral adaptation ships as a dismissable one-line offer with a visible undo, never as a
silent change.** The profile drives deterministic changes the user configured; behavior only ever
_suggests_.

## 6. The failure mode we are designing against

Morphic's lesson is the sharpest risk in this project. **If WebAble's value requires the user to
complete a setup flow before anything improves, it will fail the way portable preferences failed.**

The design response is a mandatory product requirement: **WebAble must visibly improve the very first
page the user visits, before any onboarding, with no profile, no model call, and no network.** That is
what Tier 0 in the feature plan exists to guarantee.

## 7. What we promise and what we refuse to promise

**We promise:** reduced task completion time, fewer errors, and lower perceived difficulty for
specified tasks on specified sites, for people matching our two personas; adherence to published
thresholds for text size, spacing, contrast, and target size; safe coexistence with browser zoom and
screen readers; and complete reversibility.

**We refuse to promise:** that any site becomes conformant; that we can fix alternative text, captions,
audio description, keyboard traps in custom widgets, page language, server-side error messages,
session timeouts, or CAPTCHA. A user-side tool structurally cannot fix these, and claiming otherwise is
what the FTC fined a company for.

---

_Next: [02-Feature-Set.md](02-Feature-Set.md) for the evidence-ranked build plan and architecture decisions._
