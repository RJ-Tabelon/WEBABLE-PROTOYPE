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
  triageBand,
  zoomInEffect,
} from './decide';
import { TEXT_RESIDUAL_MIN } from '../triage/triage';
import {
  articleSignals,
  FIXTURE_DAY,
  FIXTURE_NOW,
  focusProfile,
  govukSignals,
  largeTargetProfile,
  largeTextProfile,
  makeInput,
  makeRegion,
  strongReaderProfile,
  tier0Profile,
  triageFor,
  wikipediaSignals,
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

  it('never scales the page without triage', () => {
    expect(applicability('page_zoom', makeInput()).a).toBe(0);
    const { traces } = planWithTraces(makeInput());
    expect(traces.find((t) => t.op === 'page_zoom')?.why).toBe('not_triaged');
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

  it('applies the saved target minimum even for a mild need', () => {
    const { planned } = decideOp('target_size', makeInput());
    expect(planned?.mode).toBe('auto');
    expect(planned?.trace.why).toBe('saved_fit');
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

  it('never scales the page without triage, even when the site pins page zoom', () => {
    const { plan, traces } = planWithTraces(
      makeInput({ patch: { site: site({ pins: ['page_zoom'] }) } }),
    );
    expect(plan.ops.map((o) => o.op)).toContain('text_floor');
    expect(plan.ops.map((o) => o.op)).not.toContain('page_zoom');
    expect(traces.find((t) => t.op === 'page_zoom')?.why).toBe('not_triaged');
    expect(plan.zoom).toBe(1);
    expect(plan.triage).toBeUndefined();
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

describe('composition with triage (docs/10 §5.1-5.2)', () => {
  /** Policy input with triage computed for the profile and page, as the worker does. */
  const triaged = (
    profile: ReturnType<typeof strongReaderProfile>,
    signals: ReturnType<typeof articleSignals>,
    opts: Omit<
      Parameters<typeof makeInput>[0] & object,
      'profile' | 'signals'
    > = {},
  ) =>
    makeInput({
      ...opts,
      profile,
      signals,
      patch: { ...opts.patch, triage: triageFor(profile, signals) },
    });
  const op = (plan: { ops: Array<{ op: string }> }, id: string) =>
    plan.ops.find((o) => o.op === id) as
      (ReturnType<typeof buildPlan>['ops'][number] & object) | undefined;

  it('scales the page to triage’s preset and lets text floor carry the residual', () => {
    const input = triaged(largeTextProfile(28), wikipediaSignals());
    const { plan, traces } = planWithTraces(input);
    // k = 28 / 14 = 2, past the breakpoint-safe 1.6 (1280 px): 150%, residual 1.33.
    expect(input.triage).toMatchObject({ k: 2, zoom: 1.5, residual: 1.333 });
    expect(op(plan, 'page_zoom')).toMatchObject({ mode: 'auto', level: 2 });
    expect(op(plan, 'page_zoom')?.trace.evidence).toEqual([
      { kind: 'page_scale', zoom: 1.5, k: 2 },
      { kind: 'small_text', share: 0.99, floorPx: 28, beforePx: 14 },
    ]);
    // The text floor keeps its effective 28 px; running text at 150% is 21 px.
    expect(op(plan, 'text_floor')).toMatchObject({ mode: 'auto', level: 5 });
    expect(op(plan, 'text_floor')?.trace.evidence).toEqual([
      { kind: 'small_text', share: 0.99, floorPx: 28, beforePx: 21 },
      { kind: 'page_scale', zoom: 1.5, k: 2 },
    ]);
    expect(plan.zoom).toBe(1.5);
    expect(plan.triage).toBe(input.triage);
    expect(traces.find((t) => t.op === 'page_zoom')?.why).toBe('saved_fit');
  });

  it('applies the page scale alone when it reaches the person’s size', () => {
    const { plan, traces } = planWithTraces(
      triaged(largeTextProfile(24), govukSignals()),
    );
    // k = 24 / 19 = 1.26: 125% leaves 1.01, inside 1.05.
    expect(op(plan, 'page_zoom')).toMatchObject({ mode: 'auto', level: 1 });
    expect(plan.zoom).toBe(1.25);
    expect(op(plan, 'text_floor')).toBeUndefined();
    expect(traces.find((t) => t.op === 'text_floor')?.why).toBe(
      'not_applicable',
    );
  });

  it('auto-applies text changes only past k = 1.15', () => {
    // k = 21 / 17.5 = 1.2: 110% and a 1.09 residual, both automatic.
    const past = buildPlan(
      triaged(strongReaderProfile(), govukSignals({ bodyPx: 17.5 })),
    );
    expect(op(past, 'page_zoom')).toMatchObject({ mode: 'auto', level: 0 });
    expect(op(past, 'text_floor')?.mode).toBe('auto');
    expect(past.zoom).toBe(1.1);
    // k = 21 / 19 = 1.11 fits: no page scale, and the small gap is only offered.
    const fits = triaged(strongReaderProfile(), govukSignals());
    expect(fits.triage?.needs.text).toBe('fits');
    const plan = buildPlan(fits);
    expect(op(plan, 'page_zoom')).toBeUndefined();
    expect(op(plan, 'text_floor')?.mode).toBe('offer');
    expect(plan.zoom).toBe(1);
    // The same page without triage keeps v1's saved fit.
    expect(
      op(
        buildPlan(
          makeInput({
            profile: strongReaderProfile(),
            signals: govukSignals(),
          }),
        ),
        'text_floor',
      )?.mode,
    ).toBe('auto');
  });

  it('gives a page that fits nothing automatic: the saved target size waits for friction', () => {
    const signals = govukSignals(undefined, {
      targets: { below: { '44': 3, '56': 5, '72': 8 } },
    });
    const input = triaged(strongReaderProfile(), signals);
    expect(input.triage?.needs.targets).toBe('fits');
    const { plan, traces } = planWithTraces(input);
    expect(op(plan, 'target_size')).toBeUndefined();
    expect(traces.find((t) => t.op === 'target_size')?.why).toBe('page_fits');
    expect(
      decideOp('target_size', { ...input, friction: { target_size: 3 } })
        .planned?.mode,
    ).toBe('offer');
    expect(
      op(buildPlan({ ...input, triage: undefined }), 'target_size')?.trace.why,
    ).toBe('saved_fit');
  });

  it('keeps the person’s pins and site levels over a verdict of fits', () => {
    const pinned = buildPlan(
      triaged(strongReaderProfile(), govukSignals(), {
        patch: { site: site({ pins: ['text_floor'] }) },
      }),
    );
    expect(op(pinned, 'text_floor')).toMatchObject({ mode: 'auto', level: 3 });
    const level = buildPlan(
      triaged(strongReaderProfile(), govukSignals(), {
        patch: { site: site({ levels: { text_floor: 5 } }) },
      }),
    );
    expect(op(level, 'text_floor')).toMatchObject({ mode: 'auto', level: 5 });
  });

  it('lets a saved text size scale the page even where the need level alone would not', () => {
    // A measured 16 px floor is need level 0; on a 12 px page k = 1.33.
    const input = triaged(largeTargetProfile(56), govukSignals({ bodyPx: 12 }));
    expect(input.learning.ops.page_zoom.src).toBe('none');
    const plan = buildPlan(input);
    expect(op(plan, 'page_zoom')).toMatchObject({ mode: 'auto', level: 1 });
    expect(op(plan, 'page_zoom')?.trace.source).toBe('profile');
    // 125% leaves 1.07 for the text floor.
    expect(op(plan, 'text_floor')?.mode).toBe('auto');
    // Without a saved size nothing scales the page.
    const tier0 = tier0Profile();
    expect(
      op(buildPlan(triaged(tier0, govukSignals({ bodyPx: 12 }))), 'page_zoom'),
    ).toBeUndefined();
  });

  it('lets text floor take the whole gap when the page scale is undone or only offered', () => {
    const undone = undoOn(undefined, 'page_zoom');
    const after = planWithTraces(
      triaged(largeTextProfile(28), wikipediaSignals(), {
        domain: undone.domain,
      }),
    );
    expect(after.traces.find((t) => t.op === 'page_zoom')?.why).toBe(
      'undone_this_session',
    );
    expect(after.plan.zoom).toBe(1);
    expect(op(after.plan, 'text_floor')?.mode).toBe('auto');
    expect(op(after.plan, 'text_floor')?.trace.evidence).toEqual([
      { kind: 'small_text', share: 0.99, floorPx: 28, beforePx: 14 },
    ]);

    const demoted = emptyDomainState(FIXTURE_DAY);
    demoted.ops.page_zoom = { s: 0, f: 2, t: FIXTURE_DAY, demoted: true };
    const offered = planWithTraces(
      triaged(largeTextProfile(28), wikipediaSignals(), { domain: demoted }),
    );
    expect(offered.traces.find((t) => t.op === 'page_zoom')?.mode).not.toBe(
      'auto',
    );
    expect(offered.plan.zoom).toBe(1);
    expect(op(offered.plan, 'text_floor')?.trace.evidence).toContainEqual({
      kind: 'small_text',
      share: 0.99,
      floorPx: 28,
      beforePx: 14,
    });
  });

  it('compares target sizes at the CSS size that reaches the person’s size at the page scale', () => {
    const p = largeTextProfile(28);
    p.motor.minTargetPx = {
      value: 44,
      source: 'measured',
      confidence: 0.8,
      measured: 44,
    };
    const input = triaged(p, wikipediaSignals());
    // 44 px at 150% is 29.3 CSS px: between the 24 (50) and 32 (58) counts.
    expect(applicability('target_size', input).evidence).toEqual([
      { kind: 'target_failures', count: 56, targetPx: 44 },
    ]);
    expect(
      applicability('target_size', { ...input, triage: undefined }).evidence,
    ).toEqual([{ kind: 'target_failures', count: 61, targetPx: 44 }]);
  });

  it('counts the page scale when deciding whether a pinned bar takes too much of the screen', () => {
    const signals = wikipediaSignals(
      { occlusion: 0.17 },
      { sticky: { bars: 1, topBandPx: 140 } },
    );
    const input = triaged(largeTextProfile(28), signals);
    expect(zoomInEffect(input)).toBe(1.5);
    expect(applicability('unpin_bars', input)).toMatchObject({
      regions: ['k-nav'],
      evidence: [{ kind: 'sticky_bars', count: 1, heightPx: 140 }, {}],
    });
    expect(applicability('unpin_bars', { ...input, triage: undefined }).a).toBe(
      0,
    );
  });

  it('counts the page scale once for a page read with it already on (a repeat visit)', () => {
    // A 100 px band: 19% of an 800 px screen at 150%, under the 20% line.
    const first = wikipediaSignals(
      { occlusion: 0.17 },
      { sticky: { bars: 1, topBandPx: 100 } },
    );
    const input = triaged(largeTextProfile(28), first);
    expect(zoomInEffect(input)).toBe(1.5);
    expect(applicability('unpin_bars', input).a).toBe(0);
    // The same page read at 150%: the band is the same 100 CSS px in a
    // viewport of 533. Its share is the same, so the decision is too.
    const repeat = wikipediaSignals(
      { occlusion: 0.17 * 1.5 },
      {
        sticky: { bars: 1, topBandPx: 100 },
        viewport: { width: 853, height: 533, dpr: 3, zoom: 1 },
      },
    );
    const again = makeInput({
      profile: largeTextProfile(28),
      signals: repeat,
      patch: {
        triage: triageFor(largeTextProfile(28), repeat, { scale: 1.5 }),
        scale: 1.5,
      },
    });
    expect(zoomInEffect(again)).toBe(1.5);
    expect(applicability('unpin_bars', again).a).toBe(0);
    expect(
      applicability('unpin_bars', { ...again, scale: 1 }).a,
    ).toBeGreaterThan(0);
  });

  it('gates busy-page and pinned-bar ops only when layout features were measured', () => {
    const withLayout = triaged(focusProfile(), wikipediaSignals());
    expect(triageBand('dim_distractions', withLayout)).toBe('tailor');
    const old = triaged(focusProfile(), articleSignals());
    expect(old.triage?.needs.clutter).toBe('fits');
    expect(triageBand('dim_distractions', old)).toBeNull();
    expect(triageBand('unpin_bars', old)).toBeNull();
    expect(triageBand('line_spacing', withLayout)).toBeNull();
    // Without layout features: no page scale, text floor carries all of k (v1).
    const plan = buildPlan(old);
    expect(old.triage).toMatchObject({ zoom: 1, representable: false });
    expect(op(plan, 'page_zoom')).toBeUndefined();
    expect(op(plan, 'text_floor')?.trace.evidence).toEqual([
      { kind: 'small_text', share: 0.94, floorPx: 21, beforePx: 13 },
    ]);
  });

  it('takes page zoom’s level from triage, and the person’s site level over it', () => {
    const input = triaged(largeTextProfile(28), wikipediaSignals());
    expect(levelFor('page_zoom', input)).toBe(2);
    expect(
      levelFor('page_zoom', {
        ...input,
        site: site({ levels: { page_zoom: 1 } }),
      }),
    ).toBe(1);
    // The text floor's level is effective px: the same with or without a page scale.
    expect(levelFor('text_floor', input)).toBe(
      levelFor('text_floor', { ...input, triage: undefined }),
    );
  });

  it('keeps text floor’s residual past 1.05 at the scale in effect, for every persona and page', () => {
    for (const px of [16, 18, 21, 24, 28, 32, 36, 40]) {
      for (const signals of [govukSignals(), wikipediaSignals()]) {
        const input = triaged(largeTextProfile(px), signals);
        const plan = buildPlan(input);
        const floor = op(plan, 'text_floor');
        const scale = op(plan, 'page_zoom');
        expect(plan.zoom).toBe(scale?.mode === 'auto' ? input.triage!.zoom : 1);
        if (floor) {
          const running = px / input.triage!.k!;
          const levelPx = [14, 16, 18, 21, 24, 28, 32, 40, 48][floor.level]!;
          expect(levelPx / (running * plan.zoom!)).toBeGreaterThan(
            TEXT_RESIDUAL_MIN,
          );
        }
        if (input.triage!.needs.text === 'fits') {
          expect(scale).toBeUndefined();
          expect(floor?.mode).not.toBe('auto');
        }
      }
    }
  });
});
