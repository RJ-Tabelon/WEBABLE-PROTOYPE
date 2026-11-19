/**
 * Password state for Settings. Supabase doesn't say whether an account has a
 * password, so the session is read instead: it was signed in with one (the
 * `amr` claim), or WebAble set one from Settings (`user_metadata.password_set`).
 * An account that only uses email links has neither. Pure.
 */

export const WRONG_CURRENT_PASSWORD = 'That’s not your current password.';

export interface PasswordClaims {
  sub?: unknown;
  email?: unknown;
  amr?: unknown;
  user_metadata?: unknown;
}

export function hasPasswordFromClaims(claims: PasswordClaims): boolean {
  const amr = Array.isArray(claims.amr) ? (claims.amr as unknown[]) : [];
  const signedInWithPassword = amr.some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as { method?: unknown }).method === 'password',
  );
  if (signedInWithPassword) return true;
  const meta = claims.user_metadata;
  return (
    typeof meta === 'object' &&
    meta !== null &&
    (meta as { password_set?: unknown }).password_set === true
  );
}
