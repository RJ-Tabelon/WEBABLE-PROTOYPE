import { browser } from 'wxt/browser';

import type { ContentReplies, ContentToWorker } from '../protocol';
import type { Transport } from './adapter';

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
