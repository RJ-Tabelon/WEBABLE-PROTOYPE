// Builds the Vercel deployment as prebuilt output (Build Output API v3) in apps/server/.vercel/output:
// src/vercel.ts and everything it imports (@webable/core's TypeScript source included) bundled into one ESM file,
// served as a single Node function that takes every path. Deploy with `vercel deploy --prebuilt --prod`.
// esbuild comes from tsx (already a devDependency), so this adds no dependency.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}.vercel/output`;
const fn = `${out}/functions/api.func`;

const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild');

rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

await esbuild.build({
  entryPoints: [`${root}src/vercel.ts`],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
  // Some bundled CommonJS code calls require() for Node built-ins.
  banner: { js: "import { createRequire as __wa_cr } from 'node:module'; const require = __wa_cr(import.meta.url);" },
});

writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({ runtime: 'nodejs24.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60 }, null, 2),
);
writeFileSync(`${out}/config.json`, JSON.stringify({ version: 3, routes: [{ src: '/(.*)', dest: '/api' }] }, null, 2));

console.log(`built ${fn}/index.mjs`);
