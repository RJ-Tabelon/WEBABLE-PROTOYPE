import { describe, expect, it } from 'vitest';
import { ISSUES_URL, resolveContact } from './contact';

describe('resolveContact', () => {
  it('uses a configured email address', () => {
    expect(resolveContact(' help@webable.example ')).toEqual({
      kind: 'email',
      href: 'mailto:help@webable.example',
      label: 'help@webable.example',
    });
  });

  it('falls back to the issue tracker when nothing valid is configured', () => {
    for (const value of [
      undefined,
      '',
      '   ',
      'not an email',
      'a@b',
      'x@y.z"><script>',
    ]) {
      const contact = resolveContact(value);
      expect(contact.kind).toBe('issues');
      expect(contact.href).toBe(ISSUES_URL);
    }
  });
});
