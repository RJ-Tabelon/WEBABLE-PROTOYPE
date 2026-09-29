/**
 * Build-time configuration. Values come from apps/extension/.env.local
 * (scripts/sync-env.mjs); only public values are ever bundled (URL,
 * publishable key, origins). Nothing secret is available to the extension.
 */
export interface SwConfig {
  supabaseUrl: string;
  publishableKey: string;
  /** The web app, for links ("Open your fit", "Tune WebAble to you"). */
  webOrigin: string;
  /** externally_connectable match patterns; the bridge accepts only these. */
  bridgePatterns: string[];
  /** POST target for page analysis. */
  decideUrl: string;
  /** Build mode ('production', 'development', 'e2e'). */
  mode: string;
  /** Test-only hooks are compiled in (never in production). */
  e2e: boolean;
}

const trimSlash = (s: string): string => s.replace(/\/+$/, '');

/**
 * The e2e build never talks to the live project: Supabase (auth, REST and the
 * `decide` function) is a local stub the Playwright tests start on this origin.
 */
export const E2E_SUPABASE_ORIGIN = 'http://127.0.0.1:4175';

export function readConfig(env: ImportMetaEnv = import.meta.env): SwConfig {
  const mode = env.MODE ?? 'production';
  const e2e = mode === 'e2e';
  const supabaseUrl = e2e
    ? E2E_SUPABASE_ORIGIN
    : trimSlash(env.WXT_SUPABASE_URL ?? '');
  const webOrigin = trimSlash(env.WXT_WEB_ORIGIN ?? 'http://localhost:3000');
  const patterns = (env.WXT_WEB_ORIGINS ?? `${webOrigin}/*`)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    supabaseUrl,
    publishableKey: e2e
      ? 'e2e-publishable-key'
      : (env.WXT_SUPABASE_PUBLISHABLE_KEY ?? ''),
    webOrigin,
    bridgePatterns: patterns,
    decideUrl:
      (e2e ? '' : trimSlash(env.WXT_DECIDE_URL ?? '')) ||
      (supabaseUrl ? `${supabaseUrl}/functions/v1/decide` : ''),
    mode,
    e2e,
  };
}

interface OriginPattern {
  protocol: string;
  hostname: string;
  /** null: any port (Chrome match patterns without a port match every port). */
  port: string | null;
}

function parsePattern(pattern: string): OriginPattern | null {
  const m = /^(https?):\/\/([^/:]+)(?::(\d+))?\//.exec(pattern);
  if (!m || m[2] === undefined || m[2].includes('*')) return null;
  return {
    protocol: `${m[1]}:`,
    hostname: m[2].toLowerCase(),
    port: m[3] ?? null,
  };
}

/**
 * Whether a sender origin is on the externally_connectable allowlist. Chrome
 * already enforces the manifest list; this repeats the check in code (defense
 * in depth, platform.md 2.7).
 */
export function originAllowed(
  origin: string | undefined,
  patterns: readonly string[],
): boolean {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin.replace(/\/+$/, '')) return false;
  return patterns.some((p) => {
    const pat = parsePattern(p);
    if (!pat) return false;
    if (url.protocol !== pat.protocol) return false;
    if (url.hostname.toLowerCase() !== pat.hostname) return false;
    if (pat.port === null) return true;
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    return port === pat.port;
  });
}
