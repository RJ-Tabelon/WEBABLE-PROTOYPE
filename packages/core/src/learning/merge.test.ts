import { describe, expect, it } from 'vitest';

import { needLevels } from '../profile/needs';
import {
  FIXTURE_DAY,
  FIXTURE_NOW,
  strongReaderProfile,
} from '../policy/fixtures';
import {
  applyEvent,
  decay,
  emptyDomainState,
  initialLearningState,
  mergeDeltas,
} from './learners';
import type { AdaptEvent, LearnDelta, UserLearningState } from './types';

const DAY_MS = 86_400_000;

function base(): UserLearningState {
  const p = strongReaderProfile();
  return initialLearningState(p, needLevels(p), FIXTURE_DAY);
}

/** A deterministic PRNG (mulberry32) so shuffles are reproducible. */
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

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const counts = (u: UserLearningState, day: number) =>
  Object.fromEntries(
    Object.entries(u.ops).map(([op, o]) => [op, decay(o.c, day)]),
  );

function sampleDeltas(): LearnDelta[] {
  const out: LearnDelta[] = [];
  const ops = ['text_floor', 'contrast', 'target_size', 'dim_distractions'];
  const random = rng(7);
  for (let i = 0; i < 40; i += 1) {
    const op = ops[i % ops.length]!;
    const day = FIXTURE_DAY - 20 + Math.floor(random() * 40);
    out.push({
      v: 1,
      deltaId: `delta-${String(i).padStart(4, '0')}`,
      day,
      op,
      ds: Math.round(random() * 100) / 100,
      df: i % 3 === 0 ? 0.5 : 0,
    });
  }
  out.push({
    v: 1,
    deltaId: 'delta-acc-1',
    day: FIXTURE_DAY,
    op: 'contrast',
    accepts: 1,
  });
  out.push({
    v: 1,
    deltaId: 'delta-lab-1',
    day: FIXTURE_DAY,
    label: { op: 'dim_distractions', label: 'clear', s: 1, f: 0 },
  });
  out.push({
    v: 1,
    deltaId: 'delta-obs-1',
    day: FIXTURE_DAY - 3,
    dim: 'textPx',
    obs: { kind: 'point', value: Math.log(24), r: 0.01 },
  });
  out.push({
    v: 1,
    deltaId: 'delta-obs-2',
    day: FIXTURE_DAY - 1,
    dim: 'textPx',
    obs: { kind: 'gt', value: Math.log(24), r: 0.01 },
  });
  return out;
}

describe('mergeDeltas', () => {
  it('is idempotent: already-applied and duplicated deltas are ignored', () => {
    const deltas = sampleDeltas();
    const once = mergeDeltas(base(), deltas, new Set());
    const twice = mergeDeltas(
      once,
      deltas,
      new Set(deltas.map((d) => d.deltaId)),
    );
    expect(twice).toEqual(once);
    const doubled = mergeDeltas(base(), [...deltas, ...deltas], new Set());
    expect(doubled).toEqual(once);
  });

  it('adds counts commutatively (G-counter): order and batching do not matter', () => {
    const deltas = sampleDeltas();
    const reference = counts(
      mergeDeltas(base(), deltas, new Set()),
      FIXTURE_DAY + 30,
    );
    for (let seed = 1; seed <= 5; seed += 1) {
      const random = rng(seed);
      const order = shuffle(deltas, random);
      const cut = 1 + Math.floor(random() * (order.length - 2));
      const a = order.slice(0, cut);
      const b = order.slice(cut);
      const ab = mergeDeltas(mergeDeltas(base(), a, new Set()), b, new Set());
      const ba = mergeDeltas(mergeDeltas(base(), b, new Set()), a, new Set());
      for (const merged of [ab, ba, mergeDeltas(base(), order, new Set())]) {
        const c = counts(merged, FIXTURE_DAY + 30);
        for (const op of Object.keys(reference)) {
          expect(c[op]!.s).toBeCloseTo(reference[op]!.s, 9);
          expect(c[op]!.f).toBeCloseTo(reference[op]!.f, 9);
        }
      }
      expect(ab.ops.contrast.accepts).toBe(1);
      expect(ba.labels.dim_distractions!.clear.s).toBeCloseTo(1, 9);
    }
  });

  it('replays Kalman observations in day order regardless of arrival order', () => {
    const deltas = sampleDeltas().filter((d) => d.dim);
    const forward = mergeDeltas(base(), deltas, new Set());
    const backward = mergeDeltas(base(), [...deltas].reverse(), new Set());
    expect(backward.dims.textPx).toEqual(forward.dims.textPx);
    expect(Math.exp(forward.dims.textPx.m)).toBeGreaterThan(21);
  });

  it('reproduces local counts when another device replays this device’s deltas', () => {
    const start = base();
    let user = start;
    let domain = emptyDomainState(FIXTURE_DAY);
    const all: LearnDelta[] = [];
    const events: Array<Partial<AdaptEvent>> = [
      { kind: 'rating', rating: 'helped' },
      { kind: 'undo', dtApplyMs: 2_000, t: FIXTURE_NOW + DAY_MS },
      { kind: 'offer_dismissed', op: 'contrast', t: FIXTURE_NOW + 2 * DAY_MS },
      { kind: 'manual_on', op: 'reading_guide', t: FIXTURE_NOW + 3 * DAY_MS },
      { kind: 'site_disable', op: 'pause_media', t: FIXTURE_NOW + 4 * DAY_MS },
    ];
    events.forEach((patch, i) => {
      const ev: AdaptEvent = {
        v: 1,
        id: `replay-${i}-abcdef`,
        t: FIXTURE_NOW,
        tabSession: 'tab',
        domain: 'a.example',
        cat: 'article',
        op: 'text_floor',
        opVer: 1,
        level: 3,
        src: 'profile',
        kind: 'applied',
        ...patch,
      } as AdaptEvent;
      const r = applyEvent(user, domain, ev);
      user = r.user;
      domain = r.domain;
      all.push(...r.deltas);
    });
    const remote = mergeDeltas(start, all, new Set());
    const day = FIXTURE_DAY + 10;
    const local = counts(user, day);
    const replayed = counts(remote, day);
    for (const op of Object.keys(local)) {
      expect(replayed[op]!.s).toBeCloseTo(local[op]!.s, 9);
      expect(replayed[op]!.f).toBeCloseTo(local[op]!.f, 9);
    }
  });

  it('ignores invalid deltas and unknown ops or dimensions', () => {
    const b = base();
    const merged = mergeDeltas(
      b,
      [
        { v: 1, deltaId: 'short', day: FIXTURE_DAY, op: 'text_floor', ds: 1 },
        {
          v: 1,
          deltaId: 'delta-bad-range',
          day: FIXTURE_DAY,
          op: 'text_floor',
          ds: 50,
        },
        {
          v: 1,
          deltaId: 'delta-unknown-op',
          day: FIXTURE_DAY,
          op: 'make_it_pink',
          ds: 1,
        },
        {
          v: 1,
          deltaId: 'delta-unknown-dim',
          day: FIXTURE_DAY,
          dim: 'hue',
          obs: { kind: 'point', value: 1, r: 0.01 },
        },
      ] as LearnDelta[],
      new Set(),
    );
    expect(merged).toEqual(b);
  });

  it('applies flags last-writer-wins and carries local cooldowns with max semantics', () => {
    const b = base();
    const merged = mergeDeltas(
      b,
      [
        {
          v: 1,
          deltaId: 'delta-flag-1',
          day: FIXTURE_DAY,
          op: 'contrast',
          blocked: true,
        },
        {
          v: 1,
          deltaId: 'delta-flag-2',
          day: FIXTURE_DAY + 1,
          op: 'contrast',
          blocked: false,
        },
        {
          v: 1,
          deltaId: 'delta-flag-3',
          day: FIXTURE_DAY + 1,
          op: 'text_floor',
          src: 'pinned',
        },
      ],
      new Set(),
    );
    expect(merged.ops.contrast.blocked).toBeUndefined();
    expect(merged.ops.text_floor.src).toBe('pinned');

    const local = structuredClone(b);
    local.ops.contrast.offerCooldownUntil = FIXTURE_DAY + 30;
    local.ops.contrast.askAfter = FIXTURE_DAY + 60;
    const withLocal = mergeDeltas(b, [], new Set(), local);
    expect(withLocal.ops.contrast.offerCooldownUntil).toBe(FIXTURE_DAY + 30);
    expect(withLocal.ops.contrast.askAfter).toBe(FIXTURE_DAY + 60);
  });

  it('does not mutate the base state', () => {
    const b = base();
    const copy = structuredClone(b);
    mergeDeltas(b, sampleDeltas(), new Set());
    expect(b).toEqual(copy);
  });
});
