import { expect, test } from '@playwright/test';

import {
  expectLandmarks,
  expectNoAxeViolations,
  expectNoHorizontalScroll,
  expectTextFloor,
} from './support/a11y';

/*
 * The public site, signed out: every page passes axe at every impact (minor
 * and moderate included), keeps its one h1 and landmarks, never goes under the
 * 15 px text floor, and reflows at 320 px. The home hero shows real
 * screenshots of a site as made, then fitted by WebAble once; it starts fitted
 * under reduced motion, and its switches change the picture and the changes
 * listed under it.
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

for (const path of PAGES) {
  test(`${path} passes axe at every impact`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('h1')).toHaveCount(1);
    await expectLandmarks(page, false);
    await expectNoAxeViolations(page, { impacts: 'all' });
    await expectTextFloor(page);
  });
}

test.describe('dark theme', () => {
  test.use({ colorScheme: 'dark' });
  for (const path of PAGES) {
    test(`${path} passes axe at every impact`, async ({ page }) => {
      await page.goto(path);
      await expectNoAxeViolations(page, { impacts: 'all' });
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

const SHOWN = '.wm-show__shot[data-on]';

// The suite runs with reduced motion on (see playwright.config); these two
// tests check what moves, so they turn it off.
test.describe('with motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('the hero shows the site as made, then WebAble fits it once', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const hero = page.locator('.wm-show');
    await hero.scrollIntoViewIfNeeded();
    await expect(page.locator(SHOWN)).toHaveAttribute(
      'alt',
      /as the site made it/,
    );
    await expect(page.getByRole('radio', { name: 'Original' })).toBeChecked();
    // The fit comes in front of the person and is done within five seconds.
    await expect(hero).toHaveAttribute('data-view', 'fitted', {
      timeout: 5000,
    });
    await expect(page.locator(SHOWN)).toHaveAttribute(
      'alt',
      /^The same .+ with WebAble on/,
    );
    await expect(page.getByRole('radio', { name: 'Fitted' })).toBeChecked();
    // The picture really loaded, at the window's width.
    await expect
      .poll(() =>
        page
          .locator(SHOWN)
          .evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth,
          ),
      )
      .toBeGreaterThan(1000);
    // A second visit in the same session starts fitted.
    await page.reload();
    await expect(page.locator('.wm-show')).toHaveAttribute(
      'data-view',
      'fitted',
    );
  });

  test('the hero letters can be paused, and stay paused', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Pause the moving letters' })
      .click();
    await expect(
      page.getByRole('button', { name: 'Play the moving letters' }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Play the moving letters' }),
    ).toBeVisible();
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the hero starts fitted and nothing on it moves', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.wm-show')).toHaveAttribute(
      'data-view',
      'fitted',
    );
    const running = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (a) =>
              a.playState === 'running' &&
              a.effect instanceof KeyframeEffect &&
              a.effect.target instanceof Element &&
              a.effect.target.closest('.wm-hero'),
          ).length,
    );
    expect(running).toBe(0);
    // Still letters need no Pause.
    await expect(
      page.getByRole('button', { name: 'Pause the moving letters' }),
    ).toBeHidden();
  });
});

test('Original and Fitted switch the hero picture', async ({ page }) => {
  await page.goto('/');
  const hero = page.locator('.wm-show');
  await hero.scrollIntoViewIfNeeded();
  await page.getByRole('radio', { name: 'Original' }).click();
  await expect(hero).toHaveAttribute('data-view', 'original');
  await expect(page.locator(SHOWN)).toHaveAttribute(
    'alt',
    /as the site made it/,
  );
  // Only the picture on show is spoken.
  await expect(hero.getByRole('img')).toHaveCount(1);
  await page.getByRole('radio', { name: 'Fitted' }).click();
  await expect(hero).toHaveAttribute('data-view', 'fitted');
  await expect(page.locator(SHOWN)).toHaveAttribute('alt', /with WebAble on/);
});

test('the site switch shows the same fit on another site', async ({ page }) => {
  await page.goto('/');
  const hero = page.locator('.wm-show');
  const changes = hero.locator('.wm-show__list');
  await hero.scrollIntoViewIfNeeded();
  await expect(hero.locator('.wm-window')).toContainText('npr.org');
  await expect(changes).toContainText('opened its simpler version');
  await page.getByRole('radio', { name: 'CBS News' }).click();
  await expect(hero.locator('.wm-window')).toContainText('cbsnews.com');
  await expect(page.locator(SHOWN)).toHaveAttribute('alt', /pantry-loading/);
  // A news story read as the site made it: rewritten paragraphs, dimmed ads.
  await expect(changes).toContainText('Rewrote 7 paragraphs');
  await expect(changes).toContainText('Dimmed 7 ads');
  await expect(changes).not.toContainText('simpler version');
});
