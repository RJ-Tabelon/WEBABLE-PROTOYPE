import {
  initialLearningState,
  mergeDeltas,
  reseedFromProfile,
  toDay,
} from '@webable/core/learning/learners';
import type { UserLearningState } from '@webable/core/learning/types';
import { fitProfileSchema } from '@webable/core/profile/schema';
import { LEARNING_VERSION } from '@webable/core/versions';
import type { Json } from '@webable/core/db/types';

import type { AccountRecord, ProfileRecord } from '../storage/account';
import { subtractFlushed } from '../storage/activity';
import type { LocalStores } from '../storage';
import { isLearningState } from '../storage/learning';
import type { AuthService } from './auth';
import { contextFor, profileIdentity, type ProfileContext } from './profile';

/**
 * Account sync (personalization.md 11-13, platform.md 3): consents from
 * `accounts`, the current fit profile (validated with fitProfileSchema),
 * domain-free learning state with optimistic concurrency, weekly activity
 * counts, and this install's row. Nothing here carries a domain or a URL.
 */
export interface SyncDeps {
  stores: LocalStores;
  auth: AuthService;
  now: () => number;
  version: string;
  platform: string;
}

export interface RefreshResult {
  account: AccountRecord | null;
  profileChanged: boolean;
}

/** Browser platform bucket for `extension_installs` (never a device identifier). */
export function platformBucket(raw: string | undefined): string {
  const p = (raw ?? '').toLowerCase();
  if (p.includes('mac')) return 'macos';
  if (p.includes('win')) return 'windows';
  if (p.includes('cros') || p.includes('chrome os')) return 'chromeos';
  if (p.includes('android')) return 'android';
  if (p.includes('linux')) return 'linux';
  return 'other';
}

const MAX_PUT_ATTEMPTS = 3;

export class AccountSync {
  constructor(private readonly deps: SyncDeps) {}

  private get db() {
    return this.deps.auth.client;
  }

  /** Right after a successful handoff. */
  async connected(userId: string, email: string): Promise<RefreshResult> {
    const now = this.deps.now();
    const previous = await this.deps.stores.account.read();
    const samePerson = previous?.userId === userId;
    if (previous && !samePerson) {
      // A different person on this install: nothing learned for the previous
      // account carries over. Their state is reseeded from their own profile.
      await this.deps.stores.learning.clear();
      await this.deps.stores.profile.clear();
    }
    await this.deps.stores.account.write({
      userId,
      email,
      cloudAnalysis: samePerson ? previous.cloudAnalysis : false,
      productLearning: samePerson ? previous.productLearning : false,
      theme: samePerson ? previous.theme : 'system',
      onboardingStep: samePerson ? previous.onboardingStep : 'new',
      needsReauth: false,
      connectedAt: now,
      lastSyncAt: samePerson ? previous.lastSyncAt : 0,
    });
    return this.refresh();
  }

  /** Pull everything, push learning and counts. Each step fails on its own. */
  async refresh(): Promise<RefreshResult> {
    const session = await this.deps.auth.session();
    if (!session) {
      return {
        account: await this.deps.stores.account.read(),
        profileChanged: false,
      };
    }
    const account = await this.pullAccount(
      session.user.id,
      session.user.email ?? '',
    );
    const profileChanged = await this.pullProfile().catch(() => false);
    const rec = await this.deps.stores.profile.read();
    if (rec) await this.syncLearning(contextFor(rec)).catch(() => undefined);
    await this.upsertInstall(session.user.id).catch(() => undefined);
    await this.flushActivity().catch(() => undefined);
    await this.deps.stores.account.update((cur) =>
      cur ? { ...cur, lastSyncAt: this.deps.now() } : cur,
    );
    return { account, profileChanged };
  }

  async pullAccount(
    userId: string,
    email: string,
  ): Promise<AccountRecord | null> {
    const { data, error } = await this.db
      .from('accounts')
      .select('cloud_analysis, product_learning, theme, onboarding_step')
      .eq('user_id', userId)
      .maybeSingle();
    return this.deps.stores.account.update((cur) => {
      const base: AccountRecord =
        cur && cur.userId === userId
          ? cur
          : {
              userId,
              email,
              cloudAnalysis: false,
              productLearning: false,
              theme: 'system',
              onboardingStep: 'new',
              needsReauth: false,
              connectedAt: this.deps.now(),
              lastSyncAt: 0,
            };
      if (error || !data)
        return { ...base, email: email || base.email, needsReauth: false };
      const theme =
        data.theme === 'light' || data.theme === 'dark' ? data.theme : 'system';
      return {
        ...base,
        email: email || base.email,
        cloudAnalysis: data.cloud_analysis,
        productLearning: data.product_learning,
        theme,
        onboardingStep: data.onboarding_step,
        needsReauth: false,
      };
    });
  }

  /** Returns true when the profile in use changed. Invalid profiles are ignored. */
  async pullProfile(): Promise<boolean> {
    const { data, error } = await this.db
      .from('fit_profiles')
      .select('version, profile')
      .eq('is_current', true)
      .maybeSingle();
    if (error) throw new Error('profile pull failed');
    if (!data) return false;
    const parsed = fitProfileSchema.safeParse(data.profile);
    if (!parsed.success) return false;
    const next: ProfileRecord = {
      profile: parsed.data,
      source: 'account',
      version: data.version,
      fetchedAt: this.deps.now(),
    };
    let changed = false;
    await this.deps.stores.profile.update((cur) => {
      changed = !cur || profileIdentity(cur) !== profileIdentity(next);
      return next;
    });
    return changed;
  }

  /**
   * Learning sync with optimistic concurrency: merge the pending deltas into
   * the server's canonical state (idempotent G-counters, core mergeDeltas),
   * reseed after a recalibration, and put_learning_state with the revision we
   * read. A conflict re-reads and retries.
   */
  async syncLearning(ctx: ProfileContext): Promise<void> {
    const day = toDay(this.deps.now());
    for (let attempt = 0; attempt < MAX_PUT_ATTEMPTS; attempt++) {
      const { data: row, error } = await this.db
        .from('learning_state')
        .select('state, rev')
        .maybeSingle();
      if (error) throw new Error('learning pull failed');
      const serverRev = row?.rev ?? 0;
      const serverState: UserLearningState | null =
        row && isLearningState(row.state) ? row.state : null;

      // A new device (or one that was reset) starts from what the account learned.
      let local = await this.deps.stores.learning.read();
      if (!local.user) {
        local = await this.deps.stores.learning.update((cur) =>
          cur.user
            ? cur
            : {
                ...cur,
                user:
                  serverState ??
                  initialLearningState(ctx.profile, ctx.needs, day),
                rev: serverState ? serverRev : 0,
                seededFor: ctx.identity,
                reseed: false,
              },
        );
        if (serverState && local.pending.length === 0) {
          await this.deps.stores.learning.update((cur) => ({
            ...cur,
            lastSyncAt: this.deps.now(),
          }));
          return;
        }
      }
      if (!local.user) return;
      const sent = new Set(local.pending.map((d) => d.deltaId));

      let merged: UserLearningState = serverState
        ? mergeDeltas(serverState, local.pending, new Set(), local.user)
        : local.user;
      if (local.reseed)
        merged = reseedFromProfile(merged, ctx.profile, ctx.needs, day);

      const nothingToPush =
        serverState !== null && local.pending.length === 0 && !local.reseed;
      if (nothingToPush) {
        await this.deps.stores.learning.update((cur) => {
          const extra = cur.pending.filter((d) => !sent.has(d.deltaId));
          return {
            ...cur,
            user: extra.length
              ? mergeDeltas(merged, extra, new Set(), cur.user ?? undefined)
              : merged,
            rev: serverRev,
            lastSyncAt: this.deps.now(),
          };
        });
        return;
      }

      const { data, error: putError } = await this.db.rpc(
        'put_learning_state',
        {
          p_state: merged as unknown as Json,
          p_expected_rev: serverRev,
          p_engine_version: LEARNING_VERSION,
        },
      );
      if (putError) throw new Error('learning push failed');
      const result = Array.isArray(data) ? data[0] : null;
      if (result?.ok) {
        await this.deps.stores.learning.update((cur) => {
          const extra = cur.pending.filter((d) => !sent.has(d.deltaId));
          return {
            ...cur,
            user: extra.length
              ? mergeDeltas(merged, extra, new Set(), cur.user ?? undefined)
              : merged,
            rev: result.rev,
            pending: extra,
            reseed: false,
            lastSyncAt: this.deps.now(),
          };
        });
        return;
      }
      // Conflict: another device wrote first. Re-read and merge again.
    }
  }

  async flushActivity(): Promise<void> {
    const rec = await this.deps.stores.activity.read();
    for (const [week, counts] of Object.entries(rec.weeks)) {
      if (Object.keys(counts).length === 0) continue;
      const { error } = await this.db.rpc('record_activity', {
        p_week: week,
        p_counts: counts as unknown as Json,
      });
      if (error) throw new Error('activity flush failed');
      await this.deps.stores.activity.update((cur) =>
        subtractFlushed(cur, week, counts),
      );
    }
  }

  async upsertInstall(userId: string): Promise<void> {
    const install = await this.deps.stores.install.get();
    const { error } = await this.db.from('extension_installs').upsert(
      {
        id: install.id,
        user_id: userId,
        browser: 'chrome',
        platform: this.deps.platform,
        extension_version: this.deps.version.slice(0, 32),
        last_seen_at: new Date(this.deps.now()).toISOString(),
      },
      { onConflict: 'id' },
    );
    if (error) throw new Error('install upsert failed');
  }

  /** The session ended. `lost`: without the person signing out (sign in again). */
  async signedOut(lost: boolean): Promise<void> {
    if (lost) {
      await this.deps.stores.account.update((cur) =>
        cur ? { ...cur, needsReauth: true } : cur,
      );
      return;
    }
    await this.deps.stores.account.clear();
    // The fit and the learned preferences stay on this device ("Your fit is on this device only").
    await this.deps.stores.learning.update((cur) => ({ ...cur, rev: 0 }));
  }
}
