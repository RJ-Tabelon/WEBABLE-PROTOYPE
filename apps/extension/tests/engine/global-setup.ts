import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds the engine test bundle (IIFE) with esbuild before the engine
 * project runs. Output lives in node_modules/.cache so nothing is committed.
 */
const here = dirname(fileURLToPath(import.meta.url));
export const BUNDLE = join(
  here,
  '..',
  '..',
  'node_modules',
  '.cache',
  'webable-engine',
  'engine.iife.js',
);

export default async function globalSetup(): Promise<void> {
  const { build } = await import('esbuild');
  await mkdir(dirname(BUNDLE), { recursive: true });
  await build({
    entryPoints: [join(here, 'harness', 'entry.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    outfile: BUNDLE,
    sourcemap: 'inline',
    logLevel: 'warning',
  });
}
