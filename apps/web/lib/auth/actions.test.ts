import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createClient } from '../supabase/server';
import { createFakeSupabase, type FakeSupabase } from '../supabase/testing';
import {
  requestPasswordReset,
  sendMagicLink,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  updatePassword,
} from './actions';
import { AUTH_ERROR_MESSAGES } from './errors';

vi.mock('../supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('../env', () => ({
  getPublicEnv: () => ({
    supabaseUrl: 'https://ref.supabase.co',
    supabaseKey: 'sb_publishable_x',
    webOrigin: 'http://localhost:3000',
    extensionId: null,
  }),
}));

let fake: FakeSupabase;

function use(f: FakeSupabase) {
  fake = f;
  vi.mocked(createClient).mockResolvedValue(
    f.client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
}

const apiError = (code: string, status = 400) => ({
  name: 'AuthApiError',
  code,
  status,
  message: `raw ${code}`,
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  use(createFakeSupabase());
});

describe('signInWithPassword', () => {
  it('signs in and returns a safe destination', async () => {
    fake.onAuth('signInWithPassword', async () => ({
      data: { session: {} },
      error: null,
    }));
    const result = await signInWithPassword({
      email: 'Person@Example.com',
      password: 'pw',
      next: '/app/fit',
    });
    expect(result).toEqual({ ok: true, redirectTo: '/app/fit' });
    expect(fake.authCalls[0]).toEqual([
      'signInWithPassword',
      [{ email: 'person@example.com', password: 'pw' }],
    ]);
  });

  it('never redirects off-site', async () => {
    fake.onAuth('signInWithPassword', async () => ({
      data: { session: {} },
      error: null,
    }));
    const result = await signInWithPassword({
      email: 'a@b.co',
      password: 'pw',
      next: '//evil.example',
    });
    expect(result).toEqual({ ok: true, redirectTo: '/app' });
  });

  it('maps wrong credentials to plain language, without the raw message', async () => {
    fake.onAuth('signInWithPassword', async () => ({
      data: {},
      error: apiError('invalid_credentials'),
    }));
    const result = await signInWithPassword({
      email: 'a@b.co',
      password: 'pw',
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'invalid_credentials',
        message: AUTH_ERROR_MESSAGES.invalid_credentials,
      },
    });
    expect(JSON.stringify(result)).not.toContain('raw');
  });

  it('validates before calling Supabase', async () => {
    const result = await signInWithPassword({ email: 'nope', password: 'pw' });
    expect(!result.ok && result.error.code).toBe('invalid_email');
    expect(fake.authCalls).toEqual([]);
  });

  it('accepts FormData', async () => {
    fake.onAuth('signInWithPassword', async () => ({
      data: { session: {} },
      error: null,
    }));
    const form = new FormData();
    form.set('email', 'a@b.co');
    form.set('password', 'pw');
    expect((await signInWithPassword(form)).ok).toBe(true);
  });

  it('reports an outage when the client throws', async () => {
    vi.mocked(createClient).mockRejectedValueOnce(new Error('boom'));
    const result = await signInWithPassword({
      email: 'a@b.co',
      password: 'pw',
    });
    expect(!result.ok && result.error.code).toBe('unavailable');
  });
});

describe('signUpWithPassword', () => {
  it('asks for confirmation when no session is returned', async () => {
    fake.onAuth('signUp', async () => ({
      data: { user: { id: 'u' }, session: null },
      error: null,
    }));
    const result = await signUpWithPassword({
      email: 'a@b.co',
      password: 'longenough',
      next: '/tune',
    });
    expect(result).toEqual({
      ok: true,
      needsConfirmation: true,
      redirectTo: null,
    });
    const [, [args]] = fake.authCalls[0] as [
      string,
      [{ options: { emailRedirectTo: string } }],
    ];
    expect(args.options.emailRedirectTo).toBe(
      'http://localhost:3000/auth/callback?next=%2Ftune',
    );
  });

  it('continues straight on when the project auto-confirms', async () => {
    fake.onAuth('signUp', async () => ({
      data: { user: { id: 'u' }, session: { access_token: 't' } },
      error: null,
    }));
    const result = await signUpWithPassword({
      email: 'a@b.co',
      password: 'longenough',
    });
    expect(result).toEqual({
      ok: true,
      needsConfirmation: false,
      redirectTo: '/app',
    });
  });

  it('rejects short passwords locally', async () => {
    const result = await signUpWithPassword({
      email: 'a@b.co',
      password: 'short',
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'weak_password', field: 'password' },
    });
  });

  it('maps rate limits', async () => {
    fake.onAuth('signUp', async () => ({
      data: {},
      error: apiError('over_email_send_rate_limit', 429),
    }));
    const result = await signUpWithPassword({
      email: 'a@b.co',
      password: 'longenough',
    });
    expect(!result.ok && result.error.code).toBe('rate_limited');
  });
});

describe('sendMagicLink', () => {
  it('sends a link that finishes on the callback route', async () => {
    const result = await sendMagicLink({ email: 'A@B.co', next: '/connect' });
    expect(result).toEqual({ ok: true, sentTo: 'a@b.co' });
    expect(fake.authCalls[0]).toEqual([
      'signInWithOtp',
      [
        {
          email: 'a@b.co',
          options: {
            shouldCreateUser: true,
            emailRedirectTo:
              'http://localhost:3000/auth/callback?next=%2Fconnect',
          },
        },
      ],
    ]);
  });

  it('maps an unsendable address', async () => {
    fake.onAuth('signInWithOtp', async () => ({
      data: {},
      error: apiError('email_address_not_authorized'),
    }));
    const result = await sendMagicLink({ email: 'a@b.co' });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'email_not_allowed', field: 'email' },
    });
  });
});

describe('requestPasswordReset', () => {
  it('points the reset link at the new-password page', async () => {
    const result = await requestPasswordReset({ email: 'a@b.co' });
    expect(result).toEqual({ ok: true, sentTo: 'a@b.co' });
    expect(fake.authCalls[0]).toEqual([
      'resetPasswordForEmail',
      [
        'a@b.co',
        {
          redirectTo:
            'http://localhost:3000/auth/callback?next=%2Freset-password',
        },
      ],
    ]);
  });

  it('does not reveal whether an account exists', async () => {
    fake.onAuth('resetPasswordForEmail', async () => ({
      data: {},
      error: apiError('user_not_found', 404),
    }));
    expect(await requestPasswordReset({ email: 'a@b.co' })).toEqual({
      ok: true,
      sentTo: 'a@b.co',
    });
  });

  it('still reports rate limits and outages', async () => {
    fake.onAuth('resetPasswordForEmail', async () => ({
      data: {},
      error: apiError('over_email_send_rate_limit', 429),
    }));
    expect((await requestPasswordReset({ email: 'a@b.co' })).ok).toBe(false);
  });
});

describe('updatePassword', () => {
  it('requires a signed-in (recovery) session', async () => {
    use(createFakeSupabase(null));
    const result = await updatePassword({ password: 'longenough' });
    expect(!result.ok && result.error.code).toBe('not_signed_in');
  });

  it('updates the password and returns where to go next', async () => {
    const result = await updatePassword({
      password: 'longenough',
      next: '/app/settings',
    });
    expect(result).toEqual({ ok: true, redirectTo: '/app/settings' });
    expect(fake.authCalls.map(([m]) => m)).toEqual(['getClaims', 'updateUser']);
  });

  it('maps reuse of the current password', async () => {
    fake.onAuth('updateUser', async () => ({
      data: {},
      error: apiError('same_password', 422),
    }));
    const result = await updatePassword({ password: 'longenough' });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'same_password', field: 'password' },
    });
  });
});

describe('signOut', () => {
  it('signs out of this browser by default', async () => {
    expect(await signOut()).toEqual({ ok: true, redirectTo: '/sign-in' });
    expect(fake.authCalls[0]).toEqual(['signOut', [{ scope: 'local' }]]);
  });

  it('can end every session', async () => {
    const form = new FormData();
    form.set('scope', 'global');
    await signOut(form);
    expect(fake.authCalls[0]).toEqual(['signOut', [{ scope: 'global' }]]);
  });

  it('reports a failed global sign-out so the person knows other sessions remain', async () => {
    fake.onAuth('signOut', async () => ({
      error: { name: 'AuthRetryableFetchError', status: 0, message: 'x' },
    }));
    expect((await signOut({ scope: 'global' })).ok).toBe(false);
    expect((await signOut({ scope: 'local' })).ok).toBe(true);
  });
});
