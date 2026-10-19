# WebAble — Planning Documents

Research-backed planning for the WebAble senior project, compiled 2026-09-07.

| Document                                                             | What it covers                                                                                                                                                                                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [01-Positioning.md](01-Positioning.md)                               | The thesis, why this is a user agent and not an overlay, prior art and the gap, the two design invariants, what we promise and refuse to promise                                                                           |
| [02-Feature-Set.md](02-Feature-Set.md)                               | Eight architecture decisions with the finding that forced each; the four-tier feature set ranked by evidence strength against implementation risk; onboarding; evaluation design; test corpus; workstreams; demo narrative |
| [03-Evidence-Base.md](03-Evidence-Base.md)                           | Every empirical claim with a source, including honest "no direct evidence found" gaps                                                                                                                                      |
| [04-Open-Decisions.md](04-Open-Decisions.md)                         | Decisions the team must make, questions worth asking the advisor, the risk register, and what is deliberately excluded                                                                                                     |
| [05-Advisor-Meeting-2026-09-08.md](05-Advisor-Meeting-2026-09-08.md) | Timeboxed agenda for the 30-minute first advisor meeting (Tue 2026-09-08), with ground rules and a parking lot                                                                                                             |
| [06-Technologies-and-Methods.md](06-Technologies-and-Methods.md)     | The full stack by layer with the reason for each choice, what we deliberately rejected, the five calls the team votes on Monday, and Monday's setup order                                                                  |
| [07-Persona-Research.md](07-Persona-Research.md)                     | Current accessibility landscape, the three selected functional personas, AI opportunities and limits, and a recruitment/validation plan                                                                              |
| [08-System-Architecture.md](08-System-Architecture.md)               | v1 architecture: the one loop, who decides what (rules, Jev, learners), surfaces and packages, data model, latency, learning, permissions and auth, design system                                                          |
| [10-V2-Architecture.md](10-V2-Architecture.md)                       | v2: per-person triage, Tailor with page scale, Fit view and its proxies, the OpenAI layout planner, consent, release gates; with build status                                                                              |
| [11-Restructure.md](11-Restructure.md) | v2.1: restructure for clutter and comprehension — who gets it (structure need from Tune's Focus effects), rules R1–R8, the before/after scorecard |
| [12-Showroom.md](12-Showroom.md) | Fit view redesign after apple.com and the Google Store: measured reference tokens, palettes, type, components, and the planner's art-direction contract (PageSpec v2); with build status |

Current meeting packet: [09-Advisor-Meeting-2026-10-07.md](09-Advisor-Meeting-2026-10-07.md), with the [guided mobile-study sandbox proposal](research/guided-study-sandbox-2026-10-07.md) and [community recruitment contacts](research/participant-recruitment-2026-10-07.md).

Research reports are indexed in [research/README.md](research/README.md). The evidence behind v2 is compiled by decision in [research/v2-evidence.md](research/v2-evidence.md).

## The short version

WebAble is a Chrome extension that carries one person's interface needs across the web, applying
**verified, reversible** transformations to real sites while preserving all content and functionality.

Three things distinguish it from everything that already exists:

1. **The verifier.** No transformation is applied unless a post-render check proves it did not clip
   text, reduce contrast, orphan a focusable element, or increase automated violation counts. Failures
   roll back and are logged as adaptation defects, which we report alongside successes.
2. **Calibration, not a settings menu.** Onboarding measures reading comfort and pointing accuracy on
   live examples, because self-reported and measured ability diverge and stated preference does not
   predict what a person actually reads fastest.
3. **Offer, never impose.** Behavioral signals produce a dismissable suggestion with a visible undo,
   never a silent change, because silent adaptation measurably underperforms static interfaces.

Build order is the tier order: instant value with zero setup, then the calibrated profile, then
semantic transformations, then behavior.
