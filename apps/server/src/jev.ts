// Jev System One client. One keep-alive connection (Node's global fetch), model pinned to JEV_MODEL,
// 5 s per attempt, retries 429/529 with jitter, fails closed (throws; callers make no Jev-driven change).
// Answers are cached by sha256(model + canonical state/questions) for 30 minutes.
import { gzipSync } from 'node:zlib';
import { JEV_MODEL, JEV_USD_PER_INPUT_TOKEN, metricsFrom } from '@webable/core';
import type { JevMetrics, JevQuestion, JevResponse } from '@webable/core';
import {
  JEV_CACHE_MAX, JEV_CACHE_TTL_MS, JEV_GZIP_MIN_BYTES, JEV_MAX_RETRIES, JEV_MODELS_URL, JEV_TIMEOUT_MS, JEV_URL, jevKey,
} from './config';
import { TtlLru } from './lru';
import { recordJevCacheHit, recordJevCall, recordJevError } from './stats';
import { canonicalJson, errorMessage, log, round, sha256, sleep } from './util';

export interface JevCall {
  state: unknown;
  questions: Record<string, JevQuestion>;
  assets?: Record<string, unknown>;
}

export interface JevResult {
  body: JevResponse;
  wallMs: number;
  serverMs: number | null;
  questions: number;
  cached: boolean;
  retries: number;
}

export type JevErrorKind = 'no_key' | 'timeout' | 'network' | 'http' | 'bad_response';

export class JevError extends Error {
  constructor(
    readonly kind: JevErrorKind,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'JevError';
  }
}

export interface AskOptions {
  /** Short label for logs, e.g. 'understand/1'. */
  tag: string;
  /** Image call: adds the Danger Zone header and skips the cache. */
  images?: boolean;
  /** Skip the cache for this call (the answer is still stored). */
  fresh?: boolean;
  timeoutMs?: number;
  /** Warm-up calls cost money but are not decisions. */
  warmup?: boolean;
}

type Cached = Omit<JevResult, 'cached' | 'retries'>;

const cache = new TtlLru<Cached>(JEV_CACHE_MAX, JEV_CACHE_TTL_MS);
let gzipOk = JEV_GZIP_MIN_BYTES > 0;
let lastOkAt: number | null = null;
let lastCallAt: number | null = null;
let lastError: string | null = null;
let modelWarned = false;
let lastServedModel: string | null = null;

export function jevHealth(): { warm: boolean; model: string; served: string | null; lastOkAt: string | null; lastError: string | null; key: boolean } {
  return {
    warm: lastOkAt !== null && Date.now() - lastOkAt < 10 * 60_000,
    model: JEV_MODEL,
    served: lastServedModel,
    lastOkAt: lastOkAt ? new Date(lastOkAt).toISOString() : null,
    lastError,
    key: jevKey() !== null,
  };
}

export function jevCacheInfo(): { size: number; hits: number; misses: number; ttlMs: number } {
  return { size: cache.size, hits: cache.hits, misses: cache.misses, ttlMs: JEV_CACHE_TTL_MS };
}

/** Ask one batch of questions. Throws JevError on any failure. */
export async function askJev(call: JevCall, opts: AskOptions): Promise<JevResult> {
  const questions = Object.keys(call.questions).length;
  if (questions === 0) throw new JevError('bad_response', null, 'no questions to ask');
  if (opts.images) {
    const r = await send(call, opts);
    return { ...r.result, cached: false, retries: r.retries };
  }
  const key = sha256(JEV_MODEL + '\u0000' + canonicalJson({ state: call.state, questions: call.questions }));
  let retries = 0;
  const { value, fromCache } = await cache.getOrMake(
    key,
    async () => {
      const r = await send(call, opts);
      retries = r.retries;
      return r.result;
    },
    { fresh: opts.fresh },
  );
  if (fromCache) recordJevCacheHit(questions);
  return { ...value, cached: fromCache, retries };
}

/** Ask several batches in parallel (answers are batch-invariant in design B). Any failure fails the whole set. */
export async function askJevAll(calls: JevCall[], opts: AskOptions): Promise<JevResult[]> {
  return Promise.all(calls.map((c, i) => askJev(c, { ...opts, tag: `${opts.tag}/${i + 1}` })));
}

/** Combined metrics for a set of calls, through core's metricsFrom. */
export function jevMetrics(results: JevResult[]): JevMetrics {
  return metricsFrom(results.map((r) => ({ body: r.body, wallMs: r.wallMs, serverMs: r.serverMs, questions: r.questions })));
}

/** Metrics for "no Jev call happened" (e.g. nothing to judge). */
export function emptyJevMetrics(): JevMetrics {
  return { model: JEV_MODEL, calls: 0, questions: 0, inputTokens: 0, wallMs: 0, serverMs: null, costUsd: 0 };
}

async function send(call: JevCall, opts: AskOptions): Promise<{ result: Cached; retries: number }> {
  const key = jevKey();
  if (!key) {
    recordJevError();
    throw new JevError('no_key', null, 'TYPESAFE_API_KEY is not set');
  }
  const payload: Record<string, unknown> = { model: JEV_MODEL, state: call.state, questions: call.questions };
  if (call.assets && Object.keys(call.assets).length) payload.assets = call.assets;
  const json = JSON.stringify(payload);
  const questions = Object.keys(call.questions);
  const timeoutMs = opts.timeoutMs ?? JEV_TIMEOUT_MS;

  let retries = 0;
  let networkRetried = false;
  let useGzip = gzipOk && !opts.images && Buffer.byteLength(json) >= JEV_GZIP_MIN_BYTES;
  for (;;) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (opts.images) headers['TypeSafe-Danger-Zone-Images'] = 'true';
    let body: string | ArrayBuffer = json;
    if (useGzip) {
      const gz = gzipSync(json);
      body = gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer;
    }
    if (useGzip) headers['Content-Encoding'] = 'gzip';

    const t0 = performance.now();
    lastCallAt = Date.now();
    let res: Response;
    let text: string;
    try {
      res = await fetch(JEV_URL, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) });
      text = await res.text();
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      if (!timedOut && !networkRetried) {
        // A stale keep-alive socket fails fast; one immediate retry on a fresh connection.
        networkRetried = true;
        retries++;
        continue;
      }
      recordJevError();
      lastError = timedOut ? 'timeout' : 'network';
      log('jev error', { tag: opts.tag, kind: lastError, ms: round(performance.now() - t0) });
      throw new JevError(timedOut ? 'timeout' : 'network', null, timedOut ? `Jev did not answer within ${timeoutMs} ms` : `Jev request failed: ${errorMessage(e)}`);
    }
    const wallMs = performance.now() - t0;
    const serverHeader = res.headers.get('x-envoy-upstream-service-time');
    const serverMs = serverHeader !== null && serverHeader.trim() !== '' && Number.isFinite(Number(serverHeader)) ? Number(serverHeader) : null;

    if (res.status === 415 && useGzip) {
      gzipOk = false;
      useGzip = false;
      log('jev gzip refused; sending uncompressed from now on');
      continue;
    }
    if ((res.status === 429 || res.status === 529) && retries < JEV_MAX_RETRIES) {
      retries++;
      const after = Number(res.headers.get('retry-after'));
      const base = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 2000) : 250 * 2 ** (retries - 1);
      await sleep(base + Math.random() * 250);
      continue;
    }
    if (res.status >= 500 && res.status !== 529 && retries === 0) {
      retries++;
      await sleep(150 + Math.random() * 150);
      continue;
    }
    if (!res.ok) {
      recordJevError();
      lastError = `http ${res.status}`;
      log('jev error', { tag: opts.tag, status: res.status, ms: round(wallMs), detail: safeErrorDetail(text) });
      throw new JevError('http', res.status, `Jev answered ${res.status}`);
    }

    let parsed: JevResponse;
    try {
      parsed = JSON.parse(text) as JevResponse;
    } catch {
      recordJevError();
      lastError = 'bad json';
      throw new JevError('bad_response', res.status, 'Jev answered with invalid JSON');
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.answers || typeof parsed.answers !== 'object') {
      recordJevError();
      lastError = 'no answers';
      throw new JevError('bad_response', res.status, 'Jev answer has no answers');
    }
    const missing = questions.filter((q) => !(q in parsed.answers));
    if (missing.length) {
      recordJevError();
      lastError = 'missing answers';
      throw new JevError('bad_response', res.status, `Jev answer is missing ${missing.length} of ${questions.length} questions`);
    }
    parsed.usage ??= { input_tokens: 0, output_tokens: 0 };
    lastOkAt = Date.now();
    lastError = null;
    lastServedModel = parsed.model ?? null;
    if (parsed.model && parsed.model !== JEV_MODEL && !modelWarned) {
      modelWarned = true;
      log('jev model differs from the pinned one', { pinned: JEV_MODEL, served: parsed.model });
    }
    const inputTokens = parsed.usage.input_tokens ?? 0;
    const costUsd = inputTokens * JEV_USD_PER_INPUT_TOKEN;
    recordJevCall({
      questions: opts.warmup ? 0 : questions.length,
      inputTokens,
      costUsd,
      wallMs,
      serverMs,
      model: parsed.model ?? JEV_MODEL,
      retries,
      warmup: opts.warmup,
    });
    log('jev', {
      tag: opts.tag,
      q: questions.length,
      tok: inputTokens,
      ms: round(wallMs),
      server: serverMs,
      usd: costUsd.toFixed(6),
      gzip: useGzip || undefined,
      img: opts.images || undefined,
      retries: retries || undefined,
    });
    return { result: { body: parsed, wallMs: round(wallMs, 1), serverMs, questions: questions.length }, retries };
  }
}

/** Jev error bodies describe the request field at fault; keep only a short, single-line excerpt. */
function safeErrorDetail(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 160);
}

/**
 * Node's fetch (undici) closes idle sockets after 4 s, so a page view 5 s after the last call paid for a new TLS
 * connection (measured 240-490 ms vs 110-150 ms warm). Jev sits behind Cloudflare, which keeps idle connections
 * far longer, so swap the global agent for one with a 60 s idle timeout (measured: 6 s and 15 s gaps stay warm).
 * Uses undici's documented global-dispatcher symbol; if the shape is unexpected, nothing changes.
 */
const DISPATCHER = Symbol.for('undici.globalDispatcher.1');
let keepAliveExtended = false;
function extendKeepAlive(): void {
  if (keepAliveExtended) return;
  const g = globalThis as unknown as Record<symbol, unknown>;
  const current = g[DISPATCHER];
  if (!current || typeof current !== 'object') return;
  const Ctor = (current as { constructor?: unknown }).constructor;
  if (typeof Ctor !== 'function' || Ctor.name !== 'Agent') return;
  try {
    g[DISPATCHER] = new (Ctor as new (opts: Record<string, number>) => unknown)({ keepAliveTimeout: 60_000, keepAliveMaxTimeout: 600_000 });
    keepAliveExtended = true;
  } catch {
    // keep the default agent
  }
}

/** One tiny call at boot so the first real page view does not pay for DNS, TLS and a cold route. */
export async function warmJev(): Promise<{ ok: boolean; ms: number | null; serverMs: number | null }> {
  const key = jevKey();
  if (!key) return { ok: false, ms: null, serverMs: null };
  try {
    // A free request creates fetch's global agent, which we then replace with a longer-lived one.
    await fetch(JEV_MODELS_URL, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(3_000) })
      .then((r) => r.arrayBuffer())
      .catch(() => undefined);
    extendKeepAlive();
  } catch {
    // warm-up is best effort
  }
  try {
    const r = await askJev(
      {
        state: { note: 'Connection warm-up from the WebAble server. No page data.' },
        questions: { ready: { type: 'noul', instructions: 'Is `note` a warm-up message?' } },
      },
      { tag: 'warmup', fresh: true, warmup: true },
    );
    return { ok: true, ms: r.wallMs, serverMs: r.serverMs };
  } catch (e) {
    log('jev warm-up failed', { error: e instanceof JevError ? e.kind : 'unknown' });
    return { ok: false, ms: null, serverMs: null };
  }
}

/**
 * Keep the TLS connection to Jev warm while WebAble is in use: a free GET /v1/models every `everyMs`
 * as long as a real call happened in the last `activeMs`. Returns a stop function.
 */
export function startKeepWarm(everyMs = 20_000, activeMs = 15 * 60_000): () => void {
  const timer = setInterval(() => {
    const key = jevKey();
    if (!key || lastCallAt === null || Date.now() - lastCallAt > activeMs) return;
    fetch(JEV_MODELS_URL, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(3_000) })
      .then((r) => r.arrayBuffer())
      .catch(() => undefined);
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
