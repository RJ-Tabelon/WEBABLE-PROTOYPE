import { describe, expect, it } from 'vitest';

import { typedTokens, typedTokensOf, urlTokens } from './privacy';

describe('typed tokens', () => {
  it('splits like the wire tokenizer and also keeps whole letter runs', () => {
    const out = new Set<string>();
    typedTokensOf('McDonald pizza, 2 large!', out);
    expect([...out]).toEqual(
      expect.arrayContaining(['mc', 'donald', 'mcdonald', 'pizza', 'large']),
    );
    expect(out.has('2')).toBe(false);
  });

  it('collects URL query values and the hash (search terms live there)', () => {
    const out = new Set<string>();
    urlTokens(
      'https://mail.example.com/mail/u/0/?q=quillon+vesperine&utm_source=x#search/zebulon+marsh',
      out,
    );
    expect([...out].sort()).toEqual([
      'marsh',
      'quillon',
      'vesperine',
      'zebulon',
    ]);
    const params = new Set<string>();
    urlTokens('https://example.com/#t=marmalade', params);
    expect([...params]).toEqual(['marmalade']);
    const place = new Set<string>();
    urlTokens('https://example.com/a#inbox', place);
    urlTokens('not a url', place);
    expect(place.size).toBe(0);
  });

  it('reads text fields and editors, never password fields', () => {
    document.body.innerHTML = `
      <input type="search" value="quartzite">
      <textarea>marmalade notes</textarea>
      <input type="password" value="hunter">
      <input type="hidden" value="secretvalue">
      <div contenteditable="true"><p>draft about <b>zebulon</b></p></div>`;
    const tokens = typedTokens([document], 'https://example.com/');
    expect(tokens).toEqual(
      expect.arrayContaining([
        'quartzite',
        'marmalade',
        'notes',
        'draft',
        'zebulon',
      ]),
    );
    expect(tokens).not.toContain('hunter');
    expect(tokens).not.toContain('secretvalue');
  });

  it('is bounded', () => {
    const out = new Set<string>();
    typedTokensOf(
      Array.from(
        { length: 2000 },
        (_, i) =>
          `w${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + (Math.floor(i / 26) % 26))}x`,
      ).join(' '),
      out,
    );
    expect(out.size).toBeLessThanOrEqual(300);
  });
});
