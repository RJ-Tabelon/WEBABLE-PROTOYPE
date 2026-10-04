import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Page-level checks every WebAble page must pass (design-final.md 15):
 * one h1, a main landmark, no horizontal scroll at 320 px, no text below
 * 15 px, and no axe violations (WCAG 2.2 A and AA): public pages fail on any
 * impact, app pages on serious and critical.
 */

export async function expectOneH1(
  page: Page,
  name: string | RegExp,
): Promise<void> {
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

/**
 * One main, and the way around: the app's "App" navigation in the rail, or,
 * below 64em where the rail gives way to the bar, the bar's Menu (the same
 * navigation opens in a sheet). Other pages have one banner.
 */
export async function expectLandmarks(page: Page, app: boolean): Promise<void> {
  await expect(page.getByRole('main')).toHaveCount(1);
  if (!app) {
    await expect(page.getByRole('banner')).toHaveCount(1);
    return;
  }
  const rail = page.getByRole('navigation', { name: 'App' });
  const menu = page
    .getByRole('banner')
    .getByRole('button', { name: 'Menu', exact: true });
  await expect(rail.or(menu).first()).toBeVisible();
}

/**
 * No sideways scroll once layout settles: parts sized from measurements (the
 * sample page in Your fit's preview) follow a resize a frame later.
 */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      { message: 'page scrolls sideways' },
    )
    .toBeLessThanOrEqual(0);
}

/**
 * Visible text nodes rendered below 15 px. Exempt: sr-only text, and pictures
 * of pages (role="img": the sample pages on the site and in Your fit's
 * preview), whose small text is the "before" a site might ship, on purpose.
 */
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
        el.closest(
          '.sr-only, [hidden], [role="img"], script, style, noscript, nextjs-portal',
        )
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

export interface AxeCheck {
  /**
   * Which violations fail the check: `all` impacts (minor and moderate too),
   * or only `serious` and `critical`. Default `all`.
   */
  impacts?: 'all' | 'serious';
  /** Selectors left out of the scan, each with a reason at the call site. */
  exclude?: readonly string[];
}

/** axe on WCAG 2.2 A and AA, failing on the impacts asked for. */
export async function expectNoAxeViolations(
  page: Page,
  { impacts = 'all', exclude = [] }: AxeCheck = {},
): Promise<void> {
  let builder = new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    // The Next.js dev overlay is not part of the product.
    .exclude('nextjs-portal');
  for (const selector of exclude) builder = builder.exclude(selector);
  const results = await builder.analyze();
  const failing = results.violations
    .filter(
      (v) =>
        impacts === 'all' || v.impact === 'serious' || v.impact === 'critical',
    )
    .map(
      (v) =>
        `${v.id} (${v.impact ?? 'unknown'}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    );
  expect(failing).toEqual([]);
}

export async function expectNoSeriousAxeViolations(page: Page): Promise<void> {
  await expectNoAxeViolations(page, { impacts: 'serious' });
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
