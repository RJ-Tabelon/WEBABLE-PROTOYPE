# TypeSafe AI "Jev" (System One model): primary-source research report

Researched 2026-09-28. Sources: docs.typesafe.ai (every page in `/llms.txt`, 111 pages, pulled as raw `.md` plus `/llms-full.txt`, and cross-checked against `sitemap.xml`; nothing is missing from the index), the live OpenAPI spec at `https://api.typesafe.ai/openapi.json`, typesafe.ai (home page and launch post), and the `github.com/typesafe-ai` org (SDK source, skills repo, adapter).

**Labels used throughout:**
- **[DOCS]**: stated by TypeSafe docs, the OpenAPI spec, SDK source, or the TypeSafe blog.
- **[OBSERVED]**: my own unauthenticated probes of `api.typesafe.ai` on 2026-09-28. I had no API key, so nothing was evaluated.
- **[INFERENCE]**: my reasoning. It is not stated anywhere.

Raw captures are in `scratchpad/research/raw/` (`md/`, `clean/`, `pages/`, `openapi.json`, `jssdk/`, `skill.md`, `blog_launch.txt`).

---

## 1. Summary

- **What it is [DOCS].** Jev is TypeSafe's first "System One" model.
  - You POST a `state` (a string, JSON object, or JSON array; text only) plus a map of named, typed `questions`. You get back one typed `answer` per question.
  - There are three question types:
    - **Choice**: pick 1 of up to 255 options. Returns `choice`, per-option `probabilities`, and `confidence`.
    - **Score**: a position on 2 to 10 ordered levels. Returns `score` (the expected value), `legend`, per-level `probabilities`, and `confidence`.
    - **Noul**: yes or no. Returns only `noul`, which is P(yes).
  - It generates no text, no explanations, and no reasoning. Outputs are constrained to the options you supply, which TypeSafe calls "type-safe by construction".
  - The model is trained with "RLCD" (Reinforcement Learning for Calibrated Decisions) and is marketed as calibrated.
- **Launch [DOCS].** Blog post dated Sep 15, 2026: "Our first public model is Jev, available today in early access". Developers are being let in off a waitlist. The current model ID is `jev-1.13.0`, and the aliases `jev-latest` and `jev-preview` both point to it.
- **Endpoint [DOCS].** `POST https://api.typesafe.ai/v1/systemone`, authenticated with `Authorization: Bearer <API_KEY>`. `GET /v1/models` lists models.
- **Price [DOCS].** $0.042 per million input tokens ($42 per billion). Output tokens are free.
- **Rate limits [DOCS].** 250,000 tokens/s and 1,200 requests/min. The docs warn these "can change without notice".
- **Context [DOCS].** 64k tokens per request, of which 32k covers `state` plus the longest single question.
- **Latency claims [DOCS].** Docs: "about 100 ms". Use-case map: "150ms". Blog: "70ms-500ms" end to end, measured from the US West Coast, which is where the service is currently based.
- **All questions in a request run in parallel and independently [DOCS].** Answers do not see each other. Batching N questions gives the same answers as N separate calls (cookbook-verified) but is much cheaper and faster, because the state is billed once.
- **The official guidance is to ask many atomic questions and compose them in code.** This includes "speculative" questions whose answers only matter on some branches. Route on confidence and thresholds in code, and keep math, dates, counting and generation out of the model.
- **Browser use is explicitly discouraged [DOCS + OBSERVED].**
  - The JS SDK refuses to construct in a browser unless you pass `dangerouslyAllowBrowser: true`.
  - The skill file says "Keep API credentials server-side in web apps."
  - [OBSERVED] CORS preflight to `/v1/systemone` from `https://example.com` returns `400 Disallowed CORS origin`. Only `https://console.typesafe.ai` was allowed.
- **Implications for WebAble, a Chrome extension [INFERENCE].**
  - Direct calls from content scripts will fail CORS.
  - An MV3 service worker with `host_permissions` for `https://api.typesafe.ai/*` would bypass CORS, but it would ship the API key inside the extension.
  - The realistic options are a thin backend proxy that holds the key, or a user-supplied key.
  - Jev is cloud-only: no on-device or local variant exists. That conflicts with WebAble's local-first and "Tier 0 no network" invariant, so Jev could only serve as an optional cloud tier.
  - Its "emits data, never code" shape fits WebAble's invariant #4 exactly.
  - Web page text is adversarial input, and TypeSafe itself lists adversarial and injected content as a known weakness.

---

## 2. Exact API contract

### 2.1 Endpoint, auth, headers [DOCS: https://docs.typesafe.ai/api]
```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <API_KEY>
Content-Type: application/json
```
- API keys come from `https://console.typesafe.ai/keys`. There is also a playground at `https://console.typesafe.ai/playground`.
- The OpenAPI security scheme is `HTTPBearer` (`{"type":"http","scheme":"bearer"}`) [DOCS: openapi.json].
- The response header `x-typesafe-request-id` is exposed by both SDKs as `requestId` / `request_id` [DOCS SDK]. [OBSERVED] Values look like `req_01a0ea6632b67ba58980a58f3b8e3f91`.
- **Headers the SDK sends [DOCS: typesafe-sdk-js `src/client.ts`]:**
  - `User-Agent: typesafe-sdk/<ver>`
  - `X-TypeSafe-SDK: typesafe-sdk/<ver>`
  - `X-TypeSafe-Runtime: <node/..|browser|cloudflare-workers|vercel-edge|...>`
  - `X-TypeSafe-Retry-Count: <n>`, sent on retries only.
- **CORS [OBSERVED].**
  - Preflight responds with `access-control-allow-headers: Accept, Accept-Language, Authorization, Content-Language, Content-Type, X-Dashboard-JWT, X-Typesafe-Organization-ID` and `access-control-allow-credentials: true`.
  - Origins `https://example.com`, `https://docs.typesafe.ai` and `chrome-extension://...` got `HTTP 400 "Disallowed CORS origin"` with no `access-control-allow-origin`.
  - `https://console.typesafe.ai` got `200` with `access-control-allow-origin: https://console.typesafe.ai`.
  - `X-Typesafe-Organization-ID` is undocumented.
- Traffic goes through Cloudflare (`server: cloudflare`, `__cf_bm` cookie) [OBSERVED].

### 2.2 Request body (verbatim field definitions)
From the API page ParamFields [DOCS: https://docs.typesafe.ai/api.md]:
- `state`: `string | object | array`, **required**. "The content to evaluate."
- `model`: `string`, **required**. "Use `"jev-latest"`".
- `questions`: `map<string, Question>`, **required**. "You choose each key; answers come back under the same keys." The key "is not sent to the underlying model and is not used in inference."

Verbatim example request from the API reference:
```json
{
  "state": "Help! My payouts have been failing for 3 days.",
  "model": "jev-latest",
  "questions": {
    "is_urgent": {
      "type": "noul",
      "instructions": "Does this convey urgency?"
    }
  }
}
```

**Question types.** Each is a discriminated union on `type`, and all three share `instructions` [DOCS /api]:

| type | `instructions` | `criteria` |
|---|---|---|
| `"noul"` | `string\|object\|array`, required in docs | **optional** `{ "true": EntryType, "false": EntryType }`: "What a yes (value near 1) means" / "What a no (value near 0) means" |
| `"choice"` | `string\|object\|array`, required in docs | **required** `map<string, string\|object\|array\|null>`: option name to description (`null` means no extra detail). "maximum of 255 options per Choice." |
| `"score"` | `string\|object\|array`, required in docs | **required** `array<string\|object\|array>`, ordered low to high. "A Score should have at least two levels; the API accepts up to 10." |

Verbatim examples from the API reference:
```json
"is_urgent": {
  "type": "noul",
  "instructions": "Does this convey urgency?",
  "criteria": { "true": "Explicitly time-sensitive", "false": "No urgency expressed" }
}
"department": {
  "type": "choice",
  "instructions": "Which team should handle this?",
  "criteria": {
    "billing": "Payments, invoicing, refunds",
    "technical": "Bugs, outages, integrations",
    "sales": "Pricing, upgrades, new accounts"
  }
}
"frustration": {
  "type": "score",
  "instructions": "How frustrated is the customer?",
  "criteria": ["Calm", "Frustrated", "Very angry"]
}
```

Structured `instructions`, verbatim from /api:
```json
"instructions": {
  "potential_duplicate": { "name": "John Smith", "location": "Oakland, California", "last_employer": "Google" },
  "question": "Is the resume for the same person as `potential_duplicate`?"
}
```

**Parameters that do not exist [DOCS, by absence in both the OpenAPI spec and the docs]:**
- No `temperature`, `seed`, `top_p`, or `stream`.
- No `system` or global `instructions` field. Per-question `instructions` is the only instruction channel; global context goes in `state`.
- No image or file input, and no batch endpoint. A "batch" is simply many questions in one request.
- No per-option probability request flag: probabilities are always returned for Choice and Score.

The Python `extra_body={"beam_width": 4}` and question-level `"weight": 2` examples are explicitly labelled "illustrative; only send fields supported by the API". Do not assume those fields exist.

### 2.3 Response body [DOCS /api + openapi.json]
- `model` (string): the versioned ID that answered, e.g. `"jev-1.13.0"`. The spec says it "May differ from the alias supplied".
- `answers` (map, keyed by your question IDs).
- `usage`: `{ input_tokens: int, output_tokens: int }`. The spec says "Output tokens are currently free of charge."

Verbatim example responses from the API reference:
```json
{
  "model": "jev-1.13.0",
  "answers": { "is_urgent": { "type": "noul", "noul": 0.95 } },
  "usage": { "input_tokens": 296, "output_tokens": 20 }
}
```
```json
{
  "model": "jev-1.13.0",
  "answers": {
    "department": {
      "type": "choice",
      "choice": "billing",
      "probabilities": { "billing": 0.88, "technical": 0.12, "sales": 0.0 },
      "confidence": 0.81
    }
  },
  "usage": { "input_tokens": 318, "output_tokens": 34 }
}
```
```json
{
  "model": "jev-1.13.0",
  "answers": {
    "frustration": {
      "type": "score",
      "score": 1.05,
      "legend": { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
      "probabilities": { "0": 0.0, "1": 0.95, "2": 0.05 },
      "confidence": 0.92
    }
  },
  "usage": { "input_tokens": 304, "output_tokens": 18 }
}
```

**Answer fields, as the OpenAPI spec defines them:**
- `NoulAnswer` = `{type:"noul", noul:number}`. "Probability of a yes answer or a true statement, from 0 to 1."
- `ChoiceAnswer` = `{type:"choice", choice:string, confidence:number, probabilities:{[option]:number}}`.
  - `choice` is "The name of the choice with the highest probability".
  - Probabilities "sum to approximately 1".
- `ScoreAnswer` = `{type:"score", score:number, confidence:number, legend:{[level]:EntryType}, probabilities:{[level]:number}}`.
  - `score` is "the probability-weighted average of the rubric levels".
  - Keys are the string level indices `"0".."n-1"`.
  - **`legend` echoes whatever you sent.** If Score criteria were objects, `legend` values come back as objects. The docs show this; the /api page's `map<string,string>` type is imprecise.

**Rounding.** Every docs example shows probabilities and confidences at 2 decimal places. [INFERENCE] The server appears to round to 2 dp. This is not documented.

### 2.4 Models endpoint [DOCS: https://docs.typesafe.ai/models]
`GET https://api.typesafe.ai/v1/models` returns `{"models":[{"name":"jev-latest","description":"...","release_date":"2026-09-15"}]}`.
- It "currently lists the aliases".
- Versioned IDs such as `jev-1.13.0` "are accepted by the `model` field whether or not they appear in the list."

### 2.5 Errors
**Documented [DOCS /api]:**

| Status | Meaning |
|---|---|
| `401 Unauthorized` | missing or invalid key |
| `422 Unprocessable Entity` | validation; "The body details the offending field" |
| `429 Too Many Requests` | rate limit |
| `529 Overloaded` | temporarily overloaded; retry |

For 429 and 529, use exponential backoff; the SDKs do this automatically.

**Additional SDK error classes [DOCS SDK]:** 400 BadRequest, 403 PermissionDenied, 404 NotFound, 5xx InternalServer, plus connection, timeout and abort errors.

**422 body shape** (FastAPI-style) [DOCS openapi.json]:
```json
{"detail":[{"loc":["body","state"],"msg":"Field required","type":"missing"}]}
```

**Auth errors as observed [OBSERVED]** (the detail is an object here, not an array):
- Missing key returns **403**, not the documented 401:
  ```json
  {"detail":{"error_type":"authentication_error","message":"Must supply an API key! Check your request and try again."}}
  ```
- Invalid key returns **401**:
  ```json
  {"detail":{"error_type":"authentication_error","message":"Cannot authenticate with the server. Please check your API key and try again."}}
  ```

### 2.6 Places where the OpenAPI spec (v0.2.0) is looser than the docs [DOCS, conflict]

| Item | Docs | OpenAPI spec | Client-side behaviour |
|---|---|---|---|
| `instructions` | required | optional and nullable on all three types | JS `noul()` defaults it to `null` |
| Score `criteria` | min 2, max 10 | `minItems:1`, no max | both SDKs reject fewer than 2 (JS) / an empty list (Python) |
| Choice option count | max 255 | no maximum | n/a |

The spec requires `answers` to have at least 1 property (`minProperties:1`) and `questions` to have at least 1.

[INFERENCE] Treat the docs limits as the enforced ones. They are probably enforced server-side beyond the schema.

---

## 3. Primitives in detail [DOCS: /primitives, /primitives/choice, /primitives/score, /primitives/noul, /primitives/advanced]

**Shared rules**
- A question has an **ID** (yours; "not sent to the model"), a `type`, `instructions`, and `criteria`. "Write the complete question in `instructions`, even when the ID seems self-explanatory."
- **Answers are constrained**: "Every answer is constrained to the options you supplied."
- **Answers are independent**: "One question's answer is not hidden context for another."
- If question B needs A's answer to build its state or its options, make a second request. Otherwise put everything in one request.
- **Point at state with backticked paths**, e.g. ``"Does `ticket.messages[0].text` request a refund?"``. The dot-and-index path must include the backticks.
- **EntryType everywhere.** `instructions`, Choice option descriptions, Score level entries, and Noul `true`/`false` all accept `string | object | array | null`. Field names inside those objects (`question`, `focus`, `what`, `not_for`, `examples`, `signals`, ...) are "not part of the API, and none are reserved". The model sees the key names, so they should be meaningful.

**Choice**
- **Use it for** "one of a fixed set of options" with no order between them.
- **Option names and descriptions are both sent to the model.** Use `null` when the name is self-explanatory, e.g. `{"calm": null, "frustrated": null, "angry": null}`.
- **Up to 255 options.** "Give the model the full list ... rather than a shortlist" (each option costs a few tokens).
- **Add an `other` / `none of the above` option** when the list might not cover the input.
- **Reliability** "up to roughly 240 options" (cookbook, jev-1.12). The launch blog says "Jev supports a cardinality up to 255". Above that, TypeSafe used a 2-stage approach: independent scoring, then an explicit choice.
- **For deep taxonomies**, use one Choice per level, with option values set to subtrees. See the beam-search cookbook.
- **Per-option probabilities are always returned.**
- **Worked multi-question response** (verbatim, from /primitives/choice):
  ```json
  "department": {"type":"choice","choice":"returns","confidence":0.42,
    "probabilities":{"shipping":0.04,"billing":0.35,"returns":0.61}},
  "requested_resolution": {"type":"choice","choice":"refund","confidence":0.2,
    "probabilities":{"replacement":0.34,"refund":0.4,"information":0.02,"exchange":0.24}}
  ```
  The documented code routes to manual triage when `confidence < 0.3`. It CCs a second team when that team's probability is above 0.25, and asks the user when resolution confidence is below 0.5.
- **Contrastive structured options** (verbatim pattern):
  ```json
  "criteria": {
    "return_policy": {"what":"Whether and how an item can be returned","not_for":"Progress of a return already sent","examples":["Can I return shoes I've worn once?"]},
    "return_status": {"what":"Progress of a return already sent","not_for":"Whether and how an item can be returned","examples":["When will my refund be paid?"]}
  }
  ```

**Score**
- **Levels.** `criteria` is an ordered array, and level *i* is at array index *i* (starting at 0). The model "gets the descriptions and nothing else, and each level is judged on its own against the state". It "doesn't see a level's number or its neighbours".
- **Computation.** `score = Σ i·p_i`, which can land between levels. Documented example: 0×0.0 + 1×0.57 + 2×0.43 = 1.43.
- **"Different distributions can produce the same score."** Read `probabilities` and `confidence` alongside `score`.
- **SDK key types.** The Python SDK keys `probabilities` and `legend` by **int**; the JS SDK accepts `number | \`${number}\``.
- **Level-writing rules:**
  - "Describe situations, not degrees."
  - Number-only levels fail. Documented example: `criteria:["0","1","2"]` gives confidence 0.33 on a clear case, versus 1.0 with descriptive levels.
  - Keep each Score to one dimension.
  - Give a rare, actionable extreme its own level.
  - Use 2 to 10 levels; "Three is fine."
- **Combining Scores.** Normalize each score by `len(criteria)-1` before weighting. Documented example: `0.6*sev + 0.3*frus + 0.1*quality`.
- **Structured level examples help only when they resemble real inputs.**
  - A relevant example moved one answer from 1.43@0.35 to 1.03@0.96.
  - An irrelevant example left it at 1.43@0.35.
  - "Higher confidence does not establish which answer is correct."

**Noul**
- **The answer is P(yes)** in `noul`, from 0 to 1. There is no `confidence` field: "the single `noul` value describes it completely".
- **`criteria.true` / `criteria.false` are optional.** "try your questions with and without `criteria` and keep whichever gives better answers".
- **Rules:**
  - One condition per Noul; no "angry AND asking for refund".
  - Phrase it so that a high value means yes; no inverted "free of X" questions.
  - A statement works as well as a question.
- **A Noul value is not a degree.** Noul 0.5 means "yes and no equal probability", not "medium". Use a Score for degree. Documented example, "strong in Python?": Noul values 0.03 / 0.14 / 0.81 / 0.92, versus Score 0.0 / 1.0 / 2.05 / 2.89.
- **Thresholds are yours.** Use 0.5 when yes and no are equally cheap to act on. Raise the threshold when a false yes is costly, and lower it when a missed yes is costly. Send the middle band (e.g. 0.2 to 0.8) to review.
- **Recorded jev-1.13.0 values** for "Is the customer asking for a human agent?":

  | Message | Noul |
  |---|---|
  | "Thanks, that fixed it!" | 0.02 |
  | "Are you a bot?" | 0.40 |
  | "Is there any way to speak to someone...?" | 0.84 |
  | "...Can I please just talk to a real person?" | 0.99 |

**Choosing between types [DOCS]:** "prefer the one whose answer your code can act on directly". A Choice maps to a switch, a Score to a threshold, and a Noul to an `if`.

---

## 4. Confidence semantics

**What the docs say [DOCS: https://docs.typesafe.ai/confidence]**
- `confidence` exists only on Choice and Score.
- It is "a statistic computed from the probability distribution the answer already gives you". "Concentrated on one outcome means a confident answer, spread out means an uncertain one."
- It is "A solid default ... you are never locked into our definition". The full `probabilities` are returned so you can compute your own measure. A cookbook on alternative measures is promised but not yet published.
- It is "not a guarantee that the answer is correct" (/primitives/score).
- Calibration "is measured across groups of predictions; it does not guarantee that an individual answer is correct" (/concepts/system-one).
- **The recommended usage pattern is three bands:**
  - High confidence: act automatically.
  - Medium: confirm, flag, or gather more information.
  - Low: do not act; route to a human, a clarification step, or a fallback system.
- **Thresholds should scale with risk.** Documented examples:
  - A floor of 0.5, with >0.9 required for a destructive action.
  - A voice-banking example: <0.6 goes to a human; a balance check needs ≥0.6; a transfer is auto-approved above 0.85 and confirmed between 0.6 and 0.85.
  - "Start with conservative thresholds, test with your own data." "Test thresholds by plotting confidence against accuracy on your data."
- Low Score confidence "usually means ... levels overlap ..., the question is measuring more than one thing, or the state doesn't say enough."
- **Formula.** The docs' interactive demo says it "uses `(3 × largest probability − 1) / 2` to approximate confidence for three options". The demo code generalizes this to `clamp((n·p_max − 1)/(n − 1), 0, 1)`.

**[INFERENCE, verified against every documented example]**
For jev-1.13.0, the returned `confidence` matches `(n·p_max − 1)/(n − 1)` within the rounding of 2-dp probabilities. In words: the top-option probability, rescaled so that a uniform distribution gives 0 and a one-hot distribution gives 1.

| Example | n | p_max | formula | reported |
|---|---|---|---|---|
| department (/api) | 3 | 0.88 | 0.82 | 0.81 |
| department (quickstart) | 3 | 0.85 | 0.775 | 0.78 |
| department (complex) | 3 | 0.61 | 0.415 | 0.42 |
| shipping_issue | 5 | 0.74 | 0.675 | 0.67 |
| requested_resolution | 4 | 0.40 | 0.20 | 0.20 |
| tone | 3 | 0.84 | 0.76 | 0.76 |
| bug_severity (score) | 3 | 0.57 | 0.355 | 0.35 |
| severity / frustration | 3 | 0.76 / 0.72 | 0.64 / 0.58 | 0.64 / 0.58 |
| numbers-only levels | 3 | 0.55 | 0.325 | 0.33 |

An entropy-based measure does not fit these numbers. For department 0.61/0.35/0.04, 1 − H/ln n ≈ 0.27, but 0.42 was reported.

**Conflict to note.** The SEC cookbook (run on jev-1.12) says confidence separates "a winner at 0.45 with a runner-up at 0.44" from "0.45 with the rest ... scattered". A pure p_max formula cannot do that. Either the definition changed between versions or that statement is loose.

**Practical consequences [INFERENCE]:**
- For Choice, confidence is a function of the top probability and the option count only. It is not a margin measure.
- Adding options raises confidence for the same p_max: 0.5 gives 0.25 at n=3, but 0.47 at n=20.
- If you need the gap between the top two options, compute it from `probabilities` yourself.
- **Calibration applies to `probabilities` and `noul`.** `confidence` is a derived summary.
- **For Noul**, the analogue is |noul − 0.5|·2. That is my suggestion, not documented.

**Calibration claims [DOCS]:**
- /introduction/machine-learning-primer: "Outcomes assigned a probability of 0.2 should occur about 20% of the time... 0.8 ... about 80%."
- SEC cookbook: across 60 filings, confidence ≥0.9 selected the half that was 90% accurate; the other half was 40% accurate.
- Jaggedness page: Noul values and Choice probabilities are **not** interchangeable. For the same refund question, Noul gave 0.22 and a yes/no Choice gave P(yes)=0.01. A Noul and its negation summed to 1.19. "Don't carry a threshold tuned on a Noul over to a Choice."

---

## 5. Limits, pricing, latency, determinism

| Item | Value | Source |
|---|---|---|
| Model | `jev-1.13.0`; aliases `jev-latest` (stable) and `jev-preview`, both currently the same model | [DOCS /models] |
| Price | $42 per Btok / $0.042 per Mtok, **input only**; output free | [DOCS /models; blog] |
| Rate limits | 250,000 tokens/s and 1,200 req/min; 429 when either is exceeded; "adjusting dynamically ... can change without notice"; higher limits on enterprise plans (sales@typesafe.ai) | [DOCS /models] |
| Context | 64k tokens per request (state + all questions); 32k for state + the single longest question | [DOCS /models] |
| Max questions per call | **No explicit count limit.** Bounded by the 64k budget. The spec requires at least 1. | [DOCS; INFERENCE] |
| Choice options | ≤255 (API); "works reliably up to roughly 240" | [DOCS] |
| Score levels | 2 to 10 | [DOCS] |
| Input modality | Text only: string, object, or array. "No image, audio, or video input." | [DOCS /models, /concepts/state] |
| Language | English primary; other languages including CJK are "handled but not equally well" | [DOCS /models] |
| Latency | "Most queries complete in about 100 ms" (docs). "real-time speeds (150ms)" (use-case map). "70ms-500ms" end to end, measured from the West Coast where the service is based (blog). Home page demo: "Completed in 0.114s", Cost $0.000081. | [DOCS/blog] |
| Speed-up claims | "193.6x faster, 444.6x cheaper", on TypeSafe's own "workflow evals" against GPT-6 Astra and Fable 5.1 as the reference; the blog calls these "the higher end of real world gains" | [blog/home page; vendor claim] |
| Batching gain | 13 questions over a ~54k-char document in one call: "12.2x cheaper and 10.0x faster with no change in answers" | [DOCS cookbook] |
| SDK timeouts | 10 s per attempt (JS `timeout: 10000`; Python `DEFAULT_TIMEOUT = 10.0`) | [DOCS] |
| Determinism | No temperature or seed. "designed to return stable answers across repeated evaluations". Cookbooks: "Most answers came back identical across all 5 repeats"; some questions show small noise (mean Noul std 0.0102 over 15 runs; one answer ranged 0.43 to 0.53 across a 0.5 threshold). Not bit-deterministic. | [DOCS] |
| Streaming | None. One request returns one JSON response. | [DOCS, by absence] |
| Data | "Jev is not trained on customer requests or responses"; zero data retention for enterprise only. See the DPA and privacy policy. | [DOCS /models, /legal] |
| Customization | No fine-tuning or LoRA; "same weights serve every account". Customize via state, instructions and criteria. | [DOCS /models] |
| Versioning | Aliases move on release. "If you have tuned confidence thresholds against a specific version, pin that version's ID". The response `model` field reports the version. | [DOCS /models] |

---

## 6. SDKs and integrations

### JavaScript / TypeScript [DOCS: /sdk/javascript; repo typesafe-ai/typesafe-sdk-js]

**Package and install**
- Package: **`@typesafe-ai/sdk`** v0.6.0, published 2026-09-15 on npm; also on JSR.
- Requires Node ≥20. MIT licence, zero runtime dependencies, ESM + CJS + type declarations.
```sh
npm install @typesafe-ai/sdk
```

**Verbatim quickstart**
```ts
import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
const client = new TypeSafeClient();
const response = await client.systemOne({
  state: { document: "I was charged twice. Please fix this ASAP." },
  questions: {
    category: choice("What is this ticket about?", {
      billing: null,
      technical: null,
      other: null,
    }),
  },
});
console.log(response.answers.category.choice);
```

**Builders**
- `choice(instructions, criteria)`
- `score(instructions, criteria /* ≥2-tuple */)`
- `noul(instructions?, {true?, false?}?)`

Answer types are inferred per key via `ResultFor<Q[K]>`, so `choice` is typed as `keyof criteria`.

**`TypeSafeClientConfig`**

| Option | Default / fallback |
|---|---|
| `apiKey` | `TYPESAFE_API_KEY` |
| `baseURL` | `TYPESAFE_BASE_URL`, then `https://api.typesafe.ai` |
| `defaultModel` | `TYPESAFE_DEFAULT_MODEL`, then `jev-latest` |
| **`dangerouslyAllowBrowser`** | `false`. "Allow browser use, exposing the API key to page users." |
| `timeout` | 10000 ms per attempt; no total budget |
| `retry` | see below |
| `fetch` | global `fetch` |
| `logger`, `logLevel` | `warn`; `debug` logs bodies unredacted |
| `defaultHeaders` | none |

**Browser guard.** In the source, `isBrowser()` checks for `window.document` plus `navigator`. If that is true and the flag is not set, the constructor throws: "TypeSafeClient is running in a browser, which would expose your API key to anyone using the page. Call the API from a server instead, or pass `dangerouslyAllowBrowser: true`..." [DOCS source]. [INFERENCE] An MV3 service worker has no `window`, so the guard would not fire there. CORS and key exposure are still the real constraints.

**Retry defaults (`RetryPolicy`)**
- `maxRetries: 2`
- `backoffInitialMs: 500`, doubling to `backoffMaxMs: 5000`, with `backoffJitter: 0.25`
- `httpStatuses`: 408, 429, and 500 to 599 (this covers 529)
- `respectRetryAfter: true`: honours `Retry-After` and `retry-after-ms` up to `maxRetryAfterMs: 60000`
- Connection and timeout errors are retried.

**Per-call options**
- `RequestOptions`: `{ headers, retry, signal: AbortSignal, timeout }`.
- `APIPromise` adds `.withResponse()`, which returns `{ data, response, requestId }`, and `.asResponse()`.
- Error classes: `APIError` (`status`, `body`, `headers`, `requestId`); subclasses for 400/401/403/404/422/429 (`retryAfterMs`)/5xx; `APIConnectionError`, `APITimeoutError`, `APIUserAbortError`.
- Changelog v0.6.0 (breaking): "accept `Score.criteria` as an ordered sequence instead of a dictionary keyed by integers".

### Python [DOCS: /sdk/python; PyPI `typesafe-sdk` 0.7.2]

**Install**
```sh
pip install typesafe-sdk      # or: uv add typesafe-sdk ; extra: typesafe-sdk[http2]
```
- Python ≥3.10.
- Dependencies: httpx2, pydantic ≥2.12, tenacity.

**Usage**
```python
from typesafe_sdk import Choice, Noul, Score, TypeSafeClient   # AsyncTypeSafeClient for async
with TypeSafeClient() as client:
    r = client.system_one(state={...}, questions={"billing": Noul(instructions="Is this about billing?"),
        "tone": Choice(instructions="What is the tone?", criteria={"calm": None, "angry": None}),
        "urgency": Score(instructions="How urgent is this?", criteria=["low", "medium", "high"])})
r.nouls["billing"].noul; r.choices["tone"].choice; r.scores["urgency"].score; r.request_id
```
- **Other types:** `NoulCriteria(true=..., false=...)`.
- **`system_one` keyword arguments:** `model`, `retry`, `timeout`, `extra_headers`, `extra_body`, and `response_model` (a Pydantic model, added in v0.7.0).
- **Exceptions:** `TypeSafeAPIError` (`status`, `body`, `headers`, `endpoint`, `request_id`), plus subclasses for 400/401/403/404/422/429/5xx, `TypeSafeAPIConnectionError`, `TypeSafeAPITimeoutError`, and `TypeSafeAPIResponseValidationError`.
- **Python `RetryPolicy` also has** `timeout`, a total retry budget, plus `predicate` and `exceptions`.

### Gateways [DOCS: /sdk/python/usage "Configuring the base URL"]

| Gateway | base URL | model |
|---|---|---|
| OpenRouter | `https://openrouter.ai/api` | `~typesafe/jev-latest` |
| Vercel AI Gateway | `https://ai-gateway.vercel.sh/typesafe` | `typesafe-ai/jev` |
| Pydantic AI Gateway | `https://gateway-us.pydantic.dev/proxy/typesafe` | `jev-latest` |

Any base URL must "follow the TypeSafe OpenAPI spec (https://api.typesafe.ai/docs/)". [INFERENCE] A gateway may offer different CORS, billing, or key-scoping options. This is unverified.

### Other official artifacts
- **Agent skill** (`typesafe-ai/skills`, MIT):
  - Install with `claude plugin marketplace add typesafe-ai/skills && claude plugin install typesafe@typesafe-ai`, or `npx skills add typesafe-ai/skills --skill typesafe-ai`.
  - Its key lines include "Keep API credentials server-side in web apps."
- **`typesafe-ai/system-one-adapter-python`**: a "Drop-in TypeSafeClient replacement backed by LLM APIs" (OpenAI, Anthropic, Gemini). It is for comparisons and could serve as a fallback or dev stub without early access. [INFERENCE on the stub use.]
- **Repository status.** The Python repo `typesafe-sdk-python` is public. The smart-home demo source is "available on GitHub at release". The skill references a "Migration guide" at `/migrating-to-v1.md`, which returns 404.

### Third-party material (non-authoritative; not used as evidence)
- **jevapi.dev** describes itself (through syndicated press releases) as "not affiliated with or endorsed by TypeSafe AI".
- **No jevapi.org** results were found.
- **Aggregators** such as aimlapi, cometapi, litellm, requesty and a Wikipedia article exist but were not relied on.
- **The $40M seed round** led by DCVC is reported only by third-party search summaries. Unverified.

---

## 7. Documented best practices and anti-patterns

**Do [DOCS: /concepts/how-to-build-with-system-one, /primitives, /patterns/*, SKILL.md]**
1. **Keep code in control.** Put control flow, deterministic rules and side effects in code, and call Jev only for "programmable common sense". "Avoid agent `while` loops."
2. **Make questions atomic and narrow.** This is "probably the most important concept in this guide". Documented example: spam detection becomes 6 Nouls (credentials request, unexpected reward, time pressure, sender/domain mismatch, link mismatch, disguised link) rather than one `Is message spam?`.
3. **Ask many questions in one request, including speculative ones** ("Speculative fan-out"). Ignore irrelevant answers in code. "Asking a question you might not need is close to free." Sequential dependent calls are named "the wrong way".
4. **Send only relevant state, as named JSON.** Filter and retrieve in code first. Reference parts with backticked paths. Do not rely on knowledge in the model's weights for current facts.
5. **Use structure** (objects in instructions and criteria) for contrastive definitions (`what` / `not_for` / `examples`), for data coming from code, and for similar questions. Keep the same field names across options.
6. **Compose in code.** Use weighted sums (after normalizing Scores), or feed probabilities as features into a classical model (the AutoResearch cookbook).
7. **Gate on confidence and probability per action risk,** with a human, reasoning-LLM, or confirmation fallback. Test thresholds on your own data.
8. **Pin the model version** if thresholds were tuned, and log the response `model` field.
9. **Use "select, don't generate."** Find candidate spans or values with regex or code, have a Choice pick one, then copy it verbatim. Pair Jev with an LLM for text generation (the smart-home demo splits compound commands with an LLM and uses one for chit-chat).
10. **Build your own evals.** The blog says to put "no weight on public benchmarks".

**Don't: the known failure modes of jev-1.13 [DOCS: /model-jaggedness/jev-1.13, last reviewed 2026-09-17]**
1. **Literal reading.** It "answers the question you wrote, not the one you meant."
2. **Math, counting, and numeric representations** (e.g. hex colors). "Jev is not a calculator." Also do not interpolate exact magnitudes from a Score.
3. **Date and time comparison.** Extract the parts with Choice questions and compare in code.
4. **Indirection and double negatives.** Multi-hop questions lose accuracy.
5. **Large state full of irrelevant detail.** "Jev suffers from context rot." Filter first, or use a Noul relevance filter.
6. **Adversarial content.** "State is data, and jev-1.13 does not treat it as hostile by default... an injected instruction... can move the answer."
7. **Contradictory instructions and criteria**, e.g. `true` mapped to a "no" meaning.
8. **Assuming structural invariants.** Noul ≠ yes/no Choice; P(x) + P(not x) ≠ 1.
9. **Generation.** "not trained to generate text."

Additional anti-patterns: several judgments hidden in one question; numeric-only Score levels; inverted Noul phrasing; one question per call; using a Noul to measure degree.

---

## 8. Unknowns / not documented

- **Server enforcement.** It is unclear whether the 255-option and 10-level limits are enforced server-side, since the OpenAPI spec has no max. The same applies to the maximum number of questions (none is stated) and to the per-question token cost.
- **Exact confidence definition.** The p_max formula fits jev-1.13 examples; the docs only call it an "approximation", and a jev-1.12 cookbook implies margin sensitivity. It may change between versions.
- **Whether `jev-1.13` and `jev` are valid model names on the direct API.**
  - They appear in SDK examples (`TypeSafeClient(model="jev-1.13")`, `model="jev"`) but not in the Models alias table.
  - OpenRouter uses `typesafe/jev-1.13`.
  - Safe options: `jev-latest`, `jev-preview`, `jev-1.13.0`.
- **Rate-limit scope and response headers.** It is unknown whether limits are per key, per org or per account, and whether `retry-after` is always sent. The limits are "dynamic".
- **Early-access terms.** Waitlist turnaround, any free tier or credits, and quotas are not in the docs.
- **Auth status codes.** The docs say 401 for a missing key; 403 was observed. The `529` body shape is unknown.
- **CORS policy intent.** Only the console origin was allowed in my probe. Unknown whether TypeSafe will allowlist other origins, or whether the gateways (Vercel, OpenRouter) permit browser calls.
- **Latency outside the US West Coast**, p95/p99, and cold-start behaviour. Only vendor ranges were published.
- **Privacy detail.** Retention period for non-enterprise requests (see DPA). No on-prem or local model is mentioned anywhere.
- **Undocumented header.** `X-Typesafe-Organization-ID` is purpose unknown.
- **Unknown request fields.** It is unknown whether the server ignores or rejects them (the SDKs forward them).
- **Non-English accuracy** is not quantified.
- **Accessibility / web-UI use cases.** None are documented.

---

## 9. Sources

**Docs (all retrieved 2026-09-28)**
- Index: https://docs.typesafe.ai/llms.txt · full text: https://docs.typesafe.ai/llms-full.txt · Markdown via the `.md` suffix
- Getting started:
  - https://docs.typesafe.ai/introduction
  - https://docs.typesafe.ai/introduction/quickstart
  - https://docs.typesafe.ai/introduction/coding-agents
  - https://docs.typesafe.ai/introduction/machine-learning-primer
- Concepts:
  - https://docs.typesafe.ai/concepts/system-one
  - https://docs.typesafe.ai/concepts/state
  - https://docs.typesafe.ai/concepts/how-to-build-with-system-one
  - https://docs.typesafe.ai/concepts/use-case-map
- Primitives:
  - https://docs.typesafe.ai/primitives
  - https://docs.typesafe.ai/primitives/choice
  - https://docs.typesafe.ai/primitives/score
  - https://docs.typesafe.ai/primitives/noul
  - https://docs.typesafe.ai/primitives/advanced
- Confidence, API, models and policy:
  - https://docs.typesafe.ai/confidence
  - https://docs.typesafe.ai/api
  - https://docs.typesafe.ai/models
  - https://docs.typesafe.ai/model-jaggedness/jev-1.13
  - https://docs.typesafe.ai/legal
  - https://docs.typesafe.ai/agent-skill
- Patterns:
  - https://docs.typesafe.ai/patterns
  - https://docs.typesafe.ai/patterns/fan-out
  - https://docs.typesafe.ai/patterns/confidence-routing
  - https://docs.typesafe.ai/patterns/composite-scoring
  - https://docs.typesafe.ai/patterns/intent-routing
- Cookbooks and demos:
  - https://docs.typesafe.ai/cookbooks/parallel_questions
  - https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook
  - https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook
  - https://docs.typesafe.ai/cookbooks/classification_using_confidence
  - https://docs.typesafe.ai/cookbooks/semantic_find
  - https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook
  - https://docs.typesafe.ai/demos/smart-home
- SDKs:
  - https://docs.typesafe.ai/sdk
  - https://docs.typesafe.ai/sdk/javascript
  - https://docs.typesafe.ai/sdk/javascript/changelog
  - https://docs.typesafe.ai/sdk/javascript/api/classes/TypeSafeClient
  - https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig
  - https://docs.typesafe.ai/sdk/javascript/api/interfaces/RetryPolicy (plus all other JS type pages)
  - https://docs.typesafe.ai/sdk/python
  - https://docs.typesafe.ai/sdk/python/usage
  - https://docs.typesafe.ai/sdk/python/changelog
  - https://docs.typesafe.ai/sdk/python/api/constants
  - https://docs.typesafe.ai/sdk/python/api/retries
  - https://docs.typesafe.ai/sdk/python/api/exceptions
  - https://docs.typesafe.ai/sdk/python/api/clients/sync

**API and live probes**
- https://api.typesafe.ai/openapi.json (OpenAPI 3.1, info.version 0.2.0)
- Unauthenticated probes of `/v1/models`, `/v1/systemone`, and `OPTIONS` preflight

**Company site**
- https://typesafe.ai/ (home page claims)
- https://typesafe.ai/blog/introducing-system-one-models-and-jev (launch post, Sep 15, 2026, Diogo Almeida)
- https://typesafe.ai/manifesto

**GitHub (org https://github.com/typesafe-ai)**
- https://github.com/typesafe-ai/typesafe-sdk-js (`src/client.ts`, `src/runtime.ts`, `package.json`)
- https://github.com/typesafe-ai/typesafe-sdk-python
- https://github.com/typesafe-ai/skills (`skills/typesafe-ai/SKILL.md`)
- https://github.com/typesafe-ai/system-one-adapter-python

**Package registries**
- https://registry.npmjs.org/@typesafe-ai/sdk (latest 0.6.0)
- https://pypi.org/pypi/typesafe-sdk/json (0.7.2)

**Third-party, flagged non-authoritative**
- https://jevapi.dev/ (self-described unaffiliated)
- Aggregators: OpenRouter model pages, aimlapi, cometapi, litellm, DataCamp and others. Not used for facts beyond noting that they exist.
