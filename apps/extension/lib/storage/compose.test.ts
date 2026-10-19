// @vitest-environment node
import {
  govuk,
  wikipedia,
  youtube,
} from '@webable/core/compose/__fixtures__/index';
import { heuristicSpec } from '@webable/core/compose/heuristic';
import type { StoredSpec } from '@webable/core/compose/spec';
import { validateSpec } from '@webable/core/compose/validate';
import { toStoredSpec } from '@webable/core/skeleton/locate';
import type { Skeleton } from '@webable/core/skeleton/types';
import {
  COMPOSE_PINNED_MODEL,
  COMPOSE_SCHEMA_VERSION,
} from '@webable/core/versions';
import { describe, expect, it } from 'vitest';

import { memoryArea } from './area';
import {
  COMPOSE_LRU_MAX,
  COMPOSE_TTL_MS,
  ComposeCache,
  isStoredSpec,
} from './compose';
import { KEYS } from './keys';
import { clearLocalData, createStores } from './index';

const T0 = Date.UTC(2026, 9, 15, 12);
const DAY = 86_400_000;

function clock(start = T0) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

const key = (i: number): string => i.toString(16).padStart(32, '0');

function stored(from: Skeleton, createdAt: number): StoredSpec {
  return toStoredSpec(
    validateSpec(heuristicSpec(from), from)!,
    from,
    () => 'ab12cd34ef56ab12',
    { schema: COMPOSE_SCHEMA_VERSION, model: COMPOSE_PINNED_MODEL, createdAt },
  );
}

describe('planner spec cache', () => {
  it('keeps up to 3 variants per template, newest first', async () => {
    const c = clock();
    const cache = new ComposeCache(memoryArea(), c.now);
    const k = key(1);
    for (let i = 0; i < 4; i++) {
      await cache.put(k, 'site-a', stored(govuk, T0 + i));
      c.advance(10);
    }
    const variants = await cache.get(k);
    expect(variants.map((v) => v.createdAt)).toEqual([T0 + 3, T0 + 2, T0 + 1]);
    // The same plan again replaces itself, it does not add a variant.
    await cache.put(k, 'site-a', stored(govuk, T0 + 3));
    expect((await cache.get(k)).map((v) => v.createdAt)).toEqual([
      T0 + 3,
      T0 + 2,
      T0 + 1,
    ]);
    expect(await cache.size()).toBe(1);
    expect(await cache.bytes()).toBeGreaterThan(0);
    // Locators, structure and HMACs only: no page words.
    const raw = JSON.stringify(await cache.get(k));
    expect(raw).not.toMatch(/Universal Credit|Apply|gov\.uk/i);
  });

  it('forgets a plan 14 days after it was made', async () => {
    const c = clock();
    const cache = new ComposeCache(memoryArea(), c.now);
    await cache.put(key(1), 's', stored(govuk, T0));
    c.advance(10 * DAY);
    await cache.put(key(1), 's', stored(govuk, c.now()));
    c.advance(5 * DAY);
    expect((await cache.get(key(1))).map((v) => v.createdAt)).toEqual([
      T0 + 10 * DAY,
    ]);
    c.advance(COMPOSE_TTL_MS);
    expect(await cache.get(key(1))).toEqual([]);
    expect(await cache.size()).toBe(0);
  });

  it('is an LRU of 150 templates within a byte budget', async () => {
    const c = clock();
    const area = memoryArea();
    const cache = new ComposeCache(area, c.now);
    for (let i = 0; i <= COMPOSE_LRU_MAX; i++) {
      await cache.put(key(i), 's', stored(govuk, c.now()));
      c.advance(1);
      // Keep the first one in use.
      if (i % 50 === 0) await cache.get(key(0));
    }
    expect(await cache.size()).toBe(COMPOSE_LRU_MAX);
    expect(await cache.get(key(0))).toHaveLength(1);
    expect(await cache.get(key(1))).toEqual([]);
    const stray = Object.keys(await area.getAll()).filter((k) =>
      k.startsWith(KEYS.composePrefix),
    );
    expect(stray).toHaveLength(COMPOSE_LRU_MAX);

    // A small byte budget: the least recently used go first.
    const one = new TextEncoder().encode(
      JSON.stringify({ site: 's', variants: [stored(wikipedia, c.now())] }),
    ).byteLength;
    const tiny = new ComposeCache(memoryArea(), c.now, {
      max: 150,
      bytes: 3 * one + 16,
      ttl: COMPOSE_TTL_MS,
    });
    for (let i = 0; i < 5; i++) {
      await tiny.put(key(i), 's', stored(wikipedia, c.now()));
      c.advance(1);
    }
    expect(await tiny.size()).toBe(3);
    expect(await tiny.get(key(0))).toEqual([]);
    expect(await tiny.get(key(4))).toHaveLength(1);
    expect(await tiny.bytes()).toBeLessThanOrEqual(3 * one + 16);
  });

  it('evicts a variant that failed, or a whole template', async () => {
    const cache = new ComposeCache(memoryArea(), () => T0);
    await cache.put(key(1), 's', stored(govuk, T0 - 2));
    await cache.put(key(1), 's', stored(youtube, T0 - 1));
    await cache.evict(key(1), T0 - 1);
    expect((await cache.get(key(1))).map((v) => v.createdAt)).toEqual([T0 - 2]);
    await cache.evict(key(1), T0 - 2);
    expect(await cache.size()).toBe(0);
    await cache.put(key(2), 's', stored(govuk, T0));
    await cache.evict(key(2));
    expect(await cache.get(key(2))).toEqual([]);
    // Unknown keys and variants are no-ops.
    await cache.evict(key(3), 5);
    await cache.evict('not-a-key');
  });

  it('forgets one site, or everything', async () => {
    const area = memoryArea();
    const cache = new ComposeCache(area, () => T0);
    await cache.put(key(1), 'site-a', stored(govuk, T0));
    await cache.put(key(2), 'site-b', stored(govuk, T0));
    await cache.forgetSite('site-a');
    expect(await cache.get(key(1))).toEqual([]);
    expect(await cache.get(key(2))).toHaveLength(1);
    await cache.clear();
    expect(await area.getAll()).toEqual({});
  });

  it('drops anything that is not a stored spec', async () => {
    const area = memoryArea();
    const cache = new ComposeCache(area, () => T0);
    const good = stored(govuk, T0);
    await area.set({
      [KEYS.composePrefix + key(1)]: { site: 's', variants: ['nope', good] },
      [KEYS.composePrefix + key(2)]: { variants: [good] },
      [KEYS.composeIndex]: {
        [key(1)]: { at: T0, stored: T0, bytes: 1, site: 's' },
      },
    });
    expect(await cache.get(key(1))).toEqual([good]);
    expect(await cache.get(key(2))).toEqual([]);
    expect(await cache.get('../escape')).toEqual([]);

    expect(isStoredSpec(good)).toBe(true);
    const section = good.sections[0]!;
    const withSection = (s: unknown) => ({ ...good, sections: [s] });
    expect(isStoredSpec({ ...good, page_type: 'blog' })).toBe(false);
    expect(isStoredSpec({ ...good, sections: [] })).toBe(false);
    expect(
      isStoredSpec(
        withSection({ ...section, nodes: [{ path: ['div'], kind: 'widget' }] }),
      ),
    ).toBe(false);
    expect(
      isStoredSpec(
        withSection({
          ...section,
          nodes: [{ path: ['div'], kind: 'group', name: 'Sign in' }],
        }),
      ),
    ).toBe(false);
    expect(
      isStoredSpec(
        withSection({ ...section, nodes: [{ path: [], kind: 'group' }] }),
      ),
    ).toBe(false);
    expect(isStoredSpec(withSection({ ...section, importance: 'top' }))).toBe(
      false,
    );
    // v1 layouts and collections without the art direction are dropped.
    expect(isStoredSpec(withSection({ ...section, layout: 'grid' }))).toBe(
      false,
    );
    const list = good.collections[0]!;
    expect(list).toMatchObject({ card: 'link', media: 'none', lead: 'none' });
    const withList = (c: unknown) => ({ ...good, collections: [c] });
    expect(isStoredSpec(withList(list))).toBe(true);
    for (const k of ['card', 'media', 'lead'] as const) {
      const { [k]: _, ...missing } = list;
      expect(isStoredSpec(withList(missing)), k).toBe(false);
      expect(isStoredSpec(withList({ ...list, [k]: 'wide' })), k).toBe(false);
    }
  });

  it('goes with "Clear data on this device", with Fit view’s local learning', async () => {
    const area = memoryArea();
    const stores = createStores(area, () => T0);
    await stores.compose.put(key(1), 's', stored(govuk, T0));
    await stores.fitLearning.update((rec) => ({
      ...rec,
      pageTypes: { article: { keep: 2, undo: 1 } },
    }));
    await clearLocalData(stores, T0);
    expect(await stores.compose.size()).toBe(0);
    expect((await stores.fitLearning.read()).pageTypes).toEqual({});
  });
});
