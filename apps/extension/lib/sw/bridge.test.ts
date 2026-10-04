import type { BridgeStatus, LocalSite } from '@webable/core/bridge/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  handleBridge,
  parseBridgeRequest,
  senderAllowed,
  type BridgeHandlers,
} from './bridge';
import { E2E_SUPABASE_ORIGIN, originAllowed, readConfig } from './config';

const PATTERNS = ['http://localhost:3000/*', 'https://app.webable.example/*'];
const OK_SENDER = {
  origin: 'http://localhost:3000',
  url: 'http://localhost:3000/connect',
};

const STATUS: BridgeStatus = {
  version: '0.1.0',
  installId: 'id',
  connected: false,
  email: null,
  allSites: false,
  enabled: true,
};
const SITE: LocalSite = {
  domain: 'a.com',
  paused: true,
  blocked: [],
  pinned: [],
  lastChanges: 0,
  lastVisit: 1,
};

function handlers(overrides: Partial<BridgeHandlers> = {}): BridgeHandlers {
  return {
    status: vi.fn(async () => STATUS),
    connect: vi.fn(async () => 'ok' as const),
    disconnect: vi.fn(async () => undefined),
    refresh: vi.fn(async () => true),
    sites: vi.fn(async () => [SITE]),
    siteUpdate: vi.fn(async () => [SITE]),
    receipts: vi.fn(async () => []),
    clearLocal: vi.fn(async () => undefined),
    openWelcome: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('origin allowlist', () => {
  it('accepts exact origins on the list; a pattern without a port allows any port', () => {
    expect(originAllowed('http://localhost:3000', PATTERNS)).toBe(true);
    expect(originAllowed('https://app.webable.example', PATTERNS)).toBe(true);
    expect(originAllowed('http://localhost/', ['http://localhost/*'])).toBe(
      true,
    );
    expect(originAllowed('http://localhost:5555', ['http://localhost/*'])).toBe(
      true,
    );
  });

  it('rejects look-alikes, other schemes, ports and paths', () => {
    for (const origin of [
      // Chrome sends canonical origins; anything else is refused.
      'https://app.webable.example:443',
      'HTTP://LOCALHOST:3000',
      'http://localhost:3001',
      'https://localhost:3000',
      'https://app.webable.example.evil.com',
      'https://evil.com',
      'https://sub.app.webable.example',
      'http://localhost:3000/connect',
      'chrome-extension://abc',
      'null',
      '',
      undefined,
    ])
      expect(originAllowed(origin, PATTERNS), String(origin)).toBe(false);
  });

  it('ignores wildcard host patterns (never valid for externally_connectable)', () => {
    expect(originAllowed('https://a.com', ['https://*.com/*'])).toBe(false);
  });

  it('requires the page URL to agree with the origin', () => {
    expect(senderAllowed(OK_SENDER, PATTERNS)).toBe(true);
    expect(
      senderAllowed(
        { origin: 'http://localhost:3000', url: 'https://evil.com/' },
        PATTERNS,
      ),
    ).toBe(false);
    expect(senderAllowed({ url: 'http://localhost:3000/' }, PATTERNS)).toBe(
      false,
    );
  });
});

describe('bridge messages', () => {
  it('validates every request with the shared schema', () => {
    expect(parseBridgeRequest({ type: 'wa:ping' })).toEqual({
      type: 'wa:ping',
    });
    expect(
      parseBridgeRequest({
        type: 'wa:connect',
        tokenHash: 'short',
        email: 'a@b.co',
      }),
    ).toBeNull();
    expect(
      parseBridgeRequest({
        type: 'wa:connect',
        tokenHash: 'x'.repeat(32),
        email: 'nope',
      }),
    ).toBeNull();
    expect(
      parseBridgeRequest({
        type: 'wa:site-update',
        domain: 'a.com',
        change: { kind: 'block', op: 'not_an_op', blocked: true },
      }),
    ).toBeNull();
    expect(parseBridgeRequest({ type: 'wa:eval', code: '1' })).toBeNull();
    expect(parseBridgeRequest('wa:ping')).toBeNull();
  });

  it('refuses senders off the allowlist before reading the message', async () => {
    const h = handlers();
    const reply = await handleBridge(
      { type: 'wa:sites' },
      { origin: 'https://evil.com' },
      PATTERNS,
      h,
    );
    expect(reply).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'forbidden_origin' }),
    });
    expect(h.sites).not.toHaveBeenCalled();
  });

  it('refuses messages from other extensions', async () => {
    const reply = await handleBridge(
      { type: 'wa:ping' },
      { id: 'other-extension', url: 'chrome-extension://other/x.html' },
      PATTERNS,
      handlers(),
    );
    expect(reply.ok).toBe(false);
  });

  it('answers bad requests without calling anything', async () => {
    const h = handlers();
    const reply = await handleBridge(
      { type: 'wa:nope' },
      OK_SENDER,
      PATTERNS,
      h,
    );
    expect(reply).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'bad_request' }),
    });
  });

  it('routes every request type', async () => {
    const h = handlers();
    const send = (msg: unknown) => handleBridge(msg, OK_SENDER, PATTERNS, h);
    expect(await send({ type: 'wa:ping' })).toEqual({ ok: true, data: STATUS });
    expect(
      await send({
        type: 'wa:connect',
        tokenHash: 'h'.repeat(40),
        email: 'Person@Example.com',
      }),
    ).toEqual({ ok: true, data: STATUS });
    expect(h.connect).toHaveBeenCalledWith(
      'h'.repeat(40),
      'Person@Example.com',
    );
    expect(await send({ type: 'wa:disconnect' })).toEqual({
      ok: true,
      data: STATUS,
    });
    expect(await send({ type: 'wa:refresh' })).toEqual({
      ok: true,
      data: STATUS,
    });
    expect(await send({ type: 'wa:sites' })).toEqual({
      ok: true,
      data: [SITE],
    });
    expect(
      await send({
        type: 'wa:site-update',
        domain: 'A.com',
        change: { kind: 'pause', paused: true },
      }),
    ).toEqual({ ok: true, data: [SITE] });
    expect(h.siteUpdate).toHaveBeenCalledWith('a.com', {
      kind: 'pause',
      paused: true,
    });
    expect(await send({ type: 'wa:receipts' })).toEqual({ ok: true, data: [] });
    expect(await send({ type: 'wa:clear-local' })).toEqual({
      ok: true,
      data: STATUS,
    });
    expect(h.clearLocal).toHaveBeenCalledTimes(1);
    expect(await send({ type: 'wa:open-welcome', focus: 'allow' })).toEqual({
      ok: true,
      data: { ok: true },
    });
    expect(h.openWelcome).toHaveBeenCalledWith('allow');
    await send({ type: 'wa:open-welcome' });
    expect(h.openWelcome).toHaveBeenLastCalledWith(undefined);
  });

  it('passes site resets and pins through, and refuses unknown ops', async () => {
    const h = handlers();
    const send = (msg: unknown) => handleBridge(msg, OK_SENDER, PATTERNS, h);
    await send({
      type: 'wa:site-update',
      domain: 'a.com',
      change: { kind: 'reset' },
    });
    expect(h.siteUpdate).toHaveBeenLastCalledWith('a.com', { kind: 'reset' });
    await send({
      type: 'wa:site-update',
      domain: 'a.com',
      change: { kind: 'pin', op: 'text_floor', on: true },
    });
    expect(h.siteUpdate).toHaveBeenLastCalledWith('a.com', {
      kind: 'pin',
      op: 'text_floor',
      on: true,
    });
    expect(
      await send({
        type: 'wa:site-update',
        domain: 'a.com',
        change: { kind: 'pin', op: 'nope', on: true },
      }),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'bad_request' }),
    });
    expect(h.siteUpdate).toHaveBeenCalledTimes(2);
  });

  it('reports a failed handoff and a refresh without a session', async () => {
    const h = handlers({
      connect: vi.fn(async () => 'auth_failed' as const),
      refresh: vi.fn(async () => false),
    });
    const send = (msg: unknown) => handleBridge(msg, OK_SENDER, PATTERNS, h);
    expect(
      await send({
        type: 'wa:connect',
        tokenHash: 'h'.repeat(40),
        email: 'a@b.co',
      }),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'auth_failed' }),
    });
    expect(await send({ type: 'wa:refresh' })).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'not_connected' }),
    });
  });

  it('turns a thrown handler into an internal error without details', async () => {
    const h = handlers({
      sites: vi.fn(async () => {
        throw new Error('secret stack');
      }),
    });
    const reply = await handleBridge(
      { type: 'wa:sites' },
      OK_SENDER,
      PATTERNS,
      h,
    );
    expect(reply).toEqual({
      ok: false,
      error: { code: 'internal', message: expect.any(String) },
    });
    expect(JSON.stringify(reply)).not.toContain('secret stack');
  });
});

describe('build configuration', () => {
  it('derives the decide URL and the allowlist from public values only', () => {
    const cfg = readConfig({
      MODE: 'production',
      WXT_SUPABASE_URL: 'https://x.supabase.co/',
      WXT_SUPABASE_PUBLISHABLE_KEY: 'pk',
      WXT_WEB_ORIGIN: 'https://app.example/',
    } as unknown as ImportMetaEnv);
    expect(cfg.decideUrl).toBe('https://x.supabase.co/functions/v1/decide');
    expect(cfg.bridgePatterns).toEqual(['https://app.example/*']);
    expect(cfg.e2e).toBe(false);
  });

  it('turns test hooks on only for the e2e mode, which never reaches the live project', () => {
    const e2e = readConfig({
      MODE: 'e2e',
      WXT_SUPABASE_URL: 'https://live.supabase.co',
      WXT_SUPABASE_PUBLISHABLE_KEY: 'live-key',
    } as unknown as ImportMetaEnv);
    expect(e2e.e2e).toBe(true);
    expect(e2e.supabaseUrl).toBe(E2E_SUPABASE_ORIGIN);
    expect(e2e.decideUrl).toBe(`${E2E_SUPABASE_ORIGIN}/functions/v1/decide`);
    expect(e2e.publishableKey).not.toBe('live-key');
    expect(
      readConfig({ MODE: 'development' } as unknown as ImportMetaEnv).e2e,
    ).toBe(false);
  });
});
