'use server';

import { getPublicEnv } from '../env';
import { createClient } from '../supabase/server';
import {
  type AuthActionError,
  type AuthErrorCode,
  authError,
  mapSupabaseAuthError,
} from './errors';
import {
  AFTER_SIGN_IN_PATH,
  authCallbackUrl,
  SIGN_IN_PATH,
  safeNextPath,
  UPDATE_PASSWORD_PATH,
} from './routes';
import {
  magicLinkSchema,
  parseInput,
  passwordResetSchema,
  signInSchema,
  signOutSchema,
  signUpSchema,
  updatePasswordSchema,
  type MagicLinkInput,
  type PasswordResetInput,
  type SignInInput,
  type SignOutInput,
  type SignUpInput,
  type UpdatePasswordInput,
} from './schemas';
import type {
  EmailSentResult,
  SignInResult,
  SignOutResult,
  SignUpResult,
  UpdatePasswordResult,
} from './types';

/*
 * Auth server actions. Each accepts a plain object or the FormData a form posts,
 * validates it, and returns { ok: true, ... } or { ok: false, error: { code, message } }.
 * Messages are plain language; raw Supabase errors never leave this module.
 * Next.js checks the Origin of every Server Action request.
 *
 * With useActionState:
 *   const [state, act] = useActionState((_prev: SignInResult | null, form: FormData) => signInWithPassword(form), null);
 */

async function guard<T>(run: () => Promise<T>, onThrow: () => T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    // Never surface internals; keep a server-side trace without personal data.
    console.error(
      '[auth] action failed',
      error instanceof Error ? error.name : typeof error,
    );
    return onThrow();
  }
}

/** The failure branch shared by every AuthActionResult. */
function failed(code: AuthErrorCode): { ok: false; error: AuthActionError } {
  return { ok: false, error: authError(code) };
}

export async function signInWithPassword(
  input: SignInInput | FormData,
): Promise<SignInResult> {
  const parsed = parseInput(signInSchema, input, ['email', 'password', 'next']);
  if (!parsed.ok) return parsed;
  const { email, password, next } = parsed.data;

  return guard<SignInResult>(
    async () => {
      const supabase = await createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) return failed(mapSupabaseAuthError(error));
      return { ok: true, redirectTo: safeNextPath(next) };
    },
    () => failed('unavailable'),
  );
}

export async function signUpWithPassword(
  input: SignUpInput | FormData,
): Promise<SignUpResult> {
  const parsed = parseInput(signUpSchema, input, ['email', 'password', 'next']);
  if (!parsed.ok) return parsed;
  const { email, password, next } = parsed.data;
  const destination = safeNextPath(next);

  return guard<SignUpResult>(
    async () => {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: authCallbackUrl(
            getPublicEnv().webOrigin,
            destination,
          ),
        },
      });
      if (error) return failed(mapSupabaseAuthError(error));
      // With confirmations on there is no session yet. For an address that already has an
      // account, Supabase deliberately answers the same way, so nothing reveals who has one.
      if (!data.session)
        return { ok: true, needsConfirmation: true, redirectTo: null };
      return { ok: true, needsConfirmation: false, redirectTo: destination };
    },
    () => failed('unavailable'),
  );
}

export async function sendMagicLink(
  input: MagicLinkInput | FormData,
): Promise<EmailSentResult> {
  const parsed = parseInput(magicLinkSchema, input, ['email', 'next']);
  if (!parsed.ok) return parsed;
  const { email, next } = parsed.data;

  return guard<EmailSentResult>(
    async () => {
      const supabase = await createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: authCallbackUrl(
            getPublicEnv().webOrigin,
            safeNextPath(next),
          ),
        },
      });
      if (error) return failed(mapSupabaseAuthError(error));
      return { ok: true, sentTo: email };
    },
    () => failed('unavailable'),
  );
}

export async function requestPasswordReset(
  input: PasswordResetInput | FormData,
): Promise<EmailSentResult> {
  const parsed = parseInput(passwordResetSchema, input, ['email']);
  if (!parsed.ok) return parsed;
  const { email } = parsed.data;

  return guard<EmailSentResult>(
    async () => {
      const supabase = await createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: authCallbackUrl(
          getPublicEnv().webOrigin,
          UPDATE_PASSWORD_PATH,
        ),
      });
      if (error) {
        const code = mapSupabaseAuthError(error);
        // Only failures the person can act on are reported. Anything else answers like
        // success, so this form never reveals whether an address has an account.
        if (
          code === 'rate_limited' ||
          code === 'unavailable' ||
          code === 'invalid_email'
        ) {
          return failed(code);
        }
      }
      return { ok: true, sentTo: email };
    },
    () => failed('unavailable'),
  );
}

export async function updatePassword(
  input: UpdatePasswordInput | FormData,
): Promise<UpdatePasswordResult> {
  const parsed = parseInput(updatePasswordSchema, input, ['password', 'next']);
  if (!parsed.ok) return parsed;
  const { password, next } = parsed.data;

  return guard<UpdatePasswordResult>(
    async () => {
      const supabase = await createClient();
      const { data: claims } = await supabase.auth.getClaims();
      if (!claims?.claims.sub) return failed('not_signed_in');
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return failed(mapSupabaseAuthError(error));
      return { ok: true, redirectTo: safeNextPath(next, AFTER_SIGN_IN_PATH) };
    },
    () => failed('unavailable'),
  );
}

/**
 * Sign out of this browser. `scope: 'global'` also ends every other session,
 * including the extension's (offer it as "Sign out everywhere").
 */
export async function signOut(
  input: SignOutInput | FormData = {},
): Promise<SignOutResult> {
  const parsed = parseInput(signOutSchema, input, ['scope']);
  if (!parsed.ok) return parsed;

  return guard<SignOutResult>(
    async () => {
      const supabase = await createClient();
      const { error } = await supabase.auth.signOut({
        scope: parsed.data.scope,
      });
      // supabase-js clears the local session even when the server call fails,
      // so the person is signed out of this browser either way.
      if (error && parsed.data.scope === 'global')
        return failed(mapSupabaseAuthError(error));
      return { ok: true, redirectTo: SIGN_IN_PATH };
    },
    () => failed('unavailable'),
  );
}
