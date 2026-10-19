import { describe, expect, it } from 'vitest';

import { cutLabel, nameKey, normalizeSpace, textPatterns } from './text';

describe('textPatterns', () => {
  it.each([
    ['$49.99', ['price']],
    ['€12', ['price']],
    ['12,50 €', ['price']],
    ['CAD 19', ['price']],
    ['12:34', ['duration']],
    ['1:02:45', ['duration']],
    ['1.2M views', ['count']],
    ['45K views', ['count']],
    ['12K watching', ['count']],
    ['(1,234)', ['count']],
    ['1,234 ratings', ['count']],
    ['4.5 out of 5 stars', ['rating']],
    ['★★★★☆', ['rating']],
    ['4.5/5', ['rating']],
    ['3 days ago', ['date']],
    ['Streamed 2 hours ago', ['date']],
    ['an hour ago', ['date']],
    ['2d ago', ['date']],
    ['5h ago', ['date']],
    ['Oct 12', ['date']],
    ['12 Oct', ['date']],
    ['9:41 AM', ['date']],
    ['Yesterday', ['date']],
    ['Today, 9:41', ['date']],
    ['Tuesday', ['date']],
    ['10/12/2026', ['date']],
    ['20% off', ['percent']],
    ['1,234', ['num']],
    ['4.5', ['num']],
  ])('%s -> %j', (text, pat) => {
    expect(textPatterns(text)).toEqual(pat);
  });

  it('has no pattern for plain words, labels with date words, or long text', () => {
    expect(textPatterns('Sign in')).toEqual([]);
    expect(textPatterns("Today's Deals")).toEqual([]);
    expect(textPatterns('Read now')).toEqual([]);
    expect(textPatterns(`${'a'.repeat(90)} 3 days ago`)).toEqual([]);
  });

  it('keeps SKEL_PATTERNS order when several apply', () => {
    expect(textPatterns('$5 · 20% off')).toEqual(['price', 'percent']);
    expect(textPatterns('1.2K reviews · 4.5 stars')).toEqual([
      'count',
      'rating',
    ]);
  });
});

describe('labels', () => {
  it('normalises whitespace, including no-break and zero-width spaces', () => {
    expect(normalizeSpace('  a\n\tb c​d ')).toBe('a b c d');
  });

  it('cuts at 80 characters with an ellipsis, never splitting a surrogate pair', () => {
    const long = 'word '.repeat(40);
    const cut = cutLabel(long);
    expect(cut.length).toBeLessThanOrEqual(80);
    expect(cut.endsWith('…')).toBe(true);
    const emoji = `${'x'.repeat(78)}😀😀`;
    const c2 = cutLabel(emoji);
    expect(c2.length).toBeLessThanOrEqual(80);
    expect(/[\ud800-\udbff]…$/.test(c2)).toBe(false);
    expect(cutLabel('short')).toBe('short');
  });

  it('name keys fold digits and case', () => {
    expect(nameKey('Inbox (3)')).toBe(nameKey('inbox  (12)'));
    expect(nameKey('Archive')).not.toBe(nameKey('Delete'));
  });
});
