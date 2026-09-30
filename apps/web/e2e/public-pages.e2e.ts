import { expect, type Page, test } from '@playwright/test';

import {
  expectLandmarks,
  expectNoAxeViolations,
  expectNoHorizontalScroll,
  expectTextFloor,
} from './support/a11y';

/*
 * The public site, signed out: every page passes axe at every impact (minor
 * and moderate included), keeps its one h1 and landmarks, never goes under the
 * 15 px text floor, and reflows at 320 px. The home hero's fit marks never sit
 * on the sample page's words.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const PAGES = [
  '/',
  '/help',
  '/privacy',
  '/research',
  '/accessibility',
  '/get',
] as const;

/*
 * The sample page is a picture of a page (role="img" with a full description),
 * drawn from real markup so the fit marks can measure it. Its inner text and
 * colors are the "before" state on purpose (small, faint text a site might
 * ship), so axe's contrast and size rules would report what the picture is
 * meant to show. It is left out of the scan; the page around it is not.
 */
const SAMPLE = '.ws-sample';

for (const path of PAGES) {
  test(`${path} passes axe at every impact`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('h1')).toHaveCount(1);
    await expectLandmarks(page, false);
    await expectNoAxeViolations(page, { impacts: 'all', exclude: [SAMPLE] });
    await expectTextFloor(page);
  });
}

test.describe('dark theme', () => {
  test.use({ colorScheme: 'dark' });
  for (const path of PAGES) {
    test(`${path} passes axe at every impact`, async ({ page }) => {
      await page.goto(path);
      await expectNoAxeViolations(page, { impacts: 'all', exclude: [SAMPLE] });
    });
  }
});

test('public pages reflow at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  for (const path of PAGES) {
    await page.goto(path);
    await expectNoHorizontalScroll(page);
  }
});

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  what: string;
}

/**
 * Rects of the hero sample's fit marks, and of every line of its text as it is
 * shown: text-node ranges (so a mark in a paragraph's empty margin is fine),
 * cut to the boxes of the ancestors that clip them (a ticker shows one digit
 * of its column, a carousel one slide).
 */
async function heroGeometry(
  page: Page,
): Promise<{ marks: Box[]; text: Box[] }> {
  return page.evaluate(() => {
    const sample = document.querySelector('.ws-sample');
    const box = (r: DOMRect, what: string) => ({
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      what,
    });
    if (!sample) return { marks: [], text: [] };
    const marksRoot = sample.querySelector('.ws-sample__marks');
    const marks: ReturnType<typeof box>[] = [];
    for (const el of marksRoot?.querySelectorAll<HTMLElement | SVGElement>(
      ':scope > *',
    ) ?? []) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0)
        marks.push(box(r, el.getAttribute('class') ?? el.tagName));
    }
    const text: ReturnType<typeof box>[] = [];
    const walker = document.createTreeWalker(sample, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.textContent?.trim()) continue;
      if (marksRoot?.contains(parent)) continue;
      const style = getComputedStyle(parent);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      // The visible part of the text: every clipping ancestor up to the sample.
      const clips: DOMRect[] = [];
      for (
        let el: Element | null = parent;
        el && el !== sample.parentElement;
        el = el.parentElement
      ) {
        const { overflowX, overflowY } = getComputedStyle(el);
        if (overflowX !== 'visible' || overflowY !== 'visible')
          clips.push(el.getBoundingClientRect());
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        let left = r.left;
        let top = r.top;
        let right = r.right;
        let bottom = r.bottom;
        for (const c of clips) {
          left = Math.max(left, c.left);
          top = Math.max(top, c.top);
          right = Math.min(right, c.right);
          bottom = Math.min(bottom, c.bottom);
        }
        if (right - left > 0 && bottom - top > 0)
          text.push({
            left,
            top,
            right,
            bottom,
            what: node.textContent.trim().slice(0, 24),
          });
      }
    }
    return { marks, text };
  });
}

function overlaps(a: Box, b: Box): boolean {
  // One pixel of tolerance for anti-aliased edges that merely touch.
  return (
    a.left < b.right - 1 &&
    b.left < a.right - 1 &&
    a.top < b.bottom - 1 &&
    b.top < a.bottom - 1
  );
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`the hero's fit marks never cover its text at ${size.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const sample = page.locator('.ws-sample').first();
    await sample.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    // The marks are placed from measured rects after layout settles.
    await expect
      .poll(async () => (await heroGeometry(page)).marks.length)
      .toBeGreaterThan(0);
    const { marks, text } = await heroGeometry(page);
    const hits = marks.flatMap((mark) =>
      text
        .filter((line) => overlaps(mark, line))
        .map((line) => `${mark.what} covers "${line.what}"`),
    );
    expect(hits).toEqual([]);
  });
}
