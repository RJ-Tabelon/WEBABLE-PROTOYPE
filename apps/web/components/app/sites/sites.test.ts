import type { LocalSite } from '@webable/core';
import { describe, expect, it } from 'vitest';

import { applyLocally, filterSites, opLabels, sortSites } from './sites';

function site(domain: string, extra: Partial<LocalSite> = {}): LocalSite {
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
    const off = applyLocally(sites, 'a.example.com', {
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
