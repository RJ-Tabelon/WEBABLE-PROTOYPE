import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Settings for the e2e run, read from the environment first and then from the
 * local, gitignored files the repository scripts write. Values are never logged.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, '..', '..');
const REPO_ROOT = resolve(WEB_ROOT, '..', '..');

/** Signed-in browser state shared by the `app` project (gitignored). */
export const STORAGE_STATE = resolve(WEB_ROOT, 'e2e/.auth/user.json');

/** Minimal KEY=VALUE reader (comments and blank lines ignored, optional quotes). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match =
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trim().startsWith('#')) continue;
    const [, key, raw = ''] = match;
    if (!key) continue;
    out[key] = raw.replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

function readEnvFile(path: string): Record<string, string> {
  return existsSync(path) ? parseEnvFile(readFileSync(path, 'utf8')) : {};
}

export interface TestUser {
  email: string;
  password: string;
}

/** The local test user: E2E_* env, e2e/.env.e2e-user, or supabase/tests/.env.test-user. */
export function testUser(): TestUser {
  const own = readEnvFile(resolve(WEB_ROOT, 'e2e/.env.e2e-user'));
  const shared = readEnvFile(
    resolve(REPO_ROOT, 'supabase/tests/.env.test-user'),
  );
  const email =
    process.env.E2E_EMAIL ?? own.E2E_EMAIL ?? shared.TEST_USER_EMAIL;
  const password =
    process.env.E2E_PASSWORD ?? own.E2E_PASSWORD ?? shared.TEST_USER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'No e2e test user. Run `node scripts/create-test-user.mjs`, or set E2E_EMAIL and E2E_PASSWORD.',
    );
  }
  return { email, password };
}

export interface SupabaseEnv {
  url: string;
  key: string;
}

/** The project URL and publishable key the web app itself uses. */
export function supabaseEnv(): SupabaseEnv {
  const local = readEnvFile(resolve(WEB_ROOT, '.env.local'));
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? local.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    local.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase settings are missing. Run `pnpm env:sync` first.',
    );
  }
  return { url, key };
}
