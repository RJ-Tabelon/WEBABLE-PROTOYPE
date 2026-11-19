import type { DataError } from '../../../lib/data/result';

export interface ConnectFailure {
  title: string;
  message: string;
  /** A stable code for the "Details" disclosure. Never the only explanation. */
  code?: string;
  /** Show a sign-in link instead of Try again. */
  signIn?: boolean;
}

/**
 * What to say when the server can't mint the single-use sign-in link. Each case
 * says what happened, what is safe, and what to do (design-final.md 13.1 rule 11).
 */
export function linkFailure(
  error: Pick<DataError, 'code' | 'message'>,
): ConnectFailure {
  switch (error.code) {
    case 'unavailable':
      // Also what the page gets before the extension-link function is deployed.
      return {
        title: 'Connecting isn’t available right now',
        message:
          'WebAble’s server can’t give this browser its own sign-in at the moment. Nothing changed, and your fit is saved to your account. Try again later.',
        code: 'extension_link_unavailable',
      };
    case 'rate_limited':
      return {
        title: 'Too many tries',
        message: 'Wait a minute, then connect again. Nothing changed.',
        code: 'rate_limited',
      };
    case 'not_signed_in':
      return {
        title: 'Your session ended',
        message: 'Sign in again, then connect this browser. Nothing changed.',
        code: 'not_signed_in',
        signIn: true,
      };
    default:
      return {
        title: 'Couldn’t connect this browser',
        message: error.message,
        code: error.code,
      };
  }
}
