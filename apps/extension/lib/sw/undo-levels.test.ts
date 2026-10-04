import type { AdaptationPlan, PlannedOp } from '@webable/core/policy/types';
import type { OpId } from '@webable/core/ops/catalog';
import { describe, expect, it } from 'vitest';

import { memoryArea } from '../storage/area';
import { CONFIRM_SESSIONS, stabilizeLevels } from './levels';
import type { EventInput } from './profile';
import {
  applyReason,
  LATE_REASON_MS,
  REASON_WINDOW_MS,
  UndoHold,
  type HeldUndo,
} from './undo';

const undoInput = (
  op: OpId = 'text_floor',
  extra: Partial<EventInput> = {},
): EventInput => ({
  cat: 'article',
  op,
  level: 3,
  src: 'profile',
  kind: 'undo',
  dtApplyMs: 4_000,
  ...extra,
});

describe('undo hold (reason chips)', () => {
  it('holds an undo for 8 s, then hands it over once', async () => {
    const hold = new UndoHold(memoryArea());
    await hold.hold(
      [{ tabId: 1, domain: 'a.com', tabSession: 's1', input: undoInput() }],
      0,
    );
    expect(await hold.takeDue(REASON_WINDOW_MS - 1)).toEqual([]);
    expect(await hold.nextDue()).toBe(REASON_WINDOW_MS);
    const due = await hold.takeDue(REASON_WINDOW_MS);
    expect(due).toHaveLength(1);
    expect(due[0]!.input.reason).toBeUndefined();
    expect(await hold.takeDue(REASON_WINDOW_MS + 10)).toEqual([]);
    expect(await hold.nextDue()).toBeNull();
  });

  it('attaches a reason given in time, so one event carries it', async () => {
    const hold = new UndoHold(memoryArea());
    await hold.hold(
      [{ tabId: 1, domain: 'a.com', tabSession: 's1', input: undoInput() }],
      0,
    );
    expect(await hold.openFor(1, 100)).toEqual([
      { op: 'text_floor', until: REASON_WINDOW_MS },
    ]);
    const outcome = await hold.reason(
      { tabId: 1, op: 'text_floor' },
      'too_much',
      2_000,
    );
    expect(outcome.kind).toBe('attach');
    const due = await hold.takeDue(2_000);
    expect(due.map((h) => h.input.reason)).toEqual(['too_much']);
    expect(await hold.openFor(1, 2_000)).toEqual([]);
  });

  it('turns a late reason into an undo_reason event with the same timing and label', () => {
    const flushed: HeldUndo = {
      id: 'h',
      tabId: 1,
      domain: 'a.com',
      tabSession: 's1',
      input: undoInput('dim_distractions', { aiLabel: 'likely' }),
      due: 0,
      flushedAt: 10_000,
    };
    const late = applyReason(
      [flushed],
      { tabId: 1, op: 'dim_distractions' },
      'needed_that',
      20_000,
    );
    expect(late.outcome).toMatchObject({
      kind: 'late',
      event: {
        kind: 'undo_reason',
        reason: 'needed_that',
        dtApplyMs: 4_000,
        aiLabel: 'likely',
        op: 'dim_distractions',
      },
    });
    // A second answer does nothing: the undo already has its reason.
    expect(
      applyReason(
        late.list,
        { tabId: 1, op: 'dim_distractions' },
        'dont_want',
        21_000,
      ).outcome,
    ).toEqual({
      kind: 'none',
    });
    // Too late altogether.
    expect(
      applyReason(
        [flushed],
        { tabId: 1, op: 'dim_distractions' },
        'dont_want',
        10_000 + LATE_REASON_MS + 1,
      ).outcome,
    ).toEqual({ kind: 'none' });
  });

  it('flushes every held undo of a page view that is ending', async () => {
    const hold = new UndoHold(memoryArea());
    await hold.hold(
      [
        { tabId: 1, domain: 'a.com', tabSession: 's1', input: undoInput() },
        {
          tabId: 2,
          domain: 'b.com',
          tabSession: 's2',
          input: undoInput('line_spacing'),
        },
      ],
      0,
    );
    const due = await hold.takeDue(100, 's1');
    expect(due.map((h) => h.tabSession)).toEqual(['s1']);
  });

  it('survives a worker restart (storage.session)', async () => {
    const area = memoryArea();
    await new UndoHold(area).hold(
      [{ tabId: 1, domain: 'a.com', tabSession: 's', input: undoInput() }],
      0,
    );
    expect(await new UndoHold(area).takeDue(REASON_WINDOW_MS)).toHaveLength(1);
  });
});

function planned(op: OpId, level: number): PlannedOp {
  return {
    op,
    level,
    mode: 'auto',
    scope: 'page',
    trace: {
      op,
      mode: 'auto',
      source: 'profile',
      level,
      p: 0.9,
      pOk: 0.9,
      why: 't',
      evidence: [],
    },
  };
}
const plan = (ops: PlannedOp[]): AdaptationPlan => ({
  id: 'p',
  createdAt: 0,
  category: 'article',
  basis: 'local',
  ops,
});

describe('level hysteresis across page views (personalization 7.5)', () => {
  it('remembers the first level it sees', () => {
    const r = stabilizeLevels({
      plan: plan([planned('text_floor', 3)]),
      memo: null,
      seed: 'a',
      tabSession: 't1',
      manual: {},
    });
    expect(r.plan.ops[0]!.level).toBe(3);
    expect(r.memo.ops.text_floor).toEqual({ level: 3 });
  });

  it('changes only when the same new level wins on two page views', () => {
    let memo = stabilizeLevels({
      plan: plan([planned('text_floor', 3)]),
      memo: null,
      seed: 'a',
      tabSession: 't1',
      manual: {},
    }).memo;
    const second = stabilizeLevels({
      plan: plan([planned('text_floor', 4)]),
      memo,
      seed: 'a',
      tabSession: 't2',
      manual: {},
    });
    expect(second.plan.ops[0]!.level).toBe(3);
    expect(second.plan.ops[0]!.trace.level).toBe(3);
    // A refinement in the same page view does not count twice.
    const same = stabilizeLevels({
      plan: plan([planned('text_floor', 4)]),
      memo: second.memo,
      seed: 'a',
      tabSession: 't2',
      manual: {},
    });
    expect(same.plan.ops[0]!.level).toBe(3);
    memo = same.memo;
    const third = stabilizeLevels({
      plan: plan([planned('text_floor', 4)]),
      memo,
      seed: 'a',
      tabSession: 't3',
      manual: {},
    });
    expect(CONFIRM_SESSIONS).toBe(2);
    expect(third.plan.ops[0]!.level).toBe(4);
    expect(third.memo.ops.text_floor).toEqual({ level: 4 });
  });

  it('forgets a pending level that did not repeat', () => {
    const memo = stabilizeLevels({
      plan: plan([planned('text_floor', 3)]),
      memo: null,
      seed: 'a',
      tabSession: 't1',
      manual: {},
    }).memo;
    const a = stabilizeLevels({
      plan: plan([planned('text_floor', 4)]),
      memo,
      seed: 'a',
      tabSession: 't2',
      manual: {},
    });
    const b = stabilizeLevels({
      plan: plan([planned('text_floor', 3)]),
      memo: a.memo,
      seed: 'a',
      tabSession: 't3',
      manual: {},
    });
    expect(b.memo.ops.text_floor).toEqual({ level: 3 });
    const c = stabilizeLevels({
      plan: plan([planned('text_floor', 4)]),
      memo: b.memo,
      seed: 'a',
      tabSession: 't4',
      manual: {},
    });
    expect(c.plan.ops[0]!.level).toBe(3);
  });

  it('never holds back a level the person chose, or ops without a learned dimension', () => {
    const memo = stabilizeLevels({
      plan: plan([planned('text_floor', 3)]),
      memo: null,
      seed: 'a',
      tabSession: 't1',
      manual: {},
    }).memo;
    const manual = stabilizeLevels({
      plan: plan([planned('text_floor', 6), planned('contrast', 2)]),
      memo,
      seed: 'a',
      tabSession: 't2',
      manual: { text_floor: 6 },
    });
    expect(manual.plan.ops.map((p) => p.level)).toEqual([6, 2]);
    expect(manual.memo.ops.contrast).toBeUndefined();
  });

  it('starts over after a recalibration (a new profile identity)', () => {
    const memo = stabilizeLevels({
      plan: plan([planned('text_floor', 3)]),
      memo: null,
      seed: 'account:1',
      tabSession: 't1',
      manual: {},
    }).memo;
    const next = stabilizeLevels({
      plan: plan([planned('text_floor', 5)]),
      memo,
      seed: 'account:2',
      tabSession: 't2',
      manual: {},
    });
    expect(next.plan.ops[0]!.level).toBe(5);
    expect(next.memo.seed).toBe('account:2');
  });
});
