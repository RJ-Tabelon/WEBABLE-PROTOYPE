import { describe, expect, it } from 'vitest';
import { HERO_DRAWN_KEY, claimHeroDraw, type DrawStorage } from './hero-draw';

function memoryStore(): DrawStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('claimHeroDraw', () => {
  it('draws on the first view of a session and records it', () => {
    const store = memoryStore();
    expect(claimHeroDraw(store)).toBe(true);
    expect(store.data.get(HERO_DRAWN_KEY)).toBe('1');
  });

  it('is static on every later view in the same session', () => {
    const store = memoryStore();
    claimHeroDraw(store);
    expect(claimHeroDraw(store)).toBe(false);
    expect(claimHeroDraw(store)).toBe(false);
  });

  it('draws when storage is missing', () => {
    expect(claimHeroDraw(null)).toBe(true);
    expect(claimHeroDraw(undefined)).toBe(true);
  });

  it('draws when storage throws on read or write', () => {
    const throwsOnRead: DrawStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    };
    const throwsOnWrite: DrawStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(claimHeroDraw(throwsOnRead)).toBe(true);
    expect(claimHeroDraw(throwsOnWrite)).toBe(true);
  });
});
