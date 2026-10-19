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
  /** POST target for Fit view layout planning (the `compose` Edge Function). */
  composeUrl: string;
  /**
   * Development builds whose compose URL is the local dev planner (`pnpm
   * dev:compose`, loopback): planning may run without an account when the
   * person turns settings.devPlanner on. Never true in other builds.
   */
  devPlanner: boolean;
  /** Build mode ('production', 'development', 'e2e'). */
  mode: string;
  /** Test-only hooks are compiled in (never in production). */
  e2e: boolean;
}

const trimSlash = (s: string): string => s.replace(/\/+$/, '');

/** Loopback hosts: localhost (and *.localhost), 127.0.0.0/8, [::1]. */
export function isLoopbackUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /^127(?:\.\d{1,3}){3}$/.test(host) ||
    host === '[::1]'
  );
}

/**
 * Loopback addresses exist only in local builds (development, e2e and unit
 * tests). Every other build, production and the package check alike,
 * compiles them out (Vite replaces import.meta.env.MODE), so it can never
 * reach a stub or a server on the person's machine (docs/10 §8; the package
 * check fails on any loopback URL in a release service worker). An allowlist,
 * so a new build mode is a release build until said otherwise.
 */
const LOCAL_BUILD =
  import.meta.env.MODE === 'development' ||
  import.meta.env.MODE === 'e2e' ||
  import.meta.env.MODE === 'test';

/**
 * The e2e build never talks to the live project: Supabase (auth, REST and the
 * `decide` and `compose` functions) is a local stub the Playwright tests start
 * on this origin.
 */
export const E2E_SUPABASE_ORIGIN = LOCAL_BUILD ? 'http://127.0.0.1:4175' : '';

/** The local web app development and e2e builds fall back to. */
const LOCAL_WEB_ORIGIN = LOCAL_BUILD ? 'http://localhost:3000' : '';

export function readConfig(env: ImportMetaEnv = import.meta.env): SwConfig {
  const mode = env.MODE ?? 'production';
  const e2e = mode === 'e2e';
  const supabaseUrl = e2e
    ? E2E_SUPABASE_ORIGIN
    : trimSlash(env.WXT_SUPABASE_URL ?? '');
  // Only development and e2e builds fall back to the local web app. A production
  // build without configured origins trusts no page (wxt.config.ts refuses to
  // build one anyway).
  const local = mode === 'development' || e2e;
  const webOrigin = trimSlash(
    env.WXT_WEB_ORIGIN ?? (local ? LOCAL_WEB_ORIGIN : ''),
  );
  const patterns = (env.WXT_WEB_ORIGINS ?? (webOrigin ? `${webOrigin}/*` : ''))
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  // Only development and e2e builds honour a compose override (the dev
  // planner, the e2e stub); production always calls the project's function.
  const composeUrl =
    (local ? trimSlash(env.WXT_COMPOSE_URL ?? '') : '') ||
    (supabaseUrl ? `${supabaseUrl}/functions/v1/compose` : '');
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
    composeUrl,
    devPlanner:
      mode === 'development' && composeUrl !== '' && isLoopbackUrl(composeUrl),
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
