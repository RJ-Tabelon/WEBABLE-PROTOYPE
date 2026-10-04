import { z } from 'zod';

import type { DimId, OpId } from '../ops/catalog';
import type { PageCategory } from '../page/types';
import type {
  AnalysisLabel,
  DecisionSource,
  VerifyCode,
} from '../policy/types';

/**
 * Personal learning state (personalization.md 11-13).
 *   Learner A: Beta-Bernoulli desirability per op, personal -> domain with shrinkage.
 *   Learner B: Kalman/probit estimate per continuous dimension (log space).
 *   Engine channel: verifier reliability per op and site (never touches preference).
 *
 * UserLearningState is domain-free and syncs to Supabase (learning_state).
 * DomainState lives only in chrome.storage.local: a list of sites is browsing history.
 */

/** Days since epoch (integer). */
export type Day = number;

/** Decayed pseudo-counts. */
export interface Counts {
  s: number;
  f: number;
  t: Day;
}

export interface OpState {
  c: Counts;
  src: 'profile' | 'pinned' | 'system' | 'none';
  blocked?: true;
  accepts: number;
  askAfter: Day;
  dismissStreak: number;
  offerCooldownUntil: Day;
  opVer: number;
}

export interface DimState {
  /** Mean in log space of the dimension's natural unit. */
  m: number;
  /** Variance in log space. */
  v: number;
  t: Day;
  mCal: number;
  vCal: number;
  floor?: number;
}

export interface UserLearningState {
  v: 1;
  libVer: string;
  priorRelease: string;
  ops: Record<OpId, OpState>;
  dims: Record<DimId, DimState>;
  /** Analysis-label applicability table: Beta per (op, label). */
  labels: Partial<Record<OpId, Record<AnalysisLabel, Counts>>>;
  /**
   * The newest delta ids merged into this state (at most RECENT_DELTA_IDS_MAX,
   * oldest first), so a delta pushed again after a lost reply is not counted
   * twice. Absent in states written before it existed.
   */
  recentDeltaIds?: string[];
}

export const RECENT_DELTA_IDS_MAX = 256;

export interface DomainOp extends Counts {
  pin?: true;
  block?: true;
  /** Engine reliability counts on this site. */
  e?: Counts;
  skipUntil?: Day;
  sessionOff?: string;
  /** Days on which the verifier rejected this op here (engine gate window). */
  rejects?: Day[];
  passDay?: Day;
  /** Engine gate: the op may not run here until this day. */
  engineUntil?: Day;
  /** A fast or "Don't want this" undo: offers only here until accepted again. */
  demoted?: true;
}

export interface DomainState {
  t: Day;
  ops: Partial<Record<OpId, DomainOp>>;
  dims: Partial<Record<DimId, { d: number; v: number }>>;
  silenceDay?: Partial<Record<OpId, Day>>;
  /** Component keys the person marked "I needed that": never soften them again. */
  exceptions?: string[];
}

export type AdaptEventKind =
  | 'applied'
  | 'offered'
  | 'offer_accepted'
  | 'offer_dismissed'
  | 'offer_ignored'
  | 'undo'
  | 'undo_reason'
  | 'intensity_change'
  | 'episode_end'
  | 'manual_on'
  | 'site_disable'
  | 'site_enable'
  | 'global_disable'
  | 'rating'
  | 'verifier'
  | 'promotion_answer'
  | 'session_end';

/** Local event. Never leaves the device. */
export interface AdaptEvent {
  v: 1;
  id: string;
  t: number;
  tabSession: string;
  /** eTLD+1 only. Never a URL, path, query, or title. */
  domain: string;
  cat: PageCategory;
  op: OpId;
  opVer: number;
  level: number;
  src: DecisionSource | 'offer';
  kind: AdaptEventKind;
  dtApplyMs?: number;
  dir?: 1 | -1;
  fromLevel?: number;
  toLevel?: number;
  settledValue?: number;
  keptMs?: number;
  rating?: 'helped' | 'not_helped';
  reason?:
    'dont_want' | 'too_much' | 'too_little' | 'broke_page' | 'needed_that';
  pass?: boolean;
  vcode?: VerifyCode;
  aiLabel?: AnalysisLabel;
  componentKey?: string;
  friction?: 'misclick_burst' | 'zoom_in' | 'scroll_reversal' | 'rage_click';
  answer?: 'yes' | 'no';
  /** Promotion prompts can apply to one site or everywhere. */
  scope?: 'site' | 'everywhere';
  acceptedThisSession?: boolean;
  autoApplied?: boolean;
  kept?: boolean;
  visibleEffect?: boolean;
}

/** Domain-free learning delta, synced to Supabase. Idempotent by deltaId. */
export const learnDeltaSchema = z.object({
  v: z.literal(1),
  deltaId: z.string().min(8).max(64),
  day: z.number().int(),
  op: z.string().optional(),
  /** Negative values reverse an earlier credit (an undo reason that arrived after the undo). */
  ds: z.number().min(-10).max(10).optional(),
  df: z.number().min(-10).max(10).optional(),
  accepts: z.number().int().min(0).max(10).optional(),
  src: z.enum(['profile', 'pinned', 'system', 'none']).optional(),
  blocked: z.boolean().optional(),
  dim: z.string().optional(),
  obs: z
    .object({
      kind: z.enum(['point', 'gt', 'lt']),
      value: z.number(),
      r: z.number().positive(),
    })
    .optional(),
  label: z
    .object({
      op: z.string(),
      label: z.enum(['clear', 'likely', 'unsure']),
      s: z.number(),
      f: z.number(),
    })
    .optional(),
});
export type LearnDelta = z.infer<typeof learnDeltaSchema>;

/** Per-person, per-site explicit rules. Local only unless the person opts into sync. */
export interface SiteRule {
  paused: boolean;
  pins: OpId[];
  blocks: OpId[];
  /** Manual intensity chosen for this site. */
  levels: Partial<Record<OpId, number>>;
  updatedAt: number;
}
