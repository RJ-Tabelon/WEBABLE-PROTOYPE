import { describe, expect, it } from 'vitest';

import { REGION_ROLES, type RegionRole } from '../page/types';
import { articleSignals, evidence, makeRegion } from '../policy/fixtures';
import { CATALOG_VERSION } from '../versions';
import {
  combineVerdicts,
  labelFor,
  localVerdicts,
  mainFromAnswers,
  pageTypeFromAnswers,
  ruleVerdict,
  verdictsFromAnswers,
  withMainPick,
  type Recalibration,
} from './verdict';
import type { DecideResponse } from './wire';

type Ok = Extract<DecideResponse, { ok: true }>;

function roles(
  p: Partial<Record<RegionRole, number>>,
): Record<RegionRole, number> {
  const out = {} as Record<RegionRole, number>;
  for (const r of REGION_ROLES) out[r] = p[r] ?? 0;
  return out;
}

function answers(regions: Ok['regions'], extra: Partial<Ok> = {}): Ok {
  return {
    v: 1,
    ok: true,
    catalog: CATALOG_VERSION,
    model: 'jev-1.13.0',
    regions,
    inputTokens: 1,
    ms: { jev: 1, edge: 1 },
    ...extra,
  };
}

/** The illustrative response from ai-architecture.md 3.4. */
const WORKED = roles({
  navigation: 0.02,
  promo_ad: 0.05,
  recommendations: 0.91,
  other: 0.02,
});

describe('labelFor (3.5 bins)', () => {
  it.each<[number, number, string | null]>([
    [0.96, 0.06, 'clear'],
    [0.9, 0.1, 'clear'],
    [0.9, 0.11, 'likely'],
    [0.89, 0.05, 'likely'],
    [0.75, 0.2, 'likely'],
    [0.74, 0.1, 'unsure'],
    [0.5, 0.2, 'unsure'],
    [0.49, 0.0, null],
    [0.95, 0.21, null],
    [Number.NaN, 0, null],
  ])('P_elig %f, task %f -> %s', (p, t, label) => {
    expect(labelFor(p, t)).toBe(label);
  });
});

describe('verdictsFromAnswers', () => {
  const signals = articleSignals({}, [
    makeRegion('k-rail'),
    makeRegion('k-centre', { zone: 'center_column' }),
  ]);

  it('maps the worked example to a clear, unprotected recommendations verdict (3.4)', () => {
    const v = verdictsFromAnswers(
      answers({ r4: { role: WORKED, task: 0.06 } }),
      { r4: 'k-rail' },
      signals,
      'article',
    );
    expect(v['k-rail']).toEqual({
      key: 'k-rail',
      role: 'recommendations',
      label: 'clear',
      protected: false,
      source: 'page_analysis',
      pEligible: expect.closeTo(0.96, 9),
    });
  });

  it('vetoes first: P(protected) >= 0.05 protects even with high eligibility', () => {
    const role = roles({
      recommendations: 0.93,
      navigation: 0.05,
      other: 0.02,
    });
    const v = verdictsFromAnswers(
      answers({ r1: { role, task: 0.02 } }),
      { r1: 'k-rail' },
      signals,
      'article',
    );
    expect(v['k-rail']).toMatchObject({ protected: true, label: null });
    const justUnder = roles({
      recommendations: 0.95,
      navigation: 0.04,
      other: 0.01,
    });
    const w = verdictsFromAnswers(
      answers({ r1: { role: justUnder, task: 0.02 } }),
      { r1: 'k-rail' },
      signals,
      'article',
    );
    expect(w['k-rail']).toMatchObject({ protected: false, label: 'clear' });
  });

  it('vetoes when the task need is >= 0.20', () => {
    const v = verdictsFromAnswers(
      answers({ r1: { role: WORKED, task: 0.2 } }),
      { r1: 'k-rail' },
      signals,
      'article',
    );
    expect(v['k-rail']).toMatchObject({ protected: true, label: null });
    const w = verdictsFromAnswers(
      answers({ r1: { role: WORKED, task: 0.19 } }),
      { r1: 'k-rail' },
      signals,
      'article',
    );
    expect(w['k-rail']).toMatchObject({ protected: false, label: 'likely' });
  });

  it('protects feed and search centre columns (recommendations are the content)', () => {
    for (const category of ['feed_social', 'search_results'] as const) {
      const v = verdictsFromAnswers(
        answers({ r1: { role: WORKED, task: 0.02 } }),
        { r1: 'k-centre' },
        signals,
        category,
      );
      expect(v['k-centre']).toMatchObject({ protected: true, label: null });
      const rail = verdictsFromAnswers(
        answers({ r1: { role: WORKED, task: 0.02 } }),
        { r1: 'k-rail' },
        signals,
        category,
      );
      expect(rail['k-rail']!.protected).toBe(false);
    }
  });

  it.each<
    [string, Parameters<typeof makeRegion>[1], Parameters<typeof evidence>[0]]
  >([
    ['focus inside', { containsFocus: true }, {}],
    ['required fields', { hasRequiredFields: true }, {}],
    ['evidence required fields', {}, { required_fields: true }],
    ['inside main', {}, { dom_position: 'inside_main' }],
    ['help words', {}, { heading_words: 'help and support' }],
    ['contact control', {}, { control_words: ['contact us'] }],
    ['a search box', {}, { inputs: '1', control_words: ['search'] }],
    ['a search landmark', {}, { landmark: 'search' }],
  ])('applies local protective rules: %s', (_name, region, ev) => {
    const s = articleSignals({}, [makeRegion('k-x', region)]);
    const v = verdictsFromAnswers(
      answers({ r1: { role: WORKED, task: 0.02 } }),
      { r1: 'k-x' },
      s,
      'article',
      undefined,
      {
        'k-x': evidence(ev),
      },
    );
    expect(v['k-x']).toMatchObject({ protected: true, label: null });
  });

  it('never softens the main content region', () => {
    const s = articleSignals({ main: { key: 'k-rail', ambiguous: false } }, [
      makeRegion('k-rail'),
    ]);
    const v = verdictsFromAnswers(
      answers({ r1: { role: WORKED, task: 0.02 } }),
      { r1: 'k-rail' },
      s,
      'article',
    );
    expect(v['k-rail']!.protected).toBe(true);
  });

  it('applies the recalibration maps before thresholds', () => {
    const shrink: Recalibration = {
      dimEligible: (p) => p * 0.8,
      protectedRole: (p) => p,
      taskNeed: (p) => p,
    };
    const v = verdictsFromAnswers(
      answers({ r1: { role: WORKED, task: 0.06 } }),
      { r1: 'k-rail' },
      signals,
      'article',
      shrink,
    );
    expect(v['k-rail']!.label).toBe('likely');
    expect(v['k-rail']!.pEligible).toBeCloseTo(0.768, 9);
  });

  it('names a role only when it is probable, and skips unknown rids', () => {
    const split = roles({ promo_ad: 0.5, recommendations: 0.45, other: 0.05 });
    const v = verdictsFromAnswers(
      answers({
        r1: { role: split, task: 0.05 },
        r9: { role: WORKED, task: 0 },
      }),
      { r1: 'k-rail' },
      signals,
      'article',
    );
    expect(v['k-rail']).toMatchObject({ role: 'promo_ad', label: 'clear' });
    expect(Object.keys(v)).toEqual(['k-rail']);
    const unsure = roles({ other: 0.6, recommendations: 0.4 });
    const u = verdictsFromAnswers(
      answers({ r1: { role: unsure, task: 0.05 } }),
      { r1: 'k-rail' },
      signals,
      'article',
    );
    expect(u['k-rail']).toMatchObject({
      role: null,
      label: null,
      protected: false,
    });
  });
});

describe('ruleVerdict / localVerdicts / combineVerdicts', () => {
  it('decides only at precision >= 0.90', () => {
    expect(
      ruleVerdict(
        makeRegion('a', { ruleRole: 'promo_ad', rulePrecision: 0.89 }),
      ),
    ).toBeNull();
    expect(
      ruleVerdict(makeRegion('a', { ruleRole: null, rulePrecision: 0.99 })),
    ).toBeNull();
    expect(
      ruleVerdict(
        makeRegion('a', { ruleRole: 'promo_ad', rulePrecision: 0.98 }),
      ),
    ).toEqual({
      key: 'a',
      role: 'promo_ad',
      label: 'clear',
      protected: false,
      source: 'rule',
      pEligible: 0.98,
    });
  });

  it('protects protected roles and focus or required-field regions', () => {
    expect(
      ruleVerdict(
        makeRegion('a', { ruleRole: 'consent_banner', rulePrecision: 0.99 }),
      ),
    ).toMatchObject({ protected: true, label: null, pEligible: 0 });
    expect(
      ruleVerdict(
        makeRegion('a', {
          ruleRole: 'promo_ad',
          rulePrecision: 0.99,
          containsFocus: true,
        }),
      ),
    ).toMatchObject({ protected: true, label: null });
    expect(
      ruleVerdict(
        makeRegion('a', {
          ruleRole: 'chat_widget',
          rulePrecision: 0.99,
          hasRequiredFields: true,
        }),
      ),
    ).toMatchObject({ protected: true });
    expect(
      ruleVerdict(makeRegion('a', { ruleRole: 'other', rulePrecision: 0.99 })),
    ).toMatchObject({ protected: false, label: null });
  });

  it('collects rule verdicts for a page', () => {
    const v = localVerdicts(articleSignals());
    expect(Object.keys(v).sort()).toEqual([
      'k-ad',
      'k-chat',
      'k-cookie',
      'k-nav',
    ]);
    expect(v['k-cookie']!.protected).toBe(true);
    expect(v['k-ad']!.label).toBe('clear');
  });

  it('lets protection from page analysis win over a rule that would dim', () => {
    const rules = localVerdicts(articleSignals());
    const analysis = {
      'k-ad': {
        key: 'k-ad',
        role: null,
        label: null,
        protected: true,
        source: 'page_analysis' as const,
        pEligible: 0.2,
      },
    };
    const merged = combineVerdicts(rules, analysis);
    expect(merged['k-ad']).toMatchObject({
      protected: true,
      label: null,
      source: 'rule',
    });
    expect(merged['k-cookie']!.protected).toBe(true);
  });
});

describe('main pick and page type', () => {
  it('uses only the argmax: clear >= 0.80, likely 0.60-0.80, else nothing', () => {
    const map = { c1: 'k-a', c2: 'k-b' };
    expect(
      mainFromAnswers(
        answers(
          {},
          { mainPick: { c1: 0.85, c2: 0.1, c3: 0, c4: 0, none: 0.05 } },
        ),
        map,
      ),
    ).toEqual({ key: 'k-a', label: 'clear', p: 0.85 });
    expect(
      mainFromAnswers(
        answers(
          {},
          { mainPick: { c1: 0.3, c2: 0.65, c3: 0, c4: 0, none: 0.05 } },
        ),
        map,
      ),
    ).toEqual({ key: 'k-b', label: 'likely', p: 0.65 });
    expect(
      mainFromAnswers(
        answers(
          {},
          { mainPick: { c1: 0.5, c2: 0.4, c3: 0, c4: 0, none: 0.1 } },
        ),
        map,
      ).label,
    ).toBeNull();
    expect(
      mainFromAnswers(
        answers(
          {},
          { mainPick: { c1: 0.1, c2: 0.1, c3: 0, c4: 0, none: 0.8 } },
        ),
        map,
      ).key,
    ).toBeNull();
    expect(mainFromAnswers(answers({}), map)).toEqual({
      key: null,
      label: null,
      p: 0,
    });
  });

  it('adopts a clear main pick into the signals', () => {
    const s = articleSignals({ main: { key: null, ambiguous: true } });
    expect(
      withMainPick(s, { key: 'k-b', label: 'clear', p: 0.9 }).main,
    ).toEqual({ key: 'k-b', ambiguous: false });
    expect(withMainPick(s, { key: 'k-b', label: 'likely', p: 0.7 })).toBe(s);
  });

  it('uses page type for priors and risk only when confident', () => {
    const dist = (p: number) => ({
      article: p,
      feed_social: 1 - p,
      search_results: 0,
      form_checkout: 0,
      web_app: 0,
      docs_reference: 0,
      media_video: 0,
      other: 0,
    });
    expect(pageTypeFromAnswers(answers({}, { pageType: dist(0.85) }))).toEqual({
      category: 'article',
      p: 0.85,
      use: 'priors_and_risk',
    });
    expect(pageTypeFromAnswers(answers({}, { pageType: dist(0.7) }))).toEqual({
      category: 'article',
      p: 0.7,
      use: 'priors',
    });
    expect(
      pageTypeFromAnswers(answers({}, { pageType: dist(0.55) }))!.use,
    ).toBe('none');
    expect(pageTypeFromAnswers(answers({}))).toBeNull();
  });
});
