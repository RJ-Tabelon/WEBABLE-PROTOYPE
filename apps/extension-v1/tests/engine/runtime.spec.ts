import { expect, test } from '@playwright/test';

import { domState, open, plan, styleState } from './helpers';

test.describe('runtime', () => {
  test('hash routes are detected, while document anchors do not start a new page view', async ({
    page,
  }) => {
    await open(page, 'spa');
    await page.evaluate(() => window.__webableEngine.extract());
    await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'focus_outline' }]),
    );
    // A document anchor: an element on the page has that id. (A bare name
    // with no such element is a Gmail-style route, docs/10 §4.5.)
    await page.evaluate(() => {
      const target = document.createElement('h2');
      target.id = 'section';
      target.textContent = 'A section heading';
      document.querySelector('main')?.append(target);
      location.hash = '#section';
    });
    await page.waitForTimeout(700);
    expect(
      (await page.evaluate(() => window.__webableEngine.events())).filter(
        (e) => e.type === 'routeChanged',
      ),
    ).toHaveLength(0);
    await page.evaluate(() => {
      location.hash = '#/story';
    });
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.__webableEngine.events())).filter(
            (e) => e.type === 'routeChanged',
          ).length,
      )
      .toBe(1);
  });

  test('SPA: content inserted later is adapted incrementally', async ({
    page,
  }) => {
    await open(page, 'spa');
    await page.evaluate(() => window.__webableEngine.extract());
    await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'text_floor', level: 1 }]),
    );
    await page.click('#more');
    await page.waitForFunction(
      () => document.querySelectorAll('.late').length === 3,
    );
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.late')].every(
          (p) => getComputedStyle(p).fontSize === '16px',
        ),
      undefined,
      { timeout: 3000 },
    );
    // Counted once the debounced pass has checked them: two paragraphs, the
    // heading and the button at first, then the three late items.
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.__webableEngine.changes()))[0]
            ?.count ?? 0,
      )
      .toBe(7);
  });

  test('SPA: a route change is reported once the DOM settles', async ({
    page,
  }) => {
    await open(page, 'spa');
    await page.evaluate(() => window.__webableEngine.extract());
    await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'focus_outline' }]),
    );
    await page.click('[data-route="list"]');
    await page.waitForFunction(
      () =>
        window.__webableEngine.events().some((e) => e.type === 'routeChanged'),
      undefined,
      { timeout: 4000 },
    );
    const ev = (
      await page.evaluate(() => window.__webableEngine.events())
    ).find((e) => e.type === 'routeChanged');
    expect(ev?.detail).toBe('/engine/spa.html?view=list');
  });

  test('friction: repeated near-misses on small targets raise a misclick burst', async ({
    page,
  }) => {
    await open(page, 'store');
    await page.evaluate(() => window.__webableEngine.extract());
    await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'focus_outline' }]),
    );
    const box = await page.locator('.toolbar button').first().boundingBox();
    if (!box) throw new Error('no toolbar');
    // Just below the 18 px buttons: near, but not on, a small target.
    for (let i = 0; i < 2; i++)
      await page.mouse.click(box.x + box.width / 2, box.y + box.height + 5);
    const events = await page.evaluate(() => window.__webableEngine.events());
    const f = events.find((e) => e.type === 'friction');
    expect(f?.detail).toEqual({
      signal: 'misclick_burst',
      ops: ['target_size', 'target_spacing', 'steady_clicks'],
    });
  });

  test('friction: rage clicks and zoom gestures are observed passively', async ({
    page,
  }) => {
    await open(page, 'article');
    await page.evaluate(() => window.__webableEngine.extract());
    await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'focus_outline' }]),
    );
    for (let i = 0; i < 3; i++) await page.mouse.click(600, 400);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    const signals = (await page.evaluate(() => window.__webableEngine.events()))
      .filter((e) => e.type === 'friction')
      .map((e) => (e.detail as { signal: string }).signal);
    expect(signals).toEqual(expect.arrayContaining(['rage_click', 'zoom_in']));
  });

  test('toast: first auto changes are announced as WebAble actions, with Undo all', async ({
    page,
  }) => {
    await open(page, 'article');
    await page.evaluate(() => window.__webableEngine.extract());
    const dom0 = await domState(page);
    await page.evaluate(
      (p) => window.__webableEngine.apply(p, { announce: true }),
      plan([{ op: 'text_floor', level: 2 }, { op: 'contrast' }]),
    );
    const layer = await page.evaluate(() => window.__webableEngine.layer());
    expect(layer.toast?.text).toContain('WebAble set text to 18');
    expect(layer.toast?.text).not.toContain('more change');
    expect(layer.toast?.buttons).toEqual(['Undo all', 'Close']);
    expect(
      await page.evaluate(() => window.__webableEngine.press('Undo all')),
    ).toBe(true);
    await page.waitForFunction(
      () => window.__webableEngine.changes().length === 0,
    );
    expect(await domState(page)).toEqual(dom0);
    const undone = (
      await page.evaluate(() => window.__webableEngine.events())
    ).find((e) => e.type === 'undone');
    expect((undone?.detail as string[]).sort()).toEqual([
      'contrast',
      'text_floor',
    ]);
  });

  test('offer chip: equal answers, and an answer is reported', async ({
    page,
  }) => {
    await open(page, 'store');
    await page.evaluate(() => window.__webableEngine.extract());
    const offer = plan([{ op: 'target_size', level: 2, mode: 'offer' }]).ops[0];
    await page.evaluate((o) => window.__webableEngine.offer(o as never), offer);
    await page.waitForFunction(
      () => window.__webableEngine.layer().offer !== null,
      undefined,
      { timeout: 4000 },
    );
    // Only once per page visit.
    expect(
      await page.evaluate(
        (o) => window.__webableEngine.offer(o as never),
        offer,
      ),
    ).toBe(false);
    expect(
      await page.evaluate(() => window.__webableEngine.press('Try it')),
    ).toBe(true);
    const answer = (
      await page.evaluate(() => window.__webableEngine.events())
    ).find((e) => e.type === 'offerAnswer');
    expect(answer?.detail).toEqual({ op: 'target_size', answer: 'accept' });
    expect(
      (await page.evaluate(() => window.__webableEngine.layer())).offer,
    ).toBeNull();
  });

  test('show on page: ghost and fit outlines, removed with Esc', async ({
    page,
  }) => {
    await open(page, 'article');
    await page.evaluate(() => window.__webableEngine.extract());
    await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'text_floor', level: 2 }]),
    );
    const shown = await page.evaluate(() =>
      window.__webableEngine.showOnPage('text_floor', true),
    );
    expect(shown.outlines).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    expect(
      (await page.evaluate(() => window.__webableEngine.layer())).outlines,
    ).toBe(0);
    expect(
      (await page.evaluate(() => window.__webableEngine.events())).some(
        (e) => e.type === 'outlinesClosed',
      ),
    ).toBe(true);
  });

  test('pause restores the page exactly; resume re-applies the plan', async ({
    page,
  }) => {
    await open(page, 'article');
    await page.evaluate(() => window.__webableEngine.extract());
    const dom0 = await domState(page);
    const css0 = await styleState(page);
    await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'text_floor', level: 2 }, { op: 'reading_guide' }]),
    );
    await page.evaluate(() => window.__webableEngine.pause());
    const domPaused = await domState(page);
    // Paused: everything off, plus the pre-paint stand-down flag on <html>.
    expect(domPaused.filter((l) => !l.includes(':html['))).toEqual(
      dom0.filter((l) => !l.includes(':html[')),
    );
    expect(domPaused.find((l) => l.includes(':html['))).toContain(
      'data-wa-off=all',
    );
    expect(await styleState(page)).toEqual(css0);
    const resumed = await page.evaluate(() => window.__webableEngine.resume());
    expect(resumed.map((c) => [c.op, c.status])).toEqual([
      ['text_floor', 'applied'],
      ['reading_guide', 'applied'],
    ]);
  });

  test('pre-paint stylesheets stand down when the plan does not want them', async ({
    page,
  }) => {
    await open(page, 'article', ['focus_outline', 'calm_motion']);
    await page.evaluate(() => window.__webableEngine.extract());
    await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'focus_outline' }]),
    );
    const off = await page.evaluate(() =>
      document.documentElement.getAttribute('data-wa-off'),
    );
    expect(off).toBe('calm_motion');
    await page.evaluate(() => window.__webableEngine.undo('focus_outline'));
    expect(
      await page.evaluate(() =>
        document.documentElement.getAttribute('data-wa-off'),
      ),
    ).toBe('calm_motion focus_outline');
  });

  test('strict page CSP: adopted style layers and the in-page layer still work', async ({
    page,
  }) => {
    const violations: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
    });
    await open(page, 'csp');
    await page.evaluate(() => window.__webableEngine.extract());
    const pageOwn = violations.length; // the fixture's own inline <style> is refused
    expect(pageOwn).toBeGreaterThan(0);
    await page.evaluate(
      (p) => window.__webableEngine.apply(p, { announce: true }),
      plan([{ op: 'text_floor', level: 2 }, { op: 'focus_outline' }]),
    );
    // Text is at the UA 16 px without the page's styles: the floor still applies.
    const size = await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('.byline') as Element).fontSize,
    );
    expect(size).toBe('18px');
    const layer = await page.evaluate(() => window.__webableEngine.layer());
    expect(layer.mounted).toBe(true);
    expect(layer.toast?.text).toContain('WebAble set text to');
    await page.waitForTimeout(100);
    // WebAble added no CSP violations of its own.
    expect(violations.length).toBe(pageOwn);
  });
});
