import { expect, type Page, test } from '@playwright/test';

import type { LiveApi } from './entries/live';

/**
 * Fit view staying live (docs/10 §4.5): the input firewall, site popups
 * (sheet and peek), the status strip, media, routes and scroll memory. Uses
 * the live harness (tests/v2/entries/live.ts) and a fake engine.
 */

type Win = Window & {
  __live: LiveApi;
  log: string[];
  hits: string[];
  shortcuts: string[];
  pressed: number;
  playEarly(): Promise<void>;
  playLate(): Promise<void>;
};

/** Run `fn` against the harness API in the page. */
const live = <T>(page: Page, fn: (l: LiveApi) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__live)`) as Promise<T>;

async function open(page: Page, fixture: string): Promise<void> {
  await page.goto(`/v2/${fixture}.html`);
  await page.waitForFunction(() => !!(window as unknown as Win).__live);
  await page.evaluate(() => (window as unknown as Win).__live.open());
}

async function clickV(page: Page, v: string): Promise<void> {
  const p = await page.evaluate(
    (x) => (window as unknown as Win).__live.rect(x),
    v,
  );
  if (!p) throw new Error(`no view control ${v}`);
  await page.mouse.click(p.x, p.y);
}

const calls = (page: Page, fn: string) =>
  page.evaluate(
    (f) => (window as unknown as Win).__live.calls(f).map((c) => c.arg),
    fn,
  );
const pageLog = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).log);

test.describe('input firewall', () => {
  test('typing "/ j k e #" and wheeling in the view reaches no page listener', async ({
    page,
  }) => {
    await open(page, 'live-firewall');
    await page.evaluate(() => (window as unknown as Win).__live.focus('e2'));
    await page.keyboard.type('/jke#');
    // Typing still happens, and reaches the original through the proxy.
    expect(
      await page.evaluate(() => (window as unknown as Win).__live.value('e2')),
    ).toBe('/jke#');
    expect(await page.locator('[data-id="e2"]').inputValue()).toBe('/jke#');
    // Keys on a focused view button: still no site shortcut.
    await page.evaluate(() => (window as unknown as Win).__live.focus('e3'));
    await page.keyboard.type('jk?');
    // The wheel scrolls the view despite the page's wheel hijacker.
    const p = await page.evaluate(() =>
      (window as unknown as Win).__live.rect('e3'),
    );
    if (!p) throw new Error('no control');
    await page.mouse.move(p.x, p.y);
    const before = await live(page, (l) => l.scrollTop());
    await page.mouse.wheel(0, 400);
    await expect
      .poll(() => live(page, (l) => l.scrollTop()))
      .toBeGreaterThan(before);
    // A click on a view control drives the original, invisibly to the page's listeners.
    await clickV(page, 'e3');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Win).pressed))
      .toBe(1);
    expect(await page.evaluate(() => (window as unknown as Win).hits)).toEqual(
      [],
    );
    expect(
      await page.evaluate(() => (window as unknown as Win).shortcuts),
    ).toEqual([]);
  });

  test('the firewall is inert once Fit view closes', async ({ page }) => {
    await open(page, 'live-firewall');
    await page.evaluate(() => (window as unknown as Win).__live.close());
    await page.click('#pagefield');
    await page.keyboard.type('j');
    const hits = await page.evaluate(() => (window as unknown as Win).hits);
    expect(hits).toContain('window-capture:keydown');
    expect(hits).toContain('document-bubble:keydown');
  });
});

test.describe('site popups', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, 'live-popups');
  });

  test('a menu the site opens is mirrored as a sheet whose rows drive the original items', async ({
    page,
  }) => {
    await clickV(page, 'e20');
    await expect
      .poll(() => calls(page, 'sheet'))
      .toContainEqual(['Mute', 'Report']);
    // Focus moves to the first row; arrow keys move through the rows.
    await expect.poll(() => live(page, (l) => l.active())).toBe('sheet:0');
    await page.keyboard.press('ArrowDown');
    expect(await live(page, (l) => l.active())).toBe('sheet:1');
    await page.keyboard.press('Enter');
    await expect.poll(() => pageLog(page)).toEqual(['menu:Report']);
    // The site closed its menu: the sheet goes too. No peek happened.
    await expect.poll(() => calls(page, 'sheet')).toContainEqual(null);
    expect(await calls(page, 'peek')).toEqual([]);
  });

  test('Escape in a mirrored menu closes the site menu as well', async ({
    page,
  }) => {
    await clickV(page, 'e20');
    await expect.poll(() => live(page, (l) => l.active())).toBe('sheet:0');
    await page.keyboard.press('Escape');
    await expect.poll(() => pageLog(page)).toEqual(['menu-escaped']);
    expect(await live(page, (l) => l.active())).toBe('e20');
    // Escape went to the menu, not to Fit view's dialog.
    expect(await live(page, (l) => l.viewOpen())).toBe(true);
  });

  test('search suggestions become rows under the field and never peek', async ({
    page,
  }) => {
    await page.evaluate(() => (window as unknown as Win).__live.focus('e21'));
    await page.keyboard.type('ap');
    await expect
      .poll(() => calls(page, 'sheet'))
      .toContainEqual(['apple', 'apricot']);
    expect(await calls(page, 'peek')).toEqual([]);
    expect(await live(page, (l) => l.active())).toBe('e21');
    await page.keyboard.press('ArrowDown');
    expect(await live(page, (l) => l.active())).toBe('sheet:0');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(() => pageLog(page)).toEqual(['pick:apricot']);
    expect(await page.locator('#fruit').inputValue()).toBe('apricot');
  });

  test('a site dialog peeks, takes focus, and "Back to Fit view" sends Escape first', async ({
    page,
  }) => {
    await clickV(page, 'e22');
    await expect.poll(() => calls(page, 'peek')).toEqual([true]);
    expect(await live(page, (l) => l.viewOpen())).toBe(false);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.activeElement?.closest('dialog')?.id ?? null,
        ),
      )
      .toBe('confirmDlg');
    await page.evaluate(() => (window as unknown as Win).__live.back());
    await expect.poll(() => calls(page, 'peek')).toEqual([true, false]);
    expect(
      await page.evaluate(
        () => (document.getElementById('confirmDlg') as HTMLDialogElement).open,
      ),
    ).toBe(false);
    expect(await live(page, (l) => l.viewOpen())).toBe(true);
    expect(await pageLog(page)).toEqual([]);
    const events = await live(page, (l) =>
      l
        .sent()
        .filter(
          (s) => (s.detail as { kind?: string } | undefined)?.kind === 'peek',
        ),
    );
    expect(events.map((e) => (e.detail as { on: boolean }).on)).toEqual([
      true,
      false,
    ]);
  });

  test('answering the site dialog on the page returns to Fit view', async ({
    page,
  }) => {
    await clickV(page, 'e22');
    await expect.poll(() => calls(page, 'peek')).toEqual([true]);
    await page.click('#ok');
    await expect.poll(() => calls(page, 'peek')).toEqual([true, false]);
    expect(await pageLog(page)).toEqual(['draft-deleted']);
    expect(await live(page, (l) => l.viewOpen())).toBe(true);
  });

  test('a dialog the site opens on its own (showModal) peeks too', async ({
    page,
  }) => {
    await page.evaluate(() =>
      (document.getElementById('expiry') as HTMLDialogElement).showModal(),
    );
    await expect.poll(() => calls(page, 'peek')).toEqual([true]);
    await page.getByRole('button', { name: 'Stay signed in' }).click();
    await expect.poll(() => calls(page, 'peek')).toEqual([true, false]);
  });

  test('a toast after an action is mirrored and its Undo works', async ({
    page,
  }) => {
    await clickV(page, 'm2:archive');
    await expect.poll(() => pageLog(page)).toEqual(['archive:m2']);
    await expect
      .poll(() => calls(page, 'status'))
      .toContainEqual([{ text: 'Conversation archived.', actions: ['Undo'] }]);
    await clickV(page, 'status:0:0');
    await expect.poll(() => pageLog(page)).toEqual(['archive:m2', 'undo']);
    await expect(page.locator('#mail li[data-key="m2"]')).toHaveCount(1);
    // The toast went away on the page, so the line leaves the strip.
    await expect
      .poll(async () => (await calls(page, 'status')).at(-1))
      .toEqual([]);
  });

  test('something covering Fit view freezes the proxies', async ({ page }) => {
    await page.evaluate(() => document.getElementById('cover')?.showPopover());
    await expect
      .poll(() => calls(page, 'notice'), { timeout: 4000 })
      .toContain('Something on this page is covering Fit view');
    await page.evaluate(() => document.getElementById('cover')?.hidePopover());
    await expect
      .poll(async () => (await calls(page, 'notice')).at(-1), { timeout: 4000 })
      .toBe(null);
  });
});

test.describe('records stay live', () => {
  test('the hidden page is scrolled ahead so lazy media and more records load', async ({
    page,
  }) => {
    await open(page, 'live-feed');
    const loaded = (key: string) =>
      page.evaluate(
        (k) =>
          !!document
            .querySelector(`[data-key="${k}"] img`)
            ?.getAttribute('src'),
        key,
      );
    expect(await loaded('c12')).toBe(false);
    // The person scrolls the view: the page underneath follows, so the site
    // loads the thumbnails, and the view patches those records.
    await page.evaluate(() =>
      (window as unknown as Win).__live.scrollTo('c10:title'),
    );
    await expect.poll(() => loaded('c12')).toBe(true);
    await expect.poll(() => calls(page, 'patchRecords')).toContain('e10');
    // Near the end of the list: the page loads more, and the view gets them.
    await page.evaluate(() =>
      (window as unknown as Win).__live.scrollTo('c19:title'),
    );
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { loads: number }).loads),
      )
      .toBeGreaterThan(0);
    await expect.poll(() => live(page, (l) => l.has('c25:title'))).toBe(true);
    // The new records work like the others.
    await page.evaluate(() =>
      document.getElementById('feed')?.addEventListener('click', (e) => {
        const card = (e.target as Element).closest<HTMLElement>('.card');
        if (card)
          (window as unknown as Win).log = [
            ...((window as unknown as Win).log ?? []),
            card.dataset.key ?? '',
          ];
      }),
    );
    await clickV(page, 'c25:title');
    await expect.poll(() => pageLog(page)).toEqual(['c25']);
  });

  test('a record whose text changes is patched in the view', async ({
    page,
  }) => {
    await page.goto('/v2/live-react.html');
    await page.waitForSelector('#app li');
    await page.evaluate(() => (window as unknown as Win).__live.open());
    await page.evaluate(() =>
      (
        window as unknown as {
          __react: { rename(id: string, t: string): void };
        }
      ).__react.rename('c', 'Charlie notes (2)'),
    );
    await expect.poll(() => calls(page, 'patchRecords')).toContain('e10');
    // The view re-rendered with the new fingerprint: the click is accepted.
    await clickV(page, 'c:archive');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __react: { log: string[] } }).__react.log,
        ),
      )
      .toEqual(['archive:c']);
  });
});

test.describe('media, routes and scroll', () => {
  test('media that starts playing under the view is paused', async ({
    page,
  }) => {
    await page.goto('/v2/live-media.html');
    await page.waitForFunction(() => !!(window as unknown as Win).__live);
    await page.evaluate(() => (window as unknown as Win).playEarly());
    expect(
      await page.evaluate(
        () => (document.getElementById('early') as HTMLAudioElement).paused,
      ),
    ).toBe(false);
    await page.evaluate(() => (window as unknown as Win).__live.open());
    expect(
      await page.evaluate(
        () => (document.getElementById('early') as HTMLAudioElement).paused,
      ),
    ).toBe(true);
    await page.evaluate(() =>
      (window as unknown as Win).playLate().catch(() => undefined),
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => (document.getElementById('late') as HTMLAudioElement).paused,
        ),
      )
      .toBe(true);
  });

  test('a Gmail-style hash route shows loading at once, re-reads, and Back restores the record in view', async ({
    page,
  }) => {
    await open(page, 'live-route');
    await page.evaluate(() =>
      (window as unknown as Win).__live.scrollTo('t20:title'),
    );
    expect(await live(page, (l) => l.topKey())).toBe('t20');
    await page.waitForTimeout(300); // the view saves its place per history entry
    await clickV(page, 't24:title');
    // Loading is shown before the route settles.
    expect((await calls(page, 'loading'))[0]).toBe(true);
    await expect(page).toHaveURL(/#inbox\/t24$/);
    await expect
      .poll(() => calls(page, 'replace'), { timeout: 4000 })
      .toHaveLength(1);
    expect((await calls(page, 'loading')).at(-1)).toBe(false);
    const requests = await live(page, (l) =>
      l.sent().filter((s) => s.type === 'cs:fitview-request'),
    );
    expect(requests).toEqual([{ type: 'cs:fitview-request', detail: 'route' }]);
    expect(await live(page, (l) => l.has('e51'))).toBe(true);
    // Back: the list comes back and so does the place in it.
    await page.goBack();
    await expect
      .poll(() => calls(page, 'replace'), { timeout: 4000 })
      .toHaveLength(2);
    await expect.poll(() => live(page, (l) => l.topKey())).toBe('t20');
  });

  test('a page that cannot be re-presented closes the view with one line', async ({
    page,
  }) => {
    await open(page, 'live-route');
    await page.evaluate(() =>
      (window as unknown as Win).__live.config({
        routeReply: { ok: false, why: 'not_representable' },
      }),
    );
    await clickV(page, 't5:title');
    await expect
      .poll(() => calls(page, 'close'), { timeout: 4000 })
      .toEqual(['not_representable']);
    expect(await calls(page, 'notice')).toContain(
      'Videos play best on the original page',
    );
    expect(await live(page, (l) => l.mounted())).toBe(false);
  });

  test('closing scrolls the original to the record that was in view', async ({
    page,
  }) => {
    await open(page, 'live-route');
    await page.evaluate(() =>
      (window as unknown as Win).__live.scrollTo('t12:title'),
    );
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await page.evaluate(() => (window as unknown as Win).__live.close());
    const top = await page.evaluate(() =>
      Math.round(
        document.querySelector('li[data-key="t12"]')?.getBoundingClientRect()
          .top ?? -1,
      ),
    );
    expect(Math.abs(top)).toBeLessThan(1);
  });
});
