import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(
  currentDirectory,
  '../../.output/chrome-mv3-e2e',
);

test('reads the active page and displays its content', async () => {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    let worker = context.serviceWorkers()[0];
    worker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();

    await page.goto('http://127.0.0.1:4173');
    const popup = await context.newPage();
    popup.on('console', (message) => {
      if (message.type() === 'error') {
        process.stderr.write(`[popup] ${message.text()}\n`);
      }
    });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    // A real toolbar popup does not replace the active tab. Keep the fixture
    // active, then reload the extension page to reproduce that relationship.
    await page.bringToFront();
    await popup.reload();

    await expect(
      popup.getByRole('heading', { name: 'WebAble test article' }),
    ).toBeVisible();
    await expect(
      popup.getByText('This content should be visible'),
    ).toBeVisible();
    await expect(popup.getByText('Nothing leaves your browser')).toBeVisible();

    const headingCount = popup
      .locator('.metrics div')
      .filter({ hasText: 'Headings' })
      .locator('dd');
    await expect(headingCount).toHaveText('1');

    await popup.getByLabel('Minimum 16px text').check();
    await expect
      .poll(() =>
        page
          .locator('#tiny')
          .evaluate((element) => getComputedStyle(element).fontSize),
      )
      .toBe('16px');

    await popup.getByLabel('Readable text spacing').check();
    await expect
      .poll(() =>
        page
          .locator('#tiny')
          .evaluate((element) => getComputedStyle(element).lineHeight),
      )
      .toBe('24px');

    await page.evaluate(() => {
      const section = document.createElement('section');
      section.innerHTML = `
        <h2>Added dynamically</h2>
        <p id="dynamic-small" style="font-size: 9px">New small text</p>
      `;
      document.querySelector('main')?.append(section);
    });

    await expect(headingCount).toHaveText('2');
    await expect
      .poll(() =>
        page
          .locator('#dynamic-small')
          .evaluate((element) => getComputedStyle(element).fontSize),
      )
      .toBe('16px');
  } finally {
    await context.close();
  }
});
