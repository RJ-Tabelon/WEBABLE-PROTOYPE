// Build-time account settings: the Supabase project (public URL and publishable key only) and the web origins that
// may message the extension (externally_connectable, repeated here in code). Written to apps/extension/.env.local
// by `pnpm env:sync`. Nothing secret is bundled.

export interface AccountConfig {
  supabaseUrl: string;
  publishableKey: string;
  /** The website, for "Tune WebAble to you" and the account pages. */
  webOrigin: string;
  /** externally_connectable match patterns; the bridge answers only these. */
  bridgePatterns: string[];
}

const LOCAL_WEB_ORIGIN = 'http://localhost:3000';
const LOCAL_PATTERNS = 'http://localhost:3000/*,http://127.0.0.1:3000/*';

const trimSlash = (s: string): string => s.replace(/\/+$/, '');

type Env = Record<string, string | undefined>;

export function readAccountConfig(
  env: Env = import.meta.env as unknown as Env,
): AccountConfig {
  const store = env.MODE === 'store';
  const webOrigin = trimSlash(
    env.WXT_WEB_ORIGIN ?? (store ? '' : LOCAL_WEB_ORIGIN),
  );
  const patterns = (env.WXT_WEB_ORIGINS ?? (store ? '' : LOCAL_PATTERNS))
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    supabaseUrl: trimSlash(env.WXT_SUPABASE_URL ?? ''),
    publishableKey: env.WXT_SUPABASE_PUBLISHABLE_KEY ?? '',
    webOrigin,
    bridgePatterns: patterns,
  };
}

interface OriginPattern {
  protocol: string;
  hostname: string;
  /** null: any port (a match pattern without a port matches every port). */
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

/** Whether a sender origin is on the externally_connectable list (Chrome checks too; this repeats it in code). */
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
    if (!pat || url.protocol !== pat.protocol) return false;
    if (url.hostname.toLowerCase() !== pat.hostname) return false;
    if (pat.port === null) return true;
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    return port === pat.port;
  });
}
