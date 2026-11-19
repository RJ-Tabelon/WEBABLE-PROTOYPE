import { mkdir, readdir } from 'node:fs/promises';
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
  await buildV2Entries(build);
}

/**
 * v2 harness bundles (docs/10 §9): every tests/v2/entries/<name>.ts becomes
 * node_modules/.cache/webable-v2/<name>.js, served at /__v2/<name>.js. One
 * entry per work area keeps parallel work from sharing a harness file.
 */
export const V2_DIR = join(
  here,
  '..',
  '..',
  'node_modules',
  '.cache',
  'webable-v2',
);

async function buildV2Entries(
  build: typeof import('esbuild').build,
): Promise<void> {
  const dir = join(here, '..', 'v2', 'entries');
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.ts'));
  } catch {
    return;
  }
  await mkdir(V2_DIR, { recursive: true });
  await Promise.all(
    names.map((name) =>
      build({
        entryPoints: [join(dir, name)],
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: 'chrome120',
        outfile: join(V2_DIR, name.replace(/\.ts$/, '.js')),
        sourcemap: 'inline',
        logLevel: 'warning',
        define: { 'process.env.NODE_ENV': '"production"' },
      }),
    ),
  );
}
