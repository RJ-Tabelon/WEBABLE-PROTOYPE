import { describe, expect, it } from 'vitest';
import { APP_HELP, APP_NAV, FOOTER_COLUMNS, SITE_NAV, isCurrent } from './nav';

describe('isCurrent', () => {
  it('matches a section and its subpages', () => {
    expect(isCurrent('/research', '/research')).toBe(true);
    expect(isCurrent('/research/methods', '/research')).toBe(true);
    expect(isCurrent('/researchers', '/research')).toBe(false);
  });

  it('matches /app and / exactly, and never hash links', () => {
    expect(isCurrent('/app', '/app')).toBe(true);
    expect(isCurrent('/app/changes', '/app')).toBe(false);
    expect(isCurrent('/app/changes/', '/app/changes')).toBe(true);
    expect(isCurrent('/', '/#how')).toBe(false);
    expect(isCurrent(null, '/help')).toBe(false);
  });
});

describe('navigation content', () => {
  it('keeps the required site, footer and app links', () => {
    expect(SITE_NAV.map((l) => l.label)).toEqual([
      'How it works',
      'Privacy',
      'Research',
      'Help',
    ]);
    const footer = FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => l.label));
    for (const required of [
      'Help',
      'Privacy',
      'What WebAble sends',
      'Accessibility',
      'Research',
    ]) {
      expect(footer).toContain(required);
    }
    expect(APP_NAV.map((l) => l.label)).toEqual([
      'Your fit',
      'Changes',
      'Sites',
      'Privacy',
      'Settings',
    ]);
    expect(APP_HELP.label).toBe('Help');
  });
});
