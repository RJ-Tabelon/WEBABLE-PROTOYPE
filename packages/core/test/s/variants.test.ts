// Package S: the three local layout variants Jev judges when no generative model is available.
import { describe, expect, test } from 'vitest';
import type { FitSpec, FitSummaryForModel, LayoutCandidate, PageOutline, Role } from '../../src/types';
import { indexOutline, placementMap, repairSpec, specCoverage } from '../../src/layout/spec';
import { heuristicSpec } from '../../src/layout/heuristic';
import { LOCAL_VARIANTS, candidateSource, localVariants, sourceTag } from '../../src/layout/variants';
import { DEMO_FITS, summarizeFitForModel } from '../../src/fit/derive';
import { ALDERRA, PRODUCT, randomOutline } from '../a2/fixtures';

const ROSA: FitSummaryForModel = summarizeFitForModel(DEMO_FITS.rosa);
const TYPICAL: FitSummaryForModel = summarizeFitForModel(DEMO_FITS.typical);
const READER: FitSummaryForModel = summarizeFitForModel(DEMO_FITS.reader);

const byName = (cs: LayoutCandidate[], name: LayoutCandidate['name']): LayoutCandidate => {
  const c = cs.find((x) => x.name === name);
  if (!c) throw new Error(`no ${name} variant`);
  return c;
};

const openContent = (s: FitSpec): number =>
  s.sections.filter((x) => x.state === 'open' && !['orient', 'alert', 'consent', 'help'].includes(x.role)).length;

/** Where an id renders: itself if listed, else its nearest listed ancestor. */
function renderPlace(spec: FitSpec, outline: PageOutline, id: string): 'strip' | number | null {
  const ix = indexOutline(outline);
  const m = placementMap(spec);
  for (const x of [id, ...ix.ancestors(id)]) {
    const w = m.get(x);
    if (w !== undefined) return w;
  }
  return null;
}

function sound(spec: FitSpec, outline: PageOutline): void {
  const ix = indexOutline(outline);
  const listed = [...spec.strip, ...spec.sections.flatMap((s) => s.nodes)];
  for (const id of listed) expect(ix.nodes.has(id), `unknown id ${id}`).toBe(true);
  expect(new Set(listed).size, 'duplicate ids').toBe(listed.length);
  expect(specCoverage(spec, outline).missing).toEqual([]);
  const prim = spec.sections.filter((s) => s.role === 'primary');
  expect(prim.length).toBeLessThanOrEqual(1);
  if (spec.primary_action) {
    expect(prim).toHaveLength(1);
    expect(prim[0]?.state).toBe('open');
    expect(renderPlace(spec, outline, spec.primary_action)).toBe(spec.sections.indexOf(prim[0]!));
  }
  expect(spec.sections.filter((s) => s.emphasis === 'lead').length).toBeLessThanOrEqual(1);
  for (const st of spec.form_steps) expect(st.fields.length).toBeLessThanOrEqual(8);
}

describe('localVariants', () => {
  const alderra = localVariants(ALDERRA, {}, ROSA);

  test('three stances, in order, each tagged as local', () => {
    expect(alderra.map((c) => c.name)).toEqual([...LOCAL_VARIANTS]);
    for (const c of alderra) {
      expect(c.repairs[0]).toMatch(/^source: local \(/);
      expect(candidateSource(c)).toBe('local');
    }
  });

  test('deterministic for the same input', () => {
    expect(localVariants(ALDERRA, {}, ROSA)).toEqual(alderra);
    expect(localVariants(PRODUCT, {}, TYPICAL)).toEqual(localVariants(PRODUCT, {}, TYPICAL));
  });

  test('every variant keeps the repair guarantees (all placed, help/consent open, one primary)', () => {
    for (const [o, fit] of [[ALDERRA, ROSA], [ALDERRA, TYPICAL], [PRODUCT, TYPICAL], [PRODUCT, READER]] as const) {
      for (const c of localVariants(o, {}, fit)) sound(c.spec, o);
    }
    const cs = localVariants(ALDERRA, {}, ROSA);
    for (const c of cs) {
      // The consent banner (n65) and the pharmacist link (n50) render in open places.
      for (const id of ['n65', 'n50']) {
        const at = renderPlace(c.spec, ALDERRA, id);
        expect(at === 'strip' || (typeof at === 'number' && c.spec.sections[at]?.state === 'open'), `${c.name} ${id}`).toBe(true);
      }
      expect(c.spec.primary_action).toBe('n48');
    }
  });

  test('genuinely different from each other and from the heuristic', () => {
    const h = JSON.stringify(repairSpec(heuristicSpec(ALDERRA, {}, ROSA), ALDERRA).spec);
    const keys = alderra.map((c) => JSON.stringify(c.spec));
    expect(new Set([h, ...keys]).size).toBe(4);
    const focus = byName(alderra, 'focus').spec;
    const guided = byName(alderra, 'guided').spec;
    const overview = byName(alderra, 'overview').spec;
    // Form stepping: focus and guided step the form; overview keeps it on one page unless the fit says one thing
    // at a time works best (Rosa), because the judge cannot see steps.
    expect(focus.form_steps.length).toBeGreaterThanOrEqual(2);
    expect(guided.form_steps.length).toBeGreaterThanOrEqual(focus.form_steps.length);
    expect(overview.form_steps.length).toBeGreaterThanOrEqual(2);
    const onePage = byName(localVariants(ALDERRA, {}, READER), 'overview').spec;
    expect(onePage.form_steps).toEqual([]);
    expect(onePage.sections.some((s) => s.layout === 'form_steps')).toBe(false);
    // guided always takes one group of fields per step; focus packs them (one step of 6 fits the reader's limit of 8).
    expect(byName(localVariants(ALDERRA, {}, READER), 'guided').spec.form_steps.length).toBe(2);
    expect(byName(localVariants(ALDERRA, {}, READER), 'focus').spec.form_steps).toEqual([]);
    // Collapse policy: overview keeps the most open; focus folds the small print, guided shows it.
    expect(openContent(overview)).toBeGreaterThanOrEqual(openContent(focus));
    const smallPrint = (s: FitSpec) => s.sections.find((x) => x.nodes.includes('n44'));
    expect(smallPrint(focus)?.state).toBe('collapsed');
    expect(smallPrint(guided)?.state).toBe('open');
    expect(smallPrint(overview)?.role).toBe('primary');
    // Section order: guided puts the title block first as its own hero.
    expect(guided.sections[0]?.role).toBe('orient');
    expect(guided.sections[0]?.nodes).toContain('n28');
    // Navigation: focus moves folded navigation to the end, overview opens it.
    const nav = (s: FitSpec) => s.sections.find((x) => x.nodes.includes('n11'));
    expect(nav(focus)?.state).toBe('end_drawer');
    expect(nav(overview)?.state).toBe('open');
    // show_first: focus 3, guided 4, overview 8 on list sections.
    const lists = (s: FitSpec) => new Set(s.sections.filter((x) => x.layout === 'card_grid').map((x) => x.show_first));
    expect([...lists(focus)]).toEqual([3]);
    expect([...lists(guided)]).toEqual([4]);
    expect([...lists(overview)]).toEqual([8]);
    expect(focus.density).toBe('airy');
    expect(overview.density).toBe('comfortable');
  });

  test('product pages keep the buy box whole; guided opens one reassurance section', () => {
    const cs = localVariants(PRODUCT, {}, TYPICAL);
    for (const c of cs) {
      const prim = c.spec.sections.find((s) => s.role === 'primary');
      expect(prim?.layout).toBe('buy_box');
      expect(prim?.nodes).toEqual(expect.arrayContaining(['n18', 'n19', 'n22']));
      expect(c.spec.form_steps).toEqual([]);
      // Safety text stays open in every stance.
      const safety = c.spec.sections.find((s) => s.nodes.includes('n28'));
      expect(safety?.state).toBe('open');
    }
    const reviews = (name: LayoutCandidate['name']) => byName(cs, name).spec.sections.find((s) => s.nodes.includes('n30'));
    expect(reviews('focus')?.state).toBe('collapsed');
    expect(reviews('guided')?.state).toBe('open');
    expect(reviews('overview')?.state).toBe('open');
  });

  test('one fieldset is not a stepper; search fields never count', () => {
    const o: PageOutline = {
      v: 'outline.1',
      nodes: [
        { id: 'n1', kind: 'field', label: 'Search', zone: 'header_band', landmark: 'banner' },
        { id: 'n2', kind: 'region', label: '', landmark: 'main', zone: 'center_column' },
        { id: 'n3', kind: 'heading', level: 1, label: 'Sign up', parent: 'n2', landmark: 'main', zone: 'center_column' },
        { id: 'n4', kind: 'region', label: 'Your details', parent: 'n2', landmark: 'main', zone: 'center_column' },
        { id: 'n5', kind: 'field', label: 'Name', parent: 'n4', landmark: 'main', zone: 'center_column' },
        { id: 'n6', kind: 'field', label: 'Email address', parent: 'n4', landmark: 'main', zone: 'center_column' },
        { id: 'n7', kind: 'field', label: 'Phone', parent: 'n4', landmark: 'main', zone: 'center_column' },
        { id: 'n8', kind: 'button', label: 'Submit', parent: 'n2', landmark: 'main', zone: 'center_column' },
      ],
    };
    for (const c of localVariants(o, {}, ROSA)) {
      expect(c.spec.form_steps.length === 0 || c.spec.form_steps.length === 1, c.name).toBe(true);
      sound(c.spec, o);
    }
  });

  test('random pages never throw and stay sound', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const o = randomOutline(seed, 20 + (seed % 5) * 15, seed % 7 === 0);
      const roles: Record<string, Role> = {};
      for (const fit of [ROSA, TYPICAL]) {
        const cs = localVariants(o, roles, fit);
        expect(cs.length).toBeLessThanOrEqual(3);
        for (const c of cs) sound(c.spec, o);
      }
    }
  });

  test('an empty outline has no variants', () => {
    expect(localVariants({ v: 'outline.1', nodes: [] }, {}, ROSA)).toEqual([]);
  });
});

describe('candidate sources', () => {
  test('tags read back; untagged candidates fall back by name', () => {
    expect(sourceTag('ai', 'gpt-6-sol')).toBe('source: ai (gpt-6-sol)');
    expect(candidateSource({ name: 'focus', repairs: [sourceTag('ai', 'gpt-6-sol'), 'coverage: x'] })).toBe('ai');
    expect(candidateSource({ name: 'focus', repairs: [sourceTag('local')] })).toBe('local');
    expect(candidateSource({ name: 'heuristic', repairs: [] })).toBe('heuristic');
    expect(candidateSource({ name: 'guided', repairs: ['coverage: placed 1 part'] })).toBe('ai');
  });
});
