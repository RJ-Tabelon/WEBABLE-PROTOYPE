# WebAble calibration: low vision and reduced contrast sensitivity

Research report for the onboarding calibration module (functional group b). Date: 2026-09-28.
Scope: a web-delivered calibration of about 60–90 s. It has to run on uncalibrated consumer screens at an unknown viewing distance, must not feel clinical, and must stay usable by people with low vision. Output: profile parameters with confidence values. Each parameter is a functional setting. None is a diagnosis.

Evidence tags: **[S]** means directly supported by a cited source. **[I]** means our inference or engineering judgement. **[C]** means computed here (the scripts are reproducible and the formulas are given inline).

---

## 0. TL;DR: decisions

1. **Measure one thing well: text size.** Use an MNREAD-style adaptive reading ladder of short true/false sentences read silently, descending in 0.1–0.2 log steps and seeded by a "make this comfortable" control. It yields critical print size (CPS) and a relative maximum reading speed (MRS) in about 30–40 s. CPS is the only low-vision parameter that a short web task measures reliably and that maps directly to an adaptation. MNREAD CPS test–retest in normal adults is about 0.12 logMAR [S: Subramanian & Pardhan 2006].
2. **Store size as an x-height in effective CSS px, measured in the user's habitual posture. Do not store angular acuity.** The CSS reference pixel is designed as an angular unit (0.0213°). At typical distances, real devices land at 1.2–1.8 arcmin/px, a ±0.08 log spread [C]. Viewing distance within a single device class varies about ±0.25 log (phones held at 19–60 cm) [S: Bababekova 2011]. Apply the size per font through `font-size-adjust` (ex-height), which Chrome supports from version 127 [S].
3. **The minimum text size is CPS + 0.1 log (×1.26).** It is only ever a floor: never shrink text. For most sighted users the floor falls below 16 px on a laptop, so size adaptation does nothing for them, which is correct [C]. On average, self-chosen "comfortable" size ≈ CPS (mean difference 0.05 logMAR) but with limits of agreement of ±0.35 log [S: Latham & Macnaughton 2022]. It works as a seed for the ladder and does not replace it.
4. **Absolute contrast thresholds from uncalibrated screens are soft.** 8-bit quantization, the gamma spread (1.8–2.6), brightness, glare, night modes and forced colors together contribute roughly ±0.1 log or more of display uncertainty on top of about 0.13 log of measurement noise [C]. Only use banded, cost-asymmetric decisions. Never measure contrast in dark polarity.
5. **The choice between WCAG 4.5:1 and 7:1 is psychophysically tiny.** Under WCAG's flare model, 4.5:1 ↔ 77.8% and 7:1 ↔ 85.7% effective Weber contrast, a gap of only 0.04 log. The entire span from 4.5:1 to 21:1 is 0.09 log, which is less than one Pelli-Robson triplet (0.15) [C]. The contrast floor matters mostly for sub-AA gray text, which is common on the web. For contrast-limited readers, the larger levers are size margin, font weight, polarity and brightness/glare [S: Legge 2016; Whittaker & Lovie-Kitchin 1993].
6. **Contrast decision rule.** Required text contrast = contrast reserve R = 10 × threshold [S: Whittaker & Lovie-Kitchin: 10:1 reserve for about 174 wpm]. Converted to a WCAG ratio, this gives three bands: floor 4.5 (threshold ≤ 3% Weber), floor 7 (3–9%), and "max contrast + weight + polarity offer" (> 9%) [C].
7. **Polarity is a minority, measurable effect.** A subset of low-vision readers, usually those with light scatter, read 10–50% faster white-on-black [S: Legge 2016; Rubin & Legge 1989: 5/19]. Normal vision shows a small positive-polarity advantage that grows as text gets smaller [S: Piepenbrock 2014]. Test polarity with 2+2 sentences near CPS and combine the result with stated preference and `prefers-color-scheme`. Confidence is low to moderate, so polarity should keep being learned after onboarding.
8. **Don't calibrate letter spacing.** Extra letter spacing is null or harmful for normal central vision, peripheral vision and central-vision loss [S: Chung 2002, 2012; Yu 2007; Legge 2016]. Line and word spacing may help some readers with low vision [S: Blackmore-Wright 2013 +26%/+46%; Chung 2008 null]. Default line-height 1.5; offer 1.8–2.0 plus word-spacing 0.16–0.25 em on the large-print path.
9. **Line length is a prior, not a measurement.** Cap at 70 ch (range 60–80) [S: Dyson & Haselgrove 2001; WCAG 1.4.8]. For magnified text, enforce the opposite constraint too: at least 13 characters per line (8 for low vision) to reach 80% of MRS [S: Atilgan, Xiong & Legge 2020].
10. **Font weight floor 400 for everyone.** Light and ultra-light weights reduce legibility [S: Burmistrov 2016; Dobres 2016 under poor rendering; Beier & Oderkerk 2019]. Bolder than regular only helps near the acuity limit, and extreme bold hurts [S: Bernard 2013: −23% fovea, −51% periphery at 3× stroke]. Use 500–600 only for contrast-limited users or near-CPS text, never above 700.
11. **Preference ≠ performance** [S: Wallace et al. TOCHI 2022: preferred font did not predict the fastest font, even with size normalized; fastest vs slowest font differed by 35%]. The profile records measured, stated and user-override values separately. The user's explicit override wins for authority, but measured values drive defaults.
12. **Budget: about 75 s**, spread over 5 screens and 20–24 trials, with a 90 s hard cap. Font family, spacing and line length are not tested at onboarding. They are learned later through offers.

---

## 1. Constraints that shape the design

| Constraint | Consequence |
|---|---|
| 60–90 s total for this group | At most about 25 trials. Classic staircases (30–50 trials) and qReading (225 trials) are out [S: Hou 2018]. Use Bayesian placement plus strong priors, and descending method-of-limits for the speed-vs-size ladder. |
| Uncalibrated screen, unknown distance | Measure in habitual posture and store in effective CSS px per device class. Use contrast only in bands. Rely on within-display relative comparisons (polarity, low-vs-high contrast reading). |
| User may have low vision | The first screen starts large (≥ 1.5× browser default) and at 21:1. All layout is in rem/em so it reflows under browser zoom and never blocks zoom (unlike Wallace 2022, which locked zoom; WebAble must meet WCAG 1.4.4/1.4.10). Provide a "Can't read this" response and a skip path. |
| No clinical feel | No letter charts, Sloan letters, "acuity", "score", 20/xx, or "test". Frame it as "Let's tune text for you." Stimuli are ordinary sentences and words. Finish on a live preview of the user's text, not a number. |
| Invariants | Output is functional parameters, never "low vision" or conditions. Adaptations derived at onboarding are shown in the preview and approved there, so they are not behavior-triggered. Post-onboarding refinements are offered and never imposed. The verifier checks contrast, clipping and reflow after each apply. |
| Privacy | Per-trial data stays on the device. The server gets derived parameters, confidences, device class and calibration version only. |

---

## 2. Evidence base

### 2.1 MNREAD: reading acuity, critical print size, maximum reading speed

- **Construct.** Reading speed versus print size (log-log) rises steeply from the reading acuity (RA) to the **critical print size (CPS)** and then plateaus at the **maximum reading speed (MRS)** [S: MNREAD history](https://mnread.umn.edu/history). The MNREAD precursor is the Minnesota Low-Vision Reading Test [S: Legge et al. 1989](https://legge.psych.umn.edu/sites/legge.psych.umn.edu/files/files/media/legge89_psychophysics_of_reading._viii._the_minnesota_low-vision_reading_test.pdf). The chart uses sentences of 60 characters, sizes in 0.1 logMAR steps, and print size defined by x-height (logMAR 0 at 40 cm ≈ 5 arcmin x-height) [S/I].
- **Norms.** In 645 normally sighted people aged 8–81, CPS was flat at 0.08 logMAR (about 6 arcmin x-height) from 8 to 23 years. It rose to 0.21 logMAR by age 68 and to 0.34 logMAR by 81 [S: Calabrèse et al. 2016 IOVS](https://iovs.arvojournals.org/article.aspx?articleid=2537421). Vision-science reviews put normal CPS at about 0.2° x-height, with a "fluent range" of 0.2°–2° [S: Legge & Bigelow 2011](https://jov.arvojournals.org/article.aspx?articleid=2191906); [Atilgan et al. 2020](https://www.pnas.org/doi/10.1073/pnas.2007514117). Reading is fastest (about 350 wpm, RSVP) at 0.25°–2° letters [S: Legge, Rubin & Luebker 1987].
- **Scoring algorithms.**
  - *Standard.* The plateau is the range of sizes read significantly faster (1.96 SD) than sizes outside it. MRS is the mean on the plateau and CPS is the smallest plateau size [S: mnreadR docs](https://rdrr.io/cran/mnreadR/man/mnreadCurve.html).
  - *Parametric* [S: Cheung, Kallie, Legge & Cheong 2008 IOVS](https://iovs.arvojournals.org/article.aspx?articleid=2164115). Two-limb fit: `f(x) = θ1 − e^θ2 (θ3 − x)` for x < θ3, and θ1 otherwise, with x in logMAR and f in log wpm. Exponential-decay fit: `g(x) = φ1 (1 − e^k)`, `k = −e^φ2 (x − φ3)`. The exponential-decay function fit slightly better. CPS_ED at 80% of MRS is the recommended compromise (slope ≈ 1 versus CPS_TL). The NLME approach recovers truncated data sets, which matters for us because our ladders are short. mnreadR's NLME default is CPS at 90% of MRS, adjustable from 75% to 95% [S](https://rdrr.io/cran/mnreadR/man/nlmeParam.html).
- **Reliability.** CPS coefficient of repeatability is about 0.12 logMAR in normal adults [S: Subramanian & Pardhan 2006](https://www.researchgate.net/publication/6878621_The_Repeatability_of_MNREAD_Acuity_Charts_and_Variability_at_Different_Test_Distances).
- **Digital version.** With 165 normally sighted and 43 low-vision participants, the MNREAD iPad app agreed with the chart on CPS and RA but gave **slower MRS** [S: Calabrèse et al. 2018 J Vis](https://jov.arvojournals.org/article.aspx?articleid=2670382). Lesson: speed levels are medium-dependent, so use them only within a person [I].
- **Fonts.** A fixed-width font (Courier) gave 0.06 logMAR smaller CPS and 0.05–0.09 better RA than Times, but MRS was 5% slower for normal readers [S: Mansfield, Legge & Bane 1996](https://iovs.arvojournals.org/article.aspx?articleid=2161324). The font the CPS is measured in therefore matters. Use a *typical* sans, not a "hyperlegible" one, or the floor will be too small for real sites [I].
- **Self-chosen comfort size.** In 47 low-vision patients, "comfortable" print size ≈ CPS on average (mean difference 0.05 logMAR, SD 0.18), with 95% limits of agreement of ±0.35 logMAR [S: Latham & Macnaughton 2022 OPO](https://onlinelibrary.wiley.com/doi/10.1111/opo.12946). That makes it a good prior or seed (5–8 s) but too loose on its own, since ±0.35 log is a factor of 2.2.
- **Acuity and contrast reserve.** Fluent reading needs print 2–8× the acuity threshold, and text contrast 10× the contrast threshold for about 174 wpm (4× gives about 88 wpm, 3× gives spot reading at about 44 wpm) [S: Whittaker & Lovie-Kitchin 1993, summarized in](https://pmc.ncbi.nlm.nih.gov/articles/PMC3974292/).
- **Adaptive reading function.** qReading uses a Bayesian adaptive design over a 3-parameter exponential-decay reading function, with lexical-decision trials. After 225 trials it reaches 0.109 log inter-run SD [S: Hou et al. 2018 J Vis](https://pmc.ncbi.nlm.nih.gov/articles/PMC6133446/). That is far too long for us, but **its parametric model and priors are the right way to regularize our sparse 7–10-point ladder** [I].

### 2.2 Web adaptation of MNREAD and online reading-speed pitfalls

**Silent sentence verification replaces reading aloud.** No examiner is present and speech recognition is unreliable for dysarthric or non-native speech. ROAR-SRE, a validated unproctored online silent reading task, uses simple true/false sentences. Its design principles: minimal vocabulary, unambiguous answers, items dropped if rater agreement is below 85%, and invalid sessions flagged at <65% correct or median RT <1 s or >20 s. Parallel-form r is 0.88–0.89 (0.79–0.80 for a 60 s form). Correlation with standardized tests is r = 0.82–0.91 [S: Yeatman et al. 2024](https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2024.1494431/full); see also [Yeatman et al. 2021](https://www.nature.com/articles/s41598-021-85907-x). The Virtual Readability Lab measured WPM from render to button press, disabled the button for 2 s, and kept only 100–650 WPM per screen [S: Wallace 2022].

| Pitfall | Mechanism | Mitigation |
|---|---|---|
| Unknown viewing distance | Angular size is unknown. People lean in; phone web viewing is 32 cm on average (range 19–60) [S: Bababekova 2011](https://journals.lww.com/optvissci/Fulltext/2011/07000/Font_Size_and_Viewing_Distance_of_Handheld_Smart.5.aspx) | Measure *functional* size in habitual posture and store in CSS px per device class. The virtual chinrest (blind spot plus card, 3.25 cm mean error [S: Li et al. 2020](https://www.nature.com/articles/s41598-019-57204-1)) costs 30–60 s and a card. Reserve it for an optional "precise mode". |
| Browser zoom / pinch zoom / OS scaling | CSS px ≠ rendered px | Record `devicePixelRatio`, `visualViewport.scale` and `innerWidth` per trial. Invalidate a trial if DPR changes mid-trial. At extension handoff, read `chrome.tabs.getZoom` on the WebAble tab to get the calibration-origin zoom Z_cal ([API](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-getZoom)). |
| Browser minimum-font-size setting / OS text scaling | Small stimuli are silently clamped | Measure the **rendered** x-height after paint (canvas `measureText('x').actualBoundingBoxAscent` × scale, or `getBoundingClientRect`). Never trust the requested size. Probe the default font size with an unstyled `1rem` element; a value above 16 px is a strong prior. |
| Webfont not loaded | Metric shift or FOUT during timing | `await document.fonts.ready` and preload the stimulus font. |
| Decision and motor time in RT | Inflates short-sentence time, and more so for motor-impaired users (group a overlap) | wpm = 60·W/(RT − t0), with t0 taken from the motor calibration's simple RT (default 0.6 s, clamped 0.3–1.2 s). Keep words per sentence constant (9–11) so residual bias is multiplicative-constant and does not move CPS [I]. |
| Attention lapses (group c overlap) | A single slow trial at a small size looks like the CPS knee | Require two consistent off-plateau points or one "can't read"/error. Use robust (median-based) MRS. Invalidate trials with `visibilitychange`/blur. |
| Practice and fatigue confounded with descending size | The first trial is slow; later trials are both smaller and later | Discard one practice sentence at a large size. Optionally re-check one plateau size at the end. |
| Guessing (T/F chance = 50%) | Illegible trials still answered "correctly" | Add a third response, "Can't read it". Flag a session under 65% correct as invalid [S: ROAR]. Treat RT − t0 < 0.8 s or > 900 wpm as a skim or guess. |
| Screen width at large sizes | Few characters per line cut MRS below the critical character count (13 normal / 8 low vision at 80% MRS) [S: Atilgan 2020] | Fixed layout in `ch`, 20–24 ch per line when it fits; otherwise allow ≥ 13 ch (≥ 8 on the large-print path). Record chars/line and mark "display-limited". |
| Sentence difficulty, reading level, L2 readers | Speed differences not caused by vision | Build an original pool (≥ 120 items; **do not reuse MNREAD sentences**, which are copyrighted) at grade ≤ 3, 55–60 characters, balanced T/F, validated to ≥ 85% agreement. Randomize the sentence-to-size assignment. Use only within-person relative speed. |
| Silent vs aloud, device medium | Norms don't transfer (iPad MRS < chart) [S: Calabrèse 2018] | Never compare to MNREAD norms or show WPM as a score. |
| Timing precision | Browser RT jitter is tens of ms [S: Wallace 2022 citing browser studies; Anwyl-Irvine et al. 2021](https://doi.org/10.3758/s13428-020-01501-5) | Negligible against 2–10 s reading times. Timestamp onset with rAF after paint. |
| Rendering and antialiasing at small px, low DPR | Thin strokes lose effective contrast | Measure at regular weight (400), record DPR, and apply the weight floor (see 2.7). |
| Lighting | Within the normal indoor range, it has limited influence on legibility for normal vision [S: Wallace 2022 citing Scaltritti]. Glare and low brightness hurt low vision [S: Legge 2016] | Don't instruct users to change brightness; we want habitual conditions. Record a coarse local "day/night" bucket on-device only, to interpret polarity later [I]. |

### 2.3 Contrast sensitivity: principles, web tasks, and why absolute thresholds are soft

- **Pelli-Robson principles** [S: Pelli, Robson & Wilkins 1988](https://www.researchgate.net/publication/243783272_Designing_a_new_letter_chart_for_measuring_contrast_sensitivity). Uses large letters (Sloan, 2.8° at 1 m), so it probes low spatial frequencies away from the acuity limit. Letters come in triplets of equal contrast, contrast falls 0.15 log per triplet (log CS 0–2.25), and the score is the last triplet with ≥ 2/3 correct. Letter-by-letter scoring is reported to improve reliability [I: Elliott et al.; not reviewed here]. Normal values: 1.68–1.84 monocular and 1.73–1.99 binocular across ages [S: Mäntyjärvi & Laitinen 2001](https://pubmed.ncbi.nlm.nih.gov/11226793/). Values below about 1.5 are conventionally treated as reduced [I/common clinical convention].
- **Digital letter-contrast tests work when displays are characterized.** An iPad letter CS test (0.1 log steps from 80% to 0.5%) matched Pelli-Robson repeatability (95% LoA ±0.19) [S: Kollbaum et al. 2014](https://journals.lww.com/optvissci/abstract/2014/03000/validation_of_an_ipad_test_of_letter_contrast.8.aspx). That was one known device model. Psychophysical display calibration without a photometer is possible but takes minutes of matching tasks [S: To, Woods, Goldstein & Peli 2013](https://www.sciencedirect.com/science/article/pii/S0042698913001090). Dithering (the noisy-bit method) extends 8-bit displays to effectively continuous contrast [S: Allard & Faubert 2008](https://www.researchgate.net/publication/23165499_The_noisy-bit_method_for_digital_displays_Converting_a_256_luminance_resolution_into_a_continuous_resolution). We don't need it (see below).
- **Contrast and reading.** Normal readers are very tolerant: for 1° letters, a tenfold contrast reduction slows reading by less than 2×, with near-identical results for both polarities [S: Legge, Rubin & Luebker 1987](https://legge.psych.umn.edu/sites/legge.psych.umn.edu/files/2020-08/psychophysics_of_reading-v._the_role_of_contrast_in_normal_vision_legge_rubin_luebker_1987.pdf). When contrast is normalized by the letter-recognition threshold, reading curves for different sizes superimpose. The reading threshold is about 4× the letter-recognition threshold. This is the physiological basis for "contrast reserve" [S: same]. Low-vision readers' critical contrasts averaged **3.9× higher** than normal (16/19), correlated r = 0.87 with letter contrast sensitivity, and did not vary with the type of vision loss [S: Rubin & Legge 1989](https://www.sciencedirect.com/science/article/pii/0042698989901752). Normal max reading holds down to a critical contrast of about 5–10% (Michelson) [S: Legge 2016](https://legge.dl8.umn.edu/sites/legge.psych.umn.edu/files/2020-08/Legge%202016%20Reading%20with%20Digital%20Low%20Vision.pdf).
- **Units.** Legge uses Michelson contrast `(Lmax−Lmin)/(Lmax+Lmin)`. We use **Weber** `(Lbg−Lt)/Lbg` for dark text on a light background. For small contrasts, Michelson ≈ Weber/2 (a 0.3 log offset). Keep threshold and requirement in the same unit.

**Why absolute thresholds from consumer screens are soft** [C unless noted]:

| Source | Magnitude near a white background |
|---|---|
| 8-bit floor | 255→254 = 0.89% Weber (sRGB), 253 = 1.8%, 250 = 4.4%. Normal letter thresholds (about 1–2%) sit at 1–2 quantization steps, a ceiling. Reduced-CS thresholds (3–30%) are well resolved. **Dithering is therefore unnecessary for our decision.** |
| Unknown gamma (1.8 / sRGB 2.2 / 2.6) | Gray 217: 25% / 30% / 34% Weber; gray 253: 1.4% / 1.7% / 2.0% → **±0.06–0.07 log**. macOS Chrome color-manages; many Windows setups do not. |
| Brightness setting and auto-brightness | Below roughly tens of cd/m², thresholds rise (Weber's law fails) [I]. Night modes and "Reduce White Point" shift luminance. |
| Ambient reflection | Office light on a matte screen reduces dark-on-light Weber contrast by about 1% [I: E·ρ/π ≈ 3 cd/m² vs 300 cd/m² white]. Outdoor glare on glossy screens can halve it. Veiling glare matters for low vision [S: Legge 2016]. |
| Dark polarity | Weber is relative to a near-zero black. OLED vs LCD black (≈0 vs 0.1–0.3% of white) plus reflections make light-on-dark thresholds **unmeasurable in any absolute sense** → never measure contrast in dark polarity. |
| Forced colors / OS high-contrast / Chrome auto-dark | Page colors are overridden → task invalid. Detect `forced-colors: active`, set `color-scheme`, and skip. |
| Measurement noise | 8 trials 4AFC Bayesian → RMSE ≈ 0.13 log; 10 trials → 0.105 (simulated, ideal observer, β = 3.5, γ = 0.25, λ = 0.02). |

**Net: about ±0.15–0.17 log total uncertainty (1 SD) on a single uncalibrated measurement [C/I].** That is fine for 3 wide bands. It is not fine for a continuous "your CS is 1.62". So: **(a)** use absolute estimates only in bands with cost-asymmetric edges; **(b)** prefer *within-display relative* comparisons, such as reading speed at low versus high contrast on the same screen, where gamma error is about ±0.06 log and brightness/glare cancel to first order [I]; **(c)** track a user's thresholds relative to their own earlier sessions on the same device class (drift for recalibration, never a clinical claim); **(d)** optionally build k-anonymous per-device-bucket percentiles later from consenting users [I].

**WCAG ratio versus visual contrast** [C]. WCAG CR = (L1+0.05)/(L2+0.05), which is equivalent to an effective Weber contrast with 5% flare: `W_eff = 1 − 1/CR`.

| CR | 21 | 10 | 7 | 4.5 | 3 | 2 | 1.5 |
|---|---|---|---|---|---|---|---|
| W_eff | 0.952 | 0.900 | 0.857 | 0.778 | 0.667 | 0.500 | 0.333 |
| log W_eff | −0.021 | −0.046 | −0.067 | −0.109 | −0.176 | −0.301 | −0.477 |

Everything from 4.5:1 to 21:1 spans 0.09 log. Common web grays: #767676 = 4.54:1, #999 = 2.85:1, #595959 = 7.0:1. The contrast floor's value is lifting sub-AA text (e.g., 2.85 → 7 gains 0.19 log). Raising AA to AAA gains 0.04 log.

### 2.4 Polarity

- A subset of low-vision readers with cloudy ocular media read faster with white-on-black text. Cloudy vs clear media, together with central-field loss vs intact central field, explained 64% of the variance in peak reading rates among 16 low-vision observers [S: Legge, Rubin, Pelli & Schleske 1985](https://pubmed.ncbi.nlm.nih.gov/4013092/). In another study, 5 of 19 low-vision readers read white-on-black faster at both high and low contrast, attributed to light scatter [S: Rubin & Legge 1989]. The size of the effect for that subset is 10–50% faster [S: Legge 2016].
- For normal vision, polarity has little or no effect on reading speed and a weak effect on reading acuity [S: Legge 2016; Legge 1987]. In proofreading, there is a positive-polarity (dark-on-light) advantage that **increases linearly as character size decreases**, attributed to higher display luminance → smaller pupil → sharper retinal image [S: Piepenbrock, Mayr & Buchner 2014](https://doi.org/10.1177/0018720813515509). High ambient light lowers legibility thresholds overall. **In dark rooms, white-on-black suffers a disadvantage that grows as text gets smaller** [S: Dobres, Chahine & Reimer 2017](https://pubmed.ncbi.nlm.nih.gov/28166901/).
- Implications [I]:
  - Test polarity **near CPS**, where the effects are largest and the operational minimum size lives. Large text hides polarity effects.
  - Present the two polarities as the colors WebAble would actually apply (light #111 on #FFF = 18.9:1; dark #EDEDED on #121212 = 16.0:1 [C]). Avoid pure #FFF on #000 because of halation.
  - Expect most users to show no objective difference. Use stated preference and `prefers-color-scheme` as tie-breakers.
  - Keep learning polarity after onboarding (time-of-day matters per Dobres 2017).

### 2.5 Text spacing

- **WCAG 1.4.12** (line-height 1.5, paragraph 2 em, letter 0.12 em, word 0.16 em) is a *robustness* criterion: content must not break when a user overrides spacing. It does not require these values [S: W3C Understanding 1.4.12](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html). The values come from the McLeish study, in which reading speed rose with spacing from 0.04 to 0.25 em and flattened around 0.20 [S: same]. For WebAble this sets **safe override limits**: sites that pass 1.4.12 tolerate them, and the verifier catches those that don't.
- **Letter spacing: robust null result beyond standard.**
  - Normal central and peripheral vision: no gain above standard spacing; the critical spacing is close to standard [S: Chung 2002](https://pubmed.ncbi.nlm.nih.gov/11923275/); [Yu et al. 2007](https://pubmed.ncbi.nlm.nih.gov/18217817/).
  - Central-vision loss, 14 subjects, 0.5–2× spacing: optimum was 0.95 ± 0.06× standard, so "reading speed is already optimal at the standard spacing" [S: Chung 2012](https://pmc.ncbi.nlm.nih.gov/articles/PMC3429790/).
  - Magnified text (≥ 6°): 1.5× and 2× spacing *reduced* speed [S: Legge 1985 via Legge 2016].
  - The dyslexia benefit from extra-large letter spacing [S: Zorzi et al. 2012](https://doi.org/10.1073/pnas.1205566109) belongs to group (c) or future scope, not vision.
- **Line and word spacing: mixed, small, sometimes useful for low vision.**
  - Foveal RSVP reading speed rose with vertical spacing up to 1.2–1.5× and then plateaued; the benefit was larger in the periphery [S: Chung 2004](https://journals.lww.com/optvissci/abstract/2004/07000/reading_speed_benefits_from_increased_vertical.14.aspx).
  - AMD passages at 1–4× line spacing: speed virtually constant [S: Chung et al. 2008](https://journals.lww.com/optvissci/abstract/2008/09000/reading_speed_does_not_benefit_from_increased_line.13.aspx).
  - Macular disease: double line plus double word spacing gave **+26% (high contrast) and +46% (low contrast)**. Line spacing had a 15–20× larger effect size than word spacing [S: Blackmore-Wright, Georgeson & Anderson 2013](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0080325).
  - General web population (Wikipedia, eye tracking, n = 104): line spacing 0.8 and 1.8 both impaired readability [S: Rello, Pielot & Marcos 2016](https://dl.acm.org/doi/10.1145/2858036.2858204).
  - Legge's summary: letter spacing is not helpful; extra line and word spacing may help some low-vision readers [S: Legge 2016].
- Decision: **don't spend calibration time on spacing** [I]. Defaults: line-height 1.5, letter spacing 0, word spacing 0. On the large-print or contrast-limited path, offer 1.8–2.0 line-height plus 0.16–0.25 em word spacing, and learn from acceptance or undo afterwards.

### 2.6 Line length

- With on-screen text, 55 characters per line (cpl) gave the best comprehension at normal and fast reading speeds and was read faster than short lines [S: Dyson & Haselgrove 2001](https://dl.acm.org/doi/10.1006/ijhc.2001.0458). Across studies, long lines (about 100 cpl) are often read faster but are less preferred [S: Dyson 2004 review](https://stu.westga.edu/~ssynan1/literacy/Dyson.pdf). WCAG 1.4.8 (AAA) asks for ≤ 80 characters [S](https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html).
- **Lower bound for magnified text**, measured on laptop, tablet and phone: **13 cpl (normal vision) / 8 cpl (low vision)** are needed to reach 80% of MRS, nearly constant across font and device. Magnification on small displays can "shrink or entirely eliminate" the usable print-size range [S: Atilgan, Xiong & Legge 2020](https://www.pnas.org/doi/10.1073/pnas.2007514117). Legge's worked example: with a 2° CPS, only an iPad at 8 inches exceeds 12 cpl and 10 words/screen [S: Legge 2016].
- Decision: `maxLineCh` 70 (60–80) as a prior with confidence 0.4. `minCharsPerLine` = 13, or 8 on the large-print path, as a hard feasibility constraint. The extension should flag conflicts (size floor × viewport < min cpl) and offer reflow, landscape, or collapsing side columns [I].

### 2.7 Fonts, preference versus performance, and weight

- **Wallace et al. 2022, TOCHI 29(4):38, "Virtual Readability Lab"** [S](https://dl.acm.org/doi/10.1145/3502222) ([PDF](https://jeffhuang.com/papers/Readability_TOCHI22.pdf), [materials](https://github.com/virtual-readability-lab/tochi-paper-materials-towards-individuated-reading)).
  - Method: 500 MTurk participants, 352 after filtering, aged 18–71. 16 fonts, with size normalized to Times 16 px by crowd perceptual matching (x-height, character height and width all tried). Preference came from a toggle-test double-elimination tournament (30 pairs plus 6 repeats; self-consistency 72%). Effectiveness came from 10 rounds reading 2 passages in each of 5 fonts (preferred, Times, Noto Sans, and 2 random), 69–93 words per screen, with 2 multiple-choice comprehension questions.
  - Findings: fastest vs slowest font differed by **35% in WPM without loss of comprehension**. **Preference did not predict speed even when size was controlled, although participants believed it did.** No single font was best.
  - Caveats for us [I]:
    1. People with any vision condition or reading disability were **excluded**, so there is no low-vision evidence.
    2. With 2 passages per font, max−min over 5 noisy means inflates the 35% (regression to the mean).
    3. The design locked zoom and font size, which we cannot do.
    4. It needs about 35 min, so font choice cannot be calibrated at onboarding.
  - Takeaways: don't pick a font family from preference, and treat font A/B as a long-term, in-the-wild, offer-based experiment.
- **Low-vision fonts.** User-adjusted fonts (Font Tailor) improved legibility by more than 75% over baseline, but not beyond highly legible standard fonts such as Times [S: Arditi 2004](https://pubmed.ncbi.nlm.nih.gov/15204299/). There is little evidence for any single optimal low-vision font [S: Russell-Minda et al. 2007](https://files.eric.ed.gov/fulltext/EJ772089.pdf). Font effects are small, and fixed-width fonts may help near the acuity limit [S: Legge 2016]. Measure CPS in a typical proportional sans [I].
- **Weight.**
  - Eye tracking: light and ultra-light fonts were less legible than regular and bold, at both contrast levels and both polarities, and raised cognitive load; avoid them for body text [S: Burmistrov et al. 2016 NordiCHI](https://dl.acm.org/doi/10.1145/2971485.2996745).
  - Glance thresholds (3-down-1-up staircase, age 35–75): under suboptimal rendering, the **lightest weight was markedly degraded** while regular, medium and bold did not differ; under optimal rendering, lighter weights were slightly *better* [S: Dobres, Reimer & Chahine 2016](https://jdobr.es/pdf/Dobres-etal-2016-Auto-UI.pdf). Rendering and DPR interact with weight.
  - Thin strokes *and* extreme boldness reduce recognition at all sizes; boldness helps **only at small visual angles** [S: Beier & Oderkerk 2019](https://pubmed.ncbi.nlm.nih.gov/31421483/).
  - Courier at 6 boldness levels: never faster than standard. Fovea −23% at both extremes; at 10° periphery, −21.5% at 1.89× and −51% at 3.04× [S: Bernard, Kumar, Junge & Chung 2013](https://pubmed.ncbi.nlm.nih.gov/23523572/). "Stroke thickness greater than the standard value did not help reading" [S: Legge 2016].
  - Decision: a universal floor of 400. 500–600 is conditional (contrast-limited, or text within 0.2 log of CPS). Cap at 700. Thin fonts on DPR < 1.5 screens are the worst case [I].

### 2.8 Fast adaptive procedures

| Procedure | Converges to | Trials for a usable estimate | Use here |
|---|---|---|---|
| 1-up-2-down / 1-up-3-down staircase [S: Levitt 1971](https://pubs.aip.org/asa/jasa/article/49/2B/467/747112/Transformed-Up-Down-Methods-in-Psychoacoustics) | 70.7% / 79.4% (Dobres used 3-down-1-up at 79.4%) | 6–8 reversals, ≈ 25–50 trials | No. Too slow, and it wastes trials on step-size descent. |
| QUEST [S: Watson & Pelli 1983](https://www.semanticscholar.org/paper/Quest:-A-Bayesian-adaptive-psychometric-method-Watson-Pelli/2635cce2cce940f5d19465db8c5ab14b992515d4) | Bayesian threshold, trials placed at the posterior | Strong prior: 8–10 trials → 0.10–0.13 log RMSE [C: simulation] | Contrast threshold. |
| QUEST+ (min expected entropy, multi-parameter) [S: Watson 2017](https://jov.arvojournals.org/article.aspx?articleid=2611972); Psi (threshold + slope) [Kontsevich & Tyler 1999](https://doi.org/10.1016/S0042-6989(98)00285-5) | Same, with optimal placement | Slope needs ≥ 30 trials. Fix the slope instead. | Contrast (QUEST+ with fixed β). |
| qCSF [S: Lesmes et al. 2010](https://doi.org/10.1167/10.3.17) | Whole CSF | 25–50 trials | No. Not needed for text. |
| qReading [S: Hou et al. 2018] | Reading function | ~225 trials | Use its model and priors for fitting, not its procedure. |
| Descending method of limits (MNREAD) with coarse-to-fine steps | Plateau + knee | 7–10 sentences | Size ladder. Speed is continuous, not binary, so staircases don't apply. |

2AFC vs 4AFC: guess rate 0.5 vs 0.25. With 8 trials, 4AFC carries much more information per trial and is less fooled by lucky guesses. Use 4AFC word identification (a reading-relevant task) rather than 2AFC detection [I].

---

## 3. The calibration: screens, stimuli, procedures

**Stimulus font.** Bundle one typical proportional sans at regular weight 400 (OFL-licensed, e.g., Noto Sans). Measure its x-height ratio `r_ref` at runtime. Black #111 on white #FFF except where noted.
**Global UI.** All controls are ≥ 64 CSS px tall with ≥ 16 px gaps; this suits the fine-motor group as well. Keyboard map: T/F/C (or ←/→/↓), Esc to pause. Focus is visible. No timers are shown and there are no time limits; RT is recorded silently. Honor `prefers-reduced-motion`. The progress indicator reads "Step 2 of 4, about a minute left". Status goes to an `aria-live="polite"` region. Headings are semantic.
**Screen-reader and skip path.** The first screen offers "Skip text tuning" and "I use a screen reader or magnifier". Screen-reader users skip the visual module entirely, because timed visual reading is meaningless when listening. Magnifier users continue, flagged: measurements through the magnifier stay self-consistent as long as they keep using it [I]. We never try to *detect* assistive technology (no reliable API, and it would be invasive).

| # | Screen | Stimulus / procedure | Trials | Time |
|---|---|---|---|---|
| V0 | Environment capture (invisible) | DPR, `screen.*`, `innerWidth`, `visualViewport.scale`, default font size (1rem probe), clamped-min-font probe (render 6 px and measure), `prefers-color-scheme`, `prefers-contrast`, `forced-colors`, `color-gamut`, `dynamic-range`, device class (from pointer/hover plus width), local day/night bucket. Stays on device. | 0 | 0 s |
| V1 | **"Make this comfortable to read"** (integrated with the intro) | Instruction paragraph starts at max(1.5× default font, 24 px) at 21:1. Big −/+ buttons and keys step 0.1 log (×1.26); a "This is comfortable" button. Record S_comf (rendered x-height) and step count. If S_comf ≥ 2× default font → **large-print path**. | 1 adjustment | 6–10 s |
| V2 | **Reading ladder** "Read each sentence at your normal pace. Is it true?" [True] [False] [Can't read it] | Original 9–11-word true/false sentences (55–60 chars), 20–24 ch box (≥ 13 ch; ≥ 8 on large-print path). Size grid 0.1 log. Start S0 = min(S_comf × 10^0.3, S_fit), where S_fit is the largest size fitting ≥ 13 ch (or 8) in 90% of the viewport. 1 practice sentence at S0 (discarded). **Phase A (coarse):** step −0.2 log while the trial is *on plateau* (correct and y ≥ y_max − 0.1). **Phase B (fine):** at the first off-plateau trial j, test the skipped 0.1 step (j−1), then j+1 if j was correct and ≥ 50% of MRS. **Stop** when 2 off-plateau trials are bracketed, a "Can't read" occurs below the plateau, the rendered x-height reaches the 4 px floor, 12 trials are reached, or 40 s elapse. If S0 itself is off-plateau, step *up* in 0.1 steps to S_fit, then stop (display-limited). | 7–10 (+1 practice) | 25–40 s |
| V3 | **"Which word is it?"** | One common 5-letter word at size S_c = 10^(x_CPS+0.3), i.e., 2×CPS, capped at S_fit. Dark gray on #FFF, Weber contrast on a 0.05 log grid quantized to sRGB gray levels (0.9 → #595959 … 0.009 → #FEFEFE [C]). 4 high-contrast response buttons (target plus 3 same-length distractors) plus "I can't see a word". Word is visible until response (Pelli-Robson style, unlimited viewing). Trial 1 is easy (W ≈ 0.5). Then **QUEST+ with fixed slope** (log-Weibull, β = 3.5, γ = 0.25, λ = 0.02), prior on α ~ N(−1.4, 0.5) log10 Weber (wider on large-print path: N(−1.1, 0.6)). "Can't see" counts as incorrect. Stop at 8 scored trials, posterior SD < 0.12, or ceiling (3 correct at ≤ 2%, i.e., "not contrast-limited here"). **Skip** if `forced-colors: active`. | 1 + 6–8 | 10–15 s |
| V4 | **Light/dark sentences** | 4 true/false sentences at S_p = 10^(x_CPS+0.1) (≈ the operational minimum). Order L-D-D-L or D-L-L-D (randomized). Light #111/#FFF (18.9:1); dark #EDEDED/#121212 (16.0:1). Then one question: "Which felt easier?" [Light] [Dark] [About the same]. **Skip** under forced colors. | 4 + 1 | 12–16 s |
| V4b | *Conditional* low-contrast reading probe | Run only if the V3 posterior straddles a band edge (\|α̂ − edge\| < σ_tot) and the budget allows. 2 sentences at 2×CPS, Weber 0.30 (#DADADA-level gray on white, W ≈ 0.30 [C]). Δ_c = y_MRS − mean(y_lowC). | 0 or 2 | 0–7 s |
| V5 | **Preview and nudge** | Real paragraph rendered with the derived settings, next to "Before". Controls: bigger/smaller (0.1 log), light/dark/auto, "More spacing" toggle. Any nudge becomes a `user_override`. | 0–3 taps | 5–8 s |

Expected total: about 60–75 s (normal vision: short ladder, fast reading); about 75–90 s (large-print path: slower reading, fewer ladder steps). Hard cap 90 s: drop V4b, then shorten V3 to 6 trials.

**Recorded on device (per trial):** task, item id, requested CSS px, **rendered x-height px**, chars/line, lines, contrast (gray value, nominal Weber), polarity, onset (rAF after paint, `performance.now`), response time, response, correct, DPR, `visualViewport.scale`, `innerWidth`, visibility/blur events.
**Sent to server:** derived parameters, confidences, sources, device class, Z_cal (once the extension reports it), calibration version, duration, flags (display-limited, forced-colors, magnifier, skipped). No sentences, no RT series, no raw environment fingerprint beyond device class.

---

## 4. Derivations: measurements → profile parameters

Notation: h = rendered x-height in **effective px** = CSS px × Z_cal (Z_cal defaults to 1 until the extension reports zoom). x = log10 h. For valid trial i: y_i = log10(wpm_i), with wpm_i = 60·W_i/(RT_i − t0).

**Trial validity:** correct; RT−t0 ≥ 0.8 s; wpm ≤ 900; no visibility change; DPR and scale unchanged.

### 4.1 Minimum text size (x-height, effective px), per device class

1. **MRS (plateau).** Iterate: y_MRS = median of valid y_i with y_i ≥ max(y) − 0.15, repeated to convergence (1–2 passes). n_P = size of that set.
2. **CPS, primary fit.** Two-limb fit in log-log (Cheung 2008), `y = y_MRS − s·max(0, x_c − x)`. Priors: s ~ LogNormal centered on the Cheung/qReading population slope, and x_c ~ N(x_comf, 0.35) from V1. Take the MAP estimate. CPS = the point where the curve reaches 80% of MRS: `x_CPS = x_c − log10(1/0.8)/s`. That is the exponential-decay CPS_ED(80%) convention; the two-limb knee x_c is kept as a secondary field [S: Cheung 2008; I for the priors].
3. **CPS, fallback (no fit).**
   - Let x_p = smallest tested size such that it and all larger sizes are on plateau (valid, y ≥ y_MRS − 0.097).
   - Let x_o = next smaller tested size.
   - If x_o is a valid correct trial: `x_CPS = x_o + (y_MRS − 0.097 − y_o)·(x_p − x_o)/(y_p − y_o)`, clamped to [x_o, x_p].
   - If x_o was an error or "Can't read": x_CPS = x_p (conservative).
4. **Minimum text size.** `h_min = 10^(x_CPS + m)`, with sustained-reading margin m = 0.1 (+26%). Rationale: CPS is where max speed is just reached; comfort sits at CPS + 0.05 on average [S: Latham 2022]. If the user nudges in V5, set h_min = h_user and source = user_override.
   - The extension enforces it per element: `font-size_needed = h_min / (Z_page · r_font)`, where r_font comes from `font-size-adjust: ex-height from-font` or a measured ratio. It only enlarges text below the floor, never shrinks [I]. Chrome 127+ supports `font-size-adjust` two-value syntax ([Chrome 127](https://developer.chrome.com/blog/new-in-chrome-127), [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/font-size-adjust)).
5. **Display-limited case.** If no plateau size fits the viewport: h_min = h_fit, flag `display_limited`, set q_b = 0.5, and offer reflow or magnifier guidance. Never a diagnosis.
6. **Cross-device transfer** [C/I]. Store `(h_min, deviceClass)`. Convert with typical arcmin/CSS-px: laptop 1.35, desktop 1.35–1.45, tablet 1.66, phone 1.77 (computed for MacBook Air 13.6 @ 50 cm, 24"/27" @ 65 cm, iPad 10.9 @ 40 cm, iPhone 15 @ 32 cm). So `h_min,phone ≈ h_min,laptop × 1.35/1.77`. A transferred value gets confidence × 0.6 until a one-screen "Is this size right?" check on the new device.
7. **Sanity check** [C]. On a MacBook Air at 50 cm, 16 px text has x-height ≈ 0.19°, right at the normal CPS range (0.1–0.2°). A typical sighted user's h_min lands at or below site sizes, so there is no size change. An example CPS of 1° x-height means about 85 px font on a laptop and about 65 px on a phone.

**Confidence (size):** `conf = min(0.9, q_n · q_b · q_v · q_c)`
- q_n = min(1, n_P/3) (≥ 3 plateau points to trust MRS)
- q_b = 1.0 if the knee is bracketed at 0.1 log; 0.8 if at 0.2 log; 0.5 if unbracketed (floor, ceiling or display-limited)
- q_v = clamp((acc_all − 0.5)/0.4, 0, 1) × (0.7 if any zoom/visibility event)
- q_c = 1.0 if |x_comf − x_CPS| ≤ 0.2; 0.85 if ≤ 0.35; 0.7 otherwise (Latham LoA)
- Capped at 0.9 because single-session repeatability is about ±0.12 log [S]. Rises toward 0.95 with in-the-wild confirmation (no manual zoom-ins, enlargements kept).

**Secondary size outputs (informational, never shown as scores):** MRS_rel (y_MRS; within-person only), reading-limit size (smallest correct size), and the large-print path flag.

### 4.2 Contrast floor {4.5, 7, max}

- V3 gives posterior mean α̂ (log10 Weber threshold for 4AFC word ID at 2×CPS) and SD σ_p. Total uncertainty: `σ_tot = sqrt(σ_p² + 0.10²)`, where the display term is gamma, brightness and glare [C/I]. Add 0.05 if DPR < 1.5 or the local night bucket applies.
- **Reserve rule** [S: Whittaker & Lovie-Kitchin, R = 10; C for conversion]: `W_req = min(0.95, 10 · 10^α̂)`, and `CR_req = 1/(1 − W_req)` (inverse of the flare model).
  - α̂ = log 3% → W_req 0.30 → CR 1.43
  - 5% → 0.50 → 2.0
  - 8% → 0.80 → 5.0
  - ≥ 9.5% → W_req at the 0.95 ceiling → no CR suffices
- **Bands** (widened into cost-asymmetric decisions, because 4.5 vs 7 is only 0.04 log apart, well below σ_tot):

| Band | Condition | Floor | Also |
|---|---|---|---|
| N | α̂ ≤ log10(0.03) = −1.52 | 4.5:1 (lift sub-AA text only) | weight floor 400 |
| M | −1.52 < α̂ ≤ log10(0.09) = −1.05 | 7:1; also lift non-text UI (borders, icons) to ≥ 3:1 | weight 500–600 for text within 0.2 log of CPS; line-height offer 1.6–1.8 |
| S | α̂ > −1.05, or ≥ 2 "can't see" at W ≥ 0.3 | "max": text snapped to #000/#FFF (or the polarity pair), ≥ 15:1 | weight 600 for body text ≤ 1.5·h_min; polarity test weighted up; size margin m = 0.2; brightness/glare tip |

- **V4b relative probe (when run).** Δ_c ≤ 0.08 supports N; Δ_c 0.08–0.25 supports M; Δ_c > 0.25 or errors supports S. Normal readers barely slow at W = 0.3 and 2×CPS [S: Legge 1987]; reduced-CS readers have about 3.9× higher critical contrast [S: Rubin & Legge 1989]. If the probe and α̂ disagree by one band, **take the higher-need band** (cheap to apply, verifier-protected) and set confidence to 0.5 [I].
- **Priors.** `prefers-contrast: more` shifts toward M, as a stated preference with weight 0.5. `forced-colors: active` sets the floor to "system-managed": WebAble does not touch colors [I].
- **Confidence.** `conf = Φ((e_hi − α̂)/σ_tot) − Φ((e_lo − α̂)/σ_tot)`, the probability that the true threshold lies in the assigned band. Then ×0.9 if no V4b ran near an edge, and ×0.8 if the ceiling was hit (N assigned, but the true CS is unmeasured). Cap 0.85.
- **Provisional status.** The band edges are theory-derived. Re-fit them on the WebAble pilot against a within-device reading criterion (Δ_c) before trusting them [I].

### 4.3 Polarity {light, dark, none}

- Compute `Δ_pol = mean(y_D) − mean(y_L)` over valid trials, with `SE = s·sqrt(1/n_D + 1/n_L)`. s = the user's plateau residual SD from V2 (default 0.08 log; clamp 0.05–0.15).
- **Objective winner** if |Δ_pol| ≥ 0.08 (≈ 20%) and |Δ_pol|/SE ≥ 1.64.
- **Final value:**

| Case | Result | Confidence |
|---|---|---|
| Objective and stated agree | That polarity | 0.8 |
| Objective only | Objective | 0.6 |
| Stated only | Stated | 0.5 (Wallace: preference ≠ performance) |
| Objective and stated conflict | none (respect site/system; offer toggle) | 0.4 |
| Both null | none | 0.6 ("no strong need") |

- In band S with dark ahead by ≥ 0.04 but below significance: offer dark with confidence 0.55. This matches the scatter pattern [S: Rubin & Legge 1989]. It is stored as a preference, never as a condition.
- `prefers-color-scheme: dark` is a weak prior (0.3) only; many people choose dark mode for aesthetics [I].
- After onboarding: learn polarity by time-of-day bucket, since dark polarity loses legibility for small text in dark rooms [S: Dobres 2017].

### 4.4 Font-weight floor

- **400 for all users** (source: evidence default; confidence 0.8). Any rendered weight < 400 is raised to 400 where a 400 face or variable axis exists. Enforce strictly when DPR < 1.5 [S: Burmistrov 2016; Dobres 2016; Beier & Oderkerk 2019].
- **500 (variable) or 600 (static)** in band M/S, or for text whose x-height < 10^(x_CPS+0.2). Confidence 0.5 [S: Beier & Oderkerk: boldness helps at small visual angles].
- **Never above 700** [S: Bernard 2013]. Avoid synthetic bold hacks (`-webkit-text-stroke`) except behind the verifier [I].

### 4.5 Spacing and line length (priors, not measured)

| Parameter | Default | Large-print path (h_min ≥ 2× browser default) or band M/S | Confidence | Sources |
|---|---|---|---|---|
| line-height | 1.5 | offer 1.8–2.0 | 0.5 / 0.35 | WCAG 1.4.8/1.4.12; Rello 2016; Chung 2004; Blackmore-Wright 2013; Chung 2008 (null) |
| letter-spacing | 0 (keep site) | 0; user may choose ≤ 0.12 em | 0.6 | Chung 2002, 2012; Yu 2007; Legge 2016 |
| word-spacing | 0 | offer 0.16–0.25 em | 0.35 | Blackmore-Wright 2013; WCAG 1.4.12 |
| paragraph spacing | site | ≥ 1.5× line-height (1.4.8) | 0.4 | WCAG 1.4.8 |
| maxLineCh | 70 (60–80) | 70; *and* minCharsPerLine 8 | 0.4 | Dyson & Haselgrove 2001; Dyson 2004; WCAG 1.4.8; Atilgan 2020 |
| minCharsPerLine | 13 | 8 | 0.7 | Atilgan 2020 |

All of these are refined after onboarding with offers ("Try more line spacing?") and kept or undone. Acceptance and undo are the only learning signal: no reading-time telemetry leaves the device [I].

### 4.6 Profile shape (example)

```json
{"vision":{
  "minText":{"xHeightEffPx":22.0,"fontPxRef":41,"deviceClass":"laptop","arcminPerPxAssumed":1.35,
             "cpsXHeightEffPx":17.5,"marginLog":0.1,"source":"measured","confidence":0.72,
             "flags":[],"zoomCal":1.0},
  "contrastFloor":{"value":7,"band":"M","alphaLogWeber":-1.31,"sigmaTot":0.16,"source":"measured","confidence":0.61},
  "polarity":{"value":"none","deltaLog":0.03,"stated":"same","source":"measured+stated","confidence":0.6},
  "fontWeightFloor":{"value":400,"nearCpsValue":600,"source":"derived","confidence":0.8},
  "lineHeight":{"value":1.5,"offer":1.8,"source":"default","confidence":0.5},
  "letterSpacingEm":{"value":0,"source":"default","confidence":0.6},
  "wordSpacingEm":{"value":0,"offer":0.16,"source":"default","confidence":0.35},
  "maxLineCh":{"value":70,"minCharsPerLine":13,"source":"default","confidence":0.4},
  "calibration":{"version":"vis-1","date":"2026-09-28","durationSec":74,"forcedColors":false}}}
```
Each field keeps `measured`, `stated` and `user_override` separately. The effective value is override > measured > stated > default. Recording both is how we honor user authority without losing the evidence (Wallace's lesson).

### 4.7 Worked examples [C]

- **A. Typical sighted laptop user.**
  - V1 → 20 px. Ladder: 48, 30, 19, 12 px (on plateau at ~265 wpm), 7.6 px (140 wpm, off). Fine step at 9.5 px: 200 wpm.
  - y_MRS = log 265. Interpolating to 212 wpm gives a CPS font of ≈ 10.2 px; h_min font ≈ 12.9 px.
  - Result: **no size change** on normal sites.
  - V3 ceiling at 2% → band N (confidence ~0.7): floor 4.5 lifts only sub-AA gray text. Polarity: none.
- **B. Large-print path.**
  - V1 → 48 px; S0 = 96 px (fits ≥ 13 ch on a 1470 px viewport). Ladder: 96, 60 (plateau ~150 wpm), 38 (off, 90 wpm). Fine step at 48: 120 wpm (0.8·MRS).
  - CPS ≈ 48 px, h_min font ≈ 60 px. At 60 px, ≈ 44 cpl on the laptop. On a phone: 60 × 1.35/1.77 ≈ 46 px, ≈ 15 cpl (feasible ≥ 8).
  - V3 α̂ = −1.2 (6%) → band M: floor 7:1, weight 600 near CPS, line-height offer 1.8.
  - V4: dark +0.12 log (SE 0.09), stated dark → **dark, confidence 0.8**.

---

## 5. Implementation notes for the extension

- Enforce the size floor with CSS (per-element adopted stylesheets / attribute selectors computed by deterministic code). The model only emits the parameter set, never code. Then **verify**: no clipping or overflow, no lost content, reflow within minCharsPerLine, contrast checked post-apply. Roll back failures.
- `chrome.fontSettings.setMinimumFontSize` exists ([API](https://developer.chrome.com/docs/extensions/reference/api/fontSettings)) but is a blunt, browser-wide persistent setting that bypasses verification. Keep it off by default and only offer it with explicit consent [I].
- Never touch ARIA, accessible names, focus order or key handling. Contrast and weight changes are purely presentational.
- Respect `forced-colors` (no color changes) and user zoom (the floor divides by Z_page).
- Recalibration triggers (always offered): new device class; ≥ N manual zoom-ins across different sites in a week; > 6 months; explicit request. Report changes as "your comfortable size changed" and never as clinical change.

## 6. Risks and open questions

1. **Band edges and CPS margin are theory-derived.** Pilot with 20–30 users (including low vision), comparing onboarding values against a longer in-lab or reference session (e.g., a 30-sentence ladder and a Pelli-Robson-like letter CS), before fixing constants.
2. **The single-session CPS SD (~0.1–0.15 log) is similar in size to the margin m.** Learning afterwards is essential.
3. **Cross-group confounds.** Motor RT affects wpm and attention lapses mimic knees. Share t0 and lapse rates with the other calibration modules.
4. **Sentence pool quality** dominates reading-speed noise. Budget effort for item validation (ROAR-style ≥ 85% agreement) and for other languages.
5. **Visual-angle assumptions** break for users with unusual postures, e.g., very close to a laptop. Measuring in habitual posture captures functional need but makes cross-device transfer weak, hence the per-class storage and the confirmation screen.
6. **Contrast thresholds are night/day and brightness dependent.** A single onboarding value is a snapshot. Treat later behavior as the evidence.

---

## 7. Sources

- Wallace S. et al. 2022, *Towards Individuated Reading Experiences*, ACM TOCHI 29(4):38. https://dl.acm.org/doi/10.1145/3502222 · PDF https://jeffhuang.com/papers/Readability_TOCHI22.pdf · materials https://github.com/virtual-readability-lab/tochi-paper-materials-towards-individuated-reading · summary https://readabilitymatters.org/articles/towards-individuated-reading-experiences
- Calabrèse A. et al. 2016, Baseline MNREAD measures, IOVS 57(8). https://iovs.arvojournals.org/article.aspx?articleid=2537421
- Calabrèse A. et al. 2018, MNREAD iPad vs chart, J Vis 18(1):8. https://jov.arvojournals.org/article.aspx?articleid=2670382
- Cheung S-H., Kallie C., Legge G., Cheong A. 2008, NLME modeling of MNREAD data, IOVS 49:828. https://iovs.arvojournals.org/article.aspx?articleid=2164115 · PDF https://legge.psych.umn.edu/sites/legge.psych.umn.edu/files/files/media/cheung08_nonlinear_mixed-effects_modeling_of_mnread_data.pdf
- mnreadR documentation. https://rdrr.io/cran/mnreadR/man/nlmeParam.html · https://rdrr.io/cran/mnreadR/man/mnreadCurve.html
- MNREAD history. https://mnread.umn.edu/history
- Legge G. et al. 1989, Psychophysics of reading VIII (MNREAD precursor). https://legge.psych.umn.edu/sites/legge.psych.umn.edu/files/files/media/legge89_psychophysics_of_reading._viii._the_minnesota_low-vision_reading_test.pdf
- Subramanian A., Pardhan S. 2006, MNREAD repeatability, OVS. https://www.researchgate.net/publication/6878621_The_Repeatability_of_MNREAD_Acuity_Charts_and_Variability_at_Different_Test_Distances
- Mansfield J., Legge G., Bane M. 1996, Font effects in normal and low vision, IOVS 37:1492. https://iovs.arvojournals.org/article.aspx?articleid=2161324
- Legge G., Bigelow C. 2011, Does print size matter for reading?, J Vis. https://jov.arvojournals.org/article.aspx?articleid=2191906
- Atilgan N., Xiong Y-Z., Legge G. 2020, Reconciling print-size and display-size constraints on reading, PNAS 117(48). https://www.pnas.org/doi/10.1073/pnas.2007514117 · PDF https://legge.psych.umn.edu/sites/legge.psych.umn.edu/files/2020-11/Atilgan%20Xiong%20Leggey%202020%20Reconciling%20print-size%20and%20display-size%20constraints%20on%20reading.pdf.pdf
- Legge G. 2016, Reading digital with low vision, Visible Language 50(2). https://legge.dl8.umn.edu/sites/legge.psych.umn.edu/files/2020-08/Legge%202016%20Reading%20with%20Digital%20Low%20Vision.pdf
- Latham K., Macnaughton J. 2022, Is patient identification of "comfortable" print size useful?, OPO. https://onlinelibrary.wiley.com/doi/10.1111/opo.12946 (follow-up, not reviewed: https://tvst.arvojournals.org/article.aspx?articleid=2785728)
- Hou F. et al. 2018, qReading, J Vis 18(9):6. https://pmc.ncbi.nlm.nih.gov/articles/PMC6133446/
- Whittaker S., Lovie-Kitchin J. 1993, Visual requirements for reading, OVS 70:54. https://www.semanticscholar.org/paper/Visual-Requirements-for-Reading-Whittaker-Lovie-Kitchin/d21c318deab799860d8dc9f20e93bfb9339155f9 · reserve summary https://pmc.ncbi.nlm.nih.gov/articles/PMC3974292/
- Legge G., Rubin G., Luebker A. 1987, Psychophysics of reading V: contrast in normal vision. https://legge.psych.umn.edu/sites/legge.psych.umn.edu/files/2020-08/psychophysics_of_reading-v._the_role_of_contrast_in_normal_vision_legge_rubin_luebker_1987.pdf
- Rubin G., Legge G. 1989, Psychophysics of reading VI: contrast in low vision. https://www.sciencedirect.com/science/article/pii/0042698989901752
- Legge G., Rubin G., Pelli D., Schleske M. 1985, Psychophysics of reading II: low vision. https://pubmed.ncbi.nlm.nih.gov/4013092/
- Pelli D., Robson J., Wilkins A. 1988, Pelli-Robson chart design. https://www.researchgate.net/publication/243783272_Designing_a_new_letter_chart_for_measuring_contrast_sensitivity
- Mäntyjärvi M., Laitinen T. 2001, Pelli-Robson normal values. https://pubmed.ncbi.nlm.nih.gov/11226793/
- Kollbaum P. et al. 2014, iPad letter CS validation, OVS 91:291. https://journals.lww.com/optvissci/abstract/2014/03000/validation_of_an_ipad_test_of_letter_contrast.8.aspx
- To L., Woods R., Goldstein R., Peli E. 2013, Psychophysical contrast calibration, Vision Res 90:15. https://www.sciencedirect.com/science/article/pii/S0042698913001090
- Allard R., Faubert J. 2008, Noisy-bit method, BRM 40:735. https://www.researchgate.net/publication/23165499_The_noisy-bit_method_for_digital_displays_Converting_a_256_luminance_resolution_into_a_continuous_resolution
- Piepenbrock C., Mayr S., Buchner A. 2014, Positive polarity advantage grows for small characters, Human Factors. https://doi.org/10.1177/0018720813515509
- Dobres J., Chahine N., Reimer B. 2017, Ambient illumination × polarity × size, Applied Ergonomics 60:68. https://pubmed.ncbi.nlm.nih.gov/28166901/
- Dobres J., Reimer B., Chahine N. 2016, Font weight × rendering, AutoUI. https://jdobr.es/pdf/Dobres-etal-2016-Auto-UI.pdf
- Burmistrov I. et al. 2016, Light and ultra-light fonts, NordiCHI. https://dl.acm.org/doi/10.1145/2971485.2996745 · https://www.interux.com/publications/Burmistrov-NordiCHI16.pdf
- Beier S., Oderkerk C. 2019, Boldness and visual angle, Acta Psychologica 199. https://pubmed.ncbi.nlm.nih.gov/31421483/
- Bernard J-B., Kumar G., Junge J., Chung S. 2013, Letter-stroke boldness and reading speed, Vision Res 84:33. https://pubmed.ncbi.nlm.nih.gov/23523572/
- Arditi A. 2004, Adjustable typography, Ergonomics 47:469. https://pubmed.ncbi.nlm.nih.gov/15204299/
- Russell-Minda E. et al. 2007, Typeface legibility for low vision review, JVIB. https://files.eric.ed.gov/fulltext/EJ772089.pdf
- Chung S. 2002, Letter spacing, central and peripheral vision, IOVS 43:1270. https://pubmed.ncbi.nlm.nih.gov/11923275/
- Chung S. 2012, Letter spacing in central vision loss, OVS. https://pmc.ncbi.nlm.nih.gov/articles/PMC3429790/
- Yu D. et al. 2007, Letter spacing, visual span, reading speed, J Vis. https://pubmed.ncbi.nlm.nih.gov/18217817/
- Chung S. 2004, Vertical word spacing, OVS 81. https://journals.lww.com/optvissci/abstract/2004/07000/reading_speed_benefits_from_increased_vertical.14.aspx
- Chung S. et al. 2008, Line spacing in AMD, OVS 85:827. https://journals.lww.com/optvissci/abstract/2008/09000/reading_speed_does_not_benefit_from_increased_line.13.aspx
- Blackmore-Wright S., Georgeson M., Anderson S. 2013, Enhanced text spacing in macular disease, PLoS ONE. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0080325
- Zorzi M. et al. 2012, Extra-large letter spacing in dyslexia, PNAS. https://doi.org/10.1073/pnas.1205566109
- W3C WCAG 2.2 Understanding 1.4.12 Text Spacing. https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html · 1.4.8 Visual Presentation https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html · 1.4.3 Contrast https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- Rello L., Pielot M., Marcos M-C. 2016, Make it big!, CHI. https://dl.acm.org/doi/10.1145/2858036.2858204
- Dyson M., Haselgrove M. 2001, Reading speed and line length on screen, IJHCS 54:585. https://dl.acm.org/doi/10.1006/ijhc.2001.0458
- Dyson M. 2004, How physical text layout affects reading from screen. https://stu.westga.edu/~ssynan1/literacy/Dyson.pdf
- Levitt H. 1971, Transformed up-down methods, JASA 49:467. https://pubs.aip.org/asa/jasa/article/49/2B/467/747112/Transformed-Up-Down-Methods-in-Psychoacoustics
- Watson A., Pelli D. 1983, QUEST. https://www.semanticscholar.org/paper/Quest:-A-Bayesian-adaptive-psychometric-method-Watson-Pelli/2635cce2cce940f5d19465db8c5ab14b992515d4
- Watson A. 2017, QUEST+, J Vis 17(3):10. https://jov.arvojournals.org/article.aspx?articleid=2611972
- Kontsevich L., Tyler C. 1999, Psi method, Vision Res 39:2729. https://doi.org/10.1016/S0042-6989(98)00285-5
- Lesmes L. et al. 2010, qCSF, J Vis 10(3):17. https://doi.org/10.1167/10.3.17
- Li Q., Joo S., Yeatman J., Reinecke K. 2020, Virtual Chinrest, Sci Rep 10:904. https://www.nature.com/articles/s41598-019-57204-1
- Bababekova Y. et al. 2011, Smartphone font size and viewing distance, OVS 88:795. https://journals.lww.com/optvissci/Fulltext/2011/07000/Font_Size_and_Viewing_Distance_of_Handheld_Smart.5.aspx
- Yeatman J. et al. 2024, ROAR sentence reading efficiency, Frontiers in Education. https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2024.1494431/full · Yeatman et al. 2021 ROAR, Sci Rep https://www.nature.com/articles/s41598-021-85907-x
- Anwyl-Irvine A. et al. 2021, Online timing precision, BRM. https://doi.org/10.3758/s13428-020-01501-5
- CSS `font-size-adjust` (MDN) https://developer.mozilla.org/en-US/docs/Web/CSS/font-size-adjust · Chrome 127 https://developer.chrome.com/blog/new-in-chrome-127 · CSS reference pixel https://www.w3.org/TR/css-values-4/#reference-pixel
- Chrome extension APIs: tabs.getZoom https://developer.chrome.com/docs/extensions/reference/api/tabs#method-getZoom · fontSettings https://developer.chrome.com/docs/extensions/reference/api/fontSettings

Computation scripts for the [C] figures (contrast conversions, quantization, device angles, the QUEST+ simulation) were run in the session scratchpad. The simulation is at `../questsim.py`, one level up from this file in the scratchpad.
