// @vitest-environment node
import type { AdaptEvent } from '@webable/core/learning/types';
import type { SentReceipt } from '@webable/core/bridge/protocol';
import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_WEEKS_MAX,
  addActivity,
  addDefect,
  addKeep,
  FIT_COUNTS_MAX,
  FIT_DEFECTS_MAX,
  normalizeFitLearning,
  normalizeSiteRecord,
  pruneTemplates,
  resetRule,
  TEMPLATES_PER_SITE,
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
  newSiteRecord,
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
  it('lists only sites with a rule, most recent first', async () => {
    const c = clock();
    const sites = new SiteStore(memoryArea(), c.now);
    await sites.update('visited.com', (s) => {
      s.lastVisit = c.now();
    });
    await sites.update('a.com', (s) => {
      s.lastVisit = c.now();
      s.rule.levels = { text_floor: 3 };
    });
    c.advance(1000);
    await sites.update('b.com', (s) => {
      s.lastVisit = c.now();
      s.rule.paused = true;
    });
    const list = listLocalSites(await sites.all());
    expect(list.map((s) => s.domain)).toEqual(['b.com', 'a.com']);
    expect(list[0]).toMatchObject({ paused: true, blocked: [], pinned: [] });
    expect(list[1]).toMatchObject({ levels: { text_floor: 3 } });
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
        ...newSiteRecord(0),
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
      aiLayout: false,
      needsReauth: false,
    });
  });
});

describe('clear local data', () => {
  it('removes site and personal data and rotates the install secret, keeping the account', async () => {
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
      aiLayout: false,
      productLearning: false,
      theme: 'system',
      onboardingStep: 'connected',
      needsReauth: false,
      connectedAt: 0,
      lastSyncAt: 0,
    });
    await stores.learning.update((rec) => ({
      ...rec,
      rev: 4,
      seededFor: 'account:3',
      pending: [{ v: 1, deltaId: 'delta-0001', day: 1, op: 'text_floor' }],
    }));
    await stores.activity.update((rec) =>
      addActivity(rec, T0, 'text_floor', 'applied', 2),
    );
    await clearLocalData(stores, T0);
    expect(await stores.learning.read()).toMatchObject({
      user: null,
      rev: 0,
      pending: [],
      seededFor: null,
      ownerUserId: 'u',
    });
    expect((await stores.activity.read()).weeks).toEqual({});
    expect(await stores.profile.read()).toMatchObject({
      source: 'default',
      version: null,
    });
    expect(await stores.sites.all()).toEqual({});
    expect(await stores.events.list()).toEqual([]);
    expect(await stores.receipts.list()).toEqual([]);
    expect(await stores.answers.size()).toBe(0);
    expect((await stores.install.get()).secret).not.toBe(before.secret);
    expect(await stores.account.read()).not.toBeNull();
  });
});

describe('v2 records', () => {
  it('keeps "Always here", template memory and Fit view stats on a site, normalised', () => {
    const rec = normalizeSiteRecord(
      {
        rule: { view: 'fit', pins: [], blocks: ['page_zoom'] },
        templates: {
          '0123456789abcdef': {
            at: 5,
            id: 'account:3',
            prior: {
              version: 'triage-1.0.0',
              needs: {
                text: 'compose',
                targets: 'fits',
                clutter: 'fits',
                occlusion: 'tailor',
                contrast: 'fits',
                motion: 'fits',
              },
              zoom: 1.5,
              blockers: ['paywall', 'made_up'],
            },
            zoom: { '8': 1.5, '9': 3, x: 1.25 },
          },
          'not-hex': { at: 1, id: 'x' },
          fedcba9876543210: {
            at: 1,
            id: 'account:3',
            prior: { version: 'v', needs: { text: 'huge' } },
          },
        },
        fitView: { keep: 3, undo: 99, offerDay: 20725, offerAccepted: true },
      },
      T0,
    );
    expect(rec.rule.view).toBe('fit');
    expect(rec.rule.blocks).toEqual(['page_zoom']);
    expect(Object.keys(rec.templates).sort()).toEqual([
      '0123456789abcdef',
      'fedcba9876543210',
    ]);
    expect(rec.templates['0123456789abcdef']).toEqual({
      at: 5,
      id: 'account:3',
      prior: {
        version: 'triage-1.0.0',
        needs: {
          text: 'compose',
          targets: 'fits',
          clutter: 'fits',
          occlusion: 'tailor',
          contrast: 'fits',
          motion: 'fits',
        },
        zoom: 1.5,
        blockers: ['paywall'],
      },
      zoom: { '8': 1.5 },
    });
    // A prior that is not one is dropped, the memo kept.
    expect(rec.templates.fedcba9876543210?.prior).toBeUndefined();
    expect(rec.fitView).toEqual({
      keep: 3,
      undo: 40,
      offerDay: 20725,
      offerAccepted: true,
    });
    expect(
      normalizeSiteRecord({ rule: { view: 'original' } }, T0).rule.view,
    ).toBe(undefined);
    expect(newSiteRecord(T0)).toMatchObject({
      templates: {},
      fitView: { keep: 0, undo: 0, offerDay: 0, offerAccepted: false },
    });
  });

  it('remembers at most 12 templates per site, most recent first', () => {
    const many = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [
        i.toString(16).padStart(16, '0'),
        { at: i, id: 'a' },
      ]),
    );
    const kept = pruneTemplates(many);
    expect(Object.keys(kept)).toHaveLength(TEMPLATES_PER_SITE);
    expect(Math.min(...Object.values(kept).map((m) => m.at))).toBe(8);
  });

  it('a reset rule drops "Always here"', () => {
    const rec = newSiteRecord(T0);
    rec.rule.view = 'fit';
    resetRule(rec, T0);
    expect(rec.rule.view).toBeUndefined();
  });

  it('settings: the dev planner switch and the Fit view text override', () => {
    expect(normalizeSettings({})).toMatchObject({
      devPlanner: false,
      fitTextStep: 0,
    });
    expect(
      normalizeSettings({ devPlanner: true, fitTextStep: 2.6 }),
    ).toMatchObject({ devPlanner: true, fitTextStep: 3 });
    expect(normalizeSettings({ fitTextStep: 99 }).fitTextStep).toBe(4);
    expect(normalizeSettings({ fitTextStep: -99 }).fitTextStep).toBe(-4);
    expect(normalizeSettings({ fitTextStep: 'big' }).fitTextStep).toBe(0);
  });

  it('settings: busy pages are simplified automatically unless turned off; the intro is shown once', () => {
    expect(normalizeSettings({})).toMatchObject({
      autoSimplify: true,
      simplifyIntroShown: false,
    });
    expect(
      normalizeSettings({ autoSimplify: false, simplifyIntroShown: true }),
    ).toMatchObject({ autoSimplify: false, simplifyIntroShown: true });
    expect(normalizeSettings({ autoSimplify: 'no' }).autoSimplify).toBe(true);
  });

  it('the account mirror carries the layout-planning consent, off unless stored', () => {
    const base = { userId: 'u', email: 'a@b.co' };
    expect(normalizeAccount(base)?.aiLayout).toBe(false);
    expect(normalizeAccount({ ...base, aiLayout: true })?.aiLayout).toBe(true);
    expect(normalizeAccount({ ...base, aiLayout: 'yes' })?.aiLayout).toBe(
      false,
    );
  });

  it('keeps layout-planning receipts next to page-analysis ones', async () => {
    const log = new ReceiptLog(memoryArea(), () => T0);
    await log.add({ ...receipt(1, T0), destination: 'layout_planning' });
    await log.add(receipt(2, T0));
    await log.add({
      ...receipt(3, T0),
      destination: 'somewhere_else' as 'page_analysis',
    });
    expect((await log.list()).map((r) => r.destination).sort()).toEqual([
      'layout_planning',
      'page_analysis',
    ]);
  });
});

describe('Fit view learning', () => {
  it('counts keep and undo, halving old evidence past the cap', () => {
    let c = { keep: 0, undo: 0 };
    for (let i = 0; i < FIT_COUNTS_MAX; i++) c = addKeep(c, i % 4 !== 0);
    expect(c).toEqual({ keep: 30, undo: 10 });
    c = addKeep(c, false);
    expect(c).toEqual({ keep: 15, undo: 5.5 });
  });

  it('logs at most 50 recent defects, never naming a site', () => {
    let rec = normalizeFitLearning(null);
    for (let i = 0; i < 60; i++)
      rec = addDefect(
        rec,
        {
          at: T0 + i,
          kind: 'proxy_failed',
          source: 'heuristic',
          cat: 'article',
        },
        T0 + i,
      );
    expect(rec.defects).toHaveLength(FIT_DEFECTS_MAX);
    expect(rec.defects[0]?.at).toBe(T0 + 10);
    rec = addDefect(
      rec,
      {
        at: T0 + 40 * DAY,
        kind: 'conservation_failed',
        source: 'planner',
        cat: 'feed_social',
        missing: 2,
      },
      T0 + 40 * DAY,
    );
    expect(rec.defects).toHaveLength(1);
    expect(
      normalizeFitLearning({
        pageTypes: { article: { keep: 2, undo: 1 }, nonsense: { keep: 1 } },
        defects: [
          {
            at: 1,
            kind: 'proxy_failed',
            source: 'planner',
            cat: 'article',
            role: 'map',
          },
          { at: 1, kind: 'other', source: 'planner', cat: 'article' },
        ],
      }),
    ).toEqual({
      pageTypes: { article: { keep: 2, undo: 1 } },
      defects: [
        { at: 1, kind: 'proxy_failed', source: 'planner', cat: 'article' },
      ],
    });
  });
});
