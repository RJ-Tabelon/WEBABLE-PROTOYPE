import { defaultFitProfile } from '@webable/core';
import { describe, expect, it } from 'vitest';

import { buildRecord } from './record';
import {
  clearPendingFit,
  clearProgress,
  PENDING_FIT_KEY,
  PROGRESS_KEY,
  readPendingFit,
  readProgress,
  writePendingFit,
  writeProgress,
  type KeyValueStore,
} from './storage';

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const NOW = new Date('2026-09-29T12:00:00.000Z');
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

describe('pending fit', () => {
  it('round-trips a fit made while signed out', () => {
    const store = memory();
    const profile = defaultFitProfile(undefined, NOW);
    const record = buildRecord({
      device: DEVICE,
      modules: {},
      startedAt: NOW.toISOString(),
      completedAt: NOW.toISOString(),
    });
    expect(
      writePendingFit({ profile, record, source: 'calibration' }, NOW, store),
    ).toBe(true);
    const read = readPendingFit(NOW, store);
    expect(read?.profile).toEqual(profile);
    expect(read?.source).toBe('calibration');
    clearPendingFit(store);
    expect(store.data.has(PENDING_FIT_KEY)).toBe(false);
  });

  it('ignores tampered, unversioned or expired entries', () => {
    const store = memory();
    store.setItem(PENDING_FIT_KEY, '{not json');
    expect(readPendingFit(NOW, store)).toBeNull();
    store.setItem(PENDING_FIT_KEY, JSON.stringify({ v: 2 }));
    expect(readPendingFit(NOW, store)).toBeNull();
    const profile = defaultFitProfile(undefined, NOW);
    const record = buildRecord({
      device: DEVICE,
      modules: {},
      startedAt: NOW.toISOString(),
      completedAt: null,
    });
    writePendingFit(
      { profile, record, source: 'calibration' },
      new Date('2026-07-01T00:00:00Z'),
      store,
    );
    expect(readPendingFit(NOW, store)).toBeNull();
  });

  it('survives storage that throws', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readPendingFit(NOW, broken)).toBeNull();
    expect(() => clearPendingFit(broken)).not.toThrow();
    expect(readPendingFit(NOW, null)).toBeNull();
  });
});

describe('saved progress', () => {
  it('keeps summaries and where to pick up, never raw trials', () => {
    const store = memory();
    const stash = {
      setup: {
        input: 'mouse' as const,
        assistive: 'none' as const,
        reducedMotion: false,
        forcedColors: false,
        recalibrate: false,
      },
      startedAt: NOW.toISOString(),
      summaries: {},
      outcomes: {
        reading: 'done' as const,
        pointing: 'pending' as const,
        focus: 'pending' as const,
      },
      resumeModule: 'pointing' as const,
    };
    writeProgress(stash, NOW, store);
    const raw = store.data.get(PROGRESS_KEY) ?? '';
    expect(raw).not.toMatch(/ladder|trials|samples/);
    expect(readProgress(NOW, store)).toEqual(stash);
    clearProgress(store);
    expect(readProgress(NOW, store)).toBeNull();
  });
});
