// Fixture server for the engine Playwright project (127.0.0.1:4173).
//   /engine/<name>.html     fixture pages (tests/engine/fixtures)
//   /engine/assets/anim.gif  a small animated GIF, encoded here (no binary assets in git)
//   /__engine.js             the engine test bundle (built by global-setup)
//   /healthz                 readiness probe for Playwright's webServer
//   /v2/<name>.html          v2 fixture pages (tests/v2/fixtures)
//   /__v2/<name>.js          v2 harness bundles (tests/v2/entries, built by global-setup)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const bundle = join(
  here,
  '..',
  '..',
  'node_modules',
  '.cache',
  'webable-engine',
  'engine.iife.js',
);
const v2Fixtures = join(here, '..', 'v2', 'fixtures');
const v2Bundles = join(
  here,
  '..',
  '..',
  'node_modules',
  '.cache',
  'webable-v2',
);
const port = Number(process.env.ENGINE_FIXTURE_PORT ?? 4173);

/**
 * Minimal animated GIF encoder: 2-colour frames, LZW with a clear code every
 * two data codes so the code size never grows (valid, uncompressed-style).
 */
function encodeGif(width, height, frames, delayCs) {
  const bytes = [];
  const push = (...b) => bytes.push(...b);
  const u16 = (n) => push(n & 0xff, (n >> 8) & 0xff);
  push(...Buffer.from('GIF89a'));
  u16(width);
  u16(height);
  push(0xf1, 0, 0); // global colour table, 4 entries
  push(0x2d, 0x6a, 0x3e, 0xfa, 0xfa, 0xf7, 0x1a, 0x1a, 0x17, 0xff, 0xff, 0xff);
  push(
    0x21,
    0xff,
    0x0b,
    ...Buffer.from('NETSCAPE2.0'),
    0x03,
    0x01,
    0x00,
    0x00,
    0x00,
  ); // loop forever
  for (const pixels of frames) {
    push(0x21, 0xf9, 0x04, 0x04);
    u16(delayCs);
    push(0x00, 0x00);
    push(0x2c);
    u16(0);
    u16(0);
    u16(width);
    u16(height);
    push(0x00);
    const minCode = 2;
    const clear = 4;
    const eoi = 5;
    const codeSize = 3;
    const codes = [];
    for (let i = 0; i < pixels.length; i++) {
      if (i % 2 === 0) codes.push(clear);
      codes.push(pixels[i]);
    }
    codes.push(eoi);
    const out = [];
    let acc = 0;
    let bits = 0;
    for (const c of codes) {
      acc |= c << bits;
      bits += codeSize;
      while (bits >= 8) {
        out.push(acc & 0xff);
        acc >>= 8;
        bits -= 8;
      }
    }
    if (bits > 0) out.push(acc & 0xff);
    push(minCode);
    for (let i = 0; i < out.length; i += 255) {
      const chunk = out.slice(i, i + 255);
      push(chunk.length, ...chunk);
    }
    push(0x00);
  }
  push(0x3b);
  return Buffer.from(bytes);
}

function animatedGif() {
  const w = 48;
  const h = 48;
  const frame = (phase) => {
    const px = new Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++)
        px[y * w + x] =
          (Math.floor((x + phase) / 8) + Math.floor(y / 8)) % 2 === 0 ? 0 : 1;
    }
    return px;
  };
  return encodeGif(w, h, [frame(0), frame(8)], 30);
}

const gif = animatedGif();

/** A large page (~7,000 elements) for the extraction and verification budgets. */
function largePage() {
  const words =
    'the quarry road stays open while the volunteers keep a careful record of every basket and bench'.split(
      ' ',
    );
  const sentence = (i) =>
    Array.from(
      { length: 28 },
      (_, k) => words[(i * 7 + k) % words.length],
    ).join(' ');
  const nav = Array.from(
    { length: 300 },
    (_, i) => `<li><a href="/n/${i}">Section ${i}</a></li>`,
  ).join('');
  const paras = Array.from(
    { length: 600 },
    (_, i) =>
      `<p>${sentence(i)}. <em>${sentence(i + 1)}</em> <a href="/r/${i}">more</a> <span>${sentence(i + 2)}</span>.</p>`,
  ).join('');
  const cards = Array.from(
    { length: 400 },
    (_, i) =>
      `<li class="card"><a href="/p/${i}"><img alt="" width="60" height="40"><span>Item ${i}</span></a><button type="button">Add</button></li>`,
  ).join('');
  const foot = Array.from(
    { length: 400 },
    (_, i) => `<a href="/f/${i}">Link ${i}</a>`,
  ).join(' ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Large page</title>
<style>
body{margin:0;font-family:Arial,sans-serif}
header nav ul{display:flex;flex-wrap:wrap;gap:4px;list-style:none;padding:8px;margin:0;font-size:12px}
.layout{display:grid;grid-template-columns:1fr 320px;gap:24px;padding:24px}
main p{font-size:14px;line-height:1.3;color:#777}
aside ul{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:1fr 1fr;gap:6px}
.card{font-size:12px}.card button{font-size:11px;padding:1px 4px}
footer{font-size:11px;padding:24px}
</style></head><body>
<header><nav aria-label="Sections"><ul>${nav}</ul></nav></header>
<div class="layout"><main><h1>Large page</h1>${paras}</main><aside class="shop sidebar"><h2>Popular items</h2><ul>${cards}</ul></aside></div>
<footer>${foot}</footer></body></html>`;
}
const large = largePage();

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css',
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  try {
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (url.pathname === '/engine/assets/anim.gif') {
      res
        .writeHead(200, {
          'content-type': 'image/gif',
          'cache-control': 'no-store',
        })
        .end(gif);
      return;
    }
    if (url.pathname === '/engine/csp.html') {
      // The article under a strict CSP: no inline styles or scripts allowed.
      res.writeHead(200, {
        'content-type': types['.html'],
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'",
      });
      res.end(await readFile(join(fixtures, 'article.html')));
      return;
    }
    if (url.pathname === '/engine/large.html') {
      res
        .writeHead(200, {
          'content-type': types['.html'],
          'cache-control': 'no-store',
        })
        .end(large);
      return;
    }
    if (url.pathname === '/__engine.js') {
      res
        .writeHead(200, {
          'content-type': types['.js'],
          'cache-control': 'no-store',
        })
        .end(await readFile(bundle));
      return;
    }
    if (url.pathname.startsWith('/__v2/') || url.pathname.startsWith('/v2/')) {
      const bundleReq = url.pathname.startsWith('/__v2/');
      const rel = normalize(url.pathname.slice(bundleReq ? 6 : 4));
      if (rel.startsWith('..') || rel.includes('/..'))
        throw Object.assign(new Error('forbidden'), { code: 'EACCES' });
      const file = join(bundleReq ? v2Bundles : v2Fixtures, rel);
      const ext = file.slice(file.lastIndexOf('.'));
      res.writeHead(200, {
        'content-type': types[ext] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(await readFile(file));
      return;
    }
    if (url.pathname.startsWith('/engine/')) {
      const rel = normalize(url.pathname.slice('/engine/'.length));
      if (rel.startsWith('..'))
        throw Object.assign(new Error('forbidden'), { code: 'EACCES' });
      const file = join(fixtures, rel);
      const ext = file.slice(file.lastIndexOf('.'));
      res.writeHead(200, {
        'content-type': types[ext] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(await readFile(file));
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': types['.html'] });
      res.end(
        '<!doctype html><title>Fixtures</title><h1>Engine fixtures</h1><p>See /engine/*.html</p>',
      );
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  } catch (err) {
    res
      .writeHead(err?.code === 'ENOENT' ? 404 : 500, {
        'content-type': 'text/plain',
      })
      .end('error');
  }
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`engine fixtures on http://127.0.0.1:${port}\n`);
});
