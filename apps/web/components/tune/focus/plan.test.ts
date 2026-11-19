import { describe, expect, it } from 'vitest';

import {
  FLOWS,
  orientedPreference,
  planFindText,
  planNextAction,
  planPairs,
  planSearch,
  TEMPLATES,
} from './plan';

describe('planSearch', () => {
  it('has one clean still practice trial and 12 balanced scored trials', () => {
    const plan = planSearch(42, false);
    expect(plan).toHaveLength(13);
    expect(plan[0]).toMatchObject({
      practice: true,
      clutter: 'clean',
      motion: 'still',
    });
    const scored = plan.slice(1);
    const cells = new Map<string, number>();
    for (const t of scored) {
      const key = `${t.clutter}/${t.motion}`;
      cells.set(key, (cells.get(key) ?? 0) + 1);
    }
    expect([...cells.values()]).toEqual([3, 3, 3, 3]);
    // Each mini-block of four has every cell once.
    for (let b = 0; b < 3; b++) {
      const block = scored
        .slice(b * 4, b * 4 + 4)
        .map((t) => `${t.clutter}/${t.motion}`);
      expect(new Set(block).size).toBe(4);
    }
  });

  it('never plans motion under reduced motion; a static salient block stands in', () => {
    const plan = planSearch(7, true);
    expect(plan.some((t) => t.motion === 'animated')).toBe(false);
    expect(plan.filter((t) => t.motion === 'salient')).toHaveLength(6);
    expect(plan.every((t) => t.sources.length === 0)).toBe(true);
  });

  it('puts the target in its stratum and keeps the link count equal', () => {
    for (const t of planSearch(3, false)) {
      expect(t.links).toHaveLength(12);
      expect(new Set(t.links).size).toBe(12);
      const at = t.links.indexOf(t.target);
      const range =
        t.stratum === 'top'
          ? [0, 2]
          : t.stratum === 'middle'
            ? [3, 8]
            : [9, 11];
      expect(at).toBeGreaterThanOrEqual(range[0]!);
      expect(at).toBeLessThanOrEqual(range[1]!);
      expect(TEMPLATES[t.template].links).toContain(t.target);
      if (t.motion === 'animated') expect(t.sources).toHaveLength(2);
      expect(t.firstAdvanceMs).toBeGreaterThanOrEqual(500);
      expect(t.firstAdvanceMs).toBeLessThanOrEqual(1500);
    }
  });

  it('is reproducible from its seed', () => {
    expect(planSearch(99, false)).toEqual(planSearch(99, false));
    expect(planSearch(99, false)).not.toEqual(planSearch(100, false));
  });
});

describe('other tasks', () => {
  it('counterbalances weak and strong hierarchy over four flows', () => {
    const plan = planNextAction(5);
    expect(new Set(plan.map((t) => t.flow)).size).toBe(4);
    expect(plan.filter((t) => t.hierarchy === 'weak')).toHaveLength(2);
    for (const t of plan) {
      const flow = FLOWS[t.flow];
      expect(flow.goal.toLowerCase()).not.toContain(flow.target.toLowerCase());
    }
  });

  it('shows two passages, one dense and one chunked', () => {
    const plan = planFindText(11);
    expect(plan).toHaveLength(2);
    expect(new Set(plan.map((t) => t.format))).toEqual(
      new Set(['dense', 'chunked']),
    );
    expect(plan[0]!.passage.id).not.toBe(plan[1]!.passage.id);
  });

  it('orients preferences so positive favours the adapted version', () => {
    expect(orientedPreference(2, true)).toBe(2);
    expect(orientedPreference(2, false)).toBe(-2);
    expect(orientedPreference(0, false)).toBe(0);
    expect(planPairs(1).map((p) => p.id)).toEqual([
      'still',
      'clean',
      'chunked',
      'hierarchy',
    ]);
  });
});
