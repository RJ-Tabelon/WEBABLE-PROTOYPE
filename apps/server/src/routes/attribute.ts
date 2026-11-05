// Owner: P (round 4). POST /v1/attribute {question: AttributionQuestion} -> AttributionAnswer
// Jev attribution for the passive fit (core jev/attribution.ts builds the questions and reads the answers): why a held
// zoom happened (text, picture, layout, other), whether a page's missed clicks were ordinary slips or the page's own
// doing, whether a long stop on a short passage was reading. The evidence is code-computed and structure-only; the
// server keeps known keys, re-redacts every string and never asks about the person. Fails closed: Jev errors map to
// 5xx and the extension then uses the code-only weight.
import type { Hono } from 'hono';
import { z } from 'zod';
import { ATTRIBUTION_KEYS, buildAttributionCall, parseAttribution } from '@webable/core';
import type { AttributionAnswer, AttributionQuestion } from '@webable/core';
import { askJev, jevMetrics } from '../jev';
import { cleanLabel } from '../sanitize';
import { HttpError, errorMessage, log, round } from '../util';
import { readBody, wantsFresh } from './common';

const KINDS = ['zoom_reason', 'pause_reason', 'miss_reason'] as const;

const EvidenceValue = z.union([z.string().max(120), z.number().finite().min(-1_000_000).max(1_000_000), z.boolean()]);

export const AttributeBody = z.object({
  question: z.object({
    kind: z.enum(KINDS),
    evidence: z
      .record(z.string().regex(/^[a-z_]{1,40}$/, 'evidence keys are snake_case words'), EvidenceValue)
      .refine((o) => Object.keys(o).length <= 24, 'at most 24 evidence values'),
  }),
});

/** Known keys only; strings re-redacted (they are code-written kinds like "paragraph text", never page text). */
export function sanitizeAttribution(q: AttributionQuestion): { question: AttributionQuestion; dropped: number } {
  const keys = new Set(ATTRIBUTION_KEYS[q.kind] ?? []);
  const evidence: Record<string, string | number | boolean> = {};
  let dropped = 0;
  for (const [k, v] of Object.entries(q.evidence ?? {})) {
    if (!keys.has(k)) {
      dropped++;
      continue;
    }
    evidence[k] = typeof v === 'string' ? cleanLabel(v, 6) : v;
  }
  return { question: { kind: q.kind, evidence }, dropped };
}

export async function attribute(input: AttributionQuestion, opts: { fresh?: boolean } = {}): Promise<AttributionAnswer> {
  const { question, dropped } = sanitizeAttribution(input);
  if (dropped) log('attribute: dropped unknown evidence keys', { kind: question.kind, count: dropped });
  let call: ReturnType<typeof buildAttributionCall>;
  try {
    call = buildAttributionCall(question);
  } catch (e) {
    throw new HttpError(422, 'no_evidence', `Nothing to ask: ${errorMessage(e).slice(0, 80)}`);
  }
  const r = await askJev({ state: call.state, questions: call.questions }, { tag: `attribute/${question.kind}`, fresh: opts.fresh });
  let answer: AttributionAnswer & { agree?: boolean };
  try {
    answer = parseAttribution(r.body, question.kind, jevMetrics([r]));
  } catch (e) {
    log('attribute: answer parser failed', { error: errorMessage(e).slice(0, 120) });
    throw new HttpError(502, 'attribute_unavailable', 'Jev did not answer the attribution question.');
  }
  log('attribute', { kind: question.kind, top: answer.top, p: round(answer.probs[answer.top] ?? 0, 2), agree: answer.agree, cached: r.cached || undefined });
  // Structure-only evidence (code-written kinds and numbers, never page text), for tuning: WEBABLE_LOG_ATTRIBUTION=1.
  if (process.env.WEBABLE_LOG_ATTRIBUTION === '1') log('attribute evidence', { ev: JSON.stringify(question.evidence).slice(0, 600) });
  return answer;
}

export function registerAttribute(app: Hono): void {
  app.post('/v1/attribute', async (c) => {
    const { question } = await readBody(c, AttributeBody);
    return c.json(await attribute(question, { fresh: wantsFresh(c) }));
  });
}
