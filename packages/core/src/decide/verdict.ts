import {
  DIMMABLE_ROLES,
  PAGE_CATEGORIES,
  PROTECTED_ROLES,
  REGION_ROLES,
  type PageCategory,
  type PageSignals,
  type RegionEvidence,
  type RegionRole,
} from '../page/types';
import type { AnalysisLabel, RegionVerdict } from '../policy/types';
import type { DecideResponse } from './wire';

/** A local rule decides a region only at corpus precision >= 0.90 (ai-architecture.md 1 row 2). */
export const RULE_PRECISION_MIN = 0.9;

/** Veto thresholds, checked first: deliberately hair-trigger (ai-architecture.md 3.5). */
export const VETO = { protectedRole: 0.05, taskNeed: 0.2 } as const;

/** Label bins on recalibrated P(eligible) and P(task need). No threshold sits at 0.5. */
export const LABEL_BINS = {
  clear: { eligible: 0.9, task: 0.1 },
  likely: { eligible: 0.75, task: 0.2 },
  unsure: { eligible: 0.5, task: 0.2 },
} as const;

/** A role is named on a page-analysis verdict only when it is this probable (unpin needs 0.80). */
export const ROLE_NAMED_MIN = 0.8;

/** main_pick: >= 0.80 main scope; 0.60-0.80 paint-only offers; otherwise no main-scoped ops. */
export const MAIN_PICK = { clear: 0.8, likely: 0.6 } as const;
/** Page type from Jev: >= 0.80 priors and risk modifiers; 0.60-0.80 priors only. */
export const PAGE_TYPE = { clear: 0.8, likely: 0.6 } as const;

/** Vocabulary words that make a region locally protected when page analysis is unsure. */
const HELP_CONTACT_WORDS = new Set([
  'help',
  'helpdesk',
  'support',
  'contact',
  'contacts',
  'faq',
  'faqs',
  'feedback',
  'accessibility',
]);

type SignalRegion = PageSignals['regions'][number];

const isDimmable = (role: RegionRole | null): boolean =>
  role !== null && DIMMABLE_ROLES.includes(role);
const isProtectedRole = (role: RegionRole | null): boolean =>
  role !== null && PROTECTED_ROLES.includes(role);

/** Rule-decided verdict for a region (rulePrecision >= 0.90), else null. */
export function ruleVerdict(region: SignalRegion): RegionVerdict | null {
  if (region.ruleRole === null || !(region.rulePrecision >= RULE_PRECISION_MIN))
    return null;
  const role = region.ruleRole;
  const localProtect = region.hasRequiredFields || region.containsFocus;
  const prot = isProtectedRole(role) || localProtect;
  const dimmable = !prot && isDimmable(role);
  return {
    key: region.key,
    role,
    // Rule precision stands in for the label table: A = rule precision (ai-architecture.md 3.6).
    label: dimmable ? 'clear' : null,
    protected: prot,
    source: 'rule',
    pEligible: dimmable ? Math.min(1, region.rulePrecision) : 0,
  };
}

/** Verdicts from high-precision local rules for every region that has one. */
export function localVerdicts(
  signals: PageSignals,
): Record<string, RegionVerdict> {
  const out: Record<string, RegionVerdict> = {};
  for (const region of signals.regions) {
    const v = ruleVerdict(region);
    if (v) out[region.key] = v;
  }
  return out;
}

export interface Recalibration {
  dimEligible(p: number): number;
  protectedRole(p: number): number;
  taskNeed(p: number): number;
}

/** Identity maps until an isotonic fit exists for the pinned model. */
export const IDENTITY_RECALIBRATION: Recalibration = {
  dimEligible: (p) => p,
  protectedRole: (p) => p,
  taskNeed: (p) => p,
};

const clamp01 = (p: number): number =>
  Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;

export function labelFor(
  pEligible: number,
  task: number,
): AnalysisLabel | null {
  if (!Number.isFinite(pEligible) || !Number.isFinite(task)) return null;
  if (pEligible >= LABEL_BINS.clear.eligible && task <= LABEL_BINS.clear.task)
    return 'clear';
  if (pEligible >= LABEL_BINS.likely.eligible && task <= LABEL_BINS.likely.task)
    return 'likely';
  if (pEligible >= LABEL_BINS.unsure.eligible && task <= LABEL_BINS.unsure.task)
    return 'unsure';
  return null;
}

/**
 * Local protective rules that veto page analysis (ai-architecture.md 3.5):
 * required fields, focus inside, the main content, a search box, help or
 * contact words, or a position inside main.
 */
export function locallyProtected(
  key: string,
  region: SignalRegion | undefined,
  ev: RegionEvidence | undefined,
  signals: PageSignals,
): boolean {
  if (signals.main.key !== null && key === signals.main.key) return true;
  if (region && (region.hasRequiredFields || region.containsFocus)) return true;
  if (
    region &&
    isProtectedRole(region.ruleRole) &&
    region.rulePrecision >= RULE_PRECISION_MIN
  )
    return true;
  if (!ev) return false;
  if (
    ev.required_fields ||
    ev.dom_position === 'inside_main' ||
    ev.landmark === 'main'
  )
    return true;
  const words = [
    ...ev.class_words,
    ...ev.heading_words.split(' '),
    ...ev.control_words.flatMap((c) => c.split(' ')),
  ];
  if (
    ev.landmark === 'search' ||
    (ev.inputs !== '0' && words.includes('search'))
  )
    return true;
  return words.some((w) => HELP_CONTACT_WORDS.has(w));
}

/** Recommendations are the content on feeds and search results (strategy table 3.7). */
export const isFeedLike = (category: PageCategory): boolean =>
  category === 'feed_social' || category === 'search_results';

/**
 * Map page-analysis answers to verdicts with the veto-first rule
 * (ai-architecture.md 3.5-3.6): protected if P(protected role) >= 0.05 or
 * P(task need) >= 0.20 or a local protective rule fires; feed/search centre
 * columns are protected; else label by P(eligible).
 * `ridToKey` maps ephemeral region ids back to component keys.
 * `evidence` (component key -> the evidence that was sent) enables the
 * word- and position-based local protective rules.
 */
export function verdictsFromAnswers(
  answers: Extract<DecideResponse, { ok: true }>,
  ridToKey: Record<string, string>,
  signals: PageSignals,
  category: PageCategory,
  cal: Recalibration = IDENTITY_RECALIBRATION,
  evidence: Record<string, RegionEvidence> = {},
): Record<string, RegionVerdict> {
  const byKey = new Map(signals.regions.map((r) => [r.key, r] as const));
  const out: Record<string, RegionVerdict> = {};

  for (const [rid, answer] of Object.entries(answers.regions)) {
    const key = ridToKey[rid];
    if (key === undefined) continue;
    const region = byKey.get(key);
    const ev = evidence[key];

    const p = (role: RegionRole) => clamp01(answer.role[role] ?? 0);
    const sum = (roles: readonly RegionRole[]) =>
      roles.reduce((acc, r) => acc + p(r), 0);
    const pElig = clamp01(cal.dimEligible(clamp01(sum(DIMMABLE_ROLES))));
    const pProt = clamp01(cal.protectedRole(clamp01(sum(PROTECTED_ROLES))));
    const pTask = clamp01(cal.taskNeed(clamp01(answer.task)));

    let top: RegionRole = 'other';
    for (const role of REGION_ROLES) if (p(role) > p(top)) top = role;
    let topDimmable: RegionRole = DIMMABLE_ROLES[0]!;
    for (const role of DIMMABLE_ROLES)
      if (p(role) > p(topDimmable)) topDimmable = role;

    const zone = region?.zone ?? ev?.zone;
    const feedCenter = isFeedLike(category) && zone === 'center_column';
    const localProtect = locallyProtected(key, region, ev, signals);

    if (
      localProtect ||
      feedCenter ||
      pProt >= VETO.protectedRole ||
      pTask >= VETO.taskNeed
    ) {
      out[key] = {
        key,
        role: p(top) >= ROLE_NAMED_MIN ? top : null,
        label: null,
        protected: true,
        source: 'page_analysis',
        pEligible: pElig,
      };
      continue;
    }

    const label = labelFor(pElig, pTask);
    out[key] = {
      key,
      role:
        p(top) >= ROLE_NAMED_MIN ? top : label !== null ? topDimmable : null,
      label,
      protected: false,
      source: 'page_analysis',
      pEligible: pElig,
    };
  }
  return out;
}

/**
 * Combine rule verdicts with page-analysis verdicts. Rules win where they
 * decided (precision >= 0.90) except that protection always wins: a
 * page-analysis "protected" undoes a rule's dimming (ai-architecture.md 3.6).
 */
export function combineVerdicts(
  rules: Record<string, RegionVerdict>,
  analysis: Record<string, RegionVerdict>,
): Record<string, RegionVerdict> {
  const out: Record<string, RegionVerdict> = { ...analysis };
  for (const [key, rule] of Object.entries(rules)) {
    const other = analysis[key];
    out[key] =
      other && other.protected && !rule.protected
        ? { ...rule, protected: true, label: null, pEligible: 0 }
        : rule;
  }
  return out;
}

export interface MainPickVerdict {
  /** Component key of the picked candidate, or null for none / too unsure. */
  key: string | null;
  /** clear: main scope for all main ops; likely: paint-only offers only; null: nothing main-scoped. */
  label: 'clear' | 'likely' | null;
  p: number;
}

/** Read the `main_pick` answer: only the argmax and its probability are used (IIA fails). */
export function mainFromAnswers(
  answers: Extract<DecideResponse, { ok: true }>,
  cidToKey: Partial<Record<'c1' | 'c2' | 'c3' | 'c4', string>>,
): MainPickVerdict {
  const pick = answers.mainPick;
  if (!pick) return { key: null, label: null, p: 0 };
  let best: 'c1' | 'c2' | 'c3' | 'c4' | 'none' = 'none';
  for (const option of ['c1', 'c2', 'c3', 'c4', 'none'] as const) {
    if ((pick[option] ?? 0) > (pick[best] ?? 0)) best = option;
  }
  const p = clamp01(pick[best] ?? 0);
  if (best === 'none') return { key: null, label: null, p };
  const key = cidToKey[best] ?? null;
  if (key === null) return { key: null, label: null, p };
  return {
    key,
    label:
      p >= MAIN_PICK.clear ? 'clear' : p >= MAIN_PICK.likely ? 'likely' : null,
    p,
  };
}

/**
 * Signals with the main region replaced by a confident page-analysis pick
 * (label 'clear'), so main-scoped ops (focus view, line length) can use it.
 */
export function withMainPick(
  signals: PageSignals,
  pick: MainPickVerdict,
): PageSignals {
  if (pick.key === null || pick.label !== 'clear') return signals;
  return { ...signals, main: { key: pick.key, ambiguous: false } };
}

export interface PageTypeVerdict {
  category: PageCategory;
  p: number;
  /** 'priors_and_risk' at p >= 0.80, 'priors' at 0.60-0.80, 'none' below (category stays local). */
  use: 'priors_and_risk' | 'priors' | 'none';
}

/** Read the `page_type` fallback answer (ai-architecture.md 3.5). */
export function pageTypeFromAnswers(
  answers: Extract<DecideResponse, { ok: true }>,
): PageTypeVerdict | null {
  const dist = answers.pageType;
  if (!dist) return null;
  let best: PageCategory = 'other';
  for (const c of PAGE_CATEGORIES)
    if ((dist[c] ?? 0) > (dist[best] ?? 0)) best = c;
  const p = clamp01(dist[best] ?? 0);
  if (p >= PAGE_TYPE.clear)
    return { category: best, p, use: 'priors_and_risk' };
  if (p >= PAGE_TYPE.likely) return { category: best, p, use: 'priors' };
  return { category: 'other', p, use: 'none' };
}
