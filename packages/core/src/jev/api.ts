// Jev System One API types (POST https://api.typesafe.ai/v1/systemone). Owner: A1.
import { JEV_MODEL, JEV_USD_PER_INPUT_TOKEN } from '../types';
import type { JevMetrics } from '../types';

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
/** Header required on every request that carries an image or a Box question (Danger Zone, jev-1.14). */
export const JEV_IMAGES_HEADER = { 'TypeSafe-Danger-Zone-Images': 'true' } as const;
/** Choice questions accept at most this many options. */
export const JEV_MAX_CHOICE_OPTIONS = 255;

export type JevEntry = string | Record<string, unknown> | unknown[] | null;

export type JevQuestion =
  | { type: 'noul'; instructions: JevEntry; criteria?: { true: JevEntry; false: JevEntry } }
  | { type: 'choice'; instructions: JevEntry; criteria: Record<string, JevEntry> }
  | { type: 'score'; instructions: JevEntry; criteria: JevEntry[] }
  | { type: 'box'; instructions: JevEntry };

/** An image in the request's top-level `assets` map, base64 in JSON (docs: hack/jev-docs/sec/images.md). */
export interface JevImageAsset { type: 'image'; format: 'png' | 'jpg'; data_base64: string }

export interface JevRequestBody {
  model: string;
  state: unknown;
  questions: Record<string, JevQuestion>;
  assets?: Record<string, unknown>;
}

export type JevAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; legend: Record<string, unknown>; probabilities: Record<string, number>; confidence: number }
  | { type: 'box'; box: { top: number; bottom: number; left: number; right: number }; confidence: number };

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

/** The request body for one call (model pinned to JEV_MODEL unless given). */
export function jevRequestBody(
  call: { state: unknown; questions: Record<string, JevQuestion>; assets?: Record<string, unknown> },
  model: string = JEV_MODEL,
): JevRequestBody {
  const body: JevRequestBody = { model, state: call.state, questions: call.questions };
  if (call.assets && Object.keys(call.assets).length > 0) body.assets = call.assets;
  return body;
}

/** Cheap structural check of a parsed response body. */
export function isJevResponse(x: unknown): x is JevResponse {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return typeof r.answers === 'object' && r.answers !== null && !Array.isArray(r.answers);
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Noul probability for question `id`, or null when missing or malformed (callers fail closed). */
export function noulOf(resp: JevResponse | null | undefined, id: string): number | null {
  const a = resp?.answers?.[id];
  return a && a.type === 'noul' && finite(a.noul) ? clamp01(a.noul) : null;
}

/** Choice answer for question `id` (probabilities cleaned to finite 0..1), or null. */
export function choiceOf(
  resp: JevResponse | null | undefined, id: string,
): { choice: string; p: number; probs: Record<string, number> } | null {
  const a = resp?.answers?.[id];
  if (!a || a.type !== 'choice' || typeof a.probabilities !== 'object' || a.probabilities === null) return null;
  const probs: Record<string, number> = {};
  for (const [k, v] of Object.entries(a.probabilities)) if (finite(v)) probs[k] = clamp01(v);
  const keys = Object.keys(probs);
  if (keys.length === 0) return null;
  // Gate on the top probability (never on `confidence`); on a tie keep the API's own choice.
  let choice = typeof a.choice === 'string' && a.choice in probs ? a.choice : keys[0]!;
  for (const k of keys) if ((probs[k] ?? 0) > (probs[choice] ?? 0)) choice = k;
  return { choice, p: probs[choice] ?? 0, probs };
}

/** Score answer for question `id`: expected level and level probabilities, or null. */
export function scoreOf(
  resp: JevResponse | null | undefined, id: string,
): { score: number; probs: Record<string, number> } | null {
  const a = resp?.answers?.[id];
  if (!a || a.type !== 'score' || !finite(a.score)) return null;
  const probs: Record<string, number> = {};
  if (a.probabilities && typeof a.probabilities === 'object') {
    for (const [k, v] of Object.entries(a.probabilities)) if (finite(v)) probs[k] = clamp01(v);
  }
  return { score: a.score, probs };
}

/** Box answer for question `id` (edges as 0..1 fractions), or null. */
export function boxOf(
  resp: JevResponse | null | undefined, id: string,
): { box: { top: number; bottom: number; left: number; right: number }; confidence: number } | null {
  const a = resp?.answers?.[id];
  if (!a || a.type !== 'box' || !a.box) return null;
  const { top, bottom, left, right } = a.box;
  if (![top, bottom, left, right].every(finite)) return null;
  return {
    box: { top: clamp01(top), bottom: clamp01(bottom), left: clamp01(left), right: clamp01(right) },
    confidence: finite(a.confidence) ? clamp01(a.confidence) : 0,
  };
}

/**
 * Combined metrics for one or more calls. Calls of one decision run in parallel, so wall and server time are the
 * slowest call's; tokens, questions and cost add up. Cost = input tokens x $0.042 / M (output tokens are free).
 */
export function metricsFrom(
  responses: Array<{ body: JevResponse; wallMs: number; serverMs: number | null; questions: number }>,
): JevMetrics {
  let inputTokens = 0;
  let questions = 0;
  let wallMs = 0;
  let serverMs: number | null = null;
  const models: string[] = [];
  for (const r of responses) {
    const t = r.body?.usage?.input_tokens;
    if (finite(t)) inputTokens += t;
    if (finite(r.questions)) questions += r.questions;
    if (finite(r.wallMs)) wallMs = Math.max(wallMs, r.wallMs);
    if (finite(r.serverMs)) serverMs = Math.max(serverMs ?? 0, r.serverMs);
    const m = r.body?.model;
    if (typeof m === 'string' && m && !models.includes(m)) models.push(m);
  }
  return {
    model: models.length ? models.join(',') : JEV_MODEL,
    calls: responses.length,
    questions,
    inputTokens,
    wallMs: Math.round(wallMs),
    serverMs: serverMs === null ? null : Math.round(serverMs),
    costUsd: inputTokens * JEV_USD_PER_INPUT_TOKEN,
  };
}

/** Metrics for "no call was made". */
export function emptyJevMetrics(model: string = JEV_MODEL): JevMetrics {
  return { model, calls: 0, questions: 0, inputTokens: 0, wallMs: 0, serverMs: null, costUsd: 0 };
}
