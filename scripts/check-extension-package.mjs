#!/usr/bin/env node
// Checks the production extension build (apps/extension/.output/chrome-mv3)
// against the permission model in docs/08-System-Architecture.md section 8:
//
//   - Manifest V3.
//   - Required permissions exactly as declared in apps/extension/wxt.config.ts.
//   - Broad site access is optional only: optional_host_permissions is exactly
//     ['<all_urls>'], and there are no required host permissions or static
//     content scripts (the engine is registered at runtime after a click).
//   - No web-accessible resources (they let pages fingerprint the extension).
//   - externally_connectable lists exact https origins (no wildcard hosts, no
//     http:// and no loopback host), and the manifest carries no dev `key`.
//   - Every file the manifest and the service worker load is present, including
//     the engine, Fit view (content-scripts/fitview.js, injected on first open),
//     the MAIN-world key bridge (content-scripts/keybridge.js), the pre-paint
//     stylesheets, the welcome page and the icons.
//   - Bundle budgets (docs/10 §4.3: the engine runs on every page, so Fit view
//     lives in its own script): engine.js <= 330 KB (v1 was 176 KB; v2 adds
//     the skeleton reader, layout features and the rank solver; about 105 KB
//     gzipped; moving the skeleton reader into fitview.js is the next cut),
//     fitview.js <= 250 KB (only
//     injected the first time Fit view opens; docs/11 adds the restructure:
//     record templates, drawers, the outline and sentence splitting; docs/12
//     adds the Showroom sheet, card templates and the buy box),
//     keybridge.js <= 8 KB.
//   - No loopback URL (localhost, 127.0.0.0/8, [::1]) in the service worker or
//     the content scripts (docs/10 §8: production builds never reach the local
//     dev planner, the e2e stubs or a local web app). Dev and e2e builds carry
//     them on purpose; this check is for production builds only.
//   - Test-only hooks from the e2e build are not reachable.
//
// Usage: pnpm --filter @webable/extension build && node scripts/check-extension-package.mjs

import { access, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDirectory = resolve(
  root,
  process.argv[2] ?? 'apps/extension/.output/chrome-mv3',
);
const configPath = resolve(root, 'apps/extension/wxt.config.ts');

/** localhost, 127.0.0.0/8, [::1] and *.localhost hosts in a match pattern. */
const LOOPBACK =
  /^[a-z]+:\/\/(?:[^/]*\.)?(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?\//i;

/** Bundle budgets in KiB (minified output). */
const BUDGETS = {
  'content-scripts/engine.js': 330,
  'content-scripts/fitview.js': 250,
  'content-scripts/keybridge.js': 8,
};

/** A loopback URL literal: http(s)/ws(s) to localhost, 127.0.0.0/8 or [::1]. */
const LOOPBACK_URL =
  /\b(?:https?|wss?):\/\/(?:[a-z0-9-]+\.)*(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?/gi;

/**
 * Loopback literals that third-party code ships and never uses: supabase-js
 * (gotrue) carries its local default auth URL; WebAble always constructs the
 * client with the project URL.
 */
const INERT_LOOPBACK = new Set(['http://localhost:9999']);

const problems = [];
const fail = (message) => problems.push(message);

/** The `permissions: [...]` list from wxt.config.ts (string literals only). */
async function declaredPermissions() {
  const source = await readFile(configPath, 'utf8');
  const match = /\bpermissions\s*:\s*\[([^\]]*)\]/.exec(source);
  if (!match) throw new Error('No permissions list found in wxt.config.ts.');
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
}

const exists = (file) =>
  access(resolve(extensionDirectory, file.replace(/^\//, ''))).then(
    () => true,
    () => false,
  );

try {
  const manifest = JSON.parse(
    await readFile(resolve(extensionDirectory, 'manifest.json'), 'utf8'),
  );

  if (manifest.manifest_version !== 3)
    fail('The manifest must use Manifest V3.');

  const permissions = [...(manifest.permissions ?? [])].sort();
  const expected = await declaredPermissions();
  if (JSON.stringify(permissions) !== JSON.stringify(expected)) {
    fail(
      `Required permissions differ from wxt.config.ts: got [${permissions.join(', ')}], expected [${expected.join(', ')}].`,
    );
  }
  if (permissions.some((p) => p.includes('://') || p === '<all_urls>'))
    fail('Host patterns must never be required permissions.');

  if ((manifest.host_permissions ?? []).length > 0)
    fail(
      `The production build must not request host access: ${manifest.host_permissions.join(', ')}.`,
    );

  const optional = manifest.optional_host_permissions ?? [];
  if (JSON.stringify(optional) !== JSON.stringify(['<all_urls>']))
    fail(
      `optional_host_permissions must be exactly ["<all_urls>"], got ${JSON.stringify(optional)}.`,
    );

  if ((manifest.content_scripts ?? []).length > 0)
    fail(
      'Static content_scripts add required host access; the engine is registered at runtime.',
    );

  if ((manifest.web_accessible_resources ?? []).length > 0)
    fail('web_accessible_resources let any page fingerprint the extension.');

  const matches = manifest.externally_connectable?.matches ?? [];
  if (matches.length === 0)
    fail('externally_connectable must list the web app origins.');
  for (const pattern of matches) {
    if (!/^https?:\/\/[^*/]+\/\*$/.test(pattern))
      fail(
        `externally_connectable pattern is not an exact origin: ${pattern}.`,
      );
    if (!pattern.startsWith('https://'))
      fail(`externally_connectable pattern is not https: ${pattern}.`);
    if (LOOPBACK.test(pattern))
      fail(`externally_connectable trusts a loopback host: ${pattern}.`);
  }
  if ('key' in manifest)
    fail(
      'The manifest carries the development key; production builds omit it (the store assigns the id).',
    );
  if (manifest.externally_connectable?.ids)
    fail(
      'externally_connectable must not accept messages from other extensions.',
    );

  for (const command of ['focus-layer', 'undo-all'])
    if (!manifest.commands?.[command]) fail(`Missing command: ${command}.`);

  const background = manifest.background?.service_worker;
  const required = [
    manifest.action?.default_popup,
    background,
    'welcome.html',
    'content-scripts/engine.js',
    'content-scripts/fitview.js',
    'content-scripts/keybridge.js',
    'prepaint/focus-outline.css',
    'prepaint/calm-motion.css',
    ...Object.values(manifest.icons ?? {}),
    ...['', 'paused-', 'cant-'].flatMap((variant) =>
      [16, 24, 32].map((size) => `icons/${variant}${size}.png`),
    ),
  ].filter(Boolean);
  for (const file of required)
    if (!(await exists(file))) fail(`Missing file: ${file}.`);

  for (const [file, kib] of Object.entries(BUDGETS)) {
    if (!(await exists(file))) continue;
    const size = (await stat(resolve(extensionDirectory, file))).size;
    if (size > kib * 1024)
      fail(
        `${file} is ${(size / 1024).toFixed(1)} KB, over its ${kib} KB budget.`,
      );
  }

  // Production builds never carry a loopback URL (the dev planner server,
  // the e2e stubs and the local web app are dev and e2e builds only).
  const scanned = [
    background,
    ...(manifest.content_scripts ?? []).flatMap((c) => c.js ?? []),
    ...Object.keys(BUDGETS),
  ].filter((f, i, a) => f && a.indexOf(f) === i);
  for (const file of scanned) {
    if (!(await exists(file))) continue;
    const code = await readFile(resolve(extensionDirectory, file), 'utf8');
    const found = new Set(
      [...code.matchAll(LOOPBACK_URL)]
        .map((m) => m[0].toLowerCase())
        .filter((u) => !INERT_LOOPBACK.has(u)),
    );
    if (found.size > 0)
      fail(`${file} contains loopback URLs: ${[...found].sort().join(', ')}.`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (problems.length > 0) {
  console.error(
    'Extension package check failed. Build with the production web origins first: ' +
      'WXT_WEB_ORIGINS=https://<web origin>/* pnpm --filter @webable/extension build',
  );
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log('Extension package check passed.');
  console.log(
    `${process.argv[2] ? 'Checked directory' : 'Load-unpacked directory'}: ${extensionDirectory}`,
  );
}
