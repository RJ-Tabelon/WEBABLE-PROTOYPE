import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  activeTabId,
  createClient,
  type ReplyOf,
  type UiClient,
} from '@/lib/popup/client';
import { isChecking } from '@/lib/popup/model';
import { applyPrefs, readSystemSignals } from '@/lib/popup/theme';
import type { TabDetail, UiMessage } from '@/lib/sw/ui';

/**
 * The popup's connection to the service worker: the tab it was opened on,
 * the latest view, and actions that return the next view. Views are pushed
 * by the worker (`ui:changed`), and polled while the page is being checked.
 */

export type Phase = 'loading' | 'ready' | 'unresponsive';

/** "Checking…" appears only if the work takes longer than this (--delay-status). */
export const STATUS_DELAY_MS = 300;
const POLL_MS = 1_000;
const REFRESH_DEBOUNCE_MS = 80;

type TabMessage = Extract<UiMessage, { tabId: number }>;
type Without<M> = M extends unknown ? Omit<M, 'tabId'> : never;
export type TabAction = Without<TabMessage>;

export interface PopupApi {
  phase: Phase;
  view: TabDetail | null;
  tabId: number | null;
  client: UiClient;
  /** Send a tab message; the reply (a fresh view) replaces the current one. */
  act(action: TabAction): Promise<TabDetail | null>;
  /** Send a message that does not return a view, then refresh. */
  call<M extends UiMessage>(msg: M): Promise<ReplyOf<M['type']> | null>;
  refresh(): Promise<void>;
}

export function usePopup(client: UiClient = defaultClient()): PopupApi {
  const [phase, setPhase] = useState<Phase>('loading');
  const [view, setViewState] = useState<TabDetail | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const tabRef = useRef<number | null>(null);
  const viewRef = useRef<TabDetail | null>(null);
  const delayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Show a view. A switch into "Checking" waits STATUS_DELAY_MS so quick work
   * never flashes a status; anything else shows at once.
   */
  const setView = useCallback((next: TabDetail) => {
    const prev = viewRef.current;
    if (delayTimer.current) {
      clearTimeout(delayTimer.current);
      delayTimer.current = null;
    }
    const entering =
      prev !== null && !isChecking(prev.status) && isChecking(next.status);
    if (entering) {
      delayTimer.current = setTimeout(() => {
        delayTimer.current = null;
        viewRef.current = next;
        setViewState(next);
      }, STATUS_DELAY_MS);
      return;
    }
    viewRef.current = next;
    setViewState(next);
  }, []);

  useEffect(() => {
    if (view) applyPrefs(document.documentElement, view.prefs);
  }, [view]);

  const load = useCallback(async (): Promise<void> => {
    const id = tabRef.current;
    if (id === null) return;
    const next = await client.send({ type: 'ui:view', tabId: id });
    if (next) {
      setView(next);
      setPhase('ready');
    } else if (!viewRef.current) setPhase('unresponsive');
  }, [client, setView]);

  // Open: find the tab, tell the worker what the OS asks for, then load.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const id = await activeTabId();
      if (cancelled) return;
      if (id === null) {
        setPhase('unresponsive');
        return;
      }
      tabRef.current = id;
      setTabId(id);
      void client.send({
        type: 'ui:system',
        signals: readSystemSignals(window),
      });
      await load();
    })();
    return () => {
      cancelled = true;
      if (delayTimer.current) clearTimeout(delayTimer.current);
    };
  }, [client, load]);

  // The worker says something changed.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = client.onChanged((changed) => {
      if (changed !== null && changed !== tabRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), REFRESH_DEBOUNCE_MS);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [client, load]);

  // While the page is being checked, ask again every second.
  const checking = view ? isChecking(view.status) : false;
  useEffect(() => {
    if (!checking) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [checking, load]);

  const act = useCallback(
    async (action: TabAction): Promise<TabDetail | null> => {
      const id = tabRef.current;
      if (id === null) return null;
      const reply = (await client.send({
        ...action,
        tabId: id,
      } as TabMessage)) as
        | TabDetail
        | {
            ok: boolean;
          }
        | null;
      if (reply && 'status' in reply) {
        setView(reply);
        return reply;
      }
      await load();
      return viewRef.current;
    },
    [client, load, setView],
  );

  const call = useCallback(
    async <M extends UiMessage>(msg: M): Promise<ReplyOf<M['type']> | null> => {
      const reply = await client.send(msg);
      await load();
      return reply;
    },
    [client, load],
  );

  return useMemo(
    () => ({ phase, view, tabId, client, act, call, refresh: load }),
    [phase, view, tabId, client, act, call, load],
  );
}

let shared: UiClient | null = null;
function defaultClient(): UiClient {
  shared ??= createClient();
  return shared;
}
