// Owner: C1. Typed messaging from the content script (and extension pages) to the background worker.
//
// Every request travels as `{ __wa: 1, req }` and every reply as an envelope:
//   { ok: true, data } | { ok: false, code, error }
// so the caller can tell a server failure from a timeout from a reloaded extension.

import type { BgRequest, FitProfile, Settings } from '@webable/core';

/** Extra requests the background answers beyond the shared BgRequest union (popup and engine helpers). */
export type ExtRequest =
  | BgRequest
  | { type: 'openFitting' }
  | { type: 'health' }
  | { type: 'zoomInfo' }
  | { type: 'pageStart' }
  | { type: 'setFit'; fit: FitProfile | null }
  | { type: 'setSettings'; patch: Partial<Settings> }
  | { type: 'getReport'; tabId?: number };

/** Answer to `zoomInfo`. */
export interface ZoomInfo {
  factor: number;
  /** The last factor WebAble set in this tab, or null. */
  ours: number | null;
  /** The person changed the zoom themselves after WebAble set it. */
  personChanged: boolean;
}

/**
 * Answer to `health`: the server's HealthStatus (`ok`, `jev`, `ai`) plus how long the check took. When the server
 * cannot be reached: ok false, ai 'off'. `openai` is the older boolean, kept for readers that still use it.
 */
export interface HealthInfo {
  ok: boolean;
  jev?: { warm: boolean; model: string };
  ai: 'on' | 'off' | 'no_credits';
  openai?: boolean;
  ms: number;
  error?: string;
}

export type BusErrorCode =
  | 'timeout' // no answer in time
  | 'context' // the extension was reloaded or the worker is gone
  | 'server' // the local server answered with an error
  | 'network' // the local server could not be reached
  | 'refused' // the request was refused by a local rule (for example, sensitive text)
  | 'bad_response'; // the answer did not have the expected shape

export class BusError extends Error {
  readonly code: BusErrorCode;
  readonly status: number | null;
  constructor(code: BusErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'BusError';
    this.code = code;
    this.status = status;
  }
}

export interface BusEnvelope {
  __wa: 1;
  req: ExtRequest;
}

export type BusReply<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; code: BusErrorCode; error: string; status?: number | null };

/** Default timeouts per request type, in ms. Server-backed calls get the longest. */
const DEFAULT_TIMEOUTS: Partial<Record<ExtRequest['type'], number>> = {
  understand: 15000,
  struggle: 8000,
  redesign: 25000,
  visualVerify: 20000,
  setZoom: 4000,
  getZoom: 3000,
  zoomInfo: 3000,
  pageStart: 3000,
  getFit: 3000,
  getSettings: 3000,
  report: 3000,
  health: 5000,
  overlayClose: 9000,
};

function isReply(v: unknown): v is BusReply {
  return typeof v === 'object' && v !== null && 'ok' in v && typeof (v as { ok: unknown }).ok === 'boolean';
}

function runtimeAvailable(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
  } catch {
    return false;
  }
}

/** Send any request the background understands. */
export function askExt<T>(req: ExtRequest, timeoutMs?: number): Promise<T> {
  const limit = timeoutMs ?? DEFAULT_TIMEOUTS[req.type] ?? 15000;
  if (!runtimeAvailable()) {
    return Promise.reject(new BusError('context', 'WebAble was updated or reloaded. Reload the page to use it again.'));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new BusError('timeout', `No answer for "${req.type}" within ${Math.round(limit / 100) / 10} s`));
    }, limit);
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const envelope: BusEnvelope = { __wa: 1, req };
    let sent: Promise<unknown>;
    try {
      sent = chrome.runtime.sendMessage(envelope) as Promise<unknown>;
    } catch (err) {
      done(() => reject(new BusError('context', errText(err))));
      return;
    }
    sent.then(
      (reply) => {
        done(() => {
          if (!isReply(reply)) {
            reject(new BusError('bad_response', `Unexpected answer for "${req.type}"`));
            return;
          }
          if (reply.ok) resolve(reply.data as T);
          else reject(new BusError(reply.code, reply.error, reply.status ?? null));
        });
      },
      (err: unknown) => {
        done(() => {
          const msg = errText(err);
          const code: BusErrorCode = /context invalidated|receiving end does not exist|message port closed/i.test(msg)
            ? 'context'
            : 'network';
          reject(new BusError(code, msg));
        });
      },
    );
  });
}

/** Typed request to the background worker, with a timeout and typed errors (BusError). */
export function ask<T>(req: BgRequest, timeoutMs?: number): Promise<T> {
  return askExt<T>(req, timeoutMs);
}

/** Fire-and-forget variant (reports): never throws. */
export function tell(req: ExtRequest): void {
  askExt(req).catch(() => {
    /* best effort */
  });
}

export function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}

/** Plain sentence for a failure, for the ledger and the panel. */
export function plainError(err: unknown): string {
  if (err instanceof BusError) {
    switch (err.code) {
      case 'timeout':
        return 'The WebAble server took too long to answer.';
      case 'network':
        return 'The WebAble server on this computer could not be reached.';
      case 'context':
        return 'WebAble was reloaded. Reload this page to use it again.';
      case 'refused':
        return err.message;
      case 'server':
        return `The WebAble server reported a problem${err.status ? ` (${err.status})` : ''}.`;
      default:
        return 'The WebAble server sent an answer WebAble did not understand.';
    }
  }
  return errText(err);
}
