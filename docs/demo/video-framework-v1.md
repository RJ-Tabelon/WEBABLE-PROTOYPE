# WebAble video framework — first review

Proposed runtime: **2:50**, leaving ten seconds below the published three-minute limit. Aim for approximately 330–350 spoken words, with room to see each change. Scope: story, screen sequence, and judging coverage; the narration comes after review.

**Central story:** WebAble learns what makes the web difficult for one person, then changes how websites look, read, and organize information for that person.

Keep the same person and saved preferences throughout. Use two main examples—a pharmacy task and an article—with two short examples to show range.

## Storyboard

| Time | Purpose | What the viewer sees | What this must communicate |
|---|---|---|---|
| **0:00–0:15** | Make the problem concrete | The original Alderra refill page. Frame the small Confirm button, faint text, and competing shopping offers. Label it “Demo pharmacy — built by us.” | A routine task can become difficult because of the page’s design. Describe the obstacles on screen. |
| **0:15–0:25** | Introduce WebAble and show an immediate benefit | Turn WebAble on. Hold the adapted page long enough to see larger text and easier controls. | “WebAble fits web pages to the person using them, without asking what’s wrong with you.” Show the benefit before explaining the system. |
| **0:25–0:55** | Explain how it learns about the person | Brief cuts through reading, pointing, and finding something on a real website. Then “Bring your context”: ask an existing AI assistant about explanation preferences, paste its answer, and show the learned preferences on the final screen. | It learns practical needs through interaction. Optionally, the person can bring how they like information explained. This is a user-controlled paste, with reviewable preferences. Use one consistent preference, such as steps and plain explanations, in the next shot. |
| **0:55–1:25** | Deliver the main content demonstration | A public CNN article, or IRS guidance if it produces a clearer verified result. Show the original passage, WebAble’s actual rewritten or rearranged version, and the control that reveals the page’s own words. Also hold a full-page view showing larger text and reduced clutter. | WebAble can adapt wording and information layout to the person. Point to a concrete change that matches the preference just shown. Show an original fact or link surviving the change. Use the actual generated result from the recording build. |
| **1:25–1:45** | Show range and preservation | About ten seconds each: Allrecipes before/after, then Florida’s Kentucky record before/after. | Different pages need different treatments. A recipe should foreground ingredients and steps; a sports page should retain its record, score, and team identity. Keep the same saved preferences. |
| **1:45–2:10** | Explain how it works and the frontier technology | Open “How WebAble read this page.” Highlight one actual element and its Jev probability. Add a simple explanatory overlay showing page evidence → Jev judgments; source content + reading preferences → generated wording/layout → code and Jev checks → displayed result. | Jev identifies page roles and supports decisions about what to change. GPT drafts wording and component layouts. Checks can reject proposed changes. State why Jev’s fast, structured decisions matter to browsing and give its release date. |
| **2:10–2:25** | Establish control and trust | Open “What WebAble did here,” undo one change, switch to the original, and briefly show pausing on the site. | The person can inspect and reverse changes. State that failed checks keep or restore the original. If discussing privacy, describe the actual cloud processing accurately. |
| **2:25–2:42** | Provide evidence and a clear limitation | One compact evidence card, with a readable scope note, over real product footage. | An automated test of an earlier build enlarged text successfully on 32 of 50 sites. Label this as in-place adjustment testing with AI rewriting and generated layouts off. The next step is testing with people; the current figures do not establish user benefit. |
| **2:42–2:50** | Finish the task and return to the promise | Complete the pharmacy task and show its confirmation. End with WebAble, Caden Shokat, and Sid Pandey. | A person can finish what they came to do. Closing direction: the web should fit the person using it. |

## The technical explanation

Use one concrete decision rather than a stack inventory. For example: show what Jev thinks a sidebar is, its probability, and the resulting treatment. Choose an example that actually passes the current policy checks.

The engineering challenge to explain is **changing presentation while preserving useful information**. Show the original and adapted passage together, then explain the checks for numbers, links, coverage, and layout. A passing check is evidence for using that output, not a guarantee that every fact is preserved perfectly.

Jev was publicly announced on **September 15, 2026**, and Jev 1.14 became available on **October 14, 2026**. These dates support the recent-technology story recorded in the team’s “Fresh off the frontier” brief. The public event homepage still leaves the challenge statement unpublished, so that theme is taken from the local project brief.

Sources: [TypeSafe’s launch announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev), [model release documentation](https://docs.typesafe.ai/models), and [event homepage](https://ufgatorhack.com/).

## Judging and submission coverage

| Published criterion | Where the video addresses it |
|---|---|
| Impact | The opening task, visible obstacles, and completed task at the end. |
| Technical execution | A working extension, personalized content, a real Jev decision, and preservation checks. |
| Design and usability | The learning flow, readable results, one small control, and reversible changes. |
| Presentation and demo | A continuous person-centered story, visible before/after examples, and a scoped result plus limitation. |

The [official Devpost page](https://gatorhack2026.devpost.com/) lists a demo video of **three minutes maximum or slides**, a project title and description, public code repository, registered team roster, and chosen sponsor prizes. Submission is due **October 25, 2026, at 5:00 PM Eastern**. The [rules](https://gatorhack2026.devpost.com/rules) also require fresh project code and team representation from at least two UF departments. Keep the roster, departments, repository, and prize selections in the written submission; the end card can identify the two builders briefly.

## Accuracy notes for this version

- **Current code is ahead of the existing pitch docs.** The working tree includes AI context import, personalized paragraph rewriting, and content composed into components. This framework includes them because they are central to the current product direction. Their live presentation still needs checking before recording.
- **Replace the old privacy line.** The newer background routes send enabled reading preferences and selected page content for model processing. Saved preferences being stored locally does not mean they stay on the laptop. A factual line is: “For personalized explanations, WebAble sends selected page text and the reading preferences you keep enabled to AI services.”
- **Keep the benchmark narrow.** The 32-of-50 measurement belongs to an earlier build, one configuration, and in-place adjustments. The recorded median Jev read was 430 ms; complete page adaptation took longer. If speed appears, label it as model round-trip time rather than whole-page completion time.
- **Avoid an onboarding duration claim.** The old two-minute storyboard describes an obsolete flow. Show the current Reading → Pointing → Finding → Your context sequence as a montage, with accelerated sections labelled when needed.
- **Passive learning is a reserve shot.** It is in the code, but the spontaneous help moment has been inconsistent in prior runs. Add it only after the actual interaction is repeatable; otherwise mention continued learning briefly and preserve the stronger demonstrations.
- **Use real outputs.** Pick CNN or IRS after inspecting the current build’s result. Preserve warnings, quantities, and links in the shot. The framework does not certify that any proposed screen currently renders as described.

Code and evidence consulted: the local WebAble skill; `docs/CLAIMS.md`; existing demo documents; current onboarding steps and context import; background model routes; composition and rewriting engines; and original-content controls. Reference pitch observations are in `pitch-reference-notes.md`.

## Review decisions

1. Does the pharmacy opening make the problem concrete enough?
2. Does the progression from physical needs to explanation preferences express what WebAble should be known for?
3. Should the article transformation carry the main demonstration, with recipe and sports as short supporting examples?

After these choices, write the narration against the current build’s exact visible changes and turn each row into a recording shot list.
