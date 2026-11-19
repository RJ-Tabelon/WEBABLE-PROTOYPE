import { expect, test } from '@playwright/test';

test('v2 harness bundles are built, served and injectable', async ({
  page,
}) => {
  await page.goto('/v2/blank.html');
  await page.addScriptTag({ url: '/__v2/smoke.js' });
  expect(
    await page.evaluate(
      () => (window as unknown as { __v2smoke: number }).__v2smoke,
    ),
  ).toBe(1);
});
