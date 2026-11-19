# Jev in the field: independent evidence (as of 2026-09-28)

Scope: how TypeSafe AI's Jev (System One decision model, launched 2026-09-15, `jev-1.13.0`) actually performs, drawn from independent measurements. Vendor claims are labelled **[vendor]**. Nearly every number below is for `jev-1.13.0` / `typesafe/jev-1.13-20260917`. Most studies were run by one person, in the first two weeks, on small budgets. Treat them as evidence to check, not as settled results.

**Source-quality note.** The sources that ran real measurements are: jev-measured (WallerChen), jev-phishing-bench (anisselbd), PriorBench, scienthoon, the TDS Banking77 article, Every, jev-orderby-bench, jev-calibration-audit, pi-heed, browser-jev, jevnav, jevaluate, jev-wide, and the entries in the awesome-jev-robustness list. The following ran **no tests of their own**: heise, The Batch, DataCamp, MindStudio, the LangChain blog, OpenRouter's blog, Firecrawl's blog and docs, the LiteLLM docs and blog, Vercel, and the Hugging Face "sora-2" guides. The Simon Willison post contains one informal test. The HF "sora-2" guides describe `thejevai.com`, which is a **third-party reseller that is not affiliated with TypeSafe**. Do not mix its keys or URLs with `api.typesafe.ai`.

---

## 0. API facts that change how you read the numbers (verified in the wild)

- **Request**: `POST https://api.typesafe.ai/v1/systemone` `{model, state, questions:{id:{type, instructions, criteria}}}`.
  - `state` can be a string, a JSON object or a JSON array. Text only. A bare number or boolean returns 422 (Spring AI).
  - Choice `criteria` is a map `{option: description|null}`. Score `criteria` is an ordered list. Noul `criteria` is an optional `{true, false}`.
  - Noul with only `instructions` works (phishing-bench `run_jev.py`).
  - Choice with `null` descriptions works.
- **Other routes**:
  - OpenRouter: `https://openrouter.ai/api/alpha/decisions`. Model id `typesafe/jev-1.13` or `~typesafe/jev-latest`. It is **absent from the catalogue**, `/chat/completions` rejects it, and you must not send `temperature` or `max_tokens`.
  - Vercel AI Gateway: `typesafe-ai/jev` via `ai-gateway.vercel.sh/v1/evaluate` / `experimental_evaluate`. `typesafe-ai/jev-latest` returns "Model not found" (scienthoon), and the gateway exposes no model version.
  - LiteLLM pass-through: `/typesafe/v1/systemone`. No streaming.
  - First-party model ids: `jev-latest`, `jev-preview`, `jev-1.13.0`. The id `jev-1.13` is **rejected** (jev-measured).
- **Response shapes that people get wrong** (jev-measured, confirmed across its dataset):
  - `score` is the probability-weighted mean of **indices 0..n-1**, not a 0-1 value. Example: `2.68` on a 4-level rubric.
  - `probabilities` are keyed by index (`"0"`, `"1"`…). Use `legend` to map indices back to labels.
  - Noul returns `{"type":"noul","noul":0.99}` and **nothing else**: there is no `confidence` field.
  - Probabilities are **quantised to 0.01**. Exact 0 and 1 values are common, and at 200 options 95.8% of options come back as 0.00 (jev-wide).
  - Choice `confidence` = (N·p_max − 1)/(N − 1). It is a deterministic function of the probabilities, not an extra signal (awesome-jev-robustness; phishing-bench measured r = 0.9997 on two-option Choice).
- **Billing**: input tokens only, at $0.042/M. Output tokens are reported but not billed; the TypeSafe dashboard confirmed $0.15 for 3.66M input + 0.90M output tokens (phishing-bench). The first-party response contains no cost field; OpenRouter adds one.
- **Isolation**: every question sees the shared state, and no question sees any other question.
  - Archer Hume's probes: a "secret" placed in a sibling question gave P = 0.00 (5/5); the same secret placed in the state gave 0.90-0.92 (reported via smartscope.blog and navinpai.github.io).
  - Question IDs are **not sent to the model**, so the full question must be in `instructions` (docs; OpenRouter blog; phishing-bench CLAUDE.md).
- **Per-question context is supported**.
  - `instructions`, Choice option descriptions, Score levels and Noul `criteria.true/false` each accept a string, object, array or null (docs.typesafe.ai "Advanced: structure").
  - The vendor example puts `field` and `extracted_value` inside each question's `instructions` object.
  - Data placed there is private to that question (Hume). The token budget is described as "32k for state plus the longest question" (Firecrawl, The Batch), which is consistent with each question being a separate branch built from state plus that question.

---

## 1. Measured performance

### Latency: always ask where it was measured from

**Server-side time** (read from the `x-envoy-upstream-service-time` header, first-party API, jev-measured): **70-116 ms** across 8 fixtures with 1-5 questions.

| Setting | Median / p50 | Tail | Source |
|---|---|---|---|
| First-party, 8 fixtures (1-5 Qs, 364-539 tok) | wall 260-334 ms | min 242 | jev-measured `data/direct-latency.json` |
| First-party vs OpenRouter, interleaved ×12 | 313 ms vs 734 ms | p90 423 vs **1,739** ms | jev-measured §5 |
| OpenRouter, 8 fixtures | 458-563 ms, of which the TCP floor was 198.8 ms | — | jev-measured |
| First-party from France, 2,000 emails, 9 Qs, ~915 tok | **239 ms** (warm floor 163 ms) | p95 **331 ms** | phishing-bench |
| First-party from Seoul, 1 Q | 280 ms | p95 397 ms | jev-calibration-audit |
| From Japan, Banking77 (77-option choice, 2,288 tok) | 245 ms | — | TDS |
| OpenRouter from W. Europe, 491 calls | **475 ms** (floor ~430 ms, min 347) | p90 558 / p95 604 / p99 715 | PriorBench |
| Vercel/other, 24 decisions | 808-848 ms | — | zhengbangbo/structured-decision-bench |
| Every (Mike Taylor) writing checks | 0.35 s vs 8.83 s for Fable 5.1 | — | every.to |
| jevnav element picks | p50 365 ms, $0.000153/decision | — | dtduc-git/jevnav |
| **[vendor]** | "70-500 ms end to end, most around 100" | — | docs via flaviocopes |

**Cold vs warm connection.** From France to `api.typesafe.ai`, a cold connection (DNS + TCP + TLS + tiny GET) took p50 **529 ms**; a warm keep-alive connection took **163 ms** (phishing-bench `net_floor.json`). A cold start therefore costs about **+370 ms**, so reuse connections. The host is US-hosted. The docs do not say where it is hosted; this is inferred from latency.

**Effect of state size.** Growing the state 23× (376 to 8,724 tokens) raised p50 from 437 to 508 ms, about 8.5 µs per input token (PriorBench).

**Effect of the number of questions**:
- **Flat in practice at typical counts.**
  - 1 → 12 questions: −9 ms (PriorBench).
  - 16 vs 1: +14 ms (calibration-audit).
  - 1/4/8 questions: 274/273/276 ms (pi-heed).
  - Server time for 1/3/4/5 questions: 70/72/81/74 ms (jev-measured).
  - The Spring AI blog reports 275 ms for 1 question vs 310 ms for 3.
- **At very high counts**:
  - PriorBench: 100 Qs 1,078 ms; 400 Qs 560 ms; **800 Qs 985 ms, $0.00075**. These are single, noisy measurements on a tiny state with near-identical questions, and latency was the only thing measured, not accuracy.
  - Hume: flat to about 100 questions, then rising.
- **Bundling vs separate calls [vendor cookbook]**: a 54,000-character document with 13 questions took 0.27 s and $0.000497 as one call, vs 2.71 s and $0.00609 as 13 calls (cited in TDS).

**Concurrency** (OpenRouter, PriorBench):

| Concurrent requests | Throughput | p50 | p95 |
|---|---|---|---|
| 1 | 1.9 req/s | — | — |
| 8 | 10.4 req/s | 576 ms | 863 ms |
| 16 | 11.2 req/s | — | — |
| 32 | 16.2 req/s | 1,493 ms | — |

- No 429s were seen at any level on this route.
- pi-heed: 8 parallel requests took about 650 ms each, vs 274 ms for a single request.
- On Vercel, concurrency 32 caused retry storms, and the free tier allowed "a handful of requests per minute" (scienthoon).

### Cost math (measured)

- A real call costs **$0.0000153-0.0000226** for 364-539 input tokens (jev-measured). That is about **20× below** the "$0.0004 per decision" figure in circulation.
- Cost depends only on (state + question) tokens. **State is billed once per call**, so N separate calls pay for the state N times.
- Phishing, 915 tokens/email including 9 questions: $0.0384 per 1,000 emails, vs $0.462 for Haiku 4.5 (a single-verdict prompt) and $1.02 for Haiku asked the same 5 signal questions.
- A question costs about 20 tokens: 800 noul questions came to about 17.8k tokens (PriorBench).
- PriorBench's whole 5,721-call suite cost $0.176. Unit price $0.042000/M was verified to six decimals.
- **Vs cheap chat LLMs with structured output**: mistral-small-3.2 costs 1.4× and gemini-2.5-flash-lite 1.7×. On one single-question fixture, mistral was *cheaper* than Jev. The 18× multiple vs gpt-5-nano comes from reasoning tokens (jev-measured).
- **[vendor]** TypeSafe told DataCamp it "can't prove the pricing isn't subsidized".

### Accuracy vs LLM baselines

| Task | Jev | Baseline | Source |
|---|---|---|---|
| 27 labelled support tickets, 3 passes | 27/27 | mistral-small 27/27; gemini-flash-lite 26/27; gpt-5-nano 26/27 (temp 0) — **tie** | jev-measured |
| Banking77, 3,080 msgs, 77 intents | **81.1%** [79.6-82.4] | local Qwen 76.4% (1.72% invalid labels) | TDS |
| Phishing (PhishNChips, 2,000), single verdict | **62.6%**, recall 43.2%, FPR 18.0%, AUROC 0.689 | Haiku 4.5 81.3%, AUROC 0.837 (McNemar p<0.0001) | phishing-bench |
| Phishing, same judgment split into 5 signal Nouls + logistic regression (split-half) | **95.0%**, AUROC 0.982 | Haiku with the same 5 Qs 93.2% (p=0.063, a tie); a two-line regex 91.8% | phishing-bench |
| PriorBench 400-item, 4-class, zero-shot | **95.9%** (explicit 100 / implicit 99.6 / trap 90.0) | keywords 77.2%; TF-IDF+LR 66.0% | PriorBench |
| Writing-defect detection, 7 planted | 6/7 | Fable 5.1 7/7 | Every |
| 18 social-science annotation tasks (7,977 items) | trails the best of 19 LLMs by a median **11.6 macro-F1** | — | Ibrahim & Zaki, arXiv 2609.24574 |
| 5,000 CDC heart-risk respondents | AUC 0.773 | chat LLM 0.794 | jev-heart-risk-bench |
| Agent tool-call risk, 60 cases | 91.7%; every wrong answer at hedged confidence | — | themsquared/jev-benchmark |
| Browser element selection, 9 real sites | 41/41; 30/30 at p ≥ 0.9 | — | jevnav |
| **[vendor]** 4 internal workflows | 67.8% "agreement" (tied with Sonnet 5 / GPT-5.6 Terra 67.9%) | Sol 74.1%, Opus 5 73.1%. The label is the **average of GPT-6 Astra and Fable 5.1**, so this measures agreement, not correctness | DataCamp, The Batch, heise |

**Type reliability is not an advantage over properly configured LLMs.** With `response_format: json_schema, strict: true`, all three chat LLMs went 5/5 on shape. The earlier "LLMs return the wrong type" result was an artifact of not turning structured output on (jev-measured §4). Haiku 4.5 had 0 format errors on 2,000 calls, although it wrapped 2,000/2,000 answers in code fences (phishing-bench).

### Determinism

- **Choice**:
  - Identical 60/60 times, confidence 1.0 each time (PriorBench).
  - orq-ai: every verdict repeated identically 100×.
  - But 50 identical requests produced **15 distinct answer sets**, and there is **no server-side cache** (calibration-audit; OpenRouter lists `supports_implicit_caching:false`).
- **Noul**: ranged **0.46-0.54** across 60 identical calls (PriorBench). The vendor cookbook shows one borderline answer spanning 0.43-0.53.
- **Pass-to-pass drift**:
  - Phishing: 2.2% label flips, mean |Δp| 0.017, max 0.15; 1.0% flips 12 h later.
  - browser-jev: the same page state scored **0.72-0.87** across calls.
  - jev-wide: below about 0.40 confidence, 7.3% of the top-10 changes on repeat.

---

## 2. Calibration evidence

The bottom line across studies: **Jev ranks well, and whether its probabilities are calibrated depends on the task.** Calibration is good in-distribution and when the label is recoverable from the text. It is overconfident when the answer is not in the state or not among the options. The direction of the error depends on the primitive. Reported ECE spans **0.023 to 0.793** across audits; manankumarthakkar/jev-field-report attributes most of that spread to three factors: whether an abstain option existed, which primitive was used, and whether the task was novel.

- **Good**:
  - OpenBookQA ECE 0.024, CommonsenseQA 0.032, HellaSwag 0.029 (probably contaminated; scienthoon).
  - MMLU ECE 0.031 (Hume).
  - CLINC150 ECE 0.020 (assay-001).
  - pi-heed: p 0.9-1.0 → 98% true; p 0.7-0.9 → 94%.
  - Mauboussin quiz: 34/34 correct at ≥95% confidence.
  - Controlled 50/50 mixing: confidence collapses to 0.45 at true ambiguity, and accuracy is 100% wherever a majority exists (PriorBench).
- **Bad**:
  - Phishing ECE 0.154 (Haiku 0.097). In the 0.85-0.95 band Jev was right only about 60% of the time; ≥0.98 gave 97.8% accuracy but covered only 7% of emails.
  - Banking77 (TDS): stated 0.7-0.9 → 53% accurate; 0.9-0.99 → 79%; exactly 1.00 → 97.1%, covering 1,516 msgs with 44 errors.
  - d3code: stated about 0.85 → 45% true.
  - civil_comments: 75% stated → 10% true.
  - Heart-risk Brier skill −1.3.
  - Banking77 ECE 0.094 (assay-001).
- **Unknowable labels**: on an unseen rule-based priority task (the org rule is not in the text), accuracy was 44.7% with mean stated probability **0.74** and ECE 0.325 (scienthoon).
- **By primitive**:
  - Noul tends to be **under-confident** (refit T 0.66). Choice and Score tend to be **over-confident** (T 1.30 and 1.92 after the endpoint-floor correction; scienthoon).
  - Anthus: Noul stated 79.0% vs 72.3% actual; Choice 91.4% vs 76.1%.
  - Noul tracks true proportions about **2× better** than Choice probability: mean error 0.084 vs 0.161 (PriorBench); MAE 5.6 vs 21.1 points (simonmesmith).
  - Fair-die probe: Choice put 82.9% on its pick at 19% accuracy, while independent Nouls recovered 1/6.
  - Score confidence clusters mid-range while Choice confidence is bimodal, so one threshold cannot serve both (thoughts.jock.pl).
- **Do not threshold on the `confidence` field.** It was never better than max-probability and sometimes much worse: ECE 0.18 on the synthetic set (scienthoon).
- **Where to put the threshold is disputed**:
  - PriorBench: accuracy above threshold is flat from 0.50 to 0.95, then jumps to 100% at 0.99 (covering 60.2%). "Gate at 0.99 or not at all."
  - jev-exploration: p ≥ 0.9 gave a 1.000 hit rate at 21.5-32.5% coverage.
  - HF/OpenRouter-style guidance of 0.85/0.6 bands is not measured.
  - Nobody's thresholds transfer: scarif-labs' tuned auto-merge threshold failed out of distribution (50% precision, 15 unsafe merges out of 185).
- **Fixes that work**:
  - Isotonic regression took ECE from 0.117 to **0.008** (AnthusAI, 8,801 examples).
  - A two-parameter recalibration removed 96% of the error (civil_comments).
  - But a calibration fitted on one dataset **did not transfer** to another (d3code), so calibrate per question, per task.
- **Confidence in agent loops**: in a jevnav goal loop with four questions per step, correct decisions landed at p 0.41-0.99 and wrong ones at 0.39-0.47. jevnav's single-question scripted mode was well separated.

---

## 3. Failure modes (measured)

1. **It always answers, even when no option fits (the most serious failure).**
   - Empty string → "technical" at 0.68 confidence; random letters 0.97; a cake recipe 0.94; median 0.91 on garbage input.
   - With no "other" option, 0/30 out-of-scope messages were flagged, at 0.99 confidence. Adding "other" flagged 21/30 (PriorBench).
   - Removing the abstain option on KoBBQ: accuracy 0.950 → **0.000**, ECE 0.023 → 0.793, 79% stereotype picks (calibration-audit).
   - When2Call: hallucinated a tool call on 76% of no-tool cases (baibizhe).
   - A state-blind control, shown only the options, still scores 0.38-0.46 against a 0.15 chance rate.
2. **Wrong or misleading criteria are catastrophic.**
   - Swapped descriptions → **16.7%**, below the 25% random floor (PriorBench).
   - Option *names* override the rubrics bound to them: binding no/yes vs 0/1 dropped AUC from .81 to .58 (Sun & Xu, arXiv 2609.26758).
3. **Signals that are not in the text.**
   - Hidden house rules: 19/24 wrong at high confidence (phuryn); the unknowable priority task (scienthoon).
   - Raw Tetris boards, chess FEN and Robocode action choice are near or below random. They work once computed features are supplied (wondertwins, Tsagaanbayr1, gdchaochao).
   - Sequential state mutation: 13.2% (etsabary).
4. **Counting**: 40-item lists → 72% with distinct distractors, **48%** with similar ones (PriorBench); exact counting 33.3% (etsabary). This is confirmed everywhere.
5. **Numbers, dates and negation: mostly fine, despite the vendor warning.**
   - Number/date comparison 99.6% across 13 designs; date windows 100%; negation 100% including double negation (PriorBench).
   - primeline: 8 of 12 documented failure modes were refuted.
   - Exceptions:
     - Ambiguous US `03/04/2024` dates are resolved with 0.89 confidence.
     - P(x) + P(not x) ranges **0.71-1.42** (calibration-audit).
     - A statement and its negation both scored about 0.95 until the question was switched to an explicit-criteria Choice (JLegends).
     - Arithmetic accuracy depended on option position: 88% when the correct answer was listed first, 57% when last (RINNECODER).
     - Simon Willison and the TDS article repeat the vendor warning without testing it.
6. **Many rows packed into one state (critical for batching many items).**
   - 40 rows in one state, with one generic noul per `rows[i]`, at about 12,600 tokens: mean |Δp| 0.264 vs one row per request; 51% of rows moved by more than 0.20; 77/360 decisions flipped; Spearman 0.579; the ranking gate failed.
   - The damage is a **position effect**: slots 0-7 moved 0.049 on average, slots 16-23 moved 0.31, and slots 24-39 moved about 0.42. Positives are pulled down and negatives pushed up (yodablocks/jev-orderby-bench).
   - 40 Korean sentences: 40/40 correct sent one per call; **62%** as the whole document in one call (Threads, via awesome-jev-robustness).
   - This is distinct from **many questions over a small state**, which do *not* interfere with each other, even with hostile neighbours: shift 0.008, 0.4% flips (calibration-audit).
7. **Distracting shared context.** pi-heed's "go-ahead" question caught 5/9 inside the shared state vs **8/9 in its own minimal request**. Contrast phuthuycoding: a single salient secret was still detected when buried in 49 KB of noise. Noise hurts subtle judgments and multi-target states more than detection of one salient item.
8. **Order effects.**
   - Option order is usually negligible: 0.005 shift, 0/400 flips.
   - It matters on ambiguous or value-laden questions: +0.37 for the first-listed option (pawarbi), a U-shaped 13-point spread (PriorBench), 1 flip in 7 on reorder (gazelle93), 28% flips in Chinese CS (Laya/Qwen).
   - JSON key order in the state can flip decisions (jevfuzz). Jev "anchors on what it reads first": putting the call and newer messages before the old constraint raised confident accuracy from 75% to 100% (pi-heed).
   - IIA fails: adding unrelated candidates shifts log-odds between two untouched options by 0.31-0.50 (jev-wide).
9. **Injection.**
   - Blunt commands mostly fail: 1/90 flips (PriorBench FR); 1/1,056 (cwhy); 0/30 dangerous commands pass (eugeniughelbur).
   - Injections phrased as **evidence** succeed: a Wikipedia-deletion task dropped from 96.5% to **26.5%** with a one-line injected instruction (zkousama/jagged); fluent context flipped **61.4%** of items (JevOut); an `rm -rf ~/.ssh` block probability fell from 0.76 to 0.48 after a fake pre-approval (VentureBeat); authority claims got 3/30 through; Iskandeur 26/80.
10. **Non-English state**: Russian −11 pp, Spanish −3 to −6, Korean −6.5, usually with worse calibration. The language of the *instructions* does not matter (awesome-jev-robustness).
11. **Limits**:
    - Choice options: 255 max (`HTTP 400: Too many choices`), with no degradation up to 255 on an easy discrimination task.
    - Score levels: 2-10.
    - Context: the largest accepted state was 32,553 tokens via OpenRouter; 50k → `max_tokens_exceeded`. The native docs claim 64k total.
    - Wrong types: 0 schema violations in 5 escape attempts, 4,621 calls (scienthoon) and 23,703 calls (dev.to synthesis).
12. **Visual blindness.** The state is text only, so overlap, z-index, contrast and collapsed layouts are invisible (browser-jev). Pair it with deterministic checks or pixel diffs.

---

## 4. Question-design guidance (evidence-ranked)

1. **Criteria content matters most, and must be accurate.**
   - Rewrites moved paired accuracy 70% → 96% (RastislavDujava), 83% → 100% (SYED-M-HUSSAIN), and 0.69-0.89 → 0.92-1.00 (smkrv).
   - Removing descriptions costs only 0.8 pts when option names are self-explanatory (PriorBench).
   - Bare labels dropped confidence to 0.60 (Spring AI).
   - State boundaries explicitly. The vendor pattern is an object `{what, not_for, examples}` per option.
2. **Instruction phrasing matters less, but not zero.**
   - A 4.2-pt spread across 5 paraphrases (PriorBench).
   - 58.4-63.2% across 4 verdict wordings on phishing. The bare "Classify this email" with null descriptions was worst: ECE 0.241 vs 0.115 for the best wording.
   - But "ask about intent, not a taxonomy" took one question from 71% to 93% (pi-heed), and a rephrase moved a site from auto (0.81) to manual (0.50) (gordan-code).
   - A stricter wording worsened ECE from 0.040 to 0.116 (lindfors.no).
   - **Ask exactly what you mean.** "Explicitly forbidden" is not the same as "implied": 27/91 false adds (pi-heed).
3. **Always include an escape option** ("other", "none", "unclear") on every Choice. This is the highest-leverage single fix (§3.1).
4. **Narrow questions beat broad ones.**
   - Untranslated keys scored 0.30 as an example inside a broad "confusing" question and 0.99 as their own question (browser-jev).
   - Split *independent* factors into separate Nouls and combine them in code: phishing went 62.6% → 95.0%.
   - But **merge dependent sub-decisions** into one Choice over whole moves: asking action/target/value as three questions split the target 0.55/0.42 with nothing clearing the gate, while one question over whole moves gave 1.00 (jevaluate).
5. **Use Noul when you need a thresholdable number.** It is better calibrated than Choice probability (§2). Do not threshold it at exactly 0.5, because it is not reproducible there.
6. **Put the facts a human would need into the state.** For example, fields blocked by browser validation, or values typed during the session. The latter took a leak false positive from 0.83 to 0.20 (browser-jev).
7. **Filter state in code; do not ask Jev what rules already know.** "An edit changes files" came back at p ≈ 0.7 (pi-heed). Order the state fields so the decisive material comes first (pi-heed anchoring). Keep the JSON key order stable (jevfuzz).
8. **Fix option order on ambiguous tasks, and keep option names neutral or meaningful** (Sun & Xu). For hard ranking, use random-string names or keep the names consistent with the rubric.
9. **Reference state fields by backticked path** (`` `link_url` ``, `` `order.charges` ``). phishing-bench used this with a JSON state of `{sender, from, subject, body, link_display_text, link_url}` and got 0 errors in 2,000 calls. Nested objects are accepted (docs; the HF guide; the HN CEO reply "JSON with multiple text pieces"). No independent study isolated nested vs flat JSON accuracy. That is an evidence gap.
10. **Reasoning-style prompting (CoT, few-shot, self-consistency) does nothing** (leepokai). Voting across phrasings mostly cost coverage because errors are correlated (pi-heed).

### The four specific questions

- **JSON state with nested structure.**
  - Supported, and used in practice: flat email objects (phishing-bench), 4-field tickets (scienthoon), ARIA snapshot + URL + console errors (browser-jev), nested ticket/order/policy in the docs.
  - Measured risks: key order (jevfuzz), anchoring on early fields (pi-heed), and degradation for items deep in a multi-item state (orderby-bench).
  - No controlled test of nesting depth was found.
- **Classifying many items (e.g., 30 page regions).**
  - *(a) One Choice over many* ("which region is the main content?") works for picking an argmax. jevnav: 120-candidate shortlist (hard cap 254) plus `none`, 41/41 correct; TDS: 77 intents at 81.1%; PriorBench: 255 options at 100% on an easy task.
    - Probabilities are normalised within the call, violate IIA, and 95.8% floor to 0.00 at 200 options, so they are **not per-item scores**. Do not sort or threshold per item on them, and do not merge chunks naively (jev-wide).
  - *(b) Many items as rows in one state, with a per-row question referencing `rows[i]`* degrades by position beyond about 8 items (orderby-bench) and on whole documents (the Korean test). Avoid this for 30 regions unless you measure it on your own data.
  - *(c) One request per item*, with concurrency of about 8, is the measured-safe baseline. It costs roughly 30 × (shared context + item) tokens and about 4 waves of about 0.3-0.6 s each.
  - *(d) Untested but architecturally plausible*: a small shared page context in `state`, with each region's data inside its **own question's `instructions` object**.
    - Questions are isolated branches over state + question (Hume), so this might avoid the position effect of packing rows into state, while keeping a single call (flat latency, state billed once).
    - **No one has measured accuracy for this pattern. Pilot it against (c) before adopting it.**
- **"Questions evaluated in isolation": implications.**
  - Questions cannot reference each other's answers. Dependent decisions need a second call (put the first answer into the next call's state), or must be merged into one Choice over whole moves.
  - Adding or removing a question does not change the others (calibration-audit). This is why question IDs are free to rename, although jevfuzz saw ID renames in its mutation mix.
  - Anything shared must go in `state`, and anything placed in a question is invisible to its siblings.
- **Can you pass per-question context?** Yes. `instructions` and each option or level description accept objects and arrays (docs "Advanced: structure"), and that data is private to the question (Hume). Per-question tokens count against "state + longest question ≤ 32k" (a single-call budget).

---

## 5. Production patterns (what practitioners actually do)

- **One call, many questions.** Never chain Jev calls: about 430 ms per extra round-trip via OpenRouter (PriorBench). Use this for *independent* questions over one small state, not for many items packed into one state (§4).
- **Speculative fan-out**: send questions you may not need, because they cost about 20 tokens each (vendor pattern; PriorBench measured the cost).
- **Gating**:
  - Treat output as a monotone score and calibrate locally with isotonic or Platt scaling on your own labels, per question (scienthoon, AnthusAI, jev-exploration).
  - Gate on max-probability or Noul, not on `confidence`.
  - Threshold choices seen in the wild:
    - 0.99 (PriorBench)
    - 0.9 for scripted single-question steps, 0.99 for destructive intents (jevnav)
    - 0.8 for routing hints (jevaluate: 73% coverage, 100% accurate on its slice)
    - JevJudge: Noul 0.8, Score 2.0, confidence floor 0.5 (Spring)
    - Firecrawl: noul > 0.8 AND confidence ≥ 0.6
    - LiteLLM compaction relevance: 0.2
    - browser-jev: fail only on high confidence **and** high severity
- **Cascades to an LLM for low confidence: evidence against a naive cascade.**
  - TDS on Banking77: Jev kept 49.2% of messages at confidence 1.00. The fallback Qwen got only **57%** of the forwarded cases right, and the cascade "fixed 84 mistakes but introduced 211 new ones". Every cascade tested was worse than Jev alone. Low confidence tells you a case is hard, not that another model can solve it.
  - LangChain, Spring (JevSelfRefineAdvisor), the HF guide and the vendor docs all recommend cascades without measured benefit.
  - The pattern that did work: Jev-extracted atomic signals fed into a small logistic regression (phishing-bench), or routing hints injected into an LLM prompt without removing tools (jevaluate).
- **Decide fewer things with Jev.** Keep deterministic facts, permissions and side effects in code; only Jev-decided calls compound errors (pi-heed: Jev-influenced decisions cut from 52 to 12).
- **Shadow first**: log the decision next to the real outcome for about a week, then act above the gate (jevaluate, the HF guide, browser-jev baseline calibration).
- **Caching**: there is no server-side cache (calibration-audit; OpenRouter `supports_implicit_caching:false`). Cache client-side, keyed on (resolved model version, canonical state, question). Log the resolved `model` field, because aliases such as `jev-latest` and Vercel's `typesafe-ai/jev` move silently. Run a daily fixed-probe drift ledger (calibration-audit). The duckdb-jev per-row cache worked, but its `cache_hits` counter was misleading (orderby-bench).
- **Reliability**:
  - Errors: 401, 422, 429, 529, plus 400 "Too many choices" and `max_tokens_exceeded`. Use bounded exponential backoff with jitter on 429/529, and fail open or closed deliberately (the LiteLLM compaction plugin uses `fail_open`).
  - Timeout of about 5 s (HF guide).
  - Concurrency of about 8.
  - **Prefer first-party over OpenRouter** for tail latency: p90 423 ms vs 1,739 ms.
- **Keep Jev out of hot loops of 300 ms or less** (from Europe). Let it judge slow-moving state instead (PriorBench), or ask pre-emptively while other work streams (pi-heed).

---

## 6. Rate limits and access constraints

- **[vendor, via flaviocopes]** Rate limits of 250,000 tokens/s and 1,200 requests/min. Tokens: about 64k shared state + all questions, about 32k state + the longest question. Up to 255 options, 2-10 score levels. Text only.
- First-party access is **waitlisted / early access**. flaviocopes reports direct signup **paused as of 2026-09-22**, and Firecrawl reports a $5 signup credit.
- OpenRouter and Vercel need **no waitlist** (jev-measured `.env.example`).
- On the Vercel free tier: "a handful of requests per minute" (scienthoon).
- Via OpenRouter: the context is capped at 32k, and no 429s were seen at 32 concurrency (PriorBench).
- The OpenRouter endpoint listing on 2026-09-28 shows `context_length: 32000`, prompt $0.000000042/token, completion 0, uptime 100%.
- Service appears to be US-hosted (latency-inferred; the docs do not say).
- Model version pinning: `jev-1.13.0` first-party, or `typesafe/jev-1.13` on OpenRouter.

---

## 7. What fundamentally differs from generative LLMs

- It generates no text: no rationale, no extraction without candidates, no tools, no loops. "Pick a card from the deck instead of asking it to name one."
- It reads out probabilities over options *you* supply, using a causal-transformer-like readout (Hume, inferred). As a result:
  - output types are always valid;
  - but it **cannot abstain** unless you give it an option to do so;
  - options interact within a question (listwise, IIA violated);
  - order and anchoring effects exist.
- There is no scratchpad, so CoT and few-shot techniques do nothing. Multi-hop derivations and counting fail. It "reads facts better than it derives them" (Selmar).
- Latency is a fixed per-call cost that is roughly flat in question count. Cost is input-only.
- The "can't hallucinate" claim only means it never returns an out-of-schema value. Confident wrong answers are routine off-distribution (HN criticism from seizethecheese and bigglebear; PriorBench §5).

---

## 8. Use-case fit

**Good fit (measured)**:
- Closed-set routing and intent (Banking77 81%, PriorBench 96%).
- Atomic signal extraction combined in code (phishing 95%).
- Moderation or PII-style Nouls on salient content.
- Element or tool selection from a candidate shortlist with a `none` option (jevnav 41/41).
- Relevance filters and reranking over a BM25 shortlist:
  - CLERC top-1 5% → 18% [vendor cookbook];
  - scifact nDCG@10 0.662 → 0.762 (jev-wide);
  - Turkish recall parity with Cohere Rerank, though order-sensitive.
- Agent guardrails against *blunt* injection.
- Guardrail checks such as "does this restrict the assistant?" (pi-heed 13/13).
- High-volume per-row tagging, **one row per request**.

**Poor fit (measured)**:
- Anything where the answer is not in the state or not among the options: hidden policies, novel org rules.
- Counting or aggregating over long lists, and sequential state.
- Ranking graded relevance across rows (ESCI: 4 of 6 gates fail).
- Raw game or board state without computed features.
- Sub-300 ms loops far from the US.
- Adversarial inputs where an attacker can write evidence-like text into the state.
- Non-English states that need calibrated output.
- Any visual or layout judgment.
- Cases needing an explanation for audit (heise, DataCamp).
- Using probabilities as calibrated risk without local recalibration.

**Implications for a web-page-region classifier (WebAble context)**:
- Region-role classification over a text summary is squarely in Jev's zone, provided that:
  - each region gets its own question or request;
  - every Choice has an `other/none` option;
  - criteria state what each role is and is not.
- Visual properties (contrast, clipping, overlap) must stay in deterministic checks. Jev cannot see them.
- Cost is negligible: about 30 × 300 tokens ≈ $0.0004 per page.
- Latency is about 0.25-0.6 s per wave, plus a cold-connection penalty of up to about 370 ms. This fits page-load-time adaptation, not per-keystroke adaptation.
- Every call sends page text to a US-hosted cloud API, which conflicts with a local-first or zero-network tier. It would need to be an opt-in cloud tier with a "what was sent" record.

---

## 9. Contradictions between sources

| Topic | Side A | Side B | Resolution / note |
|---|---|---|---|
| Numbers, dates, negation | Vendor jaggedness page, Simon Willison, TDS, Firecrawl: weak | PriorBench 99.6% / 100%; primeline refutes 8/12 | Comparisons are fine. Counting is genuinely weak. Negation coherence (P(x)+P(¬x)) is loose. Ambiguous date formats are resolved overconfidently |
| Latency | Vendor: 70-500 ms, "most around 100" | 239-563 ms wall; 430 ms floor via OpenRouter; 808-848 ms (zhengbangbo) | The server is about 70-116 ms. Everything else is network plus gateway. OpenRouter adds about 420 ms at p50 and a heavy tail |
| Token limit | Docs/Firecrawl/The Batch: 64k total, 32k state + longest question | OpenRouter: 32k; PriorBench: 50k rejected; phishing-bench CLAUDE.md: about 32k per request | Route-dependent. Budget 32k |
| Calibration quality | Vendor (RLCD), pi-heed, MMLU 0.031, CLINC 0.020 | Phishing 0.154, Banking77 bands, civil_comments, d3code, the unknowable-rule task | Task- and primitive-dependent. Calibrate locally |
| Useful threshold | "0.9" (vendor bands, jev-exploration) | PriorBench: only 0.99 separates; phishing 0.85-0.95 → 60% | Measure on your own data. Separate coverage from precision |
| Cascade to LLM | LangChain, HF, Spring, vendor | TDS: cascade worse than Jev alone (+211 new errors vs 84 fixes) | Validate any fallback on held-out data |
| Decompose vs merge | phishing-bench: split into 5 Nouls, 62.6 → 95% | jevaluate: splitting destroyed calibration | Split independent factors; merge dependent sub-decisions into one Choice over whole moves |
| Batching | Vendor and PriorBench: batch everything | orderby-bench: 40 rows per state fails; Korean doc test 62% vs 100%; pi-heed: isolate distracted questions | Many *questions* are fine; many *items in the state* are not |
| Option order | calibration-audit: none (0/400) | PriorBench 13-pt U-shape; RINNECODER 88 vs 57%; pawarbi +0.37 | Negligible on clear tasks; significant on ambiguous or value-laden ones |
| Prompt injection | PriorBench 1/90; cwhy 1/1,056 | jagged 96.5 → 26.5%; JevOut 61.4% flips | Blunt commands fail; evidence-framed claims succeed |
| Accuracy vs LLMs | Vendor: tied with Sonnet 5 / Terra; TDS: beats Qwen; jev-measured: tie | phishing: −18.7 pts vs Haiku; Ibrahim & Zaki: −11.6 F1 vs the best LLM | Vendor "accuracy" is agreement with GPT-6 Astra and Fable 5.1. Independent studies show mid-tier accuracy, strongly design-dependent |
| Type-safety advantage | DataCamp [vendor numbers]: Haiku 45.5% structured-output errors | jev-measured: strict json_schema → 5/5; phishing Haiku 0 format errors | Not a differentiator once LLM structured output is on |
| Cost | "$0.0004 per decision" in circulation | Measured $0.000015-0.000023 per call | The quoted figure assumes a large state |
| Question ID seen by the model | Docs: IDs are not sent | jevfuzz: ID renames were among mutations that changed decisions (confounded with option and key reorder) | Probably key or option order. Keep payloads canonical |
| Repeatability | orq-ai: 100/100 identical; DataCamp listed as 500/500 | calibration-audit: 15 distinct sets in 50 calls; Noul 0.46-0.54; browser-jev 0.72-0.87 | Argmax is very stable; probabilities jitter by about ±0.01-0.15 |
| DataCamp tests | awesome-jev-robustness cites a "DataCamp repeatability test, 500/500" | The DataCamp article as fetched says no author tests | Unresolved; treat as unverified |

---

## 10. Sources

**Primary measurements (independent)**:
- jev-measured — https://github.com/WallerChen/jev-measured (README, `data/measured.json`, `data/direct-latency.json`, `data/accuracy.json`, `bench/fixtures.py`)
- jev-phishing-bench — https://github.com/anisselbd/jev-phishing-bench (README, `results/report.md`, `run_jev.py`, `results/net_floor.json`, `CLAUDE.md`)
- PriorBench — https://github.com/priorbench/jev (README, `paper/REPORT.md`, `probes/t21_limites.py`)
- scienthoon — https://github.com/scienthoon/jev-ood-calibration
- jev-calibration-audit — https://github.com/jujumilk3/jev-calibration-audit
- jev-orderby-bench — https://github.com/yodablocks/jev-orderby-bench
- browser-jev — https://github.com/DowLucas/browser-jev
- jevnav — https://github.com/dtduc-git/jevnav
- jevaluate — https://github.com/ElshinQ/jevaluate
- jev-wide — https://github.com/123Satyajeet123/jev-wide
- pi-heed — https://github.com/nyarlathoteppppp/pi-heed
- jevfuzz — https://github.com/yottayoshida/jevfuzz
- Awesome Jev Robustness (123-entry index; many secondary numbers above are from its summaries) — https://github.com/Yifan-Lan/awesome-jev-robustness
- TDS, "Jev vs. LLMs" — https://towardsdatascience.com/jev-vs-llms-when-ai-moves-from-generation-to-decision-making/
- Every, Mike Taylor — https://every.to/vibe-check/mini-vibe-check-typesafe-s-jev-judged-everything-i-ve-written-in-0-7-seconds
- dev.to synthesis — https://dev.to/gde/jev-after-eight-days-of-independent-tests-level-with-mid-price-llms-behind-the-frontier-1kln
- Archer Hume architecture probes (secondary) — https://navinpai.github.io/decoding-jev/ and https://smartscope.blog/en/blog/jev-black-box-architecture-2026/
- Spring AI blog (has some measured numbers) — https://spring.io/blog/2026/09/21/spring-ai-typesafe-structured-judgment/

**Commentary, integration docs and news (no own tests unless noted)**:
- Simon Willison (informal city test; `llm-typesafe` plugin) — https://simonwillison.net/2026/Sep/21/jev/
- heise — https://www.heise.de/en/news/AI-model-Jev-to-make-machines-decide-faster-11457071.html
- The Batch — https://www.deeplearning.ai/the-batch/models-built-to-do-one-thing-well
- DataCamp — https://www.datacamp.com/blog/system-one-models-jev
- MindStudio — https://www.mindstudio.ai/blog/jev-system-one-model-launch
- flaviocopes — https://flaviocopes.com/jev/
- Firecrawl — https://www.firecrawl.dev/blog/what-is-jev and https://docs.firecrawl.dev/developer-guides/llm-sdks-and-frameworks/jev
- LangChain — https://www.langchain.com/blog/building-a-harness-with-jev
- LiteLLM — https://docs.litellm.ai/docs/pass_through/typesafe and https://docs.litellm.ai/blog/typesafe-jev-compaction
- Vercel — https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway and https://vercel.com/kb/jev-from-typesafe-ai
- OpenRouter — https://openrouter.ai/blog/insights/what-is-jev/ and https://openrouter.ai/api/v1/models/typesafe/jev-1.13/endpoints
- HF (third-party reseller `thejevai.com`) — https://huggingface.co/blog/sora-2/typesafe-ai-model-and-jev-ai-api-a-production-inte and https://huggingface.co/blog/sora-2/jev-model-and-typesafe-ai-how-to-evaluate-typed-de
- Hacker News — https://news.ycombinator.com/item?id=49717558 , https://news.ycombinator.com/item?id=49767192 , https://news.ycombinator.com/item?id=49770857 , https://news.ycombinator.com/item?id=49745752. No practitioner measurements; mostly marketing and "can't hallucinate" critiques. The CEO confirmed JSON state.
- Tracely-ai batching issue — https://github.com/Jwuthri/Tracely-ai/issues/121

**Vendor (contract reference only)**:
- https://docs.typesafe.ai/concepts/state.md
- https://docs.typesafe.ai/primitives.md
- https://docs.typesafe.ai/primitives/advanced.md
- https://docs.typesafe.ai/llms.txt

**Not found**: no Reddit threads with measurements. The web-search budget ran out before a Reddit-specific search.
