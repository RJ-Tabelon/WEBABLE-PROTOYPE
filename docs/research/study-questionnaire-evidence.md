# Questionnaire decisions for the mobile website study

Reviewed 21 October 2026. Applies to `mobile-live-3.0.0` only. The earlier live-site protocol and the simulated-site protocol did not administer SUS. Their responses must remain separate.

## What the questionnaire measures

The study records task completion and active time directly. Its questionnaire measures perceived usability and explains experiences that those records cannot describe. A favorable questionnaire score is not evidence that someone completed a task correctly or faster.

The System Usability Scale (SUS) follows each round's two website activities, before the debrief identifies the adjusted round. It refers to the website experience in that round. The introduction must define “this system” as those websites as they appeared in the round, so participants do not rate the installation process, calibration, or study instructions instead.

Using SUS after each condition makes a paired subjective comparison possible and reduces reliance on recalling the first round at the end. This is an application of Brooke's instruction to administer SUS after use and before discussion, not evidence that a two-website bundle is a separately validated SUS target. The result describes a short, task-based experience of those pages. It does not establish usability of every feature of WebAble, Wikipedia, or the National Park Service website.

## Instrument fidelity and scoring

The implementation retains all ten original English statements, their order and mixed polarity, including “cumbersome.” Responses use five agreement positions. The source and instrument ID are retained with exports. No customized statement is presented as an original SUS item.

The original chapter makes SUS available for usability assessment with acknowledgement in published reports. It retains a Digital Equipment Corporation copyright notice; “freely reusable with attribution” is more accurate than claiming the instrument is public domain.

For the total, odd-numbered responses contribute response minus one; even-numbered responses contribute five minus response. Multiply the sum by 2.5. The result ranges from 0 to 100 and is one composite score, not a percentage, ten independent outcomes, a clinical score, or a measured success rate.

Participants can leave questions unanswered or skip a round's questionnaire. A submitted questionnaire with any missing answer has no computed total. Raw answers, answered/missing counts, and submission state remain available. A missing response is never silently replaced with zero or the midpoint. A deliberately selected midpoint remains a real answer. This complete-case scoring rule is the study's conservative analysis decision, rather than a claim that every SUS study must use the same missing-data rule.

Brooke's original administration instructions direct participants who cannot judge an item to the midpoint. If used, that instruction must be visible to the participant and the participant must select it; it does not justify automatic imputation. A skipped or incomplete questionnaire must not block voluntary completion of the study.

A paired SUS difference is calculated only when both round questionnaires have been submitted and all ten answers are present in each. Task failures do not automatically discard subjective responses: failed and skipped tasks may be central to a participant's experience. Those outcomes should be inspected alongside questionnaire scores. Pilot and main cohorts and protocol versions stay separate.

Broad industry norms such as 68 are reference values from heterogeneous products and samples, not a pass/fail threshold established for this study's older smartphone users. The paired condition comparison, its uncertainty, content/order differences, and missingness matter more than assigning a letter grade to a small pilot.

## Four final questions and their purpose

These questions are researcher-written exploratory feedback. They have no validated combined score and never contribute to SUS.

| Field | Purpose | Analysis |
| --- | --- | --- |
| Preferred round, with equal/unsure options | Identify a participant's overall preference without assuming one round is better. | Report counts with the first/second condition mapping and missing responses. Do not treat “unsure” as no preference. |
| Observed differences and reasons for any preference | Explain perceived differences and preference in the participant's own terms, including when no preference was selected. | Code themes; retain explanations that conflict with measured performance. |
| What was difficult or confusing | Capture barriers, misunderstandings, and problems that navigation logs cannot explain. | Code by activity, website, setup, instruction, or adaptation when the answer supports that attribution. |
| Assistance, settings changes, or other problems | Record possible confounds and technical interruptions rather than assuming both rounds were comparable. | Flag and describe relevant deviations; choose exclusions before examining a desired effect. |

The standard scale already asks about confidence and willingness to use the system. Repeating those constructs as extra custom ratings would add burden without a defined new measurement purpose. Additional task-level scales, such as SEQ, should be a separately specified protocol decision; they are not needed merely to increase the final survey's length.

## Sources reviewed

- [Brooke (1996), SUS: A “quick and dirty” usability scale](https://hci-studies.org/methods-and-measures/downloads/SUS_Brooke1996.pdf). Original questionnaire, administration, scoring, and reuse acknowledgement condition. The original PDF was inspected, including the use/scoring section and final permission paragraph.
- [Sauro (2011), Measuring usability with the System Usability Scale](https://measuringu.com/sus/). The advisor's requested explanatory source. The direct URL returned HTTP 403 during this review; its indexed page text supplied the ten items, scoring explanation, distinction from percentages, and heterogeneous benchmark context. The original paper supplies the instrument implementation.
- [Brooke (2013), SUS: A retrospective](https://www.researchgate.net/profile/John-Brooke-6/publication/285811057_SUS_a_retrospective/links/5ee5c4a792851ce9e7e38a75/SUS-a-retrospective.pdf). Author's retrospective account confirms that the questionnaire was distributed freely for other evaluators to use. The article's own publication copyright must not be confused with the instrument's reuse terms.
- [Lewis and Sauro (2009), The factor structure of the System Usability Scale](https://measuringu.com/papers/Lewis_Sauro_HCII2009.pdf). Includes evidence that “awkward” can replace “cumbersome” and consistent system/product naming can clarify a target. This revision retains the original wording rather than introducing that documented variant. The source was available as indexed author-hosted full text; its direct URL returned HTTP 403.
- [Bangor, Kortum, and Miller (2008), An empirical evaluation of the System Usability Scale](https://doi.org/10.1080/10447310802205776). Large multi-product evaluation supports SUS's usefulness across contexts. It does not validate this study's custom final questions or establish a universal acceptable score.
- [Callan and Kortum (2014), The relationship between task-level and test-level System Usability Scale scores](https://doi.org/10.1177/1541931214581238). Task-level and whole-test administrations produced different scores. The implementation therefore identifies its round-level timing explicitly and does not pool it with task-level SUS or claim the timings are interchangeable.
- [Lewis and Sauro (2017), Can I leave this one out? The effect of dropping an item from the SUS](https://openurl.ebsco.com/contentitem/gcd%3A126463593?id=ebsco%3Agcd%3A126463593&sid=ebsco%3Aplink%3Acrawler). Nine-item variants can be scored with an adjusted multiplier in that study. This implementation uses the requested full instrument and does not silently switch scoring formulas for incomplete responses.

## What still needs empirical validation

Research supports the measurement method; it does not prove that the revised copy is clear for the recruited population. Before the main study, observe older smartphone users reading each instruction, ask them to explain the next action, and check whether they identify the requested destination and questionnaire target without prompting. Record misunderstandings and technical failures during the pilot. Revised instructions, different sites, or instrument wording changes require a recorded protocol/content version rather than pooling incompatible responses.

## Ordinary website navigation in protocol 3

Participants may use each assigned website's normal menus, links, and search. Wikipedia's article routes, `Special:Search`, and the read/search `index.php` route remain within the activity. On the National Park Service website, a public page in another park or a site-wide search page is an ordinary navigation step, rather than a technical failure. Completion still requires the assigned destination, and recording remains limited to the activity's assigned tab. Other origins and obvious account, editor, API, or administrative routes remain outside the activity.

This scope follows how the sites actually route navigation. [MediaWiki's parameter documentation](https://www.mediawiki.org/wiki/Manual:Parameters_to_index.php) identifies `view` as the default action, `search` as a search request, and separate edit/submit and account routes. Those distinctions let the study support a normal search route without enabling recording on an editor or account page.

Query strings and fragments are removed before recording. Wikipedia can also put a typed search after `/wiki/Special:Search/`; that suffix is replaced with the generic search route. NPS search paths are likewise reduced to `/search/`. The study retains neither search terms nor form values. This behavioral revision belongs to protocol 3; exports do not reinterpret earlier protocol responses as though they used the same search scope.
