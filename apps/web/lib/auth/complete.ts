import type { EmailOtpType } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';

import { createClient } from '../supabase/server';
import { type AuthErrorCode, mapSupabaseAuthError } from './errors';
import { safeNextPath, signInPath, UPDATE_PASSWORD_PATH } from './routes';

/**
 * Finish an email link and redirect. Shared by /auth/callback and /auth/confirm so
 * either works with either email template:
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

function redirectTo(request: NextRequest, path: string): NextResponse {
  // Same origin as the request, so the session cookies set here apply to the destination.
  const url = new URL(path, request.nextUrl.origin);
  const response = NextResponse.redirect(url, { status: 303 });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

function toSignIn(
  request: NextRequest,
  code: AuthErrorCode,
  next: string,
): NextResponse {
  return redirectTo(request, signInPath(next, { error: code }));
}

export async function completeAuthRedirect(
  request: NextRequest,
): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get('next'));

  if (params.has('error') || params.has('error_code')) {
    return toSignIn(
      request,
      linkErrorCode(params.get('error_code'), params.get('error')),
      next,
    );
  }

  const code = params.get('code');
  const tokenHash = params.get('token_hash');
  const type = params.get('type');

  try {
    const supabase = await createClient();

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        const mapped = mapSupabaseAuthError(error);
        return toSignIn(
          request,
          mapped === 'unavailable' ? 'unavailable' : 'link_expired',
          next,
        );
      }
      return redirectTo(request, next);
    }

    if (tokenHash && isOtpType(type)) {
      const { error } = await supabase.auth.verifyOtp({
        type,
        token_hash: tokenHash,
      });
      if (error) {
        const mapped = mapSupabaseAuthError(error);
        return toSignIn(
          request,
          mapped === 'unavailable' ? 'unavailable' : 'link_expired',
          next,
        );
      }
      return redirectTo(
        request,
        type === 'recovery' ? UPDATE_PASSWORD_PATH : next,
      );
    }
  } catch {
    return toSignIn(request, 'unavailable', next);
  }

  return toSignIn(request, 'link_invalid', next);
}
