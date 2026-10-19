// @vitest-environment node
import {
  initialLearningState,
  mergeDeltas,
} from '@webable/core/learning/learners';
import type {
  LearnDelta,
  UserLearningState,
} from '@webable/core/learning/types';
import {
  FIXTURE_DAY,
  FIXTURE_NOW,
  strongReaderProfile,
} from '@webable/core/policy/fixtures';
import { needLevels } from '@webable/core/profile/needs';
import { describe, expect, it } from 'vitest';

import { memoryArea } from '../storage/area';
import { createStores } from '../storage';
import { addActivity } from '../storage/activity';
import type { AuthService } from './auth';
import { AccountSync, lastSuccessfulSync, platformBucket } from './sync';

/**
 * AccountSync against a fake Supabase client that records every call and
 * answers from scripted rows. Nothing sent may carry a domain or a URL.
 */

type Row = Record<string, unknown> | null;

interface Script {
  account?: Row;
  profile?: Row;
  learning?: Row;
  /** Replies of put_learning_state, in order. */
  puts?: Array<{ ok: boolean; rev: number }>;
  /** False once this install's row was removed on the web. */
  installRow?: boolean;
}

function fakeDb(script: Script) {
  const calls: Array<{
    kind: string;
    table?: string;
    fn?: string;
    args?: unknown;
  }> = [];
  const puts = [...(script.puts ?? [])];
  const rowFor = (table: string): Row =>
    table === 'accounts'
      ? (script.account ?? null)
      : table === 'fit_profiles'
        ? (script.profile ?? null)
        : table === 'learning_state'
          ? (script.learning ?? null)
          : null;
  const builder = (table: string) => {
    const b = {
      select: (cols: string) => {
        calls.push({ kind: 'select', table, args: cols });
        return b;
      },
      eq: () => b,
      maybeSingle: async () => ({ data: rowFor(table), error: null }),
      upsert: async (row: unknown) => {
        calls.push({ kind: 'upsert', table, args: row });
        return { error: null };
      },
      update: (row: unknown) => {
        calls.push({ kind: 'update', table, args: row });
        const u = {
          eq: () => u,
          select: async () => ({
            data: script.installRow === false ? [] : [{ id: 'install' }],
            error: null,
          }),
        };
        return u;
      },
    };
    return b;
  };
  const client = {
    from: (table: string) => builder(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ kind: 'rpc', fn, args });
      if (fn === 'put_learning_state') {
        const next = puts.shift() ?? { ok: true, rev: 1 };
        if (next.ok) script.learning = { state: args.p_state, rev: next.rev };
        return { data: [{ ...next, state: args.p_state }], error: null };
      }
      return { data: null, error: null };
    },
  };
  return { client, calls };
}

/** The signed-in person, switchable between accounts. */
interface Who {
  id: string;
  email: string;
  signedOut: number;
}

function auth(client: unknown, who: Who): AuthService {
  return {
    client: client as AuthService['client'],
    async accessToken() {
      return 'jwt';
    },
    async session() {
      if (who.id === '') return null;
      return { user: { id: who.id, email: who.email } } as Awaited<
        ReturnType<AuthService['session']>
      >;
    },
    async connect() {
      return { ok: true, userId: who.id, email: who.email };
    },
    async signOut() {
      who.signedOut += 1;
      who.id = '';
    },
    async refresh() {
      return 'ok';
    },
    async refreshNow() {
      return true;
    },
    onLost() {},
  };
}

const delta = (i: number): LearnDelta => ({
  v: 1,
  deltaId: `delta-${String(i).padStart(4, '0')}`,
  day: FIXTURE_DAY,
  op: 'text_floor',
  ds: 1,
});

function setup(script: Script) {
  const stores = createStores(memoryArea(), () => FIXTURE_NOW);
  const db = fakeDb(script);
  const who: Who = { id: 'u1', email: 'person@example.com', signedOut: 0 };
  const sync = new AccountSync({
    stores,
    auth: auth(db.client, who),
    now: () => FIXTURE_NOW,
    version: '0.1.0',
    platform: 'macos',
  });
  return { stores, sync, db, script, who };
}

describe('account sync', () => {
  it('pulls consents and the current fit, and registers this install without device ids', async () => {
    const profile = strongReaderProfile();
    const { stores, sync, db } = setup({
      account: {
        cloud_analysis: true,
        ai_layout: true,
        product_learning: false,
        theme: 'dark',
        onboarding_step: 'tuned',
      },
      profile: { version: 3, profile },
    });
    const result = await sync.connected('u1', 'person@example.com');
    expect(result.profileChanged).toBe(true);
    expect(await stores.account.read()).toMatchObject({
      userId: 'u1',
      cloudAnalysis: true,
      aiLayout: true,
      theme: 'dark',
      needsReauth: false,
    });
    expect(await stores.profile.read()).toMatchObject({
      source: 'account',
      version: 3,
    });
    const install = db.calls.find(
      (c) => c.table === 'extension_installs' && c.kind === 'upsert',
    );
    expect(install?.args).toMatchObject({
      browser: 'chrome',
      platform: 'macos',
      user_id: 'u1',
    });
    expect(Object.keys(install?.args as object).sort()).toEqual(
      [
        'browser',
        'extension_version',
        'id',
        'last_seen_at',
        'platform',
        'user_id',
      ].sort(),
    );
  });

  it('a new device adopts the learning the account already has', async () => {
    const profile = strongReaderProfile();
    const server = initialLearningState(
      profile,
      needLevels(profile),
      FIXTURE_DAY,
    );
    server.ops.text_floor.accepts = 3;
    const { stores, sync, db } = setup({
      profile: { version: 1, profile },
      learning: { state: server, rev: 7 },
    });
    await sync.connected('u1', 'person@example.com');
    const rec = await stores.learning.read();
    expect(rec.rev).toBe(7);
    expect(rec.user?.ops.text_floor.accepts).toBe(3);
    expect(db.calls.some((c) => c.fn === 'put_learning_state')).toBe(false);
  });

  it('ignores a profile that fails the schema', async () => {
    const { stores, sync } = setup({
      profile: { version: 9, profile: { v: 2, nonsense: true } },
    });
    await sync.connected('u1', 'person@example.com');
    expect(await stores.profile.read()).toBeNull();
  });

  it('pushes learning with optimistic concurrency, retrying after a conflict', async () => {
    const profile = strongReaderProfile();
    const needs = needLevels(profile);
    const server = initialLearningState(profile, needs, FIXTURE_DAY);
    const { stores, sync, db, script } = setup({
      profile: { version: 1, profile },
      learning: { state: server, rev: 4 },
      puts: [
        { ok: false, rev: 5 },
        { ok: true, rev: 6 },
      ],
    });
    await sync.connected('u1', 'person@example.com');
    // Local deltas arrive (domain-free), then the next sync pushes them.
    await stores.learning.update((rec) => ({
      ...rec,
      pending: [delta(1), delta(2)],
    }));
    script.learning = { state: server, rev: 5 };
    await sync.refresh();
    const puts = db.calls.filter((c) => c.fn === 'put_learning_state');
    expect(puts.length).toBeGreaterThanOrEqual(2);
    const rec = await stores.learning.read();
    expect(rec.rev).toBe(6);
    expect(rec.pending).toEqual([]);
    for (const call of db.calls)
      expect(JSON.stringify(call.args ?? '')).not.toMatch(
        /example\.com|https?:\/\//,
      );
  });

  it('flushes weekly counts and subtracts what was sent', async () => {
    const { stores, sync, db } = setup({});
    await stores.activity.update((rec) =>
      addActivity(rec, FIXTURE_NOW, 'text_floor', 'applied', 3),
    );
    await sync.flushActivity();
    const call = db.calls.find((c) => c.fn === 'record_activity');
    expect(call?.args).toMatchObject({
      p_counts: { text_floor: { applied: 3 } },
    });
    expect((await stores.activity.read()).weeks).toEqual({});
  });

  it('a lost session asks for a new sign-in; signing out forgets the account but keeps the fit', async () => {
    const profile = strongReaderProfile();
    const { stores, sync } = setup({ profile: { version: 1, profile } });
    await sync.connected('u1', 'person@example.com');
    await sync.signedOut(true);
    expect((await stores.account.read())?.needsReauth).toBe(true);
    await sync.signedOut(false);
    expect(await stores.account.read()).toBeNull();
    expect(await stores.profile.read()).not.toBeNull();
  });

  it('a different person on this install starts from their own fit', async () => {
    const { stores, sync } = setup({});
    await stores.account.write({
      userId: 'someone-else',
      email: 'x@y.z',
      cloudAnalysis: true,
      aiLayout: true,
      productLearning: false,
      theme: 'system',
      onboardingStep: 'connected',
      needsReauth: false,
      connectedAt: 0,
      lastSyncAt: 0,
    });
    await stores.learning.update((rec) => ({ ...rec, pending: [delta(1)] }));
    await sync.connected('u1', 'person@example.com');
    expect((await stores.learning.read()).pending).toEqual([]);
    expect((await stores.account.read())?.cloudAnalysis).toBe(false);
    expect((await stores.account.read())?.aiLayout).toBe(false);
  });

  it('nothing carries over between accounts, even after signing out', async () => {
    const profile = strongReaderProfile();
    const serverA = initialLearningState(
      profile,
      needLevels(profile),
      FIXTURE_DAY,
    );
    serverA.ops.text_floor.accepts = 5;
    const { stores, sync, db, script, who } = setup({
      account: {
        cloud_analysis: true,
        product_learning: false,
        theme: 'dark',
        onboarding_step: 'tuned',
      },
      profile: { version: 7, profile },
      learning: { state: serverA, rev: 3 },
    });
    who.id = 'user-a';
    await sync.connected('user-a', 'a@example.com');
    await stores.learning.update((rec) => ({
      ...rec,
      pending: [delta(1), delta(2)],
    }));
    await stores.activity.update((rec) =>
      addActivity(rec, FIXTURE_NOW, 'text_floor', 'applied', 3),
    );
    await sync.signedOut(false);
    expect((await stores.learning.read()).pending).toEqual([]);
    expect((await stores.activity.read()).weeks).toEqual({});

    // Someone else signs in on this browser; their account holds nothing yet.
    script.account = null;
    script.profile = null;
    script.learning = null;
    Object.assign(who, { id: 'user-b', email: 'b@example.com' });
    db.calls.length = 0;
    await sync.connected('user-b', 'b@example.com');

    const puts = db.calls.filter((c) => c.fn === 'put_learning_state');
    expect(puts.length).toBeGreaterThan(0);
    for (const put of puts) {
      const args = put.args as {
        p_state: UserLearningState;
        p_expected_rev: number;
      };
      expect(args.p_expected_rev).toBe(0);
      expect(args.p_state.ops.text_floor.accepts).toBe(0);
      expect(args.p_state.recentDeltaIds ?? []).toEqual([]);
    }
    expect(db.calls.some((c) => c.fn === 'record_activity')).toBe(false);
    expect(await stores.profile.read()).toMatchObject({
      source: 'default',
      ownerUserId: 'user-b',
    });
    expect((await stores.learning.read()).ownerUserId).toBe('user-b');
  });

  it('runs one sync at a time, so counts are sent once', async () => {
    const { stores, sync, db } = setup({});
    await stores.activity.update((rec) =>
      addActivity(rec, FIXTURE_NOW, 'text_floor', 'applied', 3),
    );
    await Promise.all([sync.refresh(), sync.refresh(), sync.refresh()]);
    const flushes = db.calls.filter((c) => c.fn === 'record_activity');
    expect(flushes).toHaveLength(1);
    expect(flushes[0]?.args).toMatchObject({
      p_counts: { text_floor: { applied: 3 } },
    });
  });

  it('a browser removed on the web stays removed', async () => {
    const profile = strongReaderProfile();
    const { stores, sync, db, script, who } = setup({
      profile: { version: 1, profile },
    });
    await sync.connected('u1', 'person@example.com');
    const upserts = () =>
      db.calls.filter(
        (c) => c.table === 'extension_installs' && c.kind === 'upsert',
      );
    expect(upserts()).toHaveLength(1);
    await sync.refresh();
    expect(upserts()).toHaveLength(1);

    script.installRow = false;
    db.calls.length = 0;
    const result = await sync.refresh();
    expect(result).toMatchObject({ account: null, removed: true });
    expect(who.signedOut).toBe(1);
    expect(await stores.account.read()).toBeNull();
    expect(upserts()).toHaveLength(0);
    expect(db.calls.some((c) => c.kind === 'rpc')).toBe(false);
  });

  it('asks the account for the layout-planning consent', async () => {
    const { stores, sync, db } = setup({
      account: {
        cloud_analysis: false,
        ai_layout: true,
        product_learning: false,
        theme: 'system',
        onboarding_step: 'tuned',
      },
    });
    await sync.connected('u1', 'person@example.com');
    expect(
      db.calls.find((c) => c.table === 'accounts' && c.kind === 'select')?.args,
    ).toContain('ai_layout');
    expect(await stores.account.read()).toMatchObject({
      cloudAnalysis: false,
      aiLayout: true,
    });
  });

  it('records when the last complete sync finished', async () => {
    const { stores, sync, script } = setup({});
    await sync.connected('u1', 'person@example.com');
    // No accounts row came back: the sync did not complete.
    expect(await lastSuccessfulSync(stores)).toBeNull();
    script.account = {
      cloud_analysis: false,
      product_learning: false,
      theme: 'system',
      onboarding_step: 'connected',
    };
    await sync.refresh();
    expect(await lastSuccessfulSync(stores)).toBe(FIXTURE_NOW);
  });

  it('a delta the server already merged is not counted again', async () => {
    const profile = strongReaderProfile();
    const start = initialLearningState(
      profile,
      needLevels(profile),
      FIXTURE_DAY,
    );
    // The push with delta 1 landed, but its reply was lost.
    const server = mergeDeltas(start, [delta(1)], new Set());
    const { stores, sync, db } = setup({
      profile: { version: 1, profile },
      learning: { state: server, rev: 5 },
    });
    await sync.connected('u1', 'person@example.com');
    await stores.learning.update((rec) => ({
      ...rec,
      pending: [delta(1), delta(2)],
    }));
    await sync.refresh();
    const put = db.calls.findLast((c) => c.fn === 'put_learning_state');
    const sent = (put?.args as { p_state: UserLearningState }).p_state;
    const once = mergeDeltas(server, [delta(2)], new Set());
    expect(sent.ops.text_floor.c).toEqual(once.ops.text_floor.c);
    expect(sent.recentDeltaIds).toEqual([delta(1).deltaId, delta(2).deltaId]);
  });

  it('buckets the platform coarsely', () => {
    expect(platformBucket('MacIntel')).toBe('macos');
    expect(platformBucket('Win32')).toBe('windows');
    expect(platformBucket('CrOS x86_64')).toBe('chromeos');
    expect(platformBucket(undefined)).toBe('other');
  });
});
