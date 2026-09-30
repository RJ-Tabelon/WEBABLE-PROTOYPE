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
//     the engine, the pre-paint stylesheets, the welcome page and the icons.
//   - Test-only hooks from the e2e build are not reachable.
//
// Usage: pnpm --filter @webable/extension build && node scripts/check-extension-package.mjs

import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDirectory = resolve(root, 'apps/extension/.output/chrome-mv3');
const configPath = resolve(root, 'apps/extension/wxt.config.ts');

/** localhost, 127.0.0.0/8, [::1] and *.localhost hosts in a match pattern. */
const LOOPBACK =
  /^[a-z]+:\/\/(?:[^/]*\.)?(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?\//i;

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
    'prepaint/focus-outline.css',
    'prepaint/calm-motion.css',
    ...Object.values(manifest.icons ?? {}),
    ...['', 'paused-', 'cant-'].flatMap((variant) =>
      [16, 24, 32].map((size) => `icons/${variant}${size}.png`),
    ),
  ].filter(Boolean);
  for (const file of required)
    if (!(await exists(file))) fail(`Missing file: ${file}.`);

  if (background && (await exists(background))) {
    const code = await readFile(
      resolve(extensionDirectory, background),
      'utf8',
    );
    // The e2e build's fixture origin must never ship.
    if (code.includes('127.0.0.1:4173'))
      fail('The service worker contains the e2e fixture origin.');
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
  console.log(`Load-unpacked directory: ${extensionDirectory}`);
}
