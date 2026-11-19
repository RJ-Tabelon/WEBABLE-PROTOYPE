import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createClient } from '../../../lib/supabase/server';
import {
  createFakeSupabase,
  type FakeSupabase,
} from '../../../lib/supabase/testing';
import { GET, POST } from './route';

vi.mock('../../../lib/supabase/server', () => ({ createClient: vi.fn() }));

let fake: FakeSupabase;

beforeEach(() => {
  fake = createFakeSupabase();
  vi.mocked(createClient).mockResolvedValue(
    fake.client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
});

function post(init: { origin?: string; form?: Record<string, string> } = {}) {
  const headers: Record<string, string> = {};
  if (init.origin) headers.origin = init.origin;
  const body = init.form ? new URLSearchParams(init.form) : undefined;
  if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
  return new NextRequest('http://localhost:3000/auth/sign-out', {
    method: 'POST',
    headers,
    body,
  });
}

describe('POST /auth/sign-out', () => {
  it('signs out of this browser and lands on sign-in', async () => {
    const res = await POST(post({ origin: 'http://localhost:3000' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/sign-in?signed_out=1',
    );
    expect(fake.authCalls).toEqual([['signOut', [{ scope: 'local' }]]]);
  });

  it('can sign out everywhere', async () => {
    await POST(
      post({ origin: 'http://localhost:3000', form: { scope: 'global' } }),
    );
    expect(fake.authCalls).toEqual([['signOut', [{ scope: 'global' }]]]);
  });

  it('refuses cross-site requests', async () => {
    const res = await POST(post({ origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect(fake.authCalls).toEqual([]);
  });

  it('still redirects when the client fails', async () => {
    vi.mocked(createClient).mockRejectedValueOnce(new Error('env'));
    const res = await POST(post());
    expect(res.status).toBe(303);
  });

  it('does not sign out on GET', () => {
    expect(GET().status).toBe(405);
  });
});
