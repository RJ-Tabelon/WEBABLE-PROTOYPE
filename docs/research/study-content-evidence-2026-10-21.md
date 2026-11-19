# Study content and questionnaire evidence

Reviewed 21 October 2026. Applies to the revised mobile study: four activities on public Wikipedia and National Park Service pages, two activities per round, the websites’ usual design in one condition and WebAble in the other. Condition order and content sets are counterbalanced. This document records sources, editorial decisions, and limits; it is not a claim that the revised flow has been validated with participants.

## Reference-page inspection

The examples below were examined individually for their explanatory content. Their commercial claims are not evidence about WebAble. The useful observations concern how each page answers a reader’s questions and introduces actions.

### OpenAI

Sources: [Research](https://openai.com/research/) and [Introducing deep research](https://openai.com/index/introducing-deep-research/).

Direct observation from parsed page text: the research overview introduces its purpose before listing focus areas. The deep research article gives separate sections for why the feature exists, how to use it, how it works, limitations, and access. Its usage section identifies the interface location, the action the reader takes, the resulting progress display, and what completion looks like.

Application to this study: introduce what WebAble changes and what the study compares before installation details. At a website handoff, say where the participant will go, what they must select there, when timing begins, and how they return. Keep implementation details in the researcher documentation.

Inspection limit: public article text and headings were retrieved through the web tool. A separate desktop Chrome rendering attempt reached a Cloudflare challenge. No claim is made here about verified OpenAI typography, animation, spacing, or mobile interaction.

### Gemini

Source: [Gemini Deep Research](https://gemini.google/overview/deep-research/).

Direct observation: the page distinguishes a definition, use cases, access instructions, and technical explanation. Its process section gives planning, searching, reasoning, and reporting their own labels and descriptions. In a rendered 1440 × 1000 desktop view, the opening screen contained a prominent product title, one explanatory paragraph, and a primary action. The following definition section gave its process descriptions separate columns with clear headings.

Application to this study: keep the welcome page’s purpose and participation outline distinct from setup. Give each study stage a descriptive heading. Separate procedural actions so a participant can identify what happens next without reading a dense paragraph.

Inspection limit: the top view and the first definition/process section were visually inspected in headless Chrome; page headings were also extracted. Videos, interactive demonstrations, animation behavior, and phone layouts were not evaluated. These observations do not establish that its marketing wording is suitable for study participants.

### xAI

Sources: [Grok product page](https://x.ai/grok) and [Grok 4 announcement](https://x.ai/news/grok-4).

Direct observation from parsed page text: the product page has a numbered introduction organized around opening the product, signing in, and starting a conversation. Its labels name actions. The announcement separates technical explanation from demonstrations and access information; its voice section connects a concrete action to an observable result.

Application to this study: use action labels such as Open Wikipedia, Begin activity, Pause, and Return to study. Pair an action with its consequence. Do not import promotional superlatives or promises of better performance into participant instructions.

Inspection limit: parsed page text and headings were available. Desktop Chrome received a Cloudflare block, so layout, typography, motion, and mobile behavior were not verified visually.

## Evidence for instructions

### Plain wording can affect accuracy

[Redish et al., NISTIR 7556, 2009](https://www.nist.gov/publications/report-findings-use-language-ballot-instructions) compared two ballots differing in instruction wording and presentation. The study included 45 voters in three locations. Participants voted more accurately with the plain-language version.

This is direct experimental support for treating instruction wording as part of interface performance. It does not isolate each editorial choice, establish a WebAble effect size, or prove these revised instructions are understood. The domain was voting, not mobile website navigation.

### Explain procedures without teaching the measured route

[Digital.gov’s usability testing guidance](https://digital.gov/resources/how-conduct-usability-test) recommends scenarios aligned with users’ goals and warns against instructions that point participants toward particular interface controls. It also separates introduction, setup, task completion, and follow-up in its sample script. This is professional methodological guidance, not a controlled experiment about this study’s wording.

Apply this distinction consistently:

- **Study procedure:** explain each required action, including opening another tab, starting timing, pausing, and returning.
- **Measured website task:** name the starting context and requested destination. Do not suggest a menu, a heading to expand, Find on Page, or an exact sequence of links.
- **Help:** repeat the task goal and explain the study controls. Assistance that teaches a website route changes the measurement and must not be added silently.

The Wikipedia instruction therefore names the city article and museum article. The park instruction names the starting Plan Your Visit page and the Basic Information destination. The participant chooses the route.

### Separate instructions and use familiar words

[W3C’s clear-content objective](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o3-clear-content/) recommends common words, short sentences, unambiguous content, and small text blocks. [Its instruction pattern](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o3p09-separated-instructions/) recommends separating steps and including actions authors might assume are obvious. These are cognitive accessibility recommendations, supplementary to WCAG, rather than a guarantee of conformance or comprehension.

Use phone, website, round, activity, text size, tap area, and settings. Define the study companion as the software that connects this guide to the websites. Avoid unexplained fit, presentation, condition, adaptation, calibration, scored task, and diagnostic language in participant copy.

The welcome page must disclose four activities, two rounds, usual website design versus WebAble, feedback after each round, and final questions. Do not publish a completion-time estimate until a participant pilot supports it.

### A start dialog must actually block the background

[W3C’s modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) specifies an inert background, focus entering the dialog, and a contained keyboard tab sequence. Visual dimming or obscuring commonly accompanies the inert state. This describes an accessible interaction pattern; it does not show that blur prevents every study error.

For this study, the centered dialog contains the task goal and an explicit Begin activity action. Blur and obscure the website, block outside interaction, and keep focus in the dialog until the participant begins or leaves. The dialog must not dismiss on an outside tap. Returning or canceling must not expose an untimed activity. Initial focus should allow the participant to read the heading rather than immediately activating Begin through an accidental key press.

Timing, focus restoration, late-loading page elements, navigation, and browser back/forward behavior require implementation tests. Comprehension still requires a phone pilot with intended participants.

## Questionnaire design

### Primary subjective measure: full SUS after each round

Sources: [Brooke, 1996, original SUS chapter](https://hci-studies.org/methods-and-measures/downloads/SUS_Brooke1996.pdf), especially pages 4–5 and 7; and the advisor’s requested [MeasuringU SUS explanation](https://measuringu.com/sus/). The latter’s indexed content was accessible; a direct page fetch returned 403.

Brooke describes a ten-item, five-response composite measure, administered after system use and before debriefing. Preserve all ten statements, their alternating polarity, their order, and the five-point agreement scale. His chapter permits usability-assessment use with source acknowledgment.

Define “this system” before the items as the websites used in the just-completed round. This study-specific referent and administration after two sites require piloting; standard SUS evidence does not independently validate that interpretation. Collect the complete instrument after each round, before comparative questions or condition disclosure. This timing is an application of the source guidance, not a tested WebAble procedure.

Score odd items as response minus one, even items as five minus response, sum, then multiply by 2.5. The result is 0–100, not a percentage. Report the composite, not ten separate validated outcomes.

Brooke originally directs respondents unable to answer to the midpoint. This study instead permits omission: retain missing values and compute no score unless all ten are answered. Document this voluntary-response policy; never silently impute a midpoint.

### Four final questions: study-specific, exploratory

These questions complement SUS; they do not form another validated scale. The rationale follows [Digital.gov’s separation of task completion from follow-up](https://digital.gov/resources/how-conduct-usability-test). Their exact wording and coding are study decisions that need pilot review.

| Question | Purpose | Analysis and interpretation |
| --- | --- | --- |
| Which round would you choose for browsing? | Record overall preference after exposure to both experiences. | Summarize first, second, no preference, and unsure. Map the selected round to condition only in analysis. Keep uncertainty and nonresponse distinct. |
| What did you notice about the two rounds? | Explain perceived differences and any preference in the participant’s own terms. | Qualitatively code reasons. Do not assume a preference proves faster performance or confirms that an adaptation was delivered. |
| Where, if anywhere, did you have difficulty? | Identify obstacles not explained by time or completion alone, including instructions and study controls. | Code by activity/site and type of obstacle when the answer supports it. Distinguish software failure, navigation difficulty, and unclear study instructions. |
| Did anything else affect how you completed the study? | Record assistance, settings changes, connection failures, and other possible confounds. | Code reported deviations separately from performance; choose exclusion rules before examining an effect. |

Keep all four optional. Do not combine them into a numerical total or add them to SUS. Ask them after the second round’s SUS so they cannot shape either round’s initial usability ratings.

### Mobile questionnaire presentation

[Falcone et al., 2020](https://www.surveypractice.org/article/13677-typographic-cueing-facilitates-survey-completion-on-smartphones-in-older-adults) tested typographic cues with 30 smartphone users aged 60–80 completing a five-question survey. Italicized instruction conditions averaged approximately 17 seconds, or 28%, less completion time; bold questions did not improve performance. Among 29 preference respondents, 83% preferred designs with bold questions. Recognition scores did not differ significantly by either factor.

This supports treating question text and instructions as distinct visual roles. It does not establish the best layout for a ten-item SUS, support a blanket instruction to italicize long text, or justify predicting a completion-time reduction here. Use visible item numbers, clear response labels, generous tap areas, and a consistent question hierarchy, then test the actual phone layout.

## Editorial and interpretation checks

- Every stage should identify where the participant is, what they need to do, and what happens after the action.
- Keep Round 1 and Round 2 labels consistent. Describe usual website design and WebAble neutrally; do not call one improved or easier. Visible changes mean the study should not be described as fully blinded.
- Explain that Begin activity starts timing and reaching the assigned page ends timing. Instructions and Pause must match the implemented clock behavior.
- Give completed, skipped, disconnected, and technically failed activities different explanations. Do not imply an unsuccessful activity completed automatically.
- Show a clear return action after each website activity. Remove the running seconds readout from the guide; participants need status and controls, not a speed target.
- Treat paired SUS scores as the planned subjective comparison, alongside separately defined objective completion and time outcomes. Counterbalancing reduces order confounding but does not make two different content sets identical.
- Record source, instrument version, missingness, task completion, input method, and adaptation delivery in the research export. Preserve prior protocol data under its original definitions.
- Before recruitment, pilot the whole flow on the supported phones with adults representative of the intended participants. Ask them to explain the purpose, task, start action, stop action, and questionnaire referent in their own words. Revise if their understanding differs from the protocol. Source-based design choices do not replace this check.
