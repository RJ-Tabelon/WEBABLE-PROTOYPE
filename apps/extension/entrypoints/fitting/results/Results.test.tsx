// @vitest-environment happy-dom
// The results page renders problems first, real sites, and word-only settings; nothing a person sees says "px".
import { DEMO_FITS, defaultFit } from '@webable/core';
import type { FitProfile } from '@webable/core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { RunEvidence } from '../logic/evidence';
import { Results } from './Results';

function mount(fit: FitProfile, evidence: RunEvidence | null, onChange = vi.fn()): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  act(() => {
    render(
      <Results fit={fit} measured evidence={evidence} onChange={onChange} onRetake={() => {}} onDone={() => {}} />,
      root,
    );
  });
  return root;
}

const visibleText = (root: HTMLElement): string => {
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.visually-hidden').forEach((n) => n.remove());
  return copy.textContent ?? '';
};

describe('Results', () => {
  it('leads with problems in their own numbers, then the fix', () => {
    const ev: RunEvidence = {
      reading: { slowdown: 1.42, tooSmallCount: 0 },
      faint: null,
      pointing: { smallMisses: 3, smallTotal: 8, slips: 2, presses: 50 },
      sites: [],
      busySlowdown: { ratio: 2.04, busyName: 'CNN', quietName: 'Wikipedia' },
      gotInWay: [],
    };
    const root = mount(DEMO_FITS.rosa, ev);
    expect(root.querySelector('h1')?.textContent).toBe('Here’s what makes the web harder for you.');
    const cards = [...root.querySelectorAll('.rs-card')];
    expect(cards.length).toBe(4);
    expect(cards[0]?.querySelector('.rs-problem')?.textContent).toBe('Busy pages slow you down.');
    expect(cards[0]?.querySelector('.rs-evidence')?.textContent).toBe(
      'Finding something on CNN took you twice as long as on Wikipedia.',
    );
    expect(cards[0]?.querySelector('.rs-fix')?.textContent).toBe('WebAble fixes this: Busy pages become a clean, simple page.');
    expect(root.querySelector('.rs-chart-title')?.textContent).toBe('What gets in your way');
  });

  it('says the web mostly works when nothing is strong', () => {
    const root = mount(defaultFit(), null);
    expect(root.querySelector('h1')?.textContent).toBe('The web mostly works for you.');
    expect(root.querySelector('.rs-deck')?.textContent).toBe('A few things still get in the way. WebAble takes care of them.');
    expect(root.querySelectorAll('.rs-card').length).toBe(1);
  });

  it('links to four real websites in new tabs and never says px', () => {
    const root = mount(DEMO_FITS.reader, null);
    const links = [...root.querySelectorAll<HTMLAnchorElement>('a.rs-site')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://www.cnn.com',
      'https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/',
      'https://floridagators.com/sports/football/opponent-history/university-of-kentucky/32',
      'https://www.irs.gov/refunds',
    ]);
    for (const a of links) expect(a.getAttribute('target')).toBe('_blank');
    const text = visibleText(root);
    expect(text).not.toMatch(/\bpx\b|pixel/i);
    expect(text).toContain('Standard → Extra large');
    expect(text).toContain('Standard → Larger');
  });

  it('steps text size in words and saves at once', () => {
    const onChange = vi.fn();
    const root = mount(defaultFit(), null, onChange);
    const up = root.querySelector<HTMLButtonElement>('button[aria-label="Larger text"]');
    act(() => up?.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0]?.[0] as FitProfile).text.override).toBe(18);
    expect(visibleText(root)).toContain('Standard → Larger');
  });
});
