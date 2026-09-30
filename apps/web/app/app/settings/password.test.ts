import { describe, expect, it } from 'vitest';

import { hasPasswordFromClaims } from './password';

describe('hasPasswordFromClaims', () => {
  it('is true for a session signed in with a password', () => {
    expect(
      hasPasswordFromClaims({
        amr: [{ method: 'password', timestamp: 1 }],
      }),
    ).toBe(true);
  });

  it('is true once WebAble set a password from Settings', () => {
    expect(
      hasPasswordFromClaims({
        amr: [{ method: 'otp', timestamp: 1 }],
        user_metadata: { password_set: true },
      }),
    ).toBe(true);
  });

  it('is false for an account that only used email links', () => {
    expect(
      hasPasswordFromClaims({
        amr: [{ method: 'magiclink', timestamp: 1 }],
        user_metadata: {},
      }),
    ).toBe(false);
    expect(hasPasswordFromClaims({})).toBe(false);
  });
});
