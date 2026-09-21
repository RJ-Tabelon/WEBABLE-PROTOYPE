# WebAble — Open Decisions and Advisor Questions

_Written 2026-09-07, ahead of the first advisor meeting and the class pitch._

---

## A. Decisions the team must make (not the advisor's to make)

These are settled by the research; they need the team to say yes.

| #   | Decision                                              | Recommendation                                                  | Consequence if reversed                                                                                       |
| --- | ----------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Is the verifier a core deliverable or a nice-to-have? | **Core, and the project's main technical contribution.**        | Without it, WebAble is an overlay with better manners and has no defense against the standard critique.       |
| 2   | Does behavior adapt silently or by offer?             | **By offer, always, with visible undo.**                        | Silent adaptation is contradicted by three independent studies and would likely make measured outcomes worse. |
| 3   | Must WebAble work before onboarding?                  | **Yes. Tier 0 is mandatory.**                                   | This is precisely how the closest prior project stalled.                                                      |
| 4   | Does the extension depend on the Mac app?             | **No. Never.**                                                  | Cross-platform reach dies, and Chrome's built-in model already covers on-device inference.                    |
| 5   | Do we ever claim conformance for a site?              | **No, in any material, ever.**                                  | This is what the FTC fined a company for.                                                                     |
| 6   | Two personas or four?                                 | **Two, deeply.** Low vision plus dexterity, and cognitive load. | Four personas produces four shallow feature sets and no measurable result.                                    |

## B. Questions genuinely worth asking the advisor

Ordered by how much the answer changes the plan.

1. **Scope of the research claim.** Is the contribution the _verified adaptation engine_ (a systems and
   safety result), or the _user study_ (a human-computer interaction result)? Both are defensible, but
   they imply different time allocation. Our current plan weights the engine and treats the study as
   validation. Is that the right balance for this program?

2. **Review board timing and necessity.** If we present at a senior showcase, does that make our
   evaluation regulated human-subjects research at this institution? Approval is never retroactive, so
   this determines whether we file in week one. It also determines whether we can recruit
   participants with mild cognitive impairment at all, since that population requires capacity
   assessment.

3. **Participant access.** Does the department, the disability resource center, or the advisor's
   network have an existing relationship we can use to recruit twelve to sixteen participants per
   persona? Paid testing panels exist but may exceed a student budget. This is the single largest
   external risk to the evaluation.

4. **Novelty positioning.** A July 2026 paper built a Chrome extension with a very similar
   audit-inject-verify loop for accessibility _repair_. We extend it from repair to _personalized
   adaptation_, and we add calibration and behavioral offers. Is that delta sufficient for this
   program's standard, or should we push harder on one axis?

5. **The cognitive accessibility gap.** A 2026 systematic review found this field rarely addresses
   cognitive accessibility and often evaluates without disabled participants. We are targeting exactly
   that gap. Does the advisor see a publishable angle there, and would they want to co-author?

6. **Evaluation ambition.** Is a within-subjects study with roughly twenty-five to thirty total
   participants realistic for one semester alongside the build, or should we reduce the site and task
   count?

## C. Risks, with the mitigation already designed in

| Risk                                                          | Severity | Mitigation                                                                                                 |
| ------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| We build a beautiful engine and never test it with real users | High     | Review board filing in week one; recruiting starts before the engine is finished                           |
| Transformations break real sites                              | High     | The verifier, plus a fixed test corpus with paired accessible and inaccessible ground-truth pages          |
| The model classifies pages wrong and misdirects users         | High     | Flat enumerated schema; high-confidence-only for the risky transformations; every plan passes the verifier |
| Store review is slow or the extension is rejected             | Medium   | Narrow permissions from the start; the model emits data not code; privacy policy written early             |
| On-device model unavailable on team or participant hardware   | Medium   | Tiered inference with cloud fallback behind one interface                                                  |
| Scope sprawl across four tiers                                | Medium   | Tier order is build order; Tier 2 and 3 items are explicitly labeled P2 and droppable                      |
| We accidentally position as an overlay                        | Medium   | Never claim conformance; never touch ARIA, focus order, or keyboard handling; user installs, not the site  |
| Privacy claim overstated and challenged                       | Low      | Say "local-first processing, zero-knowledge sync," never "no server"; ship the "what was sent" panel       |

## D. What is deliberately not in the plan

Stated so nobody adds them back without a reason:

- **Dyslexia-specific fonts, prefix-bolding readers, and colored tint overlays as defaults.** Evidence
  is negative or absent. Opt-in only, never marketed as evidence-based.
- **Training a model.** The task is classification and selection from a fixed menu, which existing
  models do with grammar-constrained decoding. A small classifier is a possible late extension, not a
  foundation.
- **Cross-browser support this semester.** Chrome only. The architecture does not prevent it later.
- **Any inference of a specific diagnosis** from behavior. Signals trigger offers about the current
  page; nothing more.
