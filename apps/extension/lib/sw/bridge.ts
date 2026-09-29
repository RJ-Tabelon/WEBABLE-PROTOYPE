import {
  bridgeRequestSchema,
  type BridgeErrorCode,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeResponses,
  type BridgeStatus,
} from '@webable/core/bridge/protocol';

import { originAllowed } from './config';

/**
 * The web app <-> extension bridge (externally_connectable). Chrome only
 * delivers messages from origins in the manifest list; this checks the sender
 * origin again and validates every message with the shared schema. Site data
 * answered here stays between this device's extension and the open web app.
 */
export interface BridgeHandlers {
  status(): Promise<BridgeStatus>;
  connect(tokenHash: string, email: string): Promise<'ok' | 'auth_failed'>;
  disconnect(): Promise<void>;
  /** Pull account and fit profile; false when not signed in. */
  refresh(): Promise<boolean>;
  sites(): Promise<BridgeResponses['wa:sites']>;
  siteUpdate(
    domain: string,
    change: Extract<BridgeRequest, { type: 'wa:site-update' }>['change'],
  ): Promise<BridgeResponses['wa:site-update']>;
  receipts(): Promise<BridgeResponses['wa:receipts']>;
  clearLocal(): Promise<void>;
}

export interface BridgeSender {
  origin?: string;
  url?: string;
  /** Set when the sender is another extension (never allowed). */
  id?: string;
}

const fail = (
  code: BridgeErrorCode,
  message: string,
): BridgeResponse<never> => ({
  ok: false,
  error: { code, message },
});

/** Sender check: allowlisted origin, and the page URL agrees with it. */
export function senderAllowed(
  sender: BridgeSender,
  patterns: readonly string[],
): boolean {
  if (!sender.origin || !originAllowed(sender.origin, patterns)) return false;
  if (sender.url) {
    try {
      if (new URL(sender.url).origin !== sender.origin) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function parseBridgeRequest(msg: unknown): BridgeRequest | null {
  const parsed = bridgeRequestSchema.safeParse(msg);
  return parsed.success ? parsed.data : null;
}

export async function handleBridge(
  msg: unknown,
  sender: BridgeSender,
  patterns: readonly string[],
  h: BridgeHandlers,
): Promise<BridgeResponse> {
  if (!senderAllowed(sender, patterns))
    return fail('forbidden_origin', 'This page may not talk to WebAble.');
  const req = parseBridgeRequest(msg);
  if (!req) return fail('bad_request', 'Unrecognised message.');
  try {
    switch (req.type) {
      case 'wa:ping':
        return { ok: true, data: await h.status() };
      case 'wa:connect': {
        const result = await h.connect(req.tokenHash, req.email);
        if (result !== 'ok')
          return fail('auth_failed', 'The sign-in link did not work.');
        return { ok: true, data: await h.status() };
      }
      case 'wa:disconnect':
        await h.disconnect();
        return { ok: true, data: await h.status() };
      case 'wa:refresh': {
        const ok = await h.refresh();
        if (!ok)
          return fail(
            'not_connected',
            'WebAble is not signed in on this device.',
          );
        return { ok: true, data: await h.status() };
      }
      case 'wa:sites':
        return { ok: true, data: await h.sites() };
      case 'wa:site-update':
        return {
          ok: true,
          data: await h.siteUpdate(req.domain.toLowerCase(), req.change),
        };
      case 'wa:receipts':
        return { ok: true, data: await h.receipts() };
      case 'wa:clear-local':
        await h.clearLocal();
        return { ok: true, data: await h.status() };
    }
  } catch {
    return fail('internal', 'Something went wrong in the extension.');
  }
}
