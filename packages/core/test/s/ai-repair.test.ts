// Round 3 package S: what real gpt-6-sol layouts needed. The model listed Alderra's whole main region (upsells
// inside) as the primary section, and the candidate choice put a layout 0.05 below the best first.
import { describe, expect, test } from 'vitest';
import type { FitSection, FitSpec, LayoutCandidate } from '../../src/types';
import { chooseCandidate } from '../../src/jev/judge';
import { indexOutline, placementMap, repairSpec, specCoverage } from '../../src/layout/spec';
import { ALDERRA_LIVE, ALDERRA_LIVE_ROLES } from '../c/live-fixtures';

const sec = (p: Partial<FitSection> & Pick<FitSection, 'label' | 'role' | 'nodes'>): FitSection => ({
  heading_ref: null, layout: 'as_is', emphasis: 'normal', state: 'open', why: 'main_task', show_first: 0, ...p,
});

/** The "focus" layout gpt-6-sol returned for Alderra (rosa fit), as measured on 2026-10-24. */
const MODEL_FOCUS: FitSpec = {
  page_type: 'form',
  task: 'other',
  strip: ['n8', 'n9', 'n13', 'n14', 'n266'],
  sections: [
    sec({ label: 'What you need', role: 'primary', layout: 'form_steps', emphasis: 'lead', nodes: ['n48'] }),
    sec({ label: 'Help', role: 'help', nodes: ['n316'], why: 'protected' }),
    sec({ label: 'Cookies', role: 'consent', nodes: ['n306'], why: 'protected' }),
    sec({ label: 'Offers', role: 'ads', layout: 'row_list', state: 'end_drawer', emphasis: 'quiet', nodes: ['n1', 'n31'], why: 'advertising' }),
    sec({ label: 'Navigation', role: 'orient', layout: 'chip_bar', nodes: ['n5', 'n15', 'n41'], why: 'navigation' }),
    sec({ label: 'Related items', role: 'related', layout: 'card_grid', state: 'end_drawer', nodes: ['n114', 'n159', 'n196'], why: 'promotion' }),
    sec({ label: 'Offers', role: 'promo', layout: 'card_grid', state: 'end_drawer', nodes: ['n205', 'n215'], why: 'promotion' }),
    sec({ label: 'Site links', role: 'navigation', layout: 'link_grid', nodes: ['n222'], why: 'navigation' }),
  ],
  primary_action: 'n94',
  form_steps: [
    { label: 'What you need', fields: ['n56', 'n60', 'n64'] },
    { label: 'Delivery and returns', fields: ['n76', 'n80', 'n82'] },
  ],
  density: 'airy',
};

function placeOf(spec: FitSpec, id: string): FitSection | 'strip' | null {
  const ix = indexOutline(ALDERRA_LIVE);
  const m = placementMap(spec);
  for (const x of [id, ...ix.ancestors(id)]) {
    const w = m.get(x);
    if (w === 'strip') return 'strip';
    if (typeof w === 'number') return spec.sections[w] ?? null;
  }
  return null;
}

describe('ads inside a region the model placed whole', () => {
  const { spec, repairs } = repairSpec(MODEL_FOCUS, ALDERRA_LIVE, { roles: ALDERRA_LIVE_ROLES });

  test('the flu-shot upsell and the membership banner leave the main task for a folded ads section', () => {
    for (const id of ['n68', 'n84']) {
      const at = placeOf(spec, id);
      expect(at && at !== 'strip' ? [at.role, at.state] : at, id).toEqual(['ads', 'end_drawer']);
    }
    expect(repairs.some((r) => r.startsWith('ads_lifted:') && r.includes('n68') && r.includes('n84'))).toBe(true);
  });

  test('the region dissolves into its task parts, which stay open in the primary section', () => {
    const prim = spec.sections.find((s) => s.role === 'primary')!;
    expect(prim.state).toBe('open');
    expect(prim.nodes).not.toContain('n48');
    for (const id of ['n49', 'n51', 'n74', 'n89', 'n94', 'n95']) expect(placeOf(spec, id), id).toBe(prim);
    expect(spec.primary_action).toBe('n94');
  });

  test('nothing is lost and nothing renders twice', () => {
    expect(specCoverage(spec, ALDERRA_LIVE).missing).toEqual([]);
    const listed = [...spec.strip, ...spec.sections.flatMap((s) => s.nodes)];
    expect(new Set(listed).size).toBe(listed.length);
    // (Strip controls may sit inside a listed header region: the strip wins and the region skips them.)
    const ix = indexOutline(ALDERRA_LIVE);
    const inSections = spec.sections.flatMap((s) => s.nodes);
    for (const id of inSections) expect(inSections.filter((x) => ix.isAncestor(x, id)), `${id} under a listed ancestor`).toEqual([]);
  });

  test('help, consent and protected fields never move with the ads', () => {
    expect(placeOf(spec, 'n96')).not.toBeNull();
    const help = placeOf(spec, 'n96');
    expect(help === 'strip' || help?.state === 'open').toBe(true);
    for (const id of ['n56', 'n76', 'n306']) {
      const at = placeOf(spec, id);
      expect(at !== null && at !== 'strip' && at.state === 'open', id).toBe(true);
    }
  });

  test('a layout that already folds its ads is left alone', () => {
    const again = repairSpec(spec, ALDERRA_LIVE, { roles: ALDERRA_LIVE_ROLES });
    expect(again.repairs.filter((r) => r.startsWith('ads_lifted:'))).toEqual([]);
  });

  test('an open non-task section that is only an ad folds as a whole', () => {
    const s: FitSpec = {
      ...MODEL_FOCUS,
      sections: [...MODEL_FOCUS.sections.filter((x) => !x.nodes.includes('n31')), sec({ label: 'Overview', role: 'supporting', nodes: ['n31'] })],
    };
    const out = repairSpec(s, ALDERRA_LIVE, { roles: ALDERRA_LIVE_ROLES }).spec;
    const at = placeOf(out, 'n31');
    expect(at && at !== 'strip' ? at.state : at).not.toBe('open');
  });
});

describe('chooseCandidate ties', () => {
  const base: LayoutCandidate = { name: 'heuristic', spec: MODEL_FOCUS, repairs: [] };
  const c = (name: LayoutCandidate['name'], composite: number, fitScore: number): LayoutCandidate => ({
    ...base, name, pEasier: 0.6, pHides: 1 - composite / 0.6, composite, fitScore,
  });

  test('never picks a layout more than 0.03 below the best (measured on Alderra)', () => {
    // heuristic .41, local focus .38 (fit 1.09), overview .43 (fit .90), deep .39 (fit 1.19), guided .40 (fit 1.05)
    const r = chooseCandidate([c('heuristic', 0.41, 0.98), c('focus', 0.38, 1.09), c('overview', 0.43, 0.9), c('deep', 0.39, 1.19), c('guided', 0.4, 1.05)]);
    expect(['heuristic', 'overview', 'guided']).toContain(r.chosen);
    expect(r.chosen).toBe('guided'); // tied with the best (0.43 - 0.40 <= 0.03), highest fit Score among the tied
  });

  test('a clear winner wins whatever the fit Scores', () => {
    expect(chooseCandidate([c('focus', 0.5, 0.2), c('overview', 0.42, 3.9)]).chosen).toBe('focus');
  });
});
