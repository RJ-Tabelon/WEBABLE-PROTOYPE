#!/usr/bin/env node
// Deploy the Edge Functions (decide, extension-link, ingest, compose) and their secrets.
//
//   SUPABASE_ACCESS_TOKEN=<token> pnpm deploy:functions
//
// The token must belong to a Supabase account that can see the project in
// SUPABASE_URL (create one at https://supabase.com/dashboard/account/tokens while
// signed in as the project owner). It is used for this run only; the CLI's own
// login is left alone. Without it, the CLI's current login is tried.
//
// Secrets set on the project:
//   WEB_ORIGINS        WEB_ORIGINS, else WEB_ORIGIN (plus its 127.0.0.1 twin when loopback)
//   EXTENSION_ORIGINS  EXTENSION_ORIGINS, else the development extension id
//   INGEST_TAG_SECRET  generated once; never rotated here (rotating destroys every period salt)
//   TYPESAFE_API_KEY   only when set in .env (without it, page analysis stays on-device)
//   OPENAI_API_KEY     only when set in .env (without it, Fit view keeps its on-device layout).
//                      COMPOSE_OPENAI_API_KEY, when set, is used instead: a dedicated key for
//                      the planner, separate from the one research scripts use.
// Values go through a temporary 0600 env file, never the command line, and are never printed.
// The planner's kill switch is not set here: `supabase secrets set COMPOSE_DISABLED=1`.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIONS = ['decide', 'extension-link', 'ingest', 'compose'];
const DEV_EXTENSION_ORIGIN =
  'chrome-extension://bbnblnlbgcccbbbbihngngbecbobedie';

dotenv.config({ path: resolve(ROOT, '.env'), quiet: true });

const supabaseUrl = process.env.SUPABASE_URL ?? '';
const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(
  supabaseUrl,
)?.[1];
if (!ref) {
  console.error('SUPABASE_URL in the root .env is not a hosted project URL.');
  process.exit(2);
}

function supabase(args, { quiet = false } = {}) {
  const result = spawnSync('supabase', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: quiet
      ? ['ignore', 'pipe', 'pipe']
      : ['ignore', 'inherit', 'inherit'],
    env: process.env,
  });
  if (result.error) {
    console.error(
      'The Supabase CLI is not installed (https://supabase.com/docs/guides/cli).',
    );
    process.exit(2);
  }
  return result;
}

// 1. Access: the token (or the CLI login) must see this project.
const list = supabase(['projects', 'list', '-o', 'json'], { quiet: true });
let visible = false;
try {
  const parsed = JSON.parse(list.stdout);
  const projects = Array.isArray(parsed) ? parsed : (parsed.projects ?? []);
  visible = projects.some((p) => p.ref === ref || p.id === ref);
} catch {
  visible = false;
}
if (!visible) {
  console.error(
    [
      `This Supabase login can't see project ${ref}.`,
      '',
      'Sign in to supabase.com as the account that owns the project, create a token at',
      'https://supabase.com/dashboard/account/tokens, then run:',
      '',
      '  SUPABASE_ACCESS_TOKEN=<token> pnpm deploy:functions',
    ].join('\n'),
  );
  process.exit(1);
}
console.log(`Project ${ref}: access confirmed.`);

// 2. Secrets.
const existing = supabase(
  ['secrets', 'list', '--project-ref', ref, '-o', 'json'],
  {
    quiet: true,
  },
);
let existingNames = new Set();
try {
  existingNames = new Set(JSON.parse(existing.stdout).map((s) => s.name));
} catch {
  // An empty or unreadable list: treat every secret as missing.
}

const webOrigins = (() => {
  if (process.env.WEB_ORIGINS) return process.env.WEB_ORIGINS;
  const origin = new URL(process.env.WEB_ORIGIN ?? 'http://localhost:3000')
    .origin;
  const url = new URL(origin);
  if (url.hostname === 'localhost')
    return `${origin},${origin.replace('localhost', '127.0.0.1')}`;
  return origin;
})();

const secrets = {
  WEB_ORIGINS: webOrigins,
  EXTENSION_ORIGINS: process.env.EXTENSION_ORIGINS ?? DEV_EXTENSION_ORIGIN,
};
if (!existingNames.has('INGEST_TAG_SECRET'))
  secrets.INGEST_TAG_SECRET = randomBytes(36).toString('base64url');
if (process.env.TYPESAFE_API_KEY)
  secrets.TYPESAFE_API_KEY = process.env.TYPESAFE_API_KEY;
const openaiKey =
  process.env.COMPOSE_OPENAI_API_KEY?.trim() ||
  process.env.OPENAI_API_KEY?.trim();
if (openaiKey) secrets.OPENAI_API_KEY = openaiKey;

const dir = mkdtempSync(join(tmpdir(), 'webable-secrets-'));
const envFile = join(dir, 'secrets.env');
try {
  writeFileSync(
    envFile,
    Object.entries(secrets)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
  const set = supabase(
    ['secrets', 'set', '--project-ref', ref, '--env-file', envFile],
    {
      quiet: true,
    },
  );
  if (set.status !== 0) {
    console.error('Setting secrets failed:', (set.stderr || set.stdout).trim());
    process.exit(1);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(
  `Secrets set: ${Object.keys(secrets).join(', ')}` +
    (existingNames.has('INGEST_TAG_SECRET') ? ' (INGEST_TAG_SECRET kept)' : ''),
);
console.log(`  WEB_ORIGINS=${secrets.WEB_ORIGINS}`);
console.log(`  EXTENSION_ORIGINS=${secrets.EXTENSION_ORIGINS}`);
if (!process.env.TYPESAFE_API_KEY && !existingNames.has('TYPESAFE_API_KEY'))
  console.log('  TYPESAFE_API_KEY not set: page analysis stays on-device.');
if (!openaiKey && !existingNames.has('OPENAI_API_KEY'))
  console.log(
    '  OPENAI_API_KEY not set: Fit view keeps its on-device layouts.',
  );

// 3. Deploy (bundled server-side; no Docker needed). verify_jwt comes from config.toml.
const deploy = supabase([
  'functions',
  'deploy',
  ...FUNCTIONS,
  '--project-ref',
  ref,
  '--use-api',
]);
if (deploy.status !== 0) process.exit(deploy.status ?? 1);

// 4. Check: each function answers (401 without a session means deployed and guarded).
let ok = true;
for (const name of FUNCTIONS) {
  const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
  }).catch(() => null);
  const status = res?.status ?? 0;
  const good = status === 401;
  ok &&= good;
  console.log(
    `${good ? 'ok  ' : 'FAIL'} ${name}: ${status === 404 ? 'not found' : `HTTP ${status}`}`,
  );
}
if (!ok) process.exit(1);
console.log('\nDone. Reload /connect and press Try again.');
