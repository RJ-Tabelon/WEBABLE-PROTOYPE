import { describe, expect, it } from 'vitest';
import { ContactConfigError, ISSUES_URL, resolveContact } from './contact';

const INVALID = [
  undefined,
  '',
  '   ',
  'not an email',
  'a@b',
  'x@y.z"><script>',
] as const;

describe('resolveContact', () => {
  it('uses a configured email address as a mailto link', () => {
    for (const env of ['production', 'development', 'test']) {
      expect(resolveContact(' help@webable.example ', env)).toEqual({
        kind: 'email',
        href: 'mailto:help@webable.example',
        label: 'help@webable.example',
      });
    }
  });

  it('falls back to the issue tracker outside production only', () => {
    for (const env of ['development', 'test', undefined]) {
      for (const value of INVALID) {
        const contact = resolveContact(value, env);
        expect(contact.kind).toBe('issues');
        expect(contact.href).toBe(ISSUES_URL);
      }
    }
  });

  it('refuses to ship production without a valid address', () => {
    for (const value of INVALID) {
      expect(() => resolveContact(value, 'production')).toThrow(
        ContactConfigError,
      );
    }
  });
});
