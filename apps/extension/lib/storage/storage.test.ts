// @vitest-environment node
import type { AdaptEvent } from '@webable/core/learning/types';
import type { SentReceipt } from '@webable/core/bridge/protocol';
import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_WEEKS_MAX,
  addActivity,
  AnswerCache,
  appendEvents,
  clearLocalData,
  createStores,
  EVENT_MAX,
  EVENT_MAX_AGE_MS,
  EventLog,
  InstallStore,
  isoMonday,
  JsonStore,
  KEYS,
  KeyedMutex,
  listLocalSites,
  memoryArea,
  normalizeAccount,
  normalizeLevels,
  normalizeSettings,
  pruneSites,
  RECEIPT_MAX,
  RECEIPT_MAX_AGE_MS,
  ReceiptLog,
  SITE_IDLE_MS,
  SiteStore,
  subtractFlushed,
  type ActivityRecord,
  type CachedAnswer,
  type SiteMap,
} from './index';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 29, 12);

function clock(start = T0) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

function event(i: number, t: number, domain = 'example.com'): AdaptEvent {
  return {
    v: 1,
    id: `e${i}`,
    t,
    tabSession: 's',
    domain,
    cat: 'article',
    op: 'text_floor',
    opVer: 1,
    level: 2,
    src: 'profile',
    kind: 'applied',
  };
}

function receipt(i: number, at: number, domain = 'example.com'): SentReceipt {
  return {
    id: `r${i}`,
    at,
    domain,
    destination: 'page_analysis',
    bytes: 10,
    body: { v: 1 },
  };
}

const region = (task = 0.1): CachedAnswer => ({
  kind: 'region',
  answer: {
    role: {
      promo_ad: 0.9,
      recommendations: 0.02,
      chat_widget: 0.01,
      main_content: 0.01,
      navigation: 0.01,
      consent_banner: 0.01,
      help_contact: 0.01,
      form: 0.01,
      footer: 0.01,
      other: 0.01,
    },
    task,
  },
});
const hkey = (i: number) => i.toString(16).padStart(32, '0');

describe('KeyedMutex and JsonStore', () => {
  it('serialises read-modify-write per key, so concurrent updates never lose writes', async () => {
    const area = memoryArea();
    const store = new JsonStore<number>(area, 'n', (raw) =>
      typeof raw === 'number' ? raw : 0,
    );
    await Promise.all(
      Array.from({ length: 50 }, () => store.update((n) => n + 1)),
    );
    expect(await store.read()).toBe(50);
  });

  it('keeps running after a failed update', async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];
    const failing = mutex.run('k', async () => {
      order.push('a');
      throw new Error('boom');
    });
    const next = mutex.run('k', async () => {
      order.push('b');
      return 1;
    });
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe(1);
    expect(order).toEqual(['a', 'b']);
  });

  it('turns corrupt stored values into valid defaults', async () => {
    const area = memoryArea({ [KEYS.settings]: 'garbage' });
    const stores = createStores(area);
    expect(await stores.settings.read()).toEqual(normalizeSettings(undefined));
  });
});

describe('install identity', () => {
  it('is generated once: a uuid and a 256-bit secret', async () => {
    const area = memoryArea();
    const a = await new InstallStore(area).get();
    const b = await new InstallStore(area).get();
    expect(a).toEqual(b);
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('is created exactly once under concurrent first reads', async () => {
    const area = memoryArea();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => new InstallStore(area).get()),
    );
    expect(new Set(results.map((r) => r.secret)).size).toBe(1);
  });

  it('rotates the secret but keeps the id', async () => {
    const store = new InstallStore(memoryArea());
    const before = await store.get();
    const after = await store.rotateSecret();
    expect(after.id).toBe(before.id);
    expect(after.secret).not.toBe(before.secret);
  });

  it('replaces a malformed record', async () => {
    const area = memoryArea({ [KEYS.install]: { id: 'x', secret: 'short' } });
    const got = await new InstallStore(area).get();
    expect(got.secret).toHaveLength(43);
  });
});

describe('site records', () => {
  it('creates, updates and lists sites most recent first', async () => {
    const c = clock();
    const sites = new SiteStore(memoryArea(), c.now);
    await sites.update('a.com', (s) => {
      s.lastVisit = c.now();
    });
    c.advance(1000);
    await sites.update('b.com', (s) => {
      s.lastVisit = c.now();
      s.rule.paused = true;
    });
    const list = listLocalSites(await sites.all());
    expect(list.map((s) => s.domain)).toEqual(['b.com', 'a.com']);
    expect(list[0]).toMatchObject({ paused: true, blocked: [], pinned: [] });
  });

  it('rejects keys that are not a host', async () => {
    const sites = new SiteStore(memoryArea());
    await expect(
      sites.update('https://a.com/path', () => undefined),
    ).rejects.toThrow();
  });

  it('drops idle sites and caps at 500 by last use (LRU)', () => {
    const now = T0;
    const map: SiteMap = {};
    for (let i = 0; i < 510; i++) {
      map[`s${i}.com`] = {
        rule: { paused: false, pins: [], blocks: [], levels: {}, updatedAt: 0 },
        state: { t: 0, ops: {}, dims: {} },
        lastVisit: 0,
        lastChanges: 0,
        announced: false,
        levelMemo: null,
        at: now - i * 1000,
      };
    }
    map['old.com'] = { ...map['s0.com']!, at: now - SITE_IDLE_MS - 1 };
    const pruned = pruneSites(map, now);
    expect(Object.keys(pruned)).toHaveLength(500);
    expect(pruned['old.com']).toBeUndefined();
    expect(pruned['s0.com']).toBeDefined();
    expect(pruned['s509.com']).toBeUndefined();
  });

  it('normalises stored rules: unknown ops and bad levels go', async () => {
    const area = memoryArea({
      [KEYS.sites]: {
        'a.com': {
          rule: {
            paused: 'yes',
            pins: ['text_floor', 'nope'],
            blocks: [],
            levels: { text_floor: 99, bogus: 1 },
          },
        },
      },
    });
    const rec = await new SiteStore(area).get('a.com');
    expect(rec.rule.paused).toBe(false);
    expect(rec.rule.pins).toEqual(['text_floor']);
    expect(rec.rule.levels).toEqual({ text_floor: 8 });
  });

  it('forgets a site', async () => {
    const sites = new SiteStore(memoryArea());
    await sites.update('a.com', () => undefined);
    await sites.forget('a.com');
    expect(await sites.all()).toEqual({});
  });
});

describe('event log ring', () => {
  it('keeps at most 500 events and nothing older than 30 days', () => {
    const now = T0;
    const old = [event(0, now - EVENT_MAX_AGE_MS - 1)];
    const many = Array.from({ length: EVENT_MAX + 20 }, (_, i) =>
      event(i + 1, now - i),
    );
    const out = appendEvents(old, many, now);
    expect(out).toHaveLength(EVENT_MAX);
    expect(out.some((e) => e.id === 'e0')).toBe(false);
    // Oldest first; the newest survive.
    expect(out[out.length - 1]!.t).toBe(now);
  });

  it('forgets one domain', async () => {
    const c = clock();
    const log = new EventLog(memoryArea(), c.now);
    await log.append([event(1, T0, 'a.com'), event(2, T0, 'b.com')]);
    await log.forgetDomain('a.com');
    expect((await log.list()).map((e) => e.domain)).toEqual(['b.com']);
  });
});

describe('receipts', () => {
  it('keeps the last 50 within 7 days, newest first', async () => {
    const c = clock();
    const log = new ReceiptLog(memoryArea(), c.now);
    await log.add(receipt(0, T0 - RECEIPT_MAX_AGE_MS - 1));
    for (let i = 1; i <= RECEIPT_MAX + 5; i++)
      await log.add(receipt(i, T0 - 1000 + i));
    const list = await log.list();
    expect(list).toHaveLength(RECEIPT_MAX);
    expect(list[0]!.id).toBe(`r${RECEIPT_MAX + 5}`);
    expect(list.some((r) => r.id === 'r0')).toBe(false);
  });
});

describe('answer cache', () => {
  it('stores and returns answers under HMAC keys', async () => {
    const c = clock();
    const cache = new AnswerCache(memoryArea(), c.now);
    await cache.putMany([[hkey(1), region()]], 'site1');
    const got = await cache.getMany([hkey(1), hkey(2), 'not-a-key']);
    expect([...got.keys()]).toEqual([hkey(1)]);
    expect(got.get(hkey(1))).toEqual(region());
  });

  it('expires answers after 14 days', async () => {
    const c = clock();
    const area = memoryArea();
    const cache = new AnswerCache(area, c.now);
    await cache.putMany([[hkey(1), region()]]);
    c.advance(15 * DAY);
    expect((await cache.getMany([hkey(1)])).size).toBe(0);
    expect(
      Object.keys(area.dump()).some((k) => k.startsWith(KEYS.answerPrefix)),
    ).toBe(false);
  });

  it('evicts the least recently used beyond the cap', async () => {
    const c = clock();
    const area = memoryArea();
    const cache = new AnswerCache(area, c.now, 3);
    for (let i = 1; i <= 3; i++) {
      await cache.putMany([[hkey(i), region()]]);
      c.advance(10);
    }
    await cache.getMany([hkey(1)]); // touch 1: now 2 is the oldest
    c.advance(10);
    await cache.putMany([[hkey(4), region()]]);
    expect(await cache.size()).toBe(3);
    const got = await cache.getMany([hkey(1), hkey(2), hkey(3), hkey(4)]);
    expect([...got.keys()].sort()).toEqual([hkey(1), hkey(3), hkey(4)].sort());
  });

  it('refuses invalid answers and forgets a site', async () => {
    const c = clock();
    const cache = new AnswerCache(memoryArea(), c.now);
    await cache.putMany(
      [
        [
          hkey(1),
          {
            kind: 'region',
            answer: { role: { promo_ad: 3 }, task: 0 },
          } as never,
        ],
        [hkey(2), region()],
      ],
      'siteA',
    );
    await cache.putMany([[hkey(3), region()]], 'siteB');
    expect((await cache.getMany([hkey(1)])).size).toBe(0);
    await cache.forgetSite('siteA');
    const left = await cache.getMany([hkey(2), hkey(3)]);
    expect([...left.keys()]).toEqual([hkey(3)]);
  });
});

describe('weekly activity', () => {
  it('buckets by ISO Monday (UTC)', () => {
    expect(isoMonday(Date.UTC(2026, 8, 29))).toBe('2026-09-28'); // a Tuesday
    expect(isoMonday(Date.UTC(2026, 8, 28))).toBe('2026-09-28');
    expect(isoMonday(Date.UTC(2026, 9, 4, 23))).toBe('2026-09-28'); // Sunday
  });

  it('adds, keeps 26 weeks, and subtracts what was flushed', () => {
    let rec: ActivityRecord = { weeks: {} };
    for (let w = 0; w < ACTIVITY_WEEKS_MAX + 2; w++)
      rec = addActivity(rec, T0 - w * 7 * DAY, 'text_floor', 'applied');
    expect(Object.keys(rec.weeks)).toHaveLength(ACTIVITY_WEEKS_MAX);
    const week = isoMonday(T0);
    rec = addActivity(rec, T0, 'text_floor', 'applied');
    const flushed = { text_floor: { ...rec.weeks[week]!.text_floor! } };
    rec = addActivity(rec, T0, 'text_floor', 'undone'); // arrives during the flush
    rec = subtractFlushed(rec, week, flushed);
    expect(rec.weeks[week]!.text_floor).toMatchObject({
      applied: 0,
      undone: 1,
    });
  });
});

describe('settings and account', () => {
  it('clamps levels into each op ladder', () => {
    expect(
      normalizeLevels({ text_floor: -3, line_spacing: 2.6, nope: 1 }),
    ).toEqual({
      text_floor: 0,
      line_spacing: 3,
    });
  });

  it('requires an id and an email for an account mirror', () => {
    expect(normalizeAccount({ userId: 'u' })).toBeNull();
    expect(
      normalizeAccount({ userId: 'u', email: 'a@b.c', theme: 'neon' }),
    ).toMatchObject({
      theme: 'system',
      cloudAnalysis: false,
      needsReauth: false,
    });
  });
});

describe('clear local data', () => {
  it('removes site data and rotates the install secret, keeping the account', async () => {
    const c = clock();
    const area = memoryArea();
    const stores = createStores(area, c.now);
    const before = await stores.install.get();
    await stores.sites.update('a.com', () => undefined);
    await stores.events.append([event(1, T0)]);
    await stores.receipts.add(receipt(1, T0));
    await stores.answers.putMany([[hkey(1), region()]]);
    await stores.account.write({
      userId: 'u',
      email: 'a@b.c',
      cloudAnalysis: true,
      productLearning: false,
      theme: 'system',
      onboardingStep: 'connected',
      needsReauth: false,
      connectedAt: 0,
      lastSyncAt: 0,
    });
    await clearLocalData(stores);
    expect(await stores.sites.all()).toEqual({});
    expect(await stores.events.list()).toEqual([]);
    expect(await stores.receipts.list()).toEqual([]);
    expect(await stores.answers.size()).toBe(0);
    expect((await stores.install.get()).secret).not.toBe(before.secret);
    expect(await stores.account.read()).not.toBeNull();
  });
});
