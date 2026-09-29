/**
 * Stable auth error codes and the plain-language messages people see.
 * Raw Supabase errors never reach the UI: they are mapped here first.
 *
 * Copy rules (design-final.md 13): calm, exact, short; say what happened, what
 * is safe, and what to do; sentence case; no exclamation marks; no blame.
 */

export const AUTH_ERROR_CODES = [
  'invalid_email',
  'password_required',
  'weak_password',
  'invalid_input',
  'invalid_credentials',
  'email_not_confirmed',
  'email_taken',
  'same_password',
  'rate_limited',
  'email_not_allowed',
  'signups_closed',
  'link_expired',
  'link_invalid',
  'not_signed_in',
  'unavailable',
  'unknown',
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export const AUTH_ERROR_MESSAGES: Readonly<Record<AuthErrorCode, string>> =
  Object.freeze({
    invalid_email: 'Enter an email address like name@example.com.',
    password_required: 'Enter your password.',
    weak_password: 'Use a password with at least 8 characters.',
    invalid_input: 'Check the details and try again.',
    invalid_credentials:
      "That email and password don’t match. Try again, or get a sign-in link instead.",
    email_not_confirmed:
      'Confirm your email first. Open the link we sent you, then sign in.',
    email_taken: 'An account already uses this email. Sign in instead.',
    same_password: 'That is your current password. Choose a different one.',
    rate_limited:
      'Too many tries in a short time. Wait a minute, then try again.',
    email_not_allowed:
      "We can't send email to that address. Try a different one.",
    signups_closed: 'New accounts are paused right now. Try again later.',
    link_expired:
      'That link has expired or was already used. Ask for a new one.',
    link_invalid: "That link didn't work. Ask for a new one.",
    not_signed_in: 'Your session ended. Sign in again to continue.',
    unavailable:
      "WebAble couldn't reach the sign-in service. Nothing changed. Try again in a moment.",
    unknown: 'Something went wrong. Nothing changed. Try again.',
  });

/** Which form field an error belongs to, for aria-describedby wiring. */
export type AuthField = 'email' | 'password';

export interface AuthActionError {
  code: AuthErrorCode;
  message: string;
  field?: AuthField;
}

const FIELD_FOR: Partial<Record<AuthErrorCode, AuthField>> = {
  invalid_email: 'email',
  email_taken: 'email',
  email_not_allowed: 'email',
  password_required: 'password',
  weak_password: 'password',
  same_password: 'password',
};

export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return (
    typeof value === 'string' &&
    (AUTH_ERROR_CODES as readonly string[]).includes(value)
  );
}

export function authError(code: AuthErrorCode): AuthActionError {
  const field = FIELD_FOR[code];
  return field
    ? { code, message: AUTH_ERROR_MESSAGES[code], field }
    : { code, message: AUTH_ERROR_MESSAGES[code] };
}

/** Message for an `?error=` code on the sign-in page; null for anything unknown. */
export function authErrorMessage(
  code: string | null | undefined,
): string | null {
  return isAuthErrorCode(code) ? AUTH_ERROR_MESSAGES[code] : null;
}

/** The parts of a Supabase AuthError this mapping reads. */
export interface SupabaseAuthErrorLike {
  name?: string;
  code?: string;
  status?: number;
  message?: string;
}

const BY_SUPABASE_CODE: Readonly<Record<string, AuthErrorCode>> = {
  invalid_credentials: 'invalid_credentials',
  email_not_confirmed: 'email_not_confirmed',
  user_already_exists: 'email_taken',
  email_exists: 'email_taken',
  identity_already_exists: 'email_taken',
  weak_password: 'weak_password',
  same_password: 'same_password',
  over_request_rate_limit: 'rate_limited',
  over_email_send_rate_limit: 'rate_limited',
  email_address_not_authorized: 'email_not_allowed',
  email_address_invalid: 'invalid_email',
  signup_disabled: 'signups_closed',
  email_provider_disabled: 'signups_closed',
  otp_expired: 'link_expired',
  flow_state_expired: 'link_expired',
  flow_state_not_found: 'link_expired',
  bad_code_verifier: 'link_expired',
  otp_disabled: 'link_invalid',
  bad_jwt: 'not_signed_in',
  no_authorization: 'not_signed_in',
  session_not_found: 'not_signed_in',
  session_expired: 'not_signed_in',
  refresh_token_not_found: 'not_signed_in',
  refresh_token_already_used: 'not_signed_in',
  reauthentication_needed: 'not_signed_in',
  user_not_found: 'not_signed_in',
  validation_failed: 'invalid_input',
  request_timeout: 'unavailable',
  hook_timeout: 'unavailable',
  hook_timeout_after_retry: 'unavailable',
};

/** Map a Supabase auth error to a stable code. */
export function mapSupabaseAuthError(
  error: SupabaseAuthErrorLike | null | undefined,
): AuthErrorCode {
  if (!error) return 'unknown';
  if (error.name === 'AuthRetryableFetchError') return 'unavailable';
  const mapped = error.code ? BY_SUPABASE_CODE[error.code] : undefined;
  if (mapped) return mapped;
  const status = error.status ?? 0;
  if (status === 429) return 'rate_limited';
  if (status === 0 || status >= 500) return 'unavailable';
  if (error.name === 'AuthWeakPasswordError') return 'weak_password';
  if (error.name === 'AuthSessionMissingError') return 'not_signed_in';
  return 'unknown';
}
