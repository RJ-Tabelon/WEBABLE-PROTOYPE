# WebAble advisor meeting: October 7, 2026

## Opening update

“Today I will demo the extension and propose a separate guided study website. Participants open one link on their phone, complete Tune, then try ordinary and personalized pages in two short rounds. Everyone tries both conditions, using matched but different content in a balanced order. I propose first-tap accuracy as the primary outcome, with everyday task success and reading comprehension as secondary measures. Four observed pilots would precede a target of 24 main participants.”

## Proposed study flow

Invitation → explanation/agreement → mobile check and practice → Tune and confirmed fit → round 1 → optional break → round 2 → feedback and completion receipt.

Aim for 30-40 minutes; measure actual duration in pilots before advertising it. The guide provides large controls, one instruction per screen, clear progress, repeat instructions, breaks, exit and optional help. Study controls remain consistent across both conditions.

## Why everyone tries both

Comparing each person with themselves reduces variation from ability, mobile experience and device, which helps a student with limited recruitment capacity. Learning and fatigue remain possible, so use alternate content and four randomized sequences. [Design guidance](https://www.nngroup.com/articles/between-within-subjects/), [practice and counterbalancing](https://www.nngroup.com/articles/internal-vs-external-validity/)

| Sequence | Round 1 | Round 2 |
| --- | --- | --- |
| 1 | Unadapted A | Adapted B |
| 2 | Adapted A | Unadapted B |
| 3 | Unadapted B | Adapted A |
| 4 | Adapted B | Unadapted A |

At 24 main completions, aim for six per sequence. This is an exploratory recruitment target, not a statistical power guarantee. Freeze one fit before scored tasks. Do not reuse Tune calibration trials as outcome measures or adapt the fit based on evaluation scores.

## What to build and measure

Use owned, realistic pages: a target-selection task, community event directory, small shop/form and short article. Prepare matched A/B versions with different facts and answers.

- **Primary:** correct first-attempt activation across 24 prompted target trials per condition.
- **Secondary:** correct event/basket outcomes, four comprehension answers per passage, duration with success/accuracy, and perceived ease.
- **Reliability:** clipping, unreachable controls, verifier rollbacks, data-save failures, help and dropouts.

Analyze paired participant differences; repeated taps are not independent participants. Preserve incomplete and failed cases in reporting.

## Mobile feasibility

Run the shared WebAble engine on study-owned pages inside an isolated task document, with a consistently accessible instruction shell. A webpage cannot freely control arbitrary third-party documents, and this desktop Chrome extension cannot install in ordinary mobile Chrome. [MDN browser constraint](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy), [Google compatibility](https://support.google.com/chrome_webstore/answer/1698338?hl=en)

The engine already operates independently of extension messaging in owned-page browser tests. A production mobile adapter, matched tasks, recorder, assignment controller and export still need to be built and verified on real phones. Extension-specific operations such as tab zoom need an explicit mobile scope decision. Existing Tune drops raw drafts after summarization; it is not already a study recorder.

## Recruitment and remote quality

Use personal referrals for pilots, then ask Senior Recreation Center Tech Time/PrimeTime, Oak Hammock ILR and library Adult Services to circulate the link. No hospital-patient partnership is needed. Screen 50+ mobile users for actual small-control tapping difficulty; age alone does not establish impairment. All contacts and sample outreach are in the [recruitment report](research/participant-recruitment-2026-10-07.md).

Keep optional assisted participation. Remote older-adult research documents feasible delivery and engagement difficulties; it does not prove self-guided results equal observed sessions. [Hill et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC7935399/)

## Exemption and schedule

Brief voluntary adult interface tasks are a plausible exemption-3 candidate. If a determination already exists, confirm it covers this revised remote procedure and data collection. Otherwise UF offers an automatic determination route. Online delivery alone does not confer exemption. [Federal categories](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-A/part-46/subpart-A/section-46.104), [UF tool](https://research.ufl.edu/services/research-operations-services/secure/hrpp-auto-determination-tool)

Proposed milestones: mobile engine feasibility by **Oct 14**; guided flow/data pipeline by **Oct 21**; four observed pilots **Oct 22-26**; main sessions **Oct 27-Nov 10**; data close **Nov 13**; analysis/write-up by **Nov 20**. Confirm the tentative Nov 26 deadline, which falls in UF's Nov 23-28 Thanksgiving break. [Calendar](https://catalog.ufl.edu/UGRD/dates-deadlines/2026-2027/)

## Extension demo update

Version 0.1.1. Today's existing checks passed: 293 unit tests, type checking, and three selected browser demo scenarios plus setup. These were local-fixture checks, not mobile validation.

Demo: baseline page → fit applied → navigate → update the saved fit → Undo/Redo or pause. Present the sandbox as the next deliverable; no product implementation changed in this planning pass.

## Decisions for Dr. Rani

1. Is motor accuracy the primary question, with comprehension secondary?
2. Does the exploratory 24-participant target and balanced two-condition design fit the thesis?
3. Which mobile operations and platforms count as the tested WebAble intervention?
4. What exemption documentation, payment, data retention and assisted participation plan apply?
5. Can we use the Oct 14 feasibility gate and Nov 20 internal finish?

Detailed research, task specifications, logging requirements and implementation phases: [guided study sandbox proposal](research/guided-study-sandbox-2026-10-07.md).
