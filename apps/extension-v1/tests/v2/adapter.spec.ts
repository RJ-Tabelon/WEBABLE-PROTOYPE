import { expect, test, type Page } from '@playwright/test';

import type { OpId } from '@webable/core/ops/catalog';
import type { AdaptationPlan } from '@webable/core/policy/types';
import type { TriageVerdict } from '@webable/core/triage/types';

import { plan } from '../engine/helpers';

/**
 * The content-script adapter's Fit view side (docs/10 §4, §5.1, §7) with a
 * stand-in worker and a stand-in Fit view runtime: the EngineApi, the open
 * and close flow, tab mode, the zoom guard, and the in-page offer.
 */

const hello = (fitViewTab = false) => ({
  enabled: true,
  paused: false,
  prePaint: [] as OpId[],
  tabSession: 'tab-1',
  reduceMotion: true,
  shortcuts: { focusLayer: '', undoAll: '' },
  fitViewTab,
});

const triage = (over: Partial<TriageVerdict> = {}): TriageVerdict => ({
  version: 'triage-1.0.0',
  verdict: 'compose',
  k: 2.4,
  zoom: 1.5,
  zMax: 1.5,
  residual: 1.6,
  needs: {
    text: 'compose',
    targets: 'tailor',
    clutter: 'fits',
    occlusion: 'fits',
    contrast: 'fits',
    motion: 'fits',
  },
  reasons: [
    { kind: 'small_text', k: 2.4 },
    { kind: 'cant_stretch', k: 2.4, zMax: 1.5 },
  ],
  representable: true,
  blockers: [],
  ...over,
});

const withTriage = (
  p: AdaptationPlan,
  t: TriageVerdict | undefined,
  zoom?: number,
): AdaptationPlan => ({ ...p, triage: t, zoom });

async function open(
  page: Page,
  fixture = 'adapter-page',
  query = '',
): Promise<void> {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/, (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
  await page.goto(`/v2/${fixture}.html${query}`);
  await page.addScriptTag({ url: '/__v2/adapter.js' });
  await page.waitForFunction(() => typeof window.__v2adapter !== 'undefined');
}

type StartOpts = Parameters<Window['__v2adapter']['start']>[0];
const start = (page: Page, opts: StartOpts): Promise<boolean> =>
  page.evaluate((o) => window.__v2adapter.start(o as never), opts);

const sent = (page: Page) => page.evaluate(() => window.__v2adapter.sent());
const sentOf = async (page: Page, type: string) =>
  (await sent(page)).filter((m) => m.type === type);
const calls = (page: Page) =>
  page.evaluate(() => window.__v2adapter.runtimeCalls());
const state = (page: Page) => page.evaluate(() => window.__v2adapter.state());
const layer = (page: Page) => page.evaluate(() => window.__v2adapter.layer());
const worker = (page: Page, msg: unknown) =>
  page.evaluate((m) => window.__v2adapter.workerMessage(m), msg);

test.describe('adapter: Fit view', () => {
  test('exposes the EngineApi to fitview.js: skeleton, freeze, send, onRoute, measured', async ({
    page,
  }) => {
    await open(page);
    await start(page, { hello: hello(), plan: plan([]) });
    expect(await state(page)).toMatchObject({ exposed: true, frozen: false });
    const api = await page.evaluate(() => window.__v2adapter.engineApi());
    expect(api?.methods).toEqual([
      'freeze',
      'measured',
      'onRoute',
      'send',
      'skeleton',
    ]);
    expect(api?.measured).toBe(42);
    expect(api?.skeleton?.nodes).toBeGreaterThan(10);
    expect(api?.skeleton?.first).toBe('body');
    // Gone with the adapter.
    await page.evaluate(() => window.__v2adapter.stop());
    expect(
      await page.evaluate(() => window.__v2adapter.engineApi()),
    ).toBeNull();
  });

  test('sw:fitview open: skeleton -> cs:fitview-request -> runtime.open; Tailor frozen; opened reported', async ({
    page,
  }) => {
    await open(page);
    await start(page, { hello: hello(), plan: plan([]) });
    expect(
      await worker(page, {
        type: 'sw:fitview',
        action: 'open',
        reason: 'popup',
      }),
    ).toEqual({ ok: true });
    await expect.poll(async () => (await calls(page)).length).toBe(1);
    const [call] = await calls(page);
    const [request] = await sentOf(page, 'cs:fitview-request');
    expect(request).toMatchObject({ reason: 'popup' });
    const skeleton = (
      request as { skeleton: { extractionId: string; nodes: unknown[] } }
    ).skeleton;
    expect(call).toMatchObject({
      type: 'open',
      reason: 'popup',
      extractionId: skeleton.extractionId,
      nodes: skeleton.nodes.length,
      registry: true,
      engineApi: true,
    });
    expect(await state(page)).toMatchObject({ frozen: true, tabMode: true });
    await expect
      .poll(async () =>
        (await sentOf(page, 'cs:fitview-event')).map(
          (m) => (m as { event: unknown }).event,
        ),
      )
      .toEqual([
        expect.objectContaining({
          kind: 'opened',
          source: 'heuristic',
          reason: 'popup',
        }),
      ]);
    // A second open while open does nothing.
    await worker(page, {
      type: 'sw:fitview',
      action: 'open',
      reason: 'shortcut',
    });
    await page.waitForTimeout(200);
    expect((await sentOf(page, 'cs:fitview-request')).length).toBe(1);
  });

  test('while open, Tailor does not replan on a route; closing thaws it and plans the new view', async ({
    page,
  }) => {
    await open(page);
    await start(page, { hello: hello(), plan: plan([]) });
    await worker(page, { type: 'sw:fitview', action: 'open', reason: 'popup' });
    await expect
      .poll(() => page.evaluate(() => window.__v2adapter.runtimeOpen()))
      .toBe(true);
    const signalsBefore = (await sentOf(page, 'cs:signals')).length;
    await page.evaluate(() =>
      history.pushState({}, '', '/v2/adapter-page.html?c=2'),
    );
    await page.waitForTimeout(1500);
    expect((await sentOf(page, 'cs:signals')).length).toBe(signalsBefore);
    expect(
      await worker(page, {
        type: 'sw:fitview',
        action: 'close',
        reason: 'original',
      }),
    ).toEqual({
      ok: true,
    });
    expect((await calls(page)).at(-1)).toMatchObject({
      type: 'close',
      reason: 'original',
    });
    await expect
      .poll(async () => (await sentOf(page, 'cs:signals')).length)
      .toBe(signalsBefore + 1);
    expect(await state(page)).toMatchObject({ frozen: false, tabMode: false });
  });

  test('the runtime closing itself (Original page) thaws Tailor and ends tab mode', async ({
    page,
  }) => {
    await open(page);
    await start(page, { hello: hello(), plan: plan([]) });
    await worker(page, {
      type: 'sw:fitview',
      action: 'open',
      reason: 'shortcut',
    });
    await expect
      .poll(() => page.evaluate(() => window.__v2adapter.runtimeOpen()))
      .toBe(true);
    await page.evaluate(() => window.__v2adapter.closeFromRuntime('original'));
    await expect
      .poll(() => state(page))
      .toMatchObject({ frozen: false, tabMode: false });
  });

  test('a missing runtime after an ok reply is reported as a closed error, with one calm line', async ({
    page,
  }) => {
    await open(page);
    await start(page, {
      hello: hello(),
      plan: plan([]),
      fit: { mode: 'no-runtime' },
    });
    await worker(page, { type: 'sw:fitview', action: 'open', reason: 'popup' });
    await expect
      .poll(async () =>
        (await sentOf(page, 'cs:fitview-event')).map(
          (m) => (m as { event: unknown }).event,
        ),
      )
      .toEqual([{ kind: 'closed', reason: 'error', afterMs: 0, actions: 0 }]);
    expect(await state(page)).toMatchObject({ frozen: false });
    expect((await layer(page))?.toast?.text).toBe(
      'Fit view couldn’t open on this page. Try again.',
    );
  });

  test('the worker saying no: the person who asked hears why; nothing opens', async ({
    page,
  }) => {
    await open(page);
    await start(page, {
      hello: hello(),
      plan: plan([]),
      fit: { mode: 'unavailable', why: 'blocked_overlay' },
    });
    await worker(page, { type: 'sw:fitview', action: 'open', reason: 'popup' });
    await expect
      .poll(async () => (await layer(page))?.toast?.text)
      .toBe('Answer the message on this page first, then open Fit view.');
    expect(await calls(page)).toEqual([]);
    expect(await state(page)).toMatchObject({ frozen: false });
  });

  test('sw:fitview-spec and sw:zoom reach the open runtime; sw:pause closes it', async ({
    page,
  }) => {
    await open(page);
    await start(page, { hello: hello(), plan: plan([]) });
    await worker(page, { type: 'sw:fitview', action: 'open', reason: 'popup' });
    await expect
      .poll(() => page.evaluate(() => window.__v2adapter.runtimeOpen()))
      .toBe(true);
    const envelope = {
      source: 'planner',
      extractionId: 'x',
      validated: {
        spec: {
          v: 1,
          page_type: 'other',
          primary_task: 'read',
          sections: [],
          collections: [],
        },
        primary: 0,
        rest: [],
        repairs: [],
      },
      createdAt: 1,
    };
    expect(await worker(page, { type: 'sw:fitview-spec', envelope })).toEqual({
      ok: true,
    });
    expect(
      await worker(page, { type: 'sw:zoom', zoom: 1.25, owner: 'person' }),
    ).toEqual({ ok: true });
    expect(await worker(page, { type: 'sw:pause' })).toEqual({ ok: true });
    expect(
      (await calls(page)).map((c) => [
        c.type,
        c.source ?? c.zoom ?? c.reason ?? null,
      ]),
    ).toEqual([
      ['open', 'popup'],
      ['offerSpec', 'planner'],
      ['setZoom', 1.25],
      ['close', 'paused'],
    ]);
    expect(await state(page)).toMatchObject({ frozen: false, zoom: 1.25 });
  });

  test('tab mode: opens with reason tab_mode once the DOM has been quiet for 500 ms', async ({
    page,
  }) => {
    await open(page);
    const lastMutation = await page.evaluate(async (h) => {
      await window.__v2adapter.start({
        hello: h,
        plan: {
          id: 'p1',
          createdAt: 0,
          category: 'other',
          basis: 'local',
          ops: [],
        },
      } as never);
      // The page keeps changing for a second after the plan applied.
      const ticker = document.getElementById('ticker')!;
      let last = performance.now();
      await new Promise<void>((resolve) => {
        let n = 0;
        const t = setInterval(() => {
          ticker.textContent = String(++n);
          last = performance.now();
          if (n >= 10) {
            clearInterval(t);
            resolve();
          }
        }, 100);
      });
      return last;
    }, hello(true));
    await expect
      .poll(async () => (await calls(page)).length, { timeout: 5000 })
      .toBe(1);
    const [call] = await calls(page);
    const [request] = await sentOf(page, 'cs:fitview-request');
    expect(call?.reason).toBe('tab_mode');
    expect(request?.at).toBeGreaterThanOrEqual(lastMutation + 480);
    expect(request?.at).toBeLessThan(lastMutation + 2000);
  });

  test('tab mode waits out a modal the site has open, then opens', async ({
    page,
  }) => {
    await open(page);
    await page.evaluate(() =>
      (document.getElementById('consent') as HTMLDialogElement).showModal(),
    );
    await start(page, {
      hello: hello(true),
      plan: plan([]),
      timing: { tabQuietMs: 200 },
    });
    await page.waitForTimeout(1200);
    expect(await sentOf(page, 'cs:fitview-request')).toEqual([]);
    await page.evaluate(() =>
      (document.getElementById('consent') as HTMLDialogElement).close(),
    );
    await expect
      .poll(async () => (await calls(page)).map((c) => c.reason), {
        timeout: 5000,
      })
      .toEqual(['tab_mode']);
  });

  test('tab mode on a page Fit view cannot re-present: one line, no request', async ({
    page,
  }) => {
    await open(page);
    await start(page, {
      hello: hello(true),
      plan: withTriage(
        plan([]),
        triage({
          verdict: 'tailor',
          representable: false,
          blockers: ['video_player'],
        }),
      ),
      timing: { tabQuietMs: 100 },
    });
    await expect
      .poll(async () => (await layer(page))?.toast?.text)
      .toBe('Videos play best on the original page.');
    expect((await layer(page))?.toast?.buttons).toEqual(['Close']);
    expect(await sentOf(page, 'cs:fitview-request')).toEqual([]);
  });

  test('zoom guard: after a plan with zoom > 1 settles, the viewport is reported; a step-down is guarded again', async ({
    page,
  }) => {
    await open(page);
    await start(page, {
      hello: hello(),
      plan: withTriage(plan([]), triage({ verdict: 'tailor' }), 1.5),
    });
    // The worker's chrome.tabs.setZoom(1.5): the layout viewport shrinks to 1280 / 1.5.
    await page.setViewportSize({ width: 853, height: 533 });
    await expect
      .poll(
        async () =>
          (await sentOf(page, 'cs:applied')).filter((m) => 'viewport' in m)
            .length,
      )
      .toBe(1);
    const report = (await sentOf(page, 'cs:applied')).find(
      (m) => 'viewport' in m,
    ) as unknown as {
      viewport: {
        zoom: number;
        overflowPx: number;
        navLinks: number;
        searchVisible: boolean;
      };
      planId: string;
    };
    expect(report.viewport.zoom).toBe(1.5);
    expect(report.viewport.overflowPx).toBeGreaterThanOrEqual(0);
    expect(typeof report.viewport.navLinks).toBe('number');
    expect(typeof report.viewport.searchVisible).toBe('boolean');
    // Below 900 CSS px this page hides three of its five primary links.
    expect(report.viewport.navLinks).toBeLessThanOrEqual(3);
    // The worker steps down to 125%; its plans carry the new scale from now on.
    await page.evaluate(
      (p) => window.__v2adapter.setPlan(p as never),
      withTriage(plan([]), triage({ verdict: 'tailor' }), 1.25),
    );
    // sw:zoom: the tab's factor, and the page scale relative to the person's zoom.
    await worker(page, {
      type: 'sw:zoom',
      zoom: 1.25,
      owner: 'webable',
      scale: 1.25,
    });
    await page.setViewportSize({ width: 1024, height: 640 });
    await expect
      .poll(async () =>
        (await sentOf(page, 'cs:applied'))
          .filter((m) => 'viewport' in m)
          .map(
            (m) =>
              (m as unknown as { viewport: { zoom: number } }).viewport.zoom,
          ),
      )
      .toEqual([1.5, 1.25]);
  });

  test('zoom guard: nothing is reported for a plan without page scale', async ({
    page,
  }) => {
    await open(page);
    await start(page, {
      hello: hello(),
      plan: withTriage(plan([]), triage({ verdict: 'fits' }), 1),
    });
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.waitForTimeout(2200);
    expect(
      (await sentOf(page, 'cs:applied')).filter((m) => 'viewport' in m),
    ).toEqual([]);
  });

  test('offer on the first-visit toast: "Undo" and "Simplify this page" on one surface; accepting opens with reason offer', async ({
    page,
  }) => {
    await open(page);
    await start(page, {
      hello: hello(),
      plan: withTriage(
        plan([{ op: 'reading_guide', level: 0 }]),
        triage(),
        1.5,
      ),
      announce: true,
      offer: true,
    });
    const l = await layer(page);
    expect(l?.toast?.text).toBe('WebAble turned on the reading guide.');
    expect(l?.toast?.buttons).toEqual(['Close', 'Undo', 'Simplify this page']);
    expect(l?.fitViewOffer).toBe('toast');
    expect(l?.offer).toBeNull();
    await expect
      .poll(async () => (await layer(page))?.live)
      .toContain('You can also simplify this page.');
    expect(
      await page.evaluate(() => window.__v2adapter.press('Simplify this page')),
    ).toBe(true);
    await expect
      .poll(async () => (await calls(page)).map((c) => c.reason))
      .toEqual(['offer']);
    expect((await sentOf(page, 'cs:fitview-request'))[0]).toMatchObject({
      reason: 'offer',
    });
    expect((await layer(page))?.toast).toBeNull();
  });

  test('offer chip when there is no toast: after the quiet period; "Not now" holds for the document', async ({
    page,
  }) => {
    await open(page);
    await start(page, {
      hello: hello(),
      plan: withTriage(plan([]), triage()),
      offer: true,
      timing: { offerQuietMs: 300 },
    });
    expect((await layer(page))?.offer).toBeNull();
    await expect
      .poll(async () => (await layer(page))?.offer?.question)
      .toBe('Show this page more simply?');
    const l = await layer(page);
    expect(l?.offer?.buttons).toEqual([
      'Close',
      'Simplify this page',
      'Not now',
    ]);
    expect(l?.offer?.tabIndexes).toEqual([-1, -1, -1]);
    expect(l?.fitViewOffer).toBe('chip');
    expect(await page.evaluate(() => document.body.innerText)).not.toContain(
      'Fit view',
    );
    await page.evaluate(() => window.__v2adapter.press('Not now'));
    expect(await state(page)).toMatchObject({ offer: 'declined' });
    // A new view in the same document is not offered again.
    await page.evaluate(() =>
      history.pushState({}, '', '/v2/adapter-page.html?c=1'),
    );
    await page.waitForTimeout(1500);
    expect((await layer(page))?.offer).toBeNull();
    expect(await sentOf(page, 'cs:fitview-request')).toEqual([]);
  });

  test('offer chip: Simplify this page opens with reason offer', async ({
    page,
  }) => {
    await open(page);
    await start(page, {
      hello: hello(),
      plan: withTriage(plan([]), triage()),
      offer: true,
      timing: { offerQuietMs: 100 },
    });
    await expect
      .poll(async () => (await layer(page))?.fitViewOffer)
      .toBe('chip');
    await page.evaluate(() => window.__v2adapter.press('Simplify this page'));
    await expect
      .poll(async () => (await calls(page)).map((c) => c.reason))
      .toEqual(['offer']);
    expect((await layer(page))?.offer).toBeNull();
  });

  test('no offer unless the worker allows one, and never on a page that cannot be re-presented', async ({
    page,
  }) => {
    await open(page);
    for (const [t, offer] of [
      // Compose, but over the budget or "Not now": the worker says no.
      [triage(), false],
      [triage({ verdict: 'tailor' }), false],
      [triage({ representable: false, blockers: ['editor'] }), true],
      [undefined, true],
    ] as const) {
      await start(page, {
        hello: hello(),
        plan: withTriage(plan([{ op: 'reading_guide', level: 0 }]), t),
        announce: true,
        offer,
        timing: { offerQuietMs: 50 },
      });
      await page.waitForTimeout(400);
      const l = await layer(page);
      expect(l?.fitViewOffer ?? null).toBeNull();
      expect(l?.toast?.buttons).toEqual(['Undo', 'Close']);
    }
  });

  test('EngineApi.onRoute reports Gmail-style hash routes while subscribed', async ({
    page,
  }) => {
    await open(page);
    await start(page, { hello: hello(), plan: plan([]) });
    expect(
      await page.evaluate(() => window.__v2adapter.subscribeRoutes()),
    ).toBe(true);
    expect((await state(page))?.routeListeners).toBe(1);
    await page.evaluate(() => {
      location.hash = '#inbox';
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __v2routeHits: number }).__v2routeHits,
        ),
      )
      .toBe(1);
    await page.evaluate(() => {
      location.hash = '#inbox/FMfcgzQXJWDsKlqW';
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __v2routeHits: number }).__v2routeHits,
        ),
      )
      .toBe(2);
    await page.evaluate(() =>
      (window as unknown as { __v2routeOff: () => void }).__v2routeOff(),
    );
    expect((await state(page))?.routeListeners).toBe(0);
    await page.evaluate(() => {
      location.hash = '#label/Receipts';
    });
    await page.waitForTimeout(900);
    expect(
      await page.evaluate(
        () => (window as unknown as { __v2routeHits: number }).__v2routeHits,
      ),
    ).toBe(2);
  });

  test('the wire from a real read: no names, subjects, typed or URL-query words, injection or page digits', async ({
    page,
  }) => {
    await open(page, 'adapter-inbox', '?q=marmalade+zebulon');
    await page.fill('#q', 'travel books quartzite');
    // A site that echoes the search in a heading.
    await page.evaluate(() => {
      document.querySelector('h1')!.textContent = 'Results for travel books';
    });
    await start(page, { hello: hello(), plan: plan([]) });
    const w = await page.evaluate(() => window.__v2adapter.wire());
    expect(w?.parsed).toBe(true);
    expect(w?.unknownWords).toEqual([]);
    expect(w?.collections).toBeGreaterThanOrEqual(1);
    expect(w?.typed).toBeGreaterThan(0);
    expect(w?.tokens).toBeLessThanOrEqual(6000);
    const json = w!.json.toLowerCase();
    const outline = w!.outline.toLowerCase();
    for (const secret of [
      'quillon',
      'vesperine',
      'zebulon',
      'marchetti',
      'ottoline',
      'ferrand',
      'oyelaran',
      'kettering',
      'quartzite',
      'marmalade',
      '48151623',
      '2077',
      'ignore',
      'instructions',
      'system prompt',
      'example.com',
      '127.0.0.1',
      'adapter-inbox',
    ]) {
      expect(json, secret).not.toContain(secret);
      expect(outline, secret).not.toContain(secret);
    }
    for (const word of w!.labels) expect(word).toMatch(/^([a-z]{2,20}|·)$/);
    // The echoed query is stripped even though "travel" and "books" are public words.
    expect(w!.labels).toContain('results');
    expect(w!.labels).not.toContain('travel');
    expect(w!.labels).not.toContain('books');
    expect(outline).not.toMatch(/page \S*(http|title=)/);
  });

  test('a stored spec re-binds to a fresh read after the page changes (new record, new count)', async ({
    page,
  }) => {
    await open(page, 'adapter-inbox');
    await start(page, { hello: hello(), plan: plan([]) });
    const stored = await page.evaluate(() => window.__v2adapter.storeSpec());
    expect(stored?.sections).toBe(4);
    expect(stored?.fields).toBeGreaterThanOrEqual(3);
    expect(stored!.stored).not.toMatch(/"e\d+"/);
    for (const label of ['Inbox', 'Quillon', 'quartzite', 'Labels', 'Messages'])
      expect(stored!.stored).not.toContain(label);
    await page.evaluate(() => {
      // A new message arrives on top, and the unread count changes.
      const first = document.querySelector('tr.row')!;
      const fresh = first.cloneNode(true) as HTMLElement;
      fresh.querySelector('.from')!.textContent = 'Pemberton Aldous';
      fresh.querySelector('.s')!.textContent = 'Fresh subject line';
      first.before(fresh);
      document.querySelector('nav a')!.textContent = 'Inbox (4)';
    });
    const back = await page.evaluate(() => window.__v2adapter.rebind());
    expect(back?.differentIds).toBe(true);
    expect(back?.coverage).toBe(1);
    expect(back?.same).toEqual([true, true, true, true]);
    expect(back?.fieldsBack).toBe(stored?.fields);
    expect(back?.fieldsSame.every(Boolean)).toBe(true);
  });
});

test.describe('adapter: restructured on arrival (docs/11 §2)', () => {
  /** A busy page for a person with a level-2 structure need, as the worker reads it. */
  const busy = (zoom?: number) =>
    withTriage(
      plan([{ op: 'reading_guide', level: 0 }]),
      triage({ verdict: 'tailor' }),
      zoom,
    );
  const events = async (page: Page) =>
    (await sentOf(page, 'cs:fitview-event')).map(
      (m) =>
        (m as unknown as { event: { kind: string; reason?: string } }).event,
    );

  test('a busy page with a level-2 fit opens restructured once it settles, Tailor held until then', async ({
    page,
  }) => {
    await open(page);
    await start(page, {
      hello: hello(),
      plan: busy(),
      announce: true,
      auto: true,
      timing: { tabQuietMs: 200 },
    });
    // Held: nothing applied, no toast, no offer, while the page settles.
    expect(await state(page)).toMatchObject({ frozen: true, held: true });
    expect(await page.evaluate(() => window.__v2adapter.applied())).toEqual([]);
    expect((await layer(page))?.toast ?? null).toBeNull();
    await expect
      .poll(async () => (await calls(page)).map((c) => c.reason))
      .toEqual(['auto']);
    const [call] = await calls(page);
    // The worker's one-time intro reaches the view.
    expect(call).toMatchObject({ type: 'open', reason: 'auto', intro: true });
    expect((await sentOf(page, 'cs:fitview-request'))[0]).toMatchObject({
      reason: 'auto',
    });
    expect(await events(page)).toEqual([
      expect.objectContaining({ kind: 'opened', reason: 'auto' }),
    ]);
    // The view holds Tailor now; tab mode follows the tab.
    expect(await state(page)).toMatchObject({
      frozen: true,
      held: false,
      tabMode: true,
    });
    expect(await page.evaluate(() => window.__v2adapter.applied())).toEqual([]);

    // "Original page": the site comes back, with Tailor applied and planned again.
    const signals = (await sentOf(page, 'cs:signals')).length;
    // The worker decides once per page view: the next reading is not automatic.
    await page.evaluate(
      (p) => window.__v2adapter.setPlan(p as never, false),
      busy(),
    );
    await page.evaluate(() => window.__v2adapter.closeFromRuntime('original'));
    await expect
      .poll(() => page.evaluate(() => window.__v2adapter.applied()))
      .toEqual(['reading_guide']);
    await expect
      .poll(async () => (await sentOf(page, 'cs:signals')).length)
      .toBe(signals + 1);
    expect(await state(page)).toMatchObject({
      frozen: false,
      held: false,
      tabMode: false,
    });
    // Nothing reopens it on this page view.
    await page.waitForTimeout(600);
    expect((await calls(page)).filter((c) => c.type === 'open')).toHaveLength(
      1,
    );
  });

  test('without the worker’s word (level 0, or a calm page) nothing opens and Tailor applies at once', async ({
    page,
  }) => {
    await open(page);
    await start(page, {
      hello: hello(),
      plan: busy(),
      announce: true,
      timing: { tabQuietMs: 100, offerQuietMs: 100 },
    });
    expect(await state(page)).toMatchObject({ frozen: false, held: false });
    expect(await page.evaluate(() => window.__v2adapter.applied())).toEqual([
      'reading_guide',
    ]);
    expect((await layer(page))?.toast?.text).toBe(
      'WebAble turned on the reading guide.',
    );
    await page.waitForTimeout(800);
    expect(await sentOf(page, 'cs:fitview-request')).toEqual([]);
    expect(await calls(page)).toEqual([]);
  });

  test('never over a site’s blocking dialog: it waits, then opens', async ({
    page,
  }) => {
    await open(page);
    await page.evaluate(() =>
      (document.getElementById('consent') as HTMLDialogElement).showModal(),
    );
    await start(page, {
      hello: hello(),
      plan: busy(),
      auto: true,
      timing: { tabQuietMs: 100 },
    });
    await page.waitForTimeout(900);
    expect(await sentOf(page, 'cs:fitview-request')).toEqual([]);
    expect(await state(page)).toMatchObject({ held: true });
    await page.evaluate(() =>
      (document.getElementById('consent') as HTMLDialogElement).close(),
    );
    await expect
      .poll(async () => (await calls(page)).map((c) => c.reason), {
        timeout: 5000,
      })
      .toEqual(['auto']);
  });

  test('an automatic open the worker refuses says nothing and lets Tailor apply', async ({
    page,
  }) => {
    await open(page);
    await start(page, {
      hello: hello(),
      plan: busy(),
      auto: true,
      fit: { mode: 'unavailable', why: 'not_representable' },
      timing: { tabQuietMs: 100 },
    });
    await expect
      .poll(async () => (await sentOf(page, 'cs:fitview-request')).length)
      .toBe(1);
    await expect
      .poll(() => page.evaluate(() => window.__v2adapter.applied()))
      .toEqual(['reading_guide']);
    expect(await state(page)).toMatchObject({ frozen: false, held: false });
    expect((await layer(page))?.toast ?? null).toBeNull();
    expect(await calls(page)).toEqual([]);
  });

  test('the popup closing it before it opened cancels the open and applies Tailor', async ({
    page,
  }) => {
    await open(page);
    await start(page, {
      hello: hello(),
      plan: busy(),
      auto: true,
      // The page keeps changing: the open waits for quiet.
      timing: { tabQuietMs: 3000 },
    });
    expect(await state(page)).toMatchObject({ held: true });
    await worker(page, {
      type: 'sw:fitview',
      action: 'close',
      reason: 'original',
    });
    await expect
      .poll(() => page.evaluate(() => window.__v2adapter.applied()))
      .toEqual(['reading_guide']);
    await page.waitForTimeout(3500);
    expect(await sentOf(page, 'cs:fitview-request')).toEqual([]);
  });

  test('a page scale is not guarded while held, and the guard runs once Tailor applies', async ({
    page,
  }) => {
    await open(page);
    await start(page, {
      hello: hello(),
      plan: busy(1.5),
      auto: true,
      fit: { mode: 'unavailable', why: 'not_representable' },
      timing: { tabQuietMs: 100 },
    });
    expect(await state(page)).toMatchObject({ scale: 1.5, held: true });
    // Released: the next plan carries the scale, and the guard reports it.
    await page.evaluate(
      (p) => window.__v2adapter.setPlan(p as never),
      busy(1.5),
    );
    await page.setViewportSize({ width: 853, height: 533 });
    await expect
      .poll(
        async () =>
          (await sentOf(page, 'cs:applied'))
            .filter((m) => 'viewport' in m)
            .map(
              (m) =>
                (m as unknown as { viewport: { zoom: number } }).viewport.zoom,
            ),
        { timeout: 6000 },
      )
      .toEqual([1.5]);
  });

  test('"Switch" while open re-reads the page and replaces the view with the ready layout', async ({
    page,
  }) => {
    await open(page);
    await start(page, { hello: hello(), plan: plan([]) });
    await worker(page, { type: 'sw:fitview', action: 'open', reason: 'popup' });
    await expect
      .poll(() => page.evaluate(() => window.__v2adapter.runtimeOpen()))
      .toBe(true);
    expect(
      await worker(page, {
        type: 'sw:fitview',
        action: 'open',
        reason: 'switch',
      }),
    ).toEqual({ ok: true });
    await expect
      .poll(async () =>
        (await sentOf(page, 'cs:fitview-request')).map(
          (m) => (m as { reason?: string }).reason,
        ),
      )
      .toEqual(['popup', 'switch']);
    await expect
      .poll(async () => (await calls(page)).map((c) => c.reason))
      .toEqual(['popup', 'switch']);
    expect(await state(page)).toMatchObject({ frozen: true, tabMode: true });
  });
});
