import { describe, expect, it } from 'vitest';

import { themeDecision } from './theme-sync';

describe('themeDecision: the most recent explicit choice wins', () => {
  it('does nothing when both already agree', () => {
    expect(
      themeDecision({
        local: 'dark',
        localAt: 5,
        account: 'dark',
        accountAt: 9,
      }),
    ).toBe('none');
  });

  it('saves a newer choice made in this browser to the account', () => {
    expect(
      themeDecision({
        local: 'dark',
        localAt: 10,
        account: 'system',
        accountAt: 5,
      }),
    ).toBe('save-local');
    // The account never had an explicit choice.
    expect(
      themeDecision({
        local: 'light',
        localAt: 10,
        account: 'system',
        accountAt: null,
      }),
    ).toBe('save-local');
  });

  it('applies a newer choice from the account (another browser)', () => {
    expect(
      themeDecision({
        local: 'dark',
        localAt: 5,
        account: 'light',
        accountAt: 10,
      }),
    ).toBe('apply-account');
  });

  it('lets the account win over a theme this browser never chose', () => {
    expect(
      themeDecision({
        local: 'system',
        localAt: null,
        account: 'dark',
        accountAt: null,
      }),
    ).toBe('apply-account');
  });
});
