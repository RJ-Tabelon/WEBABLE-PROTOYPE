import { describe, expect, it } from 'vitest';

import { BRIDGE_MESSAGES } from './bridge';
import {
  connectView,
  detectBrowser,
  isConnectedAs,
  stateFromPing,
} from './state';

const STATUS = {
  version: '1.0.0',
  installId: 'i1',
  connected: true,
  email: 'Person@Example.com',
  allSites: true,
  enabled: true,
};

describe('detectBrowser', () => {
  const MAC_CHROME =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const MAC_SAFARI =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';
  const FIREFOX =
    'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
  const ANDROID_CHROME =
    'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

  it('recognises desktop Chromium, mobile and other browsers', () => {
    expect(detectBrowser(MAC_CHROME)).toBe('chromium');
    expect(detectBrowser(MAC_SAFARI)).toBe('other');
    expect(detectBrowser(FIREFOX)).toBe('other');
    expect(detectBrowser(ANDROID_CHROME)).toBe('mobile');
  });

  it('prefers user-agent client hints', () => {
    expect(
      detectBrowser('', {
        mobile: false,
        brands: [{ brand: 'Google Chrome' }],
      }),
    ).toBe('chromium');
    expect(detectBrowser(MAC_CHROME, { mobile: true, brands: [] })).toBe(
      'mobile',
    );
  });
});

describe('stateFromPing', () => {
  it('maps replies and failures to phases', () => {
    expect(stateFromPing({ ok: true, data: STATUS })).toEqual({
      phase: 'ready',
      status: STATUS,
    });
    expect(
      stateFromPing({
        ok: false,
        error: {
          reason: 'not_installed',
          message: BRIDGE_MESSAGES.not_installed,
        },
      }),
    ).toEqual({ phase: 'missing', configured: true });
    expect(
      stateFromPing({
        ok: false,
        error: {
          reason: 'not_configured',
          message: BRIDGE_MESSAGES.not_configured,
        },
      }),
    ).toEqual({ phase: 'missing', configured: false });
    expect(
      stateFromPing({
        ok: false,
        error: { reason: 'timeout', message: BRIDGE_MESSAGES.timeout },
      }).phase,
    ).toBe('error');
  });
});

describe('connectView', () => {
  it('asks to install when missing and to connect when signed out', () => {
    expect(connectView({ phase: 'checking' }, 'a@b.co')).toEqual({
      view: 'checking',
    });
    expect(
      connectView({ phase: 'missing', configured: true }, 'a@b.co'),
    ).toEqual({
      view: 'install',
      configured: true,
    });
    expect(
      connectView(
        {
          phase: 'ready',
          status: { ...STATUS, connected: false, email: null },
        },
        'person@example.com',
      ),
    ).toEqual({ view: 'connect', otherEmail: null });
  });

  it('matches the account email case-insensitively', () => {
    const view = connectView(
      { phase: 'ready', status: STATUS },
      'person@example.com',
    );
    expect(view).toEqual({
      view: 'connected',
      allSites: true,
      enabled: true,
      version: '1.0.0',
    });
    expect(
      isConnectedAs({ phase: 'ready', status: STATUS }, ' PERSON@example.com '),
    ).toBe(true);
  });

  it('treats a different account as not connected', () => {
    expect(
      connectView(
        { phase: 'ready', status: { ...STATUS, email: 'other@example.com' } },
        'person@example.com',
      ),
    ).toEqual({ view: 'connect', otherEmail: 'other@example.com' });
  });
});
