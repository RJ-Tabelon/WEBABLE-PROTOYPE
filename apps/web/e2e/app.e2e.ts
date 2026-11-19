import { readFile } from 'node:fs/promises';

import { expect, type Page, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

import { expectNoSeriousAxeViolations, expectPageBasics } from './support/a11y';
import { supabaseEnv, testUser } from './support/env';

/*
 * The signed-in app, in a browser without the extension (the test profile has
 * none): every page is a document with one h1, landmarks, reflow at 320 px, no
 * text under 15 px, no serious axe violations, and calm states for what the
 * extension would otherwise provide.
 */

async function open(page: Page, path: string, h1: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1, name: h1 })).toBeVisible();
}

test.describe('app frame', () => {
  test('navigation marks the current page and keeps Help', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, '/app/changes', 'Changes');
    const nav = page.getByRole('navigation', { name: 'App' }).first();
    await expect(nav.getByRole('link', { name: 'Changes' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const name of [
      'Your fit',
      'Changes',
      'Sites',
      'Privacy',
      'Settings',
    ]) {
      await expect(nav.getByRole('link', { name })).toBeVisible();
    }
    // Help stays at the end of the rail (the rail's nav names the region).
    await expect(
      page.getByRole('complementary').getByRole('link', { name: 'Help' }),
    ).toBeVisible();
  });

  test('below 64em the menu opens a sheet with the same items', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/app/sites', 'Sites');
    await page.getByRole('button', { name: 'Menu' }).click();
    const sheet = page.getByRole('dialog', { name: 'Menu' });
    await expect(sheet.getByRole('link', { name: 'Sites' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await sheet.getByRole('link', { name: 'Privacy' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Privacy' }),
    ).toBeVisible();
  });
});

test.describe('pages', () => {
  test('Your fit', async ({ page }) => {
    await open(page, '/app', 'Your fit');
    await expectPageBasics(page, { h1: 'Your fit', app: true });
    // Either the first-run state or the fit itself, never a blank page.
    const empty = page.getByRole('heading', { name: 'No fit yet' });
    const reading = page.getByRole('heading', { level: 2, name: 'Reading' });
    await expect(empty.or(reading)).toBeVisible();
    if (await empty.isVisible()) {
      await expect(
        page.getByRole('link', { name: 'Tune WebAble' }),
      ).toHaveAttribute('href', '/tune');
    }
    // No extension in the test profile: the note says so, with the one step.
    await expect(
      page.getByText('Your fit isn’t used in this browser yet'),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /^Add WebAble/ }),
    ).toBeVisible();
  });

  test('Changes', async ({ page }) => {
    await open(page, '/app/changes', 'Changes');
    await expectPageBasics(page, { h1: 'Changes', app: true });
    await expect(page.getByText(/never the sites or pages/)).toBeVisible();
  });

  test('Sites needs the extension, and says so once', async ({ page }) => {
    await open(page, '/app/sites', 'Sites');
    await expect(
      page.getByText('Sites where you paused WebAble or changed a setting.'),
    ).toBeVisible();
    // The list lives in the extension: without it, no privacy line and no list.
    await expect(page.getByText(/This list stays in this browser/)).toHaveCount(
      0,
    );
    await expect(
      page.getByText('Your fit isn’t used in this browser yet'),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /^Add WebAble/ }),
    ).toBeVisible();
    await expectPageBasics(page, { h1: 'Sites', app: true });
  });

  test('Privacy explains each consent, each off by default', async ({
    page,
  }) => {
    await open(page, '/app/privacy', 'Privacy');
    await expectPageBasics(page, { h1: 'Privacy', app: true });
    const analysis = page.getByRole('switch', { name: /Page analysis/ });
    const layouts = page.getByRole('switch', {
      name: /Better Fit view layouts/,
    });
    const improve = page.getByRole('switch', { name: /Help improve WebAble/ });
    await expect(analysis).toBeVisible();
    await expect(layouts).toHaveAttribute('aria-checked', 'false');
    await expect(improve).toHaveAttribute('aria-checked', 'false');
    await expect(
      page.getByText(/Page text, anything you type, the site’s address/),
    ).toBeVisible();
    await expect(page.getByText(/nothing was sent from it/)).toBeVisible();
  });

  test('Settings reads as a document', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/app/settings', 'Settings');
    await expectPageBasics(page, { h1: 'Settings', app: true });
    for (const name of ['Account', 'Connected browsers'])
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sign out everywhere' }),
    ).toBeVisible();
    // At rest, the whole page fits one 1440×900 screen.
    const height = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    expect(height).toBeLessThanOrEqual(900);
  });

  test('Connect offers to add the extension', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /Add WebAble to Chrome|WebAble works in Chrome on a computer/,
    );
    await expectPageBasics(page, {
      h1: /Add WebAble to Chrome|WebAble works in Chrome/,
      app: false,
    });
  });
});

test.describe('changes people make', () => {
  test('a consent saves at once and can be undone', async ({ page }) => {
    await open(page, '/app/privacy', 'Privacy');
    const analysis = page.getByRole('switch', { name: /Page analysis/ });
    const before = await analysis.getAttribute('aria-checked');
    await analysis.click();
    const after = before === 'true' ? 'false' : 'true';
    await expect(analysis).toHaveAttribute('aria-checked', after);
    const toast = page
      .getByRole('status')
      .filter({ hasText: 'Page analysis is' });
    await expect(toast).toContainText(after === 'true' ? 'on' : 'off');
    await page.reload();
    await expect(
      page.getByRole('switch', { name: /Page analysis/ }),
    ).toHaveAttribute('aria-checked', after);

    // Put it back the way it was.
    await page.getByRole('switch', { name: /Page analysis/ }).click();
    await expect(
      page.getByRole('switch', { name: /Page analysis/ }),
    ).toHaveAttribute('aria-checked', before ?? 'false');
  });

  test('the theme applies at once and follows the account', async ({
    page,
  }) => {
    await open(page, '/app/settings', 'Settings');
    const theme = page.getByRole('radiogroup', { name: 'Theme' });
    await theme.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByText('Theme saved: dark.')).toBeAttached();
    // Another browser: nothing chosen there, so the account's choice applies.
    await page.evaluate(() => {
      window.localStorage.removeItem('wa-theme');
      window.localStorage.removeItem('wa-theme-at');
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page
      .getByRole('radiogroup', { name: 'Theme' })
      .getByRole('radio', { name: 'System' })
      .click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
    await expect(page.getByText('Theme saved: system.')).toBeAttached();
  });

  test('a newer choice in Settings wins over an older one in another browser', async ({
    page,
  }) => {
    await open(page, '/app/settings', 'Settings');
    await page
      .getByRole('radiogroup', { name: 'Theme' })
      .getByRole('radio', { name: 'Dark' })
      .click();
    await expect(page.getByText('Theme saved: dark.')).toBeAttached();
    // Another browser, where Light was chosen explicitly, long before.
    await page.evaluate(() => {
      window.localStorage.setItem('wa-theme', 'light');
      window.localStorage.setItem('wa-theme-at', '1000');
    });
    await open(page, '/app', 'Your fit');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await open(page, '/app/settings', 'Settings');
    await page
      .getByRole('radiogroup', { name: 'Theme' })
      .getByRole('radio', { name: 'System' })
      .click();
    await expect(page.getByText('Theme saved: system.')).toBeAttached();
  });

  test('a theme chosen on the site is the one the app keeps, and the account follows', async ({
    page,
  }) => {
    await page.goto('/');
    await page
      .getByRole('contentinfo')
      .getByRole('radiogroup', { name: /Theme/ })
      .getByRole('radio', { name: 'Dark' })
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await open(page, '/app', 'Your fit');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // The account took it: a browser with no choice of its own gets Dark too.
    await expect
      .poll(async () => {
        await page.evaluate(() => {
          window.localStorage.removeItem('wa-theme');
          window.localStorage.removeItem('wa-theme-at');
        });
        await page.reload();
        await page.getByRole('heading', { level: 1 }).waitFor();
        return page.locator('html').getAttribute('data-theme');
      })
      .toBe('dark');

    // Put it back: System, chosen in Settings.
    await open(page, '/app/settings', 'Settings');
    await page
      .getByRole('radiogroup', { name: 'Theme' })
      .getByRole('radio', { name: 'System' })
      .click();
    await expect(page.getByText('Theme saved: system.')).toBeAttached();
  });

  test('changing the password asks for the current one, and a wrong one changes nothing', async ({
    page,
  }) => {
    await open(page, '/app/settings', 'Settings');
    const change = page.getByRole('button', { name: 'Change password' });
    await change.click();
    await expect(change).toHaveAttribute('aria-expanded', 'true');
    const current = page.getByLabel('Current password', { exact: true });
    await expect(current).toBeFocused();
    await current.fill('not-the-password-1');
    await page
      .getByLabel('New password', { exact: true })
      .fill('a-new-password-that-is-long');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.getByText('That’s not your current password.'),
    ).toBeVisible();
    await expect(current).toHaveAttribute('aria-invalid', 'true');
    await expect(current).toBeFocused();

    // Cancel closes it and puts focus back on Change.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(change).toBeFocused();
    await expect(change).toHaveAttribute('aria-expanded', 'false');

    // The real password still signs in.
    const { url, key } = supabaseEnv();
    const check = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await check.auth.signInWithPassword(testUser());
    expect(error).toBeNull();
    await check.auth.signOut({ scope: 'local' });
  });

  test('download my data saves a JSON file', async ({ page }) => {
    await open(page, '/app/privacy', 'Privacy');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download my data' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(
      /^webable-data-\d{4}-\d{2}-\d{2}\.json$/,
    );
    const path = await file.path();
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    expect(parsed).toBeTruthy();
    expect(typeof parsed).toBe('object');
  });

  test('delete my account asks with explicit verbs, and Keep changes nothing', async ({
    page,
  }) => {
    await open(page, '/app/privacy', 'Privacy');
    const opener = page.getByRole('button', { name: 'Delete my account' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Delete your account?' });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Delete my account' }),
    ).toBeVisible();
    // A copy first: the link in the dialog runs the export.
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download your data' }).click();
    expect((await download).suggestedFilename()).toMatch(/\.json$/);
    await dialog.getByRole('button', { name: 'Keep my account' }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page).toHaveURL(/\/app\/privacy$/);
  });
});

test.describe('dark theme', () => {
  test.use({ colorScheme: 'dark' });

  for (const [path, h1] of [
    ['/app', 'Your fit'],
    ['/app/changes', 'Changes'],
    ['/app/sites', 'Sites'],
    ['/app/privacy', 'Privacy'],
    ['/app/settings', 'Settings'],
  ] as const) {
    test(`${h1} has no serious axe violations`, async ({ page }) => {
      await open(page, path, h1);
      await expectNoSeriousAxeViolations(page);
    });
  }
});
