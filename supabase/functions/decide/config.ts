// Jev configuration for `decide`, read once per isolate.
//
//   TYPESAFE_API_KEY  TypeSafe key. Absent -> every call answers
//                     200 { ok: false, degraded: 'unconfigured' } (rules only).
//   JEV_BASE_URL      Optional origin override for local testing, e.g.
//                     http://127.0.0.1:8787 (scripts/jev-mock-server.mjs) or
//                     http://host.docker.internal:8787 under `supabase functions serve`.
//                     https anywhere; plain http only for loopback hosts, so a
//                     mistyped production value can never send the key in clear.

import { JEV_ENDPOINT } from '../_shared/core.bundle.js';

/** Structural view of the environment (matches EnvReader in _shared/supabase.ts). */
interface EnvReader {
  get(name: string): string | undefined;
}

/** Hard deadline for the whole Jev exchange. No retries: a retry cannot land in the page-view budget. */
export const JEV_TIMEOUT_MS = 2_000;

export interface JevSettings {
  apiKey: string;
  endpoint: string;
  timeoutMs: number;
  /** Injected in tests (the core mock). Default: global fetch. */
  fetch?: typeof fetch;
}

export type JevConfig =
  | { status: 'ready'; settings: JevSettings }
  | { status: 'unconfigured'; reason: 'no_key' | 'bad_base_url' };

const JEV_PATH = new URL(JEV_ENDPOINT).pathname;
const LOOPBACK_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  'host.docker.internal',
]);

function isLoopback(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.localhost');
}

/**
 * The System One endpoint for a JEV_BASE_URL value, or null when the value is
 * unusable. A path prefix is kept (`http://proxy.localhost/jev` ->
 * `http://proxy.localhost/jev/v1/systemone`). Empty means production.
 */
export function jevEndpoint(base: string | undefined): string | null {
  const raw = base?.trim();
  if (!raw) return JEV_ENDPOINT;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.protocol === 'http:') {
    if (!isLoopback(url.hostname)) return null;
  } else if (url.protocol !== 'https:') {
    return null;
  }
  const prefix = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${prefix}${JEV_PATH}`;
}

export function jevConfigFromEnv(env: EnvReader): JevConfig {
  const apiKey = env.get('TYPESAFE_API_KEY')?.trim();
  if (!apiKey) return { status: 'unconfigured', reason: 'no_key' };
  const endpoint = jevEndpoint(env.get('JEV_BASE_URL'));
  if (!endpoint) return { status: 'unconfigured', reason: 'bad_base_url' };
  return {
    status: 'ready',
    settings: { apiKey, endpoint, timeoutMs: JEV_TIMEOUT_MS },
  };
}
