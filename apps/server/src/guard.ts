// Request guards: loopback Host only (defeats DNS rebinding), browser origins limited to the extension and
// local pages, JSON-only POSTs (so any other web page needs a preflight we never grant).
// On a public deployment (WEBABLE_PUBLIC=1, see config.ts) the deployment's own host names are accepted too,
// POSTs must carry an allowed Origin, and each IP gets a request limit. ALLOWED_ORIGINS adds exact origins in both.
import type { Context, MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { PORT, envList, publicMode, rateLimits } from './config';

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
const ORIGIN_OK = [/^chrome-extension:\/\/[a-z0-9]{1,64}$/i, /^http:\/\/127\.0\.0\.1(?::\d{1,5})?$/];

/** Host names a public deployment answers on: WEBABLE_HOSTS plus the names Vercel gives this deployment. */
function publicHosts(): Set<string> {
  const vercel = [process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_URL];
  return new Set([...envList('WEBABLE_HOSTS'), ...vercel.filter((h): h is string => !!h).map((h) => h.toLowerCase())]);
}

export function hostAllowed(host: string | undefined | null): boolean {
  if (host === undefined || host === null) return true; // in-process calls (tests, dev check)
  const h = host.toLowerCase();
  if (ALLOWED_HOSTS.has(h)) return true;
  return publicMode() && publicHosts().has(h);
}

export function originAllowed(origin: string | undefined | null): boolean {
  // Locally: non-browser callers (the dev check, curl, the eval harness). Public: a POST must say where it is from.
  if (!origin) return !publicMode();
  if (ORIGIN_OK.some((re) => re.test(origin))) return true;
  return envList('ALLOWED_ORIGINS').includes(origin.toLowerCase());
}

export const hostGuard: MiddlewareHandler = async (c, next) => {
  if (!hostAllowed(c.req.header('host'))) {
    return c.json({ error: 'bad_host', message: publicMode() ? 'This server does not answer on this address.' : 'This server only answers on 127.0.0.1.' }, 403);
  }
  await next();
};

export const originGuard: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.method !== 'OPTIONS') {
    if (!originAllowed(c.req.header('origin'))) {
      return c.json({ error: 'bad_origin', message: 'Requests are accepted from the WebAble extension only.' }, 403);
    }
    const type = c.req.header('content-type') ?? '';
    if (!/^application\/json\b/i.test(type)) {
      return c.json({ error: 'bad_content_type', message: 'Send JSON (Content-Type: application/json).' }, 415);
    }
  }
  await next();
};

/**
 * Per-IP POST limit on a public deployment: fixed one-minute and one-hour windows, in memory. On serverless each
 * instance keeps its own counts, so this is a brake on one noisy caller, not an exact quota.
 */
const hits = new Map<string, { min: number; nMin: number; hour: number; nHour: number }>();

function clientIp(c: Context): string {
  // Vercel sets x-real-ip and overwrites x-forwarded-for with the caller's address, so neither can be spoofed there.
  return c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

/** Returns the seconds to wait when `ip` is over a limit, else counts the request and returns 0. */
export function rateCheck(ip: string, now = Date.now()): number {
  const { perMin, perHour } = rateLimits();
  const min = Math.floor(now / 60_000);
  const hour = Math.floor(now / 3_600_000);
  if (hits.size > 10_000) for (const [k, v] of hits) if (v.hour !== hour) hits.delete(k);
  const e = hits.get(ip) ?? { min, nMin: 0, hour, nHour: 0 };
  if (e.min !== min) Object.assign(e, { min, nMin: 0 });
  if (e.hour !== hour) Object.assign(e, { hour, nHour: 0 });
  if (perMin > 0 && e.nMin >= perMin) return Math.ceil(((min + 1) * 60_000 - now) / 1000);
  if (perHour > 0 && e.nHour >= perHour) return Math.ceil(((hour + 1) * 3_600_000 - now) / 1000);
  e.nMin++;
  e.nHour++;
  hits.set(ip, e);
  return 0;
}

/** For tests: forget every count. */
export function resetRateLimits(): void {
  hits.clear();
}

export const rateLimit: MiddlewareHandler = async (c, next) => {
  if (publicMode() && c.req.method === 'POST') {
    const wait = rateCheck(clientIp(c));
    if (wait > 0) {
      c.header('Retry-After', String(wait));
      return c.json({ error: 'rate_limited', message: `Too many requests from this address. Try again in ${wait} s.` }, 429);
    }
  }
  await next();
};

export const corsMiddleware: MiddlewareHandler = cors({
  origin: (origin) => (origin && originAllowed(origin) ? origin : null),
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-WebAble', 'X-WebAble-Fresh'],
  exposeHeaders: ['X-WebAble-Cache', 'X-WebAble-Ms'],
  maxAge: 600,
});
