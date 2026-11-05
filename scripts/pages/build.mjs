// Builds the GitHub Pages website in dist/pages: the project page (site/), the two demo websites from
// apps/server/demo, the screenshots in docs/images, and the built extension as webable-extension.zip.
// Run `pnpm pages`, which builds the extension first. Needs the `zip` command (macOS and GitHub's Ubuntu have it).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const out = `${root}dist/pages`;
const extension = `${root}apps/extension/.output/chrome-mv3`;

if (!existsSync(`${extension}/manifest.json`)) {
  console.error('No extension build in apps/extension/.output/chrome-mv3. Run `pnpm pages`, which builds it first.');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

cpSync(`${root}site`, out, { recursive: true });
cpSync(`${root}apps/extension/public/brand`, `${out}/brand`, { recursive: true });
cpSync(`${root}docs/images/logo-white.svg`, `${out}/brand/logo-white.svg`);
mkdirSync(`${out}/images`);
for (const name of ['webable-page.png', 'webable-page-top.png', 'results.png', 'rewritten-in-place.png', 'jev-view.png']) {
  cpSync(`${root}docs/images/${name}`, `${out}/images/${name}`);
}

// The server serves the demo pages under /demo/; on Pages they sit in demo/, so the index's absolute links go relative.
cpSync(`${root}apps/server/demo`, `${out}/demo`, { recursive: true });
const index = `${out}/demo/index.html`;
writeFileSync(index, readFileSync(index, 'utf8').replaceAll('"/demo/', '"'));

execFileSync('zip', ['-qr', `${out}/webable-extension.zip`, '.'], { cwd: extension });

// No Jekyll: serve the files as they are.
writeFileSync(`${out}/.nojekyll`, '');
console.log(`Website built in ${out}`);
