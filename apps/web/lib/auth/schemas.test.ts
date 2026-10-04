import { describe, expect, it } from 'vitest';

import {
  formToObject,
  parseInput,
  signInSchema,
  signOutSchema,
  signUpSchema,
} from './schemas';

const KEYS = ['email', 'password', 'next'] as const;

describe('parseInput', () => {
  it('normalizes the email from an object', () => {
    const result = parseInput(
      signInSchema,
      { email: '  Person@Example.COM ', password: 'x' },
      KEYS,
    );
    expect(result).toEqual({
      ok: true,
      data: { email: 'person@example.com', password: 'x' },
    });
  });

  it('reads FormData string fields only', () => {
    const form = new FormData();
    form.set('email', 'person@example.com');
    form.set('password', 'longenough');
    form.set('next', '/tune');
    form.set('extra', 'ignored');
    form.set('file', new Blob(['x']));
    expect(formToObject(form, [...KEYS, 'file'])).toEqual({
      email: 'person@example.com',
      password: 'longenough',
      next: '/tune',
    });
    expect(parseInput(signUpSchema, form, KEYS)).toMatchObject({
      ok: true,
      data: { next: '/tune' },
    });
  });

  it.each([
    [{ email: 'not-an-email', password: 'x' }, 'invalid_email', 'email'],
    [{ password: 'x' }, 'invalid_email', 'email'],
    [{ email: 'a@b.co', password: '' }, 'password_required', 'password'],
    [{ email: 'a@b.co' }, 'password_required', 'password'],
  ])('sign-in %j -> %s', (input, code, field) => {
    const result = parseInput(signInSchema, input, KEYS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(code);
      expect(result.error.field).toBe(field);
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });

  it('requires 10 characters and at most 72 bytes for new passwords', () => {
    const short = parseInput(
      signUpSchema,
      { email: 'a@b.co', password: '123456789' },
      KEYS,
    );
    expect(!short.ok && short.error.code).toBe('weak_password');
    const long = parseInput(
      signUpSchema,
      { email: 'a@b.co', password: 'é'.repeat(37) },
      KEYS,
    );
    expect(!long.ok && long.error.code).toBe('weak_password');
    expect(
      parseInput(
        signUpSchema,
        { email: 'a@b.co', password: '1234567890' },
        KEYS,
      ).ok,
    ).toBe(true);
  });

  it('defaults sign-out to this browser only', () => {
    expect(parseInput(signOutSchema, {}, ['scope'])).toEqual({
      ok: true,
      data: { scope: 'local' },
    });
    expect(
      parseInput(signOutSchema, { scope: 'everywhere' }, ['scope']).ok,
    ).toBe(false);
  });

  it('tolerates a missing input', () => {
    expect(parseInput(signInSchema, undefined, KEYS).ok).toBe(false);
  });
});
