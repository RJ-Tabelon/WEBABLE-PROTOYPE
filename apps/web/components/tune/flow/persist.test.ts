import { defaultFitProfile, type FitProfile } from '@webable/core';
import { describe, expect, it, vi } from 'vitest';

import type { FitVersion } from '../../../lib/data/fit';
import {
  DATA_ERROR_MESSAGES,
  type DataErrorCode,
  type DataResult,
} from '../../../lib/data/result';
import {
  abandonSession,
  persistFit,
  UNREACHABLE_MESSAGE,
  type TuneServerActions,
} from './persist';
import { buildRecord } from './record';

const DEVICE = {
  class: 'laptop' as const,
  input: 'mouse' as const,
  dprBucket: 2,
  viewport: 'L' as const,
  reducedMotion: false,
  colorScheme: 'light' as const,
  moreContrast: false,
  forcedColors: false,
  rootFontPx: 16,
  zoom: 1,
};

const RECORD = buildRecord({
  device: DEVICE,
  modules: {},
  startedAt: '2026-09-29T12:00:00.000Z',
  completedAt: '2026-09-29T12:06:00.000Z',
});
const PROFILE: FitProfile = defaultFitProfile();

/** A failed result; assignable to any DataResult<T>. */
function fail(code: DataErrorCode): Extract<DataResult<never>, { ok: false }> {
  return { ok: false, error: { code, message: DATA_ERROR_MESSAGES[code] } };
}

function version(sessionId: string | null): FitVersion {
  return {
    id: '00000000-0000-4000-8000-000000000009',
    version: 3,
    source: 'calibration',
    derivationVersion: PROFILE.derivationVersion,
    calibrationSessionId: sessionId,
    isCurrent: true,
    createdAt: '2026-09-29T12:06:01.000Z',
    profile: PROFILE,
  };
}

const SESSION_A = '00000000-0000-4000-8000-00000000000a';
const SESSION_B = '00000000-0000-4000-8000-00000000000b';

function fakeActions(
  overrides: Partial<TuneServerActions> = {},
): TuneServerActions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    startCalibrationSession: vi.fn(async () => {
      calls.push('start');
      return {
        ok: true as const,
        data: {
          id: SESSION_B,
          calibrationVersion: 'cal-1.0.0',
          startedAt: '2026-09-29T12:06:00.000Z',
        },
      };
    }),
    completeCalibrationSession: vi.fn(async (input) => {
      calls.push(`complete:${input.id}`);
      return {
        ok: true as const,
        data: {
          id: input.id,
          calibrationVersion: 'cal-1.0.0',
          startedAt: '2026-09-29T12:00:00.000Z',
          completedAt: '2026-09-29T12:06:00.000Z',
        },
      };
    }),
    saveFit: vi.fn(async (input) => {
      calls.push(
        `save:${input.calibrationSessionId ?? 'none'}:${input.source}`,
      );
      return {
        ok: true as const,
        data: version(input.calibrationSessionId ?? null),
      };
    }),
    abandonCalibrationSession: vi.fn(async (input) => {
      calls.push(`abandon:${input.id}`);
      return { ok: true as const, data: { id: input.id } };
    }),
    ...overrides,
  };
}

describe('persistFit', () => {
  it('closes the session opened at the start, then saves the fit linked to it', async () => {
    const actions = fakeActions();
    const outcome = await persistFit(actions, {
      profile: PROFILE,
      record: RECORD,
      source: 'calibration',
      sessionId: SESSION_A,
    });
    expect(outcome).toMatchObject({ kind: 'saved', sessionId: SESSION_A });
    expect(actions.calls).toEqual([
      `complete:${SESSION_A}`,
      `save:${SESSION_A}:calibration`,
    ]);
  });

  it('sends only the module summaries and coarse device buckets', async () => {
    const actions = fakeActions();
    await persistFit(actions, {
      profile: PROFILE,
      record: RECORD,
      source: 'recalibration',
    });
    expect(actions.startCalibrationSession).toHaveBeenCalledWith({
      device: DEVICE,
    });
    expect(actions.completeCalibrationSession).toHaveBeenCalledWith({
      id: SESSION_B,
      modules: RECORD.modules,
    });
    expect(actions.calls.at(-1)).toBe(`save:${SESSION_B}:recalibration`);
  });

  it('opens a fresh session once when the first one was already closed', async () => {
    let first = true;
    const actions = fakeActions({
      completeCalibrationSession: vi.fn(async (input) => {
        if (first) {
          first = false;
          return fail('not_found');
        }
        return {
          ok: true as const,
          data: {
            id: input.id,
            calibrationVersion: 'cal-1.0.0',
            startedAt: '2026-09-29T12:00:00.000Z',
            completedAt: '2026-09-29T12:06:00.000Z',
          },
        };
      }),
    });
    const outcome = await persistFit(actions, {
      profile: PROFILE,
      record: RECORD,
      source: 'calibration',
      sessionId: SESSION_A,
    });
    expect(outcome).toMatchObject({ kind: 'saved', sessionId: SESSION_B });
    expect(actions.completeCalibrationSession).toHaveBeenCalledTimes(2);
  });

  it('still saves the fit when the session cannot be recorded', async () => {
    const actions = fakeActions({
      startCalibrationSession: vi.fn(async () => fail('unavailable')),
    });
    const outcome = await persistFit(actions, {
      profile: PROFILE,
      record: RECORD,
      source: 'calibration',
    });
    expect(outcome).toMatchObject({ kind: 'saved', sessionId: null });
    expect(actions.saveFit).toHaveBeenCalledWith({
      profile: PROFILE,
      source: 'calibration',
      calibrationSessionId: null,
    });
  });

  it('reports a session that ended, at any step, as signed out', async () => {
    const atStart = fakeActions({
      startCalibrationSession: vi.fn(async () => fail('not_signed_in')),
    });
    expect(
      await persistFit(atStart, {
        profile: PROFILE,
        record: RECORD,
        source: 'calibration',
      }),
    ).toEqual({ kind: 'signed-out' });
    expect(atStart.saveFit).not.toHaveBeenCalled();

    const atComplete = fakeActions({
      completeCalibrationSession: vi.fn(async () => fail('not_signed_in')),
    });
    expect(
      await persistFit(atComplete, {
        profile: PROFILE,
        record: RECORD,
        source: 'calibration',
        sessionId: SESSION_A,
      }),
    ).toEqual({ kind: 'signed-out' });

    const atSave = fakeActions({
      saveFit: vi.fn(async () => fail('not_signed_in')),
    });
    expect(
      await persistFit(atSave, {
        profile: PROFILE,
        record: RECORD,
        source: 'calibration',
      }),
    ).toEqual({ kind: 'signed-out' });
  });

  it('returns the plain-language message when saving fails', async () => {
    const actions = fakeActions({
      saveFit: vi.fn(async () => fail('too_large')),
    });
    expect(
      await persistFit(actions, {
        profile: PROFILE,
        record: RECORD,
        source: 'calibration',
      }),
    ).toEqual({ kind: 'error', message: DATA_ERROR_MESSAGES.too_large });
  });

  it('turns a network failure into a calm error, never a throw', async () => {
    const actions = fakeActions({
      saveFit: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    expect(
      await persistFit(actions, {
        profile: PROFILE,
        record: RECORD,
        source: 'calibration',
      }),
    ).toEqual({ kind: 'error', message: UNREACHABLE_MESSAGE });
  });
});

describe('abandonSession', () => {
  it('marks an opened session abandoned and never throws', async () => {
    const actions = fakeActions();
    await abandonSession(actions, Promise.resolve(SESSION_A));
    expect(actions.calls).toEqual([`abandon:${SESSION_A}`]);

    const broken = fakeActions({
      abandonCalibrationSession: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    await expect(
      abandonSession(broken, Promise.resolve(SESSION_A)),
    ).resolves.toBeUndefined();
    await expect(
      abandonSession(actions, Promise.resolve(null)),
    ).resolves.toBeUndefined();
    await expect(abandonSession(actions, null)).resolves.toBeUndefined();
    expect(actions.calls).toHaveLength(1);
  });
});
