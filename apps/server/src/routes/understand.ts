// POST /v1/understand {digest, noCache?} -> PageUnderstanding
// One page = one set of parallel Jev calls (design B: evidence inside each question). Round 7 (page model v2): a fine
// role, task, help and importance for every element and content region (main for main-action candidates), and one
// page call with the purpose, the main region in both option orders and the main-action pick.
// Cached answers are labelled honestly: `cached: true`, `metrics` says what this view cost (no calls, $0, the time it
// took to answer), and `firstRead` keeps the live read's own numbers (its latency, tokens and $).
import type { Hono } from 'hono';
import { z } from 'zod';
import { buildPageCalls, parsePageAnswers } from '@webable/core';
import type { ElementEvidence, JevMetrics, PageDigest, PageUnderstanding } from '@webable/core';
import { askJevAll, jevMetrics } from '../jev';
import type { JevResult } from '../jev';
import { cleanLabel, sanitizeDigest } from '../sanitize';
import { PageDigestSchema, ZONES } from '../schemas';
import { log, round } from '../util';
import { readBody, wantsFresh } from './common';

/**
 * A content region's evidence: an element's evidence, except that the reader's role hint for a region is a longer
 * code-written summary of what it holds ("region holding scoreboard with 2 team logos and a line score").
 */
export const RegionEvidenceSchema: z.ZodType<ElementEvidence> = z.object({
  id: z.string().regex(/^n\d{1,6}$/, 'ids look like n12'),
  tag: z.string().max(32),
  role_hint: z.string().max(240),
  label: z.string().max(400),
  zone: z.enum(ZONES),
  landmark: z.string().max(64),
  size: z.string().max(40),
  position: z.string().max(120),
  fixed: z.boolean(),
  class_words: z.array(z.string().max(40)).max(12),
  visual_weight: z.enum(['low', 'medium', 'high']),
  iframe_kind: z.string().max(40).optional(),
  link_target: z.enum(['same page', 'this website', 'another website']).optional(),
  text_chars: z.number().int().min(0).max(10_000_000).optional(),
  cards: z.number().int().min(0).max(10_000).optional(),
});

/** The round-7 digest: the measured digest plus its content regions (the shared schema strips unknown keys). */
export const UnderstandBodyV2 = z.object({
  digest: z.intersection(PageDigestSchema, z.object({ regions: z.array(RegionEvidenceSchema).max(24).optional() })),
  noCache: z.boolean().optional(),
});

/** Region labels get the same server redaction as element labels; an empty list is dropped. */
export function sanitizeRegions(regions: ElementEvidence[] | undefined): { regions: ElementEvidence[] | undefined; changed: number } {
  if (!regions?.length) return { regions: undefined, changed: 0 };
  let changed = 0;
  const out = regions.map((r) => {
    const label = cleanLabel(r.label);
    const role_hint = cleanLabel(r.role_hint, 30);
    if (label !== r.label || role_hint !== r.role_hint) changed++;
    return { ...r, role_hint, label };
  });
  return { regions: out, changed };
}

/** The optional `caution` line measurably lowers residual unsure answers on pages with ad iframes or off-site links. */
export function needsCaution(d: PageDigest): boolean {
  return [...d.elements, ...(d.regions ?? [])].some((e) => (e.iframe_kind !== undefined && e.iframe_kind !== '') || e.link_target === 'another website');
}

/**
 * Metrics for this view. All live: the calls' own metrics. All cached: no calls, no tokens, $0, the time this
 * answer took; the decisions are still the page's. Mixed: the live calls' cost, every decision.
 */
export function viewMetrics(results: JevResult[], elapsedMs: number): { metrics: JevMetrics; cached: boolean; firstRead?: JevMetrics } {
  const all = jevMetrics(results);
  const live = results.filter((r) => !r.cached);
  if (live.length === results.length) return { metrics: all, cached: false };
  if (live.length === 0) {
    return {
      metrics: { ...all, calls: 0, inputTokens: 0, costUsd: 0, serverMs: null, wallMs: round(elapsedMs) },
      cached: true,
      // Cached entries keep the live read's body, latency and server time, so these are the first read's numbers.
      firstRead: all,
    };
  }
  const m = jevMetrics(live);
  return { metrics: { ...m, questions: all.questions }, cached: false };
}

export async function understand(input: PageDigest, opts: { fresh?: boolean } = {}): Promise<PageUnderstanding> {
  const t0 = performance.now();
  const clean = sanitizeDigest(input);
  const r = sanitizeRegions(input.regions);
  const digest: PageDigest = { ...clean.digest, regions: r.regions };
  if (!r.regions) delete digest.regions;
  const changed = clean.changed + r.changed;
  if (changed) log('understand: server redaction changed labels', { count: changed });
  const calls = buildPageCalls(digest, { caution: needsCaution(digest) });
  const results = await askJevAll(
    calls.map((call) => ({ state: call.state, questions: call.questions })),
    { tag: 'understand', fresh: opts.fresh },
  );
  const view = viewMetrics(results, performance.now() - t0);
  const u = parsePageAnswers(digest, calls, results.map((x) => x.body), view.metrics);
  if (view.cached) log('understand: from cache', { decisions: view.metrics.questions, firstReadMs: view.firstRead?.wallMs });
  if (u.purpose || u.mainRegion) {
    log('understand: page', {
      purpose: u.purpose?.kind,
      purposeP: u.purpose ? round(u.purpose.p, 2) : undefined,
      mainRegionP: u.mainRegion ? round(u.mainRegion.p, 2) : undefined,
      regions: digest.regions?.length ?? 0,
    });
  }
  return { ...u, metrics: view.metrics, cached: view.cached, ...(view.firstRead ? { firstRead: view.firstRead } : {}) };
}

export function registerUnderstand(app: Hono): void {
  app.post('/v1/understand', async (c) => {
    const { digest, noCache } = await readBody(c, UnderstandBodyV2);
    const u = await understand(digest, { fresh: noCache === true || wantsFresh(c) });
    c.header('X-WebAble-Cache', u.cached ? 'hit' : 'miss');
    return c.json(u);
  });
}
