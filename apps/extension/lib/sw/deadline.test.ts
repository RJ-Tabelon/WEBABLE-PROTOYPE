import type { OpId } from '@webable/core/ops/catalog';
import type { AdaptationPlan, PlannedOp } from '@webable/core/policy/types';
import { describe, expect, it } from 'vitest';

import {
  applyRefinement,
  diffRefinement,
  HARD_TIMEOUT_MS,
  limitLateAnalysis,
  refinementMode,
  SOFT_DEADLINE_MS,
} from './deadline';

function op(
  id: OpId,
  scope: PlannedOp['scope'] = 'page',
  mode: PlannedOp['mode'] = 'auto',
): PlannedOp {
  return {
    op: id,
    level: 0,
    mode,
    scope,
    trace: {
      op: id,
      mode,
      source: 'profile',
      level: 0,
      p: 0.9,
      pOk: 0.9,
      why: 't',
      evidence: [],
    },
  };
}

function plan(ops: PlannedOp[]): AdaptationPlan {
  return { id: 'p', createdAt: 0, category: 'article', basis: 'local', ops };
}

describe('when a late answer may still change the page (08 section 6)', () => {
  it('applies paint changes before the first interaction, within 1.5 s', () => {
    expect(
      refinementMode({ dclAt: 0, answeredAt: 400, interactedAt: null }),
    ).toBe('apply_paint');
    expect(
      refinementMode({
        dclAt: 0,
        answeredAt: SOFT_DEADLINE_MS,
        interactedAt: null,
      }),
    ).toBe('apply_paint');
  });

  it('only caches after 1.5 s, or once the person has interacted', () => {
    expect(
      refinementMode({
        dclAt: 0,
        answeredAt: SOFT_DEADLINE_MS + 1,
        interactedAt: null,
      }),
    ).toBe('cache_only');
    expect(
      refinementMode({ dclAt: 0, answeredAt: 300, interactedAt: 200 }),
    ).toBe('cache_only');
    // An interaction after the answer does not matter.
    expect(
      refinementMode({ dclAt: 0, answeredAt: 300, interactedAt: 900 }),
    ).toBe('apply_paint');
  });

  it('keeps the fetch timeout above the soft deadline', () => {
    expect(HARD_TIMEOUT_MS).toBe(3_000);
    expect(HARD_TIMEOUT_MS).toBeGreaterThan(SOFT_DEADLINE_MS);
  });
});

describe('refinement diff', () => {
  it('keeps cached late answers from adding effects during a DOM refresh, while native fit and protection still work', () => {
    const ai = op('dim_distractions', { regions: ['r1', 'r2'] });
    ai.trace.evidence = [
      { kind: 'region_role', role: 'promo_ad', by: 'page_analysis' },
    ];
    const local = op('text_floor');
    const offer = op('focus_view', 'page', 'offer');
    expect(
      limitLateAnalysis(plan([]), plan([local, ai, offer]), []).ops,
    ).toEqual([local, offer]);
    const existing = op('dim_distractions', { regions: ['r1', 'protected'] });
    const next = limitLateAnalysis(plan([existing]), plan([ai]), [
      'dim_distractions',
    ]);
    expect(next.ops[0]?.scope).toEqual({ regions: ['r1'] });
  });

  it('adds a new paint op in time, never a layout op', () => {
    const current = plan([]);
    const refined = plan([
      op('dim_distractions', { regions: ['r1'] }),
      op('line_length', { regions: ['r2'] }),
    ]);
    const d = diffRefinement(current, refined, 'apply_paint', new Set());
    expect(d.ops.map((p) => p.op)).toEqual(['dim_distractions']);
    expect(
      diffRefinement(current, refined, 'cache_only', new Set()).ops,
    ).toEqual([]);
  });

  it('releases regions the answers protect, whatever the timing', () => {
    const current = plan([op('dim_distractions', { regions: ['r1', 'r2'] })]);
    const refined = plan([op('dim_distractions', { regions: ['r2'] })]);
    const d = diffRefinement(current, refined, 'cache_only', new Set(['r1']));
    expect(d.ops).toHaveLength(1);
    expect(d.ops[0]!.scope).toEqual({ regions: ['r2'] });
    expect(d.undo).toEqual([]);
  });

  it('undoes an op whose every region became protected', () => {
    const current = plan([op('dim_distractions', { regions: ['r1'] })]);
    const d = diffRefinement(current, plan([]), 'cache_only', new Set(['r1']));
    expect(d.undo).toEqual(['dim_distractions']);
  });

  it('keeps a dropped op unless protection removed it', () => {
    const current = plan([op('dim_distractions', { regions: ['r1'] })]);
    const d = diffRefinement(current, plan([]), 'apply_paint', new Set());
    expect(d).toEqual({ ops: [], undo: [], offers: [] });
  });

  it('surfaces new offers without applying them', () => {
    const d = diffRefinement(
      plan([]),
      plan([op('focus_view', 'page', 'offer')]),
      'apply_paint',
      new Set(),
    );
    expect(d.ops).toEqual([]);
    expect(d.offers.map((o) => o.op)).toEqual(['focus_view']);
  });

  it('widens a paint op in time with newly eligible regions', () => {
    const current = plan([op('dim_distractions', { regions: ['r1'] })]);
    const refined = plan([op('dim_distractions', { regions: ['r1', 'r3'] })]);
    const d = diffRefinement(current, refined, 'apply_paint', new Set());
    expect(d.ops[0]!.scope).toEqual({ regions: ['r1', 'r3'] });
    expect(
      diffRefinement(current, refined, 'cache_only', new Set()).ops,
    ).toEqual([]);
  });

  it('produces the plan in effect after the diff', () => {
    const current = plan([
      op('dim_distractions', { regions: ['r1', 'r2'] }),
      op('text_floor'),
    ]);
    const d = diffRefinement(
      current,
      plan([op('text_floor')]),
      'cache_only',
      new Set(['r1', 'r2']),
    );
    const next = applyRefinement(current, d, 'page_analysis');
    expect(next.ops.map((p) => p.op)).toEqual(['text_floor']);
    expect(next.basis).toBe('page_analysis');
  });
});
