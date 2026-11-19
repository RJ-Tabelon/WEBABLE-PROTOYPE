import { bridgeRequestSchema } from '@webable/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { copyProblems } from '../auth/copy-lint';
import {
  BRIDGE_ERROR_MESSAGES,
  BRIDGE_MESSAGES,
  createBridge,
  type ExternalRuntime,
  pageRuntime,
  parseBridgeReply,
} from './bridge';

const EXT = 'bbnblnlbgcccbbbbihngngbecbobedie';
const STATUS = {
  version: '1.0.0',
  installId: 'a1b2c3',
  connected: true,
  email: 'person@example.com',
  allSites: false,
  enabled: true,
};

type Reply = {
  response?: unknown;
  lastError?: string;
  throws?: boolean;
  never?: boolean;
};

/** A fake chrome.runtime that answers each message with the next scripted reply. */
function fakeRuntime(replies: Reply[]) {
  const sent: Array<{ id: string; message: unknown }> = [];
  let lastError: { message: string } | undefined;
  const runtime: ExternalRuntime = {
    get lastError() {
      return lastError;
    },
    sendMessage(id, message, callback) {
      sent.push({ id, message });
      const reply = replies.shift() ?? {};
      if (reply.throws) throw new Error('Invalid extension id');
      if (reply.never) return;
      queueMicrotask(() => {
        lastError = reply.lastError ? { message: reply.lastError } : undefined;
        callback(reply.response);
        lastError = undefined;
      });
    },
  };
  return { runtime, sent };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createBridge', () => {
  it('sends a validated request to the configured id and returns typed data', async () => {
    const { runtime, sent } = fakeRuntime([
      { response: { ok: true, data: STATUS } },
    ]);
    const bridge = createBridge({ extensionId: EXT, runtime: () => runtime });
    const result = await bridge.send({ type: 'wa:ping' });
    expect(result).toEqual({ ok: true, data: STATUS });
    expect(sent).toEqual([{ id: EXT, message: { type: 'wa:ping' } }]);
  });

  it('reports not_installed when there is no runtime on the page', async () => {
    const bridge = createBridge({ extensionId: EXT, runtime: () => null });
    expect(bridge.available()).toBe(false);
    const result = await bridge.send({ type: 'wa:ping' });
    expect(result).toEqual({
      ok: false,
      error: {
        reason: 'not_installed',
        message: BRIDGE_MESSAGES.not_installed,
      },
    });
  });

  it('reports not_configured without an extension id', async () => {
    const { runtime, sent } = fakeRuntime([]);
    const bridge = createBridge({ extensionId: null, runtime: () => runtime });
    expect(bridge.available()).toBe(false);
    const result = await bridge.send({ type: 'wa:ping' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('not_configured');
    expect(sent).toHaveLength(0);
  });

  it('treats runtime.lastError as not installed (receiving end does not exist)', async () => {
    const { runtime } = fakeRuntime([
      {
        lastError:
          'Could not establish connection. Receiving end does not exist.',
      },
    ]);
    const result = await createBridge({
      extensionId: EXT,
      runtime: () => runtime,
    }).send({
      type: 'wa:ping',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('not_installed');
  });

  it('treats a synchronous throw as not installed', async () => {
    const { runtime } = fakeRuntime([{ throws: true }]);
    const result = await createBridge({
      extensionId: EXT,
      runtime: () => runtime,
    }).send({
      type: 'wa:ping',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('not_installed');
  });

  it('times out when the extension never answers', async () => {
    vi.useFakeTimers();
    const { runtime } = fakeRuntime([{ never: true }]);
    const pending = createBridge({
      extensionId: EXT,
      runtime: () => runtime,
      timeouts: { 'wa:ping': 1000 },
    }).send({ type: 'wa:ping' });
    await vi.advanceTimersByTimeAsync(999);
    let done = false;
    void pending.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('timeout');
  });

  it('stops waiting when the signal aborts', async () => {
    const { runtime } = fakeRuntime([{ never: true }]);
    const controller = new AbortController();
    const pending = createBridge({
      extensionId: EXT,
      runtime: () => runtime,
    }).send({ type: 'wa:sites' }, { signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
  });

  it('refuses requests the protocol does not allow, without sending', async () => {
    const { runtime, sent } = fakeRuntime([]);
    const bridge = createBridge({ extensionId: EXT, runtime: () => runtime });
    const result = await bridge.send({
      type: 'wa:connect',
      tokenHash: 'short',
      email: 'not-an-email',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('invalid_request');
    expect(sent).toHaveLength(0);
  });

  it('refuses an unknown op in a site update', async () => {
    const { runtime, sent } = fakeRuntime([]);
    const bridge = createBridge({ extensionId: EXT, runtime: () => runtime });
    const result = await bridge.send({
      type: 'wa:site-update',
      domain: 'example.com',
      // @ts-expect-error: not an op id
      change: { kind: 'block', op: 'rewrite_page', blocked: false },
    });
    expect(result.ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('ignores a late reply after the timeout', async () => {
    vi.useFakeTimers();
    let answer: ((response: unknown) => void) | null = null;
    const runtime: ExternalRuntime = {
      lastError: undefined,
      sendMessage(_id, _message, callback) {
        answer = callback;
      },
    };
    const pending = createBridge({
      extensionId: EXT,
      runtime: () => runtime,
      timeouts: { 'wa:ping': 10 },
    }).send({ type: 'wa:ping' });
    await vi.advanceTimersByTimeAsync(10);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(() => answer?.({ ok: true, data: STATUS })).not.toThrow();
  });
});

describe('parseBridgeReply', () => {
  it('maps extension error codes to plain messages', () => {
    const result = parseBridgeReply('wa:sites', {
      ok: false,
      error: { code: 'not_connected', message: 'no session (internal detail)' },
    });
    expect(result).toEqual({
      ok: false,
      error: {
        reason: 'rejected',
        code: 'not_connected',
        message: BRIDGE_ERROR_MESSAGES.not_connected,
      },
    });
  });

  it('treats an unknown error code as internal', () => {
    const result = parseBridgeReply('wa:ping', {
      ok: false,
      error: { code: 'weird' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('internal');
  });

  it('rejects malformed envelopes and data', () => {
    for (const raw of [
      undefined,
      null,
      'ok',
      { ok: true },
      { ok: 'yes', data: STATUS },
    ]) {
      const result = parseBridgeReply('wa:ping', raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.reason).toBe('invalid_response');
    }
    const badSites = parseBridgeReply('wa:sites', {
      ok: true,
      data: [
        {
          domain: '',
          paused: false,
          blocked: [],
          pinned: [],
          lastChanges: 0,
          lastVisit: 0,
        },
      ],
    });
    expect(badSites.ok).toBe(false);
  });

  it('keeps only protocol fields', () => {
    const result = parseBridgeReply('wa:ping', {
      ok: true,
      data: { ...STATUS, refreshToken: 'must-not-appear' },
    });
    expect(result.ok && 'refreshToken' in result.data).toBe(false);
  });

  it('accepts receipts with any JSON body', () => {
    const receipt = {
      id: 'r1',
      at: 1_700_000_000_000,
      domain: 'example.com',
      destination: 'page_analysis',
      bytes: 812,
      body: { v: 1, regions: [{ words: ['nav', 'list'] }] },
    };
    const result = parseBridgeReply('wa:receipts', {
      ok: true,
      data: [receipt],
    });
    expect(result).toEqual({ ok: true, data: [receipt] });
  });
});

/*
 * Requests added by the protocol contract (C6): the page sends them as soon as
 * @webable/core's bridge protocol allows them. Until then these are skipped.
 */
const allows = (request: unknown) =>
  bridgeRequestSchema.safeParse(request).success;
const OPEN_WELCOME = { type: 'wa:open-welcome', focus: 'allow' } as const;
const PIN_OFF = {
  type: 'wa:site-update',
  domain: 'news.example.com',
  change: { kind: 'pin', op: 'target_size', on: false },
} as const;
const RESET = {
  type: 'wa:site-update',
  domain: 'news.example.com',
  change: { kind: 'reset' },
} as const;

describe('protocol additions', () => {
  it.skipIf(!allows(OPEN_WELCOME))(
    'asks the extension to show its welcome page at "Allow on all sites"',
    async () => {
      const { runtime, sent } = fakeRuntime([
        { response: { ok: true, data: { ok: true } } },
      ]);
      const bridge = createBridge({ extensionId: EXT, runtime: () => runtime });
      const result = await bridge.send(OPEN_WELCOME);
      expect(result).toEqual({ ok: true, data: { ok: true } });
      expect(sent).toEqual([{ id: EXT, message: OPEN_WELCOME }]);
    },
  );

  it.skipIf(!allows(PIN_OFF) || !allows(RESET))(
    'sends a site’s always-on change and a whole-site reset',
    async () => {
      const { runtime, sent } = fakeRuntime([
        { response: { ok: true, data: [] } },
        { response: { ok: true, data: [] } },
      ]);
      const bridge = createBridge({ extensionId: EXT, runtime: () => runtime });
      await bridge.send(PIN_OFF);
      await bridge.send(RESET);
      expect(sent.map((s) => s.message)).toEqual([PIN_OFF, RESET]);
    },
  );

  it('reads the welcome page answer and per-site levels', () => {
    expect(
      parseBridgeReply('wa:open-welcome', {
        ok: true,
        data: { ok: true },
      }),
    ).toEqual({ ok: true, data: { ok: true } });
    const site = {
      domain: 'news.example.com',
      paused: false,
      blocked: [],
      pinned: [],
      levels: { text_floor: 3 },
      lastChanges: 2,
      lastVisit: 1_700_000_000_000,
    };
    expect(parseBridgeReply('wa:sites', { ok: true, data: [site] })).toEqual({
      ok: true,
      data: [site],
    });
  });
});

describe('pageRuntime', () => {
  it('is null outside a browser', () => {
    expect(pageRuntime()).toBeNull();
  });
});

describe('bridge copy', () => {
  it('follows the copy rules', () => {
    for (const message of [
      ...Object.values(BRIDGE_MESSAGES),
      ...Object.values(BRIDGE_ERROR_MESSAGES),
    ]) {
      expect(copyProblems(message), message).toEqual([]);
    }
  });
});
