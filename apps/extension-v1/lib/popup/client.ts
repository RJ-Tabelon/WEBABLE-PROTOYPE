import { browser } from 'wxt/browser';
import type { SentReceipt } from '@webable/core/bridge/protocol';

import type {
  Prefs,
  TabDetail,
  UiChanged,
  UiMessage,
  WelcomeState,
} from '../sw/ui';

/**
 * The popup's and welcome page's channel to the service worker. Every call
 * resolves; a worker that does not answer in time yields `null`, and the page
 * says so ("WebAble isn't responding") instead of hanging.
 */

type ViewReplying =
  | 'ui:view'
  | 'ui:undo'
  | 'ui:undo-reason'
  | 'ui:set-level'
  | 'ui:toggle-op'
  | 'ui:quick'
  | 'ui:use-everywhere'
  | 'ui:pause-site'
  | 'ui:offer-answer'
  | 'ui:fit-view'
  | 'ui:fit-view-switch';

export type ReplyOf<T extends UiMessage['type']> = T extends ViewReplying
  ? TabDetail
  : T extends 'ui:receipts'
    ? SentReceipt[]
    : T extends 'ui:prefs' | 'ui:set-prefs'
      ? Prefs
      : T extends 'ui:welcome' | 'ui:grant-all-sites'
        ? WelcomeState
        : { ok: boolean };

export type Send = <M extends UiMessage>(
  msg: M,
) => Promise<ReplyOf<M['type']> | null>;

export const SEND_TIMEOUT_MS = 6_000;

/** Low-level transport, replaceable in tests. */
export interface Transport {
  send(msg: unknown): Promise<unknown>;
  listen(cb: (msg: unknown) => void): () => void;
}

export function runtimeTransport(): Transport {
  return {
    send: (msg) => browser.runtime.sendMessage(msg) as Promise<unknown>,
    listen(cb) {
      const listener = (msg: unknown): undefined => {
        cb(msg);
        return undefined;
      };
      browser.runtime.onMessage.addListener(listener);
      return () => browser.runtime.onMessage.removeListener(listener);
    },
  };
}

function isChanged(msg: unknown): msg is UiChanged {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === 'ui:changed'
  );
}

/** A worker error reply (`{ ok: false, error }`) is not data. */
function isErrorReply(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { ok?: unknown }).ok === false &&
    'error' in (v as Record<string, unknown>)
  );
}

export interface UiClient {
  send: Send;
  /** Called when the worker says a tab's view changed (null: every tab). */
  onChanged(cb: (tabId: number | null) => void): () => void;
}

export function createClient(
  transport: Transport = runtimeTransport(),
  timeoutMs = SEND_TIMEOUT_MS,
): UiClient {
  const send: Send = (msg) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      transport.send(msg).then(
        (reply) => {
          clearTimeout(timer);
          resolve(
            reply === undefined || isErrorReply(reply)
              ? null
              : (reply as never),
          );
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        },
      );
    });
  return {
    send,
    onChanged(cb) {
      return transport.listen((msg) => {
        if (isChanged(msg)) cb(msg.tabId);
      });
    },
  };
}

/**
 * The tab the popup was opened on. Test and development builds also accept
 * `popup.html?tab=<id>`, so the popup can be opened as a page for a given tab.
 */
export async function activeTabId(): Promise<number | null> {
  if (import.meta.env.MODE !== 'production') {
    const forced = Number(new URLSearchParams(location.search).get('tab'));
    if (Number.isInteger(forced) && forced > 0) return forced;
  }
  try {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    return typeof tab?.id === 'number' ? tab.id : null;
  } catch {
    return null;
  }
}
