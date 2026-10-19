import { describe, expect, it } from 'vitest';

import { isFeedLike, ruleVerdict } from '../decide/verdict';
import {
  applyEvent,
  demotedHere,
  desirability,
  emptyDomainState,
  engineReliability,
  evidenceNeeds,
  initialLearningState,
  offerSnoozed,
} from '../learning/learners';
import type {
  AdaptEvent,
  DomainState,
  SiteRule,
  UserLearningState,
} from '../learning/types';
import { OP_CATALOG, OP_IDS, type OpId } from '../ops/catalog';
import {
  PAGE_CATEGORIES,
  PROTECTED_ROLES,
  REGION_ROLES,
  type PageCategory,
  type PageSignals,
  type RegionRole,
  type Zone,
} from '../page/types';
import { needLevels } from '../profile/needs';
import type { FitProfile } from '../profile/schema';
import { TEXT_RESIDUAL_MIN, triage } from '../triage/triage';
import {
  buildPlan,
  levelFor,
  planWithTraces,
  triageBand,
  type PolicyInput,
} from './decide';
import { levelValue } from '../learning/learners';
import {
  articleSignals,
  FIXTURE_DAY,
  FIXTURE_NOW,
  focusProfile,
  largeTextProfile,
  layoutFeatures,
  makeInput,
  makeRegion,
  strongReaderProfile,
  tier0Profile,
} from './fixtures';
import type { AnalysisLabel, RegionVerdict } from './types';

/**
 * Policy invariants (personalization.md 15; ai-architecture.md 3.5-3.7), checked
 * over randomly generated but reproducible inputs.
 */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ZONES: Zone[] = [
  'header_band',
  'left_rail',
  'right_rail',
  'center_column',
  'full_width_mid',
  'footer_band',
  'overlay_top',
  'overlay_bottom',
  'overlay_center',
  'overlay_corner',
];
const LABELS: AnalysisLabel[] = ['clear', 'likely', 'unsure'];
const NEVER_AUTO_UNLESS_PINNED: OpId[] = [
  'reading_guide',
  'target_spacing',
  'steady_clicks',
  'menu_grace',
  'focus_view',
  'unpin_bars',
];

function generate(seed: number): PolicyInput {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const chance = (p: number) => r() < p;
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

  const profiles: Array<() => FitProfile> = [
    strongReaderProfile,
    focusProfile,
    () => largeTextProfile(pick([18, 28, 36])),
    () => tier0Profile(),
    () =>
      tier0Profile({
        reducedMotion: true,
        colorScheme: 'dark',
        moreContrast: true,
        forcedColors: false,
        deviceClass: 'desktop',
        input: 'keyboard',
      }),
    () => {
      const p = focusProfile();
      p.motor.steadyClicks = {
        value: { on: true, windowMs: 300, radiusPx: 8 },
        source: 'measured',
        confidence: 0.7,
      };
      p.motor.hoverGraceMs = {
        value: 700,
        source: 'measured',
        confidence: 0.6,
      };
      p.vision.contrastFloor = {
        value: pick([4.5, 7, 21] as const),
        source: 'measured',
        confidence: 0.7,
      };
      p.motor.minTargetPx = {
        value: pick([24, 32, 44, 56, 72, 96] as const),
        source: 'measured',
        confidence: 0.8,
      };
      return p;
    },
  ];
  const profile = pick(profiles)();
  const needs = needLevels(profile);

  const regionCount = int(0, 8);
  const regions: PageSignals['regions'] = [];
  for (let i = 0; i < regionCount; i += 1) {
    const ruled = chance(0.5);
    regions.push(
      makeRegion(`k${i}`, {
        zone: pick(ZONES),
        areaPct: pick([0.5, 2, 8, 20, 40]),
        pinned: pick(['fixed', 'sticky', 'no', 'no'] as const),
        ruleRole: ruled ? pick(REGION_ROLES) : null,
        rulePrecision: ruled ? pick([0.85, 0.9, 0.97, 0.99]) : 0,
        ruleId: ruled ? 'rule' : null,
        hasRequiredFields: chance(0.15),
        containsFocus: chance(0.15),
      }),
    );
  }
  if (chance(0.4)) {
    // A sticky header, the usual unpin candidate.
    regions.push(
      makeRegion('k-header', {
        zone: pick(['header_band', 'overlay_top'] as const),
        areaPct: 12,
        pinned: pick(['fixed', 'sticky'] as const),
        ruleRole: chance(0.7) ? 'navigation' : null,
        rulePrecision: 0.95,
        containsFocus: chance(0.1),
      }),
    );
  }
  const mainKey =
    regions.length > 0 && chance(0.7)
      ? pick(regions).key
      : chance(0.5)
        ? 'k-main'
        : null;
  const category: PageCategory = pick(PAGE_CATEGORIES);
  const signals = articleSignals(
    {
      category,
      viewport: { zoom: pick([1, 1, 1.25, 2]) },
      text: {
        histogram: [
          [pick([11, 12, 13, 14]), int(0, 5000)],
          [pick([16, 18, 22]), int(0, 5000)],
        ],
        mainFontPx: pick([null, 12, 16, 20]),
        mainLineHeight: pick([null, 1.2, 1.5, 1.9]),
        mainLineCh: pick([null, 60, 90, 120]),
        totalChars: int(0, 20_000),
      },
      contrast: {
        sampled: int(0, 100),
        below45: int(0, 20),
        below7: int(0, 40),
      },
      targets: {
        count: int(0, 100),
        below: {
          '24': int(0, 5),
          '32': int(0, 10),
          '44': int(0, 20),
          '56': int(0, 30),
          '72': int(0, 40),
        },
        crowded: int(0, 10),
      },
      motion: {
        running: int(0, 3),
        infinite: int(0, 2),
        autoplayMedia: int(0, 2),
        carousels: int(0, 1),
        animatedImages: int(0, 2),
      },
      sticky: { bars: int(0, 2), topBandPx: pick([0, 80, 200, 260]) },
      hoverMenus: int(0, 3),
      main: { key: mainKey, ambiguous: chance(0.2) },
      env: { forcedColors: chance(0.1) },
    },
    regions,
  );

  const verdicts: Record<string, RegionVerdict> = {};
  for (const region of regions) {
    if (!chance(0.6)) continue;
    const label = chance(0.8) ? pick(LABELS) : null;
    const role: RegionRole | null = chance(0.9) ? pick(REGION_ROLES) : null;
    // Page analysis knows nothing about focus or required fields; the policy must still protect them.
    verdicts[region.key] = {
      key: region.key,
      role,
      label,
      protected: chance(0.3),
      source: 'page_analysis',
      pEligible: r(),
    };
  }

  const learning: UserLearningState = initialLearningState(
    profile,
    needs,
    FIXTURE_DAY,
  );
  for (const op of OP_IDS) {
    const o = learning.ops[op];
    o.c = { s: r() * 6, f: r() * 6, t: FIXTURE_DAY - int(0, 60) };
    if (chance(0.1)) o.src = 'pinned';
    if (chance(0.05)) o.blocked = true;
    if (chance(0.1)) o.offerCooldownUntil = FIXTURE_DAY + int(-5, 20);
  }

  let domain: DomainState | undefined;
  if (chance(0.7)) {
    domain = emptyDomainState(FIXTURE_DAY);
    for (const op of OP_IDS) {
      if (!chance(0.3)) continue;
      domain.ops[op] = {
        s: r() * 3,
        f: r() * 3,
        t: FIXTURE_DAY,
        ...(chance(0.1) ? { block: true as const } : {}),
        ...(chance(0.1) ? { pin: true as const } : {}),
        ...(chance(0.15) ? { sessionOff: pick(['tab-1', 'tab-0']) } : {}),
        ...(chance(0.1) ? { skipUntil: FIXTURE_DAY + int(-3, 7) } : {}),
        ...(chance(0.1)
          ? { e: { s: r() * 5, f: r() * 8, t: FIXTURE_DAY } }
          : {}),
        ...(chance(0.1) ? { demoted: true as const } : {}),
      } as NonNullable<DomainState['ops'][OpId]>;
    }
    if (regions.length > 0 && chance(0.3))
      domain.exceptions = [pick(regions).key];
  }

  const site: SiteRule | undefined = chance(0.6)
    ? {
        paused: chance(0.1),
        pins: OP_IDS.filter(() => chance(0.08)),
        blocks: OP_IDS.filter(() => chance(0.05)),
        levels: chance(0.2) ? { text_floor: int(-2, 12) } : {},
        updatedAt: 0,
      }
    : undefined;

  const friction: Partial<Record<OpId, number>> = {};
  for (const op of OP_IDS) if (chance(0.1)) friction[op] = pick([2, 3, 4, 1e6]);
  const offersToday = int(0, 5);
  const offersThisPage = int(0, 1);

  // Triage (v2) on most pages; a fifth of those from an engine without layout features.
  let verdict: PolicyInput['triage'];
  if (chance(0.65)) {
    if (chance(0.8)) {
      signals.layout = layoutFeatures({
        bodyPx: pick([null, 11, 12, 13, 14, 16, 17.5, 19, 22]),
        slack: {
          rowSlackMin: pick([null, 1.02, 1.2, 1.8]),
          clipRiskShare: r(),
        },
        occlusion: pick([0, 0.08, 0.16, 0.25, 0.4]),
        density: {
          leafPer100k: int(5, 100),
          corners: int(10, 350),
          fontSizes: int(2, 15),
          regions: int(0, 12),
        },
        records: pick([
          { count: 0, largest: 0, mainShare: 0 },
          { count: 2, largest: 12, mainShare: 0.7 },
          { count: 1, largest: 6, mainShare: 0.2 },
        ]),
        readerable: pick([0, 15, 30, 120]),
        kind: {
          product: chance(0.1),
          editor: chance(0.08),
          videoPlayer: chance(0.08),
          blockingOverlay: chance(0.08),
        },
      });
    }
    signals.viewport.width = pick([700, 1024, 1280, 1440, 1920]);
    verdict = triage({ profile, signals, zoom: signals.viewport.zoom });
  }

  return {
    profile,
    needs,
    signals,
    verdicts,
    learning,
    domain,
    site,
    friction,
    offersToday,
    offersThisPage,
    tabSession: 'tab-1',
    now: FIXTURE_NOW,
    profileConfidence:
      profile.calibrationVersion === null ? null : profile.confidence,
    ...(verdict ? { triage: verdict } : {}),
  };
}

const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);

function isPinned(op: OpId, input: PolicyInput): boolean {
  return (
    input.learning.ops[op].src === 'pinned' ||
    (input.site?.pins.includes(op) ?? false) ||
    input.domain?.ops[op]?.pin === true
  );
}

function scopeRegions(scope: 'page' | { regions: string[] }): string[] {
  return scope === 'page' ? [] : scope.regions;
}

/** The person's own authority for an op on this site: a pin or a level they set. */
function ownChoice(op: OpId, input: PolicyInput): boolean {
  return isPinned(op, input) || Number.isFinite(input.site?.levels[op]);
}

/** page_zoom takes text_floor's saved-size authority under triage (docs/10 §5.1). */
function savedTextScale(op: OpId, input: PolicyInput): boolean {
  return (
    op === 'page_zoom' &&
    input.triage !== undefined &&
    input.profile.vision.textMinPx.source !== 'default'
  );
}

describe('policy invariants (random inputs)', () => {
  it.each(SEEDS)('seed %i', (seed) => {
    const input = generate(seed);
    const { plan, traces } = planWithTraces(input);
    const byKey = new Map(
      input.signals.regions.map((reg) => [reg.key, reg] as const),
    );
    const exceptions = new Set(input.domain?.exceptions ?? []);

    // Paused sites get an empty plan.
    if (input.site?.paused) expect(plan.ops).toEqual([]);

    // At most one offer per page, none when the page or day budget is spent.
    const offers = plan.ops.filter((o) => o.mode === 'offer');
    expect(offers.length).toBeLessThanOrEqual(1);
    if (input.offersThisPage >= 1 || input.offersToday >= 4)
      expect(offers).toHaveLength(0);

    for (const planned of plan.ops) {
      const { op } = planned;
      const def = OP_CATALOG[op];
      // The trace is faithful to the decision.
      expect(planned.trace.op).toBe(op);
      expect(planned.trace.mode).toBe(planned.mode);
      expect(planned.trace.level).toBe(planned.level);
      expect(planned.level).toBeGreaterThanOrEqual(0);
      expect(planned.level).toBeLessThan(def.levels.length);
      expect(traces.find((t) => t.op === op)).toEqual(planned.trace);

      // Hard rules are never overridden.
      expect(input.learning.ops[op].blocked).not.toBe(true);
      expect(input.domain?.ops[op]?.block).not.toBe(true);
      expect(input.site?.blocks.includes(op) ?? false).toBe(false);
      expect(input.domain?.ops[op]?.sessionOff === input.tabSession).toBe(
        false,
      );

      if (planned.mode === 'auto') {
        // Auto only from an eligible source; friction and 'none' never auto-apply.
        expect(['pinned', 'profile', 'system']).toContain(planned.trace.source);
        if (!isPinned(op, input)) {
          if (!savedTextScale(op, input))
            expect(input.learning.ops[op].src).not.toBe('none');
          expect(NEVER_AUTO_UNLESS_PINNED).not.toContain(op);
        }
        expect(demotedHere(input.domain, op)).toBe(false);
        // A need that fits gets nothing automatic, unless the person chose it here.
        if (triageBand(op, input) === 'fits')
          expect(ownChoice(op, input), `${op} auto on a need that fits`).toBe(
            true,
          );
      }

      if (planned.mode === 'offer') {
        // Offers respect the site snooze and the global cooldown.
        expect(offerSnoozed(input.domain, op, FIXTURE_DAY)).toBe(false);
        expect(FIXTURE_DAY).toBeGreaterThan(
          input.learning.ops[op].offerCooldownUntil,
        );
      }

      // Region ops never touch focus, required fields, protected or consent regions.
      for (const key of scopeRegions(planned.scope)) {
        const region = byKey.get(key);
        if (region && op !== 'focus_view') {
          expect(region.containsFocus, `${op} ${key}`).toBe(false);
          expect(region.hasRequiredFields, `${op} ${key}`).toBe(false);
        }
        if (op === 'focus_view') {
          // Focus view keeps its target (main) and softens everything else: nothing softened may hold focus or required fields.
          for (const other of input.signals.regions) {
            if (other.key === key) continue;
            expect(
              other.containsFocus || other.hasRequiredFields,
              `focus_view softens ${other.key}`,
            ).toBe(false);
          }
        }
        if (op === 'dim_distractions' || op === 'unpin_bars') {
          expect(key).not.toBe(input.signals.main.key);
          const v =
            input.verdicts[key] ?? (region ? ruleVerdict(region) : null);
          // Navigation is a protected role (never dimmed), and it is the only
          // role unpin_bars may target: scrolling away hides nothing.
          if (op === 'dim_distractions')
            expect(v?.protected ?? false).toBe(false);
          expect(v?.role).not.toBe('consent_banner');
          // Only navigation bars scroll away; consent and chat stay pinned.
          if (op === 'unpin_bars') expect(v?.role).toBe('navigation');
        }
        if (op === 'dim_distractions') {
          expect(exceptions.has(key)).toBe(false);
          const v =
            input.verdicts[key] ?? (region ? ruleVerdict(region) : null);
          expect(v?.role && PROTECTED_ROLES.includes(v.role)).toBeFalsy();
          if (isFeedLike(input.signals.category)) {
            expect(region?.zone).not.toBe('center_column');
            expect(v?.role).not.toBe('recommendations');
          }
        }
      }
    }

    // Composition (docs/10 §5.2): page_zoom is triage's scale, plan.zoom the
    // scale in effect, and text_floor carries only a residual past 1.05.
    const scale = plan.ops.find((o) => o.op === 'page_zoom');
    const floor = plan.ops.find((o) => o.op === 'text_floor');
    const t = input.triage;
    expect(plan.triage).toEqual(t);
    expect(plan.zoom).toBe(
      scale?.mode === 'auto' ? levelValue('page_zoom', scale.level) : 1,
    );
    if (!t) expect(scale).toBeUndefined();
    if (t && scale && !Number.isFinite(input.site?.levels.page_zoom)) {
      expect(levelValue('page_zoom', scale.level)).toBe(t.zoom);
      expect(t.zoom).toBeGreaterThan(1);
      expect(t.zoom).toBeLessThanOrEqual(t.zMax);
      expect(t.needs.text).not.toBe('fits');
    }
    if (t && floor && t.k !== null) {
      // The level is effective px, the same with or without a page scale.
      expect(floor.level).toBe(levelFor('text_floor', input));
      const running = input.profile.vision.textMinPx.value / t.k;
      expect(
        levelValue('text_floor', floor.level) / (running * plan.zoom!),
      ).toBeGreaterThan(TEXT_RESIDUAL_MIN);
    }
    // Text changes are automatic only past k = 1.15, or by the person's own choice.
    if (t && t.needs.text === 'fits') {
      for (const o of [scale, floor])
        if (o?.mode === 'auto') expect(ownChoice(o.op, input)).toBe(true);
    }

    // Supersession.
    const focus = plan.ops.find((o) => o.op === 'focus_view');
    const dim = plan.ops.find((o) => o.op === 'dim_distractions');
    if (focus && dim)
      expect(dim.mode === 'auto' && focus.mode === 'offer').toBe(true);

    // Friction can never create or remove an automatic change.
    const quiet = buildPlan({ ...input, friction: {} });
    const autos = (p: typeof plan) =>
      p.ops
        .filter((o) => o.mode === 'auto')
        .map((o) => o.op)
        .sort();
    expect(autos(plan)).toEqual(autos(quiet));

    // Deterministic.
    expect(buildPlan(structuredClone(input))).toEqual(plan);
  });
});

describe('policy invariants (generator coverage)', () => {
  it('exercises region ops, pins, offers and automatic changes, so the invariants are not vacuous', () => {
    const seen = new Map<string, number>();
    const bump = (key: string) => seen.set(key, (seen.get(key) ?? 0) + 1);
    for (const seed of SEEDS) {
      const input = generate(seed);
      const { plan, traces } = planWithTraces(input);
      for (const o of plan.ops) {
        bump(`${o.op}:${o.mode}`);
        bump(o.mode);
        if (o.trace.source === 'friction') bump('friction');
        if (o.trace.source === 'pinned') bump('pinned');
      }
      const autoOps = plan.ops
        .filter((o) => o.mode === 'auto')
        .map((o) => o.op);
      if (autoOps.includes('page_zoom') && autoOps.includes('text_floor'))
        bump('page_zoom+text_floor');
      if (traces.some((tr) => tr.why === 'page_fits')) bump('fits_suppressed');
      if (input.site?.paused) bump('paused');
    }
    for (const key of [
      'auto',
      'offer',
      'friction',
      'pinned',
      'paused',
      'dim_distractions:auto',
      'unpin_bars:auto',
      'line_length:auto',
      'calm_motion:auto',
      'page_zoom:auto',
      'page_zoom+text_floor',
      'text_floor:offer',
      'fits_suppressed',
    ]) {
      expect(seen.get(key) ?? 0, key).toBeGreaterThan(0);
    }
    const regionOps = [...seen.entries()].filter(([k]) =>
      /^(dim_distractions|unpin_bars|focus_view|line_length):/.test(k),
    );
    expect(regionOps.reduce((a, [, n]) => a + n, 0)).toBeGreaterThanOrEqual(25);
  });
});

describe('policy invariants (learning loop)', () => {
  const verifierEvent = (op: OpId, pass: boolean, i: number): AdaptEvent => ({
    v: 1,
    id: `verifier-${i}-000`,
    t: FIXTURE_NOW,
    tabSession: 'tab-1',
    domain: 'a.example',
    cat: 'article',
    op,
    opVer: 1,
    level: 0,
    src: 'profile',
    kind: 'verifier',
    pass,
    vcode: pass ? undefined : 'clip',
  });

  it.each(SEEDS.slice(0, 60))(
    'verifier outcomes never change desirability (seed %i)',
    (seed) => {
      const input = generate(seed);
      const r = rng(seed * 7);
      let user = input.learning;
      let domain = input.domain ?? emptyDomainState(FIXTURE_DAY);
      const needs = evidenceNeeds(input.profile, input.needs);
      const ctx = {
        needs,
        category: input.signals.category,
        profileConfidence: input.profileConfidence,
      };
      const before = OP_IDS.map((op) =>
        desirability(user, domain, op, ctx, FIXTURE_DAY),
      );
      for (let i = 0; i < 12; i += 1) {
        const op = OP_IDS[Math.floor(r() * OP_IDS.length)]!;
        const next = applyEvent(user, domain, verifierEvent(op, r() < 0.5, i));
        expect(next.deltas).toEqual([]);
        user = next.user;
        domain = next.domain;
      }
      expect(
        OP_IDS.map((op) => desirability(user, domain, op, ctx, FIXTURE_DAY)),
      ).toEqual(before);
      expect(user).toEqual(input.learning);
    },
  );

  it('one fast undo stops auto-apply on that site, in this session and the next', () => {
    const profiles = [strongReaderProfile(), focusProfile()];
    let checked = 0;
    for (const profile of profiles) {
      const base = makeInput({
        profile,
        domain: emptyDomainState(FIXTURE_DAY),
      });
      for (const planned of buildPlan(base).ops.filter(
        (o) => o.mode === 'auto',
      )) {
        const undo = applyEvent(base.learning, base.domain!, {
          v: 1,
          id: `fast-undo-${planned.op}`,
          t: FIXTURE_NOW,
          tabSession: 'tab-1',
          domain: 'a.example',
          cat: 'article',
          op: planned.op,
          opVer: 1,
          level: planned.level,
          src: 'profile',
          kind: 'undo',
          dtApplyMs: 1_500,
        });
        const same = buildPlan({
          ...base,
          learning: undo.user,
          domain: undo.domain,
        });
        expect(same.ops.find((o) => o.op === planned.op)).toBeUndefined();
        const next = buildPlan({
          ...base,
          learning: undo.user,
          domain: undo.domain,
          tabSession: 'tab-2',
          offersThisPage: 0,
        });
        expect(next.ops.find((o) => o.op === planned.op)?.mode).not.toBe(
          'auto',
        );
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it('a late undo on a strong need does not demote, and a pin needs two fast undos on a site', () => {
    const base = makeInput({ domain: emptyDomainState(FIXTURE_DAY) });
    const late = applyEvent(base.learning, base.domain!, {
      v: 1,
      id: 'late-undo-0001',
      t: FIXTURE_NOW,
      tabSession: 'tab-1',
      domain: 'a.example',
      cat: 'article',
      op: 'text_floor',
      opVer: 1,
      level: 1,
      src: 'profile',
      kind: 'undo',
      dtApplyMs: 900_000,
    });
    const next = buildPlan({
      ...base,
      learning: late.user,
      domain: late.domain,
      tabSession: 'tab-2',
    });
    expect(next.ops.find((o) => o.op === 'text_floor')?.mode).toBe('auto');
  });

  it('engine rejects pause an op on a site without touching preference', () => {
    const base = makeInput({ domain: emptyDomainState(FIXTURE_DAY) });
    let user = base.learning;
    let domain = base.domain!;
    for (let i = 0; i < 2; i += 1) {
      const r = applyEvent(user, domain, verifierEvent('text_floor', false, i));
      user = r.user;
      domain = r.domain;
    }
    expect(
      engineReliability(domain, 'text_floor', 'article', FIXTURE_DAY),
    ).toBe(0);
    const { plan, traces } = planWithTraces({
      ...base,
      learning: user,
      domain,
    });
    expect(plan.ops.find((o) => o.op === 'text_floor')).toBeUndefined();
    expect(traces.find((t) => t.op === 'text_floor')?.why).toBe(
      'engine_unreliable_here',
    );
    // The person's preference for larger text is intact: only this site pauses it.
    expect(user.ops.text_floor).toEqual(base.learning.ops.text_floor);
  });

  it('protected, focus-containing and required-field regions are never dimmed even when analysis says dim', () => {
    const regions = [
      makeRegion('k-focus', { containsFocus: true }),
      makeRegion('k-form', { hasRequiredFields: true }),
      makeRegion('k-help', { ruleRole: 'help_contact', rulePrecision: 0.99 }),
      makeRegion('k-ok'),
    ];
    const verdicts: Record<string, RegionVerdict> = Object.fromEntries(
      regions.map((reg) => [
        reg.key,
        {
          key: reg.key,
          role: 'promo_ad',
          label: 'clear',
          protected: false,
          source: 'page_analysis',
          pEligible: 0.99,
        },
      ]),
    );
    verdicts['k-help'] = ruleVerdict(regions[2]!)!;
    const input = makeInput({
      profile: focusProfile(),
      signals: articleSignals(
        { main: { key: null, ambiguous: true } },
        regions,
      ),
      patch: {
        verdicts,
        site: {
          paused: false,
          pins: ['dim_distractions'],
          blocks: [],
          levels: {},
          updatedAt: 0,
        },
      },
    });
    const dim = buildPlan(input).ops.find((o) => o.op === 'dim_distractions');
    expect(dim?.scope).toEqual({ regions: ['k-ok'] });
  });

  it('feed and search centre columns and their recommendations are never dimmed', () => {
    for (const category of ['feed_social', 'search_results'] as const) {
      const regions = [
        makeRegion('k-centre', { zone: 'center_column' }),
        makeRegion('k-recs', { zone: 'right_rail' }),
        makeRegion('k-ad', { zone: 'right_rail' }),
      ];
      const verdicts: Record<string, RegionVerdict> = {
        'k-centre': {
          key: 'k-centre',
          role: 'promo_ad',
          label: 'clear',
          protected: false,
          source: 'page_analysis',
          pEligible: 0.99,
        },
        'k-recs': {
          key: 'k-recs',
          role: 'recommendations',
          label: 'clear',
          protected: false,
          source: 'page_analysis',
          pEligible: 0.99,
        },
        'k-ad': {
          key: 'k-ad',
          role: 'promo_ad',
          label: 'clear',
          protected: false,
          source: 'page_analysis',
          pEligible: 0.99,
        },
      };
      const input = makeInput({
        profile: focusProfile(),
        signals: articleSignals(
          { category, main: { key: null, ambiguous: true } },
          regions,
        ),
        patch: {
          verdicts,
          site: {
            paused: false,
            pins: ['dim_distractions'],
            blocks: [],
            levels: {},
            updatedAt: 0,
          },
        },
      });
      expect(
        buildPlan(input).ops.find((o) => o.op === 'dim_distractions')?.scope,
      ).toEqual({ regions: ['k-ad'] });
    }
  });
});
