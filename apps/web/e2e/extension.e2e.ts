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
      page.getByRole('heading', { level: 1, name: 'Connect this browser' }),
    ).toBeVisible();
    await expectPageBasics(page, { h1: 'Connect this browser', app: false });

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

  test('connected, but not yet allowed on all sites', async ({ page }) => {
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
      page.getByText(/WebAble’s welcome page has the button/),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Check again' }),
    ).toBeVisible();
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
    await expect(
      page.getByRole('heading', { name: 'Allowed on all sites' }),
    ).toBeVisible();

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
      page.getByText(/signed in as someone.else@example.com/),
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

  test('lists this browser’s sites with their state', async ({ page }) => {
    const news = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'news.example.com' }) });
    await expect(news.getByText('Adapted · 3')).toBeVisible();
    await expect(news.getByText('Line spacing is off here')).toBeVisible();
    const shop = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'shop.example.org' }) });
    await expect(shop.getByText('Paused', { exact: true })).toBeVisible();
    await expect(shop.getByText(/always on here: click targets/)).toBeVisible();
    await expectPageBasics(page, { h1: 'Sites', app: true });
  });

  test('pause shows at once, with Undo', async ({ page }) => {
    const news = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'news.example.com' }) });
    await news
      .getByRole('button', { name: 'Pause on news.example.com' })
      .click();
    await expect(
      news.getByRole('button', { name: 'Resume on news.example.com' }),
    ).toBeVisible();
    const toast = page
      .getByRole('status')
      .filter({ hasText: 'Paused on news.example.com' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(
      news.getByRole('button', { name: 'Pause on news.example.com' }),
    ).toBeVisible();
    const updates = (await bridgeLog(page)).filter(
      (m) => m.type === 'wa:site-update',
    );
    expect(updates.map((m) => m.change)).toEqual([
      { kind: 'pause', paused: true },
      { kind: 'pause', paused: false },
    ]);
  });

  test('a change turned off on a site can be turned back on', async ({
    page,
  }) => {
    const news = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'news.example.com' }) });
    await news.getByRole('button', { name: /Turn back on/ }).click();
    await expect(news.getByText('Line spacing is off here')).toHaveCount(0);
    await expect(
      page.getByRole('status').filter({ hasText: 'Line spacing is back on' }),
    ).toBeVisible();
  });

  test('forget asks first, with explicit verbs', async ({ page }) => {
    await page.getByRole('button', { name: 'Forget shop.example.org' }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Forget shop.example.org?',
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep it' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('heading', { name: 'shop.example.org' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Forget shop.example.org' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Forget this site' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'shop.example.org' }),
    ).toHaveCount(0);
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
    page.getByText('WebAble here isn’t connected to your account.'),
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
});
