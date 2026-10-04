import { expect, test } from '@playwright/test';

import { expectPageBasics } from './support/a11y';
import {
  bridgeLog,
  fakeState,
  installFakeExtension,
} from './support/fake-extension';
import { testUser } from './support/env';

/*
 * Pages that read this browser's extension over the bridge, against an in-page
 * stand-in for the service worker: Connect, Sites and What was sent.
 */

test.describe('connect', () => {
  test('installed but not connected: connecting either succeeds or says why, calmly', async ({
    page,
  }) => {
    await installFakeExtension(page, fakeState());
    await page.goto('/connect');
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Use your fit in this browser',
      }),
    ).toBeVisible();
    // The eyebrow names the step; there is no step counter.
    await expect(page.getByText('Connect this browser').first()).toBeVisible();
    await expect(page.getByText(/Step \d of \d/)).toHaveCount(0);
    await expectPageBasics(page, {
      h1: 'Use your fit in this browser',
      app: false,
    });

    await page.getByRole('button', { name: 'Connect this browser' }).click();
    const connected = page.getByRole('heading', {
      level: 1,
      name: /^(WebAble is on|Connected)/,
    });
    const unavailable = page.getByRole('heading', {
      name: 'Connecting isn’t available right now',
    });
    await expect(connected.or(unavailable)).toBeVisible();

    if (await unavailable.isVisible()) {
      // The extension-link function is not deployed here: nothing reached the extension.
      await expect(
        page.getByText(/Nothing changed, and your fit is saved/),
      ).toBeVisible();
      expect((await bridgeLog(page)).some((m) => m.type === 'wa:connect')).toBe(
        false,
      );
      await expect(
        page.getByRole('button', { name: 'Try again' }),
      ).toBeVisible();
    } else {
      const sent = (await bridgeLog(page)).find((m) => m.type === 'wa:connect');
      expect(sent?.email).toBe(testUser().email);
      expect(typeof sent?.tokenHash).toBe('string');
    }
  });

  test('connected, but not yet allowed on all sites: the primary opens the welcome page', async ({
    page,
  }) => {
    await installFakeExtension(
      page,
      fakeState({
        status: { connected: true, email: testUser().email, allSites: false },
      }),
    );
    await page.goto('/connect');
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Connected. One step left.',
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Chrome asks before WebAble can change sites. You allow it once, on WebAble’s welcome page.',
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Check again' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'See your fit' }),
    ).toBeVisible();

    await page.getByRole('button', { name: /^Allow on all sites/ }).click();
    await expect
      .poll(async () =>
        (await bridgeLog(page)).filter((m) => m.type === 'wa:open-welcome'),
      )
      .toEqual([{ type: 'wa:open-welcome', focus: 'allow' }]);
    await expectPageBasics(page, {
      h1: 'Connected. One step left.',
      app: false,
    });
  });

  test('Finish setup on Your fit opens the welcome page too', async ({
    page,
  }) => {
    await installFakeExtension(
      page,
      fakeState({
        status: { connected: true, email: testUser().email, allSites: false },
      }),
    );
    await page.goto('/app');
    await page.getByRole('button', { name: /^Finish setup/ }).click();
    await expect
      .poll(async () =>
        (await bridgeLog(page)).some((m) => m.type === 'wa:open-welcome'),
      )
      .toBe(true);
  });

  test('connected and allowed everywhere', async ({ page }) => {
    await installFakeExtension(
      page,
      fakeState({
        status: { connected: true, email: testUser().email, allSites: true },
      }),
    );
    await page.goto('/connect');
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'WebAble is on. Open any site.',
      }),
    ).toBeVisible();
    await expect(page.getByText('On · all sites')).toBeVisible();

    await page.goto('/app');
    await expect(
      page.getByText('WebAble is on in this browser.'),
    ).toBeVisible();
  });

  test('connected as someone else offers to connect this account instead', async ({
    page,
  }) => {
    await installFakeExtension(
      page,
      fakeState({
        status: {
          connected: true,
          email: 'someone.else@example.com',
          allSites: true,
        },
      }),
    );
    await page.goto('/connect');
    await expect(
      page.getByText(
        'WebAble in this browser is signed in as someone.else@example.com. Switching signs them out here.',
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Switch to ${testUser().email}` }),
    ).toBeVisible();
  });
});

test.describe('sites', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeExtension(
      page,
      fakeState({
        status: { connected: true, email: testUser().email, allSites: true },
      }),
    );
    await page.goto('/app/sites');
  });

  test('lists what each site keeps, one row each, and says the list stays here', async ({
    page,
  }) => {
    await expect(
      page.getByText(
        'This list stays in this browser. It’s never sent to WebAble.',
      ),
    ).toBeVisible();
    const news = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'news.example.com' }) });
    await expect(news.getByText('Turned off: Line spacing')).toBeVisible();
    await expect(news.getByText('Text size 21\u00a0px')).toBeVisible();
    const shop = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'shop.example.org' }) });
    await expect(shop.getByText('Paused', { exact: true })).toBeVisible();
    await expect(shop.getByText('Always on: Click targets')).toBeVisible();
    await expect(
      shop.getByRole('button', { name: /^Turn off here click targets/ }),
    ).toBeVisible();
    await expectPageBasics(page, { h1: 'Sites', app: true });
  });

  test('resume shows at once, with Undo', async ({ page }) => {
    const shop = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'shop.example.org' }) });
    await shop
      .getByRole('button', { name: 'Resume on shop.example.org' })
      .click();
    await expect(shop.getByText('Paused', { exact: true })).toHaveCount(0);
    const toast = page
      .getByRole('status')
      .filter({ hasText: 'WebAble is on again on shop.example.org' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(shop.getByText('Paused', { exact: true })).toBeVisible();
    const updates = (await bridgeLog(page)).filter(
      (m) => m.type === 'wa:site-update',
    );
    expect(updates.map((m) => m.change)).toEqual([
      { kind: 'pause', paused: false },
      { kind: 'pause', paused: true },
    ]);
  });

  test('a change turned off on a site can be turned back on', async ({
    page,
  }) => {
    const news = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'news.example.com' }) });
    await news.getByRole('button', { name: /^Turn back on/ }).click();
    await expect(news.getByText('Turned off: Line spacing')).toHaveCount(0);
    await expect(
      page.getByRole('status').filter({ hasText: 'Line spacing is back on' }),
    ).toBeVisible();
  });

  test('a change kept on everywhere here can be turned off here', async ({
    page,
  }) => {
    await page
      .getByRole('button', { name: /^Turn off here click targets/ })
      .click();
    await expect(page.getByText('Always on: Click targets')).toHaveCount(0);
    const updates = (await bridgeLog(page)).filter(
      (m) => m.type === 'wa:site-update',
    );
    expect(updates.at(-1)?.change).toEqual({
      kind: 'pin',
      op: 'target_size',
      on: false,
    });
  });

  test('reset site asks first, with explicit verbs', async ({ page }) => {
    await page
      .getByRole('button', { name: 'Reset site shop.example.org' })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Reset shop.example.org?',
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep it' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('heading', { name: 'shop.example.org' }),
    ).toBeVisible();

    await page
      .getByRole('button', { name: 'Reset site shop.example.org' })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Reset site' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'shop.example.org' }),
    ).toHaveCount(0);
    const updates = (await bridgeLog(page)).filter(
      (m) => m.type === 'wa:site-update',
    );
    expect(updates.at(-1)).toMatchObject({
      domain: 'shop.example.org',
      change: { kind: 'reset' },
    });
  });
});

test('an empty list, in a browser not connected yet, says both', async ({
  page,
}) => {
  await installFakeExtension(page, fakeState({ sites: [] }));
  await page.goto('/app/sites');
  await expect(
    page.getByRole('heading', { name: 'No sites yet' }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'WebAble is in this browser, but not connected to your account.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Connect this browser' }),
  ).toHaveAttribute('href', '/connect');
});

test.describe('what was sent', () => {
  test('shows each request with its exact body behind a disclosure', async ({
    page,
  }) => {
    await installFakeExtension(
      page,
      fakeState({
        status: { connected: true, email: testUser().email, allSites: true },
      }),
    );
    await page.goto('/app/privacy');
    const receipts = page.getByRole('list', {
      name: 'Requests sent from this browser',
    });
    await expect(receipts.getByText('news.example.com')).toBeVisible();
    await expect(
      receipts.getByText(/812\u00a0bytes to page analysis/),
    ).toBeVisible();
    const disclosure = receipts.getByRole('button', {
      name: 'Exactly what was sent',
    });
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(receipts.getByLabel('Request body')).toContainText(
      '"sidebar"',
    );
    await expectPageBasics(page, { h1: 'Privacy', app: true });
  });

  test('clearing this browser empties the list, after one question', async ({
    page,
  }) => {
    await installFakeExtension(
      page,
      fakeState({
        status: { connected: true, email: testUser().email, allSites: true },
      }),
    );
    await page.goto('/app/privacy');
    await page.getByRole('button', { name: 'Clear this browser' }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Clear this browser’s WebAble data?',
    });
    await dialog.getByRole('button', { name: 'Clear this browser' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText('Nothing has been sent from this browser.'),
    ).toBeVisible();
    expect(
      (await bridgeLog(page)).some((m) => m.type === 'wa:clear-local'),
    ).toBe(true);
  });
});
