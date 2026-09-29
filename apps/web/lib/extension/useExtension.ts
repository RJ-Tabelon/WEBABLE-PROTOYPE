'use client';

import type { BridgeStatus } from '@webable/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { extension } from './bridge';
import { type ExtensionState, stateFromPing } from './state';

export interface UseExtension {
  state: ExtensionState;
  /** Ask the extension again (after installing it, or from a "Check again" button). */
  recheck: () => Promise<ExtensionState>;
  /** Replace the status with one the extension just returned (after wa:connect). */
  setStatus: (status: BridgeStatus) => void;
}

/**
 * The extension's status in this browser. Pings on mount, and again whenever
 * the tab becomes visible or focused, because people install the extension in
 * another tab and come back. Stale replies never overwrite newer ones.
 */
export function useExtension({
  recheckOnFocus = true,
}: { recheckOnFocus?: boolean } = {}): UseExtension {
  const [state, setState] = useState<ExtensionState>({ phase: 'checking' });
  const sequence = useRef(0);

  const recheck = useCallback(async () => {
    const id = ++sequence.current;
    const next = stateFromPing(await extension.ping());
    if (id === sequence.current) setState(next);
    return next;
  }, []);

  const setStatus = useCallback((status: BridgeStatus) => {
    sequence.current += 1;
    setState({ phase: 'ready', status });
  }, []);

  useEffect(() => {
    void recheck();
    if (!recheckOnFocus) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void recheck();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [recheck, recheckOnFocus]);

  return { state, recheck, setStatus };
}
