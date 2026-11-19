import { expect, type Page, test } from '@playwright/test';

import type { LiveApi } from './entries/live';

/**
 * Fit view proxies (docs/10 §4.4) on fixture pages, with the live harness
 * (tests/v2/entries/live.ts): a stand-in view in a closed shadow root, the
 * input firewall and the key bridge installed before the page's scripts.
 * Every interaction is a real Playwright mouse or keyboard event on the view.
 */

type Win = Window & {
  __live: LiveApi;
  __react: {
    log: string[];
    submits: number;
    shuffle(): void;
    rename(id: string, t: string): void;
    duplicate(): void;
  };
  log: string[];
};

async function open(
  page: Page,
  fixture: string,
  opts: { patch?: boolean } = {},
): Promise<void> {
  await page.goto(`/v2/${fixture}.html`);
  await page.waitForFunction(() => !!(window as unknown as Win).__live);
  await page.evaluate((o) => (window as unknown as Win).__live.open(o), opts);
}

async function clickV(page: Page, v: string): Promise<void> {
  const p = await page.evaluate(
    (x) => (window as unknown as Win).__live.rect(x),
    v,
  );
  if (!p) throw new Error(`no view control ${v}`);
  await page.mouse.click(p.x, p.y);
}

const failures = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as Win).__live
      .sent()
      .filter(
        (s) =>
          s.type === 'cs:fitview-event' &&
          (s.detail as { kind: string }).kind === 'proxy_failed',
      )
      .map((s) => s.detail),
  );

test.describe('text input (React)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/v2/live-react.html');
    await page.waitForSelector('#app li');
    await page.evaluate(() => (window as unknown as Win).__live.open());
  });

  test('a controlled input gets the value and Enter reaches onKeyDown with keyCode 13', async ({
    page,
  }) => {
    await page.evaluate(() => (window as unknown as Win).__live.focus('e2'));
    await page.keyboard.type('hello');
    await expect(page.locator('#echo')).toHaveText('hello');
    expect(await page.locator('[data-id="e2"]').inputValue()).toBe('hello');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Win).__react.log))
      .toContain('search:hello');
    // The site handled Enter itself: no fallback submission.
    await page.waitForTimeout(600);
    const log = await page.evaluate(
      () => (window as unknown as Win).__react.log,
    );
    expect(log.filter((l) => l.startsWith('submit-search'))).toEqual([]);
    expect(await failures(page)).toEqual([]);
  });

  test('a form with only onSubmit is submitted once, after the key bridge', async ({
    page,
  }) => {
    await page.evaluate(() => (window as unknown as Win).__live.focus('e4'));
    await page.keyboard.type('buy milk');
    await page.keyboard.press('Enter');
    await expect(page.locator('#saved')).toHaveText('Saved: buy milk');
    await page.waitForTimeout(800);
    expect(
      await page.evaluate(() => (window as unknown as Win).__react.submits),
    ).toBe(1);
    expect(await failures(page)).toEqual([]);
  });
});

test.describe('a field the site replaces (eval M8)', () => {
  test('typing and Enter reach the new field after the site swaps it on focus', async ({
    page,
  }) => {
    await open(page, 'live-swap');
    await page.evaluate(() => (window as unknown as Win).__live.focus('e2'));
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Win).log))
      .toContain('swapped');
    await page.keyboard.type('Ada');
    // Found again by role and name in the search landmark, and told it has focus.
    await expect(page.locator('.cdx-input')).toHaveValue('Ada');
    const log = await page.evaluate(() => (window as unknown as Win).log);
    expect(log).toContain('focus');
    expect(log).toContain('input:Ada');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Win).log))
      .toContain('search:Ada');
    expect(await failures(page)).toEqual([]);
  });
});

test.describe('records and identity', () => {
  test('delegated click handlers fire on the right record after the rows reorder', async ({
    page,
  }) => {
    await page.goto('/v2/live-react.html');
    await page.waitForSelector('#app li');
    await page.evaluate(() => (window as unknown as Win).__live.open());
    await page.evaluate(() => (window as unknown as Win).__react.shuffle());
    await expect(page.locator('#app li').first()).toHaveAttribute(
      'data-key',
      'd',
    );
    await clickV(page, 'b:archive');
    await clickV(page, 'd:archive');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Win).__react.log))
      .toEqual(['archive:b', 'archive:d']);
  });

  test('a record that changed under the view is refused and shown on the page', async ({
    page,
  }) => {
    await page.goto('/v2/live-react.html');
    await page.waitForSelector('#app li');
    // A lagging view: patches are logged, not drawn, so the card is stale.
    await page.evaluate(() =>
      (window as unknown as Win).__live.open({ patch: false }),
    );
    await page.evaluate(() =>
      (window as unknown as Win).__react.rename('b', 'Bravo invoice (paid)'),
    );
    await expect(page.locator('#app li[data-key="b"] span')).toHaveText(
      'Bravo invoice (paid)',
    );
    await clickV(page, 'b:archive');
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(() => (window as unknown as Win).__react.log),
    ).toEqual([]);
    expect(await failures(page)).toEqual([
      { kind: 'proxy_failed', role: 'button', why: 'fingerprint' },
    ]);
    const calls = await page.evaluate(() =>
      (window as unknown as Win).__live.calls(),
    );
    expect(calls).toContainEqual({ fn: 'peek', arg: true });
    expect(calls).toContainEqual({ fn: 'patchRecords', arg: 'e10' });
  });

  test('two lookalike records are told apart by key, never by index', async ({
    page,
  }) => {
    await page.goto('/v2/live-react.html');
    await page.waitForSelector('#app li');
    await page.evaluate(() => (window as unknown as Win).__react.duplicate());
    await page.waitForSelector('#app li[data-key="b2"]');
    await page.evaluate(() => (window as unknown as Win).__live.open());
    await page.evaluate(() => (window as unknown as Win).__react.shuffle());
    await clickV(page, 'b2:archive');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Win).__react.log))
      .toEqual(['archive:b2']);
  });

  test('a virtualized record is brought back and acted on (two-phase)', async ({
    page,
  }) => {
    await open(page, 'live-records');
    expect(await page.locator('[data-key="k150"]').count()).toBe(0);
    const t0 = Date.now();
    await clickV(page, 'k150:del');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Win).log), {
        timeout: 2000,
      })
      .toEqual(['deleted:k150']);
    expect(Date.now() - t0).toBeLessThan(2000);
    // Back towards the top of the list, also virtualized away by now.
    await clickV(page, 'k3:del');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Win).log))
      .toEqual(['deleted:k150', 'deleted:k3']);
    expect(await failures(page)).toEqual([]);
  });

  test('a record that never comes back is refused, never guessed', async ({
    page,
  }) => {
    await open(page, 'live-records');
    await clickV(page, 'k999:del');
    await expect
      .poll(() => failures(page), { timeout: 3000 })
      .toEqual([{ kind: 'proxy_failed', role: 'button', why: 'not_found' }]);
    expect(await page.evaluate(() => (window as unknown as Win).log)).toEqual(
      [],
    );
    const notices = await page.evaluate(() =>
      (window as unknown as Win).__live.calls('notice'),
    );
    expect(notices.map((c) => c.arg)).toContain(
      "This isn't on the page anymore",
    );
  });
});

test.describe('recipes', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, 'live-popups');
  });

  test('window.open from a proxied link click keeps the transient activation', async ({
    page,
    context,
  }) => {
    const popup = context.waitForEvent('page');
    await clickV(page, 'e40');
    await popup;
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Win).log))
      .toContain('help-opened');
  });

  test('window.open from a proxied button click keeps the transient activation', async ({
    page,
    context,
  }) => {
    const popup = context.waitForEvent('page');
    await clickV(page, 'e41');
    await popup;
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Win).log))
      .toContain('print-opened');
  });

  test('an irreversible action needs a second press', async ({ page }) => {
    await clickV(page, 'e42');
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => (window as unknown as Win).log)).toEqual(
      [],
    );
    const notices = await page.evaluate(() =>
      (window as unknown as Win).__live.calls('notice'),
    );
    expect(notices.map((c) => c.arg)).toContain('Press again to buy now');
    await clickV(page, 'e42');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Win).log))
      .toEqual(['bought']);
  });

  test('toggles read their state back from the original', async ({ page }) => {
    await clickV(page, 'e43');
    await expect(page.locator('#like')).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as Win).__live.checked('e43')),
      )
      .toBe(true);
    await clickV(page, 'e44');
    await expect(page.locator('#remember')).toBeChecked();
    expect(
      await page.evaluate(() =>
        (window as unknown as Win).__live.checked('e44'),
      ),
    ).toBe(true);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Win).log))
      .toContain('remember:true');
  });

  test('a select takes the value through the native setter and change', async ({
    page,
  }) => {
    await clickV(page, 'e45:old');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Win).log))
      .toContain('sort:old');
    expect(await page.locator('#sort').inputValue()).toBe('old');
    expect(
      await page.evaluate(() =>
        (window as unknown as Win).__live.checked('e45:old'),
      ),
    ).toBe(true);
    await clickV(page, 'e45:new');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Win).log))
      .toContain('sort:new');
    expect(await page.locator('#sort').inputValue()).toBe('new');
  });

  test('an action with no effect is shown on the page, never retried', async ({
    page,
  }) => {
    await clickV(page, 'e46');
    await expect
      .poll(() => failures(page), { timeout: 5000 })
      .toEqual([{ kind: 'proxy_failed', role: 'button', why: 'no_effect' }]);
    const calls = await page.evaluate(() =>
      (window as unknown as Win).__live.calls('peek'),
    );
    expect(calls).toEqual([{ fn: 'peek', arg: true }]);
    expect(
      await page.evaluate(() => (window as unknown as Win).__live.viewOpen()),
    ).toBe(false);
    await page.evaluate(() => (window as unknown as Win).__live.back());
    expect(
      await page.evaluate(() => (window as unknown as Win).__live.viewOpen()),
    ).toBe(true);
  });
});
