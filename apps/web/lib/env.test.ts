import { describe, expect, it } from 'vitest';

import { parsePublicEnv, PublicEnvError } from './env';

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co/',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_0123456789abcdef',
  NEXT_PUBLIC_WEB_ORIGIN: 'http://localhost:3000/',
  NEXT_PUBLIC_EXTENSION_ID: 'bbnblnlbgcccbbbbihngngbecbobedie',
};

describe('parsePublicEnv', () => {
  it('normalizes origins', () => {
    expect(parsePublicEnv(valid)).toEqual({
      supabaseUrl: 'https://abcdefghijklmnop.supabase.co',
      supabaseKey: 'sb_publishable_0123456789abcdef',
      webOrigin: 'http://localhost:3000',
      extensionId: 'bbnblnlbgcccbbbbihngngbecbobedie',
      contactEmail: null,
    });
  });

  it('requires the contact address in production only', () => {
    expect(() => parsePublicEnv(valid, 'production')).toThrow(
      /NEXT_PUBLIC_CONTACT_EMAIL/,
    );
    expect(parsePublicEnv(valid, 'development').contactEmail).toBeNull();
    expect(
      parsePublicEnv(
        { ...valid, NEXT_PUBLIC_CONTACT_EMAIL: 'help@webable.example' },
        'production',
      ).contactEmail,
    ).toBe('help@webable.example');
  });

  it('treats the extension id as optional', () => {
    expect(
      parsePublicEnv({ ...valid, NEXT_PUBLIC_EXTENSION_ID: undefined })
        .extensionId,
    ).toBeNull();
    expect(
      parsePublicEnv({ ...valid, NEXT_PUBLIC_EXTENSION_ID: '' }).extensionId,
    ).toBeNull();
  });

  it('names invalid variables without echoing their values', () => {
    try {
      parsePublicEnv({
        ...valid,
        NEXT_PUBLIC_SUPABASE_URL: 'ftp://nope',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'short',
        NEXT_PUBLIC_EXTENSION_ID: 'not-an-id',
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PublicEnvError);
      const e = error as PublicEnvError;
      expect(e.variables.sort()).toEqual([
        'NEXT_PUBLIC_EXTENSION_ID',
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
        'NEXT_PUBLIC_SUPABASE_URL',
      ]);
      expect(e.message).not.toContain('short');
      expect(e.message).not.toContain('ftp://nope');
    }
  });

  it('requires the Supabase URL, key and web origin', () => {
    expect(() => parsePublicEnv({})).toThrow(PublicEnvError);
  });
});
