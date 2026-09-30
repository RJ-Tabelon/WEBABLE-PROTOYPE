import {
  DEFAULT_SYSTEM_SIGNALS,
  type SystemSignals,
} from '@webable/core/profile/defaults';

import {
  accountStore,
  defaultProfileRecord,
  profileStore,
  systemStore,
  type AccountRecord,
  type ProfileRecord,
} from './account';
import {
  activityStore,
  offerBudgetStore,
  type ActivityRecord,
  type OfferBudget,
} from './activity';
import { AnswerCache } from './answers';
import type { KvArea } from './area';
import { EventLog } from './events';
import { InstallStore } from './install';
import {
  emptyLearningRecord,
  learningStore,
  type LearningRecord,
} from './learning';
import { ReceiptLog } from './receipts';
import { settingsStore, type Settings } from './settings';
import { SiteStore } from './sites';
import type { JsonStore } from './store';

export * from './account';
export * from './activity';
export * from './answers';
export * from './area';
export * from './crypto';
export * from './events';
export * from './install';
export * from './keys';
export * from './learning';
export * from './levels';
export * from './receipts';
export * from './settings';
export * from './sites';
export * from './store';

/** Every local store, over one `local` area (trusted contexts only). */
export interface LocalStores {
  local: KvArea;
  install: InstallStore;
  settings: JsonStore<Settings>;
  sites: SiteStore;
  events: EventLog;
  answers: AnswerCache;
  receipts: ReceiptLog;
  learning: JsonStore<LearningRecord>;
  account: JsonStore<AccountRecord | null>;
  profile: JsonStore<ProfileRecord | null>;
  system: JsonStore<SystemSignals | null>;
  activity: JsonStore<ActivityRecord>;
  offers: JsonStore<OfferBudget>;
}

export function createStores(
  local: KvArea,
  now: () => number = Date.now,
): LocalStores {
  return {
    local,
    install: new InstallStore(local, now),
    settings: settingsStore(local),
    sites: new SiteStore(local, now),
    events: new EventLog(local, now),
    answers: new AnswerCache(local, now),
    receipts: new ReceiptLog(local, now),
    learning: learningStore(local),
    account: accountStore(local),
    profile: profileStore(local),
    system: systemStore(local),
    activity: activityStore(local),
    offers: offerBudgetStore(local),
  };
}

/**
 * "Clear data on this device" (bridge wa:clear-local): per-site records, the
 * event log, the answer cache, the receipts, the learning state with its
 * pending deltas, the weekly counts and the profile go (the profile falls back
 * to the tier-0 default), and the install secret is rotated so any HMAC key
 * derived before is meaningless. The session and the account mirror stay: when
 * signed in, the next sync brings back what the account holds.
 */
export async function clearLocalData(
  stores: LocalStores,
  now: number = Date.now(),
): Promise<void> {
  const userId = (await stores.account.read())?.userId ?? null;
  await Promise.all([
    stores.sites.clear(),
    stores.events.clear(),
    stores.answers.clear(),
    stores.receipts.clear(),
    stores.offers.clear(),
    resetPersonalData(stores, userId, now),
  ]);
  await stores.install.rotateSecret();
}

/**
 * The personal records (learning state and pending deltas, profile, weekly
 * counts) back to their empty or tier-0 form, owned by `userId` when given.
 */
async function resetPersonalData(
  stores: LocalStores,
  userId: string | null,
  now: number,
): Promise<void> {
  const owned = userId ? { ownerUserId: userId } : {};
  const system = (await stores.system.read()) ?? DEFAULT_SYSTEM_SIGNALS;
  await Promise.all([
    stores.learning.write({ ...emptyLearningRecord(), ...owned }),
    stores.profile.write({ ...defaultProfileRecord(system, now), ...owned }),
    stores.activity.write({ weeks: {}, ...owned }),
  ]);
}

/**
 * Personal records belong to one account: nothing carries over between
 * accounts. Claims them for `userId`: a record another account owns is reset
 * first; so is an unclaimed one (written before owners were stamped) when
 * `previousUserId`, the account record on this install, names someone else, or
 * when there is none and the record holds account data. Unclaimed tier-0 data
 * (used before signing in) is kept. Returns true when anything was reset.
 */
export async function claimPersonalData(
  stores: LocalStores,
  userId: string,
  previousUserId: string | null,
  now: number,
): Promise<boolean> {
  const foreign = (
    rec: { ownerUserId?: string } | null,
    accountData: boolean,
  ): boolean => {
    if (rec?.ownerUserId) return rec.ownerUserId !== userId;
    if (previousUserId) return previousUserId !== userId;
    return accountData;
  };
  const [learning, profile, activity] = await Promise.all([
    stores.learning.read(),
    stores.profile.read(),
    stores.activity.read(),
  ]);
  const reset =
    foreign(
      learning,
      learning.rev > 0 || (learning.seededFor?.startsWith('account:') ?? false),
    ) ||
    foreign(profile, profile?.source === 'account') ||
    foreign(activity, false);
  if (reset) {
    await resetPersonalData(stores, userId, now);
    return true;
  }
  if (learning.ownerUserId !== userId)
    await stores.learning.update((cur) => ({ ...cur, ownerUserId: userId }));
  if (profile && profile.ownerUserId !== userId)
    await stores.profile.update((cur) =>
      cur ? { ...cur, ownerUserId: userId } : cur,
    );
  if (activity.ownerUserId !== userId)
    await stores.activity.update((cur) => ({ ...cur, ownerUserId: userId }));
  return false;
}
