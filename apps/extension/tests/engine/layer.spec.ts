import { expect, test, type Page } from '@playwright/test';

import { open, plan } from './helpers';

const NBSP = '\u00a0';

/** Two animation frames: the layer sets its status line on the frame after a change. */
const frames = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  );

test.describe('in-page layer', () => {
  test('show on page: text changes get outlines and a tag, never a ghost', async ({
    page,
  }) => {
    await open(page, 'article');
    await page.evaluate(() => window.__webableEngine.extract());
    const changes = await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([
        { op: 'text_floor', level: 2 },
        { op: 'line_spacing', level: 1 },
        { op: 'line_length', level: 1 },
      ]),
    );
    const applied = changes.filter((c) => c.status === 'applied');
    expect(applied.map((c) => c.op)).toContain('text_floor');
    for (const c of applied) {
      const shown = await page.evaluate(
        (op) => window.__webableEngine.showOnPage(op, true),
        c.op,
      );
      expect(shown.ghosts, c.op).toBe(0);
      expect(shown.outlines, c.op).toBeGreaterThan(0);
      // At most three outlines per change in the viewport.
      expect(shown.outlines, c.op).toBeLessThanOrEqual(3);
      expect(shown.tags.length, c.op).toBeLessThanOrEqual(1);
    }
    const all = await page.evaluate(() =>
      window.__webableEngine.showOnPage(null, true),
    );
    expect(all.ghosts).toBe(0);
    expect(all.outlines).toBeLessThanOrEqual(3 * applied.length);
    await page.evaluate(() => window.__webableEngine.showOnPage(null, false));
    expect(
      (await page.evaluate(() => window.__webableEngine.layer())).outlines,
    ).toBe(0);
  });

  test("toast: one line worded as WebAble's action; Undo all undoes every change", async ({
    page,
  }) => {
    await open(page, 'article');
    await page.evaluate(() => window.__webableEngine.extract());
    await page.evaluate(
      (p) => window.__webableEngine.apply(p, { announce: true }),
      plan([{ op: 'text_floor', level: 2 }, { op: 'contrast' }]),
    );
    await frames(page);
    const layer = await page.evaluate(() => window.__webableEngine.layer());
    expect(layer.toast?.text).toBe(`WebAble set text to 18${NBSP}px here.`);
    expect(layer.toast?.buttons).toEqual(['Undo all', 'Close']);
    // No shortcut configured: the status line is the message alone.
    expect(layer.live).toBe(`WebAble set text to 18${NBSP}px here.`);
    expect(
      await page.evaluate(() => window.__webableEngine.press('Undo all')),
    ).toBe(true);
    await page.waitForFunction(
      () => window.__webableEngine.changes().length === 0,
    );
    const undone = (
      await page.evaluate(() => window.__webableEngine.events())
    ).find((e) => e.type === 'undone');
    expect((undone?.detail as string[]).sort()).toEqual([
      'contrast',
      'text_floor',
    ]);
  });

  test('toast: a single change gets Undo', async ({ page }) => {
    await open(page, 'article');
    await page.evaluate(() => window.__webableEngine.extract());
    await page.evaluate(
      (p) => window.__webableEngine.apply(p, { announce: true }),
      plan([{ op: 'text_floor', level: 2 }]),
    );
    const layer = await page.evaluate(() => window.__webableEngine.layer());
    expect(layer.toast?.buttons).toEqual(['Undo', 'Close']);
    expect(
      await page.evaluate(() => window.__webableEngine.press('Undo')),
    ).toBe(true);
    await page.waitForFunction(
      () => window.__webableEngine.changes().length === 0,
    );
  });

  test('offer chip: held while typing, shown once idle, with a WebAble source line', async ({
    page,
  }) => {
    await open(page, 'store');
    await page.evaluate(() => window.__webableEngine.extract());
    await page.locator('input[type="search"]').focus();
    await page.keyboard.type('lamp');
    const offer = plan([{ op: 'target_size', level: 2, mode: 'offer' }]).ops[0];
    expect(
      await page.evaluate(
        (o) => window.__webableEngine.offer(o as never),
        offer,
      ),
    ).toBe(true);
    // Past the first-paint delay, still typing: the chip waits.
    await page.waitForTimeout(1800);
    let layer = await page.evaluate(() => window.__webableEngine.layer());
    expect(layer.offer).toBeNull();
    expect(layer.offerPending).toBe('target_size');
    // Leave the field: shown once 2 s have passed since the last key.
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.waitForFunction(
      () => window.__webableEngine.layer().offer !== null,
      undefined,
      { timeout: 4000 },
    );
    await frames(page);
    layer = await page.evaluate(() => window.__webableEngine.layer());
    expect(layer.offer?.source).toBe('WebAble');
    expect(layer.offer?.buttons).toEqual(['Close', 'Try it', 'Not now']);
    expect(layer.live).toBe('WebAble suggests bigger click targets here.');
  });

  test('a Tab past the last layer control returns focus to the page', async ({
    page,
  }) => {
    await open(page, 'article');
    await page.evaluate(() => window.__webableEngine.extract());
    await page.locator('nav a').first().focus();
    await page.evaluate(
      (p) => window.__webableEngine.offer(p.ops[0] as never),
      plan([{ op: 'text_floor', level: 2, mode: 'offer' }]),
    );
    await page.waitForFunction(
      () => window.__webableEngine.layer().offer !== null,
      undefined,
      { timeout: 4000 },
    );
    expect(await page.evaluate(() => window.__webableEngine.focusLayer())).toBe(
      true,
    );
    await page.keyboard.press('Tab'); // Try it -> Not now
    expect(
      (await page.evaluate(() => window.__webableEngine.layer())).focusInside,
    ).toBe(true);
    await page.keyboard.press('Tab'); // past the last control
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(
      'News',
    );
  });

  test('reading guide: the band snaps to the line under the pointer', async ({
    page,
  }) => {
    await open(page, 'article');
    await page.evaluate(() => window.__webableEngine.extract());
    await page.evaluate(() => window.__webableEngine.readingGuide(true));
    const lines = await page.evaluate(() => {
      const p = document.querySelectorAll('article p')[1] as HTMLElement;
      const text = [...p.childNodes].find(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
      ) as Text;
      const r = document.createRange();
      r.selectNodeContents(text);
      return [...r.getClientRects()]
        .filter((b) => b.width > 0)
        .slice(0, 2)
        .map((b) => ({ left: b.left, top: b.top, height: b.height }));
    });
    expect(lines.length).toBe(2);
    for (const line of lines) {
      await page.mouse.move(line.left + 30, line.top + line.height / 2);
      await frames(page);
      const band = (await page.evaluate(() => window.__webableEngine.layer()))
        .guideBand;
      expect(band?.top).toBeCloseTo(line.top - 4, 0);
      expect(band?.height).toBeCloseTo(line.height + 8, 0);
    }
  });
});
