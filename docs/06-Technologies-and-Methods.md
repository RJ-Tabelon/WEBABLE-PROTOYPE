# WebAble — Architecture, Technologies, and Methods

_Rewritten 2026-09-08 onto a three-layer architecture. Same scope, same invariants, same evidence base
— reorganized into three deliverables that map cleanly onto five people and demo far better than a
single extension._

---

## The shape

Three layers, each independently deliverable:

```
┌─ COMMAND CENTER ──────────────────────── Next.js 15 ─┐
│  Profile editor · calibration replay · defect        │
│  dashboard · "what was sent" receipts · sync          │
└───────────────────────┬──────────────────────────────┘
                        │  Supabase (Auth + Postgres + RLS)
┌─ INTELLIGENCE LAYER ──┴───────────── FastAPI + Pydantic ─┐
│  Onboarding interpretation · page → adaptation plan ·     │
│  density summarization · cloud inference proxy            │
└───────────────────────┬──────────────────────────────────┘
                        │  JSON adaptation plan (schema-constrained)
┌─ EXECUTION ENGINE ────┴─────────────── Chrome Extension (MV3) ─┐
│  Summarizer → on-device model → ┌──────────┐ → renderer        │
│                                 │ VERIFIER │                   │
│  Tier 0 fires with zero setup   └────┬─────┘                   │
│  Nothing applies until it passes ────┘ else ROLLBACK + log     │
└────────────────────────────────────────────────────────────────┘
```

**The one structural difference from A11Yson.** In A11Yson the model's output goes to the DOM. In
WebAble it goes to **the verifier first**, and the Execution Engine refuses to apply anything that
clips text, reduces contrast, orphans a focusable element, or increases automated violation counts.
That gate cannot live in the Intelligence Layer, because you cannot measure rendering from a server.
It is the project's technical contribution, it lives inside the extension, and it is the reason this
is not an overlay with better manners.

**Three rules the layering must not break** (from [webable's invariants](01-Positioning.md)):

1. **The Execution Engine never depends on the other two.** Tier 0 fires on the first page with no
   account, no profile, no dashboard, and no network. The Command Center is an accelerator, never a
   gate — the closest prior project (Morphic) stalled precisely because value required setup first.
2. **The Command Center mirrors the profile; it does not own it.** Local `chrome.storage` is
   authoritative; the cloud copy is a synced replica. Otherwise a signed-out user has no product.
3. **The Intelligence Layer emits data, never code.** JSON plans and CSS strings only. Chrome's policy
   defines remote code as JS and WASM and explicitly excludes JSON and CSS — model-generated
   JavaScript would be a store violation, not a style preference.

---

## Layer 1 — Execution Engine _(Chrome Extension, MV3)_

The product. Everything else is optional to it.

| Concern               | Technology                                                          | Why this one                                                                                                 |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Language              | **TypeScript**, `strict`                                            | Types are the cheapest guard on ~80% AI-assisted code under a "must be explainable" rule                     |
| Framework             | **WXT** (Vite)                                                      | Content-script HMR — we tune CSS against live sites all semester                                             |
| Extension pages UI    | **React 19**                                                        | Onboarding and calibration are stateful flows                                                                |
| Accessible primitives | **React Aria Components**                                           | An accessibility project cannot hand-roll widgets                                                            |
| Content scripts       | **No framework**, plain TS                                          | React inside arbitrary pages means bundle weight, global pollution, and version conflicts with the host page |
| Our injected UI       | **Closed shadow root** + adopted stylesheets + `all: initial`       | The offer toast and undo must be immune to page CSS and invisible to page selectors                          |
| Tier 0/1 styling      | `chrome.scripting.insertCSS`, **`origin: 'USER'`**                  | User-origin cascade — author styles still win where they must. This is what makes us a user agent            |
| Shadow DOM            | `chrome.dom.openOrClosedShadowRoot` + adopted stylesheets           | Page CSS does not cross shadow boundaries; Dark Reader is the reference implementation                       |
| SPA survival          | **MutationObserver** + `chrome.webNavigation.onHistoryStateUpdated` | Re-apply after client-side route changes                                                                     |
| Long-running work     | **`chrome.offscreen` document**                                     | The MV3 service worker dies after ~30s idle; cloud inference is 6–7s and local can be a minute               |
| Permissions           | `activeTab` + `scripting` only at install                           | No install-time warning; host permissions earned per site                                                    |
| Local store           | `chrome.storage.local` / `.sync`                                    | `.sync` caps at 8 KB per item — that is the profile budget                                                   |

### The verifier — inside this layer, by necessity

**Automated half: `axe-core`**, run in-page before and after. The violation delta is the number the
whole invariant rests on, and it is industry-standard so it means something to an outside reader.
_(MPL-2.0 — confirm the terms before shipping rather than assuming.)_

**Custom half — what axe cannot do, and the actual contribution:**

| Check               | Mechanism                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Text clipping       | `scrollHeight > clientHeight` where computed `overflow` is `hidden`, measured post-render |
| Contrast reduction  | Recompute WCAG 2.x ratio on post-transformation computed styles                           |
| Focusable orphaning | Still in tab order but zero-size, off-viewport, or occluded                               |
| Layout overflow     | Bounding rect escaping its container or the viewport                                      |

Every check runs after a double `requestAnimationFrame` or a `ResizeObserver` settle — never
synchronously after injection. Measuring before layout settles manufactures false defects, which
would poison the headline number.

Failures roll back and log an **adaptation defect**, which surfaces in the Command Center dashboard.
Reporting defects alongside successes is the most credible thing in the final presentation.

### Where the AI interpretability lives

The summarizer runs **here**, because it needs the DOM: an allowlist extractor pulls only permitted
structural fields, and the user can open a **"what was sent" panel** showing the exact payload. The
summary then goes to whichever inference tier is available — on-device first.

---

## Layer 2 — Intelligence Layer _(FastAPI + Pydantic)_

Four jobs:

1. **Onboarding interpretation.** Free-text needs ("small text on my bank's site is impossible") →
   structured profile deltas.
2. **Page → adaptation plan.** The Tier 2 semantic call: redacted page summary in, schema-constrained
   JSON plan out.
3. **Density summarization.** Long passages condensed on request — offered, never imposed.
4. **Cloud inference proxy.** Non-negotiable: **an API key can never ship inside an extension**, since
   anything bundled is readable by anyone who installs it. This is the reason a backend exists at all.

| Concern     | Technology                           | Why                                                                                       |
| ----------- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| Framework   | **FastAPI**                          | Pydantic-native structured output; RJ owns back-end; the study analysis is Python already |
| Schema      | **Pydantic v2**                      | One declaration → validation → JSON Schema → the model's constraint                       |
| Cloud model | **Claude Haiku 4.5** (swappable)     | Cheap, fast, strong strict-JSON adherence for a high-volume classification task           |
| Deploy      | **Railway / Render / Fly**           | Free tiers adequate; container deploy, no ops burden                                      |
| Auth        | **Supabase JWT** verified in FastAPI | Do not build auth                                                                         |

**Tiered inference is preserved, and the backend is one tier — not the only path:**

| Tier                   | Where                                             | Context               | Latency           | Privacy                            |
| ---------------------- | ------------------------------------------------- | --------------------- | ----------------- | ---------------------------------- |
| **On-device**          | Chrome Prompt API / Gemini Nano, in the extension | ~6K tokens            | Fast              | Nothing leaves the device          |
| **Cloud**              | This layer                                        | Large                 | ~6–7s             | Redacted summary leaves the device |
| **Native** _(stretch)_ | Mac app via Native Messaging                      | 4K–8K, larger via MLX | ~1 min on base M1 | Nothing leaves the device          |

Selection is by capability probe, then whether the summary fits, then user preference. **Say the
honest trade-off in the pitch:** cloud is _faster_ than local on most machines. Local-first is a values
choice with a real latency cost, and admitting that is worth more than defending it.

**A single-vendor alternative worth considering:** Gemini Flash in the cloud tier pairs with Gemini
Nano on-device, so prompts and constrained-decoding behavior stay consistent across tiers. Haiku is
the better standalone JSON emitter. Either works — the `InferenceProvider` interface makes it a
one-file change, so do not spend meeting time on it.

---

## Layer 3 — Command Center _(Next.js 15)_

A11Yson's dashboard is a settings page. Ours has two jobs a settings page does not, and they are what
justify building it:

| Job                                     | Why it matters here                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Profile editor + calibration replay** | Re-run the reading and pointing calibration on a big screen                                            |
| **Adaptation defect dashboard**         | The verifier's rejections, visible. This is our evidence, and it doubles as the evaluation's data view |
| **"What was sent" receipts**            | Every payload the extension ever sent, auditable by the user. The privacy claim made inspectable       |
| **Sync and recovery**                   | Manage the encrypted profile, regenerate the recovery code                                             |
| **Onboarding on desktop**               | Longer-form intake where free text is comfortable                                                      |

| Concern               | Technology                                                                      |
| --------------------- | ------------------------------------------------------------------------------- |
| Framework             | **Next.js 15** (App Router), TypeScript                                         |
| UI                    | **React Aria Components** + vanilla CSS with custom properties and `@layer`     |
| Auth + data           | **Supabase** (Auth, Postgres, row-level security)                               |
| Extension ↔ dashboard | `chrome.runtime.sendMessage` with `externally_connectable` scoped to our origin |
| Deploy                | **Vercel**                                                                      |

**Cross-tab and cross-session sync** rides `chrome.storage.onChanged` in the extension plus Supabase
realtime in the dashboard — but local always wins on conflict, because local is authoritative.

---

## The contract between layers

The single highest-risk seam in a three-layer, two-language system is schema drift. One mechanism
prevents it:

```
Pydantic model  ──►  JSON Schema  ──►  TypeScript types + validator
 (source of truth)    (build artifact)   (generated, committed)
                            │
                            └──►  model constraint at BOTH tiers
                                  (Prompt API responseConstraint · cloud strict schema)
```

Define the adaptation plan **once**, in Pydantic. Export JSON Schema as a committed build artifact.
Generate the extension's TypeScript types from it with `json-schema-to-typescript`. That same JSON
Schema constrains the on-device model and the cloud model, so all three consumers and both producers
agree by construction.

**Put the codegen in CI and fail the build on drift.** A generated artifact that can go stale silently
is worse than no codegen at all.

_Escape hatch:_ if the team turns out to be much stronger in TypeScript than Python, the identical
three-layer shape works with a TS backend (Hono, or Next.js route handlers) and Zod in place of
Pydantic. Same diagram, one language, and the codegen step disappears. Decide Monday — this is the
single biggest stack call on the list.

---

## Data, sync, and privacy

| Tier       | Mechanism                  | Technology                                                         |
| ---------- | -------------------------- | ------------------------------------------------------------------ |
| Local only | `chrome.storage.local`     | No server, no account. **The default**                             |
| Convenient | `chrome.storage.sync`      | Google's store, 8 KB per item                                      |
| Private    | Encrypted blob in Supabase | **WebCrypto** AES-GCM, key derived via PBKDF2 from a recovery code |

The server holds an opaque blob under RLS; we never hold the key. So the claim is **"local-first
processing, zero-knowledge sync,"** never "no server." Key loss means profile loss — generate the
recovery code during onboarding and say plainly what it protects.

**Calibration stays measured, not asked.** A11Yson interprets self-reported onboarding answers.
Self-report and measured ability diverge, and stated preference does not predict what a person
actually reads fastest — so WebAble _measures_ reading comfort and pointing accuracy on live examples,
and uses the LLM only to turn free-text descriptions into profile deltas. Hybrid, and better than
either alone.

---

## The Mac app — demote to stretch goal

Honest consequence of adopting this shape: the Mac app's three original justifications were a larger
context window, profile ownership independent of Google, and a path beyond the browser. **The Command
Center now delivers the second**, and the Intelligence Layer covers the first. Only the third
survives, and it is the least urgent.

Recommendation: keep it in the pitch as an explicitly labeled stretch goal after the three layers are
complete. Two competing profile homes built in one semester is how the verifier ends up late, and the
verifier is the contribution.

---

## Testing

| Level                    | Technology                                             | Protects                                                                       |
| ------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Unit (extension)         | **Vitest**                                             | Plan validation, profile migration, each verifier check                        |
| Unit (intelligence)      | **pytest**                                             | Plan generation, schema conformance, redaction allowlist                       |
| Component                | Vitest + Testing Library                               | Onboarding and calibration                                                     |
| E2E / corpus             | **Playwright**, persistent context, `--load-extension` | The real extension on real pages — the only test that proves the product works |
| Accessibility regression | **`@axe-core/playwright`**                             | Violation deltas across the corpus, every PR                                   |
| Visual regression        | Playwright `toHaveScreenshot()`                        | Layout breakage no rule engine will see                                        |
| Contract                 | Schema codegen check in CI                             | Drift between Pydantic and the generated TS                                    |
| Our own UI               | axe on extension pages _and_ the dashboard             | An accessibility project whose own onboarding fails axe is fatal               |

**Archive the corpus, do not test against live sites.** Live pages drift, tests go flaky, teams learn
to ignore them — and an ignored regression suite on this project means shipping harm. Commit frozen
snapshots; keep a small live smoke run for drift detection.

---

## CI, tooling, documentation

| Concern                | Technology                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Repo                   | **pnpm workspace monorepo**: `apps/extension`, `apps/command-center`, `apps/intelligence`, `packages/schema`, `tests/corpus`, `analysis/` |
| Lint + format (TS)     | **Biome** — one binary, replaces ESLint + Prettier                                                                                        |
| Lint + format (Python) | **Ruff** — same philosophy, one tool                                                                                                      |
| Types                  | `tsc --noEmit`, **mypy**                                                                                                                  |
| CI                     | **GitHub Actions**: typecheck → lint → unit → schema-drift → Playwright corpus, every PR                                                  |
| Branch protection      | `main` protected; PR + 1 reviewer + green CI to merge                                                                                     |
| Ownership              | **`CODEOWNERS`** by layer                                                                                                                 |
| Backlog                | **GitHub Projects**                                                                                                                       |
| Decisions              | **ADRs** in `docs/adr/` — AD-1…AD-8 already exist in [02-Feature-Set.md](02-Feature-Set.md) and need reformatting, not authoring          |

`CODEOWNERS` and ADRs earn grades directly: the first is the auditable record the Individual
Contribution grade (10%) needs, the second feeds Documentation (10%).

---

## Evaluation

| Concern         | Technology                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------ |
| Analysis        | **Python** + pandas, **pingouin**, Jupyter — shares a language with the Intelligence Layer |
| Tests           | Paired t-test; Wilcoxon signed-rank where non-normal; McNemar for paired success rates     |
| Power           | `pingouin.power_ttest` — confirms 12–16 per persona                                        |
| Instruments     | **SEQ** per task, **NASA-TLX** for persona B, **SUS** per condition                        |
| Questionnaires  | **Qualtrics** (university license), or **REDCap** if the IRB prefers                       |
| Instrumentation | Plain TS → `chrome.storage.local`, exported as JSON                                        |

**Instrumentation never phones home.** Study data stays local and is exported deliberately —
on-thesis for privacy, and it materially simplifies the IRB protocol.

---

## Methods

**Scrum with a Sunday sprint boundary.** The course requires a Weekly Team Project Status Report every
Sunday. End the sprint Sunday and **the sprint review _is_ the report** — one artifact, one deadline.
Planning Monday, async standups in Discord, retro folded into the Thursday team meeting.

| Practice           | Detail                                                    |
| ------------------ | --------------------------------------------------------- |
| Sprints            | 1 week, Sunday boundary                                   |
| Branching          | `username/feature-name`, PR into `main`, no direct pushes |
| Review             | 1 reviewer minimum, CI green, no exceptions               |
| Definition of done | Merged, tested, and **explainable by its author**         |
| Secrets            | Never committed — GitHub Actions secrets, local `.env`    |
| Advisor            | Biweekly Tuesday, one-page pre-read the day before        |

### Layers map onto people

| Layer / seam                                          | Owner                      | Support  |
| ----------------------------------------------------- | -------------------------- | -------- |
| Execution Engine — renderer, style engine, shadow DOM | **Katie** (front-end lead) | Fernando |
| Execution Engine — **the verifier** _(critical path)_ | **Belal**                  | Caden    |
| Tier 0/1 transformations, test corpus, QA             | **Fernando**               | Katie    |
| Intelligence Layer + database + sync                  | **RJ** (back-end lead)     | Caden    |
| Command Center                                        | **Katie**                  | RJ       |
| Schema contract, inference abstraction, architecture  | **Caden** (lead)           | all      |

The verifier is the critical path and must not be scheduled late. Review-board filing has the longest
external lead time and starts in week one regardless of code progress.

---

## Store and compliance — week one

- **Register the Chrome Web Store developer account now** ($5 one-time). Lead time is the risk.
- Write the **privacy policy** early — required, and for us it is a selling point.
- Write **permission justifications** for `activeTab`, `scripting`, and each optional host permission.
- **Never claim conformance** — not in the listing, the description, the screenshots, or the pitch.

---

## Deliberately not using

| Rejected                         | Why                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **React in content scripts**     | Bundle weight and global pollution inside arbitrary pages; version conflicts with the host. React belongs in extension pages and the dashboard |
| **Dashboard as source of truth** | Would make a signed-out user productless and reproduce Morphic's failure                                                                       |
| **Model-generated JavaScript**   | Chrome store policy violation. Data only — JSON and CSS                                                                                        |
| **Cloud-only inference**         | Kills the local-first thesis and the zero-network Tier 0 guarantee                                                                             |
| **Self-report-only onboarding**  | Stated preference does not predict measured reading speed                                                                                      |
| **Tailwind**                     | We are writing a cascade engine; mixing utilities with user-origin CSS and `@layer` invites the exact confusion we cannot afford               |
| **Plasmo**                       | Development has slowed; WXT is the better-maintained bet                                                                                       |
| **Redux**                        | The profile is under 8 KB. `chrome.storage` + context is the whole requirement                                                                 |
| **Jest, Selenium, Cypress**      | Vitest shares WXT's Vite config; Playwright is the only good MV3 extension driver                                                              |
| **Training a model**             | Selection from a fixed menu. A small classifier is a late extension, never a foundation                                                        |

---

## Decide Monday, before the first commit

1. **Python or TypeScript for the Intelligence Layer.** The biggest call. FastAPI + Pydantic fits RJ's
   role and the analysis stack, at the cost of a codegen step. Hono or Next.js route handlers plus Zod
   makes it one language and deletes the seam.
2. **WXT vs. plain Vite** — velocity against a young dependency.
3. **Haiku vs. Gemini Flash** in the cloud tier — standalone JSON strength against cross-tier
   consistency with Nano. One file either way.
4. **Mac app: stretch goal or cut entirely** for the pitch.
5. **Sunday sprint boundary** — confirm everyone accepts a Sunday deadline.

**Monday's setup order:** monorepo and workspaces → WXT skeleton injecting one stylesheet → Biome,
Ruff, CI green on an empty test → the Pydantic plan schema and its codegen → axe-core wired into a
Playwright run against one archived corpus page. That last step is the verifier's skeleton, and it is
the critical path.

---

_See also: [01-Positioning.md](01-Positioning.md) for why the layering rules are non-negotiable,
[02-Feature-Set.md](02-Feature-Set.md) for the eight architecture decisions each choice implements,
and [04-Open-Decisions.md](04-Open-Decisions.md) for the risk register._
