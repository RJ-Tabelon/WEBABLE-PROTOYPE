import { describe, expect, it } from 'vitest';

import {
  applyEvent,
  emptyDomainState,
  initialLearningState,
} from '../learning/learners';
import type { AdaptEvent, DomainState, SiteRule } from '../learning/types';
import { needLevels } from '../profile/needs';
import {
  applicability,
  buildPlan,
  decideOp,
  euAuto,
  frictionSignal,
  levelFor,
  offerProbability,
  planWithTraces,
} from './decide';
import {
  articleSignals,
  FIXTURE_DAY,
  FIXTURE_NOW,
  focusProfile,
  makeInput,
  makeRegion,
  strongReaderProfile,
  tier0Profile,
} from './fixtures';
import type { RegionVerdict } from './types';

const site = (patch: Partial<SiteRule> = {}): SiteRule => ({
  paused: false,
  pins: [],
  blocks: [],
  levels: {},
  updatedAt: 0,
  ...patch,
});

function undoOn(
  domain: DomainState | undefined,
  op: AdaptEvent['op'],
  patch: Partial<AdaptEvent> = {},
) {
  const profile = strongReaderProfile();
  const u = initialLearningState(profile, needLevels(profile), FIXTURE_DAY);
  return applyEvent(u, domain ?? emptyDomainState(FIXTURE_DAY), {
    v: 1,
    id: 'undo-event-0001',
    t: FIXTURE_NOW,
    tabSession: 'tab-1',
    domain: 'a.example',
    cat: 'article',
    op,
    opVer: 1,
    level: 1,
    src: 'profile',
    kind: 'undo',
    dtApplyMs: 2_000,
    ...patch,
  });
}

const analysisVerdict = (
  key: string,
  patch: Partial<RegionVerdict> = {},
): RegionVerdict => ({
  key,
  role: 'recommendations',
  label: 'clear',
  protected: false,
  source: 'page_analysis',
  pEligible: 0.96,
  ...patch,
});

describe('applicability (measured facts)', () => {
  it('measures small text against the person’s floor', () => {
    const a = applicability('text_floor', makeInput());
    expect(a.a).toBe(1);
    expect(a.evidence).toEqual([
      { kind: 'small_text', share: 0.94, floorPx: 21, beforePx: 13 },
    ]);
    const big = makeInput({
      signals: articleSignals({
        text: { histogram: [[22, 5000]], mainFontPx: 22 },
      }),
    });
    expect(applicability('text_floor', big).a).toBe(0);
  });

  it('skips page zoom when the page is already zoomed enough', () => {
    const zoomed = makeInput({
      signals: articleSignals({ viewport: { zoom: 1.5 } }),
    });
    expect(applicability('page_zoom', zoomed).a).toBe(0);
    expect(applicability('page_zoom', makeInput()).a).toBe(1);
  });

  it('counts contrast failures against the person’s floor and stays out of forced colours', () => {
    const p = strongReaderProfile();
    p.vision.contrastFloor = {
      value: 7,
      source: 'measured',
      confidence: 0.8,
      measured: 7,
    };
    expect(
      applicability('contrast', makeInput({ profile: p })).evidence,
    ).toEqual([{ kind: 'contrast_failures', count: 40, targetRatio: 7 }]);
    expect(applicability('contrast', makeInput()).evidence).toEqual([
      { kind: 'contrast_failures', count: 14, targetRatio: 4.5 },
    ]);
    const forced = makeInput({
      signals: articleSignals({ env: { forcedColors: true } }),
    });
    expect(applicability('contrast', forced).a).toBe(0);
  });

  it('uses targets below the person’s size, crowding, hover menus, motion and autoplay', () => {
    const input = makeInput();
    expect(applicability('target_size', input).evidence).toEqual([
      { kind: 'target_failures', count: 18, targetPx: 44 },
    ]);
    expect(applicability('target_spacing', input).evidence).toEqual([
      { kind: 'crowded_targets', count: 9 },
    ]);
    expect(applicability('menu_grace', input).evidence).toEqual([
      { kind: 'hover_menus', count: 2 },
    ]);
    expect(applicability('calm_motion', input).evidence).toEqual([
      { kind: 'motion_sources', count: 4 },
    ]);
    expect(applicability('pause_media', input).evidence).toEqual([
      { kind: 'autoplay_media', count: 2 },
    ]);
    const still = makeInput({
      signals: articleSignals({
        motion: {
          running: 0,
          infinite: 0,
          autoplayMedia: 0,
          carousels: 0,
          animatedImages: 0,
        },
      }),
    });
    expect(applicability('calm_motion', still).a).toBe(0);
    expect(applicability('pause_media', still).a).toBe(0);
  });

  it('compares main text line length and line height with the person’s values', () => {
    const input = makeInput();
    expect(applicability('line_length', input)).toMatchObject({
      a: 1,
      regions: ['k-main'],
      evidence: [{ kind: 'long_lines', lineCh: 96, maxCh: 70 }],
    });
    expect(applicability('line_spacing', input).evidence).toEqual([
      { kind: 'tight_lines', lineHeight: 1.3, target: 1.6 },
    ]);
    const ambiguous = makeInput({
      signals: articleSignals({ main: { key: 'k-main', ambiguous: true } }),
    });
    expect(applicability('line_length', ambiguous).a).toBe(0);
  });

  it('unpins only navigation bars that take over 20% of the screen after zoom', () => {
    const tall = makeInput({
      signals: articleSignals({ sticky: { bars: 1, topBandPx: 200 } }),
    });
    expect(applicability('unpin_bars', tall)).toMatchObject({
      regions: ['k-nav'],
      evidence: [
        { kind: 'sticky_bars', count: 1, heightPx: 200 },
        { kind: 'region_role', role: 'navigation', by: 'rule' },
      ],
    });
    expect(
      applicability(
        'unpin_bars',
        makeInput({
          profile: tier0Profile(),
          signals: articleSignals({ sticky: { bars: 1, topBandPx: 150 } }),
        }),
      ).a,
    ).toBe(0);
  });

  it('only offers a focus outline where keyboard focus matters', () => {
    expect(applicability('focus_outline', makeInput()).a).toBe(0);
    const p = strongReaderProfile();
    p.motor.input = 'keyboard';
    expect(applicability('focus_outline', makeInput({ profile: p })).a).toBe(1);
  });

  it('dims only dimmable, unprotected regions, strongest first', () => {
    const a = applicability(
      'dim_distractions',
      makeInput({ profile: focusProfile() }),
    );
    expect(a.regions).toEqual(['k-ad', 'k-chat']);
    expect(a.perRegion['k-ad']).toBeCloseTo(0.98, 9);
    expect(a.regions).not.toContain('k-cookie');
    expect(a.regions).not.toContain('k-nav');
  });

  it('uses the label table for page-analysis verdicts', () => {
    const input = makeInput({
      profile: focusProfile(),
      patch: {
        verdicts: { 'k-rail': analysisVerdict('k-rail', { label: 'likely' }) },
      },
    });
    const a = applicability('dim_distractions', input);
    expect(a.perRegion['k-rail']).toBeCloseTo(0.55, 9);
    expect(a.evidence).toContainEqual({
      kind: 'region_role',
      role: 'recommendations',
      by: 'page_analysis',
      label: 'likely',
    });
  });
});

describe('decideOp', () => {
  it('auto-applies a strong profile need with a complete trace', () => {
    const { planned, trace } = decideOp('text_floor', makeInput());
    expect(planned).toMatchObject({
      op: 'text_floor',
      mode: 'auto',
      scope: 'page',
      level: 3,
    });
    expect(trace).toMatchObject({
      mode: 'auto',
      source: 'profile',
      level: 3,
      p: 0.85,
      pOk: 0.85,
    });
    expect(trace.evidence).toEqual([
      { kind: 'small_text', share: 0.94, floorPx: 21, beforePx: 13 },
    ]);
  });

  it('offers, never auto-applies, a mild need', () => {
    const { planned } = decideOp('target_size', makeInput());
    expect(planned?.mode).toBe('offer');
  });

  it('lets friction raise an offer but never apply a change', () => {
    const quiet = decideOp(
      'target_size',
      makeInput({ profile: tier0Profile() }),
    );
    expect(quiet.planned).toBeNull();
    const nudged = decideOp(
      'target_size',
      makeInput({
        profile: tier0Profile(),
        patch: { friction: { target_size: 3 } },
      }),
    );
    expect(nudged.planned?.mode).toBe('offer');
    expect(nudged.trace.source).toBe('friction');
    expect(nudged.trace.evidence).toContainEqual({
      kind: 'friction',
      signal: 'misclick_burst',
    });
    const shouting = decideOp(
      'target_size',
      makeInput({
        profile: tier0Profile(),
        patch: { friction: { target_size: 1e9 } },
      }),
    );
    expect(shouting.planned?.mode).toBe('offer');
  });

  it('follows the hard rules first', () => {
    expect(
      decideOp(
        'text_floor',
        makeInput({ patch: { site: site({ paused: true }) } }),
      ).trace.why,
    ).toBe('site_paused');
    expect(
      decideOp(
        'text_floor',
        makeInput({ patch: { site: site({ blocks: ['text_floor'] }) } }),
      ).trace.why,
    ).toBe('blocked');
    const blocked = makeInput();
    blocked.learning.ops.text_floor.blocked = true;
    expect(decideOp('text_floor', blocked).planned).toBeNull();
    const undone = undoOn(undefined, 'text_floor');
    expect(
      decideOp('text_floor', makeInput({ domain: undone.domain })).trace.why,
    ).toBe('undone_this_session');
  });

  it('lets a snooze silence offers only, and the engine gate stop everything', () => {
    const snoozed = emptyDomainState(FIXTURE_DAY);
    snoozed.ops.text_floor = {
      s: 0,
      f: 0,
      t: FIXTURE_DAY,
      skipUntil: FIXTURE_DAY + 3,
    };
    snoozed.ops.target_size = {
      s: 0,
      f: 0,
      t: FIXTURE_DAY,
      skipUntil: FIXTURE_DAY + 3,
    };
    const input = makeInput({ domain: snoozed });
    expect(decideOp('text_floor', input).planned?.mode).toBe('auto');
    expect(decideOp('target_size', input).trace.why).toBe('snoozed_here');

    const gated = emptyDomainState(FIXTURE_DAY);
    gated.ops.text_floor = {
      s: 0,
      f: 0,
      t: FIXTURE_DAY,
      skipUntil: FIXTURE_DAY + 3,
      engineUntil: FIXTURE_DAY + 3,
    } as NonNullable<DomainState['ops']['text_floor']>;
    const blocked = decideOp('text_floor', makeInput({ domain: gated }));
    expect(blocked.planned).toBeNull();
    expect(blocked.trace.why).toBe('engine_unreliable_here');
  });

  it('uses the manual site level and pins', () => {
    const input = makeInput({
      patch: {
        site: site({ levels: { text_floor: 5 }, pins: ['reading_guide'] }),
      },
    });
    expect(levelFor('text_floor', input)).toBe(5);
    const guide = decideOp('reading_guide', input);
    expect(guide.planned?.mode).toBe('auto');
    expect(guide.trace.source).toBe('pinned');
    expect(guide.trace.evidence).toContainEqual({
      kind: 'learned',
      note: 'site_pin',
    });
  });

  it('computes expected utility and offer probability per personalization.md 5', () => {
    expect(euAuto(0.7, 1)).toBeCloseTo(0.7 - 0.3 * 2.33, 12);
    expect(euAuto(0.72, 0.95)).toBeGreaterThan(0);
    expect(euAuto(0.68, 0.95)).toBeLessThan(0);
    expect(offerProbability(0.15, 4)).toBeCloseTo(0.4138, 3);
    expect(offerProbability(0.2, 3)).toBeCloseTo(0.4286, 3);
    expect(offerProbability(0.2, 0.1)).toBeCloseTo(0.2, 9);
    expect(frictionSignal('text_floor', 4)).toBe('zoom_in');
    expect(frictionSignal('reading_guide', 2)).toBe('scroll_reversal');
  });
});

describe('buildPlan', () => {
  it('returns an empty plan on a paused site', () => {
    const plan = buildPlan(
      makeInput({
        profile: focusProfile(),
        patch: { site: site({ paused: true }) },
      }),
    );
    expect(plan.ops).toEqual([]);
    expect(plan.category).toBe('article');
  });

  it('never zooms the tab: when most text is small, a text floor applies (page_zoom is retired)', () => {
    const { plan, traces } = planWithTraces(makeInput());
    expect(plan.ops.map((o) => o.op)).toContain('text_floor');
    expect(plan.ops.map((o) => o.op)).not.toContain('page_zoom');
    expect(traces.find((t) => t.op === 'page_zoom')?.why).toBe('retired');
  });

  it('never zooms the tab, even when the site pins page zoom', () => {
    const ops = buildPlan(
      makeInput({ patch: { site: site({ pins: ['page_zoom'] }) } }),
    ).ops.map((o) => o.op);
    expect(ops).not.toContain('page_zoom');
  });

  it('picks a text floor over page zoom when only outliers are small', () => {
    const signals = articleSignals({
      text: {
        histogram: [
          [13, 800],
          [22, 4200],
        ],
        mainFontPx: 22,
      },
    });
    const ops = buildPlan(makeInput({ signals })).ops.map((o) => o.op);
    expect(ops).toContain('text_floor');
    expect(ops).not.toContain('page_zoom');
  });

  it('lets a pin override the strategy table', () => {
    const ops = buildPlan(
      makeInput({ patch: { site: site({ pins: ['text_floor'] }) } }),
    ).ops.map((o) => o.op);
    expect(ops).toContain('text_floor');
    expect(ops).not.toContain('page_zoom');
  });

  it('lets focus view supersede dimming', () => {
    const input = makeInput({
      profile: focusProfile(),
      patch: { site: site({ pins: ['focus_view'] }) },
    });
    const { plan, traces } = planWithTraces(input);
    expect(plan.ops.find((o) => o.op === 'focus_view')?.mode).toBe('auto');
    expect(plan.ops.find((o) => o.op === 'dim_distractions')).toBeUndefined();
    expect(traces.find((t) => t.op === 'dim_distractions')?.why).toBe(
      'superseded_by_focus_view',
    );
  });

  it('keeps automatic dimming when focus view is only offered', () => {
    const p = focusProfile();
    p.attention.distraction = {
      mean: 1.5,
      sd: 0.1,
      confidence: 1,
      sources: ['behavior'],
    };
    const input = makeInput({
      profile: p,
      patch: { site: site({ pins: ['dim_distractions'] }) },
    });
    const plan = buildPlan(input);
    expect(plan.ops.find((o) => o.op === 'dim_distractions')?.mode).toBe(
      'auto',
    );
  });

  it('shows at most one offer per page, and none when the budget is spent', () => {
    const plan = buildPlan(makeInput());
    expect(plan.ops.filter((o) => o.mode === 'offer')).toHaveLength(1);
    expect(
      buildPlan(makeInput({ patch: { offersThisPage: 1 } })).ops.filter(
        (o) => o.mode === 'offer',
      ),
    ).toHaveLength(0);
    expect(
      buildPlan(makeInput({ patch: { offersToday: 4 } })).ops.filter(
        (o) => o.mode === 'offer',
      ),
    ).toHaveLength(0);
    const autos = buildPlan(
      makeInput({ patch: { offersToday: 4 } }),
    ).ops.filter((o) => o.mode === 'auto');
    expect(autos.length).toBeGreaterThan(0);
  });

  it('respects the global offer cooldown after repeated dismissals', () => {
    const input = makeInput();
    input.learning.ops.line_length.offerCooldownUntil = FIXTURE_DAY + 30;
    input.learning.ops.target_size.offerCooldownUntil = FIXTURE_DAY + 30;
    input.learning.ops.line_spacing.offerCooldownUntil = FIXTURE_DAY + 30;
    input.learning.ops.target_spacing.offerCooldownUntil = FIXTURE_DAY + 30;
    input.learning.ops.reading_guide.offerCooldownUntil = FIXTURE_DAY + 30;
    const { plan, traces } = planWithTraces(input);
    expect(plan.ops.filter((o) => o.mode === 'offer')).toHaveLength(0);
    expect(traces.find((t) => t.op === 'line_length')?.why).toBe(
      'offer_cooldown',
    );
  });

  it('marks the basis as page analysis when analysis verdicts drive an op', () => {
    const p = focusProfile();
    const signals = articleSignals({}, [makeRegion('k-rail', { areaPct: 20 })]);
    const input = makeInput({
      profile: p,
      signals,
      patch: { verdicts: { 'k-rail': analysisVerdict('k-rail') } },
    });
    const plan = buildPlan(input);
    const dim = plan.ops.find(
      (o) => o.op === 'dim_distractions' || o.op === 'focus_view',
    );
    expect(dim).toBeDefined();
    if (dim?.op === 'dim_distractions')
      expect(plan.basis).toBe('page_analysis');
  });

  it('keeps an uncalibrated person’s pages as the site made them, except for OS settings', () => {
    expect(buildPlan(makeInput({ profile: tier0Profile() })).ops).toEqual([]);
    const reduced = tier0Profile({
      reducedMotion: true,
      colorScheme: 'light',
      moreContrast: false,
      forcedColors: false,
      deviceClass: 'laptop',
      input: 'mouse',
    });
    const plan = buildPlan(makeInput({ profile: reduced }));
    expect(plan.ops.map((o) => [o.op, o.mode, o.trace.source])).toEqual([
      ['calm_motion', 'auto', 'system'],
      ['pause_media', 'auto', 'system'],
    ]);
  });

  it('is deterministic', () => {
    expect(buildPlan(makeInput({ profile: focusProfile() }))).toEqual(
      buildPlan(makeInput({ profile: focusProfile() })),
    );
  });
});
