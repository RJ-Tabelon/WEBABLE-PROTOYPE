import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createClient } from '../supabase/server';
import { createFakeSupabase, type FakeSupabase } from '../supabase/testing';
import { completeAuthRedirect, linkErrorCode } from './complete';

vi.mock('../supabase/server', () => ({ createClient: vi.fn() }));

let fake: FakeSupabase;

beforeEach(() => {
  fake = createFakeSupabase();
  vi.mocked(createClient).mockResolvedValue(
    fake.client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
});

const request = (path: string) =>
  new NextRequest(`http://localhost:3000${path}`);
const location = (res: Response) => {
  const url = new URL(res.headers.get('location') ?? '');
  return `${url.origin}${url.pathname}${url.search}`;
};

describe('completeAuthRedirect', () => {
  it('exchanges a PKCE code and continues to next', async () => {
    const res = await completeAuthRedirect(
      request('/auth/callback?code=abc&next=/tune'),
    );
    expect(res.status).toBe(303);
    expect(location(res)).toBe('http://localhost:3000/tune');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(fake.authCalls).toEqual([['exchangeCodeForSession', ['abc']]]);
  });

  it('defaults to /app and ignores off-site next values', async () => {
    const res = await completeAuthRedirect(
      request('/auth/callback?code=abc&next=https://evil.example'),
    );
    expect(location(res)).toBe('http://localhost:3000/app');
  });

  it('ignores next values that normalize to another host', async () => {
    for (const next of ['/.//evil.example/phish', '/a/..//evil.example']) {
      const res = await completeAuthRedirect(
        request(`/auth/callback?code=abc&next=${encodeURIComponent(next)}`),
      );
      expect(location(res)).toBe('http://localhost:3000/app');
    }
  });

  it('verifies a token hash', async () => {
    const res = await completeAuthRedirect(
      request('/auth/confirm?token_hash=h1&type=email&next=/connect'),
    );
    expect(location(res)).toBe('http://localhost:3000/connect');
    expect(fake.authCalls).toEqual([
      ['verifyOtp', [{ type: 'email', token_hash: 'h1' }]],
    ]);
  });

  it('sends recovery links to the new-password page whatever next says', async () => {
    const res = await completeAuthRedirect(
      request('/auth/confirm?token_hash=h1&type=recovery&next=/app'),
    );
    expect(location(res)).toBe('http://localhost:3000/reset-password');
  });

  it('returns expired links to sign-in with a stable code and the original next', async () => {
    fake.onAuth('exchangeCodeForSession', async () => ({
      data: {},
      error: { name: 'AuthApiError', code: 'flow_state_expired', status: 400 },
    }));
    const res = await completeAuthRedirect(
      request('/auth/callback?code=old&next=/connect'),
    );
    expect(location(res)).toBe(
      'http://localhost:3000/sign-in?next=%2Fconnect&error=link_expired',
    );
  });

  it('reports an outage separately from a bad link', async () => {
    fake.onAuth('verifyOtp', async () => ({
      data: {},
      error: { name: 'AuthRetryableFetchError', status: 0 },
    }));
    const res = await completeAuthRedirect(
      request('/auth/confirm?token_hash=h&type=magiclink'),
    );
    expect(location(res)).toBe(
      'http://localhost:3000/sign-in?error=unavailable',
    );
  });

  it('maps errors Supabase appended to the redirect', async () => {
    const res = await completeAuthRedirect(
      request(
        '/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid',
      ),
    );
    expect(location(res)).toBe(
      'http://localhost:3000/sign-in?error=link_expired',
    );
    expect(fake.authCalls).toEqual([]);
  });

  it('rejects unknown OTP types and empty links', async () => {
    for (const path of [
      '/auth/confirm?token_hash=h&type=sms',
      '/auth/confirm',
      '/auth/callback?next=/tune',
    ]) {
      const res = await completeAuthRedirect(request(path));
      expect(location(res)).toContain('/sign-in?');
      expect(location(res)).toContain('error=link_invalid');
    }
    expect(fake.authCalls).toEqual([]);
  });

  it('survives a client that throws', async () => {
    vi.mocked(createClient).mockRejectedValueOnce(new Error('env'));
    const res = await completeAuthRedirect(request('/auth/callback?code=abc'));
    expect(location(res)).toBe(
      'http://localhost:3000/sign-in?error=unavailable',
    );
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
