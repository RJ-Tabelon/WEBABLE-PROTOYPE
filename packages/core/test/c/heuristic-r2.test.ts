// Package C (round 2): Calm layout heuristic rules from the live eval (eval.md P0.3) and the Calm brief.
import { describe, expect, test } from 'vitest';
import { DEMO_FITS, summarizeFitForModel } from '../../src/fit/derive';
import { heuristicSpec } from '../../src/layout/heuristic';
import {
  chatRoot, indexOutline, isSideField, isWarningOverlay, labelFromWords, outlineProtection, overlayRoot,
} from '../../src/layout/outline';
import { placementMap, repairSpec, specCoverage } from '../../src/layout/spec';
import type { FitSpec, FitSummaryForModel, OutlineNode, PageOutline } from '../../src/types';
import { ALDERRA_LIVE, ALDERRA_LIVE_ROLES, BENEFITS_LIVE, BENEFITS_LIVE_ROLES } from './live-fixtures';

const ROSA: FitSummaryForModel = summarizeFitForModel(DEMO_FITS.rosa);
const TYPICAL: FitSummaryForModel = summarizeFitForModel(DEMO_FITS.typical);

type N = Omit<OutlineNode, 'id' | 'parent'> & { id: number; parent?: number };
const outline = (nodes: N[]): PageOutline => ({
  v: 'outline.1',
  nodes: nodes.map(({ id, parent, ...n }) => ({ ...n, id: `n${id}`, ...(parent ? { parent: `n${parent}` } : {}) })),
});

/** Section index (or 'strip') where an id renders: itself if listed, else its nearest listed ancestor. */
function place(spec: FitSpec, o: PageOutline, id: string): 'strip' | number | null {
  const ix = indexOutline(o);
  const m = placementMap(spec);
  for (const x of [id, ...ix.ancestors(id)]) {
    const w = m.get(x);
    if (w !== undefined) return w;
  }
  return null;
}

const primaryIndex = (spec: FitSpec): number => spec.sections.findIndex((s) => s.role === 'primary');

describe('section labels from page words', () => {
  test('"Email address" is not a postal address', () => {
    expect(labelFromWords('email address')).not.toBe('Address');
    expect(labelFromWords('e-mail address')).not.toBe('Address');
    expect(labelFromWords('home address')).toBe('Address');
    expect(labelFromWords('street address city zip code')).toBe('Address');
    expect(labelFromWords('date of birth')).toBe('Your details');
  });
});

describe('form steps only for real forms', () => {
  // A news home page: a search box, a newsletter sign-up and lots of links.
  const NEWS = outline([
    { id: 1, kind: 'region', label: '', landmark: 'banner', zone: 'header_band' },
    { id: 2, kind: 'field', label: 'Search', parent: 1, landmark: 'banner', zone: 'header_band' },
    { id: 3, kind: 'button', label: 'Expand Side Navigation Panel', parent: 1, landmark: 'banner', zone: 'header_band' },
    { id: 4, kind: 'region', label: '', landmark: 'main', zone: 'center_column' },
    { id: 5, kind: 'heading', level: 2, label: 'Top headlines', parent: 4, landmark: 'main', zone: 'center_column' },
    ...[6, 7, 8, 9, 10].map((id) => ({ id, kind: 'link' as const, label: '· · ·', parent: 4, landmark: 'main', zone: 'center_column' as const })),
    { id: 11, kind: 'region', label: 'Get the newsletter', parent: 4, landmark: 'main', zone: 'center_column' },
    { id: 12, kind: 'field', label: 'Email address', parent: 11, landmark: 'main', zone: 'center_column' },
    { id: 13, kind: 'button', label: 'Sign up', parent: 11, landmark: 'main', zone: 'center_column' },
  ]);

  test('a search box and a newsletter field are not a form', () => {
    const spec = heuristicSpec(NEWS, {}, ROSA);
    expect(spec.form_steps).toEqual([]);
    expect(spec.page_type).not.toBe('form');
    expect(spec.sections.some((s) => s.layout === 'form_steps')).toBe(false);
    const ix = indexOutline(NEWS);
    expect(isSideField(ix, 'n2')).toBe(true);
    expect(isSideField(ix, 'n12')).toBe(true);
  });

  test('one fieldset is one step: no stepper', () => {
    const ONE = outline([
      { id: 1, kind: 'region', label: '', landmark: 'main', zone: 'center_column' },
      { id: 2, kind: 'heading', level: 1, label: 'Contact us', parent: 1, landmark: 'main', zone: 'center_column' },
      { id: 3, kind: 'region', label: 'Your details', parent: 1, landmark: 'main', zone: 'center_column' },
      { id: 4, kind: 'field', label: 'First name', parent: 3, landmark: 'main', zone: 'center_column' },
      { id: 5, kind: 'field', label: 'Last name', parent: 3, landmark: 'main', zone: 'center_column' },
      { id: 6, kind: 'field', label: 'Phone number', parent: 3, landmark: 'main', zone: 'center_column' },
      { id: 7, kind: 'field', label: 'Message', parent: 3, landmark: 'main', zone: 'center_column' },
      { id: 8, kind: 'button', label: 'Send', parent: 1, landmark: 'main', zone: 'center_column' },
    ]);
    const spec = heuristicSpec(ONE, {}, ROSA);
    expect(spec.primary_action).toBe('n8');
    expect(spec.form_steps).toEqual([]);
    expect(spec.sections[primaryIndex(spec)]?.layout).not.toBe('form_steps');
  });

  test('two fieldsets with real fields step one fieldset at a time', () => {
    const TWO = outline([
      { id: 1, kind: 'region', label: '', landmark: 'main', zone: 'center_column' },
      { id: 2, kind: 'heading', level: 1, label: 'Apply', parent: 1, landmark: 'main', zone: 'center_column' },
      { id: 3, kind: 'region', label: 'Your name', parent: 1, landmark: 'main', zone: 'center_column' },
      { id: 4, kind: 'field', label: 'First name', parent: 3, landmark: 'main', zone: 'center_column' },
      { id: 5, kind: 'field', label: 'Last name', parent: 3, landmark: 'main', zone: 'center_column' },
      { id: 6, kind: 'region', label: 'Date of birth', parent: 1, landmark: 'main', zone: 'center_column' },
      { id: 7, kind: 'select', label: 'Month', parent: 6, landmark: 'main', zone: 'center_column' },
      { id: 8, kind: 'field', label: 'Day', parent: 6, landmark: 'main', zone: 'center_column' },
      { id: 9, kind: 'field', label: 'Year', parent: 6, landmark: 'main', zone: 'center_column' },
      { id: 10, kind: 'region', label: 'Home address', parent: 1, landmark: 'main', zone: 'center_column' },
      { id: 11, kind: 'field', label: 'Street address', parent: 10, landmark: 'main', zone: 'center_column' },
      { id: 12, kind: 'field', label: 'City', parent: 10, landmark: 'main', zone: 'center_column' },
      { id: 13, kind: 'field', label: 'Email address', parent: 1, landmark: 'main', zone: 'center_column' },
      { id: 14, kind: 'button', label: 'Continue', parent: 1, landmark: 'main', zone: 'center_column' },
    ]);
    const spec = heuristicSpec(TWO, {}, ROSA);
    expect(spec.sections[primaryIndex(spec)]?.layout).toBe('form_steps');
    expect(spec.form_steps.map((s) => s.fields)).toEqual([['n4', 'n5'], ['n7', 'n8', 'n9'], ['n11', 'n12', 'n13']]);
    expect(spec.form_steps.map((s) => s.label)).not.toContain('Date');
    expect(spec.form_steps[2]?.label).toBe('Address');
  });
});

describe('overlays: chat, surveys and warnings', () => {
  const PAGE = outline([
    { id: 1, kind: 'region', label: '', landmark: 'banner', zone: 'header_band' },
    { id: 2, kind: 'link', label: 'Florida Power · Light logo', parent: 1, landmark: 'banner', zone: 'header_band' },
    { id: 3, kind: 'region', label: '', landmark: 'main', zone: 'center_column' },
    { id: 4, kind: 'heading', level: 1, label: 'Refill prescriptions', parent: 3, landmark: 'main', zone: 'center_column' },
    { id: 5, kind: 'link', label: 'Company logo', parent: 3, landmark: 'main', zone: 'center_column' },
    { id: 6, kind: 'region', label: 'Prescriptions', parent: 3, landmark: 'main', zone: 'center_column' },
    { id: 7, kind: 'checkbox', label: '·', parent: 6, landmark: 'main', zone: 'center_column' },
    { id: 8, kind: 'checkbox', label: '·', parent: 6, landmark: 'main', zone: 'center_column' },
    { id: 9, kind: 'region', label: 'Pickup', parent: 3, landmark: 'main', zone: 'center_column' },
    { id: 10, kind: 'radio', label: 'In-store pickup', parent: 9, landmark: 'main', zone: 'center_column' },
    { id: 11, kind: 'radio', label: 'Delivery', parent: 9, landmark: 'main', zone: 'center_column' },
    { id: 12, kind: 'button', label: 'Confirm refill', parent: 3, landmark: 'main', zone: 'center_column' },
    { id: 13, kind: 'notice', label: '', parent: 3, landmark: 'main', zone: 'center_column' },
    // A chat widget that opened by itself.
    { id: 20, kind: 'region', label: '· virtual assistant', landmark: 'dialog', zone: 'overlay_corner', protected: true },
    { id: 21, kind: 'button', label: 'Minimize chat', parent: 20, landmark: 'dialog', zone: 'overlay_corner', protected: true },
    { id: 22, kind: 'field', label: 'Message', parent: 20, landmark: 'dialog', zone: 'overlay_corner' },
    { id: 23, kind: 'button', label: 'Send message', parent: 20, landmark: 'dialog', zone: 'overlay_corner' },
    // A survey popup with a "protected" line (the reader saw "help us improve").
    { id: 30, kind: 'region', label: 'How is your visit going', landmark: 'dialog', zone: 'overlay_corner', jevRole: 'popup_overlay', protected: true },
    { id: 31, kind: 'text', label: '· us improve', parent: 30, landmark: 'dialog', zone: 'overlay_corner', protected: true },
    { id: 32, kind: 'button', label: 'No thanks', parent: 30, landmark: 'dialog', zone: 'overlay_corner' },
    // A session-timeout warning.
    { id: 40, kind: 'region', label: 'Your session is about to end', zone: 'overlay_center', jevRole: 'popup_overlay' },
    { id: 41, kind: 'heading', level: 2, label: 'Your session is about to end', parent: 40, landmark: 'dialog', zone: 'overlay_center' },
    { id: 42, kind: 'button', label: 'Stay signed in', parent: 40, landmark: 'dialog', zone: 'overlay_center' },
  ]);

  test('helpers recognise the chat, the warning and the survey', () => {
    const ix = indexOutline(PAGE);
    expect(chatRoot(ix, 'n21')).toBe('n20');
    expect(chatRoot(ix, 'n42')).toBeNull();
    expect(overlayRoot(ix, 'n31')).toBe('n30');
    expect(isWarningOverlay(ix, 'n40')).toBe(true);
    expect(isWarningOverlay(ix, 'n30')).toBe(false);
    expect(outlineProtection(ix, 'n20')).toBe('help');
    expect(outlineProtection(ix, 'n21')).toBeNull();
    expect(outlineProtection(ix, 'n31')).toBeNull();
    expect(outlineProtection(ix, 'n13')).toBeNull();
  });

  for (const [name, fit] of [['rosa', ROSA], ['typical', TYPICAL]] as const) {
    test(`chat stays one section, the survey folds, the warning comes first (${name})`, () => {
      const spec = repairSpec(heuristicSpec(PAGE, {}, fit), PAGE).spec;
      expect(specCoverage(spec, PAGE).missing).toEqual([]);
      // Chat controls never reach the top bar or the form.
      for (const id of ['n20', 'n21', 'n22', 'n23']) expect(spec.strip).not.toContain(id);
      const chatAt = place(spec, PAGE, 'n21') as number;
      expect(spec.sections[chatAt]?.role).toBe('help');
      expect(spec.sections[chatAt]?.state).toBe('open');
      expect(chatAt).not.toBe(primaryIndex(spec));
      expect(spec.form_steps.flatMap((s) => s.fields)).not.toContain('n22');
      // The survey goes to the end drawer, its "protected" line with it.
      expect(spec.sections[place(spec, PAGE, 'n31') as number]?.state).toBe('end_drawer');
      // The warning is the first section.
      expect(place(spec, PAGE, 'n42')).toBe(0);
      expect(spec.sections[0]?.role).toBe('alert');
      // Logos are never content cards; an empty notice is not an alert.
      expect(place(spec, PAGE, 'n5')).not.toBe(primaryIndex(spec));
      expect(spec.sections[place(spec, PAGE, 'n13') as number]?.role).not.toBe('alert');
      expect(spec.primary_action).toBe('n12');
    });
  }
});

describe('live outlines from the demo pages', () => {
  test('Alderra: the form keeps its intro and fine print, chat and footer stay out of it', () => {
    const spec = repairSpec(heuristicSpec(ALDERRA_LIVE, ALDERRA_LIVE_ROLES, ROSA), ALDERRA_LIVE).spec;
    expect(specCoverage(spec, ALDERRA_LIVE).missing).toEqual([]);
    expect(spec.primary_action).toBe('n94');
    const prim = primaryIndex(spec);
    for (const id of ['n49', 'n50', 'n51', 'n74', 'n89', 'n94', 'n95']) expect(place(spec, ALDERRA_LIVE, id), id).toBe(prim);
    // Chat (n316) and the footer's customer-service block (n262) are not in the form.
    expect(place(spec, ALDERRA_LIVE, 'n320')).not.toBe(prim);
    expect(place(spec, ALDERRA_LIVE, 'n262')).not.toBe(prim);
    expect(spec.strip).not.toContain('n320');
    expect(spec.form_steps.flatMap((s) => s.fields)).toEqual(['n56', 'n60', 'n64', 'n76', 'n80', 'n82']);
    // The product shelf goes to the end drawer.
    expect(spec.sections[place(spec, ALDERRA_LIVE, 'n159') as number]?.state).toBe('end_drawer');
  });

  test('Benefits: the session warning comes first, the survey folds, one step per fieldset', () => {
    const spec = repairSpec(heuristicSpec(BENEFITS_LIVE, BENEFITS_LIVE_ROLES, ROSA), BENEFITS_LIVE).spec;
    expect(specCoverage(spec, BENEFITS_LIVE).missing).toEqual([]);
    expect(spec.primary_action).toBe('n96');
    expect(spec.sections[0]?.role).toBe('alert');
    expect(spec.sections[0]?.nodes).toContain('n128');
    expect(spec.sections[place(spec, BENEFITS_LIVE, 'n137') as number]?.state).toBe('end_drawer');
    // The menu and breadcrumb stay folded (their links are not help).
    expect(spec.sections[place(spec, BENEFITS_LIVE, 'n24') as number]?.state).toBe('collapsed');
    const steps = spec.form_steps.map((s) => s.fields);
    expect(steps[0]).toEqual(['n48', 'n50', 'n52']);
    expect(steps[1]).toEqual(['n57', 'n59', 'n61']);
    expect(steps.length).toBeLessThanOrEqual(6);
    expect(spec.form_steps.map((s) => s.label)).not.toContain('Date');
  });
});
