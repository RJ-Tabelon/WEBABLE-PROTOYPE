import { expect, test, type Page } from '@playwright/test';

import type { OpId } from '@webable/core/ops/catalog';

import {
  domState,
  open,
  plan,
  regionKeys,
  styleState,
  type Fixture,
  type OpSpec,
} from './helpers';

/** Apply one op, check it did something real, undo it, and check the page is exactly as before. */
async function roundTrip(
  page: Page,
  fixture: Fixture,
  spec: OpSpec | ((page: Page) => Promise<OpSpec>),
  check: (page: Page) => Promise<void>,
): Promise<void> {
  await open(page, fixture);
  await page.evaluate(() => window.__webableEngine.extract());
  const s = typeof spec === 'function' ? await spec(page) : spec;
  const dom0 = await domState(page);
  const css0 = await styleState(page);
  const changes = await page.evaluate(
    (p) => window.__webableEngine.apply(p),
    plan([s]),
  );
  const change = changes.find((c) => c.op === s.op);
  expect(change?.status, `${s.op} status`).toBe('applied');
  expect(change?.count ?? 0, `${s.op} count`).toBeGreaterThan(0);
  await check(page);
  await page.evaluate((op) => window.__webableEngine.undo(op), s.op as OpId);
  await page.waitForTimeout(50);
  expect(await domState(page), `${s.op}: DOM restored`).toEqual(dom0);
  expect(await styleState(page), `${s.op}: computed styles restored`).toEqual(
    css0,
  );
  expect(await page.evaluate(() => window.__webableEngine.changes())).toEqual(
    [],
  );
}

const computed = (page: Page, sel: string, prop: string): Promise<string> =>
  page.evaluate(
    ([s, p]) =>
      getComputedStyle(
        document.querySelector(s as string) as Element,
      ).getPropertyValue(p as string),
    [sel, prop],
  );

test.describe('ops apply, verify and remove cleanly', () => {
  test('lowering a text fit and rechecking it preserve the requested size on transitioning pages', async ({
    page,
  }) => {
    await open(page, 'article');
    await page.addStyleTag({
      content: 'main p { transition: font-size 400ms, line-height 400ms; }',
    });
    await page.evaluate(() => window.__webableEngine.extract());
    await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'text_floor', level: 3 }]),
    );
    await page.evaluate(() => window.__webableEngine.setLevel('text_floor', 1));
    expect(
      await page
        .locator('main p:not(.byline)')
        .first()
        .evaluate((p) => getComputedStyle(p).fontSize),
    ).toBe('16px');
    await page.evaluate(() => window.__webableEngine.verify());
    expect(
      await page
        .locator('main p:not(.byline)')
        .first()
        .evaluate((p) => getComputedStyle(p).fontSize),
    ).toBe('16px');
  });

  test('text_floor raises only small text, with a real fit mark', async ({
    page,
  }) => {
    await roundTrip(
      page,
      'article',
      { op: 'text_floor', level: 2 },
      async (p) => {
        expect(
          await computed(p, 'main.story p:not(.byline)', 'font-size'),
        ).toBe('18px');
        expect(await computed(p, 'main.story h1', 'font-size')).toBe('32px');
        const c = (await p.evaluate(() => window.__webableEngine.changes()))[0];
        expect(c?.fit).toEqual({ before: '13 px', after: '18 px' });
      },
    );
  });

  test('line_spacing loosens running text in main content only', async ({
    page,
  }) => {
    await roundTrip(
      page,
      'article',
      { op: 'line_spacing', level: 2 },
      async (p) => {
        const lh = parseFloat(
          await computed(p, 'main.story p:not(.byline)', 'line-height'),
        );
        expect(lh).toBeCloseTo(13 * 1.8, 0);
        expect(await computed(p, 'aside.related .card', 'line-height')).toBe(
          'normal',
        );
      },
    );
  });

  test('line_length caps the measure of long paragraphs', async ({ page }) => {
    await roundTrip(
      page,
      'article',
      { op: 'line_length', level: 1 },
      async (p) => {
        const w = await p.evaluate(
          () =>
            (document.querySelector('main.story p:not(.byline)') as HTMLElement)
              .clientWidth,
        );
        const zero = await p.evaluate(() => {
          const s = document.createElement('span');
          s.textContent = '0';
          document.querySelector('main.story p:not(.byline)')?.append(s);
          const width = s.getBoundingClientRect().width;
          s.remove();
          return width;
        });
        expect(w).toBeLessThanOrEqual(Math.ceil(70 * zero) + 1);
      },
    );
  });

  test('contrast darkens faint text without changing hue or background', async ({
    page,
  }) => {
    await roundTrip(
      page,
      'article',
      { op: 'contrast', level: 0 },
      async (p) => {
        const color = await computed(p, 'main.story p:not(.byline)', 'color');
        expect(color).not.toBe('rgb(153, 153, 153)');
        expect(await computed(p, 'body', 'background-color')).toBe(
          'rgb(255, 255, 255)',
        );
        const c = (await p.evaluate(() => window.__webableEngine.changes()))[0];
        expect(c?.fit?.before).toMatch(/^2\.\d:1$/);
        const after = parseFloat(c?.fit?.after ?? '0');
        expect(after).toBeGreaterThanOrEqual(4.5);
      },
    );
  });

  test('focus_outline shows a cased ring on keyboard focus', async ({
    page,
  }) => {
    await roundTrip(
      page,
      'article',
      { op: 'focus_outline', level: 0 },
      async (p) => {
        await p.keyboard.press('Tab');
        const style = await p.evaluate(() => {
          const cs = getComputedStyle(document.activeElement as Element);
          return { w: cs.outlineWidth, s: cs.outlineStyle, sh: cs.boxShadow };
        });
        expect(style.s).toBe('solid');
        expect(style.w).toBe('3px');
        expect(style.sh).toContain('rgb(255, 255, 255)');
        await p.evaluate(() => (document.activeElement as HTMLElement).blur());
      },
    );
  });

  test('target_size enlarges hit areas without moving layout', async ({
    page,
  }) => {
    await roundTrip(
      page,
      'store',
      { op: 'target_size', level: 2 },
      async (p) => {
        const layout = await p.evaluate(() => {
          const b = document.querySelector('.toolbar button') as HTMLElement;
          const r = b.getBoundingClientRect();
          const after = getComputedStyle(b, '::after');
          // A click 3 px outside the visible button still lands on it.
          const hit = document.elementFromPoint(
            r.left + r.width / 2,
            r.bottom + 3,
          );
          return {
            w: r.width,
            content: after.content,
            position: after.position,
            hit: hit === b,
          };
        });
        expect(layout.w).toBe(18);
        expect(layout.content).toBe('""');
        expect(layout.position).toBe('absolute');
        expect(layout.hit).toBe(true);
        const c = (await p.evaluate(() => window.__webableEngine.changes()))[0];
        expect(c?.fit?.before).toBe('18 px');
      },
    );
  });

  test('target_spacing adds room in crowded flex toolbars', async ({
    page,
  }) => {
    await roundTrip(
      page,
      'store',
      { op: 'target_spacing', level: 1 },
      async (p) => {
        expect(await computed(p, '.toolbar', 'column-gap')).toBe('8px');
      },
    );
  });

  test('menu_grace keeps a hover submenu open briefly after the pointer leaves', async ({
    page,
  }) => {
    await roundTrip(
      page,
      'store',
      { op: 'menu_grace', level: 0 },
      async (p) => {
        const lamps = p.locator('.menu > li').first();
        await lamps.hover();
        await expect(p.locator('.menu .sub').first()).toBeVisible();
        await p.mouse.move(640, 500);
        await p.waitForTimeout(150);
        expect(await p.locator('.menu .sub').first().isVisible()).toBe(true);
        await p.waitForTimeout(500);
        expect(await p.locator('.menu .sub').first().isVisible()).toBe(false);
      },
    );
  });

  test('steady_clicks: a press that slips still clicks the pressed button', async ({
    page,
  }) => {
    await open(page, 'store');
    await page.evaluate(() => window.__webableEngine.extract());
    const slipClick = async (): Promise<boolean> => {
      await page.evaluate(() => {
        (window as unknown as { __clicked: boolean }).__clicked = false;
        document.getElementById('buy')?.addEventListener(
          'click',
          () => {
            (window as unknown as { __clicked: boolean }).__clicked = true;
          },
          { once: true },
        );
      });
      const box = await page.locator('#buy').boundingBox();
      if (!box) throw new Error('no button');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height + 20, {
        steps: 4,
      });
      await page.mouse.up();
      return page.evaluate(
        () => (window as unknown as { __clicked: boolean }).__clicked,
      );
    };
    expect(await slipClick()).toBe(false);
    const changes = await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'steady_clicks', level: 1 }]),
    );
    expect(changes[0]?.status).toBe('applied');
    expect(await slipClick()).toBe(true);
    await page.evaluate(() => window.__webableEngine.undo('steady_clicks'));
    expect(await slipClick()).toBe(false);
  });

  test('calm_motion stops animation and restores it on undo', async ({
    page,
  }) => {
    await roundTrip(
      page,
      'store',
      { op: 'calm_motion', level: 0 },
      async (p) => {
        const state = await p.evaluate(() => ({
          running: document
            .getAnimations()
            .filter((a) => a.playState === 'running').length,
          label: document
            .getElementById('carousel-pause')
            ?.getAttribute('aria-label'),
        }));
        expect(state.running).toBe(0);
        expect(state.label).toBe('Play slideshow');
        const c = (await p.evaluate(() => window.__webableEngine.changes()))[0];
        expect(c?.fit?.after).toBe('0\u00a0moving');
      },
    );
    const running = await page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.playState === 'running')
          .length,
    );
    expect(running).toBeGreaterThan(0);
  });

  test('pause_media pauses autoplay video and freezes GIFs; undo plays again', async ({
    page,
  }) => {
    await open(page, 'store');
    await page.waitForFunction(
      () => !(document.querySelector('video') as HTMLVideoElement).paused,
    );
    await page.waitForFunction(
      () => (document.getElementById('gif') as HTMLImageElement).complete,
    );
    await page.evaluate(() => window.__webableEngine.extract());
    const dom0 = await domState(page);
    const changes = await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'pause_media' }]),
    );
    expect(changes[0]?.status).toBe('applied');
    expect(changes[0]?.fit).toEqual({
      before: '2\u00a0playing',
      after: '0\u00a0playing',
    });
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(
        () => (document.querySelector('video') as HTMLVideoElement).paused,
      ),
    ).toBe(true);
    expect(await computed(page, '#gif', 'opacity')).toBe('0');
    expect(
      (await page.evaluate(() => window.__webableEngine.layer())).frozen,
    ).toBe(1);
    // Pressing on the frozen image lets it play again.
    // (The fixture's cookie banner covers the image, so press it directly.)
    await page
      .locator('#gif')
      .dispatchEvent('pointerdown', { bubbles: true, composed: true });
    expect(await computed(page, '#gif', 'opacity')).toBe('1');
    expect(
      (await page.evaluate(() => window.__webableEngine.layer())).frozen,
    ).toBe(0);
    await page.evaluate(() => window.__webableEngine.undo('pause_media'));
    await page.waitForFunction(
      () => !(document.querySelector('video') as HTMLVideoElement).paused,
    );
    expect(await computed(page, '#gif', 'opacity')).toBe('1');
    expect(
      (await page.evaluate(() => window.__webableEngine.layer())).mounted,
    ).toBe(false);
    expect(await domState(page)).toEqual(dom0);
  });

  test('dim_distractions softens the related rail and the ad; hover restores', async ({
    page,
  }) => {
    await roundTrip(
      page,
      'article',
      async (p) => {
        const regions = await regionKeys(p);
        const keys = regions
          .filter((r) => r.zone === 'right_rail' || r.ruleRole === 'promo_ad')
          .map((r) => r.key);
        return { op: 'dim_distractions', level: 1, regions: keys };
      },
      async (p) => {
        expect(await computed(p, 'aside.related', 'opacity')).toBe('0.45');
        expect(await computed(p, '.ad-slot', 'opacity')).toBe('0.45');
        await p.locator('aside.related').hover();
        expect(await computed(p, 'aside.related', 'opacity')).toBe('1');
        await p.mouse.move(1, 1);
      },
    );
  });

  test('focus_view softens everything outside the main content', async ({
    page,
  }) => {
    await roundTrip(
      page,
      'article',
      { op: 'focus_view', level: 0 },
      async (p) => {
        expect(await computed(p, 'aside.related', 'opacity')).toBe('0.5');
        expect(await computed(p, 'header.site-header', 'opacity')).toBe('0.5');
        expect(await computed(p, 'main.story', 'opacity')).toBe('1');
      },
    );
  });

  test('unpin_bars lets a sticky navigation bar scroll away', async ({
    page,
  }) => {
    await roundTrip(
      page,
      'store',
      async (p) => {
        const regions = await regionKeys(p);
        const bar = regions.find((r) => r.zone === 'header_band');
        return { op: 'unpin_bars', level: 0, regions: bar ? [bar.key] : [] };
      },
      async (p) => {
        expect(await computed(p, 'header.top', 'position')).toBe('relative');
        const c = (await p.evaluate(() => window.__webableEngine.changes()))[0];
        expect(c?.fit).toEqual({ before: '72 px', after: '0 px' });
      },
    );
  });

  test('reading_guide draws an overlay without touching the page', async ({
    page,
  }) => {
    await roundTrip(
      page,
      'article',
      { op: 'reading_guide', level: 0 },
      async (p) => {
        expect(
          (await p.evaluate(() => window.__webableEngine.layer())).guide,
        ).toBe(true);
      },
    );
    expect(
      (await page.evaluate(() => window.__webableEngine.layer())).mounted,
    ).toBe(false);
  });

  test('page_zoom belongs to the service worker', async ({ page }) => {
    await open(page, 'article');
    const changes = await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'page_zoom', level: 1 }]),
    );
    expect(changes[0]?.status).toBe('not_needed');
  });

  test('shadow DOM: text floor and focus outline reach open shadow roots', async ({
    page,
  }) => {
    await roundTrip(
      page,
      'shadow',
      { op: 'text_floor', level: 1 },
      async (p) => {
        const size = await p.evaluate(() => {
          const host = document.getElementById('card') as HTMLElement;
          return getComputedStyle(
            host.shadowRoot?.querySelector('.desc') as Element,
          ).fontSize;
        });
        expect(size).toBe('16px');
      },
    );
    await page.evaluate(
      (pl) => window.__webableEngine.apply(pl),
      plan([{ op: 'focus_outline' }]),
    );
    await page.locator('product-card button').first().focus();
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const host = document.getElementById('card') as HTMLElement;
      const active = host.shadowRoot?.activeElement as Element;
      return getComputedStyle(active).outlineStyle;
    });
    expect(outline).toBe('solid');
  });

  test('set-level re-applies at the new intensity', async ({ page }) => {
    await open(page, 'article');
    await page.evaluate(() => window.__webableEngine.extract());
    await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'text_floor', level: 1 }]),
    );
    expect(await computed(page, 'main.story p:not(.byline)', 'font-size')).toBe(
      '16px',
    );
    const changes = await page.evaluate(() =>
      window.__webableEngine.setLevel('text_floor', 3),
    );
    expect(changes[0]?.level).toBe(3);
    expect(await computed(page, 'main.story p:not(.byline)', 'font-size')).toBe(
      '21px',
    );
  });
});
