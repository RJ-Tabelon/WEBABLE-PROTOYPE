import { createServerClient } from '@supabase/ssr';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateSession } from './proxy';

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }));
vi.mock('../env', () => ({
  getPublicEnv: () => ({
    supabaseUrl: 'https://ref.supabase.co',
    supabaseKey: 'sb_publishable_x',
    webOrigin: 'http://localhost:3000',
    extensionId: null,
  }),
}));

type CookieMethods = {
  getAll(): { name: string; value: string }[];
  setAll(
    cookies: {
      name: string;
      value: string;
      options: Record<string, unknown>;
    }[],
    headers: Record<string, string>,
  ): void;
};

let refreshWith: {
  name: string;
  value: string;
  options: Record<string, unknown>;
}[] = [];

function mockClaims(
  claims: Record<string, unknown> | null,
  opts: { throws?: boolean } = {},
) {
  vi.mocked(createServerClient).mockImplementation(((
    _url: string,
    _key: string,
    options: { cookies: CookieMethods },
  ) => ({
    auth: {
      getClaims: async () => {
        if (refreshWith.length)
          options.cookies.setAll(refreshWith, {
            'Cache-Control': 'private, no-cache, no-store',
          });
        if (opts.throws) throw new Error('network');
        return { data: claims ? { claims } : null, error: null };
      },
    },
  })) as unknown as typeof createServerClient);
}

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });

beforeEach(() => {
  refreshWith = [];
});

describe('updateSession', () => {
  it('lets signed-in people through to protected pages', async () => {
    mockClaims({ sub: 'u1' });
    const res = await updateSession(request('/app/fit'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('sends signed-out people to sign-in with next', async () => {
    mockClaims(null);
    const res = await updateSession(request('/app/fit?tab=history'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/sign-in?next=%2Fapp%2Ffit%3Ftab%3Dhistory',
    );
    const connect = await updateSession(request('/connect'));
    expect(connect.headers.get('location')).toBe(
      'http://localhost:3000/sign-in?next=%2Fconnect',
    );
  });

  it('leaves public pages alone when signed out', async () => {
    mockClaims(null);
    for (const path of ['/', '/tune', '/sign-in', '/privacy']) {
      const res = await updateSession(request(path));
      expect(res.headers.get('location')).toBeNull();
    }
  });

  it('treats a verification failure as signed out', async () => {
    mockClaims({ sub: 'u1' }, { throws: true });
    const res = await updateSession(request('/app'));
    expect(res.headers.get('location')).toBe('http://localhost:3000/sign-in');
  });

  it('writes refreshed cookies to the response and to the request seen by the page', async () => {
    refreshWith = [
      {
        name: 'sb-ref-auth-token',
        value: 'fresh',
        options: { path: '/', httpOnly: false },
      },
    ];
    mockClaims({ sub: 'u1' });
    const res = await updateSession(request('/app', 'sb-ref-auth-token=stale'));
    expect(res.cookies.get('sb-ref-auth-token')?.value).toBe('fresh');
    expect(res.headers.get('cache-control')).toBe(
      'private, no-cache, no-store',
    );
    // Next forwards overridden request cookies to the render through this header.
    expect(res.headers.get('x-middleware-override-headers')).toContain(
      'cookie',
    );
    expect(res.headers.get('x-middleware-request-cookie')).toContain(
      'sb-ref-auth-token=fresh',
    );
  });

  it('carries cleared cookies onto the sign-in redirect', async () => {
    refreshWith = [
      {
        name: 'sb-ref-auth-token',
        value: '',
        options: { path: '/', maxAge: 0 },
      },
    ];
    mockClaims(null);
    const res = await updateSession(
      request('/app', 'sb-ref-auth-token=revoked'),
    );
    expect(res.headers.get('location')).toBe('http://localhost:3000/sign-in');
    expect(res.headers.get('set-cookie')).toContain('sb-ref-auth-token=;');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});
