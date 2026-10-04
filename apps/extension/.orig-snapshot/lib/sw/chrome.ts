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
