'use server';

import { z } from 'zod';

import { getPublicEnv } from '../../../lib/env';
import { authError, mapSupabaseAuthError } from '../../../lib/auth/errors';
import { authCallbackUrl } from '../../../lib/auth/routes';
import type { AuthActionResult } from '../../../lib/auth/types';
import { createClient } from '../../../lib/supabase/server';

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
