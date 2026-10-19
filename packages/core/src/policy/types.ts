import type { OpId } from '../ops/catalog';
import type { PageCategory, RegionRole } from '../page/types';
import type { TriageVerdict } from '../triage/types';

/** Calibrated confidence label for a page-analysis verdict. */
export type AnalysisLabel = 'clear' | 'likely' | 'unsure';

/** Why an op is being considered: which authority put it on the table. */
export type DecisionSource =
  'profile' | 'pinned' | 'system' | 'friction' | 'manual' | 'none';

export type DecisionMode = 'auto' | 'offer' | 'skip';

/** Structured, faithful record of a decision. Explanations are rendered from this, never generated. */
export type TraceEvidence =
  | {
      kind: 'small_text';
      share: number;
      floorPx: number;
      beforePx: number | null;
    }
  | { kind: 'contrast_failures'; count: number; targetRatio: number }
  | { kind: 'target_failures'; count: number; targetPx: number }
  | { kind: 'crowded_targets'; count: number }
  | { kind: 'long_lines'; lineCh: number; maxCh: number }
  | { kind: 'tight_lines'; lineHeight: number; target: number }
  | {
      kind: 'region_role';
      role: RegionRole;
      by: 'rule' | 'page_analysis';
      label?: AnalysisLabel;
    }
  | { kind: 'motion_sources'; count: number }
  | { kind: 'autoplay_media'; count: number }
  | { kind: 'sticky_bars'; count: number; heightPx: number }
  | { kind: 'hover_menus'; count: number }
  | {
      kind: 'friction';
      signal: 'misclick_burst' | 'zoom_in' | 'scroll_reversal' | 'rage_click';
    }
  | {
      kind: 'learned';
      note: 'kept_before' | 'site_pin' | 'system_setting' | 'undone_before';
    }
  /** Page scale chosen from the needed text scale k (docs/10 §5.1). */
  | { kind: 'page_scale'; zoom: number; k: number };

export interface DecisionTrace {
  op: OpId;
  mode: DecisionMode;
  source: DecisionSource;
  level: number;
  /** P(helpful) = applicability x desirability, when computed. */
  p: number | null;
  /** Engine reliability estimate on this site. */
  pOk: number | null;
  why: string;
  evidence: TraceEvidence[];
}

export interface PlannedOp {
  op: OpId;
  level: number;
  mode: 'auto' | 'offer';
  /** 'page' or the component keys of the regions it targets. */
  scope: 'page' | { regions: string[] };
  trace: DecisionTrace;
}

export interface AdaptationPlan {
  id: string;
  createdAt: number;
  category: PageCategory;
  /** Whether page-analysis answers contributed (vs local rules only). */
  basis: 'local' | 'page_analysis';
  ops: PlannedOp[];
  /**
   * Page scale in effect for this page view (1 = none). Frozen at the first
   * plan; text_floor's level is the effective px it aims for at this zoom.
   */
  zoom?: number;
  /**
   * The person's own zoom (the tab's zoom without WebAble's page scale,
   * pinch excluded) when the worker sent the plan to the page; absent = 1.
   * The tab shows ownZoom x zoom, and effective-px levels are sized against
   * that product: text_floor aims for level / (ownZoom x zoom) CSS px, as
   * triage's k reads body text at bodyPx x the tab's zoom (docs/10 §3.2).
   */
  ownZoom?: number;
  /** Triage for this page view (absent before v2 engines report layout features). */
  triage?: TriageVerdict;
}

export interface RegionVerdict {
  key: string;
  role: RegionRole | null;
  label: AnalysisLabel | null;
  protected: boolean;
  source: 'rule' | 'page_analysis';
  /** P(eligible for softening), after recalibration. */
  pEligible: number;
  /** Per-role probabilities when page analysis answered (after recalibration). */
  roles?: Partial<Record<RegionRole, number>>;
}

/** Verifier failure codes (engine -> service worker). */
export const VERIFY_CODES = [
  'clip',
  'overlap',
  'overflow',
  'contrast_drop',
  'focus_hidden',
  'control_collapsed',
  'layout_shift',
  'focus_lost',
  'timeout',
  'apply_error',
  /** A smaller text became larger than a bigger one in the same region. */
  'hierarchy',
  /** Instances of one template field ended up at different sizes. */
  'inconsistent',
  /** More text was cut off (ellipsis, clamp, clip) than before. */
  'truncation',
  /** Page scale hid primary navigation or the search field (a site breakpoint). */
  'nav_hidden',
] as const;
export type VerifyCode = (typeof VERIFY_CODES)[number];

/** Result of applying one planned op, reported by the content script. */
export interface AppliedChange {
  op: OpId;
  level: number;
  mode: 'auto' | 'offer';
  status: 'applied' | 'undone_by_checks' | 'not_needed' | 'error';
  vcode?: VerifyCode;
  /** Elements affected. */
  count: number;
  /** Real measured before/after values for the fit mark, e.g. 13 -> 18 px. */
  fit?: { before: string; after: string };
  trace: DecisionTrace;
}
