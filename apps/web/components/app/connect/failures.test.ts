import { describe, expect, it } from 'vitest';

import { copyProblems } from '../../../lib/auth/copy-lint';
import {
  DATA_ERROR_CODES,
  DATA_ERROR_MESSAGES,
} from '../../../lib/data/result';
import { linkFailure } from './failures';

describe('linkFailure', () => {
  it('gives the undeployed or unreachable link service its own calm message', () => {
    const failure = linkFailure({
      code: 'unavailable',
      message: DATA_ERROR_MESSAGES.unavailable,
    });
    expect(failure.title).toBe('Connecting isn’t available right now');
    expect(failure.message).toContain('Nothing changed');
    expect(failure.message).not.toBe(DATA_ERROR_MESSAGES.unavailable);
    expect(failure.signIn).toBeUndefined();
  });

  it('sends an ended session back to sign in', () => {
    const failure = linkFailure({
      code: 'not_signed_in',
      message: DATA_ERROR_MESSAGES.not_signed_in,
    });
    expect(failure.signIn).toBe(true);
  });

  it('falls back to the data layer message for anything else', () => {
    const failure = linkFailure({
      code: 'unknown',
      message: DATA_ERROR_MESSAGES.unknown,
    });
    expect(failure).toMatchObject({
      message: DATA_ERROR_MESSAGES.unknown,
      code: 'unknown',
    });
  });

  it('follows the copy rules for every code', () => {
    for (const code of DATA_ERROR_CODES) {
      const { title, message } = linkFailure({
        code,
        message: DATA_ERROR_MESSAGES[code],
      });
      // Titles are short phrases without a full stop.
      expect(copyProblems(`${title}.`), title).toEqual([]);
      expect(copyProblems(message), message).toEqual([]);
    }
  });
});
