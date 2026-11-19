import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createClient } from '../supabase/client';
import { createFakeSupabase, type FakeSupabase } from '../supabase/testing';
import { completeAuthLink, linkErrorCode } from './complete';

vi.mock('../supabase/client', () => ({ createClient: vi.fn() }));

let fake: FakeSupabase;

beforeEach(() => {
  fake = createFakeSupabase();
  vi.mocked(createClient).mockReturnValue(
    fake.client as unknown as ReturnType<typeof createClient>,
  );
});

const request = (path: string) =>
  new URL(path, 'http://localhost:3000').searchParams;

describe('completeAuthLink', () => {
  it('exchanges a PKCE code and continues to next', async () => {
    const res = await completeAuthLink(
      request('/auth/callback?code=abc&next=/tune'),
    );
    expect(res).toBe('/tune');
    expect(fake.authCalls).toEqual([['exchangeCodeForSession', ['abc']]]);
  });

  it('defaults to /app and ignores off-site next values', async () => {
    const res = await completeAuthLink(
      request('/auth/callback?code=abc&next=https://evil.example'),
    );
    expect(res).toBe('/app');
  });

  it('ignores next values that normalize to another host', async () => {
    for (const next of ['/.//evil.example/phish', '/a/..//evil.example']) {
      const res = await completeAuthLink(
        request(`/auth/callback?code=abc&next=${encodeURIComponent(next)}`),
      );
      expect(res).toBe('/app');
    }
  });

  it('verifies a token hash', async () => {
    const res = await completeAuthLink(
      request('/auth/confirm?token_hash=h1&type=email&next=/connect'),
    );
    expect(res).toBe('/connect');
    expect(fake.authCalls).toEqual([
      ['verifyOtp', [{ type: 'email', token_hash: 'h1' }]],
    ]);
  });

  it('sends recovery links to the new-password page whatever next says', async () => {
    const res = await completeAuthLink(
      request('/auth/confirm?token_hash=h1&type=recovery&next=/app'),
    );
    expect(res).toBe('/reset-password');
  });

  it('returns expired links to sign-in with a stable code and the original next', async () => {
    fake.onAuth('exchangeCodeForSession', async () => ({
      data: {},
      error: { name: 'AuthApiError', code: 'flow_state_expired', status: 400 },
    }));
    const res = await completeAuthLink(
      request('/auth/callback?code=old&next=/connect'),
    );
    expect(res).toBe('/sign-in?next=%2Fconnect&error=link_expired');
  });

  it('reports an outage separately from a bad link', async () => {
    fake.onAuth('verifyOtp', async () => ({
      data: {},
      error: { name: 'AuthRetryableFetchError', status: 0 },
    }));
    const res = await completeAuthLink(
      request('/auth/confirm?token_hash=h&type=magiclink'),
    );
    expect(res).toBe('/sign-in?error=unavailable');
  });

  it('maps errors Supabase appended to the redirect', async () => {
    const res = await completeAuthLink(
      request(
        '/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid',
      ),
    );
    expect(res).toBe('/sign-in?error=link_expired');
    expect(fake.authCalls).toEqual([]);
  });

  it('rejects unknown OTP types and empty links', async () => {
    for (const path of [
      '/auth/confirm?token_hash=h&type=sms',
      '/auth/confirm',
      '/auth/callback?next=/tune',
    ]) {
      const res = await completeAuthLink(request(path));
      expect(res).toContain('/sign-in?');
      expect(res).toContain('error=link_invalid');
    }
    expect(fake.authCalls).toEqual([]);
  });

  it('survives a client that throws', async () => {
    vi.mocked(createClient).mockImplementationOnce(() => {
      throw new Error('env');
    });
    const res = await completeAuthLink(request('/auth/callback?code=abc'));
    expect(res).toBe('/sign-in?error=unavailable');
  });
});

describe('linkErrorCode', () => {
  it('distinguishes expired from invalid links', () => {
    expect(linkErrorCode('otp_expired', 'access_denied')).toBe('link_expired');
    expect(linkErrorCode(null, 'access_denied')).toBe('link_expired');
    expect(linkErrorCode('bad_oauth_state', 'invalid_request')).toBe(
      'link_invalid',
    );
  });
});
