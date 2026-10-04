import type { AuthActionError } from './errors';

/**
 * Every auth server action resolves to one of these; none throws for expected
 * failures and none redirects on its own, so the page decides where focus and
 * navigation go next.
 */
export type AuthActionResult<T extends object = object> =
  ({ ok: true } & T) | { ok: false; error: AuthActionError };

export type SignInResult = AuthActionResult<{ redirectTo: string }>;
export type SignUpResult = AuthActionResult<
  | { needsConfirmation: true; redirectTo: null }
  | { needsConfirmation: false; redirectTo: string }
>;
/** The address the link went to, normalized (trimmed, lower-case). */
export type EmailSentResult = AuthActionResult<{ sentTo: string }>;
export type UpdatePasswordResult = AuthActionResult<{ redirectTo: string }>;
export type SignOutResult = AuthActionResult<{ redirectTo: string }>;
