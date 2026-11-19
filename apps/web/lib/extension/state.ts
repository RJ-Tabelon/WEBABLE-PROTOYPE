import type { BridgeStatus } from '@webable/core';

import type { BridgeFailure, BridgeResult } from './bridge';

/**
 * What the page knows about WebAble in this browser, derived from a wa:ping
 * reply. Pure: shared by the hook, the Connect flow and tests.
 */

/** Where WebAble can run: desktop Chromium browsers install from the Chrome Web Store. */
export type BrowserKind = 'chromium' | 'mobile' | 'other';

interface UserAgentDataLike {
  mobile?: boolean;
  brands?: ReadonlyArray<{ brand: string }>;
}

/** Best-effort browser class, for copy only (never for gating a request). */
export function detectBrowser(
  userAgent: string,
  userAgentData?: UserAgentDataLike | null,
): BrowserKind {
  if (userAgentData?.mobile) return 'mobile';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return 'mobile';
  const brands = userAgentData?.brands?.map((b) => b.brand) ?? [];
  if (
    brands.some((brand) => /Chromium|Google Chrome|Microsoft Edge/.test(brand))
  )
    return 'chromium';
  // Chromium-based desktop browsers all carry "Chrome/<version>" in the UA.
  if (/\bChrome\/\d+/.test(userAgent) && !/\bEdgA|OPT\//.test(userAgent))
    return 'chromium';
  return 'other';
}

/** The browser this page runs in, or 'chromium' during server rendering. */
export function currentBrowser(): BrowserKind {
  if (typeof navigator === 'undefined') return 'chromium';
  const data = (navigator as Navigator & { userAgentData?: UserAgentDataLike })
    .userAgentData;
  return detectBrowser(navigator.userAgent, data);
}

export type ExtensionState =
  /** Asking the extension. */
  | { phase: 'checking' }
  /** No extension answers on this page. */
  | { phase: 'missing'; configured: boolean }
  /** The extension answered. */
  | { phase: 'ready'; status: BridgeStatus }
  /** It is there but something failed (timeout, outdated, error). */
  | { phase: 'error'; error: BridgeFailure };

export function stateFromPing(
  result: BridgeResult<BridgeStatus>,
): ExtensionState {
  if (result.ok) return { phase: 'ready', status: result.data };
  switch (result.error.reason) {
    case 'not_installed':
      return { phase: 'missing', configured: true };
    case 'not_configured':
      return { phase: 'missing', configured: false };
    default:
      return { phase: 'error', error: result.error };
  }
}

function sameEmail(a: string | null, b: string | null): boolean {
  return (
    a !== null &&
    b !== null &&
    a.trim().toLowerCase() === b.trim().toLowerCase()
  );
}

/** The screen the Connect flow shows for a given extension state. */
export type ConnectView =
  | { view: 'checking' }
  | { view: 'install'; configured: boolean }
  | {
      view: 'connect';
      /** Connected, but as a different account. */
      otherEmail: string | null;
    }
  | { view: 'connected'; allSites: boolean; enabled: boolean; version: string }
  | { view: 'error'; error: BridgeFailure };

export function connectView(
  state: ExtensionState,
  userEmail: string | null,
): ConnectView {
  switch (state.phase) {
    case 'checking':
      return { view: 'checking' };
    case 'missing':
      return { view: 'install', configured: state.configured };
    case 'error':
      return { view: 'error', error: state.error };
    case 'ready': {
      const { status } = state;
      if (!status.connected) return { view: 'connect', otherEmail: null };
      // An extension signed in as someone else is not this person's connection.
      if (userEmail && status.email && !sameEmail(status.email, userEmail))
        return { view: 'connect', otherEmail: status.email };
      return {
        view: 'connected',
        allSites: status.allSites,
        enabled: status.enabled,
        version: status.version,
      };
    }
  }
}

/** Whether this browser's extension is connected as this person. */
export function isConnectedAs(
  state: ExtensionState,
  userEmail: string | null,
): boolean {
  return connectView(state, userEmail).view === 'connected';
}
