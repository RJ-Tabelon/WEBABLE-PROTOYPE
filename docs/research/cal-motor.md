# WebAble calibration research: reduced fine-motor precision (pointing)

Date: 2026-09-28. Scope: a 60-90 second in-browser pointing calibration inside onboarding, supporting mouse, trackpad, touch, and keyboard, switch, or voice users (who skip it). It produces a functional motor profile that is not a diagnosis. The profile sets bounded adaptation parameters: minimum target size, spacing, click stabilization, repeat-click debounce, drag alternatives, hover grace, and confirmation for destructive actions.

Evidence labels: **[V]** means I read and checked the primary source this session (full text or its official page). **[A]** means abstract-level or secondary only. **[I]** means my own inference or engineering recommendation. **[S]** means my own Monte Carlo simulation; the scripts are in `scratchpad/research/sim/`.

---

## 0. Decision summary (read this first)

1. **Measure the adaptation need directly. Do not classify people.** Hurst et al. (IUI 2008) classified pointing traces by group (motor-impaired vs not, 92.7%; young/older/Parkinson's, 91.6%) and predicted Steady Clicks benefit (94.4%) [V]. Two problems follow. The group labels are diagnostic categories, which WebAble forbids. And with per-person holdout, the 3-way accuracy fell to 74.1% [V]. The people Steady Clicks helped were "those who frequently slipped while clicking" [V]. So the thing to measure is the slip rate, not a population label.
2. **Fitts' law is necessary but not sufficient.** Fitts fits for atypical users averaged R² = .51 (range .14 to .81), against .71 for per-user feature-selected models (Gajos et al. UIST 2007) [V]. Wobbrock & Gajos could not normalize motor-impaired (MI) data to 4% errors "due to high variance and not enough trials" [V]. Use ISO/Fitts geometry and formulas for the task, but make the decisions from endpoint spread, observed misses, click slips and repeat presses, not from throughput.
3. **The literature's batteries are 20 to 60 times longer than our budget.** SUPPLE++ ability elicitation took 20-40 min (UIST'07), about 25 min for able-bodied participants and **30-90 min for MI participants** (CHI'08) [V]. MI participants rated it far more physically demanding (4.73 vs 1.82 of 7), and 9 of 11 preferred preference elicitation [V]. The design therefore has to (a) test only the ladder decision boundaries, (b) use one amplitude (Guiard Form×Scale, which gives results equivalent to a full A×W design with one level of A) [V], (c) finish with a preference check, and (d) keep refining after onboarding.
4. **With about 27 scored pointing trials you get the ladder level to ±1 step, not exactly** [S]. For the proposed 44→32→24 design with 9 scored trials per block, simulation gives 44-49% exact level, **81-84% within ±1 level**, and 12-21% under-sized. Going to 20 trials per block (more than double the time) only reaches 51-57% exact and 88-90% within ±1. Real reliability gains come from **aggregating sessions**. At-home Hevelius data went from ICC .68 (1 session) to .81 (2 sessions) to .93 (4 sessions) (Pandey et al. 2023) [V]. Treat onboarding as a prior. Refine it passively, and offer a re-run.
5. **Adaptation outputs should be a coarse ladder.** Minimum target {24, 32, 44, 56, 72, (96 touch)} CSS px; stabilization window {off, 200, 300, 400 ms}; drag {none, some, high}; hover grace {0, 400, 700 ms}. Finer resolution than this is false precision given item 4, and a bounded enumeration fits the "model emits data" invariant [I].
6. **Click slips produce lost clicks on the web more often than wrong clicks.** Per UI Events and Pointer Events, when pointerdown and pointerup targets differ, `click` goes to their nearest common ancestor (Chrome since 73) [A]. A slip off a small button therefore usually activates nothing. An in-page Steady Clicks analogue can recover the intended activation within a 200-400 ms window. That window matches the 200-400 ms cursor-freeze optimum for older adults (Tufail & Kim 2017) [A]. Trewin & Pain found 28.1% of MI mouse clicks contained movement during the click [V, via Wobbrock & Gajos].
7. **Gain-based assistance cannot be delivered by an extension.** PointAssist, sticky icons, and area and bubble cursors all need control of the cursor or the C-D gain. A content script cannot move the OS cursor, and Pointer Lock hides the system cursor, which is not acceptable on arbitrary pages [I]. WebAble can only (a) change target geometry (hit area, spacing), (b) re-interpret click events, and (c) recommend OS settings such as pointer speed, ClickLock, drag lock, Slow/Bounce Keys.
8. **Touch needs a larger ladder and separate calibration.** MI users made 3× more tapping errors on touch than with a mouse (24.9% vs 7.4%). Their touch error rate fell from 42.1% at 6 mm to 7.0% at 18 mm. Findlater et al. recommend **at least 18 mm** (Findlater et al. CHI 2017) [V]. On current phones and tablets that is roughly 70-110 CSS px [I]. Store motor parameters **per input class**. `pointerType` reports `"mouse"` for trackpads, so ask the user which device they use.
9. **Measure the kinematics the adaptations need, not the ones that work as biomarkers.** Mouse kinematics such as normalized jerk, pauses, and click duration support clinical severity estimates (Hevelius, Pandey et al. 2023) [V]. Compute them only transiently where needed. Never persist or transmit them, never compute tremor spectra, and never show population comparisons [I].
10. **The calibration must itself be accessible.** It needs a keyboard path and skip on every screen, no timers (WCAG 2.2.1), no drag requirement (WCAG 2.5.7), high-contrast targets so low vision is not confounded with motor precision, pause and resume, and an exit after any block with a provisional estimate.

---

## 1. Constraints specific to WebAble (what calibration outputs can drive)

| Lever | Deliverable by MV3 content script? | Notes |
|---|---|---|
| Enlarge effective target (hit area) | Yes: CSS padding or `::after` hit-area expansion; verified by post-apply verifier (no overlap, no clipping) | Expansion must stop at half the gap to neighbors, or it steals clicks [I] |
| Increase spacing | Partially: CSS margins/gap on lists, toolbars, and inline links | Layout risk. Verify or roll back |
| Click stabilization (Steady Clicks analogue) | Yes: capture-phase `pointerdown`/`pointerup` listeners plus `element.click()` on the press target | Synthetic `click()` has `isTrusted=false`. The trusted mouse `pointerdown` already granted transient user activation, since HTML lists `mousedown` and `pointerdown` (mouse) as activation-triggering [V]. Some sites ignore untrusted events. Offer only, and exclude drags, selections, sliders, canvas and maps [I] |
| Suppress high-velocity or accidental clicks | Technically yes (`preventDefault` on click) | High false-suppression cost. Offer only, lowest priority [I] |
| Repeat-click debounce | Yes (capture-phase, same element, within T) | Per-site opt-out (steppers, games) |
| Drag alternatives | Only generic ones: enlarge slider thumbs and scrollbars via CSS; surface a page's existing non-drag controls; recommend OS ClickLock/drag lock | No generic synthesized drag. WCAG 2.5.7 puts this on authors [V] |
| Hover grace / close delay | Only for CSS-driven `:hover` menus (e.g., `transition-delay` on hide); not for JS menus | Low confidence (see §3.8) |
| Confirm destructive actions | Yes: WebAble-owned confirm overlay before activation of heuristically destructive controls | Must not alter ARIA or accessible names; opt-in [I] |
| C-D gain, cursor warping, area/bubble cursors | **No** | Recommend OS pointer settings instead |
| Keyboard handling (repeat delay, bounce) | **No (invariant)** | Recommend OS Slow Keys / Bounce Keys / repeat-delay settings only |

---

## 2. Measurement foundations (formulas used later)

### 2.1 ISO 9241-411 / Fitts (Soukoreff & MacKenzie 2004 is the operational reference) [V]
- **Task.** Multidirectional ring (ISO 9241-9, carried into ISO/TS 9241-411:2012). Targets sit on a circle and the user goes across to the opposite target in sequence, which controls for movement direction.
- **ID** = log2(D/W + 1) (Shannon). The recommended research range is 2-8 bits, with **15-25 trials per condition**.
- **Effective width** We = 4.133·SD of endpoints. An error-rate fallback exists when endpoints are not recorded. **Effective distance** De = mean actual distance. IDe = log2(De/We + 1).
- **Throughput.** TP = mean-of-means of IDe/MT across conditions. Wobbrock, Shinohara & Jansen (CHI 2011) found mean-of-means has lower variance than 1/b [V].
- **2-D endpoints.** For ring tasks, **bivariate SDx,y** gives better Fitts models than univariate SDx [V].
- **Form×Scale.** One level of A with varied W gives results equivalent to the full A×W design, which allows "major time savings" [V].
- **Error model** (Wobbrock et al. CHI 2008, validated in 2-D, CHI 2011): given a user's a′, b′ and actual MTe, it predicts error rate. Observed-vs-predicted R² = .953 (SDx) and .936 (SDx,y) [V]. Useful for longitudinal checks. Too data-hungry for onboarding [I].
- **Outliers.** Investigate trials with distance or time more than 3 SD from the mean (misfires, pauses) [V]. The common spatial rule is "movement distance < A/2 or endpoint > 2W from target centre" (Findlater et al. 2017) [V]. **Caution:** the MI group produced such outliers on 4.5% of trials, against 0.5% for others, and the authors kept them as valid [V]. **Do not discard spurious presses from MI users. They are the signal** (repeat and accidental presses).
- **Reference throughputs, mouse pointing** (Wobbrock & Gajos 2008): able-bodied 4.72 bits/s; MI 2.34 bits/s (crossing 2.88) [V]. Use these for time budgeting only, never as norms shown to users.

### 2.2 Path and submovement measures [V unless noted]
- **MacKenzie, Kauppinen & Silfverberg (CHI 2001):** target re-entry (TRE), task-axis crossing (TAC), movement direction change (MDC), orthogonal direction change (ODC), movement variability (MV), movement error (ME), movement offset (MO).
- **Submovement parsing.** Keates et al. 2002 scheme as used by Wobbrock & Gajos 2008: a new submovement starts when raw speed **falls below 0.05 px/ms and then rises above 0.5 px/ms**, computed on raw rather than filtered speed. Hevelius (Pandey 2023) uses 100 px/s → ≥500 px/s. Hevelius signal processing: **resample to 100 Hz, 7 Hz low-pass FIR**. **Pause = gap ≥100 ms** in raw movement events. **Verification time** = end of movement inside target → press. **Click duration** = press→release.
- **Hwang et al. ASSETS 2004:** some MI users pause more often and for longer, need **up to 5× more submovements**, and show an error–peak-speed correlation absent in able-bodied users [A].
- **Ding et al. 2015** (athetoid CP): users spent over 60% of trial time acquiring the target once near it. Slip-offs after first target entry were significantly higher for athetoid than spastic users [V].
- **Reliability** (Pandey et al. 2023, Hevelius at home): with 2 sessions aggregated, MT (ICC .97), number of pauses (.97), longest pause (.97), execution time (.88), click duration (.82) and normalized jerk (.79) were reliable. **Movement offset, movement error, movement variability and maximum deviation from the task axis stayed poor (ICC < .50) even across 4 sessions** [V]. Implication: do not build hover or steering decisions on single-session path-deviation measures [I].

### 2.3 Clicking errors
- **Trewin & Pain 1999:** 20 MI and 6 control users. 15 of 20 MI participants had pointing or clicking difficulty, and **28.1% of mouse clicks contained movement during the click** [V, as reported by Wobbrock & Gajos 2008]. Dragging was also problematic [A].
- **Steady Clicks** (Trewin, Keates & Moffatt, ASSETS 2006) freezes the cursor while the button is down. It also blocks overlapping button presses and clicks made at high velocity. With 11 MI users: significantly fewer attempts per target; significantly faster for the 5 highest-slip users; 9 of 11 preferred it [A]. From Hurst IUI'08 [V]: it significantly reduced slips for 8 of 11 participants. Some were not helped because "other targeting errors remained".
- **Steady Clicks benefit prediction** (Hurst IUI'08) [V] used these features: click duration; other button events during the click; distance moved during the click; velocity and acceleration at press and release; last pause before the click (pause thresholds 100-300 ms in 50 ms steps).
- **Cursor freeze time:** 24 older adults; 0/200/400/600/800 ms tested; **200-400 ms optimum** (Tufail & Kim, Applied Ergonomics 2017) [A].
- **Real-world multi-clicking** (Hurst, Mankoff & Hudson ASSETS 2008, citing Trewin's lab work) [V]: MI users had a **39.5% error rate on double/triple clicks** and a median 28.3% single-click error rate, against 9% and 6.3% for able-bodied users. MI inter-click delays were 100-333 ms, against 50-100 ms. They also report "too many buttons" (both buttons pressed; 13 of 27 incorrect presses). The most important finding is **high within-person variance across sessions**, and a warning against configuring from a single lab session.
- **Windows double-click time** defaults to **500 ms** (max 5000) [V]. The web cannot read or change it. `dblclick` follows the OS. Web UIs rarely require double-click, so it is not worth onboarding time [I].

### 2.4 Ability modeling (SUPPLE++) [V]
- **Tasks and parameters.** Pointing on an ISO ring: W 10-90 px (6 levels), D 25-675 px (7 levels), 16 angles, **387-572 pointing actions per person**. Dragging: 1-D reciprocal, W 10-40 px (3 levels), D 100/300 px, 4 directions, **about 40 drags**. List selection: scroll windows of 5/10/15 items, item distance 10-120, clickable-element size 15/30/60 px. Multiple clicking: 5 targets of 10-60 px.
- **Models.** Per-user feature selection over {1, ID, log2 D, log2 W, W, 1/W, D}, 127 candidate models, 10-fold CV, most parsimonious within 1%. MT_drag = a + b·MT_point(D, W). Multi-click MT_click = a + b·log W. Users who cannot drag skip the task, and drag is then priced as effectively infinite.
- **Outcome.** Ability-based UIs made MI users **26.4% faster with 73% fewer errors**, and were preferred over manufacturer defaults. Some MI participants preferred targets of at least 30 px.
- **Lesson for WebAble [I].** The battery length is not portable. The modeling ideas are: minimum usable size can be non-Fitts (e.g., an eye-tracker user plateaued above about 25-40 px regardless of D); drag is modelled relative to pointing; and "cannot drag" is a legitimate answer.

### 2.5 Assistance techniques that need cursor control (why they are out of scope)
- **Area cursors and sticky icons** (Worden et al. CHI 1997): gain cut 30% near targets; up to 50% faster on the smallest targets for older adults [A].
- **PointAssist** (Hourcade et al. CHI 2010; Salivia & Hourcade CHI 2013): analyzes submovement characteristics to detect precision-phase trouble and assists (20 older adults, 66-88) with better accuracy than Windows "Enhance pointer precision" [A].
- **Enhanced area cursors** (Findlater et al. UIST 2010): error rates of 14.3% for the point cursor vs 2.5-6.0% for enhanced cursors; corrective submovements −45% [V].
- **Goal crossing** favored MI users in throughput (Wobbrock & Gajos 2008) [V].
- All of these need control of the cursor or its gain, so the extension cannot deliver them. WebAble can use their detection logic (precision-phase submovements, slips) as measurement ideas and recommend OS-level tools.

### 2.6 Touch
- **Findlater et al. CHI 2017** [V]: 16 MI and 16 non-MI users, iPad vs mouse. Each task had 5 practice and 55 test trials; sessions ran up to 90 min for MI users. Touch was faster overall, but for MI users tapping errors were **24.9% touch vs 7.4% mouse**. MI touch error was 42.1% at 6 mm and 7.0% at 18 mm, giving a recommendation of **≥18 mm**. Spurious touches were frequent in the MI group, and higher in continuous-contact tasks (drag, cross, steer). On the test device, 32 CSS px = 6 mm (about 0.19 mm per CSS px).
- **FFitts** (Bi, Li & Zhai CHI 2013) [V]: touch endpoints are a sum of a relative (speed-accuracy) Gaussian and an absolute-precision Gaussian, with **σa ≈ 1.5 mm** for able-bodied finger touch. ID_f = log2(A/√(2πe(σ² − σa²)) + 1). WebAble's analogue is to estimate the user's own absolute floor σa in CSS px (§5.5).
- **Smart Touch** (Mott et al. CHI 2016): MI users touch with the back or side of the hand, several fingers, or knuckles, which produces multi-point contacts. Template matching placed the intended point more than 3× closer than land-on or lift-off [A].
- **Trewin, Swart & Pettick (ASSETS 2013):** spurious touches common; swiping was not disproportionately hard [A].
- **Chen et al.** (Applied Ergonomics 2013) and related work from the same group: buttons ≥20×20 mm reduce adverse effects on touchscreen performance [A].

### 2.7 Hover
- Cascading menus conventionally post and unpost submenus after an explicit delay (for example 200 ms). Choosing that delay is a speed/error trade-off, and adaptive activation areas are one proposed fix (Tanvir et al. IJHCS 2011; Kobayashi & Igarashi UIST 2003) [A].
- **jQuery hoverIntent defaults:** interval 100 ms, sensitivity 6 px, timeout 0 ms [A]. These are an engineering reference for the web.
- **WCAG 1.4.13** requires hover content to be dismissible, hoverable and persistent. Its role here is design guidance for WebAble's own UI and for grace-delay operations.

### 2.8 In-the-wild measurement
- **Input Observer** (Evans & Wobbrock CHI 2012): lab and field measures agreed closely: MT 971 vs 870 ms, error 4.42% vs 4.66%, TP 3.48 vs 3.45 bits/s [A]. Everyday pointing can be segmented into trials and measured.
- **Findlater et al. ASSETS 2020:** 700+ participants, 318 analyzed in detail, 53% reporting a motor impairment. **Age and self-reported motor ability should not lead to assumptions about input performance** [A]. This supports measuring directly rather than asking "do you have a condition?".

---

## 3. Browser platform realities

### 3.1 Events and sampling [V: MDN BCD 8.1.3, 2026-09-24]
| API | Chrome | Firefox | Safari / iOS | Use |
|---|---|---|---|---|
| `PointerEvent.pointerType`, `width/height`, `pressure` | 55 | 59 | 13 | Input class; touch contact size where the platform reports it (often 1×1) |
| `getCoalescedEvents()` | 58 | 59 | **18.2** | Full-rate samples (secure context). Fallback is rAF-aligned `pointermove` |
| `getPredictedEvents()` | 77 | 89 | 18.2 | Not needed |
| `pointerrawupdate` | 77 | 148 | **no** | Not needed: MDN notes no extra precision, only lower latency |
| `@media (any-pointer)`, `(hover)` | yes | yes | yes | Initial guess only |

- **Pipeline.** Take `pointermove` plus coalesced events with their own `timeStamp`. Resample to 100 Hz by linear interpolation and low-pass at 7 Hz for kinematics. Compute submovements, press velocity and slips on **raw** positions, as in Wobbrock & Gajos, because filtering flattens short peaks [V]. At 60 Hz without coalescing, submovement counts are biased low, so flag it [I].
- **Touch.** Set `touch-action: none` on the task surface, and record `pointercancel`. Otherwise panning cancels trials [I].
- **Focus and visibility.** If `visibilitychange` or window blur happens mid-block, void the block [I].

### 3.2 Units and devices
- **CSS px is a reference-pixel (visual-angle) unit.** Physical size per CSS px varies by device, roughly 0.16-0.28 mm [I; W3C CSS Values 4]. The calibration and the adaptation both act in CSS px on the same device, so **measure and apply in CSS px and never convert to mm**. Physical-size calibration (for example holding a card to the screen) is burdensome and unnecessary [I].
- **Zoom.** In Chromium and Firefox, `devicePixelRatio` includes browser zoom [I, verify for Safari]. Store `S*_css` together with `dpr_cal`. On the same screen, apply `S*_css × dpr_cal / dpr_now`, since physical size ∝ CSS px × DPR for a fixed panel. On a different screen, detected by a coarse change in screen dimensions, use `S*_css` unchanged. The extension can read per-tab zoom via `chrome.tabs.getZoom` [I].
- **Pointer acceleration and OS pointer speed** make CSS-px amplitude a poor proxy for hand movement. Throughput and velocity thresholds are **device-bound**. Compare only within the same device class and settings [I].
- **Trackpad vs mouse** is not exposed: both report `pointerType:"mouse"`. Heuristics (fractional wheel deltas, frequent `deltaX`, ctrl+wheel pinch) are unreliable [I], so **ask**. Tap-to-click trackpads produce near-zero slips, while physical-click trackpads can slip. Keep separate profiles for mouse, trackpad, touch, and alternative pointers such as trackball, head or eye.
- **Click semantics.** When press and release targets differ, `click` fires on the nearest common ancestor. Under pointer capture it goes to the captured target [A: UI Events / Pointer Events; Chromium change in 73]. WCAG 2.5.2 (pointer cancellation) encourages activation on the up-event, so slips usually cancel activations rather than misfire them [I].

---

## 4. Accessibility requirements for the calibration itself
1. **Entry choice** "How do you usually point?": mouse, trackpad, touchscreen, trackball/joystick, head or eye pointer, stylus, "keyboard / switch / voice, skip this", or "not sure". Pre-select from the first `pointerType`, `any-pointer` and `hover`. The user must confirm.
2. **Every screen** has visible, focusable **Skip this step** and **Pause** controls. There is no focus trap and no timers, and a trial never times out (WCAG 2.2.1). After 20 s idle, show a gentle "Take your time, or skip".
3. **Targets** are real `<button>`s with names ("Target 3 of 9"). Keyboard activation of a target is recorded as `input=keyboard` and switches the flow to a keyboard-mode message instead of scoring it. Progress is announced through a polite live region.
4. **No drag is required** anywhere except the optional drag step, which has an "I can't or prefer not to drag" button (WCAG 2.5.7).
5. **Vision confound.** The active target uses ≥7:1 fill contrast and a thick ring. Inactive targets are outlined only. The task honors `forced-colors` and `prefers-reduced-motion`. Run it **after** the low-vision calibration, or inherit its text and contrast scale, so small-target misses are not caused by not seeing the target [I].
6. **Cognitive load:** one instruction per screen, no score, no speed pressure. Copy: "Click each highlighted circle at your normal, comfortable pace."
7. **Exit anytime.** Any completed ring block yields a provisional profile marked with low confidence.
8. **Keyboard, switch and voice users.** Pointing parameters are left `null`, not defaulted. Keyboard-only users may take an optional 10 s check (Tab through 6 buttons, activate one). It logs key-hold p95, `KeyboardEvent.repeat` occurrences and double presses within 100 ms. These feed **OS-setting recommendations only** (Slow Keys, Bounce Keys, repeat delay), because WebAble must not change keyboard handling. They can also support a CSS-only focus-indicator enhancement, which changes style, not focus order [I]. Voice users relying on Voice Control or grid overlays benefit from spacing: offer spacing level 44 as a preference, not a measurement.
9. **Dwell-click users** (head or eye pointer with dwell) show near-zero slip and nearly constant verification time. Flag the pattern when verification-time CV < 0.15 and median ≥ 500 ms. Do not treat long verification as difficulty, and default `drag` to "high" [I; cf. Gajos ET01, whose Fitts fit was R² .14].

---

## 5. Concrete task design

### 5.0 Design principles
Test **ladder boundaries**, not a Fitts grid. Use **one amplitude** (Form×Scale). Descend from comfortable to hard and stop early on struggle. Always end on an easy success. Fold in a **preference check**. Hold raw data in memory only.

### 5.1 Screen flow and time budget
Targets for a typical user are about 0.7 s per ring click. For MI users, budget about 1.5-2.5 s per click (TP of about 2.3 bits/s plus longer verification) [I from §2.1].

| # | Screen | Trials | Typical time | Slow-user time | Skippable |
|---|---|---|---|---|---|
| S0 | Input method choice + 1-sentence purpose ("not a test, no score") | – | 6-10 s | 10 s | – |
| S1 | Warm-up: 3 targets in a row, 56 px (touch 72); unscored | 3 clicks | 4 s | 8 s | yes |
| S2 | Ring, adaptive, 9-target ring, 1 unscored + 9 scored clicks per block, 2-4 blocks | 20-40 clicks | 20-30 s | 45-75 s | after block 1 |
| S3 | Hold steady & click in place (pointer devices); tap in place (touch) | 2 holds + 2 clicks / 4 taps | 6 s | 10 s | yes |
| S4 | Drag token to well | 3 drags | 8 s | 15-20 s | yes ("I can't / prefer not") |
| S5 | Return block at the S2 starting size (drift check, ends on a success) | 5 clicks | 4 s | 8 s | auto-skipped if time > 150 s |
| S6 | Preview & choose: sample UI (icon toolbar, link list, form) at S* and one level either side; user picks "most comfortable" | 1 choice | 8-10 s | 12 s | yes |
| | **Total** | | **about 60-75 s** | **about 110-150 s (hard cap on trials, not time)** | |

**Express mode** (offered if S2 block 1 median MT exceeds 2.5 s): ring stops after 2 blocks, and S4 and S5 are skipped.

### 5.2 Geometry
- **Ring:** 9 circular targets, odd count so the ISO sequence alternates across the circle. Ring diameter D = clamp(round(0.28·min(innerW, innerH)), 160, 280) CSS px for pointer devices, and clamp(0.30·min, 120, 260) for touch. Successive-target distance A = D·sin(4π/9) ≈ 0.985·D. With D = 240 (A ≈ 236): ID = 2.67 / 3.07 / 3.44 bits at W = 44 / 32 / 24 (inside the 2-8 bit ISO range, low end, by design).
- **Pointer ladder walk:** start at **44**. If accepted, go to 32, then 24. If 44 is rejected, go to 56, then 72. Stop at the first rejection when descending or the first acceptance when ascending, with a maximum of 4 blocks.
- **Touch ladder walk:** start at **56**. Accepted → 44 (and 32 only if 44 is accepted with 0 misses). Rejected → 72, then 96.
- **Block acceptance rule** (per block, applied as it finishes): accept W if (observed misses ≤ 1 of 9) **and** (σ̂(W)·1.15 ≤ W/4.895), where σ̂ is defined in §5.5. The σ condition is the circular-target 5% miss radius with a 15% conservatism margin. The miss guard protects against σ̂ underestimating when the endpoint distribution is not Gaussian.
- **Viewport too small** (D < 120): switch to a 1-D horizontal reciprocal pair with the same W ladder.
- **S3 hold:** one 44 px target (touch 56) at the ring center. "Rest the pointer inside until the ring fills" takes 1.5 s of **cumulative** time inside, so leaving pauses the fill but never fails the trial. Then "click it without moving". Two repetitions. For touch there is no hover, so use 4 taps in place on the target.
- **S4 drag:** a 44 px token dragged into a 72 px well 200 px away (touch 160), axes horizontal, vertical, horizontal. A drop counts inside if the token center is in the well. No time limit.
- **S5 return:** 5 clicks on the S2 starting size, reusing the ring.

### 5.3 Trial protocol
- A trial starts at the previous press release and ends at the next **release**. Press position decides hit or miss (as in SUPPLE++ and most widgets, both press and release in target = success) [V]. Record both.
- Misses get subtle, non-punitive feedback (outline flash, no sound). **No redo.** Misses and spurious presses are data (see Findlater's MI outlier caveat).
- The first click of each block is unscored (positioning), as in Hevelius and FittsStudy practice trials [V].
- If `pointerType` changes mid-block, restart the block and record both input classes. If DPR changes (zoom) or visibility is lost, void the block.

### 5.4 Per-trial record (RAM only; discarded at session end)
`block_W, A, target_center(x,y), start_xy, t_start, t_move_onset, n_entries, t_final_entry, t_down, xy_down, t_up, xy_up, hit_down, hit_up, press_ms, slip_px=|xy_up−xy_down|, press_path_max_px, v_down (mean speed over 50 ms before down, px/ms), path_len, n_submovements (0.05→0.5 px/ms raw), n_pauses (≥100 ms gaps), verif_ms (final entry→down), extra_presses [{dt_ms, dist_px, same_target}], pointerType, coalesced_available, cancel`.
Raw samples (x, y, t) are kept only until the trial's features are extracted (a ring buffer of about 3 s), then dropped.

### 5.5 Derived statistics (client-side)
Coordinates are relative to the **target center**, in CSS px.

1. **Robust endpoint scale (per block):** σ̂(W) = median(r_i) / √(2 ln 2) = median(r)/1.1774, where r_i is the press-point distance from target center, after excluding presses more than 2W away (these are counted separately as *fly-by/spurious presses*, not deleted). This is the isotropic bivariate-normal estimator. It is robust to a few lapses and includes aim bias, which matters for hits. Also keep plain bivariate SDx,y from the centroid for We [I].
2. **We, IDe, TP (info and drift only):** We = 4.133·SDx,y; IDe = log2(Ae/We + 1); TP_block = IDe / mean(MT). Session TP = mean-of-means. Store it only for same-device drift comparison. Never show it.
3. **Absolute precision floor:** fit σ̂(W)² = σa² + (c·W)² across tested blocks by least squares, with σa² ≥ 0 and c ∈ [0.08, 0.30]. This is the FFitts dual-distribution idea applied to any pointer. σa is the part that does **not** shrink when targets shrink (jitter, slip, device noise); c is the user's speed-accuracy strategy.
4. **Predicted miss rate** for a circular target of diameter L: P_miss(L) = exp(−L² / (8·σ(L)²)), with σ(L)² = (1.15·σ̂a)² + (ĉL)². For rectangles w×h: P_hit = erf(w/(2√2σ))·erf(h/(2√2σ)).
5. **Recommended minimum target S\*** = the smallest ladder level L with P_miss(L) ≤ 8% **and** no tested block at L with ≥ 3/9 observed misses. If the walk accepted a level directly, S\* = min(that level, model S\*) only when the two agree within 1 level. Otherwise take the larger [I].
6. **Slip statistics** (ring + S3 clicks, about 25-35 presses): slip-off = hit_down ∧ ¬hit_up. k_slip = number of slip-offs; r_slip95 = p95(slip_px); press_p90 = p90(press_ms).
7. **Accidental repeats:** an extra press within 500 ms of a completed press with dist < 5 px or on the same target. The 500 ms is the Windows double-click default, used as a reasonable repeat horizon [V/I]. k_rep = count; Δt_rep95 = p95 interval.
8. **Fly-by presses:** a press outside every target with v_down > v_hi, where v_hi = max(0.8 px/ms, 3·median(v_down on hits)). Count k_fly.
9. **Hover and settling:** from S3, the jitter radius r_j = p95 distance from the centroid during the hold (after a 300 ms settle), plus exits during the hold. From the ring (smallest accepted block): re-entries per trial = mean(n_entries − 1), and verification time median.
10. **Drag:** per trial, success, early release (released before first entering the well), n_regrabs, MT_drag. R_drag = median MT_drag / median MT_point at the nearest ID (the SUPPLE++ MT_drag = a + b·MT_point idea, reduced to a ratio).
11. **Drift/fatigue:** ΔMT = median MT(S5) / median MT(first block at the same W) and Δmiss. A fatigue flag is set when ΔMT > 1.3 and misses(S5) ≥ 1/5 [I].
12. **Quality flags:** coalesced_available, sample-rate estimate, blocks voided, dwell pattern (§4.9), express mode, user override.

### 5.6 Confidence estimates
- **S\*:** client-side parametric bootstrap. Resample the press points within each block 200 times, refit, and recompute S\* (about 30 points × 200 fits, well under 50 ms). **conf = share of bootstrap S\* equal to the chosen level.** Label *high* ≥ 0.7, *medium* 0.4-0.7, *low* < 0.4. The expected population behaviour of this estimator (simulation, Appendix A): about 45% exact, about 82% within ±1 level, about 12% under-sized with the 1.15 margin.
- **Binary offers** (stabilization, debounce, confirm): Jeffreys posterior P(rate ≥ 5% | k of n). With n = 30: k = 0 → .08, 1 → .38, **2 → .70**, 3 → .89, 4 → .97 [S]. Offer when the posterior is ≥ .70 (≈ k ≥ 2 of 30). Power and false alarms of "≥2 of 30" [S]: true rate 1% → 3.6% false offer; 5% → 45% detection; 10% → 82%; 20% → 99%. Heavy slippers (Trewin & Pain's 28% movement-during-click population) are caught almost surely. Borderline users are left to in-the-wild evidence.
- **Error-rate CIs are wide** (Clopper-Pearson 95%) [S]: 0/9 → [0, 34%]; 1/9 → [0.3, 48%]; 2/9 → [3, 60%]; 0/27 → [0, 13%]; 2/27 → [1, 24%]. This is why block acceptance combines misses with the endpoint-spread model instead of using misses alone. In simulation, a misses-only rule under-sized 53-71% of users [S].

### 5.7 Mapping to adaptation parameters

| Parameter | Derivation (thresholds) | Confidence / delivery |
|---|---|---|
| **Min effective target size** `S*` ∈ {24, 32, 44, 56, 72, 96t} CSS px | §5.5 item 5. Then combine with the S6 choice: if the choice is ≥ S\* → use the choice (never deny more accommodation). If the choice is 1 level below → use the choice. If ≥2 levels below → use the choice but flag `override` and re-offer after in-the-wild evidence (autonomy) [I] | Bootstrap conf. Applied as hit-area expansion (visual size unchanged where possible), which goes through verify-or-rollback |
| **Spacing** | Exclusion radius per actionable target = S\*/2 + r_slip95·(stab_on ? 0 : 1). Adjacent actionable targets need center distance ≥ 2× that. This generalizes WCAG 2.5.8's 24 px-circle spacing exception to S\* [I] | Same conf as S\*. Hit-area expansion capped at half the gap |
| **Click stabilization** (Steady Clicks analogue) | Offer if P(slip-off ≥ 5%) ≥ .70 **or** r_slip95 ≥ 0.25·S\*. Window T = clamp(press_p90 + 50, 200, 400) ms (Tufail & Kim range). Radius r = clamp(1.5·r_slip95, 6, S\*/2). Behavior: if press is on actionable E, release is off E within r and T, and no drag, selection or slider is involved → activate E | Offer on results screen (opt-in). Log recovered clicks locally for learning |
| **Fly-by click suppression** | Offer only if k_fly ≥ 2 **and** stabilization accepted; v_hi from §5.5 item 8 | Lowest priority; default off |
| **Repeat-click debounce** | Offer if P(repeat ≥ 5%) ≥ .70. T_db = clamp(Δt_rep95 + 100, 300, 600) ms, same element only | Opt-in; per-site opt-out |
| **Drag alternatives** | *high* if the step was skipped or self-reported, **or** ≥2 of 3 failed, **or** (any early release and R_drag > 2.0); *some* if 1 of 3 failed or R_drag in 1.5-2.0; else *none*. Thresholds are provisional, to be tuned in the pilot [I] | high → surface a page's non-drag controls, enlarge slider thumbs and scrollbars, recommend OS ClickLock (Windows) or drag lock (macOS); WebAble's own UI never requires drag |
| **Hover grace (close delay)** | 0 by default. 400 ms if re-entries ≥ 0.5 per trial or r_j ≥ 0.25·S\*. 700 ms if ≥ 1.0 per trial or r_j ≥ 0.5·S\* | **Low** confidence (path measures unreliable per Pandey 2023). Offer only after in-the-wild confirmation (a hover menu closes and the same trigger is re-hovered within 1 s, ≥3 times) |
| **Confirm destructive actions** | Offer if P(unintended activation ≥ 5%) ≥ .70, where the unintended count = misses at S\* + slip-offs (if stabilization is declined) + k_rep + k_fly | Opt-in; heuristic destructive detection (the button's own text or name read, never modified) |
| **OS recommendations** | Low TP with many submovements → suggest lowering pointer speed. Drag high → ClickLock or drag lock. Keyboard check → Slow or Bounce Keys | Informational links only |
| **"Harder day" toggle** | Always available in the popup: +1 ladder level for the session. Motivated by high within-person variance (Hurst ASSETS'08) and medication or fatigue swings (Hurst IUI'08) [V/I] | User-controlled |

### 5.8 What persists (profile `motor` section, about 0.6 KB; no raw data)
```json
{"motor":{
 "input_class":"mouse|trackpad|touch|alt_pointer|none", "calibrated":"2026-09-28", "dpr_bucket":2, "screen_bucket":"L",
 "min_target_css":44, "min_target_conf":0.61, "spacing_css":52,
 "stabilize":{"offer":true,"window_ms":300,"radius_css":10,"conf":0.89},
 "repeat_debounce":{"offer":false}, "flyby_suppress":{"offer":false},
 "drag":"some", "hover_grace_ms":0, "hover_conf":"low", "confirm_destructive_offer":false,
 "user_choice":{"size":44,"override":false},
 "quality":{"blocks":3,"express":false,"coalesced":true,"dwell_pattern":false,"fatigue_flag":false},
 "drift":{"tp_bits_s":3.9,"sigma_a_css":2.1,"per_block":[[44,9,0,4.1,612],[32,9,1,4.6,688],[24,9,2,5.9,801]]}}}
```
`per_block` = [W, n, misses, σ̂, median MT]. It exists only for same-device drift checks and recalibration offers.

**Discarded at session end:** all samples, per-trial arrays, trajectories, timestamps, and anything that is a kinematic biomarker (normalized jerk, pause distributions, submovement profiles, tremor-band power, which is never computed). Exact screen dimensions, UA string and absolute timestamps are also not stored; coarse buckets are enough. Nothing leaves the device except this JSON [I].

### 5.9 Non-diagnostic wording rules
Use functional names (`click_steadiness`, `precision_floor`), never "tremor", condition names, "impairment level" or "score". Never compare the user to population norms. On the results screen say "Larger click areas will likely make browsing easier on this device" and show what was measured and what was kept (privacy by design) [I].

---

## 6. After onboarding: refinement and recalibration
- **Passive evidence (extension, aggregated daily, no URLs):** lost clicks (press on actionable, release off, no activation), recovered clicks (when stabilization is on), rapid same-element repeats, near-miss presses (a press on non-actionable within S\*/2 of an actionable, followed within 2 s by a press on it; Input-Observer-style trial segmentation), hover re-open loops. Keep counts per input class only.
- **Update rule:** treat S\* as a Beta or ordinal posterior. Propose a change of level only when the posterior for an adjacent level exceeds .8, and always as an offer with undo (offer-never-impose). Never auto-shrink below the user's own chosen size.
- **Re-run offers:** after 14 days of use, or when drift is detected (lost-click rate doubles week over week), offer the 60 s re-run. Two sessions give roughly the ICC .68→.81 jump seen in Hevelius [V].

---

## 7. Risks and open questions
1. **Simulation assumptions** (isotropic Gaussian endpoints, 4% lapses, c ∈ [0.12, 0.20]) are idealized. Real MI endpoints are skewed and bimodal, as with athetosis slip-offs [I]. **Pilot:** 20-30 participants spanning the three WebAble groups. Compare the 70 s design with a 6-minute reference battery (full ring at 6 W × 15 trials) and with one-week in-the-wild outcomes, and test-retest within a week. Primary metric: ladder agreement within ±1.
2. **Instruction effects.** "Normal pace" vs "accurately" shifts σ via c. Keep the instruction fixed across sessions.
3. **Synthetic activation compatibility.** Measure the share of sites where `element.click()` from a stabilizer fails to trigger handlers (React and Angular generally accept it; anti-bot flows may not).
4. **Trackpad tap-to-click and touch** produce different slip semantics. Keep the thresholds separate per class.
5. **The vision confound** remains for low-vision users even with high contrast. Consider rerunning small blocks at the user's low-vision scale.
6. **Hover grace for JS-driven menus** is not generically achievable. Do not promise it.

---

## Appendix A: Simulation (scripts in `scratchpad/research/sim/`)
- Model: endpoints ~ N(0, σ(W)²·I₂), σ(W)² = σa² + (cW)², c ~ U(0.12, 0.20), 4% lapses offset by N(0, 3W). Estimator: robust radial σ̂ per block, least-squares fit of σa and c, 1.15 inflation, P_miss ≤ 8% ladder rule. Truth: smallest ladder level with true P_miss ≤ 8%. σa ∈ {0.5..14} px, 3000 reps each.
- Results, fixed blocks (44, 32, 24) (`fit.py`):

| scored trials/block | inflate | exact | within ±1 | under-sized | over by ≥2 |
|---|---|---|---|---|---|
| 6 | 1.00 | .46 | .81 | .21 | .13 |
| 6 | 1.15 | .42 | .78 | .12 | .20 |
| **9** | **1.15** | **.44** | **.81** | **.12** | **.17** |
| 9 | 1.00 | .49 | .84 | .21 | .11 |
| 12 | 1.15 | .47 | .84 | .11 | .14 |
| 20 | 1.15 | .51 | .88 | .09 | .11 |
| 20 | 1.30 | .40 | .80 | .04 | .19 |

- A misses-only acceptance rule under-sized 53-71% of users (`stair.py`). A rule without a model is not safe with 9 trials per block.
- The relative SE of an SD estimate from n 2-D endpoints (pooled axes) is 1/√(4(n−1)): n = 9 → 17.7%, 18 → 12.1%, 27 → 9.8%, 50 → 7.1%.

---

## Sources
- Soukoreff & MacKenzie 2004, *Towards a standard for pointing device evaluation*, IJHCS 61. https://www.yorku.ca/mack/ijhcs2004.pdf [V]
- ISO/TS 9241-411:2012. https://www.iso.org/standard/54106.html [A]
- MacKenzie, Kauppinen & Silfverberg, CHI 2001, *Accuracy measures for evaluating computer pointing devices*. https://dl.acm.org/doi/10.1145/365024.365028 [A]
- Wobbrock, Shinohara & Jansen, CHI 2011, *The effects of task dimensionality, endpoint deviation, throughput calculation, and experiment design…* https://faculty.washington.edu/wobbrock/pubs/chi-11.01.pdf [V]
- Wobbrock, Jansen & Shinohara, CHI 2011, *Modeling and predicting pointing errors in two dimensions*. https://faculty.washington.edu/wobbrock/pubs/chi-11.07.pdf [V]
- Wobbrock & Gajos, TACCESS 2008, *Goal crossing with mice and trackballs for people with motor impairments*. https://faculty.washington.edu/wobbrock/pubs/taccess-08.pdf [V]
- Findlater et al., UIST 2010, *Enhanced area cursors*. https://faculty.washington.edu/wobbrock/pubs/uist-10.pdf [V]
- Gajos, Wobbrock & Weld, UIST 2007, *Automatically generating user interfaces adapted to users' motor and vision capabilities*. https://www.eecs.harvard.edu/~kgajos/papers/2007/kgajos-uist07.pdf [V]
- Gajos, Wobbrock & Weld, CHI 2008, *Improving the performance of motor-impaired users with automatically-generated, ability-based interfaces*. https://www.eecs.harvard.edu/~kgajos/papers/2008/kgajos-chi08-supple.pdf [V]
- Hurst, Hudson, Mankoff & Trewin, IUI 2008, *Automatically detecting pointing performance*. http://www.cs.cmu.edu/~akhurst/publications/iui-hurst-08.pdf [V]
- Hurst, Mankoff & Hudson, ASSETS 2008, *Understanding pointing problems in real world computing environments*. http://www.cs.cmu.edu/~akhurst/publications/assets-hurst-08.pdf [V]
- Hurst, Hudson, Mankoff & Trewin, TACCESS 5(2) 2013, *Distinguishing users by pointing performance in laboratory and real-world tasks*. https://dl.acm.org/doi/10.1145/2517039 [A]
- Trewin & Pain 1999, *Keyboard and mouse errors due to motor disabilities*, IJHCS 50(2). https://www.sciencedirect.com/science/article/abs/pii/S1071581998902385 [A]
- Trewin, Keates & Moffatt, ASSETS 2006, *Developing Steady Clicks*. https://research.ibm.com/publications/developing-steady-clicks-a-method-of-cursor-assistance-for-people-with-motor-impairments (DOI 10.1145/1168987.1168993) [A]
- Tufail & Kim 2017, *Effects of cursor freeze time on the performance of older adult users on mouse-related tasks*, Applied Ergonomics 65. https://www.sciencedirect.com/science/article/abs/pii/S0003687017301473 [A]
- Keates, Hwang, Langdon, Clarkson & Robinson, ASSETS 2002, *Cursor measures for motion-impaired computer users*. https://dl.acm.org/doi/10.1145/638249.638274 [A]
- Hwang, Keates, Langdon & Clarkson, ASSETS 2004, *Mouse movements of motion-impaired users: a submovement analysis*. https://dl.acm.org/doi/10.1145/1028630.1028649 [A]
- Keates & Trewin, ASSETS 2005, *Effect of age and Parkinson's disease on cursor positioning using a mouse*. https://dl.acm.org/doi/10.1145/1090785.1090800 [A]
- Hourcade, Nguyen, Perry & Denburg, CHI 2010, *PointAssist for older adults*. https://dl.acm.org/doi/10.1145/1753326.1753494 [A]; Salivia & Hourcade, CHI 2013, *PointAssist: assisting individuals with motor impairments*. https://dl.acm.org/doi/10.1145/2470654.2466157 [A]
- Worden, Walker, Bharat & Hudson, CHI 1997, *Area cursors and sticky icons*. https://dblp.org/rec/conf/chi/WordenWBH97.html [A]
- Ding et al. 2015, *Improving target acquisition for computer users with athetosis*, Assistive Technology. https://pmc.ncbi.nlm.nih.gov/articles/PMC4670556/ [V]
- Pandey et al. 2023, *Accuracy and reliability of at-home quantification of motor impairments* (Hevelius), TACCESS 16(1). https://pmc.ncbi.nlm.nih.gov/articles/PMC12363608/ [V]
- Findlater, Moffatt, Froehlich, Malu & Zhang, CHI 2017, *Comparing touchscreen and mouse input performance by people with and without upper body motor impairments*. https://obj.umiacs.umd.edu/chi2017/Findlater_ComparingTouchscreenAndMouseInputPerformanceByPeopleWithAndWithoutUpperBodyMotorImpairments_CHI2017.pdf [V]
- Findlater et al., ASSETS 2020, *Input accessibility: a large dataset…* https://dl.acm.org/doi/10.1145/3373625.3417031; data: https://github.com/leahkf/mouseandtouchinput [A]
- Bi, Li & Zhai, CHI 2013, *FFitts law*. https://research.google.com/pubs/archive/41645.pdf [V]
- Mott, Vatavu, Kane & Wobbrock, CHI 2016, *Smart Touch*. https://dl.acm.org/doi/10.1145/2858036.2858390 [A]
- Trewin, Swart & Pettick, ASSETS 2013, *Physical accessibility of touchscreen smartphones*. https://researchgate.net/publication/262272050_Physical_accessibility_of_touchscreen_smartphones [A]
- Chen, Savage, Chourasia, Wiegmann & Sesto 2013, Applied Ergonomics 44(2). https://pubmed.ncbi.nlm.nih.gov/23021630/ [A]
- Evans & Wobbrock, CHI 2012, *Taming wild behavior: the Input Observer*. https://dl.acm.org/doi/10.1145/2207676.2208338 ; http://depts.washington.edu/acelab/proj/io/index.html [A]
- Tanvir, Bunt, Cockburn & Irani, IJHCS 2011, *Improving cascading menu selections with adaptive activation areas*. http://hci.cs.umanitoba.ca/assets/publication_files/2011-journal-erum-menu.pdf [A]; Kobayashi & Igarashi, UIST 2003. https://www.researchgate.net/publication/220876910 [A]
- hoverIntent defaults. https://briancherne.github.io/jquery-hoverIntent/ [A]
- WCAG 2.2 Understanding: 2.5.8 https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html [V]; 2.5.7 https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html [V]; 2.5.5 https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html; 1.4.13 https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html; 2.2.1 https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html; 2.5.2 https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html
- MDN `getCoalescedEvents` https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents [V]; `pointerrawupdate` https://developer.mozilla.org/en-US/docs/Web/API/Element/pointerrawupdate_event [V]; browser-compat-data 8.1.3 https://github.com/mdn/browser-compat-data [V]
- Pointer Events spec https://www.w3.org/TR/pointerevents/ ; Chromium click-target change https://issues.chromium.org/issues/41448177 [A]
- HTML Standard, activation-triggering input events. https://html.spec.whatwg.org/multipage/interaction.html [V]
- CSS Values 4, reference pixel. https://www.w3.org/TR/css-values-4/#reference-pixel
- Windows `SetDoubleClickTime` (default 500 ms, max 5000). https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setdoubleclicktime [V]
