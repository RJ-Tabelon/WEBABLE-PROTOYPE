// OpenAI Responses API: layout candidates (LAYOUT_MODEL, no reasoning, 3 stances in parallel, strict FitSpec
// schema, 12 s), an optional background deep layout (DEEP_LAYOUT_MODEL) cached for the next visit, the reader and
// the paragraph rewrites (round 9), and the WebAble page's components (round 10). The models only ever return data
// that we validate.
// When OpenAI says the account has no credits (or rejects the key), every call is skipped for AI_BLOCK_MS and a
// one-token probe checks again when the block ends (ai.ts), so the product picks AI up again on its own.
import OpenAI from 'openai';
import { COMPOSE_MODEL, DEEP_LAYOUT_MODEL, EXPLAIN_MODEL, LAYOUT_MODEL, READER_MODEL, REWORD_MODEL } from '@webable/core';
import type { ComposeGroupIn, ReaderProfile, RewordKind, RewordOut, RewordPage } from '@webable/core';
import { aiBlockedUntil, aiState, aiStatus, classifyOpenAiFailure, markAiBlocked, markAiWorking } from './ai';
import {
  AI_PROBE_MODEL, DEEP_CACHE_TTL_MS, DEEP_ENABLED, DEEP_TIMEOUT_MS, LAYOUT_WAVE_MS, LLM_TIMEOUT_MS,
  COMPOSE_TIMEOUT_MS, OPENAI_SERVICE_TIER, READER_TIMEOUT_MS, REWORD_TIMEOUT_MS, openAiKey,
} from './config';
import { TtlLru } from './lru';
import {
  LAYOUT_INSTRUCTIONS, READER_INSTRUCTIONS, READER_POINT_KINDS, READER_SCHEMA,
  REWORD_INSTRUCTIONS, REWORD_SCHEMA, layoutInput, rewordInput, type ReaderOutput, type Stance,
  COMPOSE_INSTRUCTIONS, COMPOSE_SCHEMA, composeInput, type ComposeOutput,
} from './prompts';
import { recordOpenAiCall, recordOpenAiError } from './stats';
import { errorMessage, log, round } from './util';

/** $ per 1M tokens: input, cached input, output (standard tier). Fast (priority) costs 2x (2.5x for gpt-5.5). */
const PRICE: Record<string, [number, number, number]> = {
  'gpt-6.1-sol': [2, 0.1, 10],
  'gpt-6-sol': [2, 0.2, 10],
  'gpt-6-luna': [0.1, 0.01, 0.5],
  'gpt-5.5': [5, 0.5, 30],
  'gpt-5.4-mini': [0.75, 0.075, 4.5],
  'gpt-5.4-nano': [0.2, 0.02, 1.25],
};

/** Reasoning effort per model: none where the model allows it (gpt-6.1-sol has no 'none'). */
const EFFORT: Record<string, 'none' | 'low'> = {
  'gpt-6.1-sol': 'low',
  'gpt-6-sol': 'none',
  'gpt-6-luna': 'none',
  'gpt-5.4-mini': 'none',
};

let client: OpenAI | null = null;
function getClient(): OpenAI | null {
  const key = openAiKey();
  if (!key) return null;
  client ??= new OpenAI({ apiKey: key, maxRetries: 0, timeout: LLM_TIMEOUT_MS });
  return client;
}

/** True when a generative call could succeed right now (a key, credits, under the spend cap). */
export function openAiAvailable(): boolean {
  return aiStatus() === 'on';
}

/* ------------------------------------------------------------------ */
/* Availability: block on "no credits", probe again when the block ends */
/* ------------------------------------------------------------------ */

let watching = false;
let retryTimer: NodeJS.Timeout | null = null;

function scheduleRetry(minMs = 1_000): void {
  if (!watching) return;
  if (retryTimer) clearTimeout(retryTimer);
  const wait = Math.max(minMs, aiBlockedUntil() - Date.now() + 250);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void probeAi('retry');
  }, wait);
  retryTimer.unref();
}

/** A provider failure that means "no credits" or "key rejected" blocks AI; returns the reason, or null. */
function noteFailure(e: unknown, tag: string): 'no_credits' | 'key_rejected' | null {
  if (!(e instanceof OpenAI.APIError)) return null;
  const reason = classifyOpenAiFailure({ status: e.status ?? null, code: e.code ?? null, type: e.type ?? null, message: e.message });
  if (!reason) return null;
  const changed = markAiBlocked(reason);
  const s = aiState();
  if (changed) log('ai off', { reason, tag, status: e.status ?? null, code: e.code ?? null, retryAt: s.retryAt });
  else log('ai still off', { reason, tag, retryAt: s.retryAt });
  scheduleRetry();
  return reason;
}

function noteSuccess(tag: string): void {
  if (markAiWorking()) log('ai on again', { tag });
}

/**
 * The smallest billable call (16 output tokens on the cheapest model, about $0.00001): tells "no credits" from
 * "on". Never throws. Transient failures (network, a plain rate limit) leave the status as it is.
 */
export async function probeAi(why: string): Promise<ReturnType<typeof aiStatus>> {
  const c = getClient();
  if (!c) return aiStatus();
  const t0 = performance.now();
  try {
    const resp = await c.responses.create(
      { model: AI_PROBE_MODEL, input: 'Reply with the word ok.', max_output_tokens: 16, store: false },
      { timeout: 8_000, maxRetries: 0 },
    );
    const u = resp.usage;
    const costUsd = costOf(AI_PROBE_MODEL, resp.service_tier ?? null, u?.input_tokens ?? 0, u?.input_tokens_details?.cached_tokens ?? 0, u?.output_tokens ?? 0);
    recordOpenAiCall({
      model: AI_PROBE_MODEL, inputTokens: u?.input_tokens ?? 0, cachedTokens: u?.input_tokens_details?.cached_tokens ?? 0,
      outputTokens: u?.output_tokens ?? 0, costUsd, ms: round(performance.now() - t0),
    });
    noteSuccess(`probe/${why}`);
    log('ai probe', { why, status: 'on', ms: round(performance.now() - t0) });
  } catch (e) {
    const reason = noteFailure(e, `probe/${why}`);
    const status = e instanceof OpenAI.APIError ? e.status : undefined;
    if (!reason) log('ai probe', { why, status: 'unchanged', reason: status ? `http_${status}` : 'network', ms: round(performance.now() - t0) });
    // Still blocked and the check itself failed (network): look again in a minute, not in a loop.
    if (!reason && aiBlockedUntil() > 0) scheduleRetry(60_000);
  }
  return aiStatus();
}

/** Probe once at boot and again whenever a block ends. Returns a stop function. */
export function startAiWatch(): () => void {
  watching = true;
  if (openAiKey()) void probeAi('boot');
  else log('ai off', { reason: 'no_key' });
  return () => {
    watching = false;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };
}


export interface LlmOk<T> {
  ok: true;
  model: string;
  data: T;
  ms: number;
  costUsd: number;
  usage: { input: number; cached: number; output: number };
  tier: string | null;
}

export interface LlmFail {
  ok: false;
  model: string;
  ms: number;
  costUsd: number;
  error: string; // machine word + short reason, never content
}

export type LlmResult<T> = LlmOk<T> | LlmFail;

/** LlmFail errors that mean the account is unusable right now (no call was made, or OpenAI refused the account). */
export const UNAVAILABLE_ERRORS: ReadonlySet<string> = new Set(['no_key', 'budget', 'no_credits', 'key_rejected', 'unavailable']);

function costOf(model: string, tier: string | null, input: number, cached: number, output: number): number {
  const p = PRICE[model] ?? [5, 0.5, 30];
  // The served tier comes back as 'priority' or 'fast' depending on the model; both are the Fast tier.
  const fast = tier === 'priority' || tier === 'fast';
  const mult = fast ? (model === 'gpt-5.5' ? 2.5 : 2) : 1;
  return (mult * ((input - cached) * p[0] + cached * p[1] + output * p[2])) / 1e6;
}

interface JsonCall {
  model: string;
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  timeoutMs: number;
  cacheKey: string;
  tag: string;
  /** Reasoning effort for this call; without it, the model's default from EFFORT. */
  effort?: 'none' | 'low';
}

/** One strict-JSON Responses call. Never throws: failures come back as { ok: false }. */
export async function respondJson(p: JsonCall): Promise<LlmResult<unknown>> {
  const c = getClient();
  if (!c) return { ok: false, model: p.model, ms: 0, costUsd: 0, error: 'no_key' };
  const avail = aiState();
  if (avail.status !== 'on') {
    // No credits, key rejected or our spend cap: no call until the block ends (then it is tried again).
    return { ok: false, model: p.model, ms: 0, costUsd: 0, error: avail.reason ?? 'unavailable' };
  }
  let effort: 'none' | 'low' = p.effort ?? EFFORT[p.model] ?? 'none';
  const t0 = performance.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await c.responses.create(
        {
          model: p.model,
          instructions: p.instructions,
          input: p.input,
          text: { format: { type: 'json_schema', name: p.schemaName, strict: true, schema: p.schema } },
          reasoning: { effort },
          max_output_tokens: p.maxOutputTokens,
          store: false,
          prompt_cache_key: p.cacheKey,
          ...(OPENAI_SERVICE_TIER === 'priority' ? { service_tier: 'priority' as const } : {}),
        },
        { timeout: p.timeoutMs, maxRetries: 0 },
      );
      const ms = round(performance.now() - t0);
      const u = resp.usage;
      const input = u?.input_tokens ?? 0;
      const cached = u?.input_tokens_details?.cached_tokens ?? 0;
      const output = u?.output_tokens ?? 0;
      const tier = resp.service_tier ?? null;
      const costUsd = costOf(p.model, tier, input, cached, output);
      recordOpenAiCall({ model: p.model, inputTokens: input, cachedTokens: cached, outputTokens: output, costUsd, ms });
      log('openai', { tag: p.tag, model: p.model, ms, in: input, cached, out: output, tier, usd: costUsd.toFixed(5), status: resp.status });
      noteSuccess(p.tag);

      const refused = resp.output.some((o) => o.type === 'message' && o.content.some((part) => part.type === 'refusal'));
      if (refused) return { ok: false, model: p.model, ms, costUsd, error: 'refusal' };
      if (resp.status === 'incomplete') {
        return { ok: false, model: p.model, ms, costUsd, error: `incomplete:${resp.incomplete_details?.reason ?? 'unknown'}` };
      }
      const text = resp.output_text;
      if (!text) return { ok: false, model: p.model, ms, costUsd, error: 'empty' };
      try {
        return { ok: true, model: p.model, data: JSON.parse(text) as unknown, ms, costUsd, usage: { input, cached, output }, tier };
      } catch {
        return { ok: false, model: p.model, ms, costUsd, error: 'bad_json' };
      }
    } catch (e) {
      const ms = round(performance.now() - t0);
      const status = e instanceof OpenAI.APIError ? e.status : undefined;
      const msg = errorMessage(e);
      if (attempt === 0 && status === 400 && effort === 'none' && /reasoning|effort/i.test(msg)) {
        effort = 'low';
        continue;
      }
      const timedOut = e instanceof OpenAI.APIConnectionTimeoutError;
      // A dropped connection (a reused socket the other side had closed, a reset) fails before any work was billed:
      // try once more on a fresh connection, as the Jev client does.
      if (attempt === 0 && !timedOut && isConnectionDrop(e)) {
        log('openai retry', { tag: p.tag, model: p.model, why: connectionDetail(e), ms });
        continue;
      }
      recordOpenAiError();
      const blocked = noteFailure(e, p.tag);
      if (blocked) return { ok: false, model: p.model, ms, costUsd: 0, error: blocked };
      const kind = timedOut ? 'timeout' : status ? `http_${status}` : 'network';
      // A 400 explains a request-shape problem (schema, parameter); it never echoes the prompt, so keep a short
      // excerpt. A network failure logs its error class and socket code only.
      const detail = status === 400 ? msg.replace(/\s+/g, ' ').slice(0, 200) : !status ? connectionDetail(e) : undefined;
      log('openai error', { tag: p.tag, model: p.model, kind, ms, detail });
      return { ok: false, model: p.model, ms, costUsd: 0, error: kind };
    }
  }
  return { ok: false, model: p.model, ms: round(performance.now() - t0), costUsd: 0, error: 'unreachable' };
}

/** A connection that failed or dropped before an answer (not a timeout, not an HTTP status). */
export function isConnectionDrop(e: unknown): boolean {
  if (e instanceof OpenAI.APIConnectionTimeoutError) return false;
  if (e instanceof OpenAI.APIConnectionError) return true;
  return e instanceof TypeError && /fetch failed|terminated|socket|ECONNRESET|EPIPE/i.test(`${e.message} ${String((e as { cause?: unknown }).cause ?? '')}`);
}

/** Error class and socket codes only (never a request or response body). */
export function connectionDetail(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i++) {
    const x = cur as { name?: unknown; code?: unknown; constructor?: { name?: string } };
    const name = typeof x.name === 'string' ? x.name : x.constructor?.name;
    parts.push([name, typeof x.code === 'string' ? x.code : null].filter(Boolean).join(':'));
    cur = (cur as { cause?: unknown }).cause;
  }
  return parts.filter(Boolean).join('<').slice(0, 120) || 'unknown';
}

/* ------------------------------------------------------------------ */
/* Layout candidates                                                   */
/* ------------------------------------------------------------------ */

export const CANDIDATE_STANCES = ['focus', 'guided', 'overview'] as const;
export type CandidateStance = (typeof CANDIDATE_STANCES)[number];

export interface RawCandidate {
  stance: Stance;
  result: LlmResult<unknown>;
}

/**
 * Three stance calls in parallel on LAYOUT_MODEL (12 s timeout each). After `waveMs`, the wave returns whatever
 * has arrived as long as one candidate is usable; otherwise it waits for the stragglers. Failures are kept.
 */
export async function layoutCandidates(
  fitText: string,
  outlineText: string,
  schema: Record<string, unknown>,
  waveMs = LAYOUT_WAVE_MS,
): Promise<RawCandidate[]> {
  const done: RawCandidate[] = [];
  const all = Promise.all(
    CANDIDATE_STANCES.map(async (stance) => {
      const result = await respondJson({
        model: LAYOUT_MODEL,
        instructions: LAYOUT_INSTRUCTIONS,
        input: layoutInput(fitText, stance, outlineText),
        schemaName: 'fitspec',
        schema,
        maxOutputTokens: 2_000,
        timeoutMs: LLM_TIMEOUT_MS,
        cacheKey: 'wa-fitspec-v2',
        tag: `layout/${stance}`,
      });
      done.push({ stance, result });
    }),
  );
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      if (done.some((d) => d.result.ok)) resolve();
      else void all.then(() => resolve());
    }, waveMs);
  });
  await Promise.race([all.then(() => undefined), deadline]);
  clearTimeout(timer);
  const order = (s: Stance) => CANDIDATE_STANCES.indexOf(s as CandidateStance);
  return [...done].sort((a, b) => order(a.stance) - order(b.stance));
}

/* ------------------------------------------------------------------ */
/* Deep layout: background job, cached by outline hash for the next visit */
/* ------------------------------------------------------------------ */

interface DeepEntry {
  data: unknown;
  ms: number;
  costUsd: number;
  model: string;
}

const deepCache = new TtlLru<DeepEntry>(200, DEEP_CACHE_TTL_MS);
const deepRunning = new Set<string>();

export function deepEnabled(): boolean {
  return DEEP_ENABLED && openAiAvailable();
}

export function getDeepLayout(key: string): DeepEntry | undefined {
  return deepCache.get(key);
}

/** Start the deep layout for this outline once; not awaited. Returns true when a job started. */
export function startDeepLayout(key: string, fitText: string, outlineText: string, schema: Record<string, unknown>): boolean {
  if (!deepEnabled() || deepRunning.has(key) || deepCache.has(key)) return false;
  deepRunning.add(key);
  void respondJson({
    model: DEEP_LAYOUT_MODEL,
    instructions: LAYOUT_INSTRUCTIONS,
    input: layoutInput(fitText, 'deep', outlineText),
    schemaName: 'fitspec',
    schema,
    maxOutputTokens: 4_000,
    timeoutMs: DEEP_TIMEOUT_MS,
    cacheKey: 'wa-fitspec-v2',
    tag: 'layout/deep',
  })
    .then((r) => {
      if (r.ok) deepCache.set(key, { data: r.data, ms: r.ms, costUsd: r.costUsd, model: r.model });
    })
    .finally(() => deepRunning.delete(key));
  return true;
}

/* ------------------------------------------------------------------ */
/* Round 9: the reader (from the person's AI answer) and the rewriter   */
/* ------------------------------------------------------------------ */

function asReaderOutput(data: unknown): ReaderOutput | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.points)) return null;
  const points = d.points
    .filter((p): p is { kind: string; says: string; evidence: string } =>
      !!p && typeof p === 'object' && typeof (p as { says?: unknown }).says === 'string' && typeof (p as { evidence?: unknown }).evidence === 'string' && typeof (p as { kind?: unknown }).kind === 'string')
    .filter((p) => (READER_POINT_KINDS as readonly string[]).includes(p.kind) && p.says.trim() !== '')
    .map((p) => ({ kind: p.kind as ReaderOutput['points'][number]['kind'], says: p.says.trim(), evidence: p.evidence.trim() }));
  if (points.length === 0) return null;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
  return {
    points,
    level: pick(d.level, ['plain', 'everyday', 'expert'] as const, 'everyday'),
    length: pick(d.length, ['shorter', 'as_is'] as const, 'as_is'),
    shape: pick(d.shape, ['steps', 'bullets', 'prose'] as const, 'prose'),
    answer_first: d.answer_first === true,
    headline: typeof d.headline === 'string' ? d.headline.trim() : '',
    source_guess: typeof d.source_guess === 'string' ? d.source_guess : 'your AI',
  };
}

/** READER_MODEL breaks the AI answer into points; EXPLAIN_MODEL is the fallback. The model sees only the answer. */
export async function readerFromAnswer(answer: string): Promise<LlmResult<ReaderOutput>> {
  let spent = 0;
  let last: LlmFail | null = null;
  for (const model of [READER_MODEL, EXPLAIN_MODEL]) {
    const r = await respondJson({
      model,
      instructions: READER_INSTRUCTIONS,
      input: `AI ANSWER\n${answer}`,
      schemaName: 'reader',
      schema: READER_SCHEMA,
      maxOutputTokens: 1_600,
      timeoutMs: READER_TIMEOUT_MS,
      cacheKey: 'wa-reader-v1',
      tag: 'reader',
    });
    spent += r.costUsd;
    if (r.ok) {
      const out = asReaderOutput(r.data);
      if (out) return { ...r, data: out, costUsd: spent };
      last = { ok: false, model, ms: r.ms, costUsd: spent, error: 'bad_shape' };
    } else {
      last = { ...r, costUsd: spent };
      if (UNAVAILABLE_ERRORS.has(r.error)) break;
    }
  }
  return last ?? { ok: false, model: READER_MODEL, ms: 0, costUsd: spent, error: 'unknown' };
}

function asRewordOut(data: unknown): RewordOut | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.lead !== 'string') return null;
  const items = Array.isArray(d.items) ? d.items.filter((x): x is string => typeof x === 'string') : [];
  return { lead: d.lead, items, ordered: d.ordered === true };
}

/** REWORD_MODEL rewrites one paragraph in the given way. `retry` names what was wrong with the last try; `links` the words at each marker. */
export async function rewordParagraph(
  brief: string, level: ReaderProfile['level'], page: RewordPage, kind: RewordKind, text: string, retry?: string,
  links?: Record<string, string> | null,
): Promise<LlmResult<RewordOut>> {
  const r = await respondJson({
    model: REWORD_MODEL,
    instructions: REWORD_INSTRUCTIONS,
    input: rewordInput(brief, level, page, kind, text, retry, links),
    schemaName: 'reword',
    schema: REWORD_SCHEMA,
    // Low effort: measured rewrites changed 21-55% of the wording vs 4-27% (near copies) at none, about 0.3 s slower.
    effort: 'low',
    maxOutputTokens: 2_000,
    timeoutMs: REWORD_TIMEOUT_MS,
    cacheKey: 'wa-reword-v1',
    tag: `reword/${kind}`,
  });
  if (!r.ok) return r;
  const out = asRewordOut(r.data);
  return out ? { ...r, data: out } : { ok: false, model: r.model, ms: r.ms, costUsd: r.costUsd, error: 'bad_shape' };
}

/** COMPOSE_MODEL lays out one group as blocks (data only). `retry` names what was wrong with the last try. */
export async function composeGroup(
  brief: string, leaning: string, level: ReaderProfile['level'], page: RewordPage, group: ComposeGroupIn, retry?: string,
): Promise<LlmResult<ComposeOutput>> {
  const r = await respondJson({
    model: COMPOSE_MODEL,
    instructions: COMPOSE_INSTRUCTIONS,
    input: composeInput(brief, leaning, level, page, group, retry),
    schemaName: 'compose',
    schema: COMPOSE_SCHEMA,
    // Low effort, as round 9's writer: plainer wording and better choices than none for a few hundred ms.
    effort: 'low',
    maxOutputTokens: 4_000,
    timeoutMs: COMPOSE_TIMEOUT_MS,
    cacheKey: 'wa-compose-v1',
    tag: 'compose',
  });
  if (!r.ok) return r;
  const d = r.data as Record<string, unknown> | null;
  if (!d || typeof d !== 'object' || !Array.isArray(d.blocks)) return { ok: false, model: r.model, ms: r.ms, costUsd: r.costUsd, error: 'bad_shape' };
  return { ...r, data: { keep_page_text: d.keep_page_text === true, blocks: d.blocks } };
}
