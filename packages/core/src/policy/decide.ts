import type { OpId } from '../ops/catalog';
import type { PageSignals } from '../page/types';
import type { FitProfile, NeedLevels } from '../profile/schema';
import type { DomainState, SiteRule, UserLearningState } from '../learning/types';
import type { AdaptationPlan, DecisionTrace, PlannedOp, RegionVerdict } from './types';

export interface PolicyInput {
  profile: FitProfile;
  needs: NeedLevels;
  signals: PageSignals;
  /** Region verdicts from local rules and (cached or fresh) page analysis. */
  verdicts: Record<string, RegionVerdict>;
  learning: UserLearningState;
  domain: DomainState | undefined;
  site: SiteRule | undefined;
  /** Friction likelihood ratios observed on this page for specific ops. */
  friction: Partial<Record<OpId, number>>;
  /** Offers already shown today and on this page (budget). */
  offersToday: number;
  offersThisPage: number;
  tabSession: string;
  now: number;
  /** Profile calibration confidence, null when uncalibrated. */
  profileConfidence: number | null;
}

/**
 * Deterministic applicability A in [0, 1] of an op on this page
 * (ai-architecture.md 1 row 3): measured facts for page ops, verdict labels for
 * region ops. Returns the regions an op should target when region-scoped.
 */
export function applicability(
  _op: OpId,
  _input: PolicyInput,
): { a: number; regions: string[]; evidence: DecisionTrace['evidence'] } {
  throw new Error('not implemented');
}

/** Expected-utility decision for one op (personalization.md 5, 11 decide()). */
export function decideOp(_op: OpId, _input: PolicyInput): { planned: PlannedOp | null; trace: DecisionTrace } {
  throw new Error('not implemented');
}

/**
 * Full plan for a page: every op decided, at most one offer (budgeted), conflict
 * rules applied (page_zoom and text_floor are alternatives; focus_view supersedes
 * dim_distractions on the same page; paused sites return an empty plan).
 */
export function buildPlan(_input: PolicyInput): AdaptationPlan {
  throw new Error('not implemented');
}
