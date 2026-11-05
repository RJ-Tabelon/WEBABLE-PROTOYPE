// POST /v1/reader {req: ReaderImportRequest} -> ReaderProfile
// Round 9. The person pasted their AI assistant's answer about how they like things explained. READER_MODEL breaks
// it into points (EXPLAIN_MODEL if it fails); code drops points whose quote is not in the answer or that name a
// condition; Jev checks each remaining point against the answer and points under GROUND_MIN_SUPPORT are dropped.
// The answer itself is not kept (only the cache holds the finished profile, keyed by its hash, for 30 minutes).
// No model or no Jev: a 503 with a plain message; nothing usable in the answer: a 422.
import type { Hono } from 'hono';
import { GROUND_MIN_SUPPORT, buildGroundCall, parseGround } from '@webable/core';
import type { ReaderImportRequest, ReaderPoint, ReaderProfile } from '@webable/core';
import { aiState } from '../ai';
import { jevKey } from '../config';
import { JevError, askJev, jevMetrics } from '../jev';
import { TtlLru } from '../lru';
import { readerFromAnswer } from '../openai';
import type { ReaderOutput } from '../prompts';
import { ReaderImportBody } from '../schemas';
import { HttpError, hashOf, log, round } from '../util';
import { readBody, wantsFresh } from './common';

const cache = new TtlLru<ReaderProfile>(50, 30 * 60_000);

export const READER_MAX_POINTS = 10;
const SAYS_MAX = 120;
const EVIDENCE_MAX = 200;

export const READER_MESSAGES = Object.freeze({
  llm_unavailable: "Couldn't read your AI's answer right now. Try again in a few minutes.",
  check_unavailable: "Couldn't check your AI's answer right now. Try again in a few minutes.",
  nothing_found: "That answer doesn't say how you like things explained. Paste the whole answer, or ask your AI again.",
});

/** Words that name a condition, diagnosis or cause. A point that uses one is dropped ("learns the need, never the cause"). */
export const CONDITION_RE =
  /\b(?:adhd|autis\w*|asperger\w*|dyslex\w*|dyscalcul\w*|dyspraxi\w*|anxiety|anxious|depress\w*|bipolar|ptsd|ocd|disorders?|disabilit\w*|disabled|impair\w*|diagnos\w*|syndrome|blind\w*|deaf\w*|neurodiverg\w*|neurodivers\w*|illness|disease|stroke|tremors?|parkinson\w*|dementia|alzheimer\w*|seizures?|epilep\w*|brain fog|medicat\w*|therap\w*|mental health|learning (?:difficult|disab)\w*|elderly)\b/i;

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The quote is in the answer (case, spacing and quote marks aside; '...' may join two pieces of it). */
export function quotedFrom(answer: string, evidence: string): boolean {
  const a = norm(answer);
  const pieces = norm(evidence)
    .replace(/^["']+|["']+$/g, '')
    .split(/\.\.\.|…/)
    .map((p) => p.trim().replace(/^["',;: ]+|["',;:. ]+$/g, ''))
    .filter((p) => p.length > 0);
  if (pieces.length === 0 || pieces.join('').length < 8) return false;
  return pieces.every((p) => a.includes(p));
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/** Code's cleaning of the model's points: quote in the answer, no condition words, no repeats, ids r1… */
export function cleanPoints(answer: string, raw: ReaderOutput['points']): Array<Omit<ReaderPoint, 'support' | 'on'>> {
  const out: Array<Omit<ReaderPoint, 'support' | 'on'>> = [];
  const seen = new Set<string>();
  for (const p of raw) {
    const says = clip(p.says, SAYS_MAX);
    if (!says || CONDITION_RE.test(says)) continue;
    if (!quotedFrom(answer, p.evidence)) continue;
    const key = norm(says);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `r${out.length + 1}`, kind: p.kind, says, evidence: clip(p.evidence, EVIDENCE_MAX) });
  }
  return out;
}

const SOURCES = ['ChatGPT', 'Claude', 'Gemini'] as const;

function sourceFor(req: ReaderImportRequest, guess: string): string {
  const named = SOURCES.find((s) => s.toLowerCase() === (req.source ?? '').trim().toLowerCase());
  if (named) return named;
  return (SOURCES as readonly string[]).includes(guess) ? guess : 'your AI';
}

export async function readerImport(req: ReaderImportRequest, opts: { fresh?: boolean } = {}): Promise<ReaderProfile> {
  const text = req.text.trim();
  const ai = aiState();
  if (ai.status !== 'on') throw new HttpError(503, 'llm_unavailable', READER_MESSAGES.llm_unavailable, { reason: ai.reason });
  if (!jevKey()) throw new HttpError(503, 'check_unavailable', READER_MESSAGES.check_unavailable, { reason: 'no_jev_key' });
  const { value } = await cache.getOrMake(hashOf('reader.1', text, req.source ?? ''), () => build(req, text, opts), { fresh: opts.fresh });
  return { ...value, createdAt: new Date().toISOString() };
}

async function build(req: ReaderImportRequest, text: string, opts: { fresh?: boolean }): Promise<ReaderProfile> {
  const t0 = performance.now();
  const llm = await readerFromAnswer(text);
  if (!llm.ok) {
    log('reader: no breakdown', { error: llm.error });
    throw new HttpError(503, 'llm_unavailable', READER_MESSAGES.llm_unavailable, { reason: llm.error });
  }
  const cleaned = cleanPoints(text, llm.data.points);
  if (cleaned.length === 0) throw new HttpError(422, 'nothing_found', READER_MESSAGES.nothing_found);

  let support: Record<string, number>;
  let jev;
  try {
    const call = buildGroundCall(text, cleaned);
    const r = await askJev({ state: call.state, questions: call.questions }, { tag: 'reader-ground', fresh: opts.fresh });
    jev = jevMetrics([r]);
    support = parseGround(cleaned.map((p) => p.id), r.body);
  } catch (e) {
    log('reader: points could not be checked', { kind: e instanceof JevError ? e.kind : 'error' });
    throw new HttpError(503, 'check_unavailable', READER_MESSAGES.check_unavailable, { reason: e instanceof JevError ? `jev_${e.kind}` : 'check_error' });
  }

  const points: ReaderPoint[] = cleaned
    .map((p) => ({ ...p, support: round(support[p.id] ?? 0, 3), on: true }))
    .filter((p) => p.support >= GROUND_MIN_SUPPORT)
    .slice(0, READER_MAX_POINTS)
    .map((p, i) => ({ ...p, id: `r${i + 1}` }));
  log('reader', {
    model: llm.model,
    asked: llm.data.points.length,
    quoted: cleaned.length,
    kept: points.length,
    level: llm.data.level,
    ms: round(performance.now() - t0),
  });
  if (points.length === 0) throw new HttpError(422, 'nothing_found', READER_MESSAGES.nothing_found);

  const headline = clip(llm.data.headline, 90);
  return {
    v: 'reader.1',
    createdAt: new Date().toISOString(),
    source: sourceFor(req, llm.data.source_guess),
    headline: headline && !CONDITION_RE.test(headline) ? headline : 'How you like things explained.',
    points,
    level: llm.data.level,
    length: llm.data.length,
    shape: llm.data.shape,
    answerFirst: llm.data.answer_first,
    metrics: { model: llm.model, ms: round(performance.now() - t0), jev },
  };
}

export function registerReader(app: Hono): void {
  app.post('/v1/reader', async (c) => {
    const { req } = await readBody(c, ReaderImportBody);
    return c.json(await readerImport(req, { fresh: wantsFresh(c) }));
  });
}
