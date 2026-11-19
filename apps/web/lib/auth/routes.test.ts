import { describe, expect, it } from 'vitest';

import {
  authCallbackUrl,
  isProtectedPath,
  safeNextPath,
  signInPath,
} from './routes';

describe('safeNextPath', () => {
  it.each([
    ['/app', '/app'],
    ['/app/fit?tab=history#v3', '/app/fit?tab=history#v3'],
    ['/connect', '/connect'],
    ['  /tune  ', '/tune'],
    ['/reset-password', '/reset-password'],
    ['/%2F%2Fevil.example', '/%2F%2Fevil.example'],
  ])('keeps same-origin path %j', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    42,
    '',
    'app',
    'https://evil.example/app',
    '//evil.example',
    '///evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    '/app\\..\\x',
    '/.//x',
    '/..//x',
    '/a/..//x',
    '/%2e//x',
    '/%2E%2E//x',
    '/.//evil.example/phish',
    '/app/../tune',
    '/app/.',
    '/app/%2e%2e/tune',
    '/\\evil',
    '//evil',
    'javascript:alert(1)',
    '/app\n/next',
    '/app\u0000',
    '/auth/callback?next=/app',
    '/auth',
    '/sign-in',
    '/sign-in?next=/app',
    `/${'a'.repeat(3000)}`,
  ])('falls back for %j', (input) => {
    expect(safeNextPath(input)).toBe('/app');
    expect(safeNextPath(input, '/tune')).toBe('/tune');
  });
});

describe('isProtectedPath', () => {
  it('protects /app/** and /connect', () => {
    expect(isProtectedPath('/app')).toBe(true);
    expect(isProtectedPath('/app/fit')).toBe(true);
    expect(isProtectedPath('/connect')).toBe(true);
    expect(isProtectedPath('/connect/done')).toBe(true);
  });

  it('leaves public paths alone', () => {
    for (const path of [
      '/',
      '/apple',
      '/application',
      '/tune',
      '/sign-in',
      '/privacy',
      '/connection',
    ]) {
      expect(isProtectedPath(path)).toBe(false);
    }
  });
});

describe('signInPath', () => {
  it('carries a safe next path and extra params', () => {
    expect(signInPath('/app/fit?x=1')).toBe(
      '/sign-in?next=%2Fapp%2Ffit%3Fx%3D1',
    );
    expect(signInPath('/connect', { error: 'link_expired' })).toBe(
      '/sign-in?next=%2Fconnect&error=link_expired',
    );
  });

  it('omits the default destination and unsafe values', () => {
    expect(signInPath('/app')).toBe('/sign-in');
    expect(signInPath('https://evil.example')).toBe('/sign-in');
    expect(signInPath(null, { error: 'link_invalid' })).toBe(
      '/sign-in?error=link_invalid',
    );
  });
});

describe('authCallbackUrl', () => {
  it('builds an absolute callback URL with a sanitized next', () => {
    expect(authCallbackUrl('http://localhost:3000', '/tune')).toBe(
      'http://localhost:3000/auth/callback?next=%2Ftune',
    );
    expect(authCallbackUrl('https://webable.example', '//evil.example')).toBe(
      'https://webable.example/auth/callback?next=%2Fapp',
    );
  });
});
