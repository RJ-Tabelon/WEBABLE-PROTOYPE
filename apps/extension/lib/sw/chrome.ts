import { browser } from 'wxt/browser';

import type { WorkerReplies, WorkerToContent } from '../protocol';
import { iconPaths, type BadgeState } from './badge';
import type { UiChanged } from './ui';

/**
 * The browser APIs the worker's logic uses, behind one interface so the
 * orchestration can be tested with fakes.
 */
export interface ChromePort {
  /** Message the top frame of a tab; undefined if nothing answered in time. */
  sendToTab<T extends WorkerToContent | { type: 'sw:focus-layer' }>(
    tabId: number,
    msg: T,
    timeoutMs?: number,
  ): Promise<
    | (T extends WorkerToContent ? WorkerReplies[T['type']] : { ok: boolean })
    | undefined
  >;
  setBadge(tabId: number, state: BadgeState): Promise<void>;
  getZoom(tabId: number): Promise<number>;
  /** Per-tab zoom (reset by navigation), then the factor. */
  setZoom(tabId: number, factor: number): Promise<void>;
  /**
   * Back to Chrome's per-origin zoom: the tab takes the site's own zoom again
   * and the site's zoom is left as it was, or `factor` when given (written for
   * the site, as the person's own Ctrl+/- would be). `own` is the factor the
   * tab showed before WebAble's page scale (Chrome's default when unknown).
   */
  releaseZoom(tabId: number, factor?: number, own?: number): Promise<void>;
  /** The tab's content width in DIP (CSS px at 100%), null when unknown. */
  tabWidth(tabId: number): Promise<number | null>;
  tabUrl(tabId: number): Promise<string | undefined>;
  activeTabId(): Promise<number | null>;
  openTab(url: string): Promise<void>;
  /** Tell open extension pages (the popup) a view changed. */
  broadcast(msg: UiChanged): void;
}

const DEFAULT_TIMEOUT_MS = 4_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

export function chromePort(): ChromePort {
  const lastIcon = new Map<number, string>();
  return {
    async sendToTab(tabId, msg, timeoutMs = DEFAULT_TIMEOUT_MS) {
      const reply = await withTimeout(
        browser.tabs.sendMessage(tabId, msg, {
          frameId: 0,
        }) as Promise<unknown>,
        timeoutMs,
      );
      return reply as never;
    },
    async setBadge(tabId, state) {
      const tasks: Array<Promise<unknown>> = [
        browser.action.setTitle({ tabId, title: state.title }),
        browser.action.setBadgeText({ tabId, text: state.text }),
      ];
      if (state.text) {
        tasks.push(
          browser.action.setBadgeBackgroundColor({ tabId, color: state.color }),
          browser.action.setBadgeTextColor({ tabId, color: state.textColor }),
        );
      }
      if (lastIcon.get(tabId) !== state.icon) {
        lastIcon.set(tabId, state.icon);
        tasks.push(
          browser.action.setIcon({ tabId, path: iconPaths(state.icon) }),
        );
      }
      await Promise.allSettled(tasks);
    },
    async getZoom(tabId) {
      try {
        return await browser.tabs.getZoom(tabId);
      } catch {
        return 1;
      }
    },
    async setZoom(tabId, factor) {
      await browser.tabs.setZoomSettings(tabId, {
        mode: 'automatic',
        scope: 'per-tab',
      });
      await browser.tabs.setZoom(tabId, factor);
    },
    async releaseZoom(tabId, factor, own) {
      // Leaving per-tab scope, Chrome keeps the tab's current zoom by writing
      // it for a site that has no zoom of its own (ZoomController::
      // SetZoomMode), so WebAble's page scale would become the site's zoom in
      // every tab, paused or not. The person's own factor goes back on the
      // tab first: a site with a zoom of its own then shows that, and one
      // without keeps none.
      if (factor === undefined) {
        const { scope } = await browser.tabs.getZoomSettings(tabId);
        if (scope === 'per-tab') await browser.tabs.setZoom(tabId, own ?? 0);
      }
      await browser.tabs.setZoomSettings(tabId, {
        mode: 'automatic',
        scope: 'per-origin',
      });
      if (factor !== undefined) await browser.tabs.setZoom(tabId, factor);
    },
    async tabWidth(tabId) {
      try {
        const tab = await browser.tabs.get(tabId);
        return typeof tab.width === 'number' && tab.width > 0
          ? tab.width
          : null;
      } catch {
        return null;
      }
    },
    async tabUrl(tabId) {
      try {
        const tab = await browser.tabs.get(tabId);
        return tab.url ?? tab.pendingUrl ?? undefined;
      } catch {
        return undefined;
      }
    },
    async activeTabId() {
      try {
        const [tab] = await browser.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        return tab?.id ?? null;
      } catch {
        return null;
      }
    },
    async openTab(url) {
      await browser.tabs.create({ url });
    },
    broadcast(msg) {
      void browser.runtime.sendMessage(msg).catch(() => undefined);
    },
  };
}
