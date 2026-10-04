#!/usr/bin/env node
// Create (or reuse) a confirmed email + password user for local testing.
//
//   node scripts/create-test-user.mjs                 reuse or create the default test user
//   node scripts/create-test-user.mjs --email a@b.c   use a specific address
//   node scripts/create-test-user.mjs --new           always make a fresh address
//
// Credentials come from TEST_USER_EMAIL / TEST_USER_PASSWORD, else from
// supabase/tests/.env.test-user (gitignored by the root `.env.*` rule), else they are
// generated and written there. Only the email is printed; read the password from that file.
//
// Flow: sign up with supabase-js and the publishable (anon) key, then confirm the
// address with SQL. When the project cannot send a confirmation email (the default
// Supabase mailer only sends to team addresses), the user is provisioned with SQL
// instead. Either way the script finishes by signing in to prove the user works.

import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import pg from 'pg';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CREDS_FILE = resolve(ROOT, 'supabase/tests/.env.test-user');

dotenv.config({ path: resolve(ROOT, '.env'), quiet: true });

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { email: null, fresh: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--new') out.fresh = true;
    else if (arg === '--email') out.email = argv[++i] ?? null;
    else if (arg.startsWith('--email=')) out.email = arg.slice(8);
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/create-test-user.mjs [--email address] [--new]',
      );
      process.exit(0);
    } else fail(`Unknown option: ${arg}`, 2);
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function loadCredentials({ email, fresh }) {
  const stored = dotenv.parse(
    await readFile(CREDS_FILE, 'utf8').catch(() => ''),
  );
  const envEmail = process.env.TEST_USER_EMAIL;
  const envPassword = process.env.TEST_USER_PASSWORD;

  let chosenEmail =
    email ?? envEmail ?? (fresh ? null : stored.TEST_USER_EMAIL) ?? null;
  let password =
    envPassword ??
    (chosenEmail && chosenEmail === stored.TEST_USER_EMAIL
      ? stored.TEST_USER_PASSWORD
      : null);
  let generated = false;

  if (!chosenEmail) {
    // RFC 2606 reserves .test, so this address can never reach a real inbox.
    chosenEmail = `webable-${randomUUID().slice(0, 8)}@webable.test`;
  }
  if (!EMAIL_RE.test(chosenEmail)) fail('That email address is not valid.', 2);
  if (!password) {
    password = `wa-${randomBytes(18).toString('base64url')}`;
    generated = true;
  }
  return { email: chosenEmail.toLowerCase(), password, generated };
}

async function saveCredentials({ email, password }) {
  await writeFile(
    CREDS_FILE,
    [
      '# Local test user for WebAble. Created by scripts/create-test-user.mjs. Do not commit.',
      `TEST_USER_EMAIL=${email}`,
      `TEST_USER_PASSWORD=${password}`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
}

async function loadSupabaseJs() {
  // supabase-js is a dependency of the web app, not the workspace root.
  const require = createRequire(resolve(ROOT, 'apps/web/package.json'));
  const mod = await import(
    pathToFileURL(require.resolve('@supabase/supabase-js')).href
  );
  return mod.createClient ?? mod.default.createClient;
}

async function findUser(db, email) {
  const { rows } = await db.query(
    `select id, email_confirmed_at is not null as confirmed from auth.users
     where lower(email) = lower($1) and not is_sso_user and deleted_at is null`,
    [email],
  );
  return rows[0] ?? null;
}

async function confirmAndSetPassword(db, userId, password) {
  await db.query(
    `update auth.users
        set email_confirmed_at = coalesce(email_confirmed_at, now()),
            encrypted_password = extensions.crypt($2, extensions.gen_salt('bf', 10)),
            updated_at = now()
      where id = $1`,
    [userId, password],
  );
}

/** Provision a confirmed email user directly, mirroring what GoTrue writes. */
async function provisionWithSql(db, email, password) {
  const id = randomUUID();
  await db.query('begin');
  try {
    await db.query(
      `insert into auth.users
         (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
          confirmation_token, recovery_token, email_change_token_new, email_change,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values
         ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2,
          extensions.crypt($3, extensions.gen_salt('bf', 10)), now(),
          '', '', '', '',
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())`,
      [id, email, password],
    );
    await db.query(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
       values ($1::text, $1::uuid,
               jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true, 'phone_verified', false),
               'email', now(), now())`,
      [id, email],
    );
    await db.query('commit');
  } catch (error) {
    await db.query('rollback').catch(() => {});
    throw error;
  }
  return id;
}

const FALLBACK_CODES = new Set([
  'email_address_not_authorized',
  'email_address_invalid',
  'over_email_send_rate_limit',
  'unexpected_failure',
  'signup_disabled',
  'email_provider_disabled',
]);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  const dbUrl = (process.env.SUPABASE_DIRECT_URL ?? '').replace(
    /:6543\//,
    ':5432/',
  );
  if (!url || !key || !dbUrl) {
    fail(
      'Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_DIRECT_URL in the root .env first.',
      2,
    );
  }

  const creds = await loadCredentials(args);
  const createClient = await loadSupabaseJs();
  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const db = new pg.Client({
    connectionString: dbUrl,
    application_name: 'webable-test-user',
  });
  await db.connect();
  try {
    const existing = await findUser(db, creds.email);
    if (existing) {
      // Reuse: make sure it is confirmed and its password is the one on file.
      await confirmAndSetPassword(db, existing.id, creds.password);
    } else {
      const { data, error } = await supabase.auth.signUp({
        email: creds.email,
        password: creds.password,
      });
      if (!error && data.user) {
        await confirmAndSetPassword(db, data.user.id, creds.password);
      } else if (
        error &&
        (FALLBACK_CODES.has(error.code ?? '') || (error.status ?? 0) >= 500)
      ) {
        await provisionWithSql(db, creds.email, creds.password);
      } else {
        fail(`Sign-up was refused (${error?.code ?? 'no user returned'}).`);
      }
    }
  } finally {
    await db.end().catch(() => {});
  }

  const { data: signIn, error: signInError } =
    await supabase.auth.signInWithPassword({
      email: creds.email,
      password: creds.password,
    });
  if (signInError || !signIn.session) {
    fail(
      `The test user exists but could not sign in (${signInError?.code ?? 'no session'}).`,
    );
  }
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});

  if (creds.generated || args.email || args.fresh) await saveCredentials(creds);
  console.log(creds.email);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(
    `Could not create the test user: ${message.replace(/postgres(ql)?:\/\/[^\s]+/g, '<database url>')}`,
  );
});
