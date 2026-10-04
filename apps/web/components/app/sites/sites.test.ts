import { describe, expect, it } from 'vitest';

import {
  appliesAgain,
  applyLocally,
  filterSites,
  hasRules,
  inverse,
  opLabels,
  type SiteView,
  sitePreferences,
  sortSites,
} from './sites';

function site(domain: string, extra: Partial<SiteView> = {}): SiteView {
  return {
    domain,
    paused: false,
    blocked: [],
    pinned: [],
    lastChanges: 0,
    lastVisit: 0,
    ...extra,
  };
}

const sites = [
  site('b.example.com', { lastVisit: 10 }),
  site('a.example.com', { lastVisit: 10, blocked: ['line_spacing'] }),
  site('c.example.org', { lastVisit: 20, paused: true }),
];

describe('sortSites', () => {
  it('puts the most recent visit first, then sorts by name', () => {
    expect(sortSites(sites).map((s) => s.domain)).toEqual([
      'c.example.org',
      'a.example.com',
      'b.example.com',
    ]);
  });
});

describe('applyLocally', () => {
  it('pauses and resumes one site only', () => {
    const next = applyLocally(sites, 'b.example.com', {
      kind: 'pause',
      paused: true,
    });
    expect(next.find((s) => s.domain === 'b.example.com')?.paused).toBe(true);
    expect(next.find((s) => s.domain === 'a.example.com')?.paused).toBe(false);
  });

  it('turns a change off and back on without duplicates', () => {
    const withPause = applyLocally(sites, 'a.example.com', {
      kind: 'pause',
      paused: true,
    });
    const off = applyLocally(withPause, 'a.example.com', {
      kind: 'block',
      op: 'line_spacing',
      blocked: true,
    });
    expect(off.find((s) => s.domain === 'a.example.com')?.blocked).toEqual([
      'line_spacing',
    ]);
    const on = applyLocally(off, 'a.example.com', {
      kind: 'block',
      op: 'line_spacing',
      blocked: false,
    });
    expect(on.find((s) => s.domain === 'a.example.com')?.blocked).toEqual([]);
  });

  it('drops a site once it keeps nothing of its own', () => {
    const next = applyLocally(sites, 'a.example.com', {
      kind: 'block',
      op: 'line_spacing',
      blocked: false,
    });
    expect(next.map((s) => s.domain)).not.toContain('a.example.com');
  });

  it('turns an always-on change off, and resets a site', () => {
    const pinned = [site('p.example.com', { pinned: ['target_size'] })];
    expect(
      applyLocally(pinned, 'p.example.com', {
        kind: 'pin',
        op: 'target_size',
        on: false,
      }),
    ).toEqual([]);
    expect(
      applyLocally(sites, 'c.example.org', { kind: 'reset' }).map(
        (s) => s.domain,
      ),
    ).not.toContain('c.example.org');
  });

  it('forgets a site', () => {
    expect(
      applyLocally(sites, 'c.example.org', { kind: 'forget' }),
    ).toHaveLength(2);
  });

  it('never mutates the list it was given', () => {
    const copy = structuredClone(sites);
    applyLocally(sites, 'a.example.com', { kind: 'pause', paused: true });
    expect(sites).toEqual(copy);
  });
});

describe('sitePreferences', () => {
  it('lists each thing a site keeps with the action that undoes it', () => {
    const prefs = sitePreferences(
      site('x.example.com', {
        paused: true,
        pinned: ['target_size'],
        blocked: ['line_spacing'],
        levels: { text_floor: 3 },
      }),
    );
    expect(prefs.map((p) => [p.label, p.action])).toEqual([
      ['Paused', 'Resume'],
      ['Always on: Click targets', 'Turn off here'],
      [expect.stringMatching(/^Text size \d+\spx$/), 'Reset'],
      ['Turned off: Line spacing', 'Turn back on'],
    ]);
    expect(prefs[0]?.change).toEqual({ kind: 'pause', paused: false });
    expect(prefs[1]?.change).toEqual({
      kind: 'pin',
      op: 'target_size',
      on: false,
    });
    // A size isn't one change in the bridge: Reset site clears it with the rest.
    expect(prefs[2]?.change).toBeNull();
    expect(prefs[3]?.change).toEqual({
      kind: 'block',
      op: 'line_spacing',
      blocked: false,
    });
  });

  it('resets the site when a size is all it keeps', () => {
    const [only] = sitePreferences(
      site('y.example.com', { levels: { text_floor: 3 } }),
    );
    expect(only?.change).toEqual({ kind: 'reset' });
  });

  it('knows which sites keep something', () => {
    expect(hasRules(site('z.example.com'))).toBe(false);
    expect(hasRules(site('z.example.com', { levels: { text_floor: 1 } }))).toBe(
      true,
    );
  });
});

describe('inverse and appliesAgain', () => {
  it('undoes pause, block and pin; reset and forget have no undo', () => {
    expect(inverse({ kind: 'pause', paused: true })).toEqual({
      kind: 'pause',
      paused: false,
    });
    expect(inverse({ kind: 'pin', op: 'target_size', on: false })).toEqual({
      kind: 'pin',
      op: 'target_size',
      on: true,
    });
    expect(inverse({ kind: 'reset' })).toBeNull();
    expect(inverse({ kind: 'forget' })).toBeNull();
  });

  it('shows the applied glyph only when WebAble changes the page again', () => {
    expect(appliesAgain({ kind: 'pause', paused: false })).toBe(true);
    expect(appliesAgain({ kind: 'pause', paused: true })).toBe(false);
    expect(
      appliesAgain({ kind: 'block', op: 'line_spacing', blocked: false }),
    ).toBe(true);
    expect(
      appliesAgain({ kind: 'block', op: 'line_spacing', blocked: true }),
    ).toBe(false);
    expect(appliesAgain({ kind: 'reset' })).toBe(false);
  });
});

describe('filterSites and opLabels', () => {
  it('matches domains case-insensitively', () => {
    expect(filterSites(sites, '  EXAMPLE.ORG ').map((s) => s.domain)).toEqual([
      'c.example.org',
    ]);
    expect(filterSites(sites, '')).toHaveLength(3);
  });

  it('labels known changes in catalog order and drops unknown ids', () => {
    expect(opLabels(['target_size', 'mystery', 'text_floor'])).toEqual([
      { op: 'text_floor', label: 'Text size' },
      { op: 'target_size', label: 'Click targets' },
    ]);
  });
});
