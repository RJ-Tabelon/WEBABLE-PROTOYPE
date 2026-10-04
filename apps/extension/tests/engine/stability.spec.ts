import { expect, test, type Page } from '@playwright/test';

import { open, plan } from './helpers';

/**
 * Stability on a busy, changing page: a sticky header that compacts on
 * scroll, a rotating carousel, a live ticker, a sidebar re-rendered from
 * scratch every 700 ms, an infinite-scroll feed with lazy images, and a late
 * ad that pushes content down. Sampled every frame while the person scrolls
 * with the wheel. Adapted text must never fall back to its native size, new
 * content must arrive adapted, and the page must never scroll against them.
 */

const hello = {
  enabled: true,
  paused: false,
  prePaint: [],
  tabSession: 'tab-1',
};

interface Report {
  frames: number;
  /** Tracked text seen adapted, then seen at its native size again. */
  losses: string[];
  /** Text first seen after the plan applied, but not adapted in that frame. */
  late: string[];
  /** Line spacing seen applied, then seen tight again. */
  spacingLosses: string[];
  /** Clamped teasers seen enlarged (and therefore cut off). */
  clampsShown: string[];
  /** Sizes caught mid-animation between native and fitted. */
  animating: string[];
  /** Story paragraphs first seen without the fitted line spacing. */
  unspaced: string[];
  /** Upward scroll jumps while the person only scrolled down (px). */
  yanks: number[];
}

async function sample(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Track = { adapted: boolean; spaced: boolean; id: string };
    const w = window as unknown as {
      __stop?: boolean;
      __report: Report;
    };
    const report: Report = {
      frames: 0,
      losses: [],
      late: [],
      spacingLosses: [],
      clampsShown: [],
      animating: [],
      unspaced: [],
      yanks: [],
    };
    w.__report = report;
    w.__stop = false;
    const seen = new WeakMap<Element, Track>();
    let next = 0;
    let lastY = scrollY;
    const tracked =
      'main.story > p:not(.byline):not(.ticker), .feed .card p.teaser, #trending a, .slide.is-active p';
    const frame = (): void => {
      report.frames++;
      if (scrollY < lastY - 4) report.yanks.push(Math.round(lastY - scrollY));
      lastY = scrollY;
      for (const el of document.querySelectorAll(tracked)) {
        const r = el.getBoundingClientRect();
        if (r.bottom < 60 || r.top > innerHeight || r.width === 0) continue;
        const cs = getComputedStyle(el);
        const size = parseFloat(cs.fontSize);
        const adapted = size >= 17.5;
        const spaced =
          !el.matches('main.story > p') ||
          parseFloat(cs.lineHeight) / size >= 1.75;
        const name = `${el.localName}.${el.className || 'x'}:${(el.textContent ?? '').trim().slice(0, 24)}`;
        if (size > 13.25 && size < 17.5)
          report.animating.push(`${name} @${size}px`);
        const t = seen.get(el);
        if (!t) {
          seen.set(el, { adapted, spaced, id: `${next++}` });
          if (!adapted) report.late.push(`${name} @${size}px`);
          if (!spaced) report.unspaced.push(name);
          continue;
        }
        if (t.adapted && !adapted) report.losses.push(`${name} @${size}px`);
        if (t.spaced && !spaced) report.spacingLosses.push(name);
        t.adapted = adapted;
        t.spaced = spaced;
      }
      for (const el of document.querySelectorAll('.card .clamp')) {
        const r = el.getBoundingClientRect();
        if (r.bottom < 60 || r.top > innerHeight) continue;
        if (parseFloat(getComputedStyle(el).fontSize) >= 17.5)
          report.clampsShown.push(
            (el.closest('.card') as HTMLElement).dataset.card ?? '?',
          );
      }
      if (!w.__stop) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

async function finish(page: Page): Promise<Report> {
  await page.evaluate(() => {
    (window as unknown as { __stop: boolean }).__stop = true;
  });
  await page.waitForTimeout(100);
  return page.evaluate(
    () => (window as unknown as { __report: Report }).__report,
  );
}

test.describe('stability on a changing page', () => {
  test('text and spacing stay adapted while the page scrolls, re-renders and loads more', async ({
    page,
  }) => {
    await open(page, 'dynamic');
    await page.evaluate(
      ([pl, h]) => window.__webableEngine.runAdapter(pl as never, h as never),
      [
        plan([
          { op: 'text_floor', level: 2 },
          { op: 'line_spacing', level: 2 },
        ]),
        hello,
      ] as const,
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__webableEngine
            .adapterChanges()
            .filter((c) => c.status === 'applied')
            .map((c) => c.op)
            .sort(),
        ),
      )
      .toEqual(['line_spacing', 'text_floor']);
    await sample(page);
    await page.mouse.move(500, 400);
    for (let i = 0; i < 45; i++) {
      await page.mouse.wheel(0, 140);
      await page.waitForTimeout(90);
    }
    // Then hold still while the page keeps changing on its own.
    await page.waitForTimeout(2500);
    const report = await finish(page);

    expect(report.frames).toBeGreaterThan(60);
    expect(report.losses).toEqual([]);
    expect(report.spacingLosses).toEqual([]);
    expect(report.late).toEqual([]);
    expect(report.unspaced).toEqual([]);
    expect(report.animating).toEqual([]);
    expect(report.yanks).toEqual([]);
    // Teasers with a fixed height would be cut off: they keep their size.
    expect([...new Set(report.clampsShown)]).toEqual([]);
    const ops = await page.evaluate(() =>
      window.__webableEngine
        .adapterChanges()
        .filter((c) => c.status === 'applied')
        .map((c) => c.op)
        .sort(),
    );
    expect(ops).toEqual(['line_spacing', 'text_floor']);
  });
});
