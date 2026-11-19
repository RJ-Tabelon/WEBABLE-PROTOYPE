// @vitest-environment node
import { buildPlan } from '@webable/core/policy/decide';
import {
  FIXTURE_NOW,
  govukSignals,
  makeInput,
  strongReaderProfile,
  triageFor,
  wikipediaSignals,
} from '@webable/core/policy/fixtures';
import type { FitProfile } from '@webable/core/profile/schema';
import { describe, expect, it } from 'vitest';

import { memoryArea } from '../storage/area';
import { createStores, type LocalStores } from '../storage';
import type { ProfileRecord } from '../storage/account';
import { contextFor, ensureLearning } from './profile';

const account = (profile: FitProfile, version = 3): ProfileRecord => ({
  profile,
  source: 'account',
  version,
  fetchedAt: FIXTURE_NOW,
});

const stores = (): LocalStores => createStores(memoryArea(), () => FIXTURE_NOW);

describe('ensureLearning', () => {
  it('seeds the learning state from the profile once, then keeps it', async () => {
    const s = stores();
    const ctx = contextFor(account(strongReaderProfile()));
    const first = await ensureLearning(s, ctx, FIXTURE_NOW);
    expect(first.ops.text_floor.src).toBe('profile');
    expect(first.ops.target_size.src).toBe('profile');
    expect((await s.learning.read()).seededFor).toBe('account:3');

    first.ops.text_floor.c = { s: 2, f: 0, t: first.ops.text_floor.c.t };
    await s.learning.update((rec) => ({ ...rec, user: first }));
    const again = await ensureLearning(s, ctx, FIXTURE_NOW);
    expect(again.ops.text_floor.c.s).toBe(2);
  });

  it('upgrades saved minimums seeded as "none", keeping blocks and feedback', async () => {
    const s = stores();
    const ctx = contextFor(account(strongReaderProfile()));
    const seeded = await ensureLearning(s, ctx, FIXTURE_NOW);
    seeded.ops.text_floor = { ...seeded.ops.text_floor, src: 'none' };
    seeded.ops.target_size = {
      ...seeded.ops.target_size,
      src: 'none',
      blocked: true,
    };
    await s.learning.update((rec) => ({ ...rec, user: seeded }));
    const upgraded = await ensureLearning(s, ctx, FIXTURE_NOW);
    expect(upgraded.ops.text_floor.src).toBe('profile');
    expect(upgraded.ops.target_size).toMatchObject({
      src: 'profile',
      blocked: true,
    });
    // page_zoom is not forced: it takes text_floor's authority in the policy.
    expect(upgraded.ops.page_zoom.src).toBe(seeded.ops.page_zoom.src);
  });

  it('reseeds when the profile changes', async () => {
    const s = stores();
    await ensureLearning(
      s,
      contextFor(account(strongReaderProfile(), 3)),
      FIXTURE_NOW,
    );
    const p = strongReaderProfile();
    p.vision.textMinPx = {
      value: 32,
      source: 'measured',
      confidence: 0.9,
      measured: 32,
    };
    await ensureLearning(s, contextFor(account(p, 4)), FIXTURE_NOW);
    const rec = await s.learning.read();
    expect(rec).toMatchObject({ seededFor: 'account:4', reseed: true });
  });

  it('leaves the triage gate the last word: a saved fit applies only where the page does not fit', async () => {
    const s = stores();
    const profile = strongReaderProfile();
    const ctx = contextFor(account(profile));
    const learning = await ensureLearning(s, ctx, FIXTURE_NOW);
    const plan = (signals: ReturnType<typeof govukSignals>) =>
      buildPlan(
        makeInput({
          profile,
          signals,
          learning,
          patch: { triage: triageFor(profile, signals) },
        }),
      );
    // 19 px running text for a 21 px fit: k = 1.11 fits, so nothing is automatic.
    const fits = plan(govukSignals());
    expect(
      fits.ops.find((o) => o.op === 'text_floor' && o.mode === 'auto'),
    ).toBeUndefined();
    expect(fits.zoom).toBe(1);
    // 14 px for a 21 px fit: k = 1.5, scaled to 150% from the saved fit.
    const small = plan(wikipediaSignals());
    expect(small.ops.find((o) => o.op === 'page_zoom')).toMatchObject({
      mode: 'auto',
      trace: { why: 'saved_fit' },
    });
    expect(small.zoom).toBe(1.5);
  });
});
