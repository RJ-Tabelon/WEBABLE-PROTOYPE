#!/usr/bin/env node
// Apply supabase/migrations to the project database without Docker or a linked project.
//
//   pnpm db:push               apply pending migrations (the CLI asks to confirm)
//   pnpm db:push --dry-run     list what would be applied, change nothing
//   pnpm db:push --yes         apply without the confirmation prompt
//
// Other flags passed through to `supabase db push`: --include-all, --include-seed,
// --include-roles, --skip-vault, --debug.
//
// Reads SUPABASE_DIRECT_URL from the root .env and uses the session pooler (:5432),
// because migrations need a session-level connection. The URL is never printed.

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PASSTHROUGH = new Set([
  '--dry-run',
  '--yes',
  '--include-all',
  '--include-seed',
  '--include-roles',
  '--skip-vault',
  '--debug',
]);

const args = process.argv.slice(2).filter((a) => a !== '--');
if (args.includes('--help') || args.includes('-h')) {
  console.log(
    'Usage: pnpm db:push [--dry-run] [--yes] [--include-all] [--include-seed] [--include-roles] [--skip-vault] [--debug]',
  );
  process.exit(0);
}
const unknown = args.filter((a) => !PASSTHROUGH.has(a));
if (unknown.length) {
  console.error(`Unknown option(s): ${unknown.join(' ')}. Run with --help.`);
  process.exit(2);
}

dotenv.config({ path: resolve(ROOT, '.env'), quiet: true });
const raw = process.env.SUPABASE_DIRECT_URL ?? '';
if (!raw) {
  console.error(
    'SUPABASE_DIRECT_URL is not set. Add it to the root .env (see .env.example).',
  );
  process.exit(2);
}

let dbUrl;
try {
  const parsed = new URL(raw);
  if (!/^postgres(ql)?:$/.test(parsed.protocol))
    throw new Error('not a postgres URL');
  if (parsed.port === '6543') parsed.port = '5432';
  dbUrl = parsed.toString();
} catch {
  console.error(
    'SUPABASE_DIRECT_URL is not a valid, percent-encoded postgres:// URL.',
  );
  process.exit(2);
}

const redact = (text) =>
  text.replace(/postgres(ql)?:\/\/[^\s'"]+/g, '<database url>');
const pipeRedacted = (from, to) =>
  from.on('data', (chunk) => to.write(redact(chunk.toString())));

const mode = args.includes('--dry-run')
  ? 'Dry run: nothing will change.'
  : 'Applying pending migrations.';
console.log(`${mode} Target: session pooler from SUPABASE_DIRECT_URL.`);

// The URL travels only as the CLI argument; keep it out of the child's environment.
const childEnv = { ...process.env };
delete childEnv.SUPABASE_DIRECT_URL;

const child = spawn('supabase', ['db', 'push', '--db-url', dbUrl, ...args], {
  cwd: ROOT,
  stdio: ['inherit', 'pipe', 'pipe'],
  env: childEnv,
});
pipeRedacted(child.stdout, process.stdout);
pipeRedacted(child.stderr, process.stderr);

child.on('error', (error) => {
  if (error.code === 'ENOENT') {
    console.error(
      'The Supabase CLI is not installed. Install it with `brew install supabase/tap/supabase`.',
    );
  } else {
    console.error(`Could not start the Supabase CLI: ${redact(error.message)}`);
  }
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`supabase db push stopped (${signal}).`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
