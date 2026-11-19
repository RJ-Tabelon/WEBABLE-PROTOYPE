import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from '@playwright/test';

/**
 * The 'extension' Playwright project: the e2e build (wxt build --mode e2e)
 * loaded unpacked into a persistent Chrome profile, the engine fixtures
 * served on 127.0.0.1:4173 (the e2e build's only host access), and a control
 * page that talks to the service worker with test-only messages.
 *
 * Google Chrome ignores --load-extension since 137, so the build is loaded
 * over CDP (Extensions.loadUnpacked, needs --enable-unsafe-extension-debugging
 * and the pipe Playwright already uses). PW_CHANNEL=chromium uses Playwright's
 * bundled Chromium with the classic flags instead.
 */

const here = dirname(fileURLToPath(import.meta.url));
export const EXTENSION_DIR = resolve(
  here,
  '..',
  '..',
  '.output',
  'chrome-mv3-e2e',
);
export const FIXTURE_ORIGIN = 'http://127.0.0.1:4173';

export type Fixture =
  | 'article'
  | 'store'
  | 'app'
  | 'clip'
  | 'constraint'
  | 'shadow'
  | 'spa'
  | 'hydration'
  | 'shell';

export interface TabState {
  tabId: number;
  domain: string | null;
  tabSession?: string | null;
  phase: string;
  engine: boolean;
  changes: Array<{ op: string; status: string; level: number }>;
  /** The one offer this page view shows, if any. */
  offer?: { op: string } | null;
}

export interface Extension {
  context: BrowserContext;
  id: string;
  /** An extension page used to message the worker (chrome.runtime is available there). */
  control: Page;
  send<T = unknown>(msg: Record<string, unknown>): Promise<T>;
  /** Reset local state and seed a profile (and optionally an account mirror). */
  seed(opts: { profile?: unknown; account?: unknown }): Promise<void>;
  /**
   * Open an engine fixture in a new tab and wait until the worker has its
   * plan applied. `viewport` sizes the page before it loads.
   */
  openFixture(
    name: Fixture,
    opts?: { settle?: boolean; viewport?: { width: number; height: number } },
  ): Promise<{ page: Page; tabId: number }>;
  tabState(tabId: number): Promise<TabState | undefined>;
  /** The popup, opened as a page for a tab (popup.html?tab=<id>, test builds only). */
  openPopup(tabId: number): Promise<Page>;
}

let nonce = 0;

/** The slice of the extension API the control page uses. */
interface ControlChrome {
  runtime: { sendMessage(msg: unknown): Promise<unknown> };
  tabs: { query(q: object): Promise<Array<{ id?: number; url?: string }>> };
}

async function launch(): Promise<{
  context: BrowserContext;
  id: string;
  dataDir: string;
}> {
  await stat(join(EXTENSION_DIR, 'manifest.json')).catch(() => {
    throw new Error(
      `No e2e build at ${EXTENSION_DIR}. Run "pnpm --filter @webable/extension test:e2e" (it builds with --mode e2e first).`,
    );
  });
  const dataDir = await mkdtemp(join(tmpdir(), 'webable-e2e-'));
  const bundled = process.env.PW_CHANNEL === 'chromium';
  const context = await chromium.launchPersistentContext(dataDir, {
    ...(bundled ? {} : { channel: process.env.PW_CHANNEL ?? 'chrome' }),
    headless: !process.env.HEADED,
    viewport: { width: 1280, height: 800 },
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: bundled
      ? [
          `--disable-extensions-except=${EXTENSION_DIR}`,
          `--load-extension=${EXTENSION_DIR}`,
        ]
      : ['--enable-unsafe-extension-debugging'],
  });
  if (!bundled) {
    const browser = context.browser();
    if (!browser)
      throw new Error('No browser handle for the persistent context.');
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: EXTENSION_DIR });
    await cdp.detach();
  }
  const worker =
    context.serviceWorkers().find((w) => w.url().endsWith('/background.js')) ??
    (await context.waitForEvent('serviceworker', {
      predicate: (w) => w.url().endsWith('/background.js'),
      timeout: 15_000,
    }));
  return { context, id: new URL(worker.url()).host, dataDir };
}

export const test = base.extend<{ ext: Extension }, { extension: Extension }>({
  extension: [
    // Playwright resolves fixture dependencies from this destructuring pattern.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const { context, id, dataDir } = await launch();
      const control = await context.newPage();
      await control.goto(`chrome-extension://${id}/welcome.html`);

      const send = async <T>(msg: Record<string, unknown>): Promise<T> =>
        control.evaluate(
          (m) =>
            (
              globalThis as unknown as { chrome: ControlChrome }
            ).chrome.runtime.sendMessage(m),
          msg,
        ) as Promise<T>;

      // The worker registers the engine for the fixture origin at start-up.
      await expect
        .poll(
          async () => {
            const s = await send<{ registered?: Array<{ id: string }> }>({
              type: 'e2e:state',
            });
            return (s.registered ?? []).map((r) => r.id);
          },
          { timeout: 15_000 },
        )
        .toContain('webable-engine');

      const tabState = async (tabId: number): Promise<TabState | undefined> => {
        const s = await send<{ tabs: TabState[] }>({ type: 'e2e:state' });
        return s.tabs.find((t) => t.tabId === tabId);
      };

      const ext: Extension = {
        context,
        id,
        control,
        send,
        async seed({ profile, account }) {
          const reply = await send<{ ok: boolean }>({
            type: 'e2e:seed',
            reset: true,
            ...(profile !== undefined ? { profile } : {}),
            ...(account !== undefined ? { account } : {}),
          });
          expect(reply.ok, 'e2e:seed accepted').toBe(true);
        },
        async openFixture(name, { settle = true, viewport } = {}) {
          const page = await context.newPage();
          if (viewport) await page.setViewportSize(viewport);
          const url = `${FIXTURE_ORIGIN}/engine/${name}.html?e2e=${++nonce}`;
          await page.goto(url, { waitUntil: 'load' });
          const tabId = await control.evaluate(async (u) => {
            const c = (globalThis as unknown as { chrome: ControlChrome })
              .chrome;
            const tabs = await c.tabs.query({});
            return tabs.find((t) => t.url === u)?.id ?? -1;
          }, url);
          expect(tabId, 'fixture tab found').toBeGreaterThan(0);
          if (settle) {
            await expect
              .poll(async () => (await tabState(tabId))?.phase, {
                timeout: 15_000,
              })
              .toBe('ready');
          }
          return { page, tabId };
        },
        tabState,
        async openPopup(tabId) {
          const popup = await context.newPage();
          await popup.setViewportSize({ width: 380, height: 600 });
          await popup.goto(`chrome-extension://${id}/popup.html?tab=${tabId}`);
          await expect(popup.locator('h1')).toBeVisible();
          return popup;
        },
      };
      await use(ext);
      await context.close();
      await rm(dataDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    },
    { scope: 'worker', timeout: 60_000 },
  ],
  ext: async ({ extension }, use) => {
    await extension.seed({ profile: undefined });
    await use(extension);
    // Close every tab this test opened (the control page stays).
    for (const page of extension.context.pages())
      if (page !== extension.control) await page.close().catch(() => undefined);
  },
});

export { expect };

/** Computed style of the first element matching a selector. */
export function computed(
  page: Page,
  selector: string,
  prop: string,
): Promise<string> {
  return page.$eval(
    selector,
    (el, p) => getComputedStyle(el).getPropertyValue(p),
    prop,
  );
}
