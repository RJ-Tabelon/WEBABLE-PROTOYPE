'use server';

import { createClient as createPlainClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { getPublicEnv } from '../../../lib/env';
import {
  AUTH_ERROR_MESSAGES,
  type AuthErrorCode,
  authError,
  mapSupabaseAuthError,
} from '../../../lib/auth/errors';
import { authCallbackUrl } from '../../../lib/auth/routes';
import { updatePasswordSchema } from '../../../lib/auth/schemas';
import type { AuthActionResult } from '../../../lib/auth/types';
import { createClient } from '../../../lib/supabase/server';
import {
  type PasswordClaims,
  hasPasswordFromClaims,
  WRONG_CURRENT_PASSWORD,
} from './password';

export type ChangeEmailResult = AuthActionResult<{ sentTo: string }>;

const changeEmailSchema = z.object({
  email: z
    .string({ error: 'invalid_email' })
    .trim()
    .toLowerCase()
    .max(254, { error: 'invalid_email' })
    .pipe(z.email({ error: 'invalid_email' })),
});

/**
 * Start an email change. Supabase sends a confirmation link (to both addresses
 * when secure email change is on); the change takes effect when the link is
 * opened, and the link finishes on /auth/callback, then returns to Settings.
 */
export async function changeEmailAction(input: {
  email: string;
}): Promise<ChangeEmailResult> {
  const parsed = changeEmailSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: authError('invalid_email') };
  const { email } = parsed.data;

  try {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const current = claims?.claims;
    if (!current?.sub) return { ok: false, error: authError('not_signed_in') };
    if (
      typeof current.email === 'string' &&
      current.email.toLowerCase() === email
    ) {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: 'That is already your email.',
          field: 'email',
        },
      };
    }
    const { error } = await supabase.auth.updateUser(
      { email },
      {
        emailRedirectTo: authCallbackUrl(
          getPublicEnv().webOrigin,
          '/app/settings',
        ),
      },
    );
    if (error)
      return { ok: false, error: authError(mapSupabaseAuthError(error)) };
    return { ok: true, sentTo: email };
  } catch (error) {
    console.error(
      '[settings] changeEmail failed',
      error instanceof Error ? error.name : typeof error,
    );
    return { ok: false, error: authError('unavailable') };
  }
}

/* ------------------------------------------------------------------------ */
/* Password                                                                   */
/* ------------------------------------------------------------------------ */

export type PasswordFormField = 'current' | 'password';

export interface PasswordActionError {
  code: AuthErrorCode | 'wrong_current';
  message: string;
  field?: PasswordFormField;
}

export type ChangePasswordResult =
  { ok: true } | { ok: false; error: PasswordActionError };

const changePasswordSchema = z.object({
  /** Omitted only when the account has no password yet ("Add a password"). */
  current: z.string().min(1).max(1024).optional(),
  password: z.string(),
});

function passwordFailure(code: AuthErrorCode): ChangePasswordResult {
  const field: PasswordFormField | undefined =
    code === 'weak_password' ||
    code === 'same_password' ||
    code === 'password_required'
      ? 'password'
      : undefined;
  return {
    ok: false,
    error: field
      ? { code, message: AUTH_ERROR_MESSAGES[code], field }
      : { code, message: AUTH_ERROR_MESSAGES[code] },
  };
}

/**
 * Change the password, or add one to an account that only used email links.
 *
 * With a password already set, the current one is checked first: a separate
 * client with no cookies signs in with it (signInWithPassword), and only that
 * fresh session sets the new password (updateUser). A wrong current password
 * therefore never reaches updateUser. The check's own session is signed out
 * afterwards; this browser's session is untouched.
 */
export async function changePasswordAction(input: {
  current?: string;
  password: string;
}): Promise<ChangePasswordResult> {
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) return passwordFailure('invalid_input');
  const next = updatePasswordSchema.safeParse({
    password: parsed.data.password,
  });
  if (!next.success) {
    const code = next.error.issues[0]?.message;
    return passwordFailure(
      code === 'password_required' ? 'password_required' : 'weak_password',
    );
  }
  const password = next.data.password;
  const { current } = parsed.data;

  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const claims = (data?.claims ?? null) as PasswordClaims | null;
    if (!claims || typeof claims.sub !== 'string')
      return passwordFailure('not_signed_in');

    if (current === undefined) {
      // "Add a password": only for accounts with none. One that has a password
      // must prove it knows the current one.
      if (hasPasswordFromClaims(claims)) {
        return {
          ok: false,
          error: {
            code: 'password_required',
            message: AUTH_ERROR_MESSAGES.password_required,
            field: 'current',
          },
        };
      }
      const { error } = await supabase.auth.updateUser({
        password,
        data: { password_set: true },
      });
      if (error) return passwordFailure(mapSupabaseAuthError(error));
      return { ok: true };
    }

    if (typeof claims.email !== 'string' || claims.email.length === 0)
      return passwordFailure('not_signed_in');

    const { supabaseUrl, supabaseKey } = getPublicEnv();
    const check = createPlainClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const signedIn = await check.auth.signInWithPassword({
      email: claims.email,
      password: current,
    });
    if (signedIn.error || !signedIn.data.session) {
      const code = mapSupabaseAuthError(signedIn.error);
      if (code === 'invalid_credentials' || code === 'unknown')
        return {
          ok: false,
          error: {
            code: 'wrong_current',
            message: WRONG_CURRENT_PASSWORD,
            field: 'current',
          },
        };
      return passwordFailure(code);
    }
    // Same account, or nothing changes.
    if (signedIn.data.user?.id !== claims.sub) {
      await check.auth.signOut({ scope: 'local' }).catch(() => undefined);
      return passwordFailure('not_signed_in');
    }
    try {
      const { error } = await check.auth.updateUser({
        password,
        data: { password_set: true },
      });
      if (error) return passwordFailure(mapSupabaseAuthError(error));
      return { ok: true };
    } finally {
      await check.auth.signOut({ scope: 'local' }).catch(() => undefined);
    }
  } catch (error) {
    console.error(
      '[settings] changePassword failed',
      error instanceof Error ? error.name : typeof error,
    );
    return passwordFailure('unavailable');
  }
}
