import { describe, expect, it } from 'vitest';

import { DIM_IDS, OP_CATALOG, OP_IDS, type OpId } from '../ops/catalog';
import { PAGE_CATEGORIES } from '../page/types';
import { defaultFitProfile } from '../profile/defaults';
import { needLevels } from '../profile/needs';
import type { NeedLevels } from '../profile/schema';
import {
  FIXTURE_DAY,
  FIXTURE_NOW,
  strongReaderProfile,
  tier0Profile,
} from '../policy/fixtures';
import { labelTableMeans } from './labels';
import {
  applyEvent,
  chooseLevel,
  decay,
  demotedHere,
  desirability,
  dimensionEstimate,
  emptyDomainState,
  engineReliability,
  engineSkipped,
  evidenceNeeds,
  initialLearningState,
  pinnedDesirability,
  priorFor,
  profileSource,
  promotionDue,
  reseedFromProfile,
  toDay,
  undoWeight,
  type DesirabilityContext,
} from './learners';
import { kalmanPoint, probitUpdate } from './math';
import { K, W } from './params';
import { BASE_PRIOR, ENGINE_PRIOR, PIN_THETA, PRIOR_TABLE } from './priors';
import {
  learnDeltaSchema,
  type AdaptEvent,
  type DomainState,
  type UserLearningState,
} from './types';

const DAY_MS = 86_400_000;
let counter = 0;

function event(
  kind: AdaptEvent['kind'],
  patch: Partial<AdaptEvent> = {},
): AdaptEvent {
  counter += 1;
  return {
    v: 1,
    id: `evt-${String(counter).padStart(6, '0')}`,
    t: FIXTURE_NOW,
    tabSession: 'tab-1',
    domain: 'news.example.com',
    cat: 'article',
    op: 'text_floor',
    opVer: 1,
    level: 3,
    src: 'profile',
    kind,
    ...patch,
  };
}

function fresh(): { u: UserLearningState; d: DomainState; needs: NeedLevels } {
  const profile = strongReaderProfile();
  const needs = needLevels(profile);
  return {
    u: initialLearningState(profile, needs, FIXTURE_DAY),
    d: emptyDomainState(FIXTURE_DAY),
    needs,
  };
}

/** Beta(8.5, 1.5): the "strong need, full confidence" prior used in personalization.md 5.2. */
const STRONG: DesirabilityContext = {
  needs: {
    text: 2,
    contrast: 0,
    spacing: 0,
    lineLength: 0,
    targets: 0,
    clicks: 0,
    motion: 0,
    distraction: 0,
  },
  category: 'article',
  profileConfidence: 1,
};

function run(u: UserLearningState, d: DomainState, events: AdaptEvent[]) {
  let state = {
    user: u,
    domain: d,
    deltas: [] as ReturnType<typeof applyEvent>['deltas'],
  };
  for (const e of events) {
    const next = applyEvent(state.user, state.domain, e);
    state = {
      user: next.user,
      domain: next.domain,
      deltas: [...state.deltas, ...next.deltas],
    };
  }
  return state;
}

describe('decay and days', () => {
  it('halves counts every 90 days and never inflates from the future', () => {
    expect(decay({ s: 2, f: 4, t: 0 }, 90)).toEqual({ s: 1, f: 2, t: 90 });
    expect(decay({ s: 2, f: 4, t: 10 }, 5)).toEqual({ s: 2, f: 4, t: 10 });
    expect(decay({ s: 1, f: 0, t: 0 }, 0)).toEqual({ s: 1, f: 0, t: 0 });
    expect(toDay(FIXTURE_NOW)).toBe(Math.floor(FIXTURE_NOW / DAY_MS));
  });
});

describe('prior tables', () => {
  it('has every cell in (0, 1), monotone in need, for every op and category', () => {
    for (const op of OP_IDS) {
      for (const cat of PAGE_CATEGORIES) {
        const row = [0, 1, 2].map((n) => PRIOR_TABLE[op][n as 0 | 1 | 2][cat]);
        for (const p of row) expect(p > 0 && p < 1).toBe(true);
        expect(row[0]!).toBeLessThanOrEqual(row[1]!);
        expect(row[1]!).toBeLessThanOrEqual(row[2]!);
      }
      expect(PRIOR_TABLE[op][0].other).toBe(BASE_PRIOR[op][0]);
    }
  });

  it('keeps every engine prior above the reliability gate', () => {
    for (const op of OP_IDS) {
      for (const cat of PAGE_CATEGORIES) {
        const { a, b } = ENGINE_PRIOR[op][cat];
        expect(a + b).toBeCloseTo(20, 6);
        expect(a / (a + b)).toBeGreaterThan(K.P_OK_MIN);
      }
    }
    expect(ENGINE_PRIOR.contrast.article.a / 20).toBeCloseTo(0.95);
    expect(ENGINE_PRIOR.text_floor.web_app.a / 20).toBeCloseTo(0.7);
  });

  it('uses m0 = 4 + 6c, or 2 when uncalibrated', () => {
    expect(priorFor('text_floor', STRONG)).toEqual({
      a0: expect.closeTo(8.5, 9),
      b0: expect.closeTo(1.5, 9),
    });
    const t0 = priorFor('text_floor', { ...STRONG, profileConfidence: null });
    expect(t0.a0 + t0.b0).toBeCloseTo(2, 9);
  });
});

describe('initialLearningState', () => {
  it('sources ops from evidence-backed need levels', () => {
    const { u } = fresh();
    const src = (op: OpId) => u.ops[op].src;
    expect(src('text_floor')).toBe('profile');
    expect(src('page_zoom')).toBe('profile');
    expect(src('target_size')).toBe('profile');
    expect(src('line_spacing')).toBe('profile');
    expect(src('contrast')).toBe('none');
    expect(src('calm_motion')).toBe('none');
    expect(src('steady_clicks')).toBe('none');
    expect(src('dim_distractions')).toBe('none');
    expect(u.libVer).toBe('ops-1.0.0');
    expect(u.labels).toEqual({});
  });

  it('keeps an uncalibrated profile on population priors, except for OS settings', () => {
    const plain = tier0Profile();
    // A flat prior that nothing has informed carries no need.
    expect(needLevels(plain).motion).toBe(0);
    expect(evidenceNeeds(plain, needLevels(plain)).motion).toBe(0);
    const u = initialLearningState(plain, needLevels(plain), FIXTURE_DAY);
    for (const op of OP_IDS) expect(u.ops[op].src).toBe('none');

    const reduced = tier0Profile({
      reducedMotion: true,
      colorScheme: 'light',
      moreContrast: true,
      forcedColors: false,
      deviceClass: 'laptop',
      input: 'mouse',
    });
    const r = initialLearningState(reduced, needLevels(reduced), FIXTURE_DAY);
    expect(r.ops.calm_motion.src).toBe('system');
    expect(r.ops.pause_media.src).toBe('system');
    expect(r.ops.contrast.src).toBe('system');
    expect(r.ops.text_floor.src).toBe('none');
  });

  it('needs the steady-clicks setting on for steady_clicks and a hover grace for menu_grace', () => {
    const p = strongReaderProfile();
    p.motor.steadyClicks = {
      value: { on: true, windowMs: 300, radiusPx: 8 },
      source: 'measured',
      confidence: 0.7,
    };
    p.motor.hoverGraceMs = { value: 400, source: 'measured', confidence: 0.6 };
    expect(profileSource('steady_clicks', p, needLevels(p))).toBe('profile');
    expect(profileSource('menu_grace', p, needLevels(p))).toBe('profile');
  });

  it('centres Learner B on profile values with spread from confidence and a text floor', () => {
    const profile = strongReaderProfile();
    const u = initialLearningState(profile, needLevels(profile), FIXTURE_DAY);
    expect(dimensionEstimate(u, 'textPx').value).toBeCloseTo(21, 9);
    expect(dimensionEstimate(u, 'targetPx').value).toBeCloseTo(44, 9);
    expect(dimensionEstimate(u, 'lineCh').value).toBeCloseTo(70, 9);
    expect(u.dims.textPx.floor).toBeCloseTo(Math.log(21), 9);
    expect(u.dims.lineCh.floor).toBeUndefined();
    expect(u.dims.textPx.v).toBeCloseTo(u.dims.textPx.vCal + 0.01, 12);

    const unsure = strongReaderProfile();
    unsure.vision.textMinPx = { ...unsure.vision.textMinPx, confidence: 0.1 };
    const w = initialLearningState(unsure, needLevels(unsure), FIXTURE_DAY);
    expect(w.dims.textPx.vCal).toBeGreaterThan(u.dims.textPx.vCal);
    for (const dim of DIM_IDS)
      expect(Number.isFinite(u.dims[dim].m)).toBe(true);
  });
});

describe('Learner A: desirability', () => {
  it('reproduces the demotion arithmetic of personalization.md 5.2', () => {
    const u = initialLearningState(
      strongReaderProfile(),
      needLevels(strongReaderProfile()),
      FIXTURE_DAY,
    );
    const d = emptyDomainState(FIXTURE_DAY);
    expect(
      desirability(u, d, 'text_floor', STRONG, FIXTURE_DAY).mean,
    ).toBeCloseTo(0.85, 9);

    const fast = run(u, d, [event('undo', { dtApplyMs: 2_000 })]);
    const one = desirability(
      fast.user,
      fast.domain,
      'text_floor',
      STRONG,
      FIXTURE_DAY,
    );
    expect(one.mean).toBeCloseTo(0.68, 9); // one fast undo demotes on the site
    expect(one.personal).toBeCloseTo(8.5 / 11, 9);

    const medium = run(u, d, [event('undo', { dtApplyMs: 60_000 })]);
    expect(
      desirability(
        medium.user,
        medium.domain,
        'text_floor',
        STRONG,
        FIXTURE_DAY,
      ).mean,
    ).toBeCloseTo(0.7556, 3);

    // Three fast undos on three different sites: personal 0.773 -> 0.708 -> 0.654.
    let user = u;
    const personal: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      user = applyEvent(
        user,
        emptyDomainState(FIXTURE_DAY),
        event('undo', { dtApplyMs: 1_000, domain: `site${i}.example` }),
      ).user;
      personal.push(
        desirability(user, undefined, 'text_floor', STRONG, FIXTURE_DAY)
          .personal,
      );
    }
    expect(personal.map((p) => Math.round(p * 1000) / 1000)).toEqual([
      0.773, 0.708, 0.654,
    ]);
  });

  it('shrinks a site toward the leave-one-out personal mean (kappa = 4)', () => {
    const { u, d } = fresh();
    const s = run(u, d, [
      event('rating', { rating: 'helped' }),
      event('rating', { rating: 'helped' }),
    ]);
    const r = desirability(s.user, s.domain, 'text_floor', STRONG, FIXTURE_DAY);
    // Domain has S = 2; the LOO personal mean excludes it, so pL = 0.85.
    expect(r.mean).toBeCloseTo((4 * 0.85 + 2) / (4 + 2), 9);
    expect(r.personal).toBeCloseTo((8.5 + 2) / (10 + 2), 9);
  });

  it('keeps pinned ops on until the site itself pushes back twice', () => {
    const { u, d } = fresh();
    expect(pinnedDesirability(d, 'text_floor', FIXTURE_DAY)).toBe(PIN_THETA);
    const once = run(u, d, [event('undo', { dtApplyMs: 1_000 })]);
    expect(
      pinnedDesirability(once.domain, 'text_floor', FIXTURE_DAY),
    ).toBeCloseTo(3.8 / 5, 9);
    const twice = run(once.user, once.domain, [
      event('undo', { dtApplyMs: 1_000, tabSession: 'tab-2' }),
    ]);
    expect(
      pinnedDesirability(twice.domain, 'text_floor', FIXTURE_DAY),
    ).toBeLessThan(0.7);
  });
});

describe('engine channel', () => {
  it('starts at the prior and falls with rejects', () => {
    const { u, d } = fresh();
    expect(
      engineReliability(d, 'text_floor', 'article', FIXTURE_DAY),
    ).toBeCloseTo(0.85, 9);
    const s = run(u, d, [event('verifier', { pass: false, vcode: 'clip' })]);
    expect(
      engineReliability(s.domain, 'text_floor', 'article', FIXTURE_DAY),
    ).toBeCloseTo(17 / 21, 9);
    expect(engineSkipped(s.domain, 'text_floor', FIXTURE_DAY)).toBe(false);
  });

  it('pauses an op on a site for 7 days after 2 rejects within 7 days', () => {
    const { u, d } = fresh();
    const s = run(u, d, [
      event('verifier', { pass: false, vcode: 'clip' }),
      event('verifier', {
        pass: false,
        vcode: 'overlap',
        t: FIXTURE_NOW + 3 * DAY_MS,
      }),
    ]);
    expect(
      engineReliability(s.domain, 'text_floor', 'article', FIXTURE_DAY + 3),
    ).toBe(0);
    expect(
      engineReliability(s.domain, 'text_floor', 'article', FIXTURE_DAY + 10),
    ).toBe(0);
    expect(
      engineReliability(s.domain, 'text_floor', 'article', FIXTURE_DAY + 11),
    ).toBeGreaterThan(0.5);
    expect(engineSkipped(s.domain, 'text_floor', FIXTURE_DAY + 5)).toBe(true);

    const apart = run(u, d, [
      event('verifier', { pass: false }),
      event('verifier', { pass: false, t: FIXTURE_NOW + 8 * DAY_MS }),
    ]);
    expect(
      engineReliability(apart.domain, 'text_floor', 'article', FIXTURE_DAY + 8),
    ).toBeGreaterThan(0.5);
  });

  it('counts at most one pass per op, site and day', () => {
    const { u, d } = fresh();
    const s = run(u, d, [
      event('verifier', { pass: true }),
      event('verifier', { pass: true }),
      event('verifier', { pass: true, t: FIXTURE_NOW + DAY_MS }),
    ]);
    const e = s.domain.ops.text_floor!.e!;
    expect(decay(e, FIXTURE_DAY + 1).s).toBeCloseTo(
      1 * Math.pow(2, -1 / 90) + 1,
      9,
    );
  });

  it('never touches preference, labels or sync', () => {
    const { u, d } = fresh();
    const s = run(u, d, [
      event('verifier', {
        pass: false,
        vcode: 'clip',
        aiLabel: 'clear',
        op: 'dim_distractions',
      }),
      event('verifier', { pass: true, op: 'dim_distractions' }),
    ]);
    expect(s.user).toEqual(u);
    expect(s.deltas).toEqual([]);
    expect(
      desirability(s.user, s.domain, 'dim_distractions', STRONG, FIXTURE_DAY),
    ).toEqual(desirability(u, d, 'dim_distractions', STRONG, FIXTURE_DAY));
  });
});

describe('applyEvent routing', () => {
  it('weights undos by timing and suppresses reapplication this session', () => {
    expect([
      undoWeight(2_000),
      undoWeight(60_000),
      undoWeight(600_000),
      undoWeight(undefined),
    ]).toEqual([W.undoFast, W.undoMed, W.undoLate, W.undoMed]);
    const { u, d } = fresh();
    const s = run(u, d, [event('undo', { dtApplyMs: 400_000 })]);
    expect(s.user.ops.text_floor.c.f).toBeCloseTo(0.3, 9);
    expect(s.domain.ops.text_floor!.sessionOff).toBe('tab-1');
    expect(demotedHere(s.domain, 'text_floor')).toBe(false);
    const fast = run(u, d, [event('undo', { dtApplyMs: 1_000 })]);
    expect(demotedHere(fast.domain, 'text_floor')).toBe(true);
    expect(fast.deltas).toEqual([
      expect.objectContaining({ op: 'text_floor', df: 1, day: FIXTURE_DAY }),
    ]);
  });

  it('splits a fast undo of a page-analysis target between preference and the label table', () => {
    const { u, d } = fresh();
    const s = run(u, d, [
      event('undo', {
        op: 'dim_distractions',
        dtApplyMs: 3_000,
        aiLabel: 'clear',
        componentKey: 'k1',
      }),
    ]);
    expect(s.user.ops.dim_distractions.c.f).toBeCloseTo(0.5, 9);
    expect(s.user.labels.dim_distractions!.clear.f).toBeCloseTo(0.5, 9);
  });

  it('routes undo chips: needed_that -> label table and a component exception, not preference', () => {
    const { u, d } = fresh();
    const s = run(u, d, [
      event('undo', {
        op: 'dim_distractions',
        dtApplyMs: 3_000,
        aiLabel: 'likely',
        componentKey: 'k-rail',
      }),
      event('undo_reason', {
        op: 'dim_distractions',
        dtApplyMs: 3_000,
        aiLabel: 'likely',
        componentKey: 'k-rail',
        reason: 'needed_that',
      }),
    ]);
    expect(s.user.ops.dim_distractions.c.f).toBeCloseTo(0, 9);
    expect(s.user.labels.dim_distractions!.likely.f).toBeCloseTo(1, 9);
    expect(s.domain.exceptions).toEqual(['k-rail']);
    expect(demotedHere(s.domain, 'dim_distractions')).toBe(false);
  });

  it('routes undo chips: broke_page -> engine only', () => {
    const { u, d } = fresh();
    const s = run(u, d, [
      event('undo', { dtApplyMs: 3_000, reason: 'broke_page' }),
    ]);
    expect(s.user.ops.text_floor.c).toEqual(u.ops.text_floor.c);
    expect(s.domain.ops.text_floor!.e!.f).toBe(1);
    expect(s.deltas).toEqual([]);
    const later = run(u, d, [
      event('undo', { dtApplyMs: 3_000 }),
      event('undo_reason', { dtApplyMs: 3_000, reason: 'broke_page' }),
    ]);
    expect(later.user.ops.text_floor.c.f).toBeCloseTo(0, 9);
    expect(later.domain.ops.text_floor!.e!.f).toBe(1);
  });

  it('routes undo chips: too_much -> Learner B only, in the right direction', () => {
    const { u, d } = fresh();
    const s = run(u, d, [
      event('undo', { dtApplyMs: 3_000, level: 3, reason: 'too_much' }),
    ]);
    expect(s.user.ops.text_floor.c.f).toBe(0);
    expect(dimensionEstimate(s.user, 'textPx').value).toBeLessThan(21);
    expect(s.deltas).toEqual([
      expect.objectContaining({
        dim: 'textPx',
        obs: expect.objectContaining({ kind: 'lt' }),
      }),
    ]);
    // For line length a shorter line is stronger: "too much" means the person wants longer lines.
    const l = run(u, d, [
      event('undo', {
        op: 'line_length',
        dtApplyMs: 3_000,
        level: 2,
        reason: 'too_much',
      }),
    ]);
    expect(dimensionEstimate(l.user, 'lineCh').value).toBeGreaterThan(70);
  });

  it('routes undo chips: dont_want -> preference F totals 1.0 and demotes the site', () => {
    const { u, d } = fresh();
    const s = run(u, d, [
      event('undo', { dtApplyMs: 60_000 }),
      event('undo_reason', { dtApplyMs: 60_000, reason: 'dont_want' }),
    ]);
    expect(s.user.ops.text_floor.c.f).toBeCloseTo(1, 9);
    expect(demotedHere(s.domain, 'text_floor')).toBe(true);
    expect(s.deltas.map((x) => x.df)).toEqual([0.5, 0.5]);
  });

  it('credits accepts at session end, silence once per site and day, and manual enables', () => {
    const { u, d } = fresh();
    const s = run(u, d, [
      event('offer_accepted', { op: 'target_size' }),
      event('session_end', {
        op: 'target_size',
        acceptedThisSession: true,
        kept: true,
        keptMs: 200_000,
      }),
      event('session_end', {
        op: 'text_floor',
        autoApplied: true,
        kept: true,
        visibleEffect: true,
        keptMs: 90_000,
      }),
      event('session_end', {
        op: 'text_floor',
        autoApplied: true,
        kept: true,
        visibleEffect: true,
        keptMs: 90_000,
      }),
      event('manual_on', { op: 'reading_guide' }),
    ]);
    expect(s.user.ops.target_size.accepts).toBe(1);
    expect(s.user.ops.target_size.c.s).toBeCloseTo(W.acceptKept, 9);
    expect(s.user.ops.text_floor.c.s).toBeCloseTo(W.silence, 9);
    expect(s.user.ops.reading_guide.c.s).toBe(W.manualOn);
    const invisible = run(u, d, [
      event('session_end', {
        autoApplied: true,
        kept: true,
        visibleEffect: false,
      }),
    ]);
    expect(invisible.user.ops.text_floor.c.s).toBe(0);
  });

  it('applies dismissal cooldowns: 7 days on the site, 30 days everywhere after 3 in a row', () => {
    const { u, d } = fresh();
    const s = run(u, d, [
      event('offer_dismissed', { op: 'contrast' }),
      event('offer_dismissed', { op: 'contrast', domain: 'b.example' }),
      event('offer_dismissed', { op: 'contrast', domain: 'c.example' }),
    ]);
    expect(s.user.ops.contrast.c.f).toBeCloseTo(3 * W.dismiss, 9);
    expect(s.domain.ops.contrast!.skipUntil).toBe(FIXTURE_DAY + 7);
    expect(s.user.ops.contrast.offerCooldownUntil).toBe(FIXTURE_DAY + 30);
    expect(s.user.ops.contrast.dismissStreak).toBe(0);
    const accept = run(s.user, s.domain, [
      event('offer_accepted', { op: 'contrast' }),
    ]);
    expect(accept.user.ops.contrast.dismissStreak).toBe(0);
  });

  it('treats blocks as hard rules and remembers them weakly as counts', () => {
    const { u, d } = fresh();
    const s = run(u, d, [
      event('site_disable'),
      event('global_disable', { op: 'contrast' }),
    ]);
    expect(s.domain.ops.text_floor!.block).toBe(true);
    expect(s.domain.ops.text_floor!.f).toBeCloseTo(W.siteBlockDomainF, 9);
    expect(s.user.ops.text_floor.c.f).toBeCloseTo(W.siteBlockPersonalF, 9);
    expect(s.user.ops.contrast.blocked).toBe(true);
    expect(s.deltas).toContainEqual(
      expect.objectContaining({ op: 'contrast', blocked: true }),
    );
    const re = run(s.user, s.domain, [
      event('site_enable'),
      event('manual_on', { op: 'contrast' }),
    ]);
    expect(re.domain.ops.text_floor!.block).toBeUndefined();
    expect(re.user.ops.contrast.blocked).toBeUndefined();
  });

  it('only promotes to a pin on a recorded yes', () => {
    const { u, d } = fresh();
    const yes = run(u, d, [
      event('promotion_answer', { op: 'contrast', answer: 'yes' }),
    ]);
    expect(yes.user.ops.contrast.src).toBe('pinned');
    const no = run(u, d, [
      event('promotion_answer', { op: 'contrast', answer: 'no' }),
    ]);
    expect(no.user.ops.contrast.src).toBe('none');
    expect(no.user.ops.contrast.askAfter).toBe(FIXTURE_DAY + 60);
  });

  it('asks about promotion only after 3 accepts at >= 0.70, outside the cooldown', () => {
    const { u, d } = fresh();
    const ctx: DesirabilityContext = {
      ...STRONG,
      needs: { ...STRONG.needs, contrast: 2 },
    };
    const mild: DesirabilityContext = {
      ...STRONG,
      needs: { ...STRONG.needs, contrast: 1 },
    };
    expect(promotionDue(u, 'contrast', ctx, FIXTURE_DAY)).toBe(false);
    const accept = (i: number) => [
      event('offer_accepted', { op: 'contrast', domain: `s${i}.example` }),
      event('session_end', {
        op: 'contrast',
        domain: `s${i}.example`,
        acceptedThisSession: true,
        kept: true,
      }),
    ];
    const two = run(u, d, [...accept(0), ...accept(1)]);
    expect(promotionDue(two.user, 'contrast', ctx, FIXTURE_DAY)).toBe(false);
    const three = run(two.user, two.domain, accept(2));
    expect(promotionDue(three.user, 'contrast', ctx, FIXTURE_DAY)).toBe(true);
    // A mild prior Beta(5, 5) is still below 0.70 after 3 accepts.
    expect(promotionDue(three.user, 'contrast', mild, FIXTURE_DAY)).toBe(false);
    const asked = run(three.user, three.domain, [
      event('promotion_answer', { op: 'contrast', answer: 'no' }),
    ]);
    expect(promotionDue(asked.user, 'contrast', ctx, FIXTURE_DAY + 10)).toBe(
      false,
    );
    expect(promotionDue(asked.user, 'contrast', ctx, FIXTURE_DAY + 60)).toBe(
      true,
    );
  });

  it('learns intensity from settled episodes (Kalman) and cut-short ones (probit)', () => {
    const { u, d } = fresh();
    const settled = run(u, d, [
      event('episode_end', { toLevel: 5, settledValue: 28, keptMs: 150_000 }),
    ]);
    const est = dimensionEstimate(settled.user, 'textPx').value;
    expect(est).toBeGreaterThan(21);
    expect(est).toBeLessThan(28);
    expect(settled.user.ops.text_floor.c.s).toBeCloseTo(W.adjustKeep, 9);
    expect(settled.domain.dims.textPx).toBeDefined();
    expect(settled.deltas.some((x) => x.obs?.kind === 'point')).toBe(true);

    const cut = run(u, d, [
      event('episode_end', { fromLevel: 3, dir: 1, keptMs: 5_000 }),
    ]);
    expect(dimensionEstimate(cut.user, 'textPx').value).toBeGreaterThan(21);
    expect(cut.user.ops.text_floor.c.s).toBe(0);

    const off = run(u, d, [
      event('episode_end', { kept: false, dtApplyMs: 4_000 }),
    ]);
    expect(off.user.ops.text_floor.c.f).toBe(1);
    expect(off.domain.ops.text_floor!.sessionOff).toBe('tab-1');
  });

  it('halves an op’s counts when its implementation version changes', () => {
    const { u, d } = fresh();
    const s = run(u, d, [
      event('rating', { rating: 'helped' }),
      event('rating', { rating: 'helped' }),
    ]);
    const next = applyEvent(s.user, s.domain, event('applied', { opVer: 2 }));
    expect(next.user.ops.text_floor.c.s).toBeCloseTo(1, 9);
    expect(next.user.ops.text_floor.opVer).toBe(2);
  });

  it('never mutates its inputs and emits valid, domain-free deltas', () => {
    const { u, d } = fresh();
    const uBefore = structuredClone(u);
    const dBefore = structuredClone(d);
    const kinds: AdaptEvent['kind'][] = [
      'applied',
      'offered',
      'offer_accepted',
      'offer_dismissed',
      'offer_ignored',
      'undo',
      'undo_reason',
      'intensity_change',
      'episode_end',
      'manual_on',
      'site_disable',
      'site_enable',
      'global_disable',
      'rating',
      'verifier',
      'promotion_answer',
      'session_end',
    ];
    const all: ReturnType<typeof applyEvent>['deltas'] = [];
    for (const kind of kinds) {
      const r = applyEvent(
        u,
        d,
        event(kind, {
          dtApplyMs: 2_000,
          reason: 'dont_want',
          rating: 'helped',
          answer: 'yes',
          kept: true,
          keptMs: 400_000,
          acceptedThisSession: true,
          aiLabel: 'clear',
          toLevel: 4,
          settledValue: 24,
          pass: false,
        }),
      );
      all.push(...r.deltas);
    }
    expect(u).toEqual(uBefore);
    expect(d).toEqual(dBefore);
    for (const delta of all)
      expect(learnDeltaSchema.safeParse(delta).success).toBe(true);
    expect(JSON.stringify(all)).not.toContain('example.com');
    expect(new Set(all.map((x) => x.deltaId)).size).toBe(all.length);
  });

  it('ignores unknown ops', () => {
    const { u, d } = fresh();
    const r = applyEvent(
      u,
      d,
      event('rating', { op: 'nope' as OpId, rating: 'helped' }),
    );
    expect(r.deltas).toEqual([]);
    expect(r.user).toEqual(u);
  });
});

describe('Learner B', () => {
  const dim = (m: number, sd: number) => ({
    m,
    v: sd * sd,
    t: 0,
    mCal: m,
    vCal: sd * sd,
  });

  it('reproduces the Kalman worked example (7.2)', () => {
    const r = kalmanPoint(dim(Math.log(1.25), 0.15), Math.log(1.5), K.R).dim;
    expect(Math.exp(r.m)).toBeCloseTo(1.418, 3);
    expect(Math.sqrt(r.v)).toBeCloseTo(0.083, 3);
  });

  it('reproduces the probit worked example (7.3)', () => {
    const r = probitUpdate(dim(Math.log(1.25), 0.15), Math.log(1.25), 1, K.R);
    expect(Math.exp(r.m)).toBeCloseTo(1.38, 2);
    expect(Math.sqrt(r.v)).toBeCloseTo(0.112, 3);
  });

  it('snaps to the nearest reviewed level with hysteresis and the calibration floor', () => {
    const { u } = fresh();
    expect(
      OP_CATALOG.text_floor.levels[
        chooseLevel(u, undefined, 'text_floor', null, FIXTURE_DAY)
      ],
    ).toBe(21);
    const nudged = structuredClone(u);
    nudged.dims.textPx.m = Math.log(22.4); // closer to 24 than 21, but not by the hysteresis margin
    expect(chooseLevel(nudged, undefined, 'text_floor', 3, FIXTURE_DAY)).toBe(
      3,
    );
    nudged.dims.textPx.m = Math.log(23.9);
    expect(chooseLevel(nudged, undefined, 'text_floor', 3, FIXTURE_DAY)).toBe(
      4,
    );
    const shrunk = structuredClone(u);
    shrunk.dims.textPx.m = Math.log(15);
    expect(
      OP_CATALOG.text_floor.levels[
        chooseLevel(shrunk, undefined, 'text_floor', null, FIXTURE_DAY)
      ],
    ).toBe(21);
    expect(chooseLevel(u, undefined, 'contrast', null, FIXTURE_DAY)).toBe(0);
    expect(chooseLevel(u, undefined, 'contrast', 9, FIXTURE_DAY)).toBe(2);
  });

  it('applies a site offset only once it is confident', () => {
    const { u } = fresh();
    const site: DomainState = {
      t: FIXTURE_DAY,
      ops: {},
      dims: { textPx: { d: Math.log(28 / 21), v: 0.01 } },
    };
    expect(
      OP_CATALOG.text_floor.levels[
        chooseLevel(u, site, 'text_floor', null, FIXTURE_DAY)
      ],
    ).toBe(21);
    site.dims.textPx!.v = 0.001;
    expect(
      OP_CATALOG.text_floor.levels[
        chooseLevel(u, site, 'text_floor', null, FIXTURE_DAY)
      ],
    ).toBe(28);
  });

  it('reports estimates in natural units', () => {
    const { u } = fresh();
    const e = dimensionEstimate(u, 'textPx');
    expect(e.value).toBeCloseTo(21, 9);
    expect(e.sd).toBeCloseTo(21 * Math.sqrt(u.dims.textPx.v), 9);
  });
});

describe('reseedFromProfile', () => {
  it('keeps pins and blocks, halves counts and keeps half the learned deviation', () => {
    const { u, d } = fresh();
    const s = run(u, d, [
      event('promotion_answer', { op: 'contrast', answer: 'yes' }),
      event('global_disable', { op: 'reading_guide' }),
      event('rating', { rating: 'helped' }),
      event('rating', { rating: 'helped' }),
      event('episode_end', { toLevel: 5, settledValue: 28, keptMs: 150_000 }),
    ]);
    const learned = s.user.dims.textPx.m - s.user.dims.textPx.mCal;
    const next = strongReaderProfile();
    next.vision.textMinPx = {
      value: 24,
      source: 'measured',
      confidence: 0.9,
      measured: 24,
    };
    const r = reseedFromProfile(
      s.user,
      next,
      needLevels(next),
      FIXTURE_DAY + 30,
    );
    expect(r.ops.contrast.src).toBe('pinned');
    expect(r.ops.reading_guide.blocked).toBe(true);
    expect(r.ops.text_floor.c.s).toBeCloseTo(
      0.5 * decay(s.user.ops.text_floor.c, FIXTURE_DAY + 30).s,
      9,
    );
    expect(r.dims.textPx.mCal).toBeCloseTo(Math.log(24), 9);
    expect(r.dims.textPx.m).toBeCloseTo(Math.log(24) + 0.5 * learned, 9);
    expect(r.dims.textPx.floor).toBeCloseTo(Math.log(24), 9);
  });
});

describe('label table', () => {
  it('starts at 0.80 / 0.55 / 0.25 and stays monotone (pool adjacent violators)', () => {
    const { u } = fresh();
    const m = labelTableMeans(u, 'dim_distractions', FIXTURE_DAY);
    expect(m).toEqual({
      clear: expect.closeTo(0.8, 9),
      likely: expect.closeTo(0.55, 9),
      unsure: expect.closeTo(0.25, 9),
    });
    const bad = structuredClone(u);
    bad.labels.dim_distractions = {
      clear: { s: 0, f: 20, t: FIXTURE_DAY },
      likely: { s: 20, f: 0, t: FIXTURE_DAY },
      unsure: { s: 0, f: 0, t: FIXTURE_DAY },
    };
    const pooled = labelTableMeans(bad, 'dim_distractions', FIXTURE_DAY);
    expect(pooled.clear).toBeGreaterThanOrEqual(pooled.likely);
    expect(pooled.likely).toBeGreaterThanOrEqual(pooled.unsure);
    expect(pooled.clear).toBeCloseTo(pooled.likely, 9);
  });
});

describe('default profile smoke', () => {
  it('builds state for the zero-setup profile', () => {
    const p = defaultFitProfile();
    const u = initialLearningState(p, needLevels(p), FIXTURE_DAY);
    expect(Object.keys(u.ops)).toEqual([...OP_IDS]);
    expect(Object.keys(u.dims)).toEqual([...DIM_IDS]);
    expect(JSON.stringify(u).length).toBeLessThan(8192);
  });
});
