# WebAble guided mobile study sandbox

Advisor proposal for October 7, 2026. Tentative project deadline: November 26, 2026.

**Recommendation:** build a separate, guided research experience that people open from one link on their own phone. Each participant completes WebAble Tune once, then tests both an unadapted condition and a condition adapted using their frozen fit profile. Use controlled, realistic web pages, different matched content in the two rounds, and four balanced sequences. Start with observed pilots, then offer self-guided participation with optional help.

This is a researched proposal, not an implemented or validated study. Counts, timing, task content, payment and launch criteria below are proposed decisions. It replaces the facility-led procedure and the earlier 3-pilot/12-main proposal in today's recruitment report. Community organizations remain useful for circulating the link.

## 1. Research question and claim

**Primary question:** among adults aged 50+ who report difficulty accurately tapping small mobile controls, does a WebAble fit improve first-attempt target activation on controlled mobile web pages?

**Secondary questions:** does it improve correct completion of everyday web tasks, reading comprehension, and perceived ease? Does it introduce clipping, missing controls, unexpected behavior or other adaptation defects?

The resulting claim is about the tested WebAble adaptations, tasks, devices and recruited population. This study does not establish whole-web compatibility, clinical improvement, WCAG conformance, or that personalization beats a generic accessible design. That last comparison requires an additional generic-adaptation condition and a different study scope. W3C advises reporting evaluation scope and avoiding generalization from a small accessibility sample. [W3C user evaluation](https://www.w3.org/WAI/test-evaluate/involving-users/)

## 2. Same people or separate groups?

**Use the same people for both conditions: a within-participant comparison.** Each participant serves as their own comparison, reducing variation from mobile experience, motor ability and device. It usually needs fewer recruits than separate groups. The tradeoff is learning, fatigue and carryover between rounds. These are established design considerations, not a guarantee that a particular sample will be sufficient. [NN/g design guidance](https://www.nngroup.com/articles/between-within-subjects/)

Prepare two content sets, A and B. Each contains the same task types and approximately matched difficulty, with different facts, products, labels and answers. Keep each set's underlying page identical between adapted and unadapted uses; WebAble is the condition difference. A participant never repeats the same passage or exact task answer.

| Random sequence | Round 1 | Round 2 | Target at 24 main participants |
| --- | --- | --- | --- |
| 1 | Unadapted, set A | Adapted, set B | 6 |
| 2 | Adapted, set A | Unadapted, set B | 6 |
| 3 | Unadapted, set B | Adapted, set A | 6 |
| 4 | Adapted, set B | Unadapted, set A | 6 |

Randomly assign invitees using shuffled blocks containing all four sequences. Persist the assignment before testing; retries do not draw a new sequence. Track starts and completions by sequence rather than quietly moving participants to fill cells. This balances condition order, content set and period. Group tasks into rounds rather than constantly switching the adaptation on and off. Use practice tasks outside the scored material. [NN/g validity guidance](https://www.nngroup.com/articles/internal-vs-external-validity/)

Counterbalancing does not erase learning. Check the first-round and second-round patterns and report order effects. If pilots show major transfer or sessions remain too tiring after reducing scope, use random assignment to a single condition per person and recalculate recruitment needs. A recent methodological preprint explicitly cautions that counterbalancing alone does not guarantee removal of carryover; treat it as methodological context, not settled WebAble-specific evidence. [Ho and Min, 2025 preprint](https://arxiv.org/abs/2505.03937)

## 3. What participants experience

**Flow:** invitation link → study explanation and agreement → device check → short practice → Tune and fit confirmation → round 1 → optional break → round 2 → brief feedback → completion receipt.

| Stage | Participant experience | Proposed time budget |
| --- | --- | --- |
| Welcome and eligibility | Plain explanation, age band, mobile use, tapping difficulty, voluntary agreement | 2-3 min |
| Device check and practice | Confirm touch works; practice one selection and one task transition | 2 min |
| WebAble Tune | Existing reading, pointing and focus onboarding; review and accept the fit | 7-10 min placeholder |
| Round 1 | Target selections, everyday tasks and reading | 8-10 min |
| Break | Rest or continue; no timed pressure | About 1 min or longer |
| Round 2 | Matched tasks with different content in the other condition | 8-10 min |
| Finish | Ease/preference, problems, completion receipt | 2 min |

Aim for **30-40 minutes**, then replace that estimate with pilot timing before advertising it. Tune's actual duration on older participants' phones has not been measured here. Keep its existing onboarding for the initial pilot; if it is too long, reduce evaluation tasks first. Shortening Tune changes the intervention and requires an explicit protocol decision.

Study instructions use a consistently accessible shell: large controls, legible adjustable text, one instruction per screen, clear progress such as “Round 1 of 2,” and persistent “Repeat instructions,” “Take a break,” “I can't finish this task” and “Leave study.” No account creation or extension installation. Offer a help contact and a scheduled phone-assisted option. Audio instructions are an optional enhancement; text remains available. Do not introduce audio-only consent or instructions.

Explain honestly that the study compares two presentations and may change text and controls. Use neutral round names rather than “bad” and “improved.” Participants can see differences, so this is not a blinded experiment. Collect feedback after both rounds and avoid displaying performance comparisons during them.

## 4. The task battery

Build **three realistic page families plus a short target-selection page**, all with fictional, non-sensitive content. The numbers below are engineering starting points to pilot, not validated thresholds or a clinical test.

| Page | Example task | Automatic outcome | Intended benefit |
| --- | --- | --- | --- |
| Target selection | “Tap Save.” Select the named button/link among nearby options; 24 trials per condition | First tap activates the named control; retries, incorrect activations and time | Target size/spacing and motor accuracy |
| Community events | Find the free event after 2 p.m., open details and identify its room | Correct event plus correct information answer | Finding information and navigation |
| Small shop/form | Choose the specified product, option and quantity; add to a pretend basket | Correct final basket state; recovery actions and completion | Everyday controls, selections and forms |
| Short article | Read a 160-200 word passage, then answer four questions | Correct answers out of four; reading duration | Legibility and comprehension |

Use comparable content length, vocabulary, answer difficulty, navigation depth and control density in sets A and B. For target trials, begin with a mix of 24, 32 and 44 CSS-pixel controls and varying realistic spacing, distributed equally between sets. Include comfortable controls too; the baseline should not be engineered so badly that benefit is inevitable. Pilot for ceiling effects and frustration. Pixels here are browser layout units, not physical millimeters.

In the target task, explicitly name the intended control; otherwise a tap location alone cannot reveal intention. Shuffle trial labels/positions under a saved seed. This is a new transfer task, not a replay of Tune's ring calibration. Use real semantic buttons and links with actual activation events. Existing Tune preview graphics are not a scored interaction task.

For real-world tasks, permit valid alternative routes. An exploratory click is not automatically an error. Score the required end state and specific incorrect actions such as a wrong basket item, rather than calling every unexpected navigation a motor failure.

For reading, the passage disappears before four questions in the unchanged study shell. Include factual and simple inference questions; do not return answer feedback until the study is complete. This measures immediate comprehension/recall, not information lookup. Pilot the questions for comparable difficulty. The event task separately measures lookup with content available. Remote reading research has measured both passage duration and comprehension questions; speed alone would reward skimming. Its population and font intervention differ from this study. [Wallace et al., 2022](https://jeffhuang.com/papers/Readability_TOCHI22.pdf)

Older-adult touchscreen experiments have found target size affects errors and completion time. They justify measuring both, not importing historical device-specific error rates as WebAble's expected effect. [Kobayashi et al., INTERACT 2011](https://opendl.ifip-tc6.org/db/conf/interact/interact2011-1/KobayashiHMAHI11.pdf)

## 5. Conditions and controls

**Unadapted:** the owned site's original presentation, with the participant's normal device/browser accessibility settings retained. “Unadapted” means WebAble off, not removal of their usual aids.

**Adapted:** the same underlying page template with the participant's confirmed Tune profile applied through the shared WebAble engine and a documented mobile-supported operation set. Begin with target size/spacing, text size, line spacing, contrast and supported calming operations. Apply only what that person's profile and policy call for; do not force a change merely to create an effect.

Freeze the profile before random assignment is exposed to the participant. Do not use scored outcomes to refit it. Disable online learning and new behavioral offers during the two rounds; use deterministic adaptation for this initial study. Record the intended plan, actual applied operations, verifier rollbacks and no-op profiles. If someone stops or requests removal, honor it and record the deviation. Do not silently drop cases where adaptation failed or made no change.

Keep task wording, scoring, study controls, answer buttons and underlying content consistent across conditions. Load a fresh task document for each task and destroy it afterward, so styles, application state and learned engine state cannot leak into the next condition. Keep the same phone, browser, orientation and usual aids across rounds where possible; record changes rather than preventing needed accessibility adjustments.

The supported adaptation bundle is the intervention. This design cannot attribute a gain specifically to larger buttons versus typography or attention changes without additional conditions.

## 6. Metrics and analysis

**Declare one primary outcome before the main study: first-attempt target activation accuracy.** For each participant and condition, calculate correctly activated targets on the first intentional tap divided by attempted scored trials. Record how many of the planned 24 were attempted; report omissions and incompletion separately, with a sensitivity summary against all planned trials. A completed condition normally supplies all 24.

Use a tap gesture/activation definition validated on each supported mobile browser. Touches that become scrolling or cancelled gestures are not automatically misses. Log valid tap endpoints, expected control and actual activation, including taps outside controls. Do not rely only on successful click handlers, which miss off-target attempts.

| Secondary outcome | Definition and reporting |
| --- | --- |
| Everyday task success | Correct final state without hints; unsuccessful, skipped and abandoned tasks remain visible |
| Comprehension | Four questions per passage, scored separately from lookup; exploratory because the score is coarse |
| Time | Start after page readiness and instructions; report duration with accuracy/success, interruptions and abandonment |
| Ease | One plainly labeled 1-7 ease question after each round; a study-specific measure unless a validated instrument is adopted unchanged |
| Reliability | Rollbacks, clipping, unreachable controls, failed saves, unsupported devices and session dropouts |
| Participation burden | Tune duration, total duration, help used, breaks and step where people leave |

Estimate each person's adapted-minus-unadapted accuracy difference, then report the mean paired difference in percentage points, an appropriate 95% uncertainty interval, and individual paired results. Set the interval method and any hypothesis test with Dr. Rani before data collection. Respect participant clustering and check set/order/period patterns. Do not treat 24 participants × 48 target trials as 1,152 independent people.

Preserve raw trial data sufficient to audit these calculations. Describe assistance, missing pairs and technical exclusions using rules fixed before the main launch. Show the recruitment/start/completion funnel and compare available baseline characteristics of completers and non-completers. Report paired complete-case results with missingness and sensitivity summaries, rather than implying completers represent everyone invited. Successful-task timing alone can be selective; show failed/abandoned tasks beside it.

**Proposed scale: four observed pilots, then a target of 24 main participants**, six per sequence if completion permits. Pilot participants are excluded from the main comparison, especially if content or software changes. This is a feasible exploratory target, not a power calculation. Use pilot variability and a pre-agreed meaningful accuracy improvement to assess whether a larger confirmatory sample is needed. A small pilot gives an uncertain variance estimate. If only 12 main participants are feasible, label the result exploratory and narrow claims; do not present a null result as evidence of no benefit.

## 7. Remote quality and recruitment

Observe four pilot sessions remotely or locally with adults resembling the intended sample; let people try the guide before helping. Ask what confused them afterward. Pilot observation and commentary are not part of the timed main procedure.

Before opening broadly, require that participants can independently understand practice, complete Tune, move between rounds and reach the receipt; investigate repeated assistance or abandonment. Aim for at least three of the four to complete without task-content coaching, and include a less confident mobile user. This is a usability gate, not proof that the guide is validated for all older adults.

Remote older-adult technology research documents feasible delivery and practical difficulties with asynchronous engagement. It does not establish equivalence of this unmoderated sandbox to an observed lab study. Standard instructions reduce facilitator variability; remote testing loses direct observation of confusion and can underrepresent people with the greatest digital or motor difficulties. Keep a supported participation option and report which mode was used. [Hill et al., 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC7935399/)

Use these invitation routes, requesting circulation rather than a formal partnership or participant roster:

1. Personal networks and referrals to older adults for the pilots. Ask participants to forward a public invitation; do not obtain someone else's personal details without their interest.
2. Senior Recreation Center Tech Time and PrimeTime Institute for mobile users aged 50+. Ask the existing coordinators to circulate a tappable link or notice.
3. Oak Hammock ILR and Gainesville library Adult Services as independent backups.
4. CILNCF if too few respondents report relevant tapping difficulty.

Screen for 50+, mobile web use, at least occasional difficulty accurately tapping small controls, ability to understand the study agreement, and access to a supported touch device. Record age bands and mobile familiarity; do not use age as a diagnosis or require medical records. For the first pilot, prefer smartphones; define tablet inclusion before launch and report device class. A predominantly smartphone sample keeps scope manageable.

Aim initially to circulate invitations to 40-50 potentially eligible people to work toward 24 completions, adjusting from the observed response funnel. That is an outreach target, not a researched yield prediction. The detailed [recruitment report](participant-recruitment-2026-10-07.md) contains verified contacts and public program links. No organizer access or distribution is agreed yet; no outreach has been sent.

Optional proposed payment: $15 per session for 28 pilot/main participants is $420. Set compensation, partial-session payment and contact separation with the advisor before invitations. Do not tie payment to being accurate, liking WebAble, or completing every difficult task.

## 8. Mobile implementation plan

Build a distinct research experience, for example **WebAble Study**, under isolated `/study` routes initially. It can share the existing application's hosting and components while remaining a separate participant flow. Reuse Tune and core fit derivation; extract or package the browser-compatible engine so the study and extension share the same implementation rather than hand-building an attractive substitute.

The existing engine describes itself as operating over one document independently of extension messaging, and its browser test harness runs it on owned fixture pages without a service worker. That supports feasibility, not a claim that the harness is ready for mobile deployment. Some capabilities remain extension-specific: `page_zoom`, for example, relies on `chrome.tabs.setZoom` and cannot simply be carried into a phone webpage.

**Use owned pages inside a clearly titled same-origin task frame**, or an equivalent isolated task document. The study shell runs instructions, assignment and progress; the task document runs the site, engine and outcome instrumentation. Apply WebAble only to the task document. Check scrolling, screen-reader navigation, viewport geometry, focus transitions and zoom on real phones before accepting the frame design. Keep one task at a time; do not open a maze of external tabs.

Arbitrary public websites are a poor first implementation: the browser's same-origin policy restricts access to another site's document, and sites can prevent framing. A normal webpage cannot automatically inject WebAble into whatever external mobile site the participant opens. CORS does not turn third-party frames into controllable documents. Chrome's ordinary mobile browser also does not install this desktop extension. [MDN same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy), [Google extension compatibility](https://support.google.com/chrome_webstore/answer/1698338?hl=en)

Fictional pages should resemble common web experiences, preserve functional forms and navigation, and contain original text and images. A later desktop extension study on real websites can test ecological validity. A separate iOS/browser-extension port is a platform project, not needed to launch this owned-page experiment.

### Required build pieces

| Piece | Minimal deliverable |
| --- | --- |
| Session controller | Agreement, eligibility, stable randomized sequence, progress, break/exit and same-device recovery |
| Tune bridge | Study-specific fresh calibration; confirmed profile and version frozen per session |
| Task library | Four page families, matched A/B content, expected outcomes and scoring rules |
| Adaptation adapter | Shared engine/policy, supported operation list, fresh document reset, readiness and rollback reporting |
| Event recorder | Coded session, trial/tap outcomes, answers, durations, assistance, visibility changes and data-save acknowledgments |
| Researcher export | Versioned event/trial/session files and a completion funnel; no need for a large dashboard initially |

Existing Tune summarizes trial drafts and then discards the raw drafts. It does not by itself supply the proposed study dataset. Add a separate, explicit research recorder rather than altering the product's ordinary privacy behavior for everyone.

Record session code, agreement/protocol version, source channel, assigned sequence, device/browser/viewport, fit snapshot, software/task versions, actual adaptations, per-trial outcomes and timestamps. Use monotonic in-session durations; record background-tab periods and pauses rather than interpreting them as reading time. Keep planned and observed outcomes separate.

Make saves retryable with unique event IDs and deduplication. Show completion only after the server acknowledges the dataset; recover after refresh without silently repeating scored material. Log restarted trials, and use a pre-specified restart rule rather than choosing the better attempt. Main rounds should ideally finish in one sitting with a short break; a much later resumption is recorded for sensitivity analysis. Lock task, policy and scoring versions after pilots. A necessary mid-study repair creates a new version and is documented.

## 9. Data and exemption fit

Keep the first protocol to brief, voluntary adult interface tasks using fictional information. Collect study responses, performance and the fit needed for the comparison; avoid diagnoses, medication information, real purchases, logins to personal sites, and audio/video/session replay in the main self-guided study. Store coded performance separately from optional contact/payment details. A unique invitation linked to a contact is coded data, not automatically anonymous. Check ordinary hosting/access logs and analytics before claiming anonymity.

Federal exemption 3 expressly includes some brief benign adult behavioral interventions with prospective agreement and specified identity/risk protections. A sandbox is a plausible candidate; moving online does not itself grant an exemption. UF has an automatic determination route. If a determination already exists, confirm this revised protocol's remote delivery, data capture and recruitment are covered; otherwise use the applicable UF route with Dr. Rani. The gated tool's exact eligibility questions were not accessible here, and this report cannot issue the determination. [45 CFR 46.104(d)(3)](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-A/part-46/subpart-A/section-46.104), [UF IRB](https://irb.ufl.edu/), [UF determination tool](https://research.ufl.edu/services/research-operations-services/secure/hrpp-auto-determination-tool)

An agreement screen still explains purpose, procedure, duration, voluntary participation, data collected, foreseeable burden, contact, payment if any and how withdrawal works. Specify retention/access and the deadline for withdrawing coded data; do not promise deletion of records that can no longer be identified after de-linking. This is a protocol item to settle, not a reason to pause planning or building the non-participant prototype.

## 10. Delivery plan to November 20

| Dates | Deliverable / decision |
| --- | --- |
| Oct 7-9 | Agree on mobile scope, primary measure, four sequences, exemption documentation and participant/payment plan |
| Oct 8-14 | Technical feasibility slice on real iPhone Safari and Android Chrome: Tune → one owned task → WebAble on/off → saved outcome |
| Oct 15-21 | Guided flow, matched pages, randomized assignment, reliable recorder and export |
| Oct 22-26 | Four observed pilots; revise wording/content; verify comparable A/B difficulty; measure actual duration |
| Oct 27 | Freeze protocol/software/task versions and open the self-guided link if the launch gate passes |
| Oct 27-Nov 10 | Main recruitment and sessions; monitor saves, sequence counts, dropout and defects |
| Nov 11-13 | Final reminders through authorized channels, make-ups and data close |
| Nov 14-20 | Paired analysis, limitations, thesis write-up and final demo |

These dates are a proposed engineering schedule, not a commitment based on a measured build estimate. Decide by October 14 whether the shared engine works on both proposed mobile browsers. If it does not, narrow to a documented supported platform or reduce the operation set with the advisor; do not replace WebAble with unrelated CSS and retain the same efficacy claim. If the full self-guided build cannot be ready for pilots, keep the same owned tasks and automate scoring while scheduling remote-guided sessions.

Treat November 20 as the internal finish. The tentative November 26 deadline falls within UF's published November 23-28 Thanksgiving break. [UF calendar](https://catalog.ufl.edu/UGRD/dates-deadlines/2026-2027/)

## 11. Today's product update

The current desktop extension is version 0.1.1. Today's existing checks passed: 293 unit tests, extension type checking, and three selected browser demo scenarios plus setup. They covered saved-fit adaptation/navigation, updating an already open page after saving a fit, and normal popup readability with a large fit. These were local fixture checks, not verification of the proposed mobile study.

Demo the desktop extension separately: ordinary page → fit applied → navigate → change saved fit → Undo/Redo or pause. Then present the sandbox as the next research deliverable. No product implementation was changed while preparing this proposal.

## 12. Meeting pitch and decisions

“I propose a separate WebAble study website that people open from one link on their phone. It guides them through Tune and two short rounds of realistic tasks. Every participant tries both ordinary and personalized pages, with different matched content and a balanced order. The main outcome is first-tap accuracy; task success and reading comprehension are secondary. I would observe four pilots, then aim for 24 main participants, using community contacts to share the link. This reduces travel and standardizes instructions, while keeping optional help. The first technical milestone is running the real WebAble engine on our owned mobile pages.”

Ask Dr. Rani to settle: (1) the primary motor question versus a broader reading-first question; (2) whether the exploratory target and four sequences fit the thesis; (3) which documented mobile operations/platforms count as WebAble; (4) the revised exemption documentation, payment and retention plan; and (5) the October 14 feasibility gate and November 20 internal finish.

### Evidence boundary

Public sources were checked October 7, 2026. The cited work supports general design choices and known constraints. No source directly establishes that this WebAble sandbox is valid, that 24 participants provide adequate statistical power, or that self-guided results equal observed sessions. The proposed pilots, controlled comparison and explicit limitations address those unresolved questions.
