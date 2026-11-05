// Shared helpers for the eval scripts: repo paths, Playwright loading, a tiny static server, small utils.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEMO_ROOT = path.join(ROOT, 'apps/server/demo');
export const EXT_DIR = path.join(ROOT, 'apps/extension/.output/chrome-mv3');
export const SERVER_DIR = path.join(ROOT, 'apps/server');
export const SERVER_ORIGIN = 'http://127.0.0.1:41741';

/** A desktop Chrome user agent: some real sites (Drugs.com) return 403 to "HeadlessChrome". */
export const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The device scale factor the run emulates (--dpr). Page zoom is devicePixelRatio ÷ this, and positions the checks
 * report are in screen px at 1× (CSS px × page zoom), whatever the DPR, so thresholds mean the same at DPR 1 and 2.
 */
let BASE_DPR = 1;
export const baseDpr = () => BASE_DPR;
export function setBaseDpr(n) {
  BASE_DPR = Number.isFinite(n) && n > 0 ? n : 1;
}

/** Path of the branded Google Chrome to drive with --browser chrome (CHROME_PATH overrides). */
export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform === 'win32') return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  return '/usr/bin/google-chrome';
}

/**
 * Chrome flags for a run at device scale factor `dpr`. Headless Chrome draws its compositor surface at 1× even under
 * Playwright's DPR-2 emulation, so a surface capture comes out 1440×900. --force-device-scale-factor makes the surface
 * itself 2×, so shoot() returns device pixels (2880×1800) with no clip. Do not reach for a clip with scale instead:
 * capturing with a clip from a second CDP session resets the page's emulated devicePixelRatio to 1 afterwards (the
 * capture "restores" that session's empty emulation), which halves every zoom and size the harness measures after the
 * first screenshot and makes WebAble see a zoom change.
 */
export function dprArgs(dpr) {
  return Number(dpr) > 1 ? [`--force-device-scale-factor=${Number(dpr)}`] : [];
}

/**
 * Screenshot the viewport from the compositor surface (CDP Page.captureScreenshot, fromSurface). Headless Chrome's
 * plain screenshot comes out with a blank band at the top after scrolling at 150% zoom; this one does not. With
 * dprArgs() on the launch, the image is in device pixels (2880×1800 for 1440×900 at --dpr 2). Falls back to
 * page.screenshot.
 */
export async function shoot(page, file, { timeout = 20_000 } = {}) {
  let session = null;
  try {
    session = await page.context().newCDPSession(page);
    const { data } = await Promise.race([
      session.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('capture timed out')), timeout)),
    ]);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(file, Buffer.from(data, 'base64'));
  } catch {
    await page.screenshot({ path: file, timeout });
  } finally {
    await session?.detach().catch(() => {});
  }
}

/** Playwright 1.64.1 from apps/extension's devDependencies (no install needed at the root). */
export function loadPlaywright() {
  const req = createRequire(path.join(ROOT, 'apps/extension/package.json'));
  try {
    return req('@playwright/test');
  } catch (e) {
    throw new Error(`Could not load @playwright/test from apps/extension (${e instanceof Error ? e.message : e}). Run pnpm install first.`);
  }
}

/** Launch options for Playwright's bundled Chrome for Testing, or PW_CHROMIUM_PATH if set. */
export function browserTarget() {
  return process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : { channel: 'chromium' };
}

/**
 * Load @webable/core (TypeScript source) through tsx's ESM API, from apps/server's devDependencies.
 * Returns the module namespace (DEMO_FITS, DEFAULT_SETTINGS, ...).
 */
export async function loadCore() {
  const req = createRequire(path.join(SERVER_DIR, 'package.json'));
  let apiPath;
  try {
    apiPath = req.resolve('tsx/esm/api');
  } catch {
    throw new Error('Could not find tsx (apps/server devDependency). Run pnpm install first.');
  }
  // require.resolve picks the CJS build; the ESM build sits next to it.
  const esm = apiPath.replace(/index\.cjs$/, 'index.mjs');
  const api = await import(pathToFileURL(existsSync(esm) ? esm : apiPath).href);
  const tsImport = api.tsImport ?? api.default?.tsImport;
  if (typeof tsImport !== 'function') throw new Error('tsx/esm/api has no tsImport.');
  return tsImport(pathToFileURL(path.join(ROOT, 'packages/core/src/index.ts')).href, import.meta.url);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serve `root` at `/demo/` on 127.0.0.1 (random port unless given). Mirrors the WebAble server's
 * demo routes (`/demo/x` also serves `x.html`). Resolves to { origin, close }.
 */
export function startStaticServer(root = DEMO_ROOT, port = 0) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname);
    if (!rel.startsWith('/demo')) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    rel = rel.replace(/^\/demo/, '') || '/';
    if (rel.endsWith('/')) rel += 'index.html';
    let file = path.join(root, path.normalize(rel));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) && !path.extname(file) && existsSync(`${file}.html`)) file = `${file}.html`;
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const p = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ origin: `http://127.0.0.1:${p}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'site';
}

export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function median(xs) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function parseViewport(s, fallback = { width: 1280, height: 720 }) {
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(String(s ?? ''));
  return m ? { width: Number(m[1]), height: Number(m[2]) } : fallback;
}
