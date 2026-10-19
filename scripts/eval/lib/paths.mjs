import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository locations the evaluation uses. */
const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..', '..');
export const EXTENSION = join(REPO, 'apps', 'extension');
export const EVAL_ENTRIES = join(EXTENSION, 'tests', 'eval');
export const V2_FIXTURES = join(EXTENSION, 'tests', 'v2', 'fixtures');
/**
 * Bundles are build output: kept under node_modules/.cache, never committed.
 * WEBABLE_EVAL_CACHE gives a run its own bundle directory, so runs from
 * several working sessions at once do not overwrite each other's bundles.
 */
export const CACHE = process.env.WEBABLE_EVAL_CACHE
  ? resolve(process.env.WEBABLE_EVAL_CACHE)
  : join(REPO, 'node_modules', '.cache', 'webable-eval');
/** Default output root (gitignored): screenshots, raw JSON, the report. */
export const OUTPUT_ROOT = join(REPO, 'eval-output');
/** Atkinson Hyperlegible Next (latin subset), the face Fit view registers. */
export const FIT_FONT = join(
  REPO,
  'packages',
  'tokens',
  'fonts',
  'webable-sans-latin.woff2',
);
export const ENV_FILE = join(REPO, '.env');

/**
 * Playwright, resolved from the extension's dev dependencies (the evaluation
 * has no package.json of its own and adds no dependency).
 */
export function playwright() {
  const require = createRequire(join(EXTENSION, 'package.json'));
  return require('@playwright/test');
}
