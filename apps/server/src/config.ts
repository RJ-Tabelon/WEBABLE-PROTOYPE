// Server configuration. Keys are read from process.env at call time and never logged or returned.

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

export const HOST = '127.0.0.1';
export const PORT = num('PORT', 41741);

/*
 * Public deployment (a hosted server, e.g. on Vercel). All of this is off unless WEBABLE_PUBLIC=1, so a local
 * run behaves exactly as before. Read at call time so tests can switch it.
 *   WEBABLE_PUBLIC=1      answer on the deployment's own host names, refuse POSTs with no Origin, limit each IP.
 *   WEBABLE_HOSTS         extra host names to answer on (comma-separated, e.g. the production alias).
 *   ALLOWED_ORIGINS       extra browser origins allowed to call (comma-separated exact origins); honoured locally too.
 *   RATE_LIMIT_PER_MIN    POSTs per IP per minute when public (default 120; 0 turns it off).
 *   RATE_LIMIT_PER_HOUR   POSTs per IP per hour when public (default 1500; 0 turns it off).
 */
export function publicMode(): boolean {
  return process.env.WEBABLE_PUBLIC === '1';
}

export function envList(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function rateLimits(): { perMin: number; perHour: number } {
  return { perMin: num('RATE_LIMIT_PER_MIN', 120), perHour: num('RATE_LIMIT_PER_HOUR', 1500) };
}

export const JEV_URL = process.env.JEV_URL ?? 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODELS_URL = process.env.JEV_MODELS_URL ?? 'https://api.typesafe.ai/v1/models';
/** Per-attempt timeout for one Jev request. */
export const JEV_TIMEOUT_MS = num('JEV_TIMEOUT_MS', 5_000);
/** Retries on 429/529 (with jitter). */
export const JEV_MAX_RETRIES = 2;
/** Answer cache lifetime; 0 turns the cache off (for a demo that must show live calls). */
export const JEV_CACHE_TTL_MS = num('JEV_CACHE_TTL_MS', 30 * 60_000);
export const JEV_CACHE_MAX = 500;
/** Compress Jev request bodies at or above this size (gzip). 0 turns compression off. */
export const JEV_GZIP_MIN_BYTES = num('JEV_GZIP_MIN_BYTES', 48 * 1024);

export const LLM_TIMEOUT_MS = num('LLM_TIMEOUT_MS', 12_000);
/** After this, the candidate wave is judged with whatever has arrived (at least one usable candidate). */
export const LAYOUT_WAVE_MS = num('LAYOUT_WAVE_MS', 8_000);
export const DEEP_TIMEOUT_MS = num('DEEP_TIMEOUT_MS', 40_000);
/** Background deep layout job (gpt-6.1-sol) cached for the next visit. Off by default (up to $0.08 a page); WEBABLE_DEEP=1 turns it on. */
export const DEEP_ENABLED = process.env.WEBABLE_DEEP === '1';
/** After OpenAI says "no credits" (or rejects the key), AI stays off this long, then is tried again. */
export const AI_BLOCK_MS = num('AI_BLOCK_MS', 10 * 60_000);
/** The cheap call that checks whether OpenAI answers again (at boot and when a block ends). */
export const AI_PROBE_MODEL = process.env.AI_PROBE_MODEL ?? 'gpt-6-luna';
export const DEEP_CACHE_TTL_MS = num('DEEP_CACHE_TTL_MS', 6 * 60 * 60_000);
export const REDESIGN_CACHE_TTL_MS = num('REDESIGN_CACHE_TTL_MS', 30 * 60_000);
/**
 * Daily cap on generative spend (OpenAI), per local calendar day. Past it, AI is off until midnight: layouts are
 * judged from the local candidates and pages keep their own words. Jev spend is not counted here.
 */
export const OPENAI_BUDGET_USD = num('OPENAI_BUDGET_USD', 5);
/** 'priority' is OpenAI's Fast tier (measured 3.4 s vs 5.0 s p50 for gpt-6-sol). */
export const OPENAI_SERVICE_TIER: 'priority' | 'default' = process.env.OPENAI_SERVICE_TIER === 'default' ? 'default' : 'priority';

/** Body limit for every request (screenshots for the visual check are the largest). */
export const BODY_LIMIT_BYTES = 8 * 1024 * 1024;

export function jevKey(): string | null {
  const k = process.env.TYPESAFE_API_KEY;
  return k && k.trim() ? k.trim() : null;
}

export function openAiKey(): string | null {
  const k = process.env.OPENAI_API_KEY;
  return k && k.trim() ? k.trim() : null;
}

/** Round 9: breaking the person's AI answer down (READER_MODEL, once per import). */
export const READER_TIMEOUT_MS = num('READER_TIMEOUT_MS', 25_000);
/** Round 9: one paragraph rewrite (REWORD_MODEL); the extension shows the page's own words when it is late. */
export const REWORD_TIMEOUT_MS = num('REWORD_TIMEOUT_MS', 8_000);
/** Round 10: one group laid out as components (COMPOSE_MODEL); the WebAble page keeps the page's own words when late. */
export const COMPOSE_TIMEOUT_MS = num('COMPOSE_TIMEOUT_MS', 8_000);
