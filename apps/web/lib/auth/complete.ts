import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '../supabase/client';
import { type AuthErrorCode, mapSupabaseAuthError } from './errors';
import { safeNextPath, signInPath, UPDATE_PASSWORD_PATH } from './routes';

/**
 * Finish an email link in the browser and say where to go next. Shared by the
 * /auth/callback and /auth/confirm pages so either works with either email
 * template:
 *   - PKCE:        ?code=...                      -> exchangeCodeForSession
 *   - token hash:  ?token_hash=...&type=...        -> verifyOtp (works across browsers)
 *   - errors:      ?error=...&error_code=...       -> back to sign-in with a stable code
 * A recovery link always continues to the new-password page.
 */

const OTP_TYPES: readonly EmailOtpType[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
];

function isOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (OTP_TYPES as readonly string[]).includes(value);
}

/** Map an error that Supabase appended to the redirect URL. */
export function linkErrorCode(
  errorCode: string | null,
  error: string | null,
): AuthErrorCode {
  if (
    errorCode === 'otp_expired' ||
    errorCode === 'flow_state_expired' ||
    errorCode === 'flow_state_not_found'
  ) {
    return 'link_expired';
  }
  if (error === 'access_denied') return 'link_expired';
  return 'link_invalid';
}

function toSignIn(code: AuthErrorCode, next: string): string {
  return signInPath(next, { error: code });
}

/** The path to go to once the link in `params` is finished (a sign-in path with an error code if it failed). */
export async function completeAuthLink(
  params: URLSearchParams,
): Promise<string> {
  const next = safeNextPath(params.get('next'));

  if (params.has('error') || params.has('error_code')) {
    return toSignIn(
      linkErrorCode(params.get('error_code'), params.get('error')),
      next,
    );
  }

  const code = params.get('code');
  const tokenHash = params.get('token_hash');
  const type = params.get('type');

  try {
    const supabase = createClient();

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        const mapped = mapSupabaseAuthError(error);
        return toSignIn(
          mapped === 'unavailable' ? 'unavailable' : 'link_expired',
          next,
        );
      }
      // Validated again right before returning: nothing between here and the
      // top of the function may widen `next`.
      return safeNextPath(next);
    }

    if (tokenHash && isOtpType(type)) {
      const { error } = await supabase.auth.verifyOtp({
        type,
        token_hash: tokenHash,
      });
      if (error) {
        const mapped = mapSupabaseAuthError(error);
        return toSignIn(
          mapped === 'unavailable' ? 'unavailable' : 'link_expired',
          next,
        );
      }
      return type === 'recovery' ? UPDATE_PASSWORD_PATH : safeNextPath(next);
    }
  } catch {
    return toSignIn('unavailable', next);
  }

  return toSignIn('link_invalid', next);
}
