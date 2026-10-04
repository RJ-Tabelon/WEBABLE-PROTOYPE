import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository locations the harness uses. */
const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..', '..');
export const WEB = join(REPO, 'apps', 'web');
export const EXTENSION = join(REPO, 'apps', 'extension');
export const EXTENSION_BUILD = join(EXTENSION, '.output', 'chrome-mv3-e2e');
export const FIXTURE_SERVER = join(
  EXTENSION,
  'tests',
  'engine',
  'fixture-server.mjs',
);

/**
 * Playwright, resolved from the web app's dev dependencies (the harness has no
 * package.json of its own and adds no dependency).
 */
export function playwright() {
  const require = createRequire(join(WEB, 'package.json'));
  return require('@playwright/test');
}
