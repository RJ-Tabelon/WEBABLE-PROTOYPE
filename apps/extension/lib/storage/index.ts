import type { SystemSignals } from '@webable/core/profile/defaults';

import {
  accountStore,
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
import { learningStore, type LearningRecord } from './learning';
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
 * event log, the answer cache and the receipts go, and the install secret is
 * rotated so any HMAC key derived before is meaningless. The session, the
 * account mirror and the domain-free learning state stay.
 */
export async function clearLocalData(stores: LocalStores): Promise<void> {
  await Promise.all([
    stores.sites.clear(),
    stores.events.clear(),
    stores.answers.clear(),
    stores.receipts.clear(),
    stores.offers.clear(),
  ]);
  await stores.install.rotateSecret();
}
