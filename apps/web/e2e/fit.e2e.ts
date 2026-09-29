import { expect, test } from '@playwright/test';

import { expectPageBasics } from './support/a11y';
import { testUser } from './support/env';
import { seedFit } from './support/fit';

/*
 * "Your fit" with a saved fit: rows with real values and where they came from,
 * Adjust writes a new version (source 'adjustment') with Undo, and the history
 * says what changed. Each run starts from a freshly saved fit.
 */

let seeded = 0;

test.beforeAll(async () => {
  seeded = await seedFit(testUser());
});

test('shows the fit as rows with real values and their source', async ({
  page,
}) => {
  await page.goto('/app');
  await expectPageBasics(page, { h1: 'Your fit', app: true });
  await expect(page.getByText(`Version ${seeded} · saved`)).toBeVisible();
  for (const section of ['Reading', 'Pointing', 'Focus', 'History']) {
    await expect(
      page.getByRole('heading', { level: 2, name: section }),
    ).toBeVisible();
  }
  const text = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Text size' }) });
  await expect(text.getByText('16 to 18 pixels')).toBeAttached();
  await expect(text.getByText('Measured today')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tune again' })).toHaveAttribute(
    'href',
    '/tune?recalibrate=1',
  );
});

test('Adjust saves a new version, and Undo puts the row back', async ({
  page,
}) => {
  await page.goto('/app');
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Text size' }) });
  const adjust = row.getByRole('button', { name: 'Adjust text size' });
  await adjust.click();
  await expect(adjust).toHaveAttribute('aria-expanded', 'true');

  const slider = row.getByRole('slider', { name: 'Text size' });
  await expect(slider).toBeFocused();
  await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', '21 pixels');
  await row.getByRole('button', { name: 'Save' }).click();

  const toast = page
    .getByRole('status')
    .filter({ hasText: 'Text size is now 21' });
  await expect(toast).toBeVisible();
  await expect(adjust).toBeFocused();
  await expect(row.getByText('16 to 21 pixels')).toBeAttached();
  await expect(row.getByText('Set by you')).toBeVisible();

  const history = page.locator('#history');
  await expect(history.getByText(`Version ${seeded + 1}`)).toBeVisible();
  await expect(history.getByText('Adjusted by you').first()).toBeVisible();

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Text size is back to 18' }),
  ).toBeVisible();
  await expect(row.getByText('16 to 18 pixels')).toBeAttached();
  await expect(history.getByText(`Version ${seeded + 2}`)).toBeVisible();
});

test('Esc closes the editor without saving and returns focus to Adjust', async ({
  page,
}) => {
  await page.goto('/app');
  const version = await page.getByText(/^Version \d+ · saved/).textContent();
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Click targets' }) });
  const adjust = row.getByRole('button', { name: /^Adjust/ });
  await adjust.click();
  const slider = row.getByRole('slider');
  await slider.press('ArrowRight');
  await slider.press('Escape');
  await expect(adjust).toBeFocused();
  await expect(adjust).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(page.getByText(/^Version \d+ · saved/)).toHaveText(
    version ?? '',
  );
});
