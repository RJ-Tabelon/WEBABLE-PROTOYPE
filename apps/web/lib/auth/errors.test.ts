import { describe, expect, it } from 'vitest';

import { DATA_ERROR_MESSAGES } from '../data/result';
import { copyProblems } from './copy-lint';
import {
  AUTH_ERROR_CODES,
  AUTH_ERROR_MESSAGES,
  authError,
  authErrorMessage,
  isAuthErrorCode,
  mapSupabaseAuthError,
} from './errors';

describe('messages follow the copy rules', () => {
  it.each(Object.entries(AUTH_ERROR_MESSAGES))('auth %s', (_code, message) => {
    expect(copyProblems(message)).toEqual([]);
  });

  it.each(Object.entries(DATA_ERROR_MESSAGES))('data %s', (_code, message) => {
    expect(copyProblems(message)).toEqual([]);
  });

  it('flags broken copy', () => {
    expect(copyProblems('Oops! Your test results are below normal')).toEqual(
      expect.arrayContaining([
        'uses an exclamation mark',
        'does not end with a full stop',
        expect.stringContaining('banned word'),
      ]),
    );
  });

  it('has a message for every code', () => {
    for (const code of AUTH_ERROR_CODES)
      expect(AUTH_ERROR_MESSAGES[code]).toBeTruthy();
  });
});

describe('mapSupabaseAuthError', () => {
  it.each([
    [{ code: 'invalid_credentials', status: 400 }, 'invalid_credentials'],
    [{ code: 'email_not_confirmed', status: 400 }, 'email_not_confirmed'],
    [{ code: 'user_already_exists', status: 422 }, 'email_taken'],
    [
      { code: 'weak_password', status: 422, name: 'AuthWeakPasswordError' },
      'weak_password',
    ],
    [{ code: 'same_password', status: 422 }, 'same_password'],
    [{ code: 'over_email_send_rate_limit', status: 429 }, 'rate_limited'],
    [
      { code: 'email_address_not_authorized', status: 400 },
      'email_not_allowed',
    ],
    [{ code: 'otp_expired', status: 403 }, 'link_expired'],
    [{ code: 'bad_code_verifier', status: 400 }, 'link_expired'],
    [{ code: 'session_not_found', status: 403 }, 'not_signed_in'],
    [{ code: 'signup_disabled', status: 422 }, 'signups_closed'],
    [{ name: 'AuthRetryableFetchError', status: 0 }, 'unavailable'],
    [{ name: 'AuthApiError', status: 502 }, 'unavailable'],
    [{ name: 'AuthApiError', status: 429 }, 'rate_limited'],
    [{ name: 'AuthSessionMissingError', status: 400 }, 'not_signed_in'],
    [{ name: 'AuthApiError', code: 'something_new', status: 400 }, 'unknown'],
  ])('%j -> %s', (error, expected) => {
    expect(mapSupabaseAuthError(error)).toBe(expected);
  });

  it('treats a missing error as unknown', () => {
    expect(mapSupabaseAuthError(null)).toBe('unknown');
  });
});

describe('authError and authErrorMessage', () => {
  it('attaches the field an error belongs to', () => {
    expect(authError('invalid_email')).toEqual({
      code: 'invalid_email',
      message: AUTH_ERROR_MESSAGES.invalid_email,
      field: 'email',
    });
    expect(authError('weak_password').field).toBe('password');
    expect(authError('rate_limited')).not.toHaveProperty('field');
  });

  it('only resolves known codes from the URL', () => {
    expect(authErrorMessage('link_expired')).toBe(
      AUTH_ERROR_MESSAGES.link_expired,
    );
    expect(authErrorMessage('<script>')).toBeNull();
    expect(authErrorMessage(null)).toBeNull();
    expect(isAuthErrorCode('toString')).toBe(false);
  });
});
