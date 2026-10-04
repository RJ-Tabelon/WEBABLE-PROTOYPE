# WebAble: the simplest personalization and learning loop that works

Research report, 2026-09-28. Scope: per-user preference learning for the adaptation engine (which operations to apply, offer, or skip, and at what intensity), plus privacy-preserving product-level learning that improves global priors. No heavy ML infrastructure. Everything below runs in the extension service worker in well under 1 ms per decision. The synced state is about 2 KB.

Status of evidence: citations were checked this session unless marked *(not re-verified)*. Numbers labeled **SIM** come from a synthetic simulation I ran for this report (`scratchpad/research/sim4.py`). They are useful for comparing policies against each other. They are not user data.

---

## 0. Decision summary

1. **Use two conjugate learners and a deterministic policy. Do not use a bandit library, TS, UCB, or contextual models in v1.**
   - **Learner A, desirability.** One Beta-Bernoulli per operation, at two levels: personal and (personal x domain). The domain level shrinks toward the personal level through a capped pseudo-count (kappa = 4). The personal level shrinks toward a calibration-derived prior with strength m0 = 4 + 6·confidence (at most 10 pseudo-observations).
   - **Learner B, intensity.** One Gaussian per functional dimension in log space, with a sparse per-domain offset. Settled adjustments get a Kalman update. One-shot larger/smaller nudges get a probit (TrueSkill/Glicko-style) moment-matching update.
2. **The policy is expected utility on the posterior mean, with a thresholded action ladder: skip, offer, or auto-apply.** Auto-apply keeps running only if P(helpful) ≥ 0.70. That threshold corresponds to C/B ≈ 2.3, meaning an unwanted change costs about twice as much as a wanted change helps (Gajos et al. 2008). An offer needs P ≥ 0.40, plus rate limits and cooldowns.
   - Learning can only **demote** auto-apply to offer by itself. **Promotion** from offer to auto-apply always goes through a one-time "Always do this?" question, which satisfies offer-never-impose.
   - **SIM result.** Against a static profile-only policy, the learner cut unwanted auto-applies by about 40% (3.6 vs 6.0 per 100 applicable visits). When the user's preferences reversed mid-way, it held at about 4.1 vs 13.2.
   - Thompson sampling produced 20-75% more unwanted auto-applies and lower net utility. Optimistic (Bayes-UCB q80) offers made no measurable difference, so the posterior mean is enough.
3. **Signals are weighted pseudo-observations, and each goes to the right target.**
   - Explicit ratings and undo within 10 s count ±1.0.
   - Undo at 10 s-5 min counts −0.5. Undo later counts −0.3.
   - Accepted and kept counts +0.75. Silence counts +0.15, at most once per domain per day.
   - A dismissed offer counts −0.25 and starts a cooldown. An ignored offer counts 0.
   - **Verifier rejection never touches preference.** It updates a separate engine-reliability Beta.
   - "Disable on this site" is a **hard rule**, not a vote.
   - Interaction metrics (mis-click rate and similar) are **excluded from reward in v1**. They trigger offers and serve evaluation only, because they are confounded and gameable.
4. **Treat the AI layer as an applicability estimator, not a preference oracle.** P(helpful here) = A(page) × θ(user). The model emits coarse categorical labels (`clear` / `likely` / `unsure`), and a per-op table maps each label to a probability learned from outcomes. Verbalized LLM confidence is overconfident (Xiong et al. 2024). For Level-1 ops, A is computed deterministically from page features the extension already extracts (`text.belowMinimumSize`, `layout.fixedOrStickyElements`).
5. **Forgetting.** Observation counts decay with a 90-day half-life; priors never decay. The Kalman filter adds process noise of (0.01)² per day in log units. A recalibration re-anchors the prior and keeps 50% of the learned offset.
6. **Product-level learning is a Phase-1 feature, gated on scale.** Randomized-response estimates carry a standard error of about 0.14 at n = 50 reports per cell and about 0.05 at n = 400. Below roughly 500 weekly opted-in devices, the data would only add noise to expert priors.
   - **For the senior-project timeline:** ship expert-authored, reviewed, versioned prior tables and engine-reliability priors measured on the archived test corpus. Build the telemetry path only if time allows.
   - **When it is built:** opt-in; at most 4 cells per device per 4-week window; ε = ln 3 randomized response on the outcome bit (≤ 4.4 ε per window, stricter than Apple's per-day budgets); increment-only aggregation with no raw rows and no user id; publish a cell only at k ≥ 50 distinct devices; blend with the expert prior (worth 20 observations); clamp each release to ±0.10; require human review.
7. **Persisted state per user.**
   - About 2 KB JSON of personal op and dimension state, which syncs through Supabase with RLS.
   - About 110 B per domain, local only, with an LRU cap of 500 domains (about 55 KB). Domain state never leaves the device, because domain lists are browsing history.
   - A 30-day, 500-event local ring buffer (about 90 KB) for the "What WebAble learned" inspector and for replay when weights are retuned.

---

## 1. Constraints and what each forces algorithmically

| Constraint (source) | Algorithmic consequence |
|---|---|
| Inaccurate adaptation is worse than none; accuracy matters more than predictability, and both drive satisfaction (Gajos et al. CHI 2008). Adaptable beats adaptive (Findlater & McGrenere CHI 2004). | Costs are asymmetric: C_unwanted ≈ 2.3 × B_wanted, which gives an auto-apply threshold of 0.70. Exploration happens only through cheap, dismissible offers and never through auto-applying. |
| Offer, never impose, for behavior-triggered changes (project invariant). | Learning may downgrade auto-apply to offer autonomously, but may **never** upgrade offer to auto-apply without asking. Behavior (friction) only raises the probability of an *offer*. |
| Verify or roll back (Wanscher et al. 2026 audit-inject-verify). | Verifier outcomes form a separate channel (engine reliability). They do not measure user preference and must not bias it. |
| Model emits data, never code. | Learned state and global priors are JSON data. Learning selects among reviewed ops and levels and clamps to the reviewed parameter envelope. It can never create a new op, selector, or intensity. |
| Never infer diagnoses; users are not personas. | No latent "condition" variable and no user clustering. State is per operation and per functional dimension. UI copy describes behavior ("You usually keep larger text"), never a label. |
| Privacy by design; no browsing history. | Domain-level state stays on the device. Synced and aggregated state is domain-free. Telemetry is opt-in, contribution-bounded, randomized, and increment-only. |
| Value on first visit. | Tier 0 (no profile) uses population priors with m0 = 2. It auto-applies only from explicit OS/browser settings (e.g., `prefers-reduced-motion`), and otherwise offers only when friction is observed. |
| Tiny per-user data: tens of events per op per month. | Use conjugate closed forms. Contextual models (LinUCB, Li et al. 2010) need thousands of events per parameter and centralized context logs, which are both unavailable here and undesirable. |

---

## 2. The loop at a glance

```
page load ─► features (deterministic) ─► applicability A_o(page)  ◄── AI label (L2 ops only), calibrated
                                               │
user profile (calibration) ─► priors ──► Learner A: θ̄_o (personal ▸ domain)  ─┐
                                        Learner B: x_d ± σ_d (+ domain δ)   ─┤
engine reliability P_ok(o, category, domain) ─────────────────────────────────┤
hard rules (pins/blocks, OS settings) ────────────────────────────────────────┤
                                                                               ▼
                                     POLICY: EU ladder → skip | offer | auto (+ level)
                                                                               ▼
                               deterministic apply → verifier → (rollback ⇒ engine channel only)
                                                                               ▼
                    user signals (undo, adjust, accept, dismiss, rate, disable) → episode parser
                                                                               ▼
                         Learner A / Learner B / hard rules / engine channel updates (local)
                                                                               ▼
               personal (domain-free) deltas → Supabase (RLS)     opt-in weekly RR report → aggregates
```

There are four stores. Precedence runs top to bottom:

1. **Hard rules**: user pins and blocks, and explicit OS settings. These are deterministic and outrank everything else.
2. **Engine reliability**: a gate on whether the op works on this page.
3. **Learner A**: whether the user wants the op.
4. **Learner B**: how much of it.

---

## 3. Learner A: desirability (Beta-Bernoulli with hierarchical shrinkage)

### 3.1 Model

For user u, operation o, and domain h (eTLD+1):

- Personal: θ_{u,o} ~ Beta(α₀ + S_{u,o}, β₀ + F_{u,o})
- Prior from calibration: α₀ = m₀·p₀, β₀ = m₀·(1 − p₀), with
  - p₀ = P₀[o][need(o)][category]: the reviewed prior table. need(o) ∈ {0, 1, 2} is the quantized calibration level of the op's primary dimension.
  - m₀ = 4 + 6·c, where c ∈ [0, 1] is calibration confidence (e.g., 1 − normalized standard error across repeated calibration trials). Range 4-10 pseudo-observations.
- Domain: θ_{u,o,h} ~ Beta(κ·p̄_{u,o}^{(−h)} + S_{u,o,h}, κ·(1 − p̄_{u,o}^{(−h)}) + F_{u,o,h}), with κ = 4.
  - p̄^{(−h)} is the **leave-one-out** personal mean, (α₀ + S − S_h)/(α₀ + β₀ + S + F − S_h − F_h). Without it, the domain's own evidence would be counted twice.
- S and F are **weighted, decayed pseudo-counts** (§4, §8). They are not integers.

The decision uses the posterior mean θ̄. For a Bernoulli outcome, the expected utility of a single action depends only on the predictive probability, which is the posterior mean. Quantiles matter only for exploration or robustness, and the SIM found no gain from them (§5.3).

- If the domain has no evidence, θ̄ = personal mean.
- Otherwise, θ̄ = (κ·p̄^{(−h)} + S_h)/(κ + S_h + F_h).

The domain estimate is a weighted average of the domain's own data and the personal mean, with weight n_h/(n_h + κ) on the domain data. This is the standard beta-binomial empirical-Bayes shrinkage (Casella 1985). Here κ plays the role of the between-domain concentration. The coarse-to-fine backoff mirrors how multi-resolution rate estimators use coarser-level estimates as priors for finer levels (Agarwal et al. KDD 2010). Hierarchical Thompson sampling (Hong et al. AISTATS 2022) formalizes the same structure. We keep the closed form and drop the sampling.

### 3.2 Why three levels and not more

The levels are global, then personal, then domain. Every added level (page category within a user, time of day) divides already-tiny counts.

- **Page category** enters only the **prior table** (global knowledge), not the personal state.
- **Time of day and fatigue** are deferred. They are plausible, but no evidence in hand justifies the added state.

**SIM:** results were insensitive to κ between 2 and 8 (net utility 13.7-13.8 per 100 applicable visits). κ = 4 is a safe middle.

### 3.3 Optional empirical-Bayes κ per user (v1.1)

Once a user has at least 8 domains with n_h ≥ 3 for an op, estimate the between-domain variance by method of moments:

- τ̂² = max(0, Var_h(p̂_h) − mean_h(p̂_h(1 − p̂_h)/n_h))
- κ̂ = p̄(1 − p̄)/τ̂² − 1, clamped to [2, 12]

This is cheap, but skip it in v1 because the SIM shows little sensitivity.

---

## 4. Signal model: what each event means and where it goes

Each user action updates exactly one of: desirability (A), intensity (B), engine reliability (E), or hard rules (R). Weights are pseudo-observations: S += w⁺ or F += w⁻. Personal and domain counts both update unless noted.

| Signal | Target | Weight | Rationale |
|---|---|---|---|
| Explicit "helped" | A | S += 1.0 | Explicit judgments are the reliable anchor. Clicks and implicit signals are informative but biased (Joachims et al. SIGIR 2005). |
| Explicit "didn't help" | A | F += 1.0 | Same. |
| Undo < 10 s after the change became visible | A | F += 1.0 | Rejection before task engagement is the analog of a short-dwell "pogo-stick" in search. Short dwell reliably signals dissatisfaction (Fox et al. TOIS 2005). Long-dwell heuristics use about 30 s (Kim et al. WSDM 2014). 10 s is conservative for a visual change the user sees instantly. |
| Undo 10 s-5 min | A | F += 0.5 | The user has experienced the change, but the undo may be task-specific (copying layout, screenshots). |
| Undo > 5 min or on a later visit | A | F += 0.3 | Weakest. Context has likely changed. |
| Undo then re-enable within 60 s | A | cancel the undo's F | Mis-tap. |
| Undo followed by an intensity change within 30 s | B only | probit nudge in that direction | "Too much", not "don't want" (see episodes below). |
| Optional one-tap undo reason chip (auto-hides after 8 s) | routed | "Don't want" → A F += 1.0. "Too much / too little" → B. "Broke the page" → E F += 1 plus a defect report, **not A**. | Cheapest way to separate preference from engine failure. Unanswered means default weights apply. |
| Offer accepted, still on at session end (≥ 2 min active) | A | S += 0.75 | Intent plus experienced value. Kept below explicit 1.0. |
| Offer accepted, then undone | A | 0 net for the accept; the undo applies by timing | Avoids double counting. |
| Offer dismissed ("Not now") | A | F += 0.25; 7-day cooldown for (o, h); 3 consecutive dismissals → 30-day global offer cooldown for o | Dismissal is mostly about context and interruption, so it is weak evidence. Fatigue is handled by cooldowns, not by preference. |
| Offer ignored or timed out | none | 0 | Non-engagement is not a negative. Unclicked items are not necessarily irrelevant, because exposure and position bias dominate (Joachims et al. 2005; Joachims, Swaminathan & Schnabel WSDM 2017). |
| "Never on this site" | R, plus A domain F += 2, personal F += 0.25 | Hard block for (o, h) | User authority is deterministic. The counts only remember the signal if the user later re-enables. |
| "Never" (global) | R | Hard block for o | Never overridden by learning. |
| Manual enable (op not offered) | A | S += 1.0 | Strongest implicit positive: it reveals an unmet need. |
| Manual intensity up/down | B, plus A S += 0.25 | Episode rules | Engaging with the op and keeping it is a weak positive for desirability. |
| Silence: auto-applied, visible effect, ≥ 60 s active dwell, no adjustment | A | S += 0.15, at most once per (o, h, day) | Exposure without objection is a *weak* positive. Implicit-feedback models treat it as low-confidence (Hu, Koren & Volinsky ICDM 2008). **SIM:** raising it to 0.5 increased unwanted auto-applies by 41% in the stationary case and 74% under preference drift. |
| Verifier reject or rollback | E only | E F += 1 for (o, category) and (o, h) | Engine failure. **Never** a preference signal. |
| Verifier pass | E | E S += 1 (cap 1 per (o, h, day)) | |
| Repeated success on a domain | A | (through the counts) | Drives the per-domain promotion prompt (§5.2). |
| Interaction metrics (mis-clicks, zoom events, re-reading, scroll reversals) | offer trigger and evaluation only | 0 in v1 | Confounded by page and task. The user can't see or contest them, and they are **gameable**: hiding or dimming content reduces clicks. Used as a likelihood ratio for offers (§5.5). v2 could add ≤ 0.2 weight for within-page before/after mis-click rates on target-size ops only. |

**Adjustment episodes.** Implicit intensity signals come in bursts, so parse them into episodes before updating:

- An episode starts at the first intensity change or undo for an op on a page. It ends after 20 s with no further change for that op.
- **Settled**: the final level is > 0 and kept ≥ 2 min → one Kalman point update at the settled value (B), plus desirability S += 0.25 (A).
- **Abandoned**: the final level is 0 → treated as an undo with the timing of the *first* action in the episode.
- **Cut short**: the user leaves the page before 2 min → one probit update using the net direction relative to the starting value (B). No A update.

This yields one learning event per episode instead of one per click, which avoids overweighting users who click in small steps.

---

## 5. Decision policy

### 5.1 Expected utility

For op o at the level from Learner B on page π of domain h:

- P_h = A_o(π) · θ̄_{u,o,h}. A is 1 for applicable Level-1 ops (deterministic features) and the calibrated label probability for Level-2 ops.
- EU_auto = P_ok · [P_h·B − (1 − P_h)·C] − (1 − P_ok)·C_fail
- EU_offer = P_h^{LR}·B_offer − C_interrupt
- EU_skip = 0

Constants, normalized so B = 1:

| Constant | Value | Meaning |
|---|---|---|
| C | 2.33 | Cost of an unwanted automatic change (disruption, undo effort, trust loss). Gives break-even P = C/(B + C) = 0.70. |
| C_fail | 0.1 | Cost of apply-then-rollback (flicker, latency). |
| B_offer / C_interrupt | 1 / 0.4 | Gives an offer threshold of 0.40. |
| P_ok | Beta posterior mean of verifier pass | Prior from the CI corpus per (o, category). Local per-domain counts on top. |

Rules:

- **Auto-apply** when the source is eligible (§5.2) **and** EU_auto > 0. With P_ok ≈ 0.95, that is P_h > 0.703.
- **Skip unconditionally** if P_ok < 0.5, or if there are ≥ 2 verifier rejections for (o, h) in 7 days (a local 7-day skip cache).

The threshold 0.70 is the main harm/benefit dial. **SIM, stationary:**

| τ_auto | Unwanted auto per 100 | Wanted auto per 100 | Net utility |
|---|---|---|---|
| 0.60 | 5.2 | 23.8 | 13.9 |
| 0.70 | 3.6 | 19.3 | 13.8 |
| 0.80 | 2.2 | 13.9 | 12.9 |

0.70 halves harm relative to 0.60 at almost no utility cost. Use 0.80 if user testing shows people find unwanted changes more costly than assumed.

### 5.2 The action ladder and who may auto-apply

Sources eligible for auto-apply:

1. **User pins**: global ("Always do X") or per site. Pins are deterministic.
2. **Profile-derived ops**: the user confirmed them during onboarding's before/after preview, so they are adaptable rather than adaptive.
3. **Explicit OS/browser settings**: `prefers-reduced-motion`, `prefers-contrast: more`, `forced-colors`, and browser minimum font size.

Everything else is at most an offer.

State transitions per (o, h):

- **Demote on a domain** (automatic): an eligible op with domain θ̄ < 0.70 becomes offer-only on h. With the strong-need prior Beta(8.5, 1.5), one undo within 10 s gives domain θ̄ = 0.68, so it demotes. One late undo gives 0.756, so it stays.
  - In addition, **any** undo suppresses reapplication in that tab for the rest of the session. This is deterministic, for predictability.
- **Demote globally** (automatic, profile-derived ops only): when personal θ̄ < 0.70. From Beta(8.5, 1.5) that takes about 3 fast undos on distinct domains (0.85 → 0.773 → 0.708 → 0.654).
  - Show one prompt: "You've turned off larger text a few times. Adjust your text setting?" It links to settings or recalibration, because the *intensity* may be wrong rather than the op.
  - Pins never auto-demote globally. They only accumulate per-site exceptions from the user's own undos.
- **Promote globally** (ask once): the source is not eligible, personal θ̄ ≥ 0.70, ≥ 3 accepts across ≥ 2 domains, and no ask in the last 60 days → "Always make text larger?" Yes → global pin. No → 60-day cooldown, and offers continue. The mild-need prior Beta(6, 4) reaches 0.70 after about 5 accepted-and-kept offers.
- **Promote per site** (ask once): domain θ̄ ≥ 0.80 and ≥ 3 accepts on h → "Always on this site?"
- **Offer**: P_h^{LR} ≥ 0.40, no hard block, cooldowns clear, and no more than 1 offer per page or 4 per day. Never offer within the first 10 s of a page load or mid-interaction (while typing, dragging, or scrolling).

### 5.3 Thompson sampling vs UCB vs simple thresholds

| Approach | Where it shines | Problem for WebAble | Verdict |
|---|---|---|---|
| **Thompson sampling** (Chapelle & Li 2011; Russo et al. 2018) | High-traffic CTR problems where exploration regret matters and randomization is cheap. | Randomized actions: the same page can look different on reload, which breaks predictability (Gajos 2008). Exploring by *auto-applying* violates the asymmetric-cost constraint. Per-user traffic is tiny, so regret asymptotics are irrelevant. **SIM:** 4.4 vs 3.6 unwanted auto per 100 stationary; 7.2 vs 4.1 under drift; net utility 11.9 vs 13.8 and 3.1 vs 10.1. | **Reject** for per-user decisions. If a tie-break among several offer candidates is ever needed, use a deterministic seed (user, h, day) so behavior stays stable within a day. |
| **UCB1** (Auer et al. 2002) / **Bayes-UCB** (Kaufmann et al. 2012) | Deterministic optimism with good regret guarantees. | Optimism is wrong for auto-apply, where pessimism is safer. For offers, the SIM showed q80 vs mean made no measurable difference (offer acceptance 6.35 vs 6.33 per 100), because cooldowns and friction triggers dominate. | Not needed. Use the posterior mean. Exploration comes from decay toward the prior and from friction-triggered offers. |
| **Conservative bandits** (Wu et al. ICML 2016) | Formalize "never fall below the baseline" during exploration. | This is exactly our constraint, but the formal algorithm is unnecessary once auto-apply exploration is forbidden. The "baseline" is no adaptation, and exploration is confined to offers, which cost almost nothing. | Use as the **justification**, not the implementation. |
| **Contextual bandits** (LinUCB, Li et al. 2010) | Large traffic, rich context, a shared model. | Needs centralized per-event context logs (browsing history) and far more data per user. Uninterpretable to the user. | Reject for v1. The global prior table is effectively a saturated model over (op, need, category). |
| **Simple thresholds on posterior mean** (chosen) | Small data, asymmetric costs, explainability. | Doesn't explore on its own. This is fixed by decay (§8), friction offers (§5.5), and prompts. | **Adopt.** |

Precedent for bandits in HCI: Lomas et al. (CHI 2016) found bandits speed design exploration, but "human participation is essential" to optimize the right metric. That supports keeping the user as the authority on promotions.

### 5.4 Fatigue and interruption budget

These are policy counters, not preference:

- At most 1 offer per page and 4 per day.
- A 7-day per-site cooldown after a dismissal.
- A 30-day global cooldown after 3 consecutive dismissals of the same op.
- One promotion question per op per 60 days.

### 5.5 Behavior (friction) as a likelihood ratio on offers

Friction detectors multiply the odds of the offer probability only:

logit P_h^{LR} = logit P_h + ln LR_f

LR values:

| Friction pattern | Target op | LR |
|---|---|---|
| ≥ 2 mis-clicks (click lands within 8 px outside the intended target) within 60 s | target_enlarge | 3 |
| Browser zoom-in or pinch | text_scale | 4 |
| Repeated scroll reversals over the same paragraph | reading aids | 2 |

**Worked example.** "No need" prior Beta(1.5, 8.5): P = 0.15, so no offer. With LR = 3, P^{LR} ≈ 0.35. With LR = 4, 0.41, which crosses the offer threshold. **Tier 0** (Beta(0.4, 1.6), P = 0.2): LR = 3 gives 0.43, so it offers.

This is the only path by which behavior changes what the user sees, and it always yields a dismissible offer.

---

## 6. Combining the AI decision layer with learned preference and verification

**Factorize, don't average.**

P(helpful | u, π, o) = A_o(π) · θ̄_{u,o,h}

- **A (applicability)** answers whether the page has something this op should act on, and whether the model's target selection is right.
- **θ̄ (desirability)** answers whether this user wants the op when it applies.

The AI knows the page. The learner knows the user. Multiplying keeps each accountable. A log-odds sum (logit P = logit θ̄ + w·(logit q − logit q̄)) is the alternative, but it double counts, because the model also sees the profile summary.

- **Level-1 ops** (text size, spacing, contrast, focus ring, motion): A is **deterministic** from the snapshot the extension already computes. For example, `text.belowMinimumSize / text.visibleElements ≥ 0.05` → text ops applicable. `layout.fixedOrStickyElements > 0` → the sticky-header op is applicable. No model is needed.
- **Level-2 ops** (dim region, hide distractions, reading focus): the model returns candidate targets with a **categorical** confidence label, not a number. Map label → probability with a per-op table learned from outcomes. An outcome is "verifier pass ∧ not undone within 5 min ∧ no 'wrong thing' reason chip."
  - Initial conservative table: `clear` 0.80, `likely` 0.55, `unsure` 0.25.
  - Refit monthly by isotonic regression over (label, outcome) bins. With only 3 bins, that means binned frequencies with a monotonicity constraint. Guo et al. (ICML 2017) show single-parameter recalibration (temperature/Platt) works well for overconfident models, and Xiong et al. (ICLR 2024) show LLM verbalized confidence is systematically overconfident. Labels plus empirical mapping are the robust version for a team without a calibration pipeline.
- **Verifier.** P_ok enters EU (§5.1) as a multiplier and a hard gate. It is learned in its own Beta per (o, category) and (o, h).
  - Global P_ok priors come from running each op on the **archived test corpus** in CI. That is free, needs no telemetry, and is reproducible.
  - Local (o, h) counts override the prior quickly: 2 rejects in 7 days → skip for 7 days.
- **The model never sees learned state or domain history.** It sees the page features and the need-level summary only. The policy layer (deterministic code) applies learning after the model returns. This keeps prompts small, keeps browsing history out of inference, and preserves "model emits data."

---

## 7. Learner B: continuous parameters (preferred text size and similar)

### 7.1 State

For each functional dimension d, the preferred value is modeled in **log space**, x_d = ln(value). Perceived size and spacing scale multiplicatively, and log space makes ±10% symmetric.

| Dimension | Unit of value | Prior from calibration | Calibration σ (log) |
|---|---|---|---|
| textScale | multiplier on computed font size | x_cal = ln(scale at reading-speed plateau) | 0.10-0.20 |
| minTextPx | px | ln(critical-print-size-style floor) | 0.10 |
| targetMinPx | px | ln(size where calibration pointing error < 5%) | 0.15 |
| contrastBoost | contrast-ratio target | ln(target ratio) | 0.15 |
| spacing (line-height multiplier) | ratio | ln(value) | 0.10 |
| lineLengthCh | ch | ln(value) | 0.15 |
| motion / distraction / density sensitivity | 0-1 scores | logit instead of log | 0.5 (logit) |

Learner state per dimension: mean m, variance v, last-update day t. The calibration anchor (m_cal, v_cal) is also stored for reset and recalibration.

Prior: v₀ = v_cal + g², with lab-to-wild gap g = 0.10. Calibration happens under ideal conditions, and real pages differ.

### 7.2 Settled observation: scalar Kalman update (Kalman 1960)

On a settled episode with value z = ln(v_settled) and measurement noise R = 0.10², meaning settled values vary about ±10% by page and context:

- K = v/(v + R)
- m ← m + K·(z − m)
- v ← (1 − K)·v, floored at σ_min² = 0.03²

Worked example: prior scale 1.25 (m = 0.223), σ = 0.15. The user settles at 1.5. Then K = 0.69, new scale = 1.42, σ = 0.083.

### 7.3 One-shot nudge: probit (Elo/Glicko/TrueSkill-style) update

A single "A+" at current value c without a settle means the preference is above c this time. This is a censored observation. Model the occasion-specific preference as y ~ N(m, v + R) and observe y > ln c. Moment-match the truncated Gaussian, as TrueSkill does (Herbrich, Minka & Graepel 2006; the Elo/Glicko lineage is Glickman 1999):

- s = √(v + R)
- t = ±(m − ln c)/s, with + for "larger" and − for "smaller"
- λ = φ(t)/Φ(t)
- m ← m ± (v/s)·λ
- v ← v·[1 − (v/(v + R))·λ·(λ + t)]

Worked example: m = ln 1.25, σ = 0.15, one "larger" click at c = 1.25 gives t = 0, λ = 0.798, new scale 1.38, σ 0.112. This is the same Bayesian "place the next test at the current best estimate" logic as QUEST (Watson & Pelli 1983), which is also a good fit for the calibration tasks themselves.

Why not plain Elo (fixed K)? A fixed step ignores how certain we already are. The probit update is 6 lines, shrinks steps as σ falls, and needs only `erf`.

**Known bias.** Method-of-adjustment settles depend on the starting point. Ascending adjustments stop early (satisficing). Starting episodes from the current estimate, which the product does naturally, keeps this roughly symmetric. Do not correct for it further.

### 7.4 Per-domain offsets

Sites differ in base font and palette. Keep a sparse offset δ_{d,h} ~ N(0, τ_d²) with τ = 0.10, created only when a settled episode happens on h.

Joint update with innovation e = z − (m + δ_h) and S = v + v_h + R:

- m += (v/S)·e, δ_h += (v_h/S)·e
- v −= v²/S, v_h −= v_h²/S

This drops the cross-covariance, which is a documented approximation that is fine at this scale. Apply δ_h only when v_h < 0.7·τ², which requires at least one observation.

### 7.5 From continuous estimate to discrete intensity level

The library exposes discrete, reviewed levels per op (e.g., text_scale ∈ {1.10, 1.25, 1.40, 1.60, 1.80}).

- Choose the level nearest to exp(m + δ_h) in log space.
- **Hysteresis:** change the default level only if the new nearest level beats the current one by more than 0.03 log units for 2 consecutive sessions. Predictability matters more than tracking noise.
- **Safety floor:** implicit learning never moves text below the calibration floor (minTextPx). Only an explicit user setting can.
- **Clamp:** always stay inside the op's reviewed range.

---

## 8. Forgetting, drift, recalibration

- **Beta counts:** exponential decay of *observations only*. S ← S·2^(−Δdays/H) with **H = 90 days**, one half-life for both levels so the leave-one-out stays exact. Apply lazily at read time from the stored `t`.
  - This is discounted Thompson sampling's (Raj & Kalyani 2017) and discounted UCB's (Garivier & Moulines 2011) mechanism, applied to a mean-threshold policy.
  - As evidence fades, the posterior relaxes to the calibration prior. That produces automatic re-exploration and counters the **hot-stove effect** (Denrell & March 2001), where a single early bad experience would otherwise suppress an op forever.
  - **SIM** with preference reversal: H = 30 d gave unwanted auto 3.73; 90 d, about 3.8-4.1; no decay, 4.41. Stationary cost was negligible.
- **Kalman:** v ← v + Q·Δdays with Q = 0.01² per day, capped at v₀. For example, σ 0.083 → 0.10 after 30 idle days → 0.126 after 90 days.
- **Hard rules** (pins and blocks) never decay. The inspector lists them and each can be removed.
- **Recalibration** (recommended at 7 days, then when prompted or on the user's request):
  - New prior (m_cal′, v_cal′).
  - Keep half the learned deviation: m ← m_cal′ + 0.5·(m − m_cal), v ← v₀′.
  - Beta counts × 0.5.
  - Rationale: calibration is objective and recent, but learned deviations capture real-page conditions that calibration can't see.
- **Library or version change:** when an op's implementation changes materially (e.g., a new contrast algorithm), bump `opVer`. On mismatch, multiply that op's counts by 0.5.

---

## 9. Cold start

| Situation | Desirability prior | Intensity prior | Allowed actions |
|---|---|---|---|
| **Tier 0** (no profile) | p₀ = population table (≈ 0.2), m₀ = 2 | Browser defaults | Auto only from explicit OS/browser settings. Offers only with friction LR. |
| **Onboarding preview** (before/after toggles on a real page) | Each explicit toggle outcome: S or F += 1.0 | Settled toggles → Kalman updates | Profile-derived ops confirmed here become auto-eligible. |
| **Post-calibration** | p₀ = P₀[o][need][cat]; m₀ = 4 + 6c | N(x_cal, v_cal + 0.1²) | Ladder as in §5.2. |
| **Global priors updated** (Phase 1, §12) | The center p₀ shifts with the release; m₀ stays calibration-driven | Unchanged | Same. |

Illustrative expert prior table P₀[o][need] (before category modifiers; values are team-reviewed defaults):

| Op | need 2 | need 1 | need 0 |
|---|---|---|---|
| text_scale / min_text_size | 0.85 | 0.60 | 0.15 |
| target_enlarge / target_spacing | 0.85 | 0.55 | 0.10 |
| contrast_boost | 0.80 | 0.50 | 0.10 |
| reduce_motion / pause_media | 0.90 | 0.65 | 0.25 |
| line_length / spacing | 0.75 | 0.50 | 0.15 |
| dim_region (L2) | 0.65 | 0.45 | 0.10 |
| hide_distractions (L2) | 0.60 | 0.40 | 0.10 |

Category modifiers are multiplicative on odds, for example ×0.7 for `hide_distractions` on `form_checkout`. Ops that could hide help or contact mechanisms must be excluded by the library itself, not by learning.

---

## 10. Implicit-feedback reliability and exposure bias

1. **We only observe outcomes for what we chose to show** (selection or exposure bias; Schnabel et al. ICML 2016; Joachims et al. WSDM 2017).
   - Per user, this is tolerable: decisions and estimates share the same exposure policy, and decay plus friction offers provide re-exposure.
   - At product level it matters: aggregated outcomes estimate P(kept | shown under current policy), not P(kept | shown to everyone). Keep `mode` (auto vs offer) and `trigger` (profile vs friction) as separate aggregate cells, and never pool them.
2. **Noticeability.** Silence counts only when the op produced a visible effect (e.g., ≥ 10% of readable elements changed computed style) and the user had ≥ 60 s of active dwell. An invisible change teaches nothing.
3. **Position bias** is held constant by design: offers always appear in the same toolbar location, so no per-user propensity weighting is needed.
4. **Engine failures masquerading as preference.** The undo reason chip ("Broke the page") and verifier results route to E. Also treat an undo within 2 s of a layout-shift event greater than 0.1 CLS as E-weighted 0.5 / A-weighted 0.5.
5. **Off-policy evaluation.** Replay and IPS estimators (Li et al. WSDM 2011) require randomized logging. A deterministic policy has propensities of 0 or 1, so we **cannot** evaluate alternative thresholds from production logs. Causal claims belong to the within-subjects study already in the evaluation plan. Threshold tuning uses the simulator (§13).

---

## 11. Reference implementation (TypeScript-like pseudocode)

```ts
// ===== constants (all tunable; see §14) =====
const K = {
  H_DAYS: 90, KAPPA: 4, M0_BASE: 4, M0_CONF: 6, TIER0_M0: 2,
  TAU_AUTO: 0.70, TAU_OFFER: 0.40, TAU_PROMOTE: 0.70, TAU_SITE_PROMOTE: 0.80,
  MIN_ACCEPTS: 3, ASK_COOLDOWN_D: 60, P_OK_MIN: 0.5, C: 2.33, C_FAIL: 0.1,
  OFFERS_PER_DAY: 4, DISMISS_COOLDOWN_D: 7, DISMISS_STREAK: 3, GLOBAL_COOLDOWN_D: 30,
  UNDO_FAST_MS: 10_000, UNDO_MED_MS: 300_000, SETTLE_QUIET_MS: 20_000, SETTLE_KEEP_MS: 120_000,
  R: 0.10 ** 2, Q_PER_DAY: 0.01 ** 2, SIGMA_MIN: 0.03, DOMAIN_TAU: 0.10, HYST: 0.03,
} as const;

const W = { explicitPos: 1, explicitNeg: 1, undoFast: 1, undoMed: 0.5, undoLate: 0.3,
            acceptKept: 0.75, dismiss: 0.25, silence: 0.15, manualOn: 1, adjustKeep: 0.25,
            siteBlockDomainF: 2, siteBlockPersonalF: 0.25 } as const;

type Day = number;                                  // days since epoch (integer)
interface Counts { s: number; f: number; t: Day }   // decayed pseudo-counts
interface OpState {
  c: Counts; src: 'profile' | 'pinned' | 'os' | 'none'; blocked?: true;
  accepts: number; askAfter: Day; dismissStreak: number; offerCooldownUntil: Day; opVer: number;
}
interface DimState { m: number; v: number; t: Day; mCal: number; vCal: number; floor?: number }
interface UserLearningState {                       // synced (domain-free), ~2 KB JSON
  v: 1; libVer: string; priorRelease: string;
  ops: Record<OpId, OpState>; dims: Record<DimId, DimState>;
}
interface DomainOp extends Counts { pin?: true; block?: true; e?: Counts; skipUntil?: Day; sessionOff?: string }
interface DomainState { t: Day; ops: Partial<Record<OpId, DomainOp>>; dims: Partial<Record<DimId, { d: number; v: number }>>; silenceDay?: Partial<Record<OpId, Day>> }
// DomainState lives in chrome.storage.local only, keyed by eTLD+1, LRU-capped at 500.

// ===== Learner A =====
const decay = (c: Counts, now: Day): Counts => {
  const g = Math.pow(2, -(now - c.t) / K.H_DAYS);
  return { s: c.s * g, f: c.f * g, t: now };
};

function prior(u: UserLearningState, op: OpId, ctx: PageCtx): { a0: number; b0: number } {
  const p0 = PRIOR_TABLE[op][ctx.need[op]][ctx.cat];          // reviewed JSON, versioned
  const m0 = ctx.profileConfidence == null ? K.TIER0_M0
           : K.M0_BASE + K.M0_CONF * ctx.profileConfidence;
  return { a0: m0 * p0, b0: m0 * (1 - p0) };
}

function desirability(u: UserLearningState, d: DomainState | undefined, op: OpId, ctx: PageCtx, now: Day) {
  const { a0, b0 } = prior(u, op, ctx);
  const P = decay(u.ops[op].c, now);
  const aP = a0 + P.s, bP = b0 + P.f;
  const D = d?.ops[op] ? decay(d.ops[op]!, now) : undefined;
  if (!D || D.s + D.f < 1e-6) return { personal: aP / (aP + bP), mean: aP / (aP + bP) };
  const aL = a0 + Math.max(0, P.s - D.s), bL = b0 + Math.max(0, P.f - D.f);  // leave-one-out
  const pL = aL / (aL + bL);
  const a = K.KAPPA * pL + D.s, b = K.KAPPA * (1 - pL) + D.f;
  return { personal: aP / (aP + bP), mean: a / (a + b) };
}

// ===== engine reliability (verifier channel) =====
function pOk(d: DomainState | undefined, op: OpId, ctx: PageCtx, now: Day): number {
  const g = ENGINE_PRIOR[op][ctx.cat];                         // {a,b} from CI corpus runs
  const e = d?.ops[op]?.e ? decay(d.ops[op]!.e!, now) : { s: 0, f: 0, t: now };
  if ((d?.ops[op]?.skipUntil ?? -1) >= now) return 0;
  return (g.a + e.s) / (g.a + g.b + e.s + e.f);
}

// ===== policy =====
type Decision = { action: 'skip' | 'offer' | 'auto'; level?: number; why: string };
const logit = (p: number) => Math.log(p / (1 - p));
const sigm = (x: number) => 1 / (1 + Math.exp(-x));

function decide(ctx: PageCtx, u: UserLearningState, d: DomainState | undefined, op: OpId, now: Day): Decision {
  const o = u.ops[op], dop = d?.ops[op];
  if (o.blocked || dop?.block) return { action: 'skip', why: 'user_blocked' };
  if (dop?.sessionOff === ctx.tabSession) return { action: 'skip', why: 'undone_this_session' };
  const A = applicability(ctx, op);                            // L1: 0|1 from features; L2: calibrated label prob
  if (A <= 0) return { action: 'skip', why: 'not_applicable' };
  const ok = pOk(d, op, ctx, now);
  if (ok < K.P_OK_MIN) return { action: 'skip', why: 'engine_unreliable_here' };

  const { mean } = desirability(u, d, op, ctx, now);
  const P = clamp(A * mean, 1e-4, 1 - 1e-4);
  const level = chooseLevel(u, d, op, now);                    // Learner B, §7.5
  const eligible = o.src !== 'none' || !!dop?.pin;
  const euAuto = ok * (P - (1 - P) * K.C) - (1 - ok) * K.C_FAIL;
  if (eligible && euAuto > 0) return { action: 'auto', level, why: `P=${P.toFixed(2)}` };

  const pOffer = sigm(logit(P) + Math.log(ctx.frictionLR[op] ?? 1));
  const cooled = now > o.offerCooldownUntil && now > (dop?.skipUntil ?? -1) && offerBudgetLeft(now);
  if (pOffer >= K.TAU_OFFER && cooled && !ctx.userBusy) return { action: 'offer', level, why: `P=${pOffer.toFixed(2)}` };
  return { action: 'skip', why: 'below_threshold' };
}

// ===== event handling =====
function credit(u: UserLearningState, d: DomainState, op: OpId, now: Day, s = 0, f = 0, personalScale = 1) {
  const P = (u.ops[op].c = decay(u.ops[op].c, now)); P.s += s * personalScale; P.f += f * personalScale;
  const D = (d.ops[op] = { ...(d.ops[op] ?? { s: 0, f: 0, t: now }), ...decay(d.ops[op] ?? { s: 0, f: 0, t: now }, now) });
  D.s += s; D.f += f;
  queueSyncDelta({ op, ds: s * personalScale, df: f * personalScale, day: now }); // domain-free
}

function onEvent(ev: AdaptEvent, u: UserLearningState, d: DomainState, now: Day) {
  const op = ev.op;
  switch (ev.kind) {
    case 'rating':        return credit(u, d, op, now, ev.rating === 'helped' ? W.explicitPos : 0, ev.rating === 'not_helped' ? W.explicitNeg : 0);
    case 'undo_reason':   // chip answered within 8 s; overrides default undo weight
      if (ev.reason === 'broke_page') { engineFail(d, op, now); return uncreditLastUndo(u, d, op, now); }
      if (ev.reason === 'too_much' || ev.reason === 'too_little') { uncreditLastUndo(u, d, op, now); return nudge(u, d, op, ev); }
      return; // 'dont_want' keeps default
    case 'episode_end':   return onEpisode(ev, u, d, now);     // parsed from undo/intensity bursts (§4)
    case 'offer_accepted': u.ops[op].accepts++; u.ops[op].dismissStreak = 0; return; // credited at session_end if kept
    case 'offer_dismissed': {
      credit(u, d, op, now, 0, W.dismiss);
      d.ops[op]!.skipUntil = now + K.DISMISS_COOLDOWN_D;
      if (++u.ops[op].dismissStreak >= K.DISMISS_STREAK) { u.ops[op].offerCooldownUntil = now + K.GLOBAL_COOLDOWN_D; u.ops[op].dismissStreak = 0; }
      return;
    }
    case 'session_end':   // op still on, visible effect, >=60 s active dwell
      if (ev.acceptedThisSession && ev.kept) return credit(u, d, op, now, W.acceptKept, 0);
      if (ev.autoApplied && ev.kept && ev.visibleEffect && d.silenceDay?.[op] !== now) {
        (d.silenceDay ??= {})[op] = now; return credit(u, d, op, now, W.silence, 0);
      }
      return;
    case 'manual_on':     return credit(u, d, op, now, W.manualOn, 0);
    case 'site_disable':  d.ops[op] = { ...(d.ops[op] ?? { s: 0, f: 0, t: now }), block: true };
                          credit(u, d, op, now, 0, W.siteBlockDomainF, W.siteBlockPersonalF / W.siteBlockDomainF); return;
    case 'verifier':      return ev.pass ? enginePass(d, op, now) : engineFail(d, op, now); // NEVER touches A
  }
  maybeAskPromotion(u, d, op, now);
}

function onEpisode(ev: EpisodeEvent, u: UserLearningState, d: DomainState, now: Day) {
  if (ev.finalLevel === 0) {                                   // abandoned == undo, timed from first action
    const w = ev.dtFirstMs < K.UNDO_FAST_MS ? W.undoFast : ev.dtFirstMs < K.UNDO_MED_MS ? W.undoMed : W.undoLate;
    d.ops[ev.op]!.sessionOff = ev.tabSession;
    return credit(u, d, ev.op, now, 0, w);
  }
  if (ev.keptMs >= K.SETTLE_KEEP_MS) { kalmanPoint(u, d, ev.dim, Math.log(ev.settledValue), now);
                                       return credit(u, d, ev.op, now, W.adjustKeep, 0); }
  return probitNudge(u, d, ev.dim, Math.log(ev.startValue), ev.netDirection, now);
}

// ===== Learner B =====
function predictDim(s: DimState, now: Day) { s.v = Math.min(s.v + K.Q_PER_DAY * (now - s.t), s.vCal + 0.1 ** 2); s.t = now; }

function kalmanPoint(u: UserLearningState, d: DomainState, dim: DimId, z: number, now: Day) {
  const s = u.dims[dim]; predictDim(s, now);
  const off = (d.dims[dim] ??= { d: 0, v: K.DOMAIN_TAU ** 2 });
  const e = z - (s.m + off.d), S = s.v + off.v + K.R;
  s.m += (s.v / S) * e;  off.d += (off.v / S) * e;
  s.v = Math.max(s.v - s.v ** 2 / S, K.SIGMA_MIN ** 2); off.v = Math.max(off.v - off.v ** 2 / S, 1e-4);
  queueSyncDelta({ dim, obs: { kind: 'point', value: z - off.d, r: K.R }, day: now }); // domain-free value
}

function probitNudge(u: UserLearningState, d: DomainState, dim: DimId, c: number, dir: 1 | -1, now: Day) {
  const s = u.dims[dim]; predictDim(s, now);
  const off = d.dims[dim]?.d ?? 0, sd = Math.sqrt(s.v + K.R);
  const t = dir * (s.m + off - c) / sd;
  const lam = normPdf(t) / Math.max(normCdf(t), 1e-9);
  s.m += dir * (s.v / sd) * lam;
  s.v = Math.max(s.v * (1 - (s.v / (s.v + K.R)) * lam * (lam + t)), K.SIGMA_MIN ** 2);
  queueSyncDelta({ dim, obs: { kind: dir > 0 ? 'gt' : 'lt', value: c - off, r: K.R }, day: now });
}
// normCdf(x) = 0.5*(1+erf(x/√2)) with Abramowitz–Stegun 7.1.26 erf (max err 1.5e-7).

function chooseLevel(u: UserLearningState, d: DomainState | undefined, op: OpId, now: Day): number {
  const dim = OP_DIM[op]; const s = u.dims[dim];
  const off = (d?.dims[dim] && d.dims[dim]!.v < 0.7 * K.DOMAIN_TAU ** 2) ? d.dims[dim]!.d : 0;
  const target = Math.max(s.m + off, s.floor ?? -Infinity);
  const levels = OP_LEVELS[op];                                // reviewed values, e.g. [1.1,1.25,1.4,1.6,1.8]
  const best = nearestInLog(levels, target), cur = currentDefault(op);
  return Math.abs(Math.log(levels[best]) - target) + K.HYST < Math.abs(Math.log(levels[cur]) - target)
         && confirmedTwice(op, best) ? best : cur;             // hysteresis for predictability
}
```

**Multi-device merge.**

- Devices never overwrite each other's state. Each sends **domain-free deltas** (`{op, ds, df, day}` and `{dim, obs}`) to a Postgres function, `apply_learning_deltas(deltas jsonb)`, which is idempotent by `deltaId`.
- The server applies them to the canonical `learning_state` row in timestamp order and deletes the deltas. Devices pull the canonical state.
- Counts are additive (G-counter semantics). Kalman observations are replayed in order.
- Domain-level state is intentionally not merged: it is local, so a new device starts domain-neutral, which is acceptable.

---

## 12. Persisted state and its size

| Store | Location | Contents | Size (JSON, 3 significant digits, short keys) |
|---|---|---|---|
| `learning_state` | Supabase (RLS `user_id = auth.uid()`) + chrome.storage.local cache | 20 ops × {s, f, t, src, accepts, askAfter, dismissStreak, cooldown, opVer} ≈ 60 B; 8 dims × {m, v, t, mCal, vCal, floor} ≈ 60 B | ≈ 1.2 KB + 0.5 KB + header ≈ **2 KB**. Fits the 8 KB `chrome.storage.sync` per-item limit (100 KB total, 512 items) and the project's under-8 KB profile budget. |
| Hard rules (global pins/blocks) | synced with the above | op → pin/block | < 200 B |
| Domain state | **chrome.storage.local only** | eTLD+1 → {t, per-op {s, f, t, e: {s, f}, pin/block, skipUntil}, per-dim {δ, v}} | ≈ 110 B per domain; LRU 500 domains plus eviction after 180 days idle → **≤ 55 KB** |
| Event ring buffer | chrome.storage.local | Last 500 events or 30 days, whichever is smaller | ≈ 180 B per event → **≤ 90 KB** |
| Pending sync deltas | chrome.storage.local | Until acknowledged | < 5 KB typical |
| Telemetry bookkeeping (opt-in) | chrome.storage.local | Cells reported this release period | < 1 KB |
| Server aggregates | Supabase `agg_outcome` | 20 ops × 3 need × 8 categories × 2 modes = 960 cells per window per library version | trivial |

Per-site rules sync across devices only if the user opts in. The two options are client-side encryption with a key stored in `chrome.storage.sync`, or `chrome.storage.sync` itself. Both keep domains off WebAble's servers. v1 recommendation: local-only.

---

## 13. Event schemas

### 13.1 Local event (never leaves the device)

```ts
type PageCategory = 'article'|'search_results'|'form_checkout'|'web_app'|'feed_social'|'docs_reference'|'media_video'|'other';
type EventKind = 'applied'|'offered'|'offer_accepted'|'offer_dismissed'|'offer_ignored'|'undo'|'undo_reason'
  |'intensity_change'|'episode_end'|'manual_on'|'site_disable'|'site_enable'|'global_disable'|'rating'
  |'verifier'|'promotion_answer'|'session_end';

interface AdaptEvent {
  v: 1;
  id: string;                 // random UUID
  t: number;                  // epoch ms
  tabSession: string;         // random per page load; not linkable across loads
  domain: string;             // eTLD+1 only; NEVER full URL, path, query, title
  cat: PageCategory;          // from deterministic classifier over snapshot counts
  op: OpId; opVer: number; level: number;
  src: 'profile'|'pinned'|'os'|'offer'|'manual'|'friction';
  kind: EventKind;
  dtApplyMs?: number;         // ms since change became visible
  dir?: 1|-1; fromLevel?: number; toLevel?: number; settledValue?: number; keptMs?: number;
  rating?: 'helped'|'not_helped';
  reason?: 'dont_want'|'too_much'|'too_little'|'broke_page';
  pass?: boolean; vcode?: 'clip'|'contrast_drop'|'focus_orphan'|'violations_up'|'layout_shift'|'timeout';
  aiLabel?: 'clear'|'likely'|'unsure';
  friction?: 'misclick_burst'|'zoom_in'|'scroll_reversal';
  answer?: 'yes'|'no';        // promotion prompt
}
```

The existing `PageSnapshot` includes `url`, `title`, `text.excerpt`, and `headings`. **None of those may be copied into events or learning state.** Learning needs only the eTLD+1 (local), the category, and counts.

### 13.2 Sync delta (to Supabase; domain-free)

```ts
interface LearnDelta { v: 1; deltaId: string; day: number;
  op?: OpId; ds?: number; df?: number; accepts?: number; src?: OpState['src']; blocked?: boolean;
  dim?: DimId; obs?: { kind: 'point'|'gt'|'lt'; value: number; r: number } }
```

### 13.3 Opt-in aggregate report (Phase 1)

```ts
interface AggReport {
  v: 1; window: string;         // e.g. '2026-W40/4' (4-week window id)
  libVer: string; priorRelease: string;
  cells: Array<{                 // ≤ 4 per window, each (op,need,cat,mode,trigger) ≤ 1× per 12-week release period
    op: OpId; need: 0|1|2; cat: PageCategory; mode: 'auto'|'offer'; trigger: 'profile'|'friction'|'pinned';
    y: 0|1;                      // randomized-response bit (§14.2)
  }>;
  engine?: Array<{ op: OpId; cat: PageCategory; vcode: string; c: 1|2|3 }>; // clipped counts, no need level
  ai?: Array<{ op: OpId; label: 'clear'|'likely'|'unsure'; y: 0|1 }>;      // RR bit, ≤ 2 per window
}
```

### 13.4 Server tables (Supabase)

```sql
create table learning_state (
  user_id uuid primary key references auth.users on delete cascade,
  state jsonb not null check (octet_length(state::text) < 8192),
  updated_at timestamptz not null default now());
alter table learning_state enable row level security;
create policy own on learning_state using (user_id = auth.uid()) with check (user_id = auth.uid());

-- No user_id column. No client grants. Written only by the ingest Edge Function (service role).
create table agg_outcome (
  window text, lib_ver text, op text, need smallint, cat text, mode text, trigger text,
  n integer not null default 0, ones integer not null default 0,
  primary key (window, lib_ver, op, need, cat, mode, trigger));

-- Abuse/rate limit only: HMAC(user_id, period_salt); salt rotated and destroyed each period.
create table ingest_quota (tag bytea primary key, period text, used smallint, expires_at timestamptz);

create table global_priors (release text, op text, need smallint, cat text,
  p0 real, n_eff real, primary key (release, op, need, cat));   -- public-read, non-personal
```

The ingest function runs `insert … on conflict do update set n = n + 1, ones = ones + $y`. It never inserts a row per report, and it must not `console.log` bodies. Supabase retains Edge Function and API logs for 1 day on the Free plan and 7 days on Pro, and those logs carry request metadata. Say so in the privacy notice.

---

## 14. Product-level learning (privacy-preserving)

### 14.1 Scale check first

Binary randomized response (Warner 1965) with truth probability p = e^ε/(1 + e^ε). At ε = ln 3, p = 0.75.

- Unbiased estimator: f̂ = (r − (1 − p))/(2p − 1) = 2r − 0.5, where r is the observed fraction of ones.
- Variance: Var(f̂) = r(1 − r)/(n(2p − 1)²).
- Effective sample size: n_eff = n(2p − 1)² = n/4.

| Reports per cell n | SD of f̂ (at f = 0.5) | n_eff |
|---|---|---|
| 50 | 0.141 | 12 |
| 100 | 0.100 | 25 |
| 400 | 0.050 | 100 |
| 1000 | 0.032 | 250 |

With 960 cells, a useful global prior (SD ≤ 0.05 on the cells that matter) needs thousands of opted-in devices. LDP is known to require large populations to be accurate (Cormode et al. SIGMOD 2018 tutorial; Wang et al. USENIX Security 2017).

**Phase gating:**

- **Phase 0 (now through first public release):** no product telemetry. Expert prior table P₀ (reviewed, versioned JSON) plus engine priors from CI corpus runs.
- **Phase 1 (≥ about 500 weekly opted-in devices):** the pipeline below.
- **Phase 2 (≥ several thousand devices):** richer histograms through a shuffler (amplification by shuffling; Erlingsson et al. SODA 2019) or the IETF DAP/Prio3 two-server aggregation (draft-ietf-ppm-dap, active July 2026). Neither is needed before then.

### 14.2 Phase-1 pipeline

1. **Consent.** A separate, off-by-default toggle ("Help improve WebAble's starting suggestions"), with a plain-language description of exactly the fields in §13.3 and a "see last report" viewer. Withdrawal stops future reports. Past aggregates can't be separated back out, and the consent text says so.
2. **Client-side reduction.** For each cell (op, need(o), cat, mode, trigger) with new evidence in the window, compute the local outcome y* = 1{ΔS/(ΔS + ΔF) ≥ 0.5}. Choose **at most 4 cells** uniformly at random. A cell already reported this 12-week release period is not eligible.
3. **Randomize.** Send y = y* with probability 0.75, else 1 − y* (ε = ln 3 ≈ 1.10 per cell; ≤ 4.4 per 4-week window).
   - For comparison, Apple's deployed LDP budgets are ε = 2-8 **per day** per use case (Apple DP Team 2017), and its real cumulative loss was criticized as higher than advertised (Tang et al. 2017).
   - The cell key is **not** randomized. It is protected by coarseness, absence of identifiers, contribution bounding, and k-thresholding.
   - Marginal disclosure is small: the server already holds the user's profile for sync. What telemetry adds is the page category and an RR-protected outcome.
   - The key is deliberately **one** need level, for the op's own dimension. A full 8-dimension profile vector is a quasi-identifier (3⁸ = 6561 combinations) and would defeat k-anonymity (Sweeney 2002).
4. **Transport and ingest.**
   - Authenticated POST, used only to enforce 1 report per account per window via `ingest_quota` (HMAC with a per-period salt that is destroyed).
   - The function drops the identity, increments `agg_outcome`, and returns 204.
   - No per-report rows, no IP persistence, no body logging.
   - This is "trust-the-server" anonymity for the key. RR gives plausible deniability even against the server for the outcome.
5. **Release (monthly, human-reviewed).** For each cell over the trailing 12 weeks:
   - Add Laplace(0, 2) noise to n and to ones, which blocks exact differencing between releases. **Publish only if noisy n ≥ k = 50.** Contribution bounding makes that ≥ 50 distinct devices.
   - f̂ = clip(2·ones/n − 0.5, 0, 1). v̂ = r(1 − r)/(0.25·n).
   - Empirical-Bayes smoothing across cells of the same op (Casella 1985): τ̂² = max(0, Var(f̂) − mean(v̂)), f̃ = w·f̂ + (1 − w)·f̄_op, w = τ̂²/(τ̂² + v̂).
   - Blend with the expert prior: p_new = (20·p_expert + n_eff·f̃)/(20 + n_eff), n_eff = n/4. The expert table is worth 20 observations, so data dominates only past about 80 reports.
   - Clamp |p_new − p_prev| ≤ 0.10 per release. A human reviews the diff, then it ships as versioned JSON (data, not code) in the next extension build or a static fetch.
   - Personal m₀ is unchanged: global data moves the **center** of priors, never their strength.
6. **Same pipeline, separate cells:** AI-label calibration (op, label, y) and engine reliability (op, cat, vcode, clipped count). Engine counts carry no need level.
7. **Poisoning resistance:** the per-account quota, the ±0.10 clamp, the expert blend, and human review. Since `mode` and `trigger` are separate cells, a flood of fake "friction" outcomes cannot move "profile" priors.

### 14.3 Retention

| Data | Where | Retention |
|---|---|---|
| Local event ring buffer | device | 30 days / 500 events |
| Domain state | device | LRU 500; evict after 180 days idle; "Forget this site" and "Reset learning" in the inspector |
| `learning_state` | Supabase | Life of the account. Deleted on account deletion (cascade). Exportable. |
| Pending sync deltas | Supabase | Deleted once applied (seconds) |
| `ingest_quota` | Supabase | Until end of period (≤ 5 weeks); salt destroyed |
| `agg_outcome` | Supabase | 13 months, then deleted |
| `global_priors` releases | public | Indefinite (non-personal) |
| Platform request logs | Supabase | Plan-dependent (1-7 days). Do not add app-level logging. |

### 14.4 What NOT to store, anywhere

- Full URLs, paths, query strings, page titles, text excerpts, headings, DOM, screenshots.
- Domains, on any server. Domains stay local only.
- Timestamps finer than a day in synced state, or finer than a 4-week window in telemetry.
- Raw interaction traces: pointer paths, click coordinates, keystrokes, scroll logs, dwell sequences.
- Per-event rows server-side, for either learning deltas (applied then deleted) or telemetry (increment-only).
- Multi-dimensional profile vectors in telemetry. Condition, diagnosis, or persona labels in any store. Inferred "impairment" scores.
- Model prompts or responses that contain page content. Free-text feedback, except through an explicit bug-report flow the user fills out.
- Device fingerprints, IP addresses, installation IDs in telemetry.

### 14.5 Legal posture (not legal advice)

- Functional accessibility needs linked to an identified account can be "data concerning health" under GDPR Art. 4(15) and Art. 9, which requires explicit consent under Art. 9(2)(a) *(URLs not re-verified this session)*.
- Washington's My Health My Data Act defines consumer health data to include data "derived or extrapolated from non-health information," including by algorithms or machine learning. That plausibly reaches learned preference state.
- Treat `learning_state` as health-adjacent: explicit consent at onboarding, deletion and export, no sale or sharing, and minimization as specified above.

---

## 15. Simulation evidence and the test harness to keep

`sim4.py` (scratchpad) generates 400 synthetic users × 600 page visits.

**Population model:**

- Need mix: 30% strong, 40% mild, 30% none.
- Calibration is informative but imperfect: true preference = logit(p₀) + N(0, 1).
- Domain deviations: N(0, 0.8) in logit space. 40 domains with Zipf-distributed visits; 70% of visits are op-applicable.

**Behavior model:**

- Unwanted auto-apply: 60% fast undo, 20% late undo, 20% silence.
- Wanted auto-apply: 90% silence, 5% late undo, 5% "helped".
- Offers: 70% accepted if wanted; 60% dismissed if unwanted.

**Utility:** +1 for a wanted change, −2.33 for an unwanted auto-apply, −0.3 per offer. Common random numbers across policies.

Per 100 applicable visits:

| Policy | Unwanted auto | Wanted auto | Offers accepted | Offers shown | Net (stationary) | Net (preference flips mid-way) |
|---|---|---|---|---|---|---|
| Static profile (no learning) | 5.98 | 20.3 | 0 | 0 | 7.8 | **−16.0** (unwanted 13.2) |
| Static + offers | 5.98 | 20.3 | 5.8 | 12.0 | 9.6 | −14.8 |
| Thompson sampling | 4.40 | 18.7 | 7.1 | 15.9 | 11.9 | 3.1 (unwanted 7.2) |
| **Posterior-mean ladder (recommended)** | **3.63** | 19.3 | 6.3 | 14.3 | **13.9** | **10.5** (unwanted 4.1) |
| Same + q80 offers | 3.63 | 19.3 | 6.4 | 14.6 | 13.8 | 10.1 |
| Pessimistic auto (q20 ≥ 0.6) | 3.37 | 17.9 | 7.0 | 15.8 | 13.4 | 9.7 |
| Oracle (knows true p) | 4.82 | 27.9 | 12.1 | 34.6 | 18.7 | 19.1 |

A second seed reproduced the ordering: ours 17.1 vs TS 15.3 vs static 9.8.

- Sensitivity to κ (2-8), τ_offer (0.3-0.5), and half-life (30-365 d) is small.
- τ_auto and the silence weight are the dials that matter.

**Keep this as a vitest property suite** over the real TypeScript policy (not the Python). Acceptance gates:

- Unwanted auto-applies ≤ 4 per 100 applicable visits after week 1.
- After a preference reversal, demotion within ≤ 3 relevant visits on the affected domain.
- Offers ≤ 1 per page and ≤ 4 per day, always.
- No promotion without a recorded "yes".
- Verifier rejections never change θ̄.
- A hard block is never overridden.

These are cheap, deterministic, and demonstrable in the thesis.

---

## 16. Parameter table (v1 defaults)

| Parameter | Value | Where it came from |
|---|---|---|
| Calibration prior strength m₀ | 4 + 6·confidence (4-10) | Personal evidence dominates after about 10 events. Calibration is objective, so it earns more weight than a survey would. |
| Tier-0 prior | p₀ ≈ 0.2, m₀ = 2 | Weak population prior. |
| Domain concentration κ | 4 | SIM-insensitive over 2-8. One fast undo demotes a strong-need op on that domain. |
| Half-life (all counts) | 90 days | Discounted-bandit practice. SIM: modest gain under drift, negligible cost. |
| τ_auto | 0.70 | Break-even with C/B = 2.33 (inaccurate adaptation costlier than none). |
| τ_offer | 0.40 | Interrupt cost 0.4B. SIM-insensitive over 0.3-0.5. |
| Promotion | θ̄ ≥ 0.70, ≥ 3 accepts, ≥ 2 domains, ask once per 60 days | Offer-never-impose. |
| Site promotion | θ̄_h ≥ 0.80, ≥ 3 accepts on h | |
| Signal weights | ±1.0 explicit / fast undo; −0.5 med; −0.3 late; +0.75 accept-kept; +0.25 adjust-kept; −0.25 dismiss; +0.15 silence (≤ 1/day/domain); 0 ignore; +1 manual-on | §4 |
| Undo timing cutoffs | 10 s, 5 min | Short-dwell and dwell-time literature, scaled to instant visual change. |
| Episode | quiet 20 s; kept ≥ 2 min | |
| Offer budget | 1 per page, 4 per day; 7-day site cooldown; 3 dismissals → 30-day global cooldown | |
| Friction LR | mis-click burst 3, zoom-in 4, scroll reversal 2 | Initial guesses; tune in the user study. |
| Engine gate | P_ok ≥ 0.5; 2 rejects in 7 days → skip 7 days | |
| Kalman | R = 0.10², Q = 0.01²/day, σ_min = 0.03, lab-to-wild gap 0.10, domain τ = 0.10, hysteresis 0.03 log, 2 sessions | |
| AI label map (initial) | clear 0.80, likely 0.55, unsure 0.25 | Conservative; refit monthly. |
| RR | ε = ln 3 per cell; ≤ 4 cells per 4-week window | |
| k-threshold | 50 distinct devices (noisy count, Laplace scale 2) | |
| Expert blend | worth 20 observations; ±0.10 per release; human review | |

---

## 17. Risks and open questions

1. **Weights and costs are assumptions.** C/B = 2.33, the friction LRs, and the signal weights should be checked in the within-subjects study. Cheapest instrument: after the study task, ask participants to rate a few specific auto-applied changes, then compare with what the policy logged.
2. **Undo is overloaded.** It can mean "don't want," "too much," or "broke the page." The reason chip is the cheapest fix. If chip response rates are low (< 20%), rely on episode parsing and accept the noise.
3. **Page-category classifier quality.** Category enters only priors and telemetry, so errors cost little. Keep it deterministic over snapshot counts, with no model.
4. **Cross-dimension coupling** (larger text → longer effective line length → spacing changes) is ignored. The library should enforce coupled constraints deterministically. It is not a learning problem.
5. **Shared computers** (two people, one profile) will look like drift. Decay handles slow drift. For shared machines, the answer is profiles, not learning.
6. **Promotion prompts are interruptions.** Count them against the offer budget.

---

## 18. References

Bandits, Bayesian decision, and shrinkage
- Chapelle, O. & Li, L. (2011). An Empirical Evaluation of Thompson Sampling. NIPS. https://papers.nips.cc/paper_files/paper/2011/file/e53a0a2978c28872a4505bdb51db06dc-Paper.pdf
- Li, L., Chu, W., Langford, J., Schapire, R. (2010). A Contextual-Bandit Approach to Personalized News Article Recommendation. WWW. https://arxiv.org/abs/1003.0146
- Li, L., Chu, W., Langford, J., Wang, X. (2011). Unbiased Offline Evaluation of Contextual-bandit-based News Article Recommendation Algorithms. WSDM. https://arxiv.org/abs/1003.5956
- Russo, D., Van Roy, B., Kazerouni, A., Osband, I., Wen, Z. (2018). A Tutorial on Thompson Sampling. https://arxiv.org/abs/1707.02038
- Kaufmann, E., Cappé, O., Garivier, A. (2012). On Bayesian Upper Confidence Bounds for Bandit Problems. AISTATS. https://proceedings.mlr.press/v22/kaufmann12.html
- Auer, P., Cesa-Bianchi, N., Fischer, P. (2002). Finite-time Analysis of the Multiarmed Bandit Problem. Machine Learning 47. https://doi.org/10.1023/A:1013689704352 *(not re-verified)*
- Agrawal, S. & Goyal, N. (2012). Analysis of Thompson Sampling for the Multi-armed Bandit Problem. COLT. https://arxiv.org/abs/1111.1797 *(not re-verified)*
- Wu, Y., Shariff, R., Lattimore, T., Szepesvári, C. (2016). Conservative Bandits. ICML. https://proceedings.mlr.press/v48/wu16.html
- Hong, J., Kveton, B., Zaheer, M., Ghavamzadeh, M. (2022). Hierarchical Bayesian Bandits. AISTATS. https://arxiv.org/abs/2111.06929
- Raj, V. & Kalyani, S. (2017). Taming Non-stationary Bandits: A Bayesian Approach (discounted TS). https://arxiv.org/abs/1707.09727
- Garivier, A. & Moulines, E. (2011). On Upper-Confidence Bound Policies for Non-Stationary Bandit Problems. ALT. https://arxiv.org/abs/0805.3415
- Casella, G. (1985). An Introduction to Empirical Bayes Data Analysis. The American Statistician 39(2). https://doi.org/10.1080/00031305.1985.10479400
- Agarwal, D., Agrawal, R., Khanna, R., Kota, N. (2010). Estimating Rates of Rare Events with Multiple Hierarchies through Scalable Log-linear Models. KDD. https://doi.org/10.1145/1835804.1835834
- Denrell, J. & March, J. G. (2001). Adaptation as Information Restriction: The Hot Stove Effect. Organization Science 12(5). https://doi.org/10.1287/orsc.12.5.523.10092

Continuous preference estimation
- Kalman, R. E. (1960). A New Approach to Linear Filtering and Prediction Problems. J. Basic Engineering. https://doi.org/10.1115/1.3662552 *(not re-verified)*
- Glickman, M. E. (1999). Parameter Estimation in Large Dynamic Paired Comparison Experiments (Glicko). JRSS-C 48(3). https://doi.org/10.1111/1467-9876.00159
- Herbrich, R., Minka, T., Graepel, T. (2006). TrueSkill: A Bayesian Skill Rating System. NIPS. https://papers.nips.cc/paper/3079-trueskilltm-a-bayesian-skill-rating-system
- Watson, A. B. & Pelli, D. G. (1983). QUEST: A Bayesian Adaptive Psychometric Method. Perception & Psychophysics 33. https://doi.org/10.3758/BF03202828

Implicit feedback and bias
- Joachims, T., Granka, L., Pan, B., Hembrooke, H., Gay, G. (2005). Accurately Interpreting Clickthrough Data as Implicit Feedback. SIGIR. https://www.cs.cornell.edu/people/tj/publications/joachims_etal_05a.pdf
- Joachims, T., Swaminathan, A., Schnabel, T. (2017). Unbiased Learning-to-Rank with Biased Feedback. WSDM. https://arxiv.org/abs/1608.04468
- Schnabel, T., Swaminathan, A., Singh, A., Chandak, N., Joachims, T. (2016). Recommendations as Treatments: Debiasing Learning and Evaluation. ICML. https://arxiv.org/abs/1602.05352
- Hu, Y., Koren, Y., Volinsky, C. (2008). Collaborative Filtering for Implicit Feedback Datasets. ICDM. https://doi.org/10.1109/ICDM.2008.22
- Fox, S., Karnawat, K., Mydland, M., Dumais, S., White, T. (2005). Evaluating Implicit Measures to Improve Web Search. ACM TOIS 23(2). https://doi.org/10.1145/1059981.1059982
- Kim, Y., Hassan, A., White, R. W., Zitouni, I. (2014). Modeling Dwell Time to Predict Click-level Satisfaction. WSDM. https://doi.org/10.1145/2556195.2556220

Calibration of model confidence
- Guo, C., Pleiss, G., Sun, Y., Weinberger, K. Q. (2017). On Calibration of Modern Neural Networks. ICML. https://arxiv.org/abs/1706.04599
- Xiong, M. et al. (2024). Can LLMs Express Their Uncertainty? An Empirical Evaluation of Confidence Elicitation in LLMs. ICLR. https://arxiv.org/abs/2306.13063

Adaptive UI (HCI)
- Gajos, K. Z., Everitt, K., Tan, D. S., Czerwinski, M., Weld, D. S. (2008). Predictability and Accuracy in Adaptive User Interfaces. CHI. https://www.eecs.harvard.edu/~kgajos/papers/2008/kgajos-chi08-predictability.pdf
- Findlater, L. & McGrenere, J. (2004). A Comparison of Static, Adaptive, and Adaptable Menus. CHI. https://doi.org/10.1145/985692.985704
- Gajos, K. & Weld, D. S. (2005). Preference Elicitation for Interface Optimization. UIST. https://doi.org/10.1145/1095034.1095063
- Lomas, J. D. et al. (2016). Interface Design Optimization as a Multi-Armed Bandit Problem. CHI. https://doi.org/10.1145/2858036.2858425
- Lavie, T. & Meyer, J. (2010). Benefits and Costs of Adaptive User Interfaces. IJHCS. http://www.cs.tufts.edu/~jacob/250aui/AdaptiveBenefits_Lavie_IJoHCI10.pdf
- Wanscher, L. B. et al. (2026). From Blind Edits to Verified Repair: Building Trustworthy User-Side LLM Agents for Web Accessibility. https://arxiv.org/abs/2608.24913

Privacy
- Warner, S. L. (1965). Randomized Response: A Survey Technique for Eliminating Evasive Answer Bias. JASA 60. https://doi.org/10.1080/01621459.1965.10480775
- Erlingsson, Ú., Pihur, V., Korolova, A. (2014). RAPPOR: Randomized Aggregatable Privacy-Preserving Ordinal Response. CCS. https://arxiv.org/abs/1407.6981
- Wang, T., Blocki, J., Li, N., Jha, S. (2017). Locally Differentially Private Protocols for Frequency Estimation. USENIX Security. https://www.usenix.org/conference/usenixsecurity17/technical-sessions/presentation/wang-tianhao
- Cormode, G., Jha, S., Kulkarni, T., Li, N., Srivastava, D., Wang, T. (2018). Privacy at Scale: Local Differential Privacy in Practice. SIGMOD tutorial. https://dimacs.rutgers.edu/~graham/pubs/papers/ldptutorial.pdf
- Apple Differential Privacy Team (2017). Learning with Privacy at Scale. https://machinelearning.apple.com/research/learning-with-privacy-at-scale ; overview: https://www.apple.com/privacy/docs/Differential_Privacy_Overview.pdf
- Tang, J., Korolova, A., Bai, X., Wang, X., Wang, X. (2017). Privacy Loss in Apple's Implementation of Differential Privacy on MacOS 10.12. https://arxiv.org/abs/1709.02753
- Erlingsson, Ú., Feldman, V., Mironov, I., Raghunathan, A., Talwar, K., Thakurta, A. (2019). Amplification by Shuffling: From Local to Central Differential Privacy via Anonymity. SODA. https://arxiv.org/abs/1811.12469
- Sweeney, L. (2002). k-Anonymity: A Model for Protecting Privacy. IJUFKS 10(5). https://doi.org/10.1142/S0218488502001648
- IETF PPM WG. Distributed Aggregation Protocol for Privacy Preserving Measurement (draft-ietf-ppm-dap). https://datatracker.ietf.org/doc/draft-ietf-ppm-dap/

Platform and legal
- Chrome `storage` API quotas (sync: 100 KB total, 8 KB per item, 512 items). https://developer.chrome.com/docs/extensions/reference/api/storage
- Chrome Web Store MV3 requirements (remote code = JS/WASM; data is allowed). https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements *(not re-verified)*
- Supabase pricing and log retention. https://supabase.com/pricing ; https://github.com/orgs/supabase/discussions/36252
- Washington My Health My Data Act, AG overview. https://www.atg.wa.gov/protecting-washingtonians-personal-health-data-and-privacy ; FPF brief: https://fpf.org/wp-content/uploads/2023/04/FPF-Legislation-Policy-Brief_-The-Washington-My-Health-My-Data-Act-Public-Version.pdf
- GDPR Art. 9 and Art. 4(15). https://gdpr-info.eu/art-9-gdpr/ ; https://gdpr-info.eu/art-4-gdpr/ *(not re-verified)*
