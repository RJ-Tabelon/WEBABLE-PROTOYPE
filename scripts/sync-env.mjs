// Writes per-app env files from the root .env so secrets live in one place.
// Only public values (URL, publishable/anon key, origins, extension id) are copied.
import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';

const fromFile = parse(
  await readFile(new URL('../.env', import.meta.url)).catch(() => ''),
);
// Process environment (e.g. CI) takes precedence over the file.
const env = { ...fromFile, ...process.env };
const url = env.SUPABASE_URL ?? '';
const key = env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY ?? '';
const webOrigin = env.WEB_ORIGIN ?? 'http://localhost:3000';
const extensionId = env.EXTENSION_ID ?? 'bbnblnlbgcccbbbbihngngbecbobedie';
// Required for a production web build (apps/web/lib/env.ts); optional in development.
const contactEmail = env.CONTACT_EMAIL ?? env.NEXT_PUBLIC_CONTACT_EMAIL ?? '';

// The loopback alias is trusted only when the web app itself runs locally; a
// deployed origin never brings 127.0.0.1 into the extension's allowlist.
const loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/;
const webHost = (() => {
  try {
    return new URL(webOrigin).hostname;
  } catch {
    return '';
  }
})();
const webOrigins = [`${webOrigin}/*`];
if (loopback.test(webHost)) webOrigins.push('http://127.0.0.1:3000/*');

if (!url || !key) {
  console.error(
    'Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) in .env first.',
  );
  process.exit(1);
}

await writeFile(
  new URL('../apps/web/.env.local', import.meta.url),
  [
    `NEXT_PUBLIC_SUPABASE_URL=${url}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${key}`,
    `NEXT_PUBLIC_EXTENSION_ID=${extensionId}`,
    `NEXT_PUBLIC_WEB_ORIGIN=${webOrigin}`,
    ...(contactEmail ? [`NEXT_PUBLIC_CONTACT_EMAIL=${contactEmail}`] : []),
    '',
  ].join('\n'),
);

await writeFile(
  new URL('../apps/extension/.env.local', import.meta.url),
  [
    `WXT_SUPABASE_URL=${url}`,
    `WXT_SUPABASE_PUBLISHABLE_KEY=${key}`,
    `WXT_WEB_ORIGIN=${webOrigin}`,
    `WXT_WEB_ORIGINS=${[...new Set(webOrigins)].join(',')}`,
    '',
  ].join('\n'),
);

console.log('Wrote apps/web/.env.local and apps/extension/.env.local');
