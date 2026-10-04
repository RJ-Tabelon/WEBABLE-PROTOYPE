# WebAble calibration: attention regulation and cognitive load (research report)

_Compiled 2026-09-28. Scope: a web-delivered, non-diagnostic onboarding module of about 60 to 90 seconds. Its only job is to estimate which interface adaptations help this person: motion reduction, dimming distracting regions, focus mode, reduced visual density, reading width, reading ruler or line focus, chunking long passages, and clearer hierarchy or next-action emphasis. Every number below either cites a URL or is labelled **modelled** or **proposal** (our own derivation, to be replaced by pilot data)._

---

## 0. Decision summary

1. **Correct a framing error before it spreads.** The Frontiers 2025 meta-analysis (Shen; g = −0.64, 32 studies) is **not** about motion. Its coded distractors are TV, music, noise, instant messaging and interruptions. Animation and ads are not coded. **Within-subject designs gave g = −0.32**, against −0.81 between-subject. The within-subject figure is the right analog for a per-person calibration. Motion-specific web evidence comes from other studies: Simola 2011, Vital/Sandnes 2022, Burke 2005, Zhang 2000 and Hong 2004 (§2.1). `docs/03-Evidence-Base.md` files g = −0.64 under "Motion and distraction — strong", which overstates the motion claim. Split the entry.
2. **A 60–90 s behavioral difference score cannot reliably rank individuals.** Classic interference effects reach test-retest ICCs of only about .40–.66 even with hundreds of trials (Hedge 2018). True between-person variance is about 1/8 to 1/11 of trial noise (Rouder, Kumar & Haaf 2023). We modelled a 12-trial search block (6 vs 6 trials per contrast). It gives reliability of about **.2–.4**. A single user's effect must exceed about **+40% slowdown** before it is distinguishable from zero (§3). **Design consequence:** onboarding behavior can only flag the upper tail. For everyone else, estimates must shrink toward the population. The profile must carry an explicit SD and confidence, and the extension's in-the-wild keep/undo outcomes do most of the estimation after onboarding.
3. **Paired post-use preference is the most information-dense signal per second, so weight it heavily.** Across 144 studies, preference tracks **workload** (explains 54% of preference variance) more than task time (36%) or errors (19%). A preferred system imposes significantly higher workload in only 2% of studies (Hertzum 2025). Forced-choice pairwise comparison has the lowest measurement variance and is time-efficient (Mantiuk 2012). Preference still diverges from performance in about 25% of cases (Nielsen & Levy 1994). So we combine preference and behavior; neither replaces the other.
4. **Preference for simplicity also predicts who is harmed by clutter.** In Baughan et al. (CHI 2020, n = 165), everyone searched slower on complex sites (4.2 s simple vs 7.3 s complex). The harm was larger for people who preferred simple sites (H-vs-L d = 0.96) than for those who preferred complex ones (d = 0.67). This is direct precedent for a preference-plus-search calibration.
5. **Treat `prefers-reduced-motion: reduce` as an asymmetric prior.** When it is present, it is strong evidence for motion reduction, whatever the cause. Confirm it with the user and **never expose that user to motion trials**. When it is absent, it is nearly uninformative, because many users do not know the setting exists.
6. **Proposed core battery (about 83 s):**
   - A. "Find it": 12 search trials on mock pages, 2×2 clutter × motion, with yoked items.
   - B. "What's next?": 4 goal-based first-click trials with a flanker-style decoy CTA, weak vs strong hierarchy.
   - C. "Find in text": 2 fact-finding passages, dense vs chunked.
   - D. 4 post-use paired preferences, plus a 3-second "what bothered you" chip question.
   - An optional 3-minute "tune-up" adds trials and a reading-with-motion comprehension block for users with ambiguous posteriors.
7. **Profile output.** Five dimensions, each stored as {mean, sd, confidence, sources}: motion sensitivity, distraction sensitivity, density tolerance, chunking preference and guidance preference. Default-on thresholds are **cost-weighted**. Motion reduction is cheap to get wrong, so it defaults on at low evidence. Focus mode, dimming and next-action emphasis are expensive to get wrong (Gajos 2008: inaccurate adaptation is worse than none), so they stay "offer" unless the evidence is strong.

---

## 1. Constraints and framing (non-negotiable)

- **Measure interface response, not the person.** Estimate how much each interface manipulation changes this person's speed, accuracy and comfort. Never estimate a trait, and never make a normative comparison ("you are in the 80th percentile of distractibility"). A normative comparison reads as diagnostic.
- **Never use symptom scales.** No ASRS, no ADHD rating scale, no Cognitive Failures Questionnaire. Forster & Lavie (2016) validated distractibility against ADHD symptom scores, and that is exactly the inference we must not make. What we take from that paper is only that irrelevant-distractor interference varies **continuously in the general, non-clinical population**: highly distractible people were up to 41% slower with a cartoon distractor present, and high perceptual load eliminated the effect (https://pubmed.ncbi.nlm.nih.gov/26667659/). This supports the non-diagnostic "sensitivity" framing. Mouse data can discriminate mild cognitive impairment (Seelye 2015, in the Evidence Base), which is why raw traces never leave the client.
- **Copy rules.** Use "Moving content slowed you down on those pages", never "you have trouble focusing". No words like ADHD, attention deficit, disorder, symptom or score. Frame it to the user as "we're testing pages, not you."
- **Safety of the stimuli themselves:**
  - No flashing above 3 per second (WCAG 2.3.1, https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html).
  - No parallax, zoom or scroll-linked motion. Vestibular triggers are the rationale of WCAG 2.3.3 (https://w3c.github.io/wcag21/understanding/animation-from-interactions.html).
  - A visible "Stop motion" control on every animated trial (WCAG 2.2.2, https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html). **Pressing it is recorded as strong evidence, not as a failure.**
- **Privacy.** Compute everything client-side. Persist only per-dimension posteriors plus a small per-condition summary. Discard per-trial cursor traces at the end of the session unless the user opts into research.
- **Order in onboarding.** Run this module **after** the vision and motor modules. Mock pages are then rendered at the user's calibrated text size and contrast, so low vision does not masquerade as distraction. Fitts parameters from the motor module let us subtract predicted movement time (§5).

---

## 2. Evidence base by construct

### 2.1 Motion and animation on web pages

| Finding | Source |
|---|---|
| Distraction during digital reading lowers comprehension: overall g = −0.64 [−0.89, −0.40], I² = 88.3%. **Between-group g = −0.81; within-group g = −0.32** (moderator p = .015). By type: TV −0.82, music −0.82, noise −0.48, IM −0.30, interruption −0.21 (n.s.). Time limits did not moderate (−0.61 vs −0.70). **Animation and ads were not coded.** | Shen 2025, Frontiers in Psychology — https://pmc.ncbi.nlm.nih.gov/articles/PMC12684101/ |
| Salient (animated) ads attract overt attention and disrupt reading on authentic web pages; eye tracking | Simola, Kuisma, Öörni, Uusitalo & Hyönä 2011, J Exp Psych: Applied 17(2) — https://eric.ed.gov/?id=EJ934193 |
| An animated background significantly slowed reading speed and lowered preference in a **remote web-based** reading experiment. This is closest to our delivery setting. | Vital, van der Baan, Stenberg & Sandnes, HCII 2022 — https://link.springer.com/chapter/10.1007/978-3-031-05028-2_10 |
| Animated and static commercial banners both slowed visual search. Animated and flashing banners raised perceived workload (TLX) and frustration, and people rarely fixated them ("banner blindness" coexists with cost). | Burke, Hornof, Nilsen & Gorman, TOCHI 2005 — https://dl.acm.org/doi/10.1145/1121112.1121116 |
| Animation as a secondary stimulus degrades information seeking. **The cost shrinks as task difficulty rises.** Task-similar animation hurts more, and bright animation hurts more than dull. | Zhang, JAIS 2000 — https://aisel.aisnet.org/jais/vol1/iss1/1/ |
| Flash on a non-target item hurts focused attention and attitude toward the site. Flash on the target speeds finding it but does not improve recall. | Hong, Thong & Tam, ISR 2004 — https://pubsonline.informs.org/doi/10.1287/isre.1040.0017 |
| Micro-animations did not improve perceived quality or trust. The effect was moderated by perceived distraction (n = 91). | Burge & Jang, IADIS IJWI 2026 — https://www.iadisportal.org/ijwi/papers/2026240105.pdf |
| **Motion onset** captures attention automatically, more than continuous motion or motion offset. | Abrams & Christ, Psych Science 2003 — https://doi.org/10.1111/1467-9280.01458 |
| Capture by repeated irrelevant onsets **habituates** with exposure, context-specifically, lasting about 2 weeks. | Turatto et al. — https://link.springer.com/article/10.3758/s13423-017-1320-x ; https://link.springer.com/article/10.3758/s13423-022-02204-y |
| Interruptions during a primary task cost 3–27% more time, twice the errors and 31–106% more annoyance. | Bailey & Konstan 2006 — https://www.sciencedirect.com/science/article/pii/S074756320500107X |
| No randomized trial exists of motion removal on task performance for ADHD users. Formative work only: 12 ADHD adults valued "auxiliary removal" and background blur for video. | FocusView — https://arxiv.org/html/2507.13309 |

**Design implications for stimuli:**
- Use **intermittent onsets**, such as a carousel advance or badge pop, alongside continuous motion. Onsets drive capture (Abrams & Christ).
- Keep search tasks at **low-to-moderate perceptual load**. High load hides distractor costs (Lavie 2005; Zhang 2000).
- Accept that a short calibration measures **first-exposure** cost. Habituation means the steady-state cost on a site the user revisits may be smaller, which is another reason the extension's outcome learning should dominate over time.

### 2.2 Distractibility, load and response competition (flanker principles)

| Finding | Source |
|---|---|
| High **perceptual** load reduces distractor processing. High **working-memory or cognitive-control** load **increases** it. | Lavie 2005, TICS — https://labs.wsu.edu/attention-perception-performance/documents/2016/05/attentional-load-review_lavie_05.pdf/ |
| Flanker interference: responses slow when adjacent items signal a competing response, and interference falls as spacing increases. | Eriksen & Eriksen 1974 — https://link.springer.com/article/10.3758/BF03203267 |
| Distractibility is a continuous trait in the general population; up to 41% slowing for the most distractible; eliminated by high perceptual load. | Forster & Lavie 2016 — https://pubmed.ncbi.nlm.nih.gov/26667659/ |

**Translation to UI.** The web analog of an incompatible flanker is a **visually dominant decoy CTA placed next to the correct control**, for example "Get the app" styled as primary beside a plain "Continue". Its dependent measures are **decoy capture** (a first click on the decoy) and first-click time. Holding the goal in mind is a realistic working-memory load, and it increases distractor effects. **Do not compute a classic arrow-flanker score:** its individual reliability is poor (§3), and it is not an interface task.

### 2.3 Clutter, density and visual complexity

| Finding | Source |
|---|---|
| Three clutter measures: Feature Congestion (color, orientation, luminance contrast), Subband Entropy (wavelet-subband redundancy) and Edge Density. Correlations with mean log search RT: **FC r = .74/.76, SE r = .75/.77, ED r = .83** (target present/absent). MATLAB code is published. | Rosenholtz, Li & Nakano, JoV 2007 — https://jov.arvojournals.org/article.aspx?articleid=2122001 ; code — https://persci.mit.edu/research/clutter/ |
| AIM service and codebase implements FC, SE, contour density and colourfulness, with comparison against the top 500 sites. | Oulasvirta et al., UIST 2018 Adjunct — https://interfacemetrics.aalto.fi/static/publications/oulasvirta_et_al_2018.pdf |
| Online study, n = 165. Preference measured from appeal ratings of 12 screenshots; then 6 search trials (2 low, 2 medium, 2 high complexity). Complexity slowed search, F(2, 8.99) = 4.44, p < .05: **simple M = 4.2 s (SD 4.7), complex M = 7.3 s (SD 7.0)**. Complexity × preference interaction β = −0.154, p < .05. The low-complexity-preferring group showed H vs L **d = 0.96** and the high-preferring group d = 0.67. Complexity also lowered recall. Age raised log time (β = 0.014/yr). | Baughan, August, Yamashita & Reinecke, CHI 2020 — https://par.nsf.gov/servlets/purl/10156432 ; https://dl.acm.org/doi/fullHtml/10.1145/3313831.3376849 |
| Peak-appeal complexity and colourfulness vary by person: 2.4 M ratings from about 40 k people. | Reinecke & Gajos, CHI 2014 — https://www.eecs.harvard.edu/~kgajos/papers/2014/reinecke14visual.shtml |
| High visual complexity raises arousal, gives more negative valence, raises RTs and lowers recognition. | Tuch et al., IJHCS 2009 — https://www.sciencedirect.com/science/article/abs/pii/S107158190900055X |
| DOM-structure proxies (links, images, words, sections) rank perceived complexity with 86% correlation to user rankings. Relevant to the extension's cheap page-feature extraction. | Michailidou, Harper & Bechhofer — https://www.researchgate.net/publication/262352111_Analysing_the_visual_complexity_of_web_pages_using_document_structure |

**Note on noise.** Baughan's per-trial SDs roughly equal their means (4.2 ± 4.7 s). That is what real screenshots with heterogeneous targets produce, and it is why we render **controlled mock pages with yoked targets** rather than screenshots of real sites.

### 2.4 Chunking, structure and signaling

| Finding | Source |
|---|---|
| Scannable layout +47% measured usability; concise text +58%; all three rewrites combined +124%. Practitioner study with a composite metric. | Morkes & Nielsen 1997 — https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/ |
| Segmenting effect: retention **d = 0.32**, transfer d = 0.36. Lowers cognitive load; 56 investigations. | Rey et al. 2019 — https://link.springer.com/article/10.1007/s10648-018-9456-4 |
| Signaling (cues that highlight organization): retention **g = 0.53**, transfer g = 0.33. Reduces cognitive load; 103 studies, N = 12,201. | Schneider et al. 2018 — https://www.sciencedirect.com/science/article/abs/pii/S1747938X17300581 |
| Reading rulers (Grey Bar, Shade, Underline) raised speed for dyslexic readers by +19, +16 and +12 WPM with no comprehension cost; 91 dyslexic and 86 non-dyslexic readers. **Not tested for attention-related needs.** | Niklaus, Cai, Bylinskii & Wallace, CHI 2023 — https://dl.acm.org/doi/10.1145/3544548.3581367 |
| About 55 characters per line gave the best comprehension; 80+ caused lost place. | Dyson & Haselgrove 2001 — https://www.sciencedirect.com/science/article/abs/pii/S1071581901904586 |
| Adult silent reading averages 238 wpm for non-fiction (range about 175–300). | Brysbaert 2019 — https://www.sciencedirect.com/science/article/abs/pii/S0749596X19300786 |
| Individual reading-speed optimization works per person (Bayesian optimization over fonts), and the optimal fonts differ between readers. | Kadner, Keller & Rothkopf, CHI 2021 — https://dl.acm.org/doi/fullHtml/10.1145/3411764.3445140 |

**Gap:** there is no controlled evidence that chunking or reading rulers help people with attention-regulation needs specifically. Treat both as **offer-only**, driven by preference.

### 2.5 Hierarchy and next-action emphasis

| Finding | Source |
|---|---|
| A correct first click predicts task success: 87% vs 46%. Secondary (practitioner) source for Bailey & Wolfson. | https://www.optimalworkshop.com/blog/correct-first-click-lead-to-3x-higher-task-success |
| DOM-grounded highlighting of where information is raised accuracy from 71.4% to 81.0%, n = 53. | PageGuide, UIST 2025 — https://arxiv.org/abs/2604.23772 |
| COGA patterns "Make it easy to find the most important things" and "Limit interruptions / avoid distractions" | https://www.w3.org/WAI/WCAG2/supplemental/patterns/o2p01-site-important/ ; https://www.w3.org/WAI/WCAG2/supplemental/patterns/o5p01-minimal-interruptions/ |
| Inaccurate adaptation is worse than none. | Gajos et al., CHI 2008 — https://www.eecs.harvard.edu/~kgajos/papers/2008/gajos08predictability.shtml |

### 2.6 Self-report instruments

| Instrument | Facts | Source |
|---|---|---|
| SEQ (7-point single item) | Mean about 5.3–5.6 across 400+ tasks; r ≈ .5 with time and completion | https://measuringu.com/seq10/ ; https://measuringu.com/how-the-seq-correlates-with-other-task-metrics/ |
| Paas mental-effort (9-point single item) | Reported reliability about .90; the most used load measure in multimedia learning | https://www.researchgate.net/publication/15390085_Measurement_of_Cognitive_Load_in_Instructional_Research |
| Raw NASA-TLX (6 items, unweighted) | Sensitivity comparable to weighted TLX; too long for a 90 s module | Hart 2006 — https://journals.sagepub.com/doi/10.1177/154193120605000909 |
| Pairwise forced choice | Smallest measurement variance and most time-efficient of four subjective methods | Mantiuk et al. 2012 — https://www.cl.cam.ac.uk/~rkm38/pdfs/mantiuk12cfms.pdf |
| Preference vs performance | Agreement in about 75% of cases (r ≈ .46) | Nielsen & Levy 1994 — https://dl.acm.org/doi/10.1145/175276.175282 ; Andre & Wickens 1995 — https://journals.sagepub.com/doi/10.1177/106480469500300403 |
| Preference vs workload | 144 studies. Workload explains 54% of preference variance, time 36%, errors 19%. A preferred system has significantly higher workload in 2% of studies. Post-use preferences differ from pre-use ones. | Hertzum, IJHCS 2025 — https://mortenhertzum.dk/publ/IJHCS2025.pdf |

**Implication.** "Which felt calmer / easier?" asked **after use** is effectively a cheap comparative workload measure. That is the right target for comfort-oriented adaptations. Ask it post-use, with thumbnails of the exact pages the person just used.

### 2.7 Measurement infrastructure

| Fact | Source |
|---|---|
| Browser platforms have reasonable RT accuracy and precision. Offsets are around 80 ms on some platforms; the best platform SD was about 8 ms. Negligible against 2–4 s search RTs. | Anwyl-Irvine et al. 2021 — https://link.springer.com/article/10.3758/s13428-020-01501-5 |
| The cursor lags gaze by at least 250 ms, 700 ms on average, and the lag varies by person. **Cursor position over a distractor is a weak proxy for looking at it.** | Huang, White & Buscher, CHI 2012 — https://jeffhuang.com/papers/GazeCursor_CHI12.pdf |
| Hovers over 2 s and back-and-forth "regressive" movements predict difficulty beyond RT. | Horwitz, Kreuter & Conrad 2017 — https://journals.sagepub.com/doi/abs/10.1177/0894439315626360 |
| Standard trajectory measures: AUC, maximum deviation, x-flips, initiation time | Freeman & Ambady 2010 — https://www.researchgate.net/publication/41452099_MouseTracker_Software_for_studying_real-time_mental_processing_using_a_computer_mouse-tracking_method |
| Repeated layouts are learned implicitly after about 4–5 repetitions (contextual cueing), which speeds search. | Chun & Jiang 1998 — https://www.researchgate.net/publication/13606182_Contextual_Cueing_Implicit_Learning_and_Memory_of_Visual_Context_Guides_Spatial_Attention |
| `prefers-reduced-motion` OS sources: Windows 11 "Animation effects", macOS "Reduce motion", Android "Remove animations", GNOME "Reduced animation", KDE "Animation speed: Instant" | MDN — https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion |
| Many users do not know the setting exists | https://www.smashingmagazine.com/2021/10/respecting-users-motion-preferences/ |
| No public prevalence figure was found for the share of users with reduce-motion enabled. **Measure it in our own telemetry-free pilot.** | — |

---

## 3. The core psychometric problem: short within-subject difference scores

### 3.1 What the literature says

- **Reliability paradox.** Robust group effects give unreliable individual scores. Test-retest ICCs three weeks apart: flanker RT cost **.40 and .57**, Stroop RT cost **.60 and .66**. The congruent and incongruent RTs themselves were far more reliable (for example .74 and .66); subtraction destroys reliability. (Hedge, Powell & Sumner 2018 — https://link.springer.com/article/10.3758/s13428-017-0935-1)
- **Trial noise dominates.** The ratio of true between-person SD to trial SD is about **1:8, up to 1:11**, for inhibition tasks. Reliability depends on trials per person, and adding people does not help. (Rouder, Kumar & Haaf 2023 — https://link.springer.com/article/10.3758/s13423-023-02293-3 ; Rouder & Haaf 2019 — https://link.springer.com/article/10.3758/s13423-018-1558-y)
- **Remedies:** hierarchical (shrinkage) estimation, more trials, and tasks redesigned to widen between-person spread. Kucina et al. added trials and gamification (https://www.nature.com/articles/s41467-023-37777-2).
- **Attentional capture is moderately stable**; distractor suppression is not (https://pubmed.ncbi.nlm.nih.gov/30081374/ ; https://pubmed.ncbi.nlm.nih.gov/37491558/).

### 3.2 Modelled reliability for our tasks

Let σ_w be the within-person trial SD of log search time, τ the true between-person SD of the effect (in log units), and L the number of trials on each side of the contrast.

- SE(Δ) = σ_w·√(2/L)
- Reliability ρ = τ² / (τ² + SE²)
- Minimum detectable individual effect (95%) = exp(1.96·SE) − 1

**Modelled** values (σ_w and τ are assumptions pending pilot data):

| σ_w | τ | L per side | SE | Min detectable slowdown | ρ |
|---|---|---|---|---|---|
| 0.30 | 0.12 | 6 (core, 2×2 main effect) | 0.173 | **+40%** | **0.32** |
| 0.45 | 0.12 | 6 (heterogeneous items) | 0.260 | +66% | 0.18 |
| 0.25 | 0.12 | 6 (well-yoked items) | 0.144 | +33% | 0.41 |
| 0.30 | 0.12 | 12 | 0.122 | +27% | 0.49 |
| 0.30 | 0.12 | 24 (tune-up) | 0.087 | +18% | 0.66 |
| 0.30 | 0.20 | 6 | 0.173 | +40% | 0.57 |

For reading, assuming a per-passage log-WPM SD within person of 0.15–0.20: one passage per condition can only detect differences of **+52% to +74%**; two per side, +34% to +48%. **Conclusion:** in the core module, reading behavior is demonstration and context for the preference question, not a measurement.

For comparison, a classic flanker with γ = 1/8 needs about **240 trials per condition** to reach ρ ≈ .65. This confirms that flanker principles belong in realistic UI trials, not as a standalone score.

### 3.3 Design levers that actually move reliability

1. **Yoke items across conditions.** Each clean/busy pair and each still/animated pair shares target label type, target size and position class (mirrored layout). Item difficulty then cancels in the difference, which lowers σ_w. This is the biggest lever available in a fixed time budget.
2. **Use many short trials rather than few long ones.** Mock pages with 2–3 s trials give 12 trials in about 30 s.
3. **Use a factorial design.** A 2×2 clutter × motion design uses all 12 trials for **each** main effect (6 vs 6), rather than 3 vs 3 in separate one-factor blocks.
4. **Compute on log search time and subtract predicted movement time.** With a log ratio, baseline slowness from age or motor limits scales out. Yoked targets make the additive Fitts time identical across conditions, and subtracting it (search time = RT − MT_pred) keeps the ratio from being compressed.
5. **Counterbalance practice.** Split the 12 trials into 3 mini-blocks of 4, each containing every condition once, with order following a balanced Latin square across users. ABBA-style balance within the person cancels linear practice. Discard trial 0 (practice). Include trial index as a covariate if the fit is stable.
6. **Prevent layout learning.** Never show the same layout, mirror and target more than twice. Contextual cueing appears after 4–5 repetitions (Chun & Jiang).
7. **Use hierarchical shrinkage, not raw scores.** Posterior mean = w·Δ_obs + (1 − w)·μ_pop, with w = τ²/(τ² + SE²). With ρ ≈ .3, a person's raw effect is pulled about 70% toward the population mean. This is correct behaviour, and the reported confidence must say so.
8. **Stop adaptively (tune-up only).** If a dimension's posterior probability of exceeding its decision threshold lies between .35 and .65, offer "20 more seconds to sharpen this?" and add yoked trials only for that contrast.
9. **Combine several weak indicators per dimension** (§6). Averaging k independent indicators of the same construct raises reliability roughly as Spearman-Brown predicts, provided they share the construct.
10. **Get the load context right.** Keep perceptual load low to moderate and working-memory load realistic ("remember what you're looking for"). High-load tasks mask distractor costs (Lavie 2005; Zhang 2000).

### 3.4 Other validity threats

- **Novelty and habituation.** The first exposure to a carousel captures more than the tenth (Turatto). Onboarding cost is an upper-end estimate, and the extension's outcome data should dominate over time.
- **Demand characteristics in preference.** Words like "calm" prime the answer. Label versions neutrally ("Version 1 / Version 2"), randomize sides, and ask task-anchored questions ("Which would you rather shop on?").
- **Fatigue and order across modules.** This module runs last, after vision and motor. Keep all copy identical across users, and record module order for pilot analysis.
- **Invalid trials.** Discard a trial on `visibilitychange` or window blur, when RT exceeds 12 s (timeout), or when it lies more than 3 MAD from the person's median. If more than 4 of 12 trials are invalid, mark behavior as "no evidence", not "no effect".
- **Touch devices** have no hover, so cursor metrics are skipped under `(pointer: coarse)`.
- **Screen-reader users.** The visual clutter tasks do not apply. Offer to skip; skipping records "no evidence".

---

## 4. Concrete battery (about 83 s core + optional 3 min tune-up)

### 4.0 Pre-flight (0 s, silent)

- **Read media and device state:** `matchMedia('(prefers-reduced-motion: reduce)')`, `(prefers-contrast: more)`, `(pointer: coarse)`, `(any-hover: hover)`, viewport size and DPR.
- **Import from earlier modules:** text scale and contrast from vision; Fitts a, b from motor.
- **If reduced motion is on**, show a 3 s card: "Your device asks apps to keep motion to a minimum. We'll keep everything still." Record a confirmed motion prior (§6). **Swap the motion factor for a static-salience factor** (a bright static ad block present vs absent). This keeps distraction sensitivity measurable without motion.
- **Framing card (4 s):** "Three quick everyday tasks. We're testing pages, not you. Go at your normal pace."

### 4.1 Task A "Find it" (about 30 s): clutter × motion search

- **Canvas.** Virtual 1200×750 CSS px, scaled to fit, rendered by our React code from a seeded generator. Four templates: store home, product list, news front, account page. Each has a clean and a busy variant and L/R mirrors.
- **Prompt.** A pinned bar reads "Find: Gift cards". The target is a text link or button with an exact label. Its style matches its siblings (no pop-out), so search is conjunction-like and serial.
- **Design.** 1 practice trial (clean, still), then 12 scored trials = 2 clutter × 2 motion × 3. Three mini-blocks of 4 (each condition once), in Latin-square order across users. Target positions are stratified top/middle/bottom, so each condition gets one of each.
- **Clutter manipulation.** Keep the **number of candidate links equal** across variants. Clutter alone is manipulated, not set size: promo tiles, badges, borders, colour variety, image blocks and sidebars. This matches what the "reduced density" and "dimming" adaptations actually remove. Validate offline with the Rosenholtz code or AIM (**proposal**): busy variants at least 1 SD above clean on subband entropy and feature congestion, and roughly at the top-500 sites' 80th vs 20th percentile. Target local contrast and size stay constant.
- **Motion manipulation.** Two of three sources are active:
  - an auto-advancing carousel (400 ms slide every 3 s, first advance at a random 500–1500 ms, so there is an onset during search);
  - a ticker at about 40 px/s;
  - a pulsing "LIVE" badge at 1 Hz, scale 1.00 to 1.08.
  - Constraints: ≤ 3 Hz, no flashing, total moving area ≤ 15% of the canvas, no parallax, zoom or scroll-linked motion. The persistent "Stop motion" button ends all motion trials, and the rest of the trials run still.
- **Response.** Click the target. A wrong click gives neutral feedback ("Not that one") and the trial continues. Timeout at 12 s, then reveal the target and move on.
- **Timing.** Onset = `performance.now()` at the first `requestAnimationFrame` after paint. Record RT to the correct click and the first-click correctness.
- **Measures:** log search time (RT − MT_pred), first-click error, and cursor features as low-weight secondaries: path efficiency, x-flips, pauses ≥ 500 ms, hovers ≥ 2 s on non-targets, and cursor dwell inside the motion region (a weak gaze proxy per Huang 2012).

### 4.2 Task B "What's next?" (about 12 s): hierarchy and decoy competition

- **Four mini-flows:** checkout, sign-up form, settings save, and multi-page article. The **goal is stated without the target's label** ("You've picked your items. Go to payment."), and the correct control uses a synonym ("Proceed"). This measures inference of the next action, not label matching.
- **Design.** 2 hierarchy conditions × 2 repetitions:
  - **Weak:** all buttons have equal visual weight, plus a salient primary-styled decoy ("Get the app", "Upgrade") **adjacent** to the correct control. This is the flanker-incompatible analog; proximity maximizes interference per Eriksen & Eriksen.
  - **Strong:** the correct control is primary-styled, and the decoy is de-emphasized and spaced away.
  - Order is counterbalanced and flows are rotated across conditions between users.
- **Measures:** decoy capture (first click on the decoy), other first-click errors, log time to first click, and hesitation (hover ≥ 2 s; regressive movement between two candidates, per Horwitz 2017).

### 4.3 Task C "Find in text" (about 22 s): dense vs chunked

- **Two trials.** Each is a passage of about 120 words in plain language on a neutral topic (bike-rental rules, library policy), with a question above it ("How long can you keep a bike?"). The user clicks the sentence that answers it; there is a fallback 3-option choice for keyboard or touch users.
- **Formats.**
  - **Dense:** one paragraph, about 90–100 characters per line, no headings.
  - **Chunked:** heading, 3 short paragraphs or bullets, about 60 characters per line, key term bolded. This is signaling plus segmenting (Schneider 2018; Rey 2019).
  - The passage-to-format pairing and order are Latin-squared across users.
- **Measures:** log locate time, correctness, scroll-backs, and re-reads (cursor or selection returning to an earlier line).
- **Weight.** Behavioral weight is low (1 vs 1; §3.2). The task exists so the dense/chunked preference is **post-use**, and so the results screen can show the person's own before/after.

### 4.4 Task D "Which worked better for you?" (about 15 s)

- **Four post-use pairs**, shown as thumbnails of the exact pages just used. Sides are randomized, versions are labelled "Version 1 / 2", and responses use a 5-point bipolar scale (−2..+2):
  1. Still vs animated: "Which was easier to focus on?" Skipped under reduced motion; the static-salience pair is used instead.
  2. Clean vs busy: "Which would you rather shop on?"
  3. Dense vs chunked: "Which was easier to find things in?"
  4. Weak vs strong hierarchy: "Which made the next step clearer?"
- **Chip question (3 s, multi-select, optional):** "Did anything get in your way?" with the options [moving things] [too much on screen] [long blocks of text] [hard to tell what to click] [nothing]. Direct functional self-report, no clinical language.
- **No separate SEQ or TLX in the core.** Comparative judgments are more precise per second (Mantiuk 2012) and track workload (Hertzum 2025). An SEQ can be added in the tune-up.

### 4.5 Time budget

| Step | Seconds |
|---|---|
| Framing and pre-flight | 4 (+3 if reduced motion) |
| A: 1 practice + 12 search | ~30 |
| B: 4 next-action | ~12 |
| C: 2 find-in-text | ~22 |
| D: 4 pairs + chips | ~15 |
| **Total** | **~83–86** |

If the time budget must shrink to 60 s, cut C to 1 passage in the chunked format only. The dense/chunked preference then comes from a side-by-side view without behavior. Protect A's 12 trials above all else.

### 4.6 Optional tune-up (about 3 min, offered at the results screen, in settings, or at recalibration when a posterior is ambiguous)

- **A2:** 24 more yoked search trials, taking each cell to 9. Adds a **static-salience** condition to separate motion from mere salience, and a **decoy spacing** variant (adjacent vs far).
- **C2:** reading comprehension, 4 passages of about 150 words (2 with an animated sidebar, 2 calm), with 2 multiple-choice questions each. Measures WPM and accuracy. This is the direct "reading with vs without motion" test; expected group effect is small to moderate (the within-subject distraction analog is g ≈ −0.32; Vital 2022).
- **Try-ons (preference only):** reading ruler (Grey Bar / Underline), line focus, width 55 vs 80 characters per line, and focus mode. Each is a 2-second A/B.
- **Workload:** Paas 9-point effort after each block (≈2 s each).

---

## 5. Derivations (deterministic client code; no model involved)

Per trial t (valid only):

```
MT_pred   = a + b * log2(D / W + 1)        // Fitts, from motor module; else 0
ST_t      = max(RT_t - MT_pred, 0.2 s)
y_t       = ln(ST_t)
```

**Task A.** Fit per person y ~ clutter + motion (+ trial_index if stable), or use cell means:

```
Δ_clutter = mean(y | busy) - mean(y | clean)        // log ratio, averaged over motion
Δ_motion  = mean(y | animated) - mean(y | still)    // averaged over clutter
E_clutter = err_rate(busy) - err_rate(clean)        // first-click errors
SE(Δ)     = s_w * sqrt(1/n_1 + 1/n_2)               // s_w pooled within-cell SD, floored at pilot σ_w
```

**Task B:**

```
Δ_guidance = mean(y | weak) - mean(y | strong)
Capture    = P(first click = decoy | weak)
```

**Task C:**

```
Δ_chunk = ln(t_dense) - ln(t_chunked); accuracy difference.
```

**Preferences.** Map the response r ∈ {−2..2}, oriented so that positive = favours the adapted version, to an evidence value on the latent scale through an ordinal (probit) link, calibrated in the pilot. Store the raw r as well.

**Shrinkage** (per dimension, per indicator j):

```
posterior precision = 1/σ0² + Σ_j 1/SE_j²
posterior mean      = (μ0/σ0² + Σ_j λ_j·x_j/SE_j²) / posterior precision
```

- x_j is each indicator (Δ, capture, preference).
- λ_j is the loading onto the dimension, from the pilot.
- μ0 and σ0 are the population prior, adjusted by OS flags.
- The pilot supplies σ_w, τ, the λ_j and the preference link. Until then, use the §3.2 assumptions and **cap every behavior-only confidence at "low"**.

**Confidence label** = 1 − posterior_sd / prior_sd, banded as <0.25 low, 0.25–0.5 medium, >0.5 high (**proposal**).

**Result copy example:** "Moving content slowed your searches by about 25% (we're fairly unsure: 1 short test). You preferred the still version." Show a range, never a percentile.

---

## 6. Mapping to profile dimensions

Each dimension is stored as `{mean, sd, confidence, sources[], updatedAt}` on a benefit scale: the expected proportional benefit of the matching adaptation. The whole profile fits well under the 8 KB budget.

| Dimension (functional definition) | Indicators and relative weight (proposal) | Adaptations driven | Default rule (cost-weighted, proposal) |
|---|---|---|---|
| **Motion sensitivity**: how much moving or auto-advancing content costs this person in speed or comfort | OS reduced-motion confirmed (strong prior: sets μ0 high, σ0 small); "Stop motion" pressed (strong); motion preference pair (medium); Δ_motion (low–medium); chip "moving things" (medium) | Pause autoplay, carousels, marquees and GIF-like loops; reduce transitions. Keep functional motion such as progress indicators. | False positives are cheap. **Default ON at P(benefit) ≥ 0.35**, always with visible undo. |
| **Distraction sensitivity**: cost of irrelevant salient content competing with the task, static or moving | Decoy capture (B); Δ_motion and the static-salience contrast (tune-up); Δ_clutter partial loading; busy-vs-clean preference; chip "too much on screen" | Dim distracting regions; focus mode | Hiding content can orphan help (WCAG 3.2.6) and disorient. **OFFER by default; default-on only at P ≥ 0.8** and when the page-level region classifier is confident. |
| **Density tolerance** (inverse): how much global clutter slows this person or feels worse | Δ_clutter (medium), clean-vs-busy preference (medium–high; Baughan: preference predicts harm), chip | Reduced visual density, spacing, reading width | Presentation-only and reversible. **Default ON at P ≥ 0.6**. |
| **Chunking preference**: benefit from segmented, signaled text | Dense-vs-chunked preference (high), Δ_chunk (low), chip "long blocks of text", tune-up C2 | Visual chunking of long passages (paragraph breaks, headings emphasis; **no rewriting**); reading ruler and line focus offered | **OFFER.** Visual chunking may default on at P ≥ 0.7. Any LLM text rewriting is never default. |
| **Guidance preference**: benefit from explicit emphasis of the likely next action | Δ_guidance, decoy capture, hierarchy preference, chip "hard to tell what to click" | Next-action emphasis, hierarchy clarification | An inaccurate emphasis is worse than none (Gajos 2008). **Default ON only if P ≥ 0.6 and** the page-level confidence in the primary action is high; otherwise offer. |

**Combining behavior and preference (four quadrants):**

- **Both favour the adaptation:** high confidence; apply the dimension's default rule.
- **Preference yes, behavior null:** comfort is a legitimate goal, and workload predicts preference (Hertzum). Default on for cheap adaptations such as motion and density; offer for the rest.
- **Behavior yes, preference no:** this is the 25% dissociation case (Nielsen & Levy). **Offer, never impose.** Show the person's own evidence ("you found items faster on the simpler page") and let them decide.
- **Neither:** off. Leave it discoverable in the popup.

**Priors:** population μ0 and σ0 come from the pilot. OS reduced motion shifts motion-sensitivity μ0 up with small σ0. Windows' "Animation effects" is a general visual-effects toggle and may be off for reasons unrelated to comfort (unverified). Hence the confirmation card rather than silent acceptance.

---

## 7. Hand-off to in-the-wild learning (where most of the estimation happens)

- **Outcome signals** (aggregate, on-device): each applied adaptation logs `kept` / `undone within 10 s` / `toggled later`. Where possible it also logs a lightweight within-person comparison, such as time-to-first-meaningful-click or scroll-back rate on comparable pages with and without the adaptation. Behavioral friction signals (hover ≥ 2 s, regressive movement, rage clicks) trigger **offers**, never silent changes. There is no field-validated accuracy for web struggle detection (Evidence Base §9).
- **Update rule:** the same conjugate update as §5. Each keep or undo is an observation with its own SE, so after about 20 page-level outcomes the onboarding contribution is naturally diluted.
- **Recalibration triggers:** repeated undo of a default-on adaptation (for example ≥ 3 of the last 5); user request; 90 days elapsed.

---

## 8. Validation plan (before claiming anything)

1. **Pilot, n ≈ 30–40.** Run the core module twice in the same session (split-half) and again 1 week later. Estimate σ_w, τ, ICC for each Δ, preference test-retest, and the λ loadings. Kill criterion (**proposal**): if Task A's 1-week ICC for a Δ is below .20, set that indicator's weight to zero and rely on preference plus in-the-wild data.
2. **Manipulation check.** Busy mock pages must reproduce a group-level slowdown of the size literature reports (Baughan d ≈ 0.5–0.96). Animated trials must show a group-level cost. If they don't, the stimuli are too weak or too hard (load masking).
3. **Criterion validity.** On a held-out set of realistic mock tasks, does the calibrated profile's adaptation choice beat (a) no adaptation and (b) a one-size default on time, errors and preference? Within-subjects power: about 21–27 participants to detect a 10-point SUS-style difference (Evidence Base §10).
4. **Ethics.** IRB review before any recruitment (Evidence Base §10). Do not recruit on diagnosis; recruit on self-described functional experience ("websites with a lot going on are hard for me").

---

## 9. Evidence gaps (do not assert)

- No randomized evidence that motion removal, focus mode or dimming improves web task performance for people with attention-regulation needs specifically. Evidence is general-population, or covers ads and backgrounds.
- No evidence that reading rulers or line focus help beyond dyslexia.
- No published test-retest reliability for any web-page-level distraction cost or clutter cost. Our §3.2 table is modelled.
- No public prevalence of `prefers-reduced-motion: reduce`.
- No data on pairwise UI-preference test-retest reliability in a 90 s onboarding context.

---

## 10. Source list

- Shen 2025, distraction in digital reading meta-analysis — https://pmc.ncbi.nlm.nih.gov/articles/PMC12684101/ ; https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2025.1671214/full
- Simola et al. 2011 — https://eric.ed.gov/?id=EJ934193
- Vital, van der Baan, Stenberg & Sandnes 2022 — https://link.springer.com/chapter/10.1007/978-3-031-05028-2_10
- Burke et al. 2005 — https://dl.acm.org/doi/10.1145/1121112.1121116
- Zhang 2000 — https://aisel.aisnet.org/jais/vol1/iss1/1/
- Hong, Thong & Tam 2004 — https://pubsonline.informs.org/doi/10.1287/isre.1040.0017
- Burge & Jang 2026 — https://www.iadisportal.org/ijwi/papers/2026240105.pdf
- Abrams & Christ 2003 — https://doi.org/10.1111/1467-9280.01458
- Turatto et al., habituation of capture — https://link.springer.com/article/10.3758/s13423-017-1320-x ; https://link.springer.com/article/10.3758/s13423-022-02204-y
- Bailey & Konstan 2006 — https://www.sciencedirect.com/science/article/pii/S074756320500107X
- Lavie 2005 — https://labs.wsu.edu/attention-perception-performance/documents/2016/05/attentional-load-review_lavie_05.pdf/
- Eriksen & Eriksen 1974 — https://link.springer.com/article/10.3758/BF03203267
- Forster & Lavie 2016 — https://pubmed.ncbi.nlm.nih.gov/26667659/
- Rosenholtz, Li & Nakano 2007 — https://jov.arvojournals.org/article.aspx?articleid=2122001 ; https://persci.mit.edu/research/clutter/
- Oulasvirta et al. 2018 (AIM) — https://interfacemetrics.aalto.fi/static/publications/oulasvirta_et_al_2018.pdf
- Baughan et al. 2020 — https://par.nsf.gov/servlets/purl/10156432
- Reinecke & Gajos 2014 — https://www.eecs.harvard.edu/~kgajos/papers/2014/reinecke14visual.shtml
- Tuch et al. 2009 — https://www.sciencedirect.com/science/article/abs/pii/S107158190900055X
- Michailidou, Harper & Bechhofer — https://www.researchgate.net/publication/262352111_Analysing_the_visual_complexity_of_web_pages_using_document_structure
- Morkes & Nielsen 1997 — https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/
- Rey et al. 2019 — https://link.springer.com/article/10.1007/s10648-018-9456-4
- Schneider et al. 2018 — https://www.sciencedirect.com/science/article/abs/pii/S1747938X17300581
- Niklaus et al. 2023 (reading rulers) — https://dl.acm.org/doi/10.1145/3544548.3581367
- Dyson & Haselgrove 2001 — https://www.sciencedirect.com/science/article/abs/pii/S1071581901904586
- Brysbaert 2019 — https://www.sciencedirect.com/science/article/abs/pii/S0749596X19300786
- Kadner et al. 2021 (AdaptiFont) — https://dl.acm.org/doi/fullHtml/10.1145/3411764.3445140
- First-click (Bailey & Wolfson, secondary) — https://www.optimalworkshop.com/blog/correct-first-click-lead-to-3x-higher-task-success
- PageGuide — https://arxiv.org/abs/2604.23772
- W3C COGA patterns — https://www.w3.org/WAI/WCAG2/supplemental/patterns/o2p01-site-important/ ; https://www.w3.org/WAI/WCAG2/supplemental/patterns/o5p01-minimal-interruptions/
- Gajos et al. 2008 — https://www.eecs.harvard.edu/~kgajos/papers/2008/gajos08predictability.shtml
- SEQ — https://measuringu.com/seq10/ ; https://measuringu.com/how-the-seq-correlates-with-other-task-metrics/
- Paas scale — https://www.researchgate.net/publication/15390085_Measurement_of_Cognitive_Load_in_Instructional_Research
- Hart 2006 — https://journals.sagepub.com/doi/10.1177/154193120605000909
- Mantiuk et al. 2012 — https://www.cl.cam.ac.uk/~rkm38/pdfs/mantiuk12cfms.pdf
- Nielsen & Levy 1994 — https://dl.acm.org/doi/10.1145/175276.175282
- Andre & Wickens 1995 — https://journals.sagepub.com/doi/10.1177/106480469500300403
- Hertzum 2025 — https://mortenhertzum.dk/publ/IJHCS2025.pdf
- Hedge, Powell & Sumner 2018 — https://link.springer.com/article/10.3758/s13428-017-0935-1
- Rouder & Haaf 2019 — https://link.springer.com/article/10.3758/s13423-018-1558-y
- Rouder, Kumar & Haaf 2023 — https://link.springer.com/article/10.3758/s13423-023-02293-3
- Kucina et al. 2023 — https://www.nature.com/articles/s41467-023-37777-2
- Capture reliability — https://pubmed.ncbi.nlm.nih.gov/30081374/ ; https://pubmed.ncbi.nlm.nih.gov/37491558/
- Chun & Jiang 1998 — https://www.researchgate.net/publication/13606182_Contextual_Cueing_Implicit_Learning_and_Memory_of_Visual_Context_Guides_Spatial_Attention
- Anwyl-Irvine et al. 2021 — https://link.springer.com/article/10.3758/s13428-020-01501-5
- Huang, White & Buscher 2012 — https://jeffhuang.com/papers/GazeCursor_CHI12.pdf
- Horwitz, Kreuter & Conrad 2017 — https://journals.sagepub.com/doi/abs/10.1177/0894439315626360
- Freeman & Ambady 2010 — https://www.researchgate.net/publication/41452099_MouseTracker_Software_for_studying_real-time_mental_processing_using_a_computer_mouse-tracking_method
- prefers-reduced-motion — https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion ; https://www.smashingmagazine.com/2021/10/respecting-users-motion-preferences/
- WCAG 2.3.3, 2.2.2, 2.3.1 — https://w3c.github.io/wcag21/understanding/animation-from-interactions.html ; https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html ; https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
- FocusView (ADHD, formative) — https://arxiv.org/html/2507.13309
