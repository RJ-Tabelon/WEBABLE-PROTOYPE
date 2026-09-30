import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { REPO } from './paths.mjs';

/**
 * Bundle lib/fixtures.ts (and the TypeScript test helpers it re-exports) into
 * one ESM file with esbuild, the repo's root dev dependency, and import it.
 * The bundle lives under node_modules/.cache, so nothing is committed.
 */
export async function loadFixtures() {
  const { build } = await import('esbuild');
  const outfile = join(
    REPO,
    'node_modules',
    '.cache',
    'webable-capture',
    'fixtures.mjs',
  );
  await mkdir(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [join(REPO, 'scripts', 'capture', 'lib', 'fixtures.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile,
    logLevel: 'warning',
    // Type-only imports of Playwright disappear; keep the runtime one external just in case.
    external: ['@playwright/test'],
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}
