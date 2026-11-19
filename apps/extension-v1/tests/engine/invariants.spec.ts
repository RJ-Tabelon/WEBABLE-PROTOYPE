import { expect, test, type Page } from '@playwright/test';

import {
  a11yAttrs,
  open,
  plan,
  regionKeys,
  tabOrder,
  type Fixture,
  type OpSpec,
} from './helpers';

/**
 * The invariants from docs/01-Positioning.md: WebAble never changes a host
 * page's ARIA, accessible names, tabindex, focus order or keyboard handling.
 * Checked with Playwright's ARIA snapshot (roles and accessible names of the
 * whole body) plus a raw attribute diff, before and after every op is applied.
 */

async function everyOp(page: Page): Promise<OpSpec[]> {
  const regions = await regionKeys(page);
  const keys = regions.map((r) => r.key);
  const bars = regions
    .filter((r) => r.zone === 'header_band')
    .map((r) => r.key);
  return [
    { op: 'text_floor', level: 2 },
    { op: 'line_spacing', level: 1 },
    { op: 'line_length', level: 1 },
    { op: 'contrast', level: 1 },
    { op: 'focus_outline' },
    { op: 'target_size', level: 2 },
    { op: 'target_spacing', level: 1 },
    { op: 'steady_clicks', level: 1 },
    { op: 'menu_grace', level: 0 },
    { op: 'pause_media' },
    { op: 'dim_distractions', level: 1, regions: keys },
    { op: 'unpin_bars', regions: bars },
    { op: 'reading_guide' },
  ];
}

const bodySnapshot = (page: Page): Promise<string> =>
  page.locator('body').ariaSnapshot();

for (const fixture of [
  'article',
  'store',
  'app',
  'shadow',
  'spa',
] as Fixture[]) {
  test(`${fixture}: accessibility tree and ARIA attributes unchanged by every op`, async ({
    page,
  }) => {
    await open(page, fixture);
    const ops = await everyOp(page);
    const aria0 = await bodySnapshot(page);
    const attrs0 = await a11yAttrs(page);
    const changes = await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan(ops),
    );
    expect(changes.filter((c) => c.status === 'error')).toEqual([]);
    expect(await bodySnapshot(page)).toEqual(aria0);
    expect(await a11yAttrs(page)).toEqual(attrs0);
    await page.evaluate(() => window.__webableEngine.undo('all'));
    expect(await bodySnapshot(page)).toEqual(aria0);
    expect(await a11yAttrs(page)).toEqual(attrs0);
  });

  test(`${fixture}: focus order unchanged by every op`, async ({ page }) => {
    await open(page, fixture);
    const before = await tabOrder(page, 16);
    await open(page, fixture);
    const ops = await everyOp(page);
    await page.evaluate((p) => window.__webableEngine.apply(p), plan(ops));
    expect(await tabOrder(page, 16)).toEqual(before);
  });
}

test('calm_motion presses the site own carousel pause; only that control reports its new state', async ({
  page,
}) => {
  await open(page, 'store');
  const aria0 = await bodySnapshot(page);
  await page.evaluate(
    (p) => window.__webableEngine.apply(p),
    plan([{ op: 'calm_motion' }]),
  );
  const after = await bodySnapshot(page);
  // The site's own control relabels itself ("Pause" -> "Play"); nothing else changes.
  const diff = after
    .split('\n')
    .filter((line) => !aria0.split('\n').includes(line));
  expect(diff.every((line) => /slideshow|Play/.test(line))).toBe(true);
  await page.evaluate(() => window.__webableEngine.undo('all'));
  expect(await bodySnapshot(page)).toEqual(aria0);
});

test('in-page layer: never takes focus, never enters the tab order, reachable by command', async ({
  page,
}) => {
  await open(page, 'article');
  await page.evaluate(() => window.__webableEngine.extract());
  const before = await tabOrder(page, 10);
  await page.locator('nav a').first().focus();
  const offered = await page.evaluate(
    (p) => window.__webableEngine.offer(p.ops[0] as never),
    plan([{ op: 'text_floor', level: 2, mode: 'offer' }]),
  );
  expect(offered).toBe(true);
  await page.waitForFunction(
    () => window.__webableEngine.layer().offer !== null,
    undefined,
    { timeout: 4000 },
  );
  const layer = await page.evaluate(() => window.__webableEngine.layer());
  expect(layer.offer?.question).toBeTruthy();
  expect(layer.offer?.buttons).toEqual(['Close', 'Try it', 'Not now']);
  expect(layer.offer?.tabIndexes).toEqual([-1, -1, -1]);
  // Focus stayed on the page's link.
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(
    'News',
  );
  expect(await tabOrder(page, 10)).toEqual(before);
  // The focus-layer command moves focus in; Esc returns it.
  await page.locator('nav a').first().focus();
  expect(await page.evaluate(() => window.__webableEngine.focusLayer())).toBe(
    true,
  );
  expect(
    (await page.evaluate(() => window.__webableEngine.layer())).focusInside,
  ).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(
    'News',
  );
});
