// The local dev planner's request gate (docs/10 §8; scripts/dev-compose.ts).
// Never deployed: only the dev server and its tests import it.
//
// The dev server holds a real OpenAI key and skips Supabase, so it must not
// become an open proxy. In front of the real compose handler it:
//   - answers only when the Host header is 127.0.0.1:<port> or localhost:<port>
//     (a DNS-rebound name never matches);
//   - requires the dev extension's Origin on every POST (pages cannot forge it,
//     and a no-cors POST can send neither that Origin nor a JSON body);
//   - with --token, requires exactly that bearer token as well. Without it, the
//     development build may call with no Authorization header (the dev planner
//     needs no account), and a header that is present must be well-formed;
//   - serves only /compose and /functions/v1/compose (and their /health).
// Auth, consent and quota are stubbed: the handler itself is the real one.

import { type CorsPolicy } from '../_shared/cors.ts';
import { errorResponse, logEvent } from '../_shared/http.ts';
import type { PlannerConfig } from './config.ts';
import { createComposeHandler } from './handler.ts';

/** The unpacked development build's id (apps/extension/wxt.config.ts manifest key). */
export const DEV_EXTENSION_ORIGIN =
  'chrome-extension://bbnblnlbgcccbbbbihngngbecbobedie';
export const DEV_COMPOSE_PORT = 54400;
/** The person every dev request acts as. Never sent anywhere. */
export const DEV_USER_ID = '00000000-0000-4000-8000-00000000c0de';

const PATHS = /^\/(functions\/v1\/)?compose(\/health)?\/?$/;
const BEARER = /^Bearer ([\x21-\x7e]{8,8192})$/;

export interface DevGateOptions {
  port: number;
  planner: PlannerConfig;
  /** When set, every request must carry exactly this bearer token. */
  token?: string;
  log?: typeof logEvent;
}

/** Equal strings in time that depends only on their lengths. */
function sameToken(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function devCorsPolicy(): CorsPolicy {
  return {
    allowed: new Set([DEV_EXTENSION_ORIGIN]),
    allowMethods: 'GET, POST, OPTIONS',
    allowHeaders: 'authorization, apikey, content-type, x-client-info',
    maxAge: 600,
  };
}

/** The dev server's request handler: the gate, then the real compose handler. */
export function createDevComposeHandler(
  opts: DevGateOptions,
): (req: Request) => Promise<Response> {
  const log = opts.log ?? logEvent;
  const hosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]);
  const handle = createComposeHandler({
    cors: devCorsPolicy(),
    verify: (req) => {
      const header = req.headers.get('authorization');
      const token = header === null ? null : BEARER.exec(header)?.[1];
      const refused =
        token === undefined ||
        (opts.token !== undefined &&
          (token === null || !sameToken(token, opts.token)));
      if (refused)
        return Promise.resolve({
          ok: false,
          status: 401,
          code: header === null ? 'missing_token' : 'invalid_token',
          message:
            opts.token === undefined
              ? 'Send no Authorization header, or a well-formed Bearer token.'
              : 'Send the dev planner token as a Bearer token.',
        });
      return Promise.resolve({
        ok: true,
        token: token ?? '',
        user: {
          id: DEV_USER_ID,
          email: null,
          isAnonymous: false,
          sessionId: null,
        },
      });
    },
    readConsent: () => Promise.resolve(true),
    consumeQuota: () => Promise.resolve({ userOk: true, globalOk: true }),
    planner: opts.planner,
    disabled: () => false,
    log,
  });

  return async (req: Request): Promise<Response> => {
    const host = (req.headers.get('host') ?? '').toLowerCase();
    if (!hosts.has(host)) {
      log('dev_compose_refused', { reason: 'host' });
      return errorResponse(
        403,
        'forbidden_host',
        'The dev planner answers on 127.0.0.1 only.',
      );
    }
    if (!PATHS.test(new URL(req.url).pathname)) {
      return errorResponse(404, 'not_found', 'Use /compose.');
    }
    if (
      req.method === 'POST' &&
      req.headers.get('origin') !== DEV_EXTENSION_ORIGIN
    ) {
      log('dev_compose_refused', { reason: 'origin' });
      return errorResponse(
        403,
        'forbidden_origin',
        'Only the development extension may use the dev planner.',
      );
    }
    return handle(req);
  };
}
