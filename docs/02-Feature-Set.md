# WebAble — Architecture Decisions and Evidence-Ranked Feature Set

_Written 2026-09-07. Sources in [03-Evidence-Base.md](03-Evidence-Base.md). Positioning in [01-Positioning.md](01-Positioning.md)._

---

# Part A — Architecture decisions

Eight decisions, each with the finding that forced it.

## AD-1. The Chrome extension is the product. The Mac app is an accelerator.

Nothing may require the Mac app to function. The extension must work standalone, including on Chrome
for Windows.

**Why.** Chrome's built-in Prompt API, backed by the on-device Gemini Nano model, has been stable for
extensions since Chrome 138. It runs in the service worker, popup, and side panel, and needs no extra
manifest permission. On-device inference no longer requires a native application, which was the Mac
app's original justification.

**What the Mac app is still for.** Three things Chrome genuinely cannot do, in priority order:

1. **A larger context window.** Gemini Nano gives roughly six thousand tokens. Apple's Foundation
   Models framework gives four thousand ninety-six on macOS 26 and eight thousand one hundred
   ninety-two on macOS 27. Neither is generous, but the Mac app can also run a local model through
   MLX or llama.cpp with a much larger window when a page summary does not fit.
2. **Profile ownership independent of Google.** The user's profile living in a local application, not
   in Chrome's sync store, is what makes "the accessibility layer belongs to you" literally true.
3. **A path beyond the browser.** System-wide accessibility is the long-term product; the Mac app is
   where that starts.

**Sequencing.** Build the extension to completion first. The Mac app is the last major workstream.

## AD-2. Tiered inference: on-device first, cloud fallback, all behind one interface.

```
InferenceProvider (interface)
├─ ChromeBuiltIn      LanguageModel / Prompt API, Gemini Nano, ~6K tokens, free, private
├─ NativeHost         Mac app via Native Messaging → Apple Foundation Models or MLX
└─ Cloud              Claude Haiku 4.5 (or equivalent) with strict JSON schema
```

Selection is by capability probe at runtime, then by whether the page summary fits the provider's
context window, then by user preference.

**The honest trade-off, which must be stated in the pitch.** Local is not simply better.

| Path                     | Latency for a page adaptation | Cost                         | Privacy                            |
| ------------------------ | ----------------------------- | ---------------------------- | ---------------------------------- |
| Chrome built-in (Nano)   | Fast, but ~6K token ceiling   | Free                         | Nothing leaves the device          |
| Local 7–8B on base M1    | Roughly a minute or more      | Free                         | Nothing leaves the device          |
| Local 7–8B on M4 Pro/Max | Competitive                   | Free                         | Nothing leaves the device          |
| Cloud small model        | Around six to seven seconds   | Fractions of a cent per page | Redacted summary leaves the device |

Cloud is _faster_ than local on most machines. Local-first is a values choice with a real cost, and
saying so is more credible than pretending otherwise.

## AD-3. The model emits data. It never emits code.

The model returns a JSON **adaptation plan** and CSS strings. Bundled, reviewed extension code
interprets that plan. The extension never evaluates model-generated JavaScript.

**Why.** This is Chrome Web Store policy, not preference. Remotely hosted code is defined as
JavaScript or WASM loaded from anywhere other than the extension's own files, and the policy
explicitly excludes "data or things like JSON or CSS." Executing model-generated JavaScript would be a
policy violation and grounds for removal. This constraint is a gift: it is the external justification
for the constrained transformation engine that the research independently recommends.

**Schema design rule.** Keep the plan schema flat, with enumerated operations and no nesting.
Benchmarks published in 2026 show grammar-constrained decoding guarantees well-formed JSON but that
small models still make _semantic_ errors, and that forcing validity on small models can increase
them. Flat enums minimize the surface for semantic error.

## AD-4. CSS first, DOM surgery second, and never at all for ARIA.

Three escalating mechanisms, used in strict order of preference:

1. **Injected stylesheets** via `chrome.scripting.insertCSS` with user origin, so page author styles
   can still win where they must. Covers the entire P0 tier.
2. **Per-shadow-root adopted stylesheets.** Page-level CSS does not cross shadow boundaries. Closed
   roots are reachable through `chrome.dom.openOrClosedShadowRoot`. Dark Reader's adopted-stylesheet
   manager is the reference implementation.
3. **Structural DOM changes**, only for the Tier 2 and Tier 3 features, always additive or
   attribute-level, always reversible.

**Absolute prohibitions.** Never inject or modify ARIA. Never change an accessible name. Never alter
focus order or keyboard handling. Never remove an element from the document; hide it with a mechanism
that also removes it from the tab order, and always offer to restore it. These prohibitions come
straight from the documented ways overlays break screen readers.

## AD-5. Every transformation passes a verifier, or it is rolled back.

The verifier runs after render and checks:

- **Clipping and overflow.** Text clipped or overlapped after size or spacing changes.
- **Contrast regression.** Any text or non-text element whose contrast ratio decreased.
- **Orphaned focus.** Any element now visually hidden but still reachable by keyboard, or focused but
  obscured.
- **Automated violation delta.** Run an accessibility rule engine before and after; the count must not
  increase. Report per-rule deltas, never a single score, because WebAble changes exactly the criteria
  that automation detects and a single number would flatter it.
- **Re-render survival.** Diff the DOM after the site's own framework re-renders.

Any failure rolls that transformation back and logs an **adaptation defect**. Defect counts per site
are a headline metric in the evaluation, reported alongside successes.

**Precedent.** Wanscher and colleagues, July 2026, built an audit-inject-verify loop that accepted a
change only when violations strictly decreased, caught all fifty-seven seeded violations, and rejected
one hundred twenty-six harmful candidates. We extend it from repair to adaptation.

## AD-6. Privacy: an allowlist summarizer, plus a visible receipt.

When a page summary must leave the device, it is constructed by an **allowlist**, never by scrubbing a
denylist.

**Kept:** tag names, ARIA roles, heading levels, landmark structure, control types, label text up to a
short cap, hashed element identifiers, positional and size metadata.
**Dropped entirely:** all form field values, every password, hidden, and search input, free text beyond
labels (replaced with a token noting word count), URLs beyond origin, and all storage.

Every element in the plan is addressed by a hashed identifier, so the cloud provider never receives
page content and cannot reconstruct it. The user can open a **"what was sent"** panel showing the exact
payload for the current page.

**Why this matters beyond ethics.** A privacy policy is required for a Chrome extension even when
processing is entirely local, because browsing activity and scraped page content both count as user
data. The Limited Use policy tightened in July 2026 to require data be strictly necessary for the
extension's single stated purpose. And the overlay critique specifically calls out that detecting
assistive technology leaks disability status. Privacy is a differentiator here, not a footnote.

## AD-7. Permissions: earn breadth, do not demand it.

Ship with `activeTab` and `scripting`, which produce no install-time warning. Offer optional host
permissions per site during onboarding, and reserve all-sites access for an explicit "always on"
opt-in. Broad host permissions trigger the "read and change all your data on all websites" warning and
materially lengthen store review, which is already slower for new developers.

## AD-8. Sync: tiered, with the profile small enough to fit every tier.

The profile is a versioned preference set kept under eight kilobytes. Three tiers:

| Tier       | Mechanism                           | Server   | Account                | Chrome on Windows | Honest description                    |
| ---------- | ----------------------------------- | -------- | ---------------------- | ----------------- | ------------------------------------- |
| Local only | `storage.local`                     | No       | No                     | Yes               | Nothing leaves the machine            |
| Convenient | `chrome.storage.sync`               | Google's | Google, Chrome Sync on | Yes               | Synced by Google, not encrypted by us |
| Private    | Encrypted blob on a minimal backend | Yes      | Yes                    | Yes               | Zero knowledge; we cannot read it     |

**Constraints that set the size budget.** Chrome's sync store allows roughly one hundred kilobytes
total and eight kilobytes per item, and silently degrades to local-only when the user is not signed
in. Apple's iCloud options are larger but Apple-only, which fails the Chrome-on-Windows requirement.

Client-side encryption keeps confidentiality honest but not independence, so the claim is
**"local-first processing, zero-knowledge sync,"** never "no server." Key loss means profile loss, so a
recovery code is required.

**Standards note for the pitch.** UAAG 2.6 explicitly calls for persistent, restorable, and
_transferable_ preference profiles. The sync requirement is standards-backed, not a convenience
feature.

---

# Part B — The feature set

Organized into four tiers. **The tier number is the build order and the demo order.** Priority labels
P0/P1/P2 come from the evidence review: strength of empirical support weighed against implementation
risk.

## Tier 0 — Instant value, zero setup _(the answer to Morphic)_

No profile. No model. No network. Runs on the first page the user ever visits, immediately after
install. Pure injected CSS.

| Feature                              | Persona | Evidence  | Risk   | Priority |
| ------------------------------------ | ------- | --------- | ------ | -------- |
| Minimum text size floor              | A       | Strong    | Low    | **P0**   |
| Text spacing to published minimums   | A, B    | Strong    | Low    | **P0**   |
| Contrast enforcement                 | A       | Strong    | Medium | **P0**   |
| Stop motion, autoplay, and carousels | A, B    | Strong    | Low    | **P0**   |
| Focus indicator enhancement          | A, B    | Consensus | Low    | **P0**   |

**Parameters, from the evidence.** Body text floor of sixteen pixels, persona A preset of eighteen to
twenty, hard cap around twenty-four to twenty-eight because reading speed _declines_ above roughly one
degree of visual angle. Line height at least one and a half, paragraph spacing at least double, letter
spacing at least 0.12 em, word spacing at least 0.16 em; letter spacing benefit plateaus at 0.20 em.
Text contrast at least 4.5 to 1, targeting 7 to 1 for persona A; non-text at least 3 to 1. Focus
indicator at least a two-pixel perimeter with a 3 to 1 change, applied on `:focus-visible` only.

**Two findings that shape defaults.**

- Contrast polarity and font size interact: the advantage of dark text on light backgrounds _grows_
  as text gets smaller. Ship size and contrast together, never separately.
- Default to light polarity but make dark a first-class toggle. Readers with cataracts or corneal
  scatter read ten to fifteen percent _faster_ on dark backgrounds. This is why onboarding asks the
  user which is easier rather than assuming.

**Must coexist with zoom.** Nearly half of low-vision users rely on screen magnification and browser
zoom, while only about one in eight uses custom stylesheets. Scale with relative units so WebAble
composes with zoom instead of fighting it.

## Tier 1 — Calibrated profile _(deterministic, still no model)_

The onboarding flow produces a preference set; these features read it. Still pure CSS plus small,
well-scoped DOM additions.

| Feature                               | Persona | Evidence | Risk   | Priority |
| ------------------------------------- | ------- | -------- | ------ | -------- |
| Target enlargement and spacing        | A       | Strong   | Medium | **P0**   |
| Hide or dim distracting content       | A, B    | Strong   | Medium | **P0**   |
| Reading width limiting                | A, B    | Moderate | Medium | **P1**   |
| Click stabilization                   | A       | Moderate | High   | **P1**   |
| "Where am I" location strip           | A, B    | Moderate | Low    | **P1**   |
| Reading ruler / line focus            | B       | Moderate | Low    | **P1**   |
| Text to speech with word highlighting | B       | Strong   | Low    | **P1**   |
| Plain sans-serif toggle               | B       | Moderate | Low    | **P2**   |

**Parameters.** Hit areas of at least forty-four CSS pixels with at least eight pixels between adjacent
controls, achieved with invisible padding rather than geometry rewrites, because touch positions
cluster within about eight millimeters regardless of the drawn target size, and older adults with
reduced finger flexibility need targets near nineteen millimeters. Reading width of sixty to
seventy-five characters per line; lines beyond eighty cause loss of place, and lines under fifty slow
reading. Click stabilization freezes the cursor for two hundred to four hundred milliseconds after
button-down; eight hundred milliseconds measurably harms drag and drop. Scope stabilization to links
and buttons only, or it breaks sliders, drag interactions, and canvas applications.

**What we hide.** Advertisements, promotional banners, chat widgets, social embeds, recommendation
rails, and sticky overlays. **Never** forms, navigation, error messages, or help and contact
mechanisms; hiding a help mechanism would violate a published conformance criterion outright. Always
show a "restore hidden items" affordance with a count, because older adults are worse at goal-directed
search and hiding the wrong element is expensive.

**Explicitly not shipped as defaults**, because the evidence is negative or absent: dyslexia-specific
fonts (two controlled studies found no benefit, and the one apparent benefit was traced to letter
spacing, not glyph design), prefix-bolding reading modes (a study of over two thousand readers found
readers were marginally _slower_), and colored tint overlays (no reliable benefit). Any of these may
exist as an opt-in preference, but WebAble must never claim they are evidence-based.

## Tier 2 — Semantic understanding _(the model enters)_

The model classifies page structure; the bundled engine performs the transformation. Every output
passes the verifier.

| Feature                                                    | Persona | Evidence        | Risk        | Priority |
| ---------------------------------------------------------- | ------- | --------------- | ----------- | -------- |
| Form guidance: adjacent errors, format hints, label repair | A, B    | Moderate–strong | Low         | **P1**   |
| Plain-language rewriting, shown side by side               | B       | Moderate        | Medium–high | **P1**   |
| Jargon and icon glossary on demand                         | B       | Moderate        | Low         | **P1**   |
| Reader mode for article-like pages only                    | A, B    | Moderate        | Medium      | **P1**   |
| Primary action emphasis, high confidence only              | A, B    | Weak, indirect  | Medium–high | **P2**   |
| Navigation simplification                                  | A, B    | Moderate in lab | High        | **P2**   |

**Form guidance is the highest-value item in this tier and the lowest risk.** A controlled study of
sixty-five participants with eye tracking found that forms improved against published guidelines had
faster completion, fewer submission attempts, and higher satisfaction, and that **error message
placement adjacent to the field mattered most**. A counter-finding disciplines the implementation:
validation firing on field exit produced significantly _more_ errors than validating on submit.
Validate on blur only after the user has typed, or on submit with focus moved to the error.

**Plain-language rewriting has the strongest single result in the whole review and the sharpest
caveat.** A randomized trial with over four thousand five hundred participants across thirty-one texts
found model-based "minimally lossy" simplification raised comprehension, most dramatically on medical
text, sustained the gain after the text was removed, and lowered perceived difficulty. But an analysis
of simplification systems found insertion errors in about half of samples and substitution errors in
about half. **Therefore: show simplified text alongside the original, never replacing it; provide a
per-sentence "what changed" toggle; and never simplify legal, financial, or medical consent text
without the original visibly present.**

**Primary action emphasis and navigation simplification are P2 for a reason.** Emphasis rests on
indirect evidence, and guessing wrong actively misdirects a user who is trusting the tool. Navigation
flattening showed large lab gains, roughly three times faster with about seven times fewer errors for
shallow text-labeled navigation, but collapsing a mega menu can _add_ depth, and rewriting navigation
is the highest-risk DOM surgery on the list. Attempt both only at high confidence, never remove items,
and only regroup.

## Tier 3 — Behavior _(offer only, never impose)_

| Feature                                   | Persona | Evidence                                      | Risk            | Priority |
| ----------------------------------------- | ------- | --------------------------------------------- | --------------- | -------- |
| Friction detection with dismissable offer | A, B    | Moderate on _how_, none on detection accuracy | Medium as nudge | **P2**   |
| One-question-at-a-time form conversion    | A, B    | Qualitative only                              | High            | **P2**   |

**Signals with actual validation behind them:**

| Signal                                                        | Infers                   | Basis                                                                                                          |
| ------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Submovement count and jerk; movement during click             | Pointing difficulty      | Motor-ability models; twenty-eight percent of clicks by motor-impaired users contain movement during the click |
| Rage clicks, dead clicks, u-turns, quick backs                | Task failure             | Commercial analytics heuristics, widely deployed                                                               |
| Hover beyond two seconds; regressive movement between regions | Comprehension difficulty | Web survey research predicting question difficulty                                                             |
| Repeated attempts on one form field                           | Form friction            | Commercial frustration scoring                                                                                 |

**The interaction pattern, fixed by the evidence:** detect, then show a single dismissable line
("Having trouble here? Make this simpler"), apply only on accept, always show undo. Default the whole
feature _off_ for the first week of use.

**An ethical line.** Research shows in-home mouse data can discriminate mild cognitive impairment in
older adults. WebAble must never present itself as detecting or diagnosing a cognitive condition, must
never infer a specific disability, and must never transmit behavioral signals off the device. Signals
trigger offers about _this page_, nothing more.

---

# Part C — Onboarding

Target three minutes, itself rendered at persona A settings. The design follows a specific finding:
**self-reported ability and measured ability diverge**, roughly half of frail older adults show
discordance, and stated font preference does not predict the font a person actually reads fastest. So
we ask about tasks and comfort, then **calibrate on a live example**, and treat every answer as a
starting point.

1. **Control promise.** "WebAble changes how pages look, never what they say. You can undo anything
   with one click." Prominent skip option.
2. **Reading calibration.** A short sample with a slider: "Move this until it is comfortable to read at
   arm's length." Maps to size and spacing. Then a light-versus-dark comparison: "Which is easier on
   your eyes?" This question exists specifically to catch the cataract and glare population that needs
   dark polarity.
3. **Pointing calibration, about fifteen seconds.** "Tap the circles," five targets shrinking from
   sixty-four to twenty-four pixels. Misses and slips set hit-area enlargement and click stabilization.
   This is a compressed version of an ability-elicitation method that produced interfaces
   twenty-six percent faster with seventy-three percent fewer errors for motor-impaired users, but
   that took twenty-five to ninety minutes. **The user never sees a word like "dexterity."**
4. **Five functional statements**, multi-select, in situational rather than medical language:
   text hard to read; clicking the wrong thing; pages feel busy and I lose track; moving things
   distract me; long or technical text is tiring. Each maps to a feature bundle.
5. **Preview on a real page** with a before-and-after toggle and a plain-language list of what is
   active, each individually switchable.
6. **Persistent controls.** A fixed, never-moving toolbar with "Undo," "Simplify this page," and
   "Adjust."
7. **Re-calibration prompt after seven days**, because needs and self-assessment drift.

Store the result as a **preference set of key-value pairs, not a persona label or a diagnosis**. This
matches how prior preference frameworks modeled the same data and keeps the profile free of health
information.

---

# Part D — Evaluation

The systematic review's central criticism of this field is evaluation without disabled participants.
Meeting that bar is the difference between a class project and a defensible result.

**Design.** Within-subjects, counterbalanced, comparing three conditions: unmodified site, Tier 0 plus
Tier 1, and the full stack. Within-subjects is essential; it needs far fewer participants than
between-subjects.

**Participants.** Twelve to sixteen real participants per persona. A within-subjects usability
comparison at eighty percent power detects a fifteen-point difference with roughly eleven to thirteen
participants, and a ten-point difference with roughly twenty-one to twenty-seven.

**Tasks.** Three per persona, on real sites: a plan or benefits lookup on a government site, a form
and help lookup on a tax site, a money transfer on a public banking demo, and a product search on a
retail site.

**Metrics.** Task success, time on task, error and slip counts, a single-item ease question per task, a
task-load index for persona B, and a system usability score per condition. Paired tests for time and
score, with a signed-rank test where distributions are not normal, and a paired test for success
rates. Secondary: per-rule automated violation deltas, and **adaptation defect counts from the
verifier**, reported openly.

**Simulated impairment is for development iteration only, never headline results.** Simulation
glasses and gloves do not represent any particular condition, and research on disability simulation
shows brief simulations ignore coping strategies and lead participants to _underestimate_ disabled
people's capabilities.

**Two logistics items with deadlines.**

- **Institutional review board approval must be filed before recruiting.** A class project graded only
  within the course usually is not regulated research, but presenting at a senior showcase or
  publishing typically makes it so, and **approval is never granted retroactively**. Adults with
  impaired decision-making capacity are a protected population requiring additional safeguards, so
  exclude diagnosed dementia unless the protocol covers capacity assessment.
- **Recruiting takes lead time.** Options include paid accessibility testing panels, the campus
  disability resource center, local senior centers, and campus neurodiversity groups.

---

# Part E — Test corpus

Fix this list early so regression testing is meaningful.

| Site                                                                          | Why it is in the set                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A federal benefits site                                                       | Core persona A task; dense navigation; already conformance-audited       |
| A social security site claiming high conformance                              | Baseline for detecting _harm_, since it is already well built            |
| A tax authority site                                                          | Long, jargon-heavy forms for persona B                                   |
| A pharmacy retail site                                                        | Popups, carousels, realistic density; browse and search only             |
| A large e-commerce site                                                       | Cluttered layout, small targets, distractors                             |
| An open news site                                                             | Reading tasks for spacing, width, contrast                               |
| A public banking demo application                                             | Safe transactional flows including login and transfer, with no real data |
| A paired accessible/inaccessible demo from a university accessibility program | **Controlled ground truth**, since the same page exists in both states   |
| The W3C before-and-after demonstration                                        | Second controlled corpus, standards-authored                             |
| A dense single-page application                                               | Stress test for mutation observation and re-render survival              |

**Legal position.** Client-side modification for the user's own viewing is ordinary user agent
behavior. Content scripts exist precisely to read and change pages, the user agent guidelines expect
tools to let users override author styles, and the priority-of-constituencies principle places users
above authors. A local demo redistributes nothing. Avoid automated logins, purchases, and scraping,
which is where site terms of service actually bite.

---

# Part F — Workstreams and sequencing

Five people, aggressive scope. Sequenced so that a working demo exists early and deepens.

| #   | Workstream                                                                            | Owner profile    | Depends on |
| --- | ------------------------------------------------------------------------------------- | ---------------- | ---------- |
| 1   | Extension skeleton, style engine, shadow-DOM handling, mutation observation           | Front-end lead   | —          |
| 2   | **The verifier**, harm detection, rollback, defect logging                            | Back-end lead    | 1          |
| 3   | Tier 0 and Tier 1 transformations plus parameter tuning                               | Front-end and QA | 1          |
| 4   | Onboarding, calibration, preference set, profile schema                               | Front-end        | 1          |
| 5   | Page summarizer, redaction allowlist, "what was sent" panel                           | Back-end         | 1          |
| 6   | Inference provider abstraction, plan schema, provider implementations                 | Full-stack       | 5          |
| 7   | Tier 2 transformations                                                                | Full-stack       | 2, 6       |
| 8   | Sync tiers and profile portability                                                    | Back-end         | 4          |
| 9   | Behavior signals and offer interface                                                  | Full-stack       | 3          |
| 10  | Evaluation harness, automated rule-engine runner, study protocol, review board filing | QA               | 2          |
| 11  | Mac companion app                                                                     | Full-stack       | 6, 8       |

**Critical path note.** Workstream 2, the verifier, gates Tier 2 and is the project's main technical
contribution. It should not be scheduled late. Workstream 10's review board filing has the longest
external lead time and should start in week one regardless of code progress.

---

# Part G — The demonstration

The narrative the research supports, in four beats:

1. **Install, then immediately open a cluttered real site.** Tier 0 fires with no setup. This is the
   Morphic answer, and it should be the first thing anyone sees.
2. **Complete onboarding in under three minutes**, including the pointing calibration, then revisit
   the same site. It adapts further and differently.
3. **Visit three structurally different sites with one profile.** Each adapts differently because the
   pages differ, not because the settings changed. This is the thesis made visible.
4. **Change the profile to a contrasting one** and reload. The same three sites adapt differently
   again.

Then, if friction detection is ready: struggle deliberately with a form, and let the offer appear. Show
the undo. Show the "what was sent" panel. Show the verifier rejecting a transformation on a site where
it would have clipped text, because **demonstrating what the system refuses to do is the most
credible thing in the presentation.**
