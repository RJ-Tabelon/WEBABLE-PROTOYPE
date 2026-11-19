import { expect, test, type Page } from '@playwright/test';

import type { LayoutFeatures } from '@webable/core/triage/types';

/**
 * WP3a: layout features for triage (docs/10 §3.1), measured by the
 * extraction pass and sent as PageSignals.layout. Person-independent:
 * every value here is about the page, never about the person.
 */

async function open(page: Page, path: string): Promise<void> {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/, (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
  await page.goto(path, { waitUntil: 'load' });
  await page.addScriptTag({ url: '/__v2/skeleton.js' });
  await page.waitForFunction(() => typeof window.__v2skeleton !== 'undefined');
}

async function features(page: Page): Promise<LayoutFeatures> {
  const f = await page.evaluate(() => window.__v2skeleton.features());
  if (!f.layout) throw new Error('no layout features');
  return f.layout;
}

const NO_KIND: LayoutFeatures['kind'] = {
  product: false,
  editor: false,
  application: false,
  canvas: false,
  videoPlayer: false,
  paywall: false,
  blockingOverlay: false,
  password: false,
  payment: false,
};

/** Every number is finite and in range, whatever the page. */
function sane(f: LayoutFeatures): void {
  const share = (v: number): void => {
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  };
  share(f.slack.clipRiskShare);
  share(f.slack.fixedHeightTextShare);
  share(f.slack.overlayTextShare);
  share(f.occlusion);
  share(f.records.mainShare);
  if (f.slack.rowSlackMin !== null)
    expect(f.slack.rowSlackMin).toBeGreaterThanOrEqual(0);
  expect(f.density.leafPer100k).toBeGreaterThanOrEqual(0);
  expect(f.density.corners).toBeGreaterThanOrEqual(0);
  expect(f.records.largest).toBeGreaterThanOrEqual(f.records.count > 0 ? 5 : 0);
  expect(f.readerable).toBeGreaterThanOrEqual(0);
  expect(f.nav.primaryLinks).toBeGreaterThanOrEqual(0);
}

test.describe('layout features per page', () => {
  test('feed: records, pinned chrome, clipped titles, badges over thumbnails', async ({
    page,
  }) => {
    await open(page, '/v2/feed.html');
    const f = await features(page);
    sane(f);
    expect(f.bodyPx).toBe(16);
    expect(f.records.largest).toBe(24);
    expect(f.records.count).toBeGreaterThanOrEqual(2);
    expect(f.records.mainShare).toBeGreaterThan(0.6);
    // The fixed masthead (1280x56): 7% of 1280x800. The fixed mini guide
    // sits beside main's column and covers nothing of it (eval M1).
    expect(f.occlusion).toBeGreaterThan(0.06);
    expect(f.occlusion).toBeLessThan(0.1);
    expect(f.slack.clipRiskShare).toBeGreaterThan(0.2);
    expect(f.slack.overlayTextShare).toBeGreaterThan(0);
    expect(f.kind).toEqual(NO_KIND);
    expect(f.readerable).toBeLessThan(20);
    expect(f.nav.searchVisible).toBe(true);
    expect(f.nav.primaryLinks).toBeGreaterThanOrEqual(5);
  });

  test('inbox: one large record list, cut-off text, no blockers', async ({
    page,
  }) => {
    await open(page, '/v2/inbox.html');
    const f = await features(page);
    sane(f);
    expect(f.records.largest).toBe(20);
    expect(f.records.mainShare).toBeGreaterThan(0.5);
    expect(f.slack.clipRiskShare).toBeGreaterThan(0.3);
    // Subjects already overflow their nowrap cells.
    expect(f.slack.rowSlackMin).not.toBeNull();
    expect(f.slack.rowSlackMin as number).toBeLessThan(1);
    expect(f.kind).toEqual(NO_KIND);
    expect(f.nav.searchVisible).toBe(true);
    expect(f.nav.primaryLinks).toBeGreaterThanOrEqual(8);
  });

  test('product: product JSON-LD and the result grid', async ({ page }) => {
    await open(page, '/v2/product.html');
    const f = await features(page);
    sane(f);
    expect(f.kind).toEqual({ ...NO_KIND, product: true });
    expect(f.records.largest).toBeGreaterThanOrEqual(10);
    expect(f.bodyPx).toBe(14);
    expect(f.nav.searchVisible).toBe(true);
  });

  test('article: readerable prose, a small cookie banner is not a wall', async ({
    page,
  }) => {
    await open(page, '/v2/article.html');
    const f = await features(page);
    sane(f);
    expect(f.readerable).toBeGreaterThan(20);
    expect(f.bodyPx).toBe(17);
    expect(f.kind).toEqual(NO_KIND);
    expect(f.occlusion).toBeGreaterThan(0);
    expect(f.occlusion).toBeLessThan(0.15);
    expect(f.records.mainShare).toBeLessThan(0.3);
    expect(f.density.regions).toBeGreaterThan(0);
  });

  test('editor app: the editor flag; no search', async ({ page }) => {
    await open(page, '/v2/app.html');
    const f = await features(page);
    sane(f);
    expect(f.kind).toEqual({ ...NO_KIND, editor: true });
    expect(f.nav.searchVisible).toBe(false);
  });
});

test.describe('occlusion and representability (eval M1, M2)', () => {
  test('only boxes that cover what scrolls under them count: a stuck bar; not a sticky column, a rail beside main, a header in its own space or a pass-through layer', async ({
    page,
  }) => {
    await open(page, '/v2/feat-occlusion.html');
    const f = await features(page);
    sane(f);
    // The 49 px bar over 1280x800 (on the 16 px grid: 64 px), nothing else.
    expect(f.occlusion).toBeGreaterThan(0.05);
    expect(f.occlusion).toBeLessThanOrEqual(0.08);
    // The same header, now over the text (it no longer has its own space).
    await page.addStyleTag({ content: 'main { padding-top: 24px; }' });
    expect((await features(page)).occlusion).toBeGreaterThan(0.3);
  });

  test('a muted hero playing on its own is a picture, not a player; controls, a seek bar or sound make one', async ({
    page,
  }) => {
    const hero = async (attrs: string, around = ''): Promise<boolean> => {
      await open(page, '/v2/blank.html');
      await page.evaluate(
        ([a, wrap]) => {
          document
            .querySelector('main')
            ?.insertAdjacentHTML(
              'afterbegin',
              `<div class="stage"><video ${a} style="width:1100px;height:560px"></video>${wrap}</div>`,
            );
        },
        [attrs, around] as const,
      );
      return (await features(page)).kind.videoPlayer;
    };
    expect(await hero('muted loop autoplay playsinline')).toBe(false);
    expect(await hero('muted autoplay')).toBe(false);
    expect(await hero('muted loop')).toBe(false);
    expect(await hero('controls muted loop autoplay')).toBe(true);
    expect(await hero('')).toBe(true);
    expect(
      await hero('muted', '<div role="slider" aria-label="Seek"></div>'),
    ).toBe(true);
    expect(
      await hero(
        'muted',
        '<button aria-label="Play">▶</button><button aria-label="Mute">🔇</button>',
      ),
    ).toBe(true);
  });

  test('a full-viewport backdrop with a prompt on top blocks the page, dialog role or not', async ({
    page,
  }) => {
    await open(page, '/v2/article.html');
    await page.evaluate(() => {
      const backdrop = document.createElement('div');
      backdrop.id = 'redir-overlay-backdrop';
      backdrop.setAttribute(
        'style',
        'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100',
      );
      const prompt = document.createElement('div');
      prompt.id = 'redir-overlay';
      prompt.setAttribute(
        'style',
        'position:fixed;left:35%;top:30%;width:30%;height:28%;background:#fff;z-index:101',
      );
      prompt.innerHTML =
        '<p>Looks like you are in another country.</p><button>Stay here</button>';
      document.body.append(backdrop, prompt);
    });
    expect((await features(page)).kind.blockingOverlay).toBe(true);
    // A page shell pinned over the viewport around main is no backdrop.
    await open(page, '/v2/blank.html');
    await page.evaluate(() => {
      const shell = document.createElement('div');
      shell.setAttribute(
        'style',
        'position:fixed;inset:0;background:#fff;overflow:auto',
      );
      const bar = document.createElement('div');
      bar.setAttribute(
        'style',
        'position:fixed;left:30%;top:20%;width:300px;height:200px;background:#eee',
      );
      bar.textContent = 'Tools';
      const main = document.querySelector('main') as HTMLElement;
      main.insertAdjacentHTML(
        'beforeend',
        '<p>' + 'Running text in the shell. '.repeat(30) + '</p>',
      );
      shell.append(main, bar);
      document.body.append(shell);
    });
    expect((await features(page)).kind.blockingOverlay).toBe(false);
  });

  test('records fill a virtualised main: the share counts the screens a reader meets', async ({
    page,
  }) => {
    await open(page, '/v2/blank.html');
    await page.evaluate(() => {
      const main = document.querySelector('main') as HTMLElement;
      // Craigslist: the list is 763,570 px tall; only its window is rendered.
      main.style.height = '760000px';
      main.style.position = 'relative';
      const list = document.createElement('ol');
      list.setAttribute('style', 'margin:0;padding:0;list-style:none');
      for (let i = 0; i < 40; i++) {
        const li = document.createElement('li');
        li.className = 'result';
        li.setAttribute('style', 'height:72px;border-bottom:1px solid #ddd');
        li.innerHTML = `<a href="/item/${i}">Bike number ${i}</a> <span class="price">$${100 + i}</span> <span class="where">Oakland</span>`;
        list.append(li);
      }
      main.append(list);
    });
    const f = await features(page);
    expect(f.records.largest).toBe(40);
    expect(f.records.mainShare).toBeGreaterThan(0.6);
  });

  test('a short guidance page reads as a document by its outline though Readability scores it low', async ({
    page,
  }) => {
    await open(page, '/v2/feat-guidance.html');
    const f = await features(page);
    expect(f.readerable).toBeLessThan(20);
    expect(f.outlined).toBe(true);
    // A page with a title and little else is no document.
    await open(page, '/v2/blank.html');
    expect((await features(page)).outlined).toBe(false);
  });
});

test.describe('blockers', () => {
  test('a modal dialog or a consent wall blocks the page', async ({ page }) => {
    await open(page, '/v2/article.html');
    await page.evaluate(() => {
      const d = document.createElement('dialog');
      d.innerHTML = '<p>Sign up for the newsletter</p><button>Close</button>';
      document.body.appendChild(d);
      d.showModal();
    });
    expect((await features(page)).kind.blockingOverlay).toBe(true);

    await open(page, '/v2/article.html');
    await page.evaluate(() => {
      const wall = document.createElement('div');
      wall.id = 'onetrust-consent-sdk';
      wall.setAttribute(
        'style',
        'position:fixed;inset:0;background:rgba(0,0,0,.6)',
      );
      wall.innerHTML =
        '<div role="dialog" aria-modal="true" style="position:absolute;left:30%;top:30%;width:40%;height:30%;background:#fff"><p>Your privacy choices</p><button>Accept</button></div>';
      document.body.appendChild(wall);
    });
    expect((await features(page)).kind.blockingOverlay).toBe(true);

    // A small dialog without a backdrop does not block.
    await open(page, '/v2/article.html');
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.setAttribute('role', 'dialog');
      d.setAttribute(
        'style',
        'position:fixed;right:16px;bottom:16px;width:240px;height:120px;background:#fff',
      );
      d.textContent = 'Chat with us';
      document.body.appendChild(d);
    });
    expect((await features(page)).kind.blockingOverlay).toBe(false);
  });

  test('paywalls: JSON-LD isAccessibleForFree=false or a pinned paywall layer', async ({
    page,
  }) => {
    await open(page, '/v2/article.html');
    await page.evaluate(() => {
      const s = document.querySelector('script[type="application/ld+json"]');
      if (s)
        s.textContent = s.textContent!.replace(
          '"isAccessibleForFree": true',
          '"isAccessibleForFree": "False"',
        );
    });
    expect((await features(page)).kind.paywall).toBe(true);

    await open(page, '/v2/article.html');
    await page.evaluate(() => {
      const p = document.createElement('div');
      p.className = 'article-paywall';
      p.setAttribute(
        'style',
        'position:fixed;left:0;right:0;bottom:0;height:45vh;background:#fff',
      );
      p.textContent = 'Subscribe to keep reading';
      document.body.appendChild(p);
    });
    expect((await features(page)).kind.paywall).toBe(true);
  });

  test('password, payment, canvas, video player and application pages', async ({
    page,
  }) => {
    const cases: Array<[string, keyof LayoutFeatures['kind']]> = [
      ['<input type="password" aria-label="Password">', 'password'],
      ['<input autocomplete="cc-number" aria-label="Card">', 'payment'],
      [
        '<iframe name="__privateStripeFrame77" srcdoc="x" style="width:300px;height:40px"></iframe>',
        'payment',
      ],
      [
        '<canvas width="1200" height="700" style="width:1200px;height:700px"></canvas>',
        'canvas',
      ],
      ['<video style="width:960px;height:540px"></video>', 'videoPlayer'],
      [
        '<div role="application" style="width:1000px;height:600px">map</div>',
        'application',
      ],
    ];
    for (const [html, flag] of cases) {
      await open(page, '/v2/blank.html');
      await page.evaluate((h) => {
        document.querySelector('main')?.insertAdjacentHTML('afterbegin', h);
      }, html);
      const f = await features(page);
      expect(f.kind[flag], html).toBe(true);
      expect(
        Object.entries(f.kind).filter(([k, v]) => v && k !== flag),
        html,
      ).toEqual([]);
    }
    // Hidden fields do not count.
    await open(page, '/v2/blank.html');
    await page.evaluate(() => {
      document
        .querySelector('main')
        ?.insertAdjacentHTML(
          'beforeend',
          '<form hidden><input type="password"><input autocomplete="cc-number"></form>',
        );
    });
    expect((await features(page)).kind).toEqual(NO_KIND);
  });
});

test.describe('zoom guard baseline', () => {
  test('primary navigation and search drop when a breakpoint hides them', async ({
    page,
  }) => {
    await open(page, '/v2/article.html');
    const wide = await features(page);
    expect(wide.nav.primaryLinks).toBeGreaterThanOrEqual(7);
    expect(wide.nav.searchVisible).toBe(true);
    // The kind of reflow a page scale causes: the section links collapse.
    await page.addStyleTag({
      content:
        '.site-header nav, .site-header form { display: none !important; }',
    });
    const narrow = await features(page);
    expect(narrow.nav.primaryLinks).toBeLessThan(wide.nav.primaryLinks);
    expect(narrow.nav.searchVisible).toBe(false);
  });
});

test.describe('budget', () => {
  test('layout features stay inside the extraction budget on a large page', async ({
    page,
  }) => {
    await open(page, '/engine/large.html');
    await page.evaluate(() => window.__v2skeleton.features());
    const { layout, perf } = await page.evaluate(() =>
      window.__v2skeleton.features(),
    );
    expect(layout).not.toBeNull();
    expect(layout?.records.largest).toBe(400);
    expect(layout?.nav.primaryLinks).toBe(300);
    // The layout pass reports its parts (layout_*) and the rest (layout).
    const layoutMs = Object.entries(perf.phases)
      .filter(([k]) => k === 'layout' || k.startsWith('layout_'))
      .reduce((sum, [, v]) => sum + v, 0);
    expect(layoutMs).toBeLessThan(15);
    expect(perf.busyMs).toBeLessThan(60);
    test.info().annotations.push({
      type: 'layout budget',
      description: `large.html: layout ${layoutMs.toFixed(1)} ms of ${perf.busyMs} ms busy`,
    });
  });

  test('typical pages: the whole extraction stays under 30 ms', async ({
    page,
  }) => {
    for (const fixture of ['feed', 'inbox', 'product', 'article', 'app']) {
      await open(page, `/v2/${fixture}.html`);
      await page.evaluate(() => window.__v2skeleton.features());
      const { perf } = await page.evaluate(() =>
        window.__v2skeleton.features(),
      );
      expect(perf.busyMs, fixture).toBeLessThan(30);
    }
  });
});
