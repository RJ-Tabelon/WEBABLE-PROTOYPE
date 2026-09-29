import { z } from 'zod';

import { OP_IDS } from '../ops/catalog';

/**
 * Messages from the WebAble web app to the extension over
 * chrome.runtime.sendMessage(EXTENSION_ID, message), allowed by the
 * extension's `externally_connectable` origin list.
 *
 * Site data (a list of domains is browsing history) never goes to the server;
 * the web app can only read it from this device's extension while open.
 */

const opId = z.enum(OP_IDS);

export const bridgeRequestSchema = z.discriminatedUnion('type', [
  /** Is the extension installed, connected, and allowed on all sites? */
  z.object({ type: z.literal('wa:ping') }),
  /**
   * Sign-in handoff: a single-use token hash minted server-side for the signed-in
   * user. The extension exchanges it for its own session (verifyOtp), so the web
   * app's refresh token is never shared.
   */
  z.object({
    type: z.literal('wa:connect'),
    tokenHash: z.string().min(16).max(256),
    email: z.email(),
  }),
  z.object({ type: z.literal('wa:disconnect') }),
  /** The fit profile or account settings changed; pull them now. */
  z.object({ type: z.literal('wa:refresh') }),
  z.object({ type: z.literal('wa:sites') }),
  z.object({
    type: z.literal('wa:site-update'),
    domain: z.string().min(1).max(253),
    change: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('pause'), paused: z.boolean() }),
      z.object({ kind: z.literal('block'), op: opId, blocked: z.boolean() }),
      z.object({ kind: z.literal('forget') }),
    ]),
  }),
  z.object({ type: z.literal('wa:receipts') }),
  z.object({ type: z.literal('wa:clear-local') }),
]);
export type BridgeRequest = z.infer<typeof bridgeRequestSchema>;

export interface BridgeStatus {
  version: string;
  installId: string;
  connected: boolean;
  email: string | null;
  allSites: boolean;
  enabled: boolean;
}

export interface LocalSite {
  domain: string;
  paused: boolean;
  blocked: string[];
  pinned: string[];
  /** Changes currently in effect on the last visit. */
  lastChanges: number;
  lastVisit: number;
}

export interface SentReceipt {
  id: string;
  at: number;
  /** Shown locally only; never part of what was sent. */
  domain: string;
  destination: 'page_analysis';
  bytes: number;
  /** The exact request body that left the device. */
  body: unknown;
}

export type BridgeResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: BridgeErrorCode; message: string } };

export type BridgeErrorCode =
  | 'bad_request'
  | 'not_connected'
  | 'auth_failed'
  | 'forbidden_origin'
  | 'internal';

export interface BridgeResponses {
  'wa:ping': BridgeStatus;
  'wa:connect': BridgeStatus;
  'wa:disconnect': BridgeStatus;
  'wa:refresh': BridgeStatus;
  'wa:sites': LocalSite[];
  'wa:site-update': LocalSite[];
  'wa:receipts': SentReceipt[];
  'wa:clear-local': BridgeStatus;
}
