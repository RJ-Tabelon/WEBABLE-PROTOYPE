# WebAble — System Architecture

_Written 2026-09-29. Supersedes the inference-tier and FastAPI sections of
[02-Feature-Set.md](02-Feature-Set.md) and [06-Technologies-and-Methods.md](06-Technologies-and-Methods.md).
The invariants in [01-Positioning.md](01-Positioning.md) are unchanged._

## 1. One loop

```
 Tune (web app)            Fit profile            Page (extension)                          Learning
 ──────────────            ───────────            ────────────────                          ────────
 reading · pointing ──►  measured values   ──►  extract signals (local, ≤30 ms)
 · focus tasks            + confidence          │
 (raw trials stay          (Supabase,           ├─ local policy: rules × profile × learned ─► instant plan
  in memory)               versioned)            │                                              at DCL + ~60–90 ms
                                                 ├─ page analysis (optional, opt-in):
                                                 │   vocab-filtered structure ─► Edge Fn ─► Jev
                                                 │   region roles / main content ◄──────────┘ (~200–500 ms)
                                                 ├─ deterministic ops apply (one write)
                                                 ├─ verifier: clip · overlap · overflow · contrast ·
                                                 │   hidden focus · collapsed controls · lost focus
                                                 │   └─ failure ─► roll back that op (engine channel)
                                                 └─ person keeps / undoes / adjusts / "didn't help"
                                                        └──────────────────────────────────────────► Learner A (Beta)
                                                                                                     Learner B (Kalman)
                                                                                                     label table
                                                                                  domain-free sync ◄─┘
```

## 2. Who decides what

The research ([Jev](#5-jev), calibration, personalization) sorted every responsibility
into three kinds. Only one kind is a model decision.

| Responsibility | Kind | Owner |
| --- | --- | --- |
| Profile derivation from calibration | computation | `@webable/core` `deriveFitProfile` (web app, deterministic, versioned) |
| Feature extraction, verification | computation | content script |
| Whether an op applies (text, contrast, targets, motion…) | measurement | policy, from measured signals |
| **What a page region is for** (ad, recommendations, navigation, help…), **which block is the main content**, page type when rules are unsure | semantic classification | **Jev**, via the `decide` Edge Function, only for regions local rules cannot decide |
| Intensity | learned preference | Learner B (per person, per dimension) |
| Desirability, auto vs offer vs skip | learned preference × applicability | Learner A + expected-utility policy |
| Risk / keep after verification | measurement | verifier + engine reliability channel |
| "Why this changed" | template | rendered from the `DecisionTrace`, never generated |
| Plain-language simplification | generation | not in v1 (the architecture reserves an on-device-first slot) |

**AI decides what a page is. Deterministic code decides what to do about it for this
person, and how.** Jev returns probabilities over options WebAble wrote; no model emits
CSS, selectors, colours, or code.

## 3. Surfaces and packages

| Path | What | Stack |
| --- | --- | --- |
| `apps/web` | Public site, sign-in, **Tune** (calibration), Your fit, Changes, Sites, Privacy, Settings, Connect | Next.js 16 (App Router), React 19, `@supabase/ssr` |
| `apps/extension` | Service worker (auth, policy, learning, sync, page analysis), content script engine, popup, welcome page | WXT (MV3), React popup, plain-TS content scripts |
| `packages/core` | Contracts and pure logic: profile schema, calibration derivation, op catalog, page types, policy, learners, Jev adapter, question catalog, templates, bridge protocol, DB types | TypeScript + Zod 4, no DOM dependency in logic |
| `packages/tokens` | The design language as CSS custom properties, fonts (Atkinson Hyperlegible Next/Mono, self-hosted) | CSS |
| `packages/ui` | Shared React components for web and extension pages | React + React Aria Components |
| `supabase` | Migrations, RLS, SQL functions, Edge Functions (`decide`, `extension-link`) | Postgres 17, Deno |

## 4. Data model

| Table | Holds | Never holds |
| --- | --- | --- |
| `accounts` | onboarding step, consents (`cloud_analysis`, `product_learning`), theme | health information |
| `calibration_sessions` | versioned per-module **summaries** (≤16 KB) + coarse device buckets | raw trials, trajectories, reading times, screen fingerprint |
| `fit_profiles` | versioned fit profile (≤8 KB); one `is_current`; history = recalibration | persona labels, diagnoses |
| `learning_state` | domain-free Beta counts, Kalman dimensions, label table; optimistic `rev` | domains, events |
| `weekly_activity` | per-op weekly counts for the person's own "Changes" view (26-week retention) | domains, URLs |
| `extension_installs` | random install id, browser, platform, version | device identifiers |
| `private.ai_quota*` | page-analysis rate limiting | request bodies |
| `private.agg_outcome` | opt-in randomized-response counts, **no user id** | anything personal |

**On device only:** per-site state (a list of sites is browsing history), the event log
(30 days / 500 events), the page-analysis answer cache (keyed by HMAC with a per-install
secret), and the "What was sent" receipts. The web app reads site data from the
extension over `externally_connectable` while the page is open; it never reaches the server.

Every row that a user owns is protected by RLS `(select auth.uid()) = user_id`.
Profile saves go through `save_fit_profile()` so versioning is atomic.

## 5. Jev

TypeSafe AI's System One model: typed Choice / Score / Noul answers with probabilities,
70–116 ms server time, $0.042 per million input tokens, text-only, no generation.
Measured weaknesses that shaped the design: it always answers (every Choice gets an
escape option), packing many items into one state degrades beyond ~8 (each region goes
in its own question), it is weak at counting and geometry (never asked to measure), and
evidence-framed injection flips answers (only public-vocabulary words are sent).

- **Call path:** extension service worker → Supabase Edge Function `decide` (holds
  `TYPESAFE_API_KEY`, verifies the JWT, re-validates every word against `VOCAB_V1`,
  builds questions from the server-only catalog, enforces quota) → Jev pinned to
  `jev-1.13.0`.
- **Gating:** signed in, `cloud_analysis` consent on, an enabled op consumes region
  roles, a region is ambiguous to local rules, the answer cache missed, page language is
  English, not a password/payment page. Expected ≈0.25 calls per page view, ≈$0.08 per
  1,000 page views.
- **The profile is never sent.** The request content is identical for everyone who sees
  the same page structure; the person's preferences are combined afterwards on device:
  `P(helpful) = A(page) × θ̄(person)`.
- **Without Jev** (signed out, offline, no consent, no key): local rules decide
  high-precision regions; everything for reading and pointing works unchanged.

## 6. Latency

| Path | Budget |
| --- | --- |
| Profile-level CSS (focus outline, calm motion) | registered stylesheet, before first paint |
| Extract → local plan → apply → verify | DOMContentLoaded + ~60–90 ms, no network |
| Page-analysis refinement | ≤600 ms p95 warm; late answers apply only paint ops before first interaction, otherwise are cached for the next visit to the same template |

## 7. Learning

Two small Bayesian learners and a fixed threshold policy (simulation beat Thompson
sampling by 20–75% fewer unwanted auto-applies):

- **Learner A** — Beta-Bernoulli desirability per op, personal → site with shrinkage
  (κ = 4), calibration prior strength 4 + 6·confidence, 90-day half-life.
- **Learner B** — Kalman/probit estimate per dimension (text px, line height, target px…)
  in log space, snapped to reviewed ladder levels with hysteresis.
- **Policy** — auto-apply only when expected utility is positive (P ≳ 0.70, unwanted
  change costs 2.33× a wanted one), offer at P ≥ 0.40 within budgets (1 per page, 4 per
  day). Friction signals can only raise the chance of an offer, never apply a change.
- **Verifier outcomes** update engine reliability only, never preference.
- **Sync** — domain-free deltas merged client-side and written with optimistic
  concurrency (`put_learning_state`).
- **Product learning** — opt-in, randomized response (ε = ln 3), published only at ≥50
  devices per cell. Built as tables and a contract; off by default.

## 8. Extension permissions and auth

- Install: `storage`, `scripting`, `activeTab`, `tabs`, `webNavigation`, `alarms`,
  `commands`. Broad site access is **optional** (`<all_urls>`), requested from the
  welcome page with a click; then content scripts are registered at `document_start`.
- Sign-in handoff: the signed-in web app asks the `extension-link` Edge Function for a
  single-use token hash and passes it to the extension over `externally_connectable`;
  the service worker exchanges it with `verifyOtp` for **its own** session. The web
  app's refresh token is never shared. Only the service worker holds tokens.

## 9. Design system

"Made to Measure": Atkinson Hyperlegible Next, warm paper `#FAFAF7` and ink `#1A1A17`,
a single fern accent that means only "WebAble changed this, or offers to", pill actions,
flat surfaces with hairlines, one easing curve, no motion on other people's pages, and
fit marks (`13 → 18 px`) that make every change inspectable. Full spec:
`packages/tokens` and the component library in `packages/ui`.
