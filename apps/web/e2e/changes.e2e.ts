import { expect, test } from '@playwright/test';

import { expectPageBasics } from './support/a11y';
import { seedActivity } from './support/activity';
import { testUser } from './support/env';

/*
 * Changes: weekly counts as calm sentences and one line per kind of change,
 * plus what WebAble has learned. No charts, no tiles, no sites.
 */

test.beforeAll(async () => {
  await seedActivity(testUser());
});

test('says what changed this week, in sentences and a short list', async ({
  page,
}) => {
  await page.goto('/app/changes');
  await expectPageBasics(page, { h1: 'Changes', app: true });

  const week = page.locator('#this-week');
  await expect(
    week.getByText('WebAble made 62\u00a0changes this week.'),
  ).toBeVisible();
  await expect(week.getByText(/You undid 2 of them\./)).toBeVisible();
  const text = week.getByRole('listitem').filter({ hasText: 'Text size' });
  await expect(text).toContainText(
    'Applied 48\u00a0times · you undid it twice',
  );
  const targets = week
    .getByRole('listitem')
    .filter({ hasText: 'Click targets' });
  await expect(targets).toContainText('asked 3\u00a0times, you said yes twice');

  const recent = page.locator('#recent');
  await expect(
    recent.getByRole('listitem').filter({ hasText: 'Text size' }),
  ).toContainText('Applied 78\u00a0times');
});

test('says what WebAble has learned, without sites', async ({ page }) => {
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
    learned.getByText('You usually undo this change.'),
  ).toBeVisible();
  await expect(
    learned.getByText('You turned this off everywhere.'),
  ).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/https?:\/\/|\.com\b/);
});
