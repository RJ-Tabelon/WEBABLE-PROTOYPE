// Running totals for /v1/stats. Jev `calls`, `decisions`, tokens and $ count real (live) decision calls only;
// answers served from the cache and connection warm-ups are counted separately.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { median, round } from './util';

const WINDOW = 200;

interface JevTotals {
  calls: number; // live decision calls (warm-ups and cache hits excluded)
  cacheHits: number; // calls answered from the cache
  cachedDecisions: number; // answers served from the cache
  warmups: number;
  warmupUsd: number;
  decisions: number; // typed answers received live (questions answered)
  inputTokens: number;
  costUsd: number;
  errors: number;
  retries: number;
  wallMs: number[];
  serverMs: number[];
  lastModel: string | null;
}

interface ModelTotals {
  calls: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number[];
}

interface OpenAiTotals {
  calls: number;
  errors: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
  byModel: Record<string, ModelTotals>;
}

interface RouteTotals {
  count: number;
  errors: number;
  ms: number[];
}

const startedAt = new Date().toISOString();
const jev: JevTotals = {
  calls: 0, cacheHits: 0, cachedDecisions: 0, warmups: 0, warmupUsd: 0, decisions: 0, inputTokens: 0, costUsd: 0, errors: 0, retries: 0, wallMs: [], serverMs: [], lastModel: null,
};
const openai: OpenAiTotals = { calls: 0, errors: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0, byModel: {} };
const routes: Record<string, RouteTotals> = {};

function push(arr: number[], v: number): void {
  arr.push(v);
  if (arr.length > WINDOW) arr.shift();
}

export function recordJevCall(c: {
  questions: number; inputTokens: number; costUsd: number; wallMs: number; serverMs: number | null; model: string; retries: number; warmup?: boolean;
}): void {
  if (c.warmup) {
    jev.warmups++;
    jev.warmupUsd += c.costUsd;
    return;
  }
  jev.calls++;
  jev.decisions += c.questions;
  jev.inputTokens += c.inputTokens;
  jev.costUsd += c.costUsd;
  jev.retries += c.retries;
  jev.lastModel = c.model;
  push(jev.wallMs, c.wallMs);
  if (c.serverMs !== null) push(jev.serverMs, c.serverMs);
}

export function recordJevCacheHit(questions = 0): void {
  jev.cacheHits++;
  jev.cachedDecisions += questions;
}

export function recordJevError(): void {
  jev.errors++;
}

/** Local calendar day, e.g. '2026-10-24' (the daily budget resets at local midnight). */
export function dayKey(now = Date.now()): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Generative spend per local day (only today and yesterday are kept). */
const spentByDay = new Map<string, number>();

/**
 * Today's spend survives a server restart (a small JSON file in the OS temp folder; WEBABLE_SPEND_FILE='' turns it
 * off). Tests never read or write it.
 */
const SPEND_FILE = process.env.VITEST ? '' : (process.env.WEBABLE_SPEND_FILE ?? join(tmpdir(), 'webable-openai-spend.json'));

function loadSpend(): void {
  if (!SPEND_FILE) return;
  try {
    const j = JSON.parse(readFileSync(SPEND_FILE, 'utf8')) as { day?: unknown; usd?: unknown };
    if (j.day === dayKey() && typeof j.usd === 'number' && Number.isFinite(j.usd) && j.usd >= 0) spentByDay.set(j.day, j.usd);
  } catch {
    // no file yet, or unreadable: start the day at $0
  }
}

function saveSpend(day: string): void {
  if (!SPEND_FILE) return;
  try {
    writeFileSync(SPEND_FILE, JSON.stringify({ day, usd: round(spentByDay.get(day) ?? 0, 6) }));
  } catch {
    // best effort
  }
}
loadSpend();

export function recordOpenAiCall(c: { model: string; inputTokens: number; cachedTokens: number; outputTokens: number; costUsd: number; ms: number }): void {
  const day = dayKey();
  spentByDay.set(day, (spentByDay.get(day) ?? 0) + c.costUsd);
  if (spentByDay.size > 2) for (const k of [...spentByDay.keys()].sort().slice(0, spentByDay.size - 2)) spentByDay.delete(k);
  saveSpend(day);
  openai.calls++;
  openai.inputTokens += c.inputTokens;
  openai.cachedTokens += c.cachedTokens;
  openai.outputTokens += c.outputTokens;
  openai.costUsd += c.costUsd;
  const m = (openai.byModel[c.model] ??= { calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0, ms: [] });
  m.calls++;
  m.inputTokens += c.inputTokens;
  m.cachedTokens += c.cachedTokens;
  m.outputTokens += c.outputTokens;
  m.costUsd += c.costUsd;
  push(m.ms, c.ms);
}

export function recordOpenAiError(): void {
  openai.errors++;
}

/** Generative spend since this server started. */
export function openAiSpentUsd(): number {
  return openai.costUsd;
}

/** Generative spend today (local day); the daily budget is checked against this. */
export function openAiSpentTodayUsd(now = Date.now()): number {
  return spentByDay.get(dayKey(now)) ?? 0;
}

/** For tests: forget today's spend. */
export function resetDailySpend(): void {
  spentByDay.clear();
}

export function recordRoute(route: string, status: number, ms: number): void {
  const r = (routes[route] ??= { count: 0, errors: 0, ms: [] });
  r.count++;
  if (status >= 400) r.errors++;
  push(r.ms, ms);
}

export function statsSnapshot() {
  const ms = (xs: number[]) => {
    const m = median(xs);
    return m === null ? null : round(m);
  };
  return {
    startedAt,
    uptimeSec: round(process.uptime()),
    jev: {
      model: jev.lastModel,
      calls: jev.calls,
      decisions: jev.decisions,
      inputTokens: jev.inputTokens,
      costUsd: round(jev.costUsd, 6),
      cacheHits: jev.cacheHits,
      cache: { calls: jev.cacheHits, decisions: jev.cachedDecisions },
      warmups: { calls: jev.warmups, costUsd: round(jev.warmupUsd, 6) },
      errors: jev.errors,
      retries: jev.retries,
      wallMsP50: ms(jev.wallMs),
      serverMsP50: ms(jev.serverMs),
    },
    openai: {
      calls: openai.calls,
      errors: openai.errors,
      inputTokens: openai.inputTokens,
      cachedTokens: openai.cachedTokens,
      outputTokens: openai.outputTokens,
      costUsd: round(openai.costUsd, 5),
      todayUsd: round(openAiSpentTodayUsd(), 5),
      byModel: Object.fromEntries(
        Object.entries(openai.byModel).map(([k, v]) => [
          k,
          { calls: v.calls, inputTokens: v.inputTokens, cachedTokens: v.cachedTokens, outputTokens: v.outputTokens, costUsd: round(v.costUsd, 5), msP50: ms(v.ms) },
        ]),
      ),
    },
    routes: Object.fromEntries(Object.entries(routes).map(([k, v]) => [k, { count: v.count, errors: v.errors, msP50: ms(v.ms) }])),
    totalUsd: round(jev.costUsd + jev.warmupUsd + openai.costUsd, 5),
  };
}
