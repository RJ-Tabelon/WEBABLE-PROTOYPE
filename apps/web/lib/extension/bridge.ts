import {
  type BridgeErrorCode,
  type BridgeRequest,
  bridgeRequestSchema,
  type BridgeResponses,
  type BridgeStatus,
  type LocalSite,
  type SentReceipt,
} from '@webable/core';
import { z } from 'zod';

import { getPublicEnv } from '../env';

/**
 * Typed client for the extension bridge: chrome.runtime.sendMessage(EXTENSION_ID,
 * request) from a page on an origin the extension lists in `externally_connectable`.
 *
 * - Availability: `chrome.runtime.sendMessage` only exists on this page when some
 *   installed extension lists this origin. Missing means "not installed" here.
 * - Every call resolves (never rejects) to a BridgeResult with a plain-language
 *   message, and times out instead of hanging when the service worker is asleep
 *   or gone.
 * - Requests are validated against the shared protocol before sending; replies
 *   are validated before the page trusts them.
 *
 * Browser-only: import from Client Components. On the server every call resolves
 * to `not_installed`.
 */

export type BridgeRequestType = BridgeRequest['type'];
export type BridgeRequestOf<K extends BridgeRequestType> = Extract<
  BridgeRequest,
  { type: K }
>;

export type BridgeFailureReason =
  /** No extension id configured for this build. */
  | 'not_configured'
  /** No extension answers on this page (not installed, disabled, or another browser). */
  | 'not_installed'
  /** The extension did not answer in time. */
  | 'timeout'
  /** The extension answered with an error code. */
  | 'rejected'
  /** The reply did not match the protocol (usually an outdated extension). */
  | 'invalid_response'
  /** This page built a request the protocol does not allow (a bug). */
  | 'invalid_request';

export interface BridgeFailure {
  reason: BridgeFailureReason;
  /** Present when the extension itself answered with an error. */
  code?: BridgeErrorCode;
  /** Plain language, safe to show (design-final.md 13). */
  message: string;
}

export type BridgeResult<T> =
  { ok: true; data: T } | { ok: false; error: BridgeFailure };

export const BRIDGE_MESSAGES: Readonly<
  Record<Exclude<BridgeFailureReason, 'rejected'>, string>
> = Object.freeze({
  not_configured: "This page doesn't know which extension to talk to.",
  not_installed: "WebAble isn't installed in this browser.",
  timeout: "WebAble didn't answer in time. Reload this page, then try again.",
  invalid_response:
    'WebAble sent an answer this page can’t read. Update the extension, then try again.',
  invalid_request:
    'This page sent WebAble a request it can’t use. Reload the page, then try again.',
});

export const BRIDGE_ERROR_MESSAGES: Readonly<Record<BridgeErrorCode, string>> =
  Object.freeze({
    bad_request:
      'WebAble couldn’t use that request. Reload this page, then try again.',
    not_connected: 'This browser isn’t connected to your account yet.',
    auth_failed:
      'The extension couldn’t sign in with that link. Nothing changed. Try again.',
    forbidden_origin: 'WebAble doesn’t accept requests from this page.',
    internal:
      'WebAble ran into a problem. Nothing changed. Try again in a moment.',
  });

/** How long each request may take, in ms. Connecting waits on a network round trip. */
export const BRIDGE_TIMEOUTS: Readonly<Record<BridgeRequestType, number>> =
  Object.freeze({
    'wa:ping': 3000,
    'wa:connect': 15000,
    'wa:disconnect': 8000,
    'wa:refresh': 8000,
    'wa:sites': 5000,
    'wa:site-update': 5000,
    'wa:receipts': 5000,
    'wa:clear-local': 8000,
  });

/* ------------------------------------------------------------------------ */
/* Reply validation                                                          */
/* ------------------------------------------------------------------------ */

const BRIDGE_ERROR_CODES = [
  'bad_request',
  'not_connected',
  'auth_failed',
  'forbidden_origin',
  'internal',
] as const satisfies readonly BridgeErrorCode[];

const envelopeSchema = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string().optional(),
    }),
  }),
]);

const statusSchema = z.object({
  version: z.string().max(64),
  installId: z.string().max(128),
  connected: z.boolean(),
  email: z.string().max(320).nullable(),
  allSites: z.boolean(),
  enabled: z.boolean(),
}) satisfies z.ZodType<BridgeStatus>;

const opListSchema = z.array(z.string().max(64)).max(64);

const siteSchema = z.object({
  domain: z.string().min(1).max(253),
  paused: z.boolean(),
  blocked: opListSchema,
  pinned: opListSchema,
  lastChanges: z.number().int().min(0),
  lastVisit: z.number().min(0),
}) satisfies z.ZodType<LocalSite>;

const receiptSchema = z.object({
  id: z.string().min(1).max(128),
  at: z.number().min(0),
  domain: z.string().max(253),
  destination: z.literal('page_analysis'),
  bytes: z.number().int().min(0),
  body: z.unknown(),
});

const sitesSchema = z.array(siteSchema).max(5000);
const receiptsSchema = z.array(receiptSchema).max(1000);

const RESPONSE_SCHEMAS: { [K in BridgeRequestType]: z.ZodType<unknown> } = {
  'wa:ping': statusSchema,
  'wa:connect': statusSchema,
  'wa:disconnect': statusSchema,
  'wa:refresh': statusSchema,
  'wa:sites': sitesSchema,
  'wa:site-update': sitesSchema,
  'wa:receipts': receiptsSchema,
  'wa:clear-local': statusSchema,
};

function isBridgeErrorCode(value: string): value is BridgeErrorCode {
  return (BRIDGE_ERROR_CODES as readonly string[]).includes(value);
}

function failure(reason: Exclude<BridgeFailureReason, 'rejected'>): {
  ok: false;
  error: BridgeFailure;
} {
  return { ok: false, error: { reason, message: BRIDGE_MESSAGES[reason] } };
}

/** Validate a raw reply for a request type. Exported for tests. */
export function parseBridgeReply<K extends BridgeRequestType>(
  type: K,
  raw: unknown,
): BridgeResult<BridgeResponses[K]> {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) return failure('invalid_response');
  if (!envelope.data.ok) {
    const code = isBridgeErrorCode(envelope.data.error.code)
      ? envelope.data.error.code
      : 'internal';
    return {
      ok: false,
      // The extension's own message is for developers; people see ours.
      error: { reason: 'rejected', code, message: BRIDGE_ERROR_MESSAGES[code] },
    };
  }
  const data = RESPONSE_SCHEMAS[type].safeParse(envelope.data.data);
  if (!data.success) return failure('invalid_response');
  // The schema for K validates exactly BridgeResponses[K].
  return { ok: true, data: data.data as BridgeResponses[K] };
}

/* ------------------------------------------------------------------------ */
/* Transport                                                                  */
/* ------------------------------------------------------------------------ */

/** The part of `chrome.runtime` a web page can use. */
export interface ExternalRuntime {
  sendMessage(
    extensionId: string,
    message: unknown,
    callback: (response: unknown) => void,
  ): void;
  readonly lastError?: { message?: string } | undefined;
}

interface ChromeWindow {
  chrome?: { runtime?: Partial<ExternalRuntime> };
}

/** `chrome.runtime` when it can message an extension from this page, else null. */
export function pageRuntime(): ExternalRuntime | null {
  if (typeof window === 'undefined') return null;
  const runtime = (window as unknown as ChromeWindow).chrome?.runtime;
  return runtime && typeof runtime.sendMessage === 'function'
    ? (runtime as ExternalRuntime)
    : null;
}

export interface SendOptions {
  /** Override the per-type timeout (ms). */
  timeoutMs?: number;
  /** Stop waiting (the extension may still act on the request). */
  signal?: AbortSignal;
}

export interface Bridge {
  /** True when this page can message an extension at all (it may still not be WebAble). */
  available(): boolean;
  send<K extends BridgeRequestType>(
    request: BridgeRequestOf<K>,
    options?: SendOptions,
  ): Promise<BridgeResult<BridgeResponses[K]>>;
}

export interface BridgeConfig {
  extensionId: string | null;
  /** Where to find `chrome.runtime`. Defaults to the page's. */
  runtime?: () => ExternalRuntime | null;
  timeouts?: Partial<Record<BridgeRequestType, number>>;
}

export function createBridge(config: BridgeConfig): Bridge {
  const getRuntime = config.runtime ?? pageRuntime;
  const timeouts = { ...BRIDGE_TIMEOUTS, ...config.timeouts };

  return {
    available() {
      return config.extensionId !== null && getRuntime() !== null;
    },

    send<K extends BridgeRequestType>(
      request: BridgeRequestOf<K>,
      options: SendOptions = {},
    ): Promise<BridgeResult<BridgeResponses[K]>> {
      const parsed = bridgeRequestSchema.safeParse(request);
      if (!parsed.success) return Promise.resolve(failure('invalid_request'));
      const extensionId = config.extensionId;
      if (!extensionId) return Promise.resolve(failure('not_configured'));
      const runtime = getRuntime();
      if (!runtime) return Promise.resolve(failure('not_installed'));
      const type = request.type as K;

      return new Promise((resolve) => {
        let settled = false;
        const finish = (result: BridgeResult<BridgeResponses[K]>) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', onAbort);
          resolve(result);
        };
        const onAbort = () => finish(failure('timeout'));
        const timer = setTimeout(
          () => finish(failure('timeout')),
          options.timeoutMs ?? timeouts[type],
        );
        if (options.signal?.aborted) {
          finish(failure('timeout'));
          return;
        }
        options.signal?.addEventListener('abort', onAbort, { once: true });

        try {
          runtime.sendMessage(extensionId, parsed.data, (response) => {
            // Reading lastError marks it handled (no "Unchecked runtime.lastError").
            const lastError = runtime.lastError;
            if (lastError) {
              // "Could not establish connection. Receiving end does not exist."
              finish(failure('not_installed'));
              return;
            }
            finish(parseBridgeReply(type, response));
          });
        } catch {
          // Thrown synchronously for an unknown extension id or a page Chrome blocks.
          finish(failure('not_installed'));
        }
      });
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Default client for this app                                               */
/* ------------------------------------------------------------------------ */

function configuredExtensionId(): string | null {
  try {
    return getPublicEnv().extensionId;
  } catch {
    return null;
  }
}

let defaultBridge: Bridge | null = null;

/** The bridge to WebAble's extension id for this build (NEXT_PUBLIC_EXTENSION_ID). */
export function getBridge(): Bridge {
  defaultBridge ??= createBridge({ extensionId: configuredExtensionId() });
  return defaultBridge;
}

/** Typed shortcuts for each request in the protocol. */
export const extension = {
  ping: (options?: SendOptions) =>
    getBridge().send({ type: 'wa:ping' }, options),
  connect: (tokenHash: string, email: string, options?: SendOptions) =>
    getBridge().send({ type: 'wa:connect', tokenHash, email }, options),
  disconnect: (options?: SendOptions) =>
    getBridge().send({ type: 'wa:disconnect' }, options),
  refresh: (options?: SendOptions) =>
    getBridge().send({ type: 'wa:refresh' }, options),
  sites: (options?: SendOptions) =>
    getBridge().send({ type: 'wa:sites' }, options),
  updateSite: (
    domain: string,
    change: BridgeRequestOf<'wa:site-update'>['change'],
    options?: SendOptions,
  ) => getBridge().send({ type: 'wa:site-update', domain, change }, options),
  receipts: (options?: SendOptions): Promise<BridgeResult<SentReceipt[]>> =>
    getBridge().send({ type: 'wa:receipts' }, options),
  clearLocal: (options?: SendOptions) =>
    getBridge().send({ type: 'wa:clear-local' }, options),
} as const;

/**
 * Tell the extension to pull the fit and account settings now. Best effort: a
 * missing or asleep extension picks the change up on its next sync anyway.
 */
export async function nudgeExtension(): Promise<void> {
  if (!getBridge().available()) return;
  await extension.refresh({ timeoutMs: 3000 }).catch(() => undefined);
}
