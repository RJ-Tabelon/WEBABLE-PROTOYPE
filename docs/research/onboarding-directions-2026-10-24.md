**Superseded after clarification of the task.** This earlier brief overemphasized preference selection and demonstrations. It should not guide implementation. The required direction is to compare low-effort, engaging measurement procedures by the fit metrics they establish, measurement validity, and user burden.

**WebAble onboarding: a page that learns to fit you**

Research and design brief · October 24, 2026

This brief is based on the `webable-gatorhack` rebuild, inspection of the loaded extension's welcome and initial reading screens, and primary research checked for this report. The proposed experiences are original design recommendations. Published results below belong to the cited studies; they are not WebAble results. Proposed durations and success criteria are hypotheses to test.

**Recommendation**

Build the first minute around one living, useful page. Let people choose between a few concrete alternatives, perform a small task, and see their choices change the page immediately. End by carrying that fit into a different page. Keep the existing deeper fitting available when someone wants more precision.

The central creative direction is: **“Watch the web meet you.”** The user should experience the product's intelligence before being asked to configure it.

Aim for roughly 60–90 seconds and at most three explicit preference comparisons in the default path, plus the natural task and a final save. These are design budgets, not validated completion times or time limits. Finishing early and taking longer must both work.

**What the rebuild already does**

The project is a Preact/WXT browser extension with a TypeScript server and shared core. The extension reads page structure, uses Jev for bounded judgments, applies fit operations, verifies changes, and can present a Calm view. Generative layout and explanation paths are separate from deterministic fitting calculations.

The existing onboarding is substantial:

- The full route includes input-method choice; comfortable text sizing; an adaptive true/false reading ladder; faint-word contrast trials; light/dark trials and preference; pointing; finding; comparison and obstacle choices; and an editable fit preview.
- Pointing can involve three blocks of nine presses. Finding includes one practice plus eight scored trials. Reading and contrast already have adaptive selection or stopping logic. Adding “adaptive testing” alone would not be a new direction.
- There are quick, visual-skip, demo, pause, and skip paths. The full flow is advertised as about two minutes; I did not measure real-user completion time.
- `RawCollector` holds fitting trials in memory. The saved fit contains functional settings and baselines, without condition names. The fitting screen says the existing profile changes only when a new one is saved.
- The live signal engine already detects patterns such as corrected near misses, lost clicks, zooming, backtracking, and stalled progress, with contextual guards. It also remembers offer outcomes and snoozes. This is useful infrastructure; it is not yet evidence of a general learner continuously refining every fit dimension.

Relevant implementation anchors:

| Area | Current source |
|---|---|
| Flow and branching | [App.tsx](/Users/cadenshokat/Documents/Projects/webable-gatorhack/apps/extension/entrypoints/fitting/App.tsx) |
| Entry paths | [Welcome.tsx](/Users/cadenshokat/Documents/Projects/webable-gatorhack/apps/extension/entrypoints/fitting/screens/Welcome.tsx) |
| Reading interactions | [Reading.tsx](/Users/cadenshokat/Documents/Projects/webable-gatorhack/apps/extension/entrypoints/fitting/screens/Reading.tsx) |
| Pointing logic | [pointing.ts](/Users/cadenshokat/Documents/Projects/webable-gatorhack/apps/extension/entrypoints/fitting/logic/pointing.ts) |
| Finding plan | [finding.ts](/Users/cadenshokat/Documents/Projects/webable-gatorhack/apps/extension/entrypoints/fitting/logic/finding.ts) |
| Environment preferences | [env.ts](/Users/cadenshokat/Documents/Projects/webable-gatorhack/apps/extension/entrypoints/fitting/logic/env.ts) |
| Raw collection and persistence | [raw.ts](/Users/cadenshokat/Documents/Projects/webable-gatorhack/apps/extension/entrypoints/fitting/logic/raw.ts), [storage.ts](/Users/cadenshokat/Documents/Projects/webable-gatorhack/apps/extension/entrypoints/fitting/logic/storage.ts) |
| Fit contract and derivation | [types.ts](/Users/cadenshokat/Documents/Projects/webable-gatorhack/packages/core/src/types.ts), [derive.ts](/Users/cadenshokat/Documents/Projects/webable-gatorhack/packages/core/src/fit/derive.ts) |
| Live behavior and offer memory | [signals.ts](/Users/cadenshokat/Documents/Projects/webable-gatorhack/apps/extension/src/engine/signals.ts) |
| Adaptation orchestration | [controller.ts](/Users/cadenshokat/Documents/Projects/webable-gatorhack/apps/extension/src/engine/controller.ts) |

My assessment: the current design has a careful measurement foundation, but its sequence makes the user feel like they are completing a battery of exercises. The strongest change would reorganize the experience around visible outcomes and fewer context switches.

**Research that changes the design decision**

| Evidence | What was actually studied or documented | Implication for WebAble | Boundary |
|---|---|---|---|
| Ability-based interfaces | SUPPLE++ studied 11 participants with motor impairments and six participants without them. The former were 26.4% faster and made 73% fewer errors with generated ability-based interfaces than baseline interfaces. [Gajos et al., CHI 2008](https://www.eecs.harvard.edu/~kgajos/papers/2008/kgajos-chi08-supple.pdf) | Measuring how someone interacts can inform useful interface changes without asking for a diagnosis. | Small controlled study of particular applications; no promise of equivalent web-wide gains. |
| Preference differs from performance | Adobe's account of its TOCHI study describes 352 adults and 16 typefaces. Average fastest-versus-slowest reading speed differed by 35%; fastest-versus-preferred differed by 14%. Comprehension remained around 90%. [Adobe, 2022](https://blog.adobe.com/en/publish/2022/05/10/the-need-to-personalize-fonts-for-each-individual-reader) | Combine comfort choices with carefully interpreted task evidence. | Font results do not establish that a few onboarding clicks measure reading speed or that speed should override comfort. |
| Few-shot personalization of generated interfaces | A 2026 preprint collected 600 pair judgments from each of 20 people, then tested a pipeline with 12 new users and eight adaptive comparisons. Its online aggregate win rate was 60.35%, versus 50.9% for a profile-conditioned judge. Offline accuracy improved only 0.93 percentage points from zero to eight comparisons. [Peng et al., revised September 2026](https://arxiv.org/html/2604.09876v2) | Concrete visual choices can add information beyond a written profile; prior data matters. | Small, design-informed sample. Eight comparisons took an estimated two to three minutes. Three choices cannot be advertised as a validated comprehensive profile. |
| Adaptive elicitation | CAPE reports 80.8% preference alignment versus 68.5% for an RL baseline, requiring three to five times fewer interactions. It evaluates LLM explanation preferences with simulated users under PrefDisco protocols. [Bose et al., ICML 2026](https://proceedings.mlr.press/v306/bose26a.html) | Choose the next interaction based on what remains useful to learn, rather than marching through a fixed checklist. | Simulation and a different task; this is support for an approach, not a WebAble conversion estimate. |
| Current generative accessibility direction | Google's Natively Adaptive Interfaces describes multimodal, context-informed interfaces developed with the accessibility community. [Google Research, February 2026](https://research.google/blog/how-ai-agents-can-redefine-universal-design-to-increase-accessibility/) | Position onboarding as the first adaptive interface itself. | A research framework and product direction, not an efficacy trial for this onboarding. |
| Generative adaptation in a prototype | Google's self-evolving interfaces report describes a counterbalanced study of 72 participants using a banking prototype: SUS 84.38 for its adaptive version versus 53.96 for its deterministic baseline. [Google Research, 2026](https://research.google/pubs/self-evolving-systems-moving-beyond-deterministic-interfaces-to-adaptive-generative-interfaces/) | A changing interface is a credible contemporary research direction. | One prototype. SUS points are not percent improvement, and the study does not isolate onboarding. |
| Correctable AI | Microsoft's 18 Human–AI Interaction guidelines were evaluated with 49 practitioners across 20 products. They cover correction, dismissal, gradual learning, and cautious adaptation. [Amershi et al., CHI 2019](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf) | Teach users how to correct WebAble during onboarding and learn from those corrections. | Design guidance, not a quantified retention claim. |
| Implicit feedback is biased | Search research demonstrates that presentation and position affect clicks. [Joachims et al., TOIS 2007](https://www.cs.cornell.edu/People/tj/publications/joachims_etal_07a.pdf) | Treat behavioral evidence as context-dependent; randomize comparison order and preserve explicit overrides. | The original studies concern search. Applying the lesson to accessibility preferences is an inference. |
| Personalization and familiarity | W3C's cognitive accessibility supplemental guidance supports personalization, simplification, and control of changing content. [W3C COGA](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o8-personalization/) | Adapt the page while keeping it recognizable and controllable. | Supplemental guidance; adopting it does not establish WCAG conformance. |

The research supports the ingredients. None of these sources validates the complete experience proposed here or a claim that WebAble can fully understand someone in a minute.

**1. The Living Page — the main experience**

Open directly onto a beautiful, functional sample page. A short introduction sits inside the page: “Try this page. We'll use your choices and clicks to suggest a fit.” Provide a prominent start and an immediate skip. Begin with the person's available system preferences, without turning those signals into identity claims.

Use an innocuous, fictional task: find a free weekend workshop, open its details, and save it to a sample schedule. The task requires reading, scanning, activating controls, and keeping a place. It needs no personal information, typed search, or external submission.

As the person works, the page offers a small relevant change. Text can become more comfortable, controls can gain room, and supporting information can move into an expandable area. Each accepted change remains on the same canvas. The page visibly becomes theirs.

The visual treatment could feel like a precision instrument: a temporary outline reveals the space around a control; a paragraph settles into its chosen measure; the page's structure resolves into a calmer arrangement. Keep the content anchor and keyboard focus stable. Do not move a button while someone is approaching it or continuously mutate a timed trial.

**What it can learn:** chosen text scale, starting layout preference, preferred input path, reactions to a particular offer, and provisional pointing evidence. Those are useful first settings. They are not enough to estimate every threshold in `deriveFit`.

**Why it is distinctive:** the onboarding is already doing WebAble's core job. The first reward is an easier page, rather than completion of setup.

**Hackathon version:** one authored fixture, a handful of bounded variants, and existing verified adaptation operations. Live generation can choose a reviewed arrangement if it is fast and valid; a local variant should work immediately. Per-keystroke or per-pointer generative calls would add little value here.

**2. Parallel Worlds — choose the page you want to live in**

Show two versions of exactly the same content at usable size. Let the person switch between them with a large persistent control: “Which would you keep?” Include “About the same.” A swipe or reveal gesture may be a shortcut, with ordinary buttons and keyboard equivalents.

Make the transition spatially memorable: one page resolves into another while the same heading stays anchored. On small screens, toggle between full-sized versions instead of shrinking two screenshots until neither is readable.

There are two kinds of comparison, and the implementation should distinguish them:

- **A controlled comparison** changes one dimension, such as text size, while holding the content, layout, and theme constant. Its result can support that dimension's preference.
- **A whole-page comparison** changes several properties together, such as an ordinary page versus Calm view. Its result supports a package preference. It cannot tell you which changed property caused the choice.

Start with one controlled comparison. Let the next one target a genuine unresolved decision. Someone who kept readable text but rejected the calmer layout needs a different next comparison from someone who immediately wanted stronger structure.

The eight-comparison study above makes this a particularly relevant direction, but it also shows that the learning is modest and prior-dependent. For the hackathon, three comparisons should produce a useful starting configuration, with some dimensions explicitly left unknown.

**3. Shape the Noise — teach through the page itself**

Give people a way to demonstrate what matters. On the fixture, they can tap a promotional area and move it into “Later,” pause motion, or pin the information they are trying to follow. A brief visual trace shows the page reorganizing around the preserved task.

This turns abstract questions such as “Do you dislike clutter?” into concrete actions. Offer a “Less at once” action for grouping material, with “Show everything” immediately available. There should be no requirement to drag, draw a lasso, or identify a tiny close icon.

The expressive version is a temporary **focus lens**: select a region and see a preview of how WebAble could keep it prominent while arranging surrounding content. One tap accepts it, and a toggle restores the original. That interaction could be the visual signature of the project.

Keep inference narrow. Moving one promotion aside establishes a choice about that promotion in that task. It does not establish a permanent preference to remove every recommendation, notice, or navigation region. Offer a broader rule only after repeated relevant choices or an explicit request.

Existing overlay handling, structure judgments, and Calm view provide a practical starting point. Author the fixture so the meaning and consequences of each action are known; applying arbitrary “erase” gestures to live sites is a later problem.

**4. Teach by Undo — corrections become the conversation**

After a proposed change, keep the original a large, visible action away. If the person restores it, accept that as meaningful feedback immediately. An optional short choice can distinguish “Too much,” “Wrong thing,” and “Only this page”; no explanation should be required.

Use the last part of onboarding to demonstrate this deliberately. The user sees a candidate change, chooses whether to keep it, and learns that WebAble responds to correction. This teaches the product's control model and supplies preference evidence in the same action.

The reveal can make this feel advanced: the page returns to its earlier arrangement, then preserves only the accepted changes. The visible intelligence is selective memory.

The fit should become a small, inspectable record:

- “You chose roomier text.”
- “You kept this page's original layout.”
- “Larger click areas are suggested; try them.”

Distinguish choices from suggestions. Avoid a decorative “98% understood” score. An undo caused by a broken layout belongs to reliability feedback, not automatically to dislike of the underlying adaptation.

The existing offer memory is a head start. Learning persistent intensity and cross-site preferences would be additional work, not something the current offer snoozes already provide.

**5. One More Thing — stop when another question will not help**

Replace the fixed sequence with a small library of meaningful probes. Track which decisions remain uncertain and whether resolving them would change the first-page experience.

Examples of branching:

- If the person already chose a comfortable scale, do not repeat a long size exercise before showing value.
- If they use the keyboard, leave pointing unmeasured and let them continue.
- If reduced motion is already requested, honor it immediately; do not provoke motion to see whether they object.
- If they explicitly kept the existing layout, do not keep presenting increasingly simplified pages.
- If evidence about click areas is weak, offer a starting size or postpone the measurement rather than pretending a precise minimum is known.

The interface might offer “Try your fit” as soon as it has useful choices, with “Tune one more thing” as a secondary option. Progress should describe outcomes already established, rather than imply a complete test must be finished.

CAPE supports adaptive information gathering, but a defensible information-gain policy needs response models or population data. For the hackathon, use transparent bounded branching and call it adaptive selection. Do not call hand-written rules a trained preference model. A later version can choose probes by expected improvement in adaptation decisions minus interaction effort and interruption cost.

**6. The Portal — prove that the fit transfers**

The final screen should make a different page visibly fit the same person. Let the user open a second authored fixture or explicitly choose a supported current page. Reveal the original and fitted versions at the same scale, then let them activate a real control in the adapted page.

For a hackathon audience, this is the payoff: a choice made on the first page changes a different page, and the page still works. A beautiful fit card alone cannot demonstrate that.

Show plain statements of what changed. Keep the original available. When a layout cannot be safely adapted, show the working baseline and offer the supported operations. The demo should establish transfer and control, without requiring an unstable third-party site or a network generation step to succeed.

Later, the “portal” could be the next ordinary page the person visits. Onboarding would end by entering the product, with a small unobtrusive explanation of the first applied change.

**Understanding a person more deeply without a longer intake**

Build three distinct kinds of knowledge over time:

| Kind | Examples | How to obtain it |
|---|---|---|
| Presentation and interaction | Comfortable text, click area, contrast choice, motion preference | Concrete choices, optional controlled calibration, repeated contextual observations |
| Assistance preference | Explain a term, show an example, guide step by step, leave me to explore | Let people try those actions on the same sample task and remember the choices they explicitly keep |
| Current context | Reading closely, scanning, temporarily wanting less motion, another input device | Explicit quick modes and available browser signals; treat session changes separately from the saved baseline |

The existing fit covers much of the first category. The second would need additional fields and behavior; it cannot be smuggled into an existing clutter score. The third should be a temporary overlay, with an easy return to the baseline.

For example, the same user might choose the full article on one task and guided steps on a form. Those preferences can coexist. Do not convert them into a fixed “beginner,” “visual learner,” or diagnostic identity. Microsoft's inclusive design guidance explicitly considers temporary and situational mismatches. [Inclusive 101](https://inclusive.microsoft.design/articles/inclusive-101-guidebook)

**Two ambitious extensions**

**Optional voice that changes the page.** A person can say, “Keep the details, make it easier to follow, and leave the colors alone.” WebAble previews those specific changes and asks only for a keep/restore action. This elicits several preferences in one expression and feels more powerful than a voice questionnaire. Also provide the same outcome through page controls. Voice captures explicit intent; accent, fluency, or tone should not become inferred ability scores. Permission, transcription, ambiguity handling, and speech accessibility make this a stretch feature. It is not needed for the main experience.

**Optional gaze-driven reading lens.** A research-mode demonstration could use coarse gaze regions to move a reading spotlight. WebEyeTrack reports browser-based, on-device personalization with fewer than nine calibration samples and 2.32 cm error on GazeCapture. That is promising but does not establish reliable word-level tracking or performance on the hackathon's actual hardware. [Davalos et al., 2025 preprint](https://arxiv.org/abs/2508.19544) This introduces another calibration and camera permission, so it should earn its place through a useful interaction. It should not be the default onboarding or a claim to diagnose attention or reading conditions. Facial emotion inference is also a poor substitute for an explicit keep/restore response; Microsoft's own discussion documents the scientific generalization problems. [Microsoft, 2022](https://blogs.microsoft.com/on-the-issues/2022/06/21/microsofts-framework-for-building-ai-systems-responsibly/)

**A proposed default sequence**

These times describe a prototype pacing target. Nothing advances on a deadline, and slower users retain the same choices.

| Approximate moment | What happens | Evidence and payoff |
|---|---|---|
| 0–10 seconds | A functional sample page opens with a one-sentence explanation and start/skip. System preferences inform the baseline. | Immediate orientation; no account or personal intake. |
| 10–30 seconds | One or two controlled full-size comparisons establish the most useful presentation choices. | Explicit preferences; the page changes immediately. |
| 30–55 seconds | The user finds and saves a fictional workshop through a few ordinary controls. | Contextual interaction evidence and experience of the fitted page. |
| 55–75 seconds | One relevant unresolved choice: keep the layout, try grouping, or try roomier controls. Skip it if it adds little. | A targeted probe rather than another mandatory part. |
| 75–90 seconds | The fit record explains chosen versus suggested settings, then opens a second page. | Explicit save and visible transfer, with original/undo available. |

Do not add all six concepts as six consecutive stages. The Living Page is the container; Parallel Worlds and Shape the Noise are its interactions; Teach by Undo is the feedback model; One More Thing is the routing policy; the Portal is the ending.

**Which signals deserve weight**

| Observation | Reasonable interpretation | What should happen |
|---|---|---|
| Explicitly choosing and keeping a format | Preference for that format in that comparison | Save the chosen setting with provenance. |
| Requesting reduced motion | Direct request | Honor it without another motion test. |
| Undoing a specific change | Rejection or a problem with that change | Restore immediately; optionally clarify scope. |
| Corrected near misses across several stable controls | Possible mismatch between controls and input | Offer larger areas or optional calibration; keep confidence provisional. |
| Zooming and keeping that zoom | The page's current scale may not fit | Offer a scale adjustment; do not infer a visual condition. |
| Long dwell or a scroll reversal | Reading, interest, interruption, confusion, or navigation | Combine with other evidence; avoid treating this as a direct dislike or failure. |
| Using an explanation once | That explanation was useful to request in that moment | Do not infer general literacy, expertise, or permanent guidance needs. |
| Ignoring an offer | Little direct information about preference | Do not treat silence as an endorsement. |
| A verifier rejects an adaptation | The adaptation was unsuitable for the page | Count it as reliability evidence, not evidence against the user's need. |

The onboarding can be low-question without being covert. Explain the signal collection simply, keep raw fitting traces transient, and let users inspect or reset saved choices. Make local fitting and optional cloud-backed runtime features distinct; do not expand the fitting screen's local-data statement into a claim that every feature of the extension is local.

**What I would build for the hackathon**

| Priority | Work | Reason |
|---|---|---|
| First | One excellent authored task page and a continuously applied draft fit | Largest visible change to the experience; reuses existing operations. |
| First | Two controlled comparisons and one branch, with same/skip | Concrete personalization with a bounded implementation. |
| First | Original/keep/restore plus a clear chosen/suggested fit record | Makes control and learning understandable. |
| First | Transfer to a second fixture with a working control | Demonstrates that the fit is more than a theme preview. |
| Next | Tap-to-move secondary material and pin a task region | The most expressive signature interaction. |
| Next | A small assistance-style comparison and a temporary context mode | Broadens understanding beyond font and pointer settings. |
| Stretch | Voice editing or a gaze lens | Visually ambitious, but introduces substantial extra dependencies. |

Keep the current fitting as “Fine tune” or a research path. Its controlled data is valuable. The lighter path should not manufacture equivalent trials to satisfy `FittingRaw`: mark text choices as stated, leave `cpsPx` null when unmeasured, preserve low or missing confidence, and record a distinct calibration version. Where the existing schema lacks evidence metadata, add an explicit companion record or evolve the contract deliberately.

For the first prototype, candidate layouts and branch rules can be authored. Existing page understanding can help select relevant content, and existing layout machinery can express a fit. A new LLM-generated psychological description or a large fine-tuning project is unnecessary. Keep numerical measurement and user authority in code.

**How to test whether the idea works**

Run a small formative pilot with people who use relevant accessibility settings and input methods, including keyboard and screen-reader users. A hackathon convenience sample can identify obvious friction; it cannot validate the system for all intended users.

Compare the current flow with the proposed flow. Keep the downstream adaptation engine and test tasks constant. Randomize order if participants experience both, and use equivalent unfamiliar content on transfer tasks to reduce practice effects.

Measure:

- Time to the first change the person explicitly keeps, including initial load and network waits.
- Completion and the point of abandonment, counting skips separately from failures.
- Active effort: preference decisions, required task actions, and pauses.
- Success, errors, and assistance needed on the next unfamiliar page.
- Which settings survive the transfer task and which are undone.
- Whether the person can explain what was learned and restore an unwanted change.
- Comfort and preference alongside task performance. A faster experience that feels tiring is not automatically a better fit.

Useful prototype targets are a kept change within 20 seconds, no more than three explicit comparisons in the default path, and a usable starting fit within the intended 60–90-second range for many participants. These are targets to revise after observation. Do not display a fabricated improvement percentage from two short tasks or treat zero recorded errors as proof of an optimal target size.

Check the interaction itself: the gesture version needs single-pointer alternatives as well as keyboard access. WCAG 2.2's dragging guidance makes that distinction explicit. [W3C SC 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) Controls should begin usable; the 24-by-24 CSS-pixel minimum criterion has exceptions and is a compliance floor, not each person's ideal target. [W3C SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

**Suggested demo narration**

“WebAble starts with a page you can use. Choose the version that feels right, try one small task, and watch the page respond. Every choice becomes part of a fit you control. Now open another page: the same fit comes with you.”

The strongest demonstration ends with two people receiving visibly different, functional pages from a handful of choices, while either person can correct the result immediately.
