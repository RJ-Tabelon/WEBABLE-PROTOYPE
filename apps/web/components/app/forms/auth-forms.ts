import {
  AUTH_ERROR_MESSAGES,
  type AuthActionError,
  authError,
} from '../../../lib/auth/errors';
import { PASSWORD_MAX_BYTES, PASSWORD_MIN } from '../../../lib/auth/schemas';

/**
 * Client-side checks that mirror the server schemas (lib/auth/schemas.ts), so
 * people see the same plain message next to the field before a round trip.
 * The server validates again; these never replace it. Pure.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FieldErrors = Partial<Record<'email' | 'password', string>>;

export function checkEmail(value: string): string | null {
  const email = value.trim();
  if (!email || email.length > 254 || !EMAIL.test(email))
    return AUTH_ERROR_MESSAGES.invalid_email;
  return null;
}

export function checkExistingPassword(value: string): string | null {
  return value.length === 0 ? AUTH_ERROR_MESSAGES.password_required : null;
}

export function checkNewPassword(value: string): string | null {
  if (value.length === 0) return AUTH_ERROR_MESSAGES.password_required;
  if ([...value].length < PASSWORD_MIN)
    return AUTH_ERROR_MESSAGES.weak_password;
  if (new TextEncoder().encode(value).length > PASSWORD_MAX_BYTES)
    return AUTH_ERROR_MESSAGES.weak_password;
  return null;
}

/** Split a server error into a field message or a form-level message. */
export function placeError(error: AuthActionError): {
  fields: FieldErrors;
  form: string | null;
} {
  if (error.field)
    return { fields: { [error.field]: error.message }, form: null };
  return { fields: {}, form: error.message };
}

/**
 * The address a link was just sent to, kept for the "Check your email" page in
 * this tab only. It never goes into a URL.
 */
const SENT_TO_KEY = 'wa-sent-to';

export function rememberSentTo(email: string): void {
  try {
    window.sessionStorage.setItem(SENT_TO_KEY, email);
  } catch {
    // Storage blocked: the page falls back to "your email address".
  }
}

export function readSentTo(): string | null {
  try {
    return window.sessionStorage.getItem(SENT_TO_KEY);
  } catch {
    return null;
  }
}

export type CheckEmailKind = 'sign-in' | 'sign-up' | 'reset';

export function isCheckEmailKind(value: unknown): value is CheckEmailKind {
  return value === 'sign-in' || value === 'sign-up' || value === 'reset';
}

/**
 * An auth path that carries `next` along, unless `next` is the default
 * destination (then the URL stays short). `next` must already be safe
 * (safeNextPath).
 */
export function withNext(path: string, next: string | undefined): string {
  if (!next || next === '/app') return path;
  const joiner = path.includes('?') ? '&' : '?';
  return `${path}${joiner}next=${encodeURIComponent(next)}`;
}

/** First value of a search param. */
export function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Call a server action from an event handler. A dropped connection rejects the
 * promise; people see the same plain "couldn't reach" message instead.
 */
export async function callAuthAction<R>(
  run: () => Promise<R>,
): Promise<R | { ok: false; error: AuthActionError }> {
  try {
    return await run();
  } catch {
    return { ok: false, error: authError('unavailable') };
  }
}
