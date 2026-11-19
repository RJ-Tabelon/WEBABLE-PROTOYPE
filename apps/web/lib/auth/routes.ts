/**
 * Auth-related paths and the only way a user-supplied `next` value becomes a
 * redirect target. Pure functions: safe to import from the proxy, route
 * handlers, server actions and client components.
 */

export const SIGN_IN_PATH = '/sign-in';
/** Where people land after signing in when no `next` was given. */
export const AFTER_SIGN_IN_PATH = '/app';
/** Page where a person chooses a new password after a reset link. */
export const UPDATE_PASSWORD_PATH = '/reset-password';
export const AUTH_CALLBACK_PATH = '/auth/callback';
export const AUTH_CONFIRM_PATH = '/auth/confirm';
export const SIGN_OUT_PATH = '/auth/sign-out';

/** Paths that need a signed-in person. The proxy redirects everyone else to sign in. */
export const PROTECTED_PREFIXES = ['/app', '/connect'] as const;

/** `next` values that would bounce back into auth plumbing fall back instead. */
const NON_DESTINATIONS = ['/auth', SIGN_IN_PATH];

const MAX_NEXT_LENGTH = 2048;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const PROBE_ORIGIN = 'http://next.invalid';

/** A "." or ".." segment, literal or percent-encoded, anywhere in the path part. */
function hasDotSegment(value: string): boolean {
  const path = value.split(/[?#]/, 1)[0] ?? '';
  return path
    .split('/')
    .some(
      (segment) => segment === '.' || segment === '..' || /%2e/i.test(segment),
    );
}

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => underPrefix(pathname, prefix));
}

/**
 * Accept only same-origin relative paths ("/app/fit?tab=1"). Absolute URLs,
 * protocol-relative "//host", backslash tricks, dot segments ("/./", "/../",
 * "%2e"), control characters, and auth plumbing paths all return `fallback`.
 * The result is normalized by the URL parser and checked again after, since
 * normalizing "/.//host" yields "//host".
 */
export function safeNextPath(
  input: unknown,
  fallback: string = AFTER_SIGN_IN_PATH,
): string {
  if (typeof input !== 'string') return fallback;
  const value = input.trim();
  if (!value || value.length > MAX_NEXT_LENGTH) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  if (value.includes('\\') || CONTROL_CHARS.test(value)) return fallback;
  if (hasDotSegment(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN) return fallback;
  if (NON_DESTINATIONS.some((prefix) => underPrefix(url.pathname, prefix)))
    return fallback;
  const out = `${url.pathname}${url.search}${url.hash}`;
  if (out.startsWith('//') || out.startsWith('/\\')) return fallback;
  return out;
}

/** "/sign-in?next=%2Fapp%2Ffit" plus optional extra params (e.g. an error code). */
export function signInPath(
  next?: string | null,
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams();
  const target = next ? safeNextPath(next, '') : '';
  if (target && target !== AFTER_SIGN_IN_PATH) params.set('next', target);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  const query = params.toString();
  return query ? `${SIGN_IN_PATH}?${query}` : SIGN_IN_PATH;
}

/** Absolute URL for an email link that finishes on the callback route, then goes to `next`. */
export function authCallbackUrl(webOrigin: string, next: string): string {
  const url = new URL(AUTH_CALLBACK_PATH, webOrigin);
  url.searchParams.set('next', safeNextPath(next));
  return url.toString();
}
