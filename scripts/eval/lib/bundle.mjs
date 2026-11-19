import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CACHE, EVAL_ENTRIES } from './paths.mjs';

/**
 * Bundles the evaluation's in-page code and the core pieces the runner uses,
 * with esbuild (the repo's root dev dependency):
 *
 *   start.js       isolated world, document_start: the input firewall
 *   main-world.js  MAIN world, document_start: key bridge + page watchers
 *   entry.js       isolated world, after load: window.__wae
 *   node-core.mjs  core for Node (personas, planner request, validator)
 */
export async function buildBundles() {
  const { build } = await import('esbuild');
  await mkdir(CACHE, { recursive: true });
  const iife = (name) =>
    build({
      entryPoints: [join(EVAL_ENTRIES, `${name}.ts`)],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'chrome120',
      outfile: join(CACHE, `${name}.js`),
      logLevel: 'warning',
      define: { 'process.env.NODE_ENV': '"production"' },
    });
  await Promise.all([
    iife('start'),
    iife('main-world'),
    iife('entry'),
    build({
      entryPoints: [join(EVAL_ENTRIES, 'node-core.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      outfile: join(CACHE, 'node-core.mjs'),
      logLevel: 'warning',
    }),
  ]);
  const read = (name) => readFile(join(CACHE, name), 'utf8');
  const [start, mainWorld, entry] = await Promise.all([
    read('start.js'),
    read('main-world.js'),
    read('entry.js'),
  ]);
  const core = await import(
    `${pathToFileURL(join(CACHE, 'node-core.mjs')).href}?t=${Date.now()}`
  );
  return { start, mainWorld, entry, core };
}

/** Core only (the benchmark needs no browser bundles). */
export async function loadCore() {
  const { build } = await import('esbuild');
  await mkdir(CACHE, { recursive: true });
  await build({
    entryPoints: [join(EVAL_ENTRIES, 'node-core.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile: join(CACHE, 'node-core.mjs'),
    logLevel: 'warning',
  });
  return import(
    `${pathToFileURL(join(CACHE, 'node-core.mjs')).href}?t=${Date.now()}`
  );
}
