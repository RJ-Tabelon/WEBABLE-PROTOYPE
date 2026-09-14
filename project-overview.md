# WebAble — Project Overview

**Course:** UF CISE Senior Project, Fall 2026
**Advisor:** Dung Tran, PhD — dungtran@ufl.edu

## Team

| Member | Role |
|---|---|
| Caden Shokat | Team Lead, Full-Stack Engineer |
| RJ Tabelon | Back-End Lead |
| Katie Boetig | Scrum Master, Front-End Engineer |
| Belal Mansour | Full-Stack Lead |
| Fernando Fiallos | Front-End Lead, QA Engineer |

## What WebAble is

WebAble is an AI-assisted accessibility platform that translates each user's individual needs into page-specific interface adaptations, across the web — rather than asking every site to independently support every accessibility need. A persistent, user-owned profile captures a person's accessibility needs and preferences; WebAble analyzes whatever page they're currently on and generates a structured adaptation plan for that page. Adaptations can touch readability, layout, navigation, motion, content density, and interaction. An automated verifier protects the page's original content and functionality before any change is allowed to render.

Initial platform target: Chrome (Manifest V3 extension).

## Problem & motivation

The web still expects very different users to use essentially the same interface. WebAble's opportunity is to make accessibility personalized, page-aware, and consistent across the web, while keeping the user in control.

Supporting numbers cited in the proposal:
- 95.9% of the top one million home pages have detectable WCAG 2 A/AA failures, averaging 56.1 errors per page (WebAIM).
- 28.7% of U.S. adults live with a disability; per the CDC, cognition is the largest single category (~14%), followed by mobility and visual impairments.
- A 2008 CHI study (Gajos, Wobbrock, Weld) found that adapting interfaces to a user's specific needs let them complete tasks 26% faster with 73% fewer errors.
- A review at ACM's Web for All Conference 2026 found that of 33 studies on language models and web accessibility, only 5 were actual browser extensions — i.e. most of the field is still theoretical.

## How it works (proposed solution)

1. **Build a profile** — the user describes their needs in plain language, or WebAble infers them from interaction signals (zoom level, dwell time, repeated re-reads).
2. **Summarize the page** — an allowlist summarizer reduces the live DOM to a compact structural summary that fits the on-device model's context window.
3. **Generate a plan** — the model returns a JSON adaptation plan (type scale, contrast, spacing, reading order, density, simplification). This is data, never executable code.
4. **Verify, then render** — a deterministic verifier checks the plan for clipped text, contrast loss, and orphaned focus. Passing plans render; failing ones roll back and log a defect.

## Who it's for

**Primary personas** (research-based, validated with real users, not assumptions):
- **Low vision** — larger type, stronger contrast, no horizontal scrolling or clipped text.
- **Motor** — larger targets, generous spacing, a keyboard path that never loses focus.
- **Cognitive** — lower density, simplified language, predictable reading order.
- **Age-related** — several of the above at once, with settings that persist across sites.

**Secondary stakeholders:**
- Caregivers/family who configure tech for an older relative — need setup to be short and reversible.
- Site owners/developers — get a real-user signal on which parts of their pages get adapted most, effectively a free remediation backlog.

## Architecture — three layers

- **Command center** — profile editor and calibration replay, privacy receipts (what was sent), adaptation defect dashboard, encrypted backup (mirror only).
- **Intelligence layer** — DOM allowlist summarizer, page-summary-to-adaptation-plan generation, onboarding-text-to-profile-deltas, density summarization, cloud inference proxy (holds the API key).
- **Execution engine** — the renderer itself: user-origin CSS first, then adopted stylesheets, then DOM fallback; plus the verifier and rollback logic.

## Tech stack

| Layer | Stack | Notes |
|---|---|---|
| Extension | TypeScript, Chrome MV3, content scripts + service worker | MV3 is mandatory for the Chrome Web Store |
| On-device model | Chrome Prompt API + Gemini Nano | Runs locally — no API key, no per-request cost, no page content leaves the browser |
| Intelligence layer | FastAPI + Pydantic, *or* Hono + Zod | **Open decision** — Pydantic fits RJ's analysis stack; Zod keeps one language and removes a schema-codegen seam |
| Command center | Next.js + Supabase (Postgres, Auth, RLS) | Row-level security enforces per-user isolation at the DB layer |
| Testing | Vitest, Playwright, axe-core (in CI) | axe-core asserts an adapted page is *more* conformant than the original, not just different |
| Process | Scrum, two-week sprints, GitHub PR review | Every PR: automated lint + tests, one reviewer minimum, feature-named branches, no committed secrets |

Other libraries under consideration from the original proposal: PyTorch, scikit-learn, Hugging Face Transformers, Ollama (for local LLM fallback).

## Key requirements

**Must have:**
- One-key reversibility — any adaptation can be undone instantly, original page always recoverable.
- On-device adaptation planning via Chrome Prompt API / Gemini Nano.
- The verifier — deterministic checks for clipped text, contrast regression, orphaned focus; auto-rollback on failure.
- Local-first profile — `chrome.storage` is authoritative; the cloud is an optional mirror the user can decline entirely.
- Profile editor — user can read, edit, and delete everything WebAble has inferred about them.

**Should have / non-functional:**
- Tier 0 adaptations applied within 100ms of page load.
- Cloud inference fallback for pages too large for the on-device model.
- Density summarization for cognitively heavy pages.
- Privacy receipts showing exactly what left the device.
- Adaptation defect dashboard fed by verifier rollbacks.
- Extension itself conforms to WCAG 2.2 AA.
- No profile data transmitted without explicit per-feature consent.
- Zero content loss and zero functionality loss, enforced by test.

## AI usage policy

- No team member commits code they cannot personally explain, regardless of how it was produced — every PR is reviewed by a human who can defend it line by line.
- Target: 80% of production code AI-generated. This excludes every written deliverable (proposal, technical report, presentation content, team contract) — those are human-written.
- AI-generated code carries a comment marking it as such, so provenance stays visible in the repo and the 80% figure is auditable rather than asserted.

## Backlog (priority order)

| Pri | Item | Owner | Points |
|---|---|---|---|
| P1 | Repo, CI, lint/test pipeline, MV3 scaffold | Belal | 5 |
| P1 | Tier 0 renderer: user-origin CSS, adopted stylesheets, DOM fallback | Katie | 8 |
| P1 | Adaptation plan JSON schema and shared type contract | RJ | 5 |
| P1 | Allowlist DOM summarizer with token budget | Fernando | 8 |
| P1 | Verifier v1: clipped text, contrast, orphaned focus, rollback | Belal | 13 |
| P1 | Chrome Prompt API integration and graceful fallback | RJ | 8 |
| P2 | Onboarding flow: plain language to profile deltas | Katie | 8 |
| P2 | Local profile store and one-key reversibility control | Fernando | 5 |
| P2 | Research-based personas and validation protocol | Caden | 5 |
| P2 | Command center: profile editor and privacy receipts | Katie | 13 |
| P3 | Cloud inference proxy and consent gate | RJ | 8 |
| P3 | Adaptation defect dashboard from verifier rollbacks | Caden | 8 |
| P3 | Density summarization for cognitively heavy pages | Fernando | 13 |
| P4 | Encrypted profile sync and backup | RJ | 8 |

Priority 1 is the walking skeleton — nothing in priority 2 starts until priority 1 renders on a real page. Owners are accountable for delivery, not sole authors; estimates are Fibonacci story points from planning poker and get re-estimated each sprint boundary.

## Milestones

- **Sprint 0** (Sep 8 – Sep 21): repo + CI live, MV3 scaffold, intelligence-layer language decided, personas drafted.
- **Sprint 1** (Sep 22 – Oct 5): Tier 0 renderer working on real pages, no model, no network.
- **Sprint 2** (Oct 6 – Oct 19): DOM summarizer, Prompt API integration, verifier v1 with rollback.
- **Sprint 3** (Oct 20 – Nov 2): onboarding flow, local profile store, reversibility control, command center skeleton.
- **Week 11** (Nov 3 – Nov 13): global partner testing, then the global collaboration report.
- **Sprint 4** (Nov 16 – Nov 29): fixes from partner findings, user validation sessions, WCAG 2.2 AA audit of our own UI.
- **Final** (Nov 30 – Dec 11): technical report, final demo, packaged extension build.

Deliverables overall: project proposal, sprint demos, global collaboration report (Week 11), technical report, packaged extension, final presentations.
