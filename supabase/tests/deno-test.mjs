#!/usr/bin/env node
// Type-check and test the Edge Functions with Deno, isolated from the pnpm workspace.
//
//   node supabase/tests/deno-test.mjs            check entrypoints, then run every Deno test
//   node supabase/tests/deno-test.mjs --filter "rate"   extra args go to `deno test`
//
// Why a wrapper: from inside this repo, Deno discovers the root package.json and
// pnpm-workspace.yaml, then tries to resolve npm: specifiers from node_modules and
// may even rewrite package.json to "migrate" the pnpm workspace. DENO_NO_PACKAGE_JSON
// plus --no-config keeps Deno on its own global cache and leaves the workspace alone.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const ENTRYPOINTS = [
  'supabase/functions/extension-link/index.ts',
  'supabase/functions/decide/index.ts',
  'supabase/functions/ingest/index.ts',
];
const TEST_ROOTS = [
  'supabase/functions/extension-link',
  'supabase/functions/decide',
  'supabase/functions/ingest',
  'supabase/tests/functions',
];

const env = {
  ...process.env,
  DENO_NO_PACKAGE_JSON: '1',
  NO_COLOR: process.env.NO_COLOR ?? '1',
};

function run(args) {
  const result = spawnSync('deno', args, { cwd: ROOT, env, stdio: 'inherit' });
  if (result.error) {
    console.error(
      result.error.code === 'ENOENT'
        ? 'Deno is not installed. Install it with `brew install deno`.'
        : `Could not start Deno: ${result.error.message}`,
    );
    process.exit(2);
  }
  return result.status ?? 1;
}

const entrypoints = ENTRYPOINTS.filter((p) => existsSync(resolve(ROOT, p)));
const checkStatus = run(['check', '--no-config', ...entrypoints]);
if (checkStatus !== 0) process.exit(checkStatus);

const extra = process.argv.slice(2).filter((a) => a !== '--');
process.exit(
  run([
    'test',
    '--no-config',
    '--allow-env',
    '--allow-net=127.0.0.1',
    ...extra,
    ...TEST_ROOTS,
  ]),
);
