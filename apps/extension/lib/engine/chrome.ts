import { browser } from 'wxt/browser';

import type { ContentReplies, ContentToWorker } from '../protocol';
import type { AnnounceStore, Transport } from './adapter';
import { cyrb53 } from './util/hash';

/**
 * chrome.* bindings for the adapter. Only this file (and the entrypoint)
 * touches extension APIs; the engine stays a pure page module.
 */

const SEND_TIMEOUT_MS = 8000;

export function chromeTransport(): Transport {
  return {
    send<T extends ContentToWorker>(
      msg: T,
    ): Promise<ContentReplies[T['type']]> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`${msg.type}: no reply`)),
          SEND_TIMEOUT_MS,
        );
        browser.runtime
          .sendMessage(msg)
          .then((reply: unknown) => {
            clearTimeout(timer);
            resolve(reply as ContentReplies[T['type']]);
          })
          .catch((err: unknown) => {
            clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(String(err)));
          });
      });
    },
    listen(handler) {
      const listener = (
        msg: unknown,
        _sender: unknown,
        sendResponse: (reply: unknown) => void,
      ): true | undefined => {
        const pending = handler(msg);
        if (!pending) return undefined;
        pending.then(sendResponse, () => sendResponse({ ok: false }));
        return true; // keep the channel open for the async reply
      };
      browser.runtime.onMessage.addListener(listener);
      return () => browser.runtime.onMessage.removeListener(listener);
    },
  };
}

const ANNOUNCED_KEY = 'engine.announcedSites';
const ANNOUNCED_MAX = 1000;

/**
 * Local-only memory of sites that already showed the first-time toast.
 * Stored as short hashes of the hostname in chrome.storage.local; never synced.
 * (Superseded as soon as the service worker sends `announce` with the plan.)
 */
export function chromeAnnounceStore(host: string): AnnounceStore {
  return {
    async firstTime() {
      const id = cyrb53(host).toString(36);
      try {
        const got = await browser.storage.local.get(ANNOUNCED_KEY);
        const list = Array.isArray(got[ANNOUNCED_KEY])
          ? (got[ANNOUNCED_KEY] as string[])
          : [];
        if (list.includes(id)) return false;
        const next = [...list, id].slice(-ANNOUNCED_MAX);
        await browser.storage.local.set({ [ANNOUNCED_KEY]: next });
        return true;
      } catch {
        return false; // storage unavailable: stay quiet rather than repeat the toast
      }
    },
  };
}

type DomApi = {
  dom?: { openOrClosedShadowRoot?: (el: HTMLElement) => ShadowRoot | null };
};

/** chrome.dom.openOrClosedShadowRoot, available to content scripts (Chrome 88+). */
export function closedShadowRootOpener():
  ((el: Element) => ShadowRoot | null) | undefined {
  const api = (globalThis as { chrome?: DomApi }).chrome?.dom
    ?.openOrClosedShadowRoot;
  if (typeof api !== 'function') return undefined;
  return (el) => {
    if (!(el instanceof HTMLElement)) return null;
    try {
      return api(el) ?? null;
    } catch {
      return null;
    }
  };
}
