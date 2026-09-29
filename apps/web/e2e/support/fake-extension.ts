import type { BridgeStatus, LocalSite, SentReceipt } from '@webable/core';
import type { Page } from '@playwright/test';

/*
 * A stand-in for WebAble's service worker on the other end of
 * chrome.runtime.sendMessage(EXTENSION_ID, message), installed into the page
 * before any script runs. It answers the bridge protocol
 * (packages/core/src/bridge/protocol.ts) from in-page state and records every
 * message in window.__waBridge.log, so specs can drive the extension-backed
 * states (Connect, Sites, What was sent) without a built extension.
 */

export interface FakeExtensionState {
  status: BridgeStatus;
  sites: LocalSite[];
  receipts: SentReceipt[];
}

export type FakeOverrides = Omit<Partial<FakeExtensionState>, 'status'> & {
  status?: Partial<BridgeStatus>;
};

export function fakeState(overrides: FakeOverrides = {}): FakeExtensionState {
  const now = Date.now();
  return {
    status: {
      version: '0.1.0',
      installId: 'e2e-install',
      connected: false,
      email: null,
      allSites: false,
      enabled: true,
      ...overrides.status,
    },
    sites: overrides.sites ?? [
      {
        domain: 'news.example.com',
        paused: false,
        blocked: ['line_spacing'],
        pinned: [],
        lastChanges: 3,
        lastVisit: now - 60_000,
      },
      {
        domain: 'shop.example.org',
        paused: true,
        blocked: [],
        pinned: ['target_size'],
        lastChanges: 0,
        lastVisit: now - 3 * 86_400_000,
      },
    ],
    receipts: overrides.receipts ?? [
      {
        id: 'r1',
        at: now - 120_000,
        domain: 'news.example.com',
        destination: 'page_analysis',
        bytes: 812,
        body: { v: 1, regions: [{ id: 'r0', words: ['sidebar'], links: 12 }] },
      },
    ],
  };
}

export async function installFakeExtension(
  page: Page,
  state: FakeExtensionState,
): Promise<void> {
  await page.addInitScript((initial: FakeExtensionState) => {
    type Msg = { type: string; [key: string]: unknown };
    const s: FakeExtensionState = JSON.parse(JSON.stringify(initial));
    const log: Msg[] = [];
    (window as unknown as { __waBridge: unknown }).__waBridge = {
      log,
      state: s,
    };
    const ok = (data: unknown) => ({ ok: true, data });
    const reply = (msg: Msg): unknown => {
      switch (msg.type) {
        case 'wa:ping':
        case 'wa:refresh':
          return ok(s.status);
        case 'wa:connect':
          s.status.connected = true;
          s.status.email = String(msg.email);
          return ok(s.status);
        case 'wa:disconnect':
          s.status.connected = false;
          s.status.email = null;
          return ok(s.status);
        case 'wa:sites':
          return ok(s.sites);
        case 'wa:site-update': {
          const change = msg.change as {
            kind: string;
            paused?: boolean;
            op?: string;
            blocked?: boolean;
          };
          if (change.kind === 'forget')
            s.sites = s.sites.filter((x) => x.domain !== msg.domain);
          for (const site of s.sites) {
            if (site.domain !== msg.domain) continue;
            if (change.kind === 'pause') site.paused = Boolean(change.paused);
            if (change.kind === 'block' && change.op) {
              site.blocked = change.blocked
                ? [...new Set([...site.blocked, change.op])]
                : site.blocked.filter((op) => op !== change.op);
            }
          }
          return ok(s.sites);
        }
        case 'wa:receipts':
          return ok(s.receipts);
        case 'wa:clear-local':
          s.sites = [];
          s.receipts = [];
          return ok(s.status);
        default:
          return {
            ok: false,
            error: { code: 'bad_request', message: 'Unrecognised message.' },
          };
      }
    };
    const runtime = {
      lastError: undefined,
      sendMessage(
        _id: string,
        msg: Msg,
        callback: (response: unknown) => void,
      ) {
        log.push(JSON.parse(JSON.stringify(msg)) as Msg);
        setTimeout(() => callback(reply(msg)), 20);
      },
    };
    const w = window as unknown as { chrome?: Record<string, unknown> };
    w.chrome = w.chrome ?? {};
    Object.defineProperty(w.chrome, 'runtime', {
      value: runtime,
      configurable: true,
    });
  }, state);
}

/** Every bridge message the page sent, oldest first. */
export async function bridgeLog(
  page: Page,
): Promise<Array<{ type: string; [key: string]: unknown }>> {
  return page.evaluate(
    () =>
      (window as unknown as { __waBridge: { log: Array<{ type: string }> } })
        .__waBridge.log,
  );
}
