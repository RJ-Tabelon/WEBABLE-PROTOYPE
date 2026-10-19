import { expect, test, type Page } from '@playwright/test';

/**
 * Route watcher (docs/10 §4.5): Gmail-style hash routes are page views when
 * no element has that id or name; `#/` and `#!/` routers still count;
 * document anchors never do. Changes are debounced into one report.
 */

async function open(page: Page): Promise<void> {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/, (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
  await page.goto('/v2/adapter-routes.html');
  await page.addScriptTag({ url: '/__v2/adapter.js' });
  await page.waitForFunction(() => typeof window.__v2adapter !== 'undefined');
  await page.evaluate(() => window.__v2adapter.watchRoutes(100));
}

const events = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.__v2adapter.routeEvents());

/** Set location.hash from the page, as a site's own router or a link would. */
const hash = (page: Page, h: string): Promise<void> =>
  page.evaluate((v) => {
    location.hash = v;
  }, h);

test.describe('route watcher', () => {
  test('Gmail-style hash routes are navigation: #inbox, #inbox/<id>, #search/..., #label/...', async ({
    page,
  }) => {
    await open(page);
    const steps = [
      '#inbox',
      '#inbox/FMfcgzQXJWDsKlqWnTwTqWzc',
      '#search/garden+planters',
      '#label/Receipts',
      '#settings/general',
    ];
    for (const [i, h] of steps.entries()) {
      await hash(page, h);
      await expect.poll(() => events(page)).toHaveLength(i + 1);
    }
    expect(await events(page)).toEqual(
      steps.map((h) => `/v2/adapter-routes.html${h}`),
    );
  });

  test('document anchors stay local: an element id, a named anchor, #top, or a bare #', async ({
    page,
  }) => {
    await open(page);
    for (const h of ['#section-2', '#old-anchor', '#top', '#', '#q=1&x=2'])
      await hash(page, h);
    await page.waitForTimeout(400);
    expect(await events(page)).toEqual([]);
    // Classification, directly.
    const verdicts = await page.evaluate(() =>
      [
        '#inbox',
        '#inbox/abc',
        '#section-2',
        '#section-2/x',
        '#old-anchor',
        '#top',
        '#/settings',
        '#!/item/4',
        '#access_token=abc',
        '#%E4%B8%AD',
      ].map((h) => window.__v2adapter.isRouteHash(h)),
    );
    expect(verdicts).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
      false,
    ]);
  });

  test('#/ and #!/ hash routers still count', async ({ page }) => {
    await open(page);
    await hash(page, '#/settings/profile');
    await expect.poll(() => events(page)).toHaveLength(1);
    await hash(page, '#!/item/4');
    await expect.poll(() => events(page)).toHaveLength(2);
  });

  test('an anchor once seen stays an anchor, even if a matching element leaves later', async ({
    page,
  }) => {
    await open(page);
    await hash(page, '#section-2');
    await page.evaluate(() => document.getElementById('section-2')?.remove());
    // Moving away and back: each hash keeps the class it had when first seen.
    await hash(page, '#section-1');
    await hash(page, '#section-2');
    await page.waitForTimeout(400);
    expect(await events(page)).toEqual([]);
  });

  test('path changes and quick successions are debounced into one report', async ({
    page,
  }) => {
    await open(page);
    await page.evaluate(() => {
      history.pushState({}, '', '/v2/adapter-routes.html?view=a');
      history.pushState({}, '', '/v2/adapter-routes.html?view=b');
      location.hash = '#inbox';
    });
    await expect.poll(() => events(page)).toHaveLength(1);
    await page.waitForTimeout(300);
    expect(await events(page)).toEqual([
      '/v2/adapter-routes.html?view=b#inbox',
    ]);
  });

  test('stops reporting once disposed', async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.__v2adapter.unwatchRoutes());
    await hash(page, '#inbox');
    await page.waitForTimeout(300);
    expect(await events(page)).toEqual([]);
  });
});
