// Contribution-bounding tag for product-learning reports (personalization.md 14.2).
//
//   period salt = HMAC-SHA256(INGEST_TAG_SECRET, "webable/ingest-salt/v1/" + windowId)
//   tag         = HMAC-SHA256(period salt, userId)
//
// The tag lets the database enforce one report per account per window without
// storing who reported: private.ingest_quota holds (tag, period, used,
// expires_at) only, rows are deleted when they expire, and aggregates carry no
// tag at all. Rotating INGEST_TAG_SECRET destroys every period salt at once.

const encoder = new TextEncoder();

/** Minimum secret length: 32 characters (for example `openssl rand -base64 48`). */
export const MIN_SECRET_LENGTH = 32;

export class TagSecretError extends Error {
  constructor() {
    super(
      `INGEST_TAG_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`,
    );
    this.name = 'TagSecretError';
  }
}

async function hmac(
  key: Uint8Array<ArrayBuffer>,
  message: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)),
  );
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function usableSecret(secret: string | undefined): secret is string {
  return (
    typeof secret === 'string' && secret.trim().length >= MIN_SECRET_LENGTH
  );
}

/** 64 hex characters. Throws TagSecretError when the secret is missing or short. */
export async function ingestTag(
  secret: string | undefined,
  windowId: string,
  userId: string,
): Promise<string> {
  if (!usableSecret(secret)) throw new TagSecretError();
  const salt = await hmac(
    encoder.encode(secret.trim()),
    `webable/ingest-salt/v1/${windowId}`,
  );
  return toHex(await hmac(salt, userId));
}
