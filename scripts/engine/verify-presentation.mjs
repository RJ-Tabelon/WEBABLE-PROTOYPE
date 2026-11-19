#!/usr/bin/env node
// Presentation-critical flows against local fixtures, with paid APIs unreachable.
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
  process.env.VERIFY_OUTPUT ??
  join(root, 'output/presentation-hardening-2026-11-18');
await mkdir(out, { recursive: true });
const sentence =
  'The original reporting includes the important details, context, and evidence. Readers should keep access to every paragraph and every destination on both a wide desktop and a narrow phone.';
const article = (
  next = false,
) => `<!doctype html><html><head><meta charset="utf-8"><meta property="og:type" content="article"><title>${next ? 'Second' : 'First'} complete article</title><style>
body{font:14px/1.5 system-ui;margin:0}nav{height:40px;overflow:hidden;background:#eee}main{max-width:900px;margin:auto;padding:20px}h1{font-size:32px}h2{font-size:24px}p{font-size:14px}img{width:100%;height:auto}a{color:inherit}figure{margin:24px 0}blockquote{margin:20px}table{max-width:100%}button{font:inherit}
</style></head><body><nav>News • Politics • Science • Health</nav><main><article><header><h1>${next ? 'Second' : 'First'} complete article about the day's events</h1><p class="byline">By Jane Reporter</p><time datetime="2026-11-18">November 18, 2026</time></header>
<figure><img src="/photo.svg" alt="Readers in the public library" width="640" height="360"><figcaption>Readers consult original reporting at the public library.</figcaption></figure>
${Array.from({ length: 18 }, (_, i) => `${i === 7 ? '<h2>What the evidence shows</h2>' : ''}<p id="para-${i}">Paragraph ${String(i + 1).padStart(2, '0')} continues the original article. ${sentence} <a href="/reference-${i}">Read supporting source ${i + 1}</a>.</p>`).join('')}
<blockquote><p>A quotation retains the full original context of the reporting.</p></blockquote><ul><li>First essential finding stays available.</li><li>Second essential finding stays available.</li></ul>
<a id="next" href="/article-next">Read the next full article</a><button id="live" onclick="document.querySelector('#live-result').textContent='The source action worked successfully.'">Show the latest result</button><p id="live-result"></p>
</article></main></body></html>`;
const mediaIndex = `<!doctype html><html><head><meta charset="utf-8"><title>Editorial media index</title><style>body{font:16px/1.5 system-ui;margin:20px}main{max-width:1100px;margin:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));gap:24px}article{min-width:0}a{color:inherit;display:block}h2{font-size:24px}img,video{width:100%;height:180px;object-fit:cover}.photo{height:180px;background-size:cover}</style></head><body><main><h1>Editorial media stories</h1><div class="grid">${Array.from({ length: 12 }, (_, i) => `<article><a href="/article?story=${i}">${i % 3 === 0 ? `<img src="/photo.svg?story=${i}" alt="Original story photo ${i}">` : i % 3 === 1 ? `<div class="photo" style="background-image:url('/photo.svg?story=${i}')"></div>` : `<video poster="/photo.svg?story=${i}" preload="none" aria-label="Story video preview ${i}"></video>`}<h2>The original headline for editorial media story ${i}</h2></a></article>`).join('')}</div></main></body></html>`;
const server = createServer((req, res) => {
  if (req.url?.split('?')[0] === '/photo.svg') {
    res.setHeader('content-type', 'image/svg+xml');
    res.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#377d68"/><circle cx="200" cy="180" r="90" fill="#f1cb75"/></svg>',
    );
    return;
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(
    req.url === '/media-index'
      ? mediaIndex
      : article(req.url?.startsWith('/article-next')),
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'webable-presentation-'));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--enable-unsafe-extension-debugging'],
});
const wait = async (fn, message, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await fn();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(message);
};
let id;
async function engine(page) {
  const c = await ctx.newCDPSession(page),
    worlds = [];
  c.on('Runtime.executionContextCreated', (e) => worlds.push(e.context));
  await c.send('Runtime.enable');
  const w = worlds.find(
    (w) =>
      w.auxData?.type === 'isolated' && w.origin === `chrome-extension://${id}`,
  );
  if (!w) {
    await c.detach();
    return null;
  }
  return {
    call: async (expression) => {
      const r = await c.send('Runtime.evaluate', {
        contextId: w.id,
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) throw Error(r.exceptionDetails.text);
      return r.result.value;
    },
    close: () => c.detach(),
  };
}
async function calm(page, fn, arg, selector = '.wa-calm') {
  const c = await ctx.newCDPSession(page);
  try {
    const { root } = await c.send('DOM.getDocument', {
        depth: -1,
        pierce: true,
      }),
      roots = [];
    const walk = (n) => {
      for (const s of n.shadowRoots ?? []) {
        roots.push(s);
        walk(s);
      }
      for (const x of n.children ?? []) walk(x);
    };
    walk(root);
    for (const r of roots) {
      const { object } = await c.send('DOM.resolveNode', {
        backendNodeId: r.backendNodeId,
      });
      const v = await c.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        returnByValue: true,
        functionDeclaration: `function(arg){if(!this.querySelector(${JSON.stringify(selector)}))return null;return (${fn.toString()})(this,arg)}`,
        arguments: [{ value: arg ?? null }],
      });
      if (v.exceptionDetails) throw Error(v.exceptionDetails.text);
      if (v.result.value != null) return v.result.value;
    }
    return null;
  } finally {
    await c.detach();
  }
}
const snapshot = (root) => ({
  text: root.querySelector('.wa-page').textContent,
  links: [...root.querySelectorAll('.wa-page a[href]')].map((a) => a.href),
  photos: [...root.querySelectorAll('.wa-page img')].map((i) => ({
    loaded: i.complete && i.naturalWidth > 0,
    state: i.parentElement.dataset.state,
  })),
  overflow:
    root.querySelector('.wa-page').scrollWidth -
    root.querySelector('.wa-page').clientWidth,
});
const expand = (root) => {
  let n = 0;
  for (const b of root.querySelectorAll('.wa-disc__sum[aria-expanded=false]')) {
    b.click();
    n++;
  }
  return n;
};
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
  await ctx.serviceWorkers()[0].evaluate(async () => {
    await globalThis.__webable.setFit('rosa');
    await chrome.storage.local.remove('reader');
  });
  for (const width of [1440, 390]) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin + '/article');
    let api = await wait(() => engine(page), 'Engine did not start');
    await wait(
      () =>
        api.call(
          `['tailored','understood','calm'].includes(__webableEngine.getState().phase)`,
        ),
      'Article did not settle',
    );
    await api.call('__webableEngine.openCalm()');
    await wait(() => calm(page, snapshot), 'Article Calm did not open');
    for (let i = 0; i < 8; i++) {
      if (!(await calm(page, expand))) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    let view = await calm(page, snapshot);
    for (let i = 0; i < 18; i++)
      assert(
        view.text.includes(
          `Paragraph ${String(i + 1).padStart(2, '0')} continues`,
        ),
        `Lost paragraph ${i + 1} at ${width}px`,
      );
    for (let i = 0; i < 18; i++)
      assert(
        view.links.includes(origin + `/reference-${i}`),
        `Lost reference ${i + 1} at ${width}px`,
      );
    assert(view.photos.length > 0, 'Lost article photo');
    assert(view.overflow <= 1, 'Article scrolls sideways');
    await wait(async () => {
      view = await calm(page, snapshot);
      return view.photos.every((p) => p.loaded && p.state === 'ok');
    }, 'Article photo hidden');
    await wait(async () => {
      const fab = await calm(
        page,
        (root) => {
          const r = root.querySelector('.wa-fab').getBoundingClientRect();
          return { bottom: r.bottom };
        },
        null,
        '.wa-fab',
      );
      const dock = await calm(page, (root) => {
        const r = root
          .querySelector('.wa-calm .wa-dock')
          ?.getBoundingClientRect();
        return r ? { top: r.top } : null;
      });
      return fab && dock && fab.bottom <= dock.top + 1;
    }, 'WebAble launcher covers the main action');
    await page.screenshot({ path: join(out, `article-${width}.png`) });
    await calm(page, (root) => {
      root.querySelector('.wa-col').setAttribute('data-verify-stable', 'yes');
      return true;
    });
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.id = 'late-update';
      p.textContent =
        'A newly published update remains visible to the reader in the simplified article.';
      document.querySelector('article').append(p);
    });
    await wait(
      async () =>
        (await calm(page, snapshot))?.text.includes(
          'A newly published update remains visible',
        ),
      'Live article update was lost',
    );
    await page.evaluate(() => {
      document.querySelector('#late-update').firstChild.data =
        'An edited update also remains visible without losing the reading position.';
    });
    await wait(
      async () =>
        (await calm(page, snapshot))?.text.includes(
          'An edited update also remains visible',
        ),
      'Edited live text stayed stale',
    );
    await page.evaluate(() => document.querySelector('#late-update').remove());
    await wait(
      async () =>
        !(await calm(page, snapshot))?.text.includes(
          'An edited update also remains visible',
        ),
      'Removed live text stayed stale',
    );
    assert(
      await calm(
        page,
        (root) =>
          root.querySelector('.wa-col').getAttribute('data-verify-stable') ===
          'yes',
      ),
      'Live update remounted the reading surface',
    );
    // Click through the mirrored source button, then follow a mirrored article link.
    assert(
      await calm(page, (root) => {
        const b = [...root.querySelectorAll('button')].find(
          (b) => b.textContent === 'Show the latest result',
        );
        b?.click();
        return !!b;
      }),
      'Article action was lost',
    );
    await wait(
      () =>
        page
          .locator('#live-result')
          .textContent()
          .then((t) => t.includes('worked successfully')),
      'Mirrored article action failed',
    );
    assert(
      await calm(page, (root) => {
        const a = [...root.querySelectorAll('a[href]')].find((a) =>
          a.href.endsWith('/article-next'),
        );
        a?.click();
        return !!a;
      }),
      'Next article link missing',
    );
    await page.waitForURL(origin + '/article-next');
    await api.close();
    api = await wait(() => engine(page), 'Next article engine missing');
    await wait(
      () =>
        api.call(
          `['tailored','understood','calm'].includes(__webableEngine.getState().phase)`,
        ),
      'Next article did not settle',
    );
    await api.call('__webableEngine.openCalm()');
    await wait(
      async () =>
        (await calm(page, snapshot))?.text.includes('Second complete article'),
      'Next article retained stale content',
    );
    await api.call('__webableEngine.closeCalm()');
    if (width === 1440) {
      await api.call('__webableEngine.adjustColumn(-1)');
      await wait(
        () => api.call('__webableEngine.getState().column.on'),
        'Explicit column did not apply',
      );
      const tab = await control.evaluate(
        async (url) =>
          (await chrome.tabs.query({})).find((t) => t.url === url)?.id,
        origin + '/article-next',
      );
      await control.evaluate(async (t) => chrome.tabs.setZoom(t, 2), tab);
      await wait(
        () => api.call('__webableEngine.getState().pageZoom===2'),
        'Manual zoom not observed',
      );
      // BFCache returns fire persisted pageshow while preserving the existing controller.
      await page.evaluate(() =>
        window.dispatchEvent(
          new PageTransitionEvent('pageshow', { persisted: true }),
        ),
      );
      await new Promise((r) => setTimeout(r, 1000));
      assert.equal(
        await control.evaluate((t) => chrome.tabs.getZoom(t), tab),
        2,
        'Returning to a cached page reset the person’s zoom',
      );
      await control.evaluate((t) => chrome.tabs.setZoom(t, 1), tab);
      await wait(
        () => api.call('__webableEngine.getState().pageZoom===1'),
        'Zoom reset did not settle',
      );
      await api.call("__webableEngine.adjustColumn('off')");
      await wait(
        () => api.call('!__webableEngine.getState().column.on'),
        'Column reset did not settle',
      );
    }
    await page.evaluate(() => {
      history.pushState(null, '', '/article-spa');
      document.querySelector('h1').textContent =
        'A different article rendered by the source router';
      document.querySelector('#para-0').firstChild.data =
        'New route content replaces the previous article text. ';
    });
    await wait(
      () =>
        api.call(
          `!__webableEngine.getState().calm.open && ['tailored','understood'].includes(__webableEngine.getState().phase)`,
        ),
      'SPA navigation did not settle',
    );
    await api.call('__webableEngine.openCalm()');
    await wait(
      async () =>
        (await calm(page, snapshot))?.text.includes(
          'A different article rendered by the source router',
        ),
      'SPA retained the previous headline',
    );
    assert(
      (await calm(page, snapshot)).text.includes('New route content replaces'),
      'SPA retained previous article text',
    );
    assert.deepEqual(errors, []);
    evidence.push({
      width,
      paragraphs: 18,
      referenceLinks: 18,
      photos: view.photos.length,
      overflow: view.overflow,
      liveUpdate: true,
      sourceAction: true,
      navigation: true,
      spaNavigation: true,
      stableReadingSurface: true,
      editedAndRemovedText: true,
    });
    await api.close();
    await page.close();
    console.log(
      `✓ ${width}px: complete article, references, photos, live update, mirrored action and navigation`,
    );
  }
  const mediaPage = await ctx.newPage();
  await mediaPage.setViewportSize({ width: 1440, height: 900 });
  await mediaPage.goto(origin + '/media-index');
  const mediaApi = await wait(
    () => engine(mediaPage),
    'Media engine did not start',
  );
  await wait(
    () =>
      mediaApi.call(
        `['tailored','understood','calm'].includes(__webableEngine.getState().phase)`,
      ),
    'Media page did not settle',
  );
  await mediaApi.call('__webableEngine.openCalm()');
  await wait(() => calm(mediaPage, snapshot), 'Media Calm view did not open');
  for (let i = 0; i < 8; i++) {
    if (!(await calm(mediaPage, expand))) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const media = await wait(async () => {
    const v = await calm(mediaPage, snapshot);
    return v?.photos.length === 12 &&
      v.photos.every((p) => p.loaded && p.state === 'ok')
      ? v
      : null;
  }, 'Some source photos/backgrounds/video previews were lost');
  for (let i = 0; i < 12; i++)
    assert(
      media.links.includes(origin + `/article?story=${i}`),
      'A media story lost its destination',
    );
  await mediaPage.screenshot({ path: join(out, 'media-index.png') });
  await mediaApi.close();
  evidence.push({
    mediaIndex: {
      linkedStories: 12,
      visiblePhotos: 12,
      types: ['img', 'CSS background', 'video poster'],
    },
  });
  console.log(
    '✓ News media: all 12 photos, CSS backgrounds and video previews retain their story destinations',
  );
  // Optional bounded real-site spot checks; the extension's API remains blocked.
  for (const url of (process.env.VERIFY_LIVE_SITES ?? '')
    .split(',')
    .filter(Boolean)) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const api = await wait(
      () => engine(page),
      'Live-site engine did not start',
    );
    await wait(
      () =>
        api.call(
          `['tailored','understood','calm'].includes(__webableEngine.getState().phase)`,
        ),
      'Live site did not settle',
    );
    await api.call('__webableEngine.openCalm()');
    const view = await wait(async () => {
      const v = await calm(page, snapshot);
      return v?.photos.some((p) => p.loaded && p.state === 'ok') ? v : null;
    }, 'No live-site photo became visible');
    const zoom = await api.call('__webableEngine.getState().pageZoom');
    assert.equal(zoom, 1, 'Live site was automatically zoomed');
    const lead = await calm(
      page,
      (root) =>
        root.querySelector('.wa-leadstory')?.getAttribute('href') ?? 'article',
    );
    const record = {
      url,
      zoom,
      lead,
      links: view.links.length,
      loadedPhotos: view.photos.filter((p) => p.loaded && p.state === 'ok')
        .length,
    };
    await page.screenshot({
      path: join(out, `${new URL(url).hostname}-calm.png`),
    });
    evidence.push({ live: record });
    console.log(`✓ Live site: ${JSON.stringify(record)}`);
    await api.close();
    await page.close();
  }
  await writeFile(
    join(out, 'verification.json'),
    JSON.stringify({ api: 'blocked', evidence }, null, 2),
  );
  console.log(`No paid API calls. Evidence: ${out}`);
} catch (e) {
  for (const [i, p] of ctx.pages().entries())
    await p.screenshot({ path: join(out, `failure-${i}.png`) }).catch(() => {});
  throw e;
} finally {
  await ctx.close();
  await new Promise((r) => server.close(r));
  await rm(profile, { recursive: true, force: true });
}
