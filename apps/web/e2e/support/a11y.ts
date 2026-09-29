import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Page-level checks every WebAble page must pass (design-final.md 15):
 * one h1, a main landmark, no horizontal scroll at 320 px, no text below
 * 15 px, and no serious or critical axe violations (WCAG 2.2 A and AA).
 */

export async function expectOneH1(
  page: Page,
  name: string | RegExp,
): Promise<void> {
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

export async function expectLandmarks(page: Page, app: boolean): Promise<void> {
  await expect(page.getByRole('main')).toHaveCount(1);
  if (app)
    await expect(
      page.getByRole('navigation', { name: 'App' }).first(),
    ).toBeAttached();
  else await expect(page.getByRole('banner')).toHaveCount(1);
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(0);
}

/** Visible text nodes rendered below 15 px (sr-only text is exempt). */
export async function smallText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const el = node.parentElement;
      if (!text || !el) continue;
      if (
        el.closest('.sr-only, [hidden], script, style, noscript, nextjs-portal')
      )
        continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 14.9) out.push(`${size}px: ${text.slice(0, 40)}`);
    }
    return out;
  });
}

export async function expectTextFloor(page: Page): Promise<void> {
  expect(await smallText(page)).toEqual([]);
}

export async function expectNoSeriousAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    // The Next.js dev overlay is not part of the product.
    .exclude('nextjs-portal')
    .analyze();
  const serious = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    );
  expect(serious).toEqual([]);
}

/** Run the checks at desktop width, then at 320 px (reflow). */
export async function expectPageBasics(
  page: Page,
  { h1, app }: { h1: string | RegExp; app: boolean },
): Promise<void> {
  await expectOneH1(page, h1);
  await expectLandmarks(page, app);
  await expectNoSeriousAxeViolations(page);
  await expectTextFloor(page);
  const size = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 720 });
  await expectNoHorizontalScroll(page);
  if (size) await page.setViewportSize(size);
}
