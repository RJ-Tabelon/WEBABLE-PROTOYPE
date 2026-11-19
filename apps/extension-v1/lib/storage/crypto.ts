/**
 * WebCrypto helpers. Keys for anything derived from a site (site keys, answer
 * cache keys, page signatures) are HMAC-SHA256 under a random per-install
 * secret, so the stored keys cannot be reversed or linked across installs.
 */

const SEP = '\u001f'; // unit separator: parts can never run together

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/** A random id for tab sessions, events and deltas (not linkable to anything). */
export function randomId(bytes = 12): string {
  return base64url(randomBytes(bytes));
}

const hex = (buf: ArrayBuffer, bytes: number): string =>
  [...new Uint8Array(buf).slice(0, bytes)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    const raw = fromBase64url(secret);
    key = crypto.subtle.importKey(
      'raw',
      raw.buffer.slice(
        raw.byteOffset,
        raw.byteOffset + raw.byteLength,
      ) as ArrayBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    keyCache.set(secret, key);
    if (keyCache.size > 4) {
      const oldest = keyCache.keys().next().value;
      if (oldest !== undefined && oldest !== secret) keyCache.delete(oldest);
    }
  }
  return key;
}

/**
 * HMAC-SHA256(secret, parts joined by U+001F), truncated to `bytes` and
 * hex-encoded. 8 bytes (64 bits) for site keys, 16 for cache keys.
 */
export async function hmacHex(
  secret: string,
  parts: readonly string[],
  bytes = 16,
): Promise<string> {
  const key = await hmacKey(secret);
  const data = new TextEncoder().encode(parts.join(SEP));
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return hex(sig, Math.max(4, Math.min(32, bytes)));
}

/** Deterministic JSON with sorted object keys (canonical form for signatures). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
