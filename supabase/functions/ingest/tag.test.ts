import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertRejects,
} from 'jsr:@std/assert@1';

import {
  ingestTag,
  MIN_SECRET_LENGTH,
  TagSecretError,
  usableSecret,
} from './tag.ts';

const SECRET = 's'.repeat(MIN_SECRET_LENGTH);
const USER = '6f1c3c1e-3b7a-4c55-9d0e-6a8b7f1d2e3a';
const OTHER = '0b9f3e55-2a41-4d2c-8e0e-0f5b7a1c2d3e';

Deno.test(
  'the tag is a stable 32-byte HMAC per account and window',
  async () => {
    const a = await ingestTag(SECRET, '2026-W37/4', USER);
    assertMatch(a, /^[0-9a-f]{64}$/);
    assertEquals(await ingestTag(SECRET, '2026-W37/4', USER), a);
    assertNotEquals(a, USER.replaceAll('-', ''));
  },
);

Deno.test('tags do not link across windows, accounts or secrets', async () => {
  const base = await ingestTag(SECRET, '2026-W37/4', USER);
  assertNotEquals(await ingestTag(SECRET, '2026-W41/4', USER), base);
  assertNotEquals(await ingestTag(SECRET, '2026-W37/4', OTHER), base);
  assertNotEquals(await ingestTag(`${SECRET}x`, '2026-W37/4', USER), base);
});

Deno.test('matches an independent HMAC computation', async () => {
  const enc = new TextEncoder();
  const sign = async (key: Uint8Array<ArrayBuffer>, msg: string) =>
    new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        await crypto.subtle.importKey(
          'raw',
          key,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        ),
        enc.encode(msg),
      ),
    );
  const salt = await sign(
    enc.encode(SECRET),
    'webable/ingest-salt/v1/2026-W37/4',
  );
  const tag = await sign(salt, USER);
  const hex = [...tag].map((b) => b.toString(16).padStart(2, '0')).join('');
  assertEquals(await ingestTag(SECRET, '2026-W37/4', USER), hex);
});

Deno.test('refuses a missing or short secret', async () => {
  assertEquals(usableSecret(undefined), false);
  assertEquals(usableSecret('short'), false);
  assertEquals(usableSecret(` ${'s'.repeat(MIN_SECRET_LENGTH - 1)} `), false);
  assertEquals(usableSecret(SECRET), true);
  await assertRejects(
    () => ingestTag('short', '2026-W37/4', USER),
    TagSecretError,
  );
});
