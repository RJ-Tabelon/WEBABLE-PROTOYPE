import { expect, test as setup } from '@playwright/test';

import { STORAGE_STATE, testUser } from './support/env';

/** Sign in once through the real sign-in page and keep the session for the app specs. */
setup('sign in through the sign-in page', async ({ page }) => {
  const user = testUser();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/app');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your fit' }),
  ).toBeVisible();
  await page.context().storageState({ path: STORAGE_STATE });
});
