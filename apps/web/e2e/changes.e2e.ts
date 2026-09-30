import { expect, test } from '@playwright/test';

import { expectPageBasics } from './support/a11y';
import { seedActivity } from './support/activity';
import { testUser } from './support/env';

/*
 * Changes: one sentence about this week, one table by kind of change over 8
 * weeks, and what WebAble has learned, each part undoable. No charts, no
 * tiles, no sites.
 */

test.beforeEach(async () => {
  await seedActivity(testUser());
});

test('says this week in one sentence, and the 8 weeks in one table', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/changes');
  await expectPageBasics(page, { h1: 'Changes', app: true });

  const recent = page.locator('#recent');
  await expect(
    recent.getByRole('heading', { level: 2, name: 'Last 8 weeks' }),
  ).toBeVisible();
  await expect(recent.getByText(/^Since [A-Z][a-z]{2} \d{1,2}$/)).toBeVisible();
  await expect(
    recent.getByText(
      '62 changes this week. You undid 2, and WebAble’s checks undid 1.',
    ),
  ).toBeVisible();
  await expect(
    recent.getByText('Asked first: 3 · you said yes to 2'),
  ).toBeVisible();

  const table = recent.getByRole('table');
  await expect(table.getByRole('columnheader')).toHaveText([
    'Change',
    'This week',
    '8 weeks',
    'Undone by you',
    'Undone by checks',
  ]);
  const text = table.getByRole('row', { name: /^Text size/ });
  await expect(text.getByRole('cell')).toHaveText(['48', '78', '3', '0']);
  const spacing = table.getByRole('row', { name: /^Line spacing/ });
  await expect(spacing.getByRole('cell')).toHaveText(['12', '12', '0', '1']);
});

test('reads as one line per change on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/changes');
  const list = page.getByRole('list', { name: /Changes by kind/ });
  await expect(
    list.getByRole('listitem').filter({ hasText: 'Text size' }),
  ).toContainText('48 this week · 78 in 8 weeks');
  await expect(page.getByRole('table')).toBeHidden();
});

test('says what WebAble has learned, without sites, and each part can be reset', async ({
  page,
}) => {
  await page.goto('/app/changes');
  const learned = page.locator('#learned');
  await expect(
    learned.getByRole('heading', { name: 'What WebAble has learned' }),
  ).toBeVisible();
  await expect(learned.getByText('18 to 20 pixels')).toBeAttached();
  await expect(
    learned.getByText('You usually keep this change.'),
  ).toBeVisible();
  await expect(
    learned.getByText('You usually undo this, so WebAble asks first.'),
  ).toBeVisible();
  await expect(
    learned.getByText('You turned this change off everywhere.'),
  ).toBeVisible();
  await expect(
    learned.getByRole('button', { name: /^Turn back on moving things/ }),
  ).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/https?:\/\/|\.com\b/);

  await learned.getByRole('button', { name: /^Reset click targets/ }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Click targets starts fresh' }),
  ).toBeVisible();
  await expect(
    learned.getByText('You usually undo this, so WebAble asks first.'),
  ).toHaveCount(0);
});

test('forgetting what WebAble learned asks first', async ({ page }) => {
  await page.goto('/app/changes');
  const forget = page.getByRole('button', {
    name: 'Forget what WebAble learned',
  });
  await forget.click();
  const dialog = page.getByRole('dialog', {
    name: 'Forget what WebAble learned?',
  });
  await dialog.getByRole('button', { name: 'Keep it' }).click();
  await expect(dialog).toBeHidden();
  await expect(forget).toBeFocused();

  await forget.click();
  await dialog.getByRole('button', { name: 'Forget it' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(
      'Nothing yet. WebAble learns from the changes you keep and undo.',
    ),
  ).toBeVisible();
});
