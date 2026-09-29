// @vitest-environment node
import { initialLearningState } from '@webable/core/learning/learners';
import type { LearnDelta } from '@webable/core/learning/types';
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
import { AccountSync, platformBucket } from './sync';

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

function auth(client: unknown): AuthService {
  return {
    client: client as AuthService['client'],
    async accessToken() {
      return 'jwt';
    },
    async session() {
      return { user: { id: 'u1', email: 'person@example.com' } } as Awaited<
        ReturnType<AuthService['session']>
      >;
    },
    async connect() {
      return { ok: true, userId: 'u1', email: 'person@example.com' };
    },
    async signOut() {},
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
  const sync = new AccountSync({
    stores,
    auth: auth(db.client),
    now: () => FIXTURE_NOW,
    version: '0.1.0',
    platform: 'macos',
  });
  return { stores, sync, db, script };
}

describe('account sync', () => {
  it('pulls consents and the current fit, and registers this install without device ids', async () => {
    const profile = strongReaderProfile();
    const { stores, sync, db } = setup({
      account: {
        cloud_analysis: true,
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
      theme: 'dark',
      needsReauth: false,
    });
    expect(await stores.profile.read()).toMatchObject({
      source: 'account',
      version: 3,
    });
    const install = db.calls.find((c) => c.table === 'extension_installs');
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
  });

  it('buckets the platform coarsely', () => {
    expect(platformBucket('MacIntel')).toBe('macos');
    expect(platformBucket('Win32')).toBe('windows');
    expect(platformBucket('CrOS x86_64')).toBe('chromeos');
    expect(platformBucket(undefined)).toBe('other');
  });
});
