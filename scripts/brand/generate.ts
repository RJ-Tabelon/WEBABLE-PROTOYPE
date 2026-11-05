// Regenerate every static logo from the same contours the extension renders.
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { LOGO_PATHS, LOGO_VIEWBOX } from '../../apps/extension/src/brand/geometry';

const root = new URL('../../', import.meta.url);
const require = createRequire(new URL('apps/extension/package.json', root));
const { chromium } = require('@playwright/test');
const paths = LOGO_PATHS.map((d) => `<path d="${d}"/>`).join('');
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEWBOX}" fill="#000">${paths}</svg>\n`;
// A white backplate keeps the black mark visible on light and dark browser chrome.
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="26" fill="#fff"/><svg x="8" y="8" width="112" height="112" viewBox="${LOGO_VIEWBOX}" fill="#000">${paths}</svg></svg>`;
const extension = new URL('apps/extension/public/', root);
const site = new URL('apps/server/demo/brand/', root);
await mkdir(new URL('brand/', extension), { recursive: true });
await mkdir(new URL('icon/', extension), { recursive: true });
await mkdir(site, { recursive: true });
for (const dir of [new URL('brand/', extension), site]) {
  await writeFile(new URL('logo.svg', dir), logo);
  await writeFile(new URL('favicon.svg', dir), icon + '\n');
}

const pngs = new Map<number, Buffer>();
const browser = await chromium.launch({ headless: true });
try {
  for (const size of [16, 32, 48, 128, 180]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;background:transparent}body>svg{display:block;width:${size}px;height:${size}px}</style>${icon}`);
    const png = await page.screenshot({ omitBackground: true });
    pngs.set(size, png);
    if (size !== 180) await writeFile(new URL(`icon/${size}.png`, extension), png);
    await page.close();
  }
} finally {
  await browser.close();
}

// ICO entries carry PNG payloads, supported by current desktop browsers.
const sizes = [16, 32, 48];
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (const [i, size] of sizes.entries()) {
  const data = pngs.get(size)!;
  const at = 6 + i * 16;
  header[at] = size;
  header[at + 1] = size;
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(data.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += data.length;
}
const ico = Buffer.concat([header, ...sizes.map((size) => pngs.get(size)!)]);
for (const dir of [new URL('brand/', extension), site]) {
  await writeFile(new URL('favicon.ico', dir), ico);
  await writeFile(new URL('favicon-32.png', dir), pngs.get(32)!);
  await writeFile(new URL('apple-touch-icon.png', dir), pngs.get(180)!);
}
console.log(`Updated WebAble branding in ${fileURLToPath(extension)} and ${fileURLToPath(site)}`);
