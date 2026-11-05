// Bundles preview.tsx so preview.html can render the six components in a browser.
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

function findEsbuild() {
  let current = dir;
  for (let i = 0; i < 8; i++) {
    const direct = join(current, 'node_modules', 'esbuild', 'lib', 'main.js');
    if (existsSync(direct)) return direct;
    const pnpm = join(current, 'node_modules', '.pnpm');
    if (existsSync(pnpm)) {
      const hit = readdirSync(pnpm).find((name) => name.startsWith('esbuild@'));
      if (hit) return join(pnpm, hit, 'node_modules', 'esbuild', 'lib', 'main.js');
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error('esbuild is not installed');
}

const require = createRequire(findEsbuild());
const esbuild = require(findEsbuild());

await esbuild.build({
  absWorkingDir: join(dir, '../../../..'),
  entryPoints: [join(dir, 'preview.tsx')],
  bundle: true,
  format: 'esm',
  outfile: join(dir, 'preview.bundle.js'),
  jsx: 'automatic',
  jsxImportSource: 'preact',
  define: { 'process.env.NODE_ENV': '"production"' },
});

console.log(join(dir, 'preview.bundle.js'));
