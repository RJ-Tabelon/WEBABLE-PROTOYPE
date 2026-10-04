import {
  desirability,
  evidenceNeeds,
  toDay,
} from '@webable/core/learning/learners';
import { FRICTION_LR, K } from '@webable/core/learning/params';
import type {
  DomainState,
  SiteRule,
  UserLearningState,
} from '@webable/core/learning/types';
import { OP_CATALOG, OP_IDS, type OpId } from '@webable/core/ops/catalog';
import type { PageCategory, PageSignals } from '@webable/core/page/types';
import { offerProbability } from '@webable/core/policy/decide';
import type { FitProfile, NeedLevels } from '@webable/core/profile/schema';

/**
 * When a page-analysis call may happen (ai-architecture.md 3.1). Every
 * condition is local; if any fails, WebAble uses local rules only and sends
 * nothing. Pure.
 */

export type GateReason =
  | 'unconfigured'
  | 'not_signed_in'
  | 'needs_reauth'
  | 'no_consent'
  | 'no_consuming_op'
  | 'excluded_site'
  | 'sensitive_page'
  | 'checkout'
  | 'not_english'
  | 'nothing_ambiguous'
  | 'cached'
  | 'breaker_open'
  | 'tab_rate';

export interface GateInput {
  configured: boolean;
  signedIn: boolean;
  needsReauth: boolean;
  cloudAnalysis: boolean;
  /** G2: at least one enabled op consumes region roles or the main content. */
  consumesAnalysis: boolean;
  excludedSite: boolean;
  signals: Pick<
    PageSignals,
    'lang' | 'forms' | 'category' | 'categoryConfidence'
  >;
  /** Regions with evidence (ambiguous to local rules) before the cache lookup. */
  ambiguousRegions: number;
  /** Of those, how many missed the answer cache. */
  uncachedRegions: number;
  /** Main content is ambiguous and its pick is not cached. */
  mainUncached: boolean;
  breakerOpen: boolean;
  tab: { calls: number; lastCallAt: number | null };
  now: number;
}

export type GateResult = { call: true } | { call: false; reason: GateReason };

/** G7: per tab, at most one call per 10 s and three per page lifetime. */
export const TAB_MIN_INTERVAL_MS = 10_000;
export const TAB_MAX_CALLS = 3;
/** G3: a local form/checkout verdict this sure excludes the page. */
export const CHECKOUT_P = 0.75;

export function gate(input: GateInput): GateResult {
  const no = (reason: GateReason): GateResult => ({ call: false, reason });
  if (!input.configured) return no('unconfigured');
  // G1: a session and affirmative consent.
  if (!input.signedIn) return no('not_signed_in');
  if (input.needsReauth) return no('needs_reauth');
  if (!input.cloudAnalysis) return no('no_consent');
  // G2
  if (!input.consumesAnalysis) return no('no_consuming_op');
  // G3: excluded sites, password or payment fields, checkout pages.
  if (input.excludedSite) return no('excluded_site');
  if (input.signals.forms.hasPassword || input.signals.forms.hasPayment)
    return no('sensitive_page');
  if (
    input.signals.category === 'form_checkout' &&
    input.signals.categoryConfidence >= CHECKOUT_P
  )
    return no('checkout');
  // G6: the vocabulary and the catalog are English.
  if (!/^en(?:-|$)/i.test(input.signals.lang.trim())) return no('not_english');
  // G4 / G5: something ambiguous, not already answered.
  if (input.ambiguousRegions === 0 && !input.mainUncached)
    return no('nothing_ambiguous');
  if (input.uncachedRegions === 0 && !input.mainUncached) return no('cached');
  // G7
  if (input.breakerOpen) return no('breaker_open');
  if (input.tab.calls >= TAB_MAX_CALLS) return no('tab_rate');
  if (
    input.tab.lastCallAt !== null &&
    input.now - input.tab.lastCallAt < TAB_MIN_INTERVAL_MS
  )
    return no('tab_rate');
  return { call: true };
}

export interface ConsumerInput {
  learning: UserLearningState;
  domain: DomainState | undefined;
  site: SiteRule | undefined;
  profile: FitProfile;
  needs: NeedLevels;
  category: PageCategory;
  profileConfidence: number | null;
  now: number;
}

const MAX_FRICTION_LR = Math.max(...Object.values(FRICTION_LR));

/** Ops that consume page-analysis answers (region roles, main content). */
export const ANALYSIS_OPS: readonly OpId[] = OP_IDS.filter(
  (op) => OP_CATALOG[op].usesPageAnalysis,
);

/**
 * G2: the page-analysis ops that are "enabled" for this person here: pinned
 * or profile-derived, or able to reach the offer threshold with the strongest
 * friction evidence. Blocked and paused never count.
 */
export function analysisConsumers(input: ConsumerInput): OpId[] {
  const { learning: u, domain: d, site } = input;
  if (site?.paused) return [];
  const day = toDay(input.now);
  const needs = evidenceNeeds(input.profile, input.needs);
  const out: OpId[] = [];
  for (const op of ANALYSIS_OPS) {
    const o = u.ops[op];
    if (o?.blocked || d?.ops[op]?.block || site?.blocks.includes(op)) continue;
    const pinned = site?.pins.includes(op) || d?.ops[op]?.pin === true;
    if (pinned || (o && o.src !== 'none')) {
      out.push(op);
      continue;
    }
    const theta = desirability(
      u,
      d,
      op,
      {
        needs,
        category: input.category,
        profileConfidence: input.profileConfidence,
      },
      day,
    ).mean;
    if (offerProbability(theta, MAX_FRICTION_LR) >= K.TAU_OFFER) out.push(op);
  }
  return out;
}
