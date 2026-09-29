/**
 * Stable structural component keys.
 *
 * A key is a hash of the region's landmark, its tag-path shape and its sanitized
 * class/id tokens. It is not a secret and is never sent anywhere as-is: the
 * service worker applies its own keyed HMAC (per-install secret) before a key is
 * stored or used as a cache key (engine.md 2.15).
 *
 * Sanitizing drops digits and hash-like tokens (css-1x9k2, sc-AbCdEf), so the
 * same component keeps its key across page loads and across pages of a template.
 */

/** cyrb53: fast, well-distributed 53-bit string hash (public domain). */
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Keep a class or id token only when it looks like an authored name:
 * no digits, not a mixed-case hash, 2-32 characters. Returns it lowercased.
 */
export function sanitizeToken(raw: string): string | null {
  const t = raw.trim();
  if (t.length < 2 || t.length > 32) return null;
  if (/\d/.test(t)) return null;
  if (!/^[A-Za-z][A-Za-z_-]*$/.test(t)) return null;
  if (t.split(/[-_]+/).some(isHashLikeSegment)) return null;
  return t.toLowerCase();
}

/**
 * A mixed-case segment of 5+ letters that is not plain camel/Pascal case, or
 * whose capitals are too dense to be words (styled-components "bdVaJa").
 */
function isHashLikeSegment(seg: string): boolean {
  if (seg.length < 5) return false;
  const upper = (seg.match(/[A-Z]/g) ?? []).length;
  if (upper === 0 || upper === seg.length) return false;
  const camel = /^[A-Z]?[a-z]+(?:[A-Z][a-z]+)*$/.test(seg);
  return !camel || upper / seg.length > 0.3;
}

/** Sanitized, de-duplicated, sorted tokens from a class and id string (max 4). */
export function sanitizedTokens(className: string, id: string): string[] {
  const out = new Set<string>();
  for (const raw of `${className} ${id}`.split(/\s+/)) {
    const t = sanitizeToken(raw);
    if (t) out.add(t);
  }
  return [...out].sort().slice(0, 4);
}

export interface KeyParts {
  landmark: string;
  /** Tag names from the nearest landmark-or-body ancestor down, e.g. "body>div>aside". */
  tagPath: string;
  tokens: readonly string[];
}

export function componentKey(parts: KeyParts): string {
  const basis = `${parts.landmark}|${parts.tagPath}|${parts.tokens.join('.')}`;
  return `c${cyrb53(basis).toString(36)}`;
}
