import {
  applyEvent,
  initialLearningState,
  OP_IMPL_VERSION,
  profileSource,
  reseedFromProfile,
  toDay,
} from '@webable/core/learning/learners';
import type {
  AdaptEvent,
  LearnDelta,
  UserLearningState,
} from '@webable/core/learning/types';
import {
  DEFAULT_SYSTEM_SIGNALS,
  type SystemSignals,
} from '@webable/core/profile/defaults';
import { needLevels } from '@webable/core/profile/needs';
import type { FitProfile, NeedLevels } from '@webable/core/profile/schema';

import { defaultProfileRecord, type ProfileRecord } from '../storage/account';
import { addActivity, type ActivityField } from '../storage/activity';
import { randomId } from '../storage/crypto';
import type { LocalStores } from '../storage';
import { queueDeltas } from '../storage/learning';

/**
 * The profile in use and the learning state seeded from it. With no account,
 * the tier-0 profile comes from system signals only (reduced motion, more
 * contrast), so WebAble improves the first page with no setup and no network.
 */
export interface ProfileContext {
  profile: FitProfile;
  needs: NeedLevels;
  /** Measured by Tune (as opposed to the zero-setup default). */
  calibrated: boolean;
  /** Calibration confidence for the policy, null for the tier-0 profile. */
  confidence: number | null;
  /** Identity of the seed, e.g. "account:3" or "default:10". */
  identity: string;
  record: ProfileRecord;
}

export function profileIdentity(rec: ProfileRecord): string {
  if (rec.source === 'account') return `account:${rec.version ?? 0}`;
  const a = rec.profile.attention.systemReducedMotion ? 1 : 0;
  const c = rec.profile.vision.contrastFloor.source === 'system' ? 1 : 0;
  return `default:${a}${c}`;
}

export function isCalibrated(profile: FitProfile): boolean {
  return (
    profile.calibrationVersion !== null ||
    profile.confidence > 0 ||
    Object.values(profile.modules).some((m) => m === 'measured')
  );
}

export function defaultRecord(
  system: SystemSignals,
  now: number,
): ProfileRecord {
  return defaultProfileRecord(system, now);
}

export function contextFor(rec: ProfileRecord): ProfileContext {
  const calibrated = rec.source === 'account' && isCalibrated(rec.profile);
  return {
    profile: rec.profile,
    needs: needLevels(rec.profile),
    calibrated,
    confidence: calibrated ? rec.profile.confidence : null,
    identity: profileIdentity(rec),
    record: rec,
  };
}

export async function loadProfile(
  stores: LocalStores,
  now: number,
): Promise<ProfileContext> {
  let rec = await stores.profile.read();
  if (!rec) {
    const system = (await stores.system.read()) ?? DEFAULT_SYSTEM_SIGNALS;
    rec = await stores.profile.update(
      (cur) => cur ?? defaultRecord(system, now),
    );
  }
  return contextFor(rec!);
}

const sameSystem = (a: SystemSignals, b: SystemSignals): boolean =>
  a.reducedMotion === b.reducedMotion &&
  a.moreContrast === b.moreContrast &&
  a.forcedColors === b.forcedColors &&
  a.colorScheme === b.colorScheme &&
  a.deviceClass === b.deviceClass &&
  a.input === b.input;

/**
 * New system signals (from an extension page's matchMedia, or a page's own
 * environment). The default profile follows them; an account profile does not.
 * Returns true when the profile in use changed.
 */
export async function noteSystemSignals(
  stores: LocalStores,
  signals: SystemSignals,
  now: number,
): Promise<boolean> {
  const prev = await stores.system.read();
  if (prev && sameSystem(prev, signals)) return false;
  await stores.system.write(signals);
  let changed = false;
  await stores.profile.update((cur) => {
    if (cur && cur.source === 'account') return cur;
    const next: ProfileRecord = {
      ...defaultRecord(signals, now),
      ...(cur?.ownerUserId ? { ownerUserId: cur.ownerUserId } : {}),
    };
    changed = !cur || profileIdentity(cur) !== profileIdentity(next);
    return changed ? next : cur!;
  });
  return changed;
}

/** The learning state for this profile, seeding or reseeding it as needed. */
export async function ensureLearning(
  stores: LocalStores,
  ctx: ProfileContext,
  now: number,
): Promise<UserLearningState> {
  const day = toDay(now);
  const rec = await stores.learning.update((cur) => {
    if (!cur.user)
      return {
        ...cur,
        user: initialLearningState(ctx.profile, ctx.needs, day),
        seededFor: ctx.identity,
      };
    if (cur.seededFor !== ctx.identity)
      return {
        ...cur,
        user: reseedFromProfile(cur.user, ctx.profile, ctx.needs, day),
        seededFor: ctx.identity,
        reseed: true,
      };
    // Upgrade existing saved fits whose old need-level gate seeded these
    // minimums as "none". Keep all blocks, feedback and learned levels.
    const ops = { ...cur.user.ops };
    let upgraded = false;
    for (const op of ['text_floor', 'target_size'] as const) {
      if (
        ops[op].src === 'none' &&
        profileSource(op, ctx.profile, ctx.needs) === 'profile'
      ) {
        ops[op] = { ...ops[op], src: 'profile' };
        upgraded = true;
      }
    }
    return upgraded ? { ...cur, user: { ...cur.user, ops } } : cur;
  });
  return rec.user!;
}

/** An event as the worker receives it; identity fields are filled in here. */
export type EventInput = Omit<
  AdaptEvent,
  'v' | 'id' | 't' | 'domain' | 'tabSession' | 'opVer'
>;

const ACTIVITY_OF: Partial<Record<AdaptEvent['kind'], ActivityField>> = {
  applied: 'applied',
  undo: 'undone',
  offered: 'offered',
  offer_accepted: 'accepted',
};

function activityField(ev: AdaptEvent): ActivityField | null {
  if (ev.kind === 'verifier')
    return ev.pass === false ? 'undone_by_checks' : null;
  if (ev.kind === 'session_end') return ev.kept === true ? 'kept' : null;
  return ACTIVITY_OF[ev.kind] ?? null;
}

export function completeEvent(
  input: EventInput,
  domain: string,
  tabSession: string,
  now: number,
): AdaptEvent {
  return {
    ...input,
    v: 1,
    id: randomId(12),
    t: now,
    domain,
    tabSession,
    opVer: OP_IMPL_VERSION[input.op],
  };
}

/**
 * Apply local events: Learner A/B, the label table and the engine channel
 * through core `applyEvent`; the domain part stays in the site record, the
 * domain-free deltas queue for sync; the event log and weekly counts update.
 */
export async function recordEvents(
  stores: LocalStores,
  ctx: ProfileContext,
  domain: string,
  tabSession: string,
  inputs: readonly EventInput[],
  now: number,
): Promise<AdaptEvent[]> {
  if (inputs.length === 0) return [];
  const events = inputs.map((e) => completeEvent(e, domain, tabSession, now));
  const seed = await ensureLearning(stores, ctx, now);
  await stores.learning.update(async (rec) => {
    let user = rec.user ?? seed;
    const deltas: LearnDelta[] = [];
    await stores.sites.update(domain, (site) => {
      let d = site.state;
      for (const ev of events) {
        const r = applyEvent(user, d, ev);
        user = r.user;
        d = r.domain;
        deltas.push(...r.deltas);
      }
      site.state = d;
    });
    return queueDeltas({ ...rec, user }, deltas);
  });
  await stores.events.append(events);
  const counted = events
    .map((ev) => [ev, activityField(ev)] as const)
    .filter((x): x is readonly [AdaptEvent, ActivityField] => x[1] !== null);
  if (counted.length > 0)
    await stores.activity.update((rec) =>
      counted.reduce(
        (acc, [ev, field]) => addActivity(acc, ev.t, ev.op, field),
        rec,
      ),
    );
  return events;
}
