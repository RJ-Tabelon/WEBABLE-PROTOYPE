import type { FitProfile } from '@webable/core/profile/schema';
import {
  defaultFitProfile,
  type SystemSignals,
} from '@webable/core/profile/defaults';

import type { KvArea } from './area';
import { KEYS } from './keys';
import {
  bool,
  isRecord,
  JsonStore,
  num,
  ownerField,
  str,
  strOrNull,
} from './store';

/**
 * What the extension mirrors from the person's account. No tokens (those are
 * the auth client's alone), no health information.
 */
export interface AccountRecord {
  userId: string;
  email: string;
  cloudAnalysis: boolean;
  productLearning: boolean;
  theme: 'system' | 'light' | 'dark';
  onboardingStep: 'new' | 'tuning' | 'tuned' | 'connected';
  /** The session ended without the person signing out (refresh failed). */
  needsReauth: boolean;
  connectedAt: number;
  /** The last sync in which every step succeeded (0 = never). */
  lastSyncAt: number;
  /**
   * This install's `extension_installs` row exists. Only connecting creates
   * it; later syncs update it, and a missing row means the browser was removed.
   */
  installRegistered?: boolean;
}

const STEPS = new Set(['new', 'tuning', 'tuned', 'connected']);

export function normalizeAccount(raw: unknown): AccountRecord | null {
  if (!isRecord(raw)) return null;
  const userId = strOrNull(raw.userId);
  const email = strOrNull(raw.email);
  if (!userId || !email) return null;
  const theme =
    raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system';
  const step =
    typeof raw.onboardingStep === 'string' && STEPS.has(raw.onboardingStep)
      ? (raw.onboardingStep as AccountRecord['onboardingStep'])
      : 'new';
  return {
    userId,
    email,
    cloudAnalysis: bool(raw.cloudAnalysis, false),
    productLearning: bool(raw.productLearning, false),
    theme,
    onboardingStep: step,
    needsReauth: bool(raw.needsReauth, false),
    connectedAt: num(raw.connectedAt, 0),
    lastSyncAt: num(raw.lastSyncAt, 0),
    ...(raw.installRegistered === true ? { installRegistered: true } : {}),
  };
}

export function accountStore(area: KvArea): JsonStore<AccountRecord | null> {
  return new JsonStore(area, KEYS.account, normalizeAccount);
}

/**
 * The profile in use. `account` profiles come from `fit_profiles` (parsed
 * with fitProfileSchema); `default` is the tier-0 profile built from system
 * signals, which works with no account and no network.
 */
export interface ProfileRecord {
  profile: FitProfile;
  source: 'account' | 'default';
  /** fit_profiles.version, or null for the default profile. */
  version: number | null;
  fetchedAt: number;
  /** The account this record belongs to (absent: not yet claimed by one). */
  ownerUserId?: string;
}

/** The tier-0 profile from system signals: works with no account and no network. */
export function defaultProfileRecord(
  system: SystemSignals,
  now: number,
): ProfileRecord {
  return {
    profile: defaultFitProfile(system, new Date(now)),
    source: 'default',
    version: null,
    fetchedAt: now,
  };
}

export function normalizeProfileRecord(raw: unknown): ProfileRecord | null {
  if (!isRecord(raw) || !isRecord(raw.profile)) return null;
  // The profile was validated with fitProfileSchema before it was stored.
  const profile = raw.profile as unknown as FitProfile;
  if (profile.v !== 1) return null;
  return {
    profile,
    source: raw.source === 'account' ? 'account' : 'default',
    version: typeof raw.version === 'number' ? raw.version : null,
    fetchedAt: num(raw.fetchedAt, 0),
    ...ownerField(raw),
  };
}

export function profileStore(area: KvArea): JsonStore<ProfileRecord | null> {
  return new JsonStore(area, KEYS.profile, normalizeProfileRecord);
}

export function normalizeSystem(raw: unknown): SystemSignals | null {
  if (!isRecord(raw)) return null;
  const deviceClass = str(raw.deviceClass, 'laptop');
  const input = str(raw.input, 'mouse');
  return {
    reducedMotion: bool(raw.reducedMotion, false),
    colorScheme: raw.colorScheme === 'dark' ? 'dark' : 'light',
    moreContrast: bool(raw.moreContrast, false),
    forcedColors: bool(raw.forcedColors, false),
    deviceClass: (['phone', 'tablet', 'laptop', 'desktop'].includes(deviceClass)
      ? deviceClass
      : 'laptop') as SystemSignals['deviceClass'],
    input: (['mouse', 'trackpad', 'touch', 'keyboard', 'other'].includes(input)
      ? input
      : 'mouse') as SystemSignals['input'],
  };
}

export function systemStore(area: KvArea): JsonStore<SystemSignals | null> {
  return new JsonStore(area, KEYS.system, normalizeSystem);
}
