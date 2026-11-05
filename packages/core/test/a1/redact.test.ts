import { describe, expect, it } from 'vitest';
import { VOCABULARY_SIZE, allowlistWords, inVocabulary, redactText, stillSensitive, uiLabel } from '../../src/redact';

const CASES: Array<[string, string]> = [
  ['Write to jane.doe@example.com today', 'Write to [email] today'],
  ['Reset at https://example.com/reset?token=abc and www.site.org/x', 'Reset at [link] and [link]'],
  ['Call (352) 555-0147 now', 'Call [phone number] now'],
  ['Card 4111 1111 1111 1111 on file', 'Card [card number] on file'],
  ['SSN 123-45-6789', 'SSN [id number]'],
  ['Born 1980-04-12, seen 04/12/2026, due Sep 24 and 3 March 2026', 'Born [date], seen [date], due [date] and [date]'],
  ['Ships to 123 Main Street, Apt 4B', 'Ships to [address]'],
  ['Est. copay $4.00, delivery €5.99', 'Est. copay [amount], delivery [amount]'],
  ['Rx #6214-0387 · Qty 30', '[rx number] · Qty 30'],
  ['Atorvastatin 20 mg tablet', '[medication] [dose] tablet'],
  ['Order 12345678 for store #4127', 'Order [number] for store [number]'],
  ['Dear Dr. Patel, thanks', 'Dear [name], thanks'],
  ['Hi, Caden', 'Hi, [name]'],
  ['Signed in as Maria Lopez', 'Signed in as [name]'],
  ['Please contact Jane Smith about it', 'Please contact [name] about it'],
  ['Password: hunter2', 'Password: [secret]'],
];

describe('redactText', () => {
  it.each(CASES)('redacts %j', (input, want) => {
    expect(redactText(input)).toBe(want);
  });

  it('keeps small numbers, times, percentages and interface words', () => {
    const s = 'Refills can be delayed up to 1 business day. Orders placed after 6 PM ship at 4:30 PM. 25% off, 2 refills left.';
    expect(redactText(s)).toBe(s);
  });

  it('keeps ordinary capitalised words at sentence starts and in Title Case labels', () => {
    expect(redactText('Get Your Flu Shot Today')).toBe('Get Your Flu Shot Today');
    expect(redactText('Generic substitution may occur unless your prescriber indicates otherwise.')).toBe(
      'Generic substitution may occur unless your prescriber indicates otherwise.',
    );
    expect(redactText('Confirm refill')).toBe('Confirm refill');
  });

  it('is idempotent', () => {
    for (const [input] of CASES) {
      const once = redactText(input);
      expect(redactText(once)).toBe(once);
    }
  });

  it('leaves nothing that stillSensitive flags, and stillSensitive flags the originals', () => {
    const sensitive = [
      'jane.doe@example.com', 'https://example.com/reset?token=abc', '(352) 555-0147', '4111 1111 1111 1111',
      '123-45-6789', 'Rx #6214-0387', '123 Main Street', 'Order 12345678', 'Password: hunter2',
      'token placeholder_0123456789_abcdefghij',
    ];
    for (const s of sensitive) {
      expect(stillSensitive(s), s).toBe(true);
      expect(stillSensitive(redactText(s)), redactText(s)).toBe(false);
    }
    expect(stillSensitive('Prices shown are estimates and do not include applicable taxes.')).toBe(false);
  });

  it('handles empty and odd input', () => {
    expect(redactText('')).toBe('');
    expect(redactText(undefined as unknown as string)).toBe('');
    expect(redactText('a​b')).toBe('ab');
  });
});

describe('uiLabel', () => {
  it('redacts, collapses whitespace and caps the word count', () => {
    expect(uiLabel('  Call   your\n pharmacist at (352) 555-0147 ')).toBe('Call your pharmacist at [phone number]');
    const long = Array.from({ length: 30 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}`).join(' ');
    expect(uiLabel(long).split(' ')).toHaveLength(15);
    expect(uiLabel(long, 4).split(' ')).toHaveLength(4);
    expect(uiLabel(long, 4).endsWith('…')).toBe(true);
  });
});

describe('allowlistWords', () => {
  it('keeps interface words and turns every run of other words into one dot', () => {
    expect(allowlistWords('Confirm refill')).toBe('Confirm refill');
    expect(allowlistWords('Add to cart')).toBe('Add to cart');
    expect(allowlistWords('Atorvastatin 20 mg tablet')).toBe('· [dose] ·');
    expect(allowlistWords('Blood pressure monitor')).toBe('·');
  });

  it('turns digits into shapes and never lets a digit through', () => {
    const out = allowlistWords('Rx #6214-0387 · Qty 30 · Est. copay $4.00 · Ready 4:30 PM · Sep 24 · (352) 555-0147 · 4.5 out of 5');
    expect(out).not.toMatch(/\d/);
    expect(out).toContain('[price]');
    expect(out).toContain('[time]');
    expect(out).toContain('[date]');
    expect(out).toContain('[phone]');
    expect(out).toContain('[rating]');
  });

  it('drops names and addresses', () => {
    const out = allowlistWords('Signed in as Maria Lopez, 123 Main Street');
    expect(out).not.toMatch(/Maria|Lopez|Main/);
  });
});

describe('vocabulary', () => {
  it('has at least 800 words', () => {
    expect(VOCABULARY_SIZE).toBeGreaterThanOrEqual(800);
  });
  it('excludes special-category words', () => {
    for (const w of ['blood', 'pressure', 'diabetes', 'insulin', 'flu', 'cancer', 'depression', 'pregnancy', 'medication',
      'drug', 'religion', 'church', 'gay', 'ethnicity', 'politics', 'democrat', 'disability', 'disabled']) {
      expect(inVocabulary(w), w).toBe(false);
    }
  });
  it('accepts simple inflections', () => {
    expect(inVocabulary('Prescriptions')).toBe(true);
    expect(inVocabulary('refilled')).toBe(true);
    expect(inVocabulary('shopping')).toBe(true);
  });
});
