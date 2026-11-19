#!/usr/bin/env node
// No paid API: all test profiles point at an unused loopback port.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(
  new URL('../../apps/extension/package.json', import.meta.url),
);
const { chromium } = require('@playwright/test');
const out =
  process.env.VERIFY_OUTPUT ?? join(root, 'output/news-engine-fix-2026-11-18');
await mkdir(out, { recursive: true });
const photo = '/photo.svg';
const html = `<!doctype html><html><head><meta charset="utf-8"><title>News regression</title><style>
body{font:14px/1.5 system-ui;margin:0}nav{height:40px;overflow:hidden;background:#eee}main{max-width:1200px;margin:auto;padding:20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(250px,100%),1fr));gap:20px}article{min-width:0}h2{font-size:24px;line-height:1.2}p{font-size:14px}img{width:100%;height:auto}a{color:inherit}section{margin-bottom:24px}
</style></head><body><nav>News • Politics • World • Sports • Travel</nav><main><h1>Today's news</h1>
<p id="body">This is the page's own running text, describing the day's headlines and linking to the original reporting. Every story, picture and destination must remain available.</p>
<section><h2><a href="/games/daily">Play the daily crossword game</a></h2><img src="${photo}" alt="Games"></section>
<div class="grid">${Array.from({ length: 12 }, (_, i) => `<article><a href="/story-${i}"><img src="${photo}" alt="Story photo ${i}"></a><h2><a href="/story-${i}">The original headline for important story ${i}</a></h2><p>Details of story ${i} stay with the source headline and its photograph.</p></article>`).join('')}</div></main></body></html>`;
const server = createServer((req, res) => {
  if (req.url === '/photo.svg') {
    res.setHeader('content-type', 'image/svg+xml');
    res.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#377d68"/><circle cx="200" cy="180" r="90" fill="#f1cb75"/></svg>',
    );
  } else {
    res.setHeader('content-type', 'text/html');
    res.end(html);
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'webable-news-regression-'));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--enable-unsafe-extension-debugging'],
});
const wait = async (fn, message, ms = 20_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(message);
};
async function engine(page) {
  const c = await ctx.newCDPSession(page);
  const worlds = [];
  c.on('Runtime.executionContextCreated', (e) => worlds.push(e.context));
  await c.send('Runtime.enable');
  const world = worlds.find(
    (w) =>
      w.auxData?.type === 'isolated' && w.origin === `chrome-extension://${id}`,
  );
  if (!world) {
    await c.detach();
    return null;
  }
  return {
    call: async (expression) =>
      (
        await c.send('Runtime.evaluate', {
          contextId: world.id,
          expression,
          returnByValue: true,
          awaitPromise: true,
        })
      ).result.value,
    close: () => c.detach(),
  };
}
async function view(page) {
  const c = await ctx.newCDPSession(page);
  const { root } = await c.send('DOM.getDocument', { depth: -1, pierce: true });
  const roots = [];
  const walk = (n) => {
    for (const s of n.shadowRoots ?? []) {
      roots.push(s);
      walk(s);
    }
    for (const x of n.children ?? []) walk(x);
  };
  walk(root);
  let result = null;
  for (const r of roots) {
    const { object } = await c.send('DOM.resolveNode', {
      backendNodeId: r.backendNodeId,
    });
    const v = await c.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      returnByValue: true,
      functionDeclaration: `function(){if(!this.querySelector('.wa-index'))return null;return {lead:this.querySelector('.wa-leadstory')?.getAttribute('href'),links:[...this.querySelectorAll('a[href]')].map(a=>a.href),images:[...this.querySelectorAll('img')].map(i=>({loaded:i.complete&&i.naturalWidth>0,state:i.parentElement.dataset.state,opacity:getComputedStyle(i).opacity})),width:this.querySelector('.wa-index').scrollWidth}}`,
    });
    if (v.result.value) result = v.result.value;
  }
  await c.detach();
  return result;
}
let id;
const evidence = [];
try {
  const cdp = await ctx.browser().newBrowserCDPSession();
  ({ id } = await cdp.send('Extensions.loadUnpacked', {
    path: join(root, 'apps/extension/.output/chrome-mv3'),
  }));
  const control = await ctx.newPage();
  await control.goto(`chrome-extension://${id}/fitting.html`);
  await control.evaluate(async () => {
    await chrome.storage.local.set({
      settings: {
        enabled: true,
        pausedOrigins: [],
        aiLayouts: false,
        lens: false,
        serverOrigin: 'http://127.0.0.1:9',
      },
    });
    await chrome.runtime.sendMessage({ __wa: 1, req: { type: 'getFit' } });
  });
  const worker = ctx.serviceWorkers()[0];
  await worker.evaluate(async () => {
    await globalThis.__webable.setFit('rosa');
    await chrome.storage.local.remove('reader');
  });
  for (const width of [1440, 390]) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin);
    const api = await wait(() => engine(page), 'Engine did not start');
    await wait(
      async () =>
        api.call(
          `['tailored','understood','calm'].includes(__webableEngine.getState().phase)`,
        ),
      'Sizing never settled',
    );
    const size = await page.evaluate(() => ({
      body: parseFloat(
        getComputedStyle(document.querySelector('#body')).fontSize,
      ),
      heading: parseFloat(
        getComputedStyle(document.querySelector('article h2 a')).fontSize,
      ),
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    }));
    const zoom = await api.call('__webableEngine.getState().pageZoom');
    assert.equal(zoom, 1, 'Automatic text sizing must not zoom the browser');
    assert(size.body >= 20, `Body text must grow through CSS (${size.body}px)`);
    assert(
      size.heading > size.body,
      `Headline hierarchy must survive (${JSON.stringify(size)})`,
    );
    assert(
      size.overflow <= 1,
      'CSS sizing must reflow without sideways scrolling',
    );
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.id = 'late';
      p.textContent = 'A story loaded later keeps the same readable text size.';
      document.querySelector('main').append(p);
    });
    await wait(
      async () =>
        page.evaluate(
          () =>
            parseFloat(
              getComputedStyle(document.querySelector('#late')).fontSize,
            ) >= 20,
        ),
      'New text was not scaled',
    );
    await page.screenshot({ path: join(out, `fixture-${width}-css.png`) });
    await api.call('__webableEngine.openCalm()');
    const calm = await wait(() => view(page), 'News index not rendered');
    assert(calm.lead.endsWith('/story-0'), 'Games must not become the lead');
    await wait(
      async () =>
        (await view(page)).images.every(
          (i) => i.loaded && i.state === 'ok' && i.opacity !== '0',
        ),
      'News pictures did not become visible',
    );
    await page.screenshot({ path: join(out, `fixture-${width}-calm.png`) });
    await api.call('__webableEngine.closeCalm()');
    await api.call('__webableEngine.showOriginal(true)');
    await wait(
      async () =>
        page.evaluate(
          () =>
            getComputedStyle(document.querySelector('#body')).fontSize ===
            '14px',
        ),
      'Original text size was not restored',
    );
    await api.call('__webableEngine.showOriginal(false)');
    await wait(
      async () =>
        page.evaluate(
          () =>
            parseFloat(
              getComputedStyle(document.querySelector('#body')).fontSize,
            ) >= 20,
        ),
      'Restoring adaptation did not scale text again',
    );
    if (width === 1440) {
      const tab = await control.evaluate(
        async (url) =>
          (await chrome.tabs.query({})).find((t) => t.url === url)?.id,
        origin + '/',
      );
      await control.evaluate(
        async (tabId) => chrome.tabs.setZoom(tabId, 2),
        tab,
      );
      await wait(
        async () => api.call('__webableEngine.getState().pageZoom === 2'),
        'Manual 200% zoom was not kept',
      );
      await api.call('__webableEngine.adjustText(1)');
      assert.equal(
        await control.evaluate(
          async (tabId) => chrome.tabs.getZoom(tabId),
          tab,
        ),
        2,
      );
      await control.evaluate(
        async (tabId) => chrome.tabs.setZoom(tabId, 1),
        tab,
      );
      await wait(
        async () => api.call('__webableEngine.getState().pageZoom === 1'),
        'Zoom reset did not settle',
      );
    }
    assert.deepEqual(errors, []);
    evidence.push({ width, size, zoom, calm });
    await api.close();
    await page.close();
    console.log(
      `✓ ${width}px: CSS text sizing, hierarchy, late content, linked photos, news order and Original page`,
    );
  }
  await writeFile(
    join(out, 'regression.json'),
    JSON.stringify({ api: 'blocked', evidence }, null, 2),
  );
  console.log(`No API calls. Evidence: ${out}`);
} catch (e) {
  for (const [i, p] of ctx.pages().entries())
    await p.screenshot({ path: join(out, `failure-${i}.png`) }).catch(() => {});
  throw e;
} finally {
  await ctx.close();
  await new Promise((r) => server.close(r));
  await rm(profile, { recursive: true, force: true });
}
