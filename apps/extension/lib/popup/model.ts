import { explainUndone, offerQuestion } from '@webable/core/explain/templates';
import { OP_CATALOG, type OpId } from '@webable/core/ops/catalog';
import type { AppliedChange, PlannedOp } from '@webable/core/policy/types';

import type { PopupStatus, QuickKey } from '../protocol';
import type { Prefs, TabDetail, UiMessage } from '../sw/ui';
import type { UndoReason } from '../sw/undo';
import {
  COPY,
  FIT_VIEW_WHY,
  stateCopy,
  undoneHere,
  type StateCopy,
} from './copy';
import { displayDomain } from '../sw/domain';
import { plural } from './format';

/**
 * What the popup shows for a tab (design-final 10.2), as data. The React
 * view renders this and nothing else decides layout, so every state is
 * covered by unit tests. Block order is always: domain, state line,
 * sentence, state body, (notice), Fit view, What changed, (offer), Adjust
 * or the quick switches, footer. What changed never folds away.
 */

export type PrimaryAction =
  | { kind: 'resume'; label: string }
  | { kind: 'turn_on'; label: string }
  | { kind: 'reload'; label: string }
  /** Needs site access: this origin only; all sites is a link below it. */
  | { kind: 'allow'; label: string }
  /** Can't run, not tuned yet. */
  | { kind: 'tune'; label: string }
  /** Can't run, signed out with a fit on this device. */
  | { kind: 'sign_in'; label: string }
  | { kind: 'fit'; label: string };

export type FooterAction = 'sent' | 'undo_all' | 'redo_all' | 'fit' | 'sign_in';

/**
 * The footer's two fixed slots: [start, end]. Start is only ever "What was
 * sent"; end is the state's action. An empty slot keeps its place.
 */
export type FooterSlots = readonly [
  start: FooterAction | null,
  end: FooterAction | null,
];

export interface QuickRow {
  key: QuickKey;
  op: OpId;
  label: string;
  /** On only when pinned and on the page: a pin the checks undid shows Off. */
  on: boolean;
  /** "Undone here: it cut off text" when the checks undid it on this page. */
  undone: string | null;
}

export interface ChangeRow {
  op: OpId;
  label: string;
  change: AppliedChange;
}

export interface UndoneRow {
  op: OpId;
  /** "Line spacing was undone" */
  title: string;
  /** "It made text overlap here, so WebAble put it back." */
  detail: string;
}

export interface OfferModel {
  op: OpId;
  question: string;
  reason: string;
  planned: PlannedOp;
}

export interface ReasonChip {
  reason: UndoReason;
  label: string;
}

/**
 * The Fit view block (docs/10 §4.5, §6, docs/11 §2). One switch, "Simplify
 * this page", opens or closes Fit view in this tab on every page it can show,
 * whatever triage says; "Always here" opens it on this site by itself. When
 * the page can't be shown, one plain line says why instead.
 */
export interface FitViewModel {
  /** The Fit view switch: on while open, or while Fit view follows this tab. */
  toggle: { on: boolean; description: string | null } | null;
  /** "Always here" for this site (shown once Fit view is on, or the site has it). */
  always: { on: boolean } | null;
  /** Why the page can't be shown (no switch), or "Planning a better layout…". */
  line: string | null;
  /** "A better layout is ready · Switch": the planner's layout, while the quick one shows. */
  better: boolean;
  /** "Better layouts": the consent on the web Privacy page (signed in, not allowed yet). */
  consent: boolean;
}

export interface PopupModel {
  domainLine: string | null;
  copy: StateCopy;
  /** "Sign in again to sync": [Sign in] above the underlying state. */
  reauth: boolean;
  /** The "WebAble on this site" switch, when this state has one. */
  siteSwitch: { on: boolean } | null;
  primary: PrimaryAction | null;
  /** First run: the three quick switches and the Tune call. */
  quick: boolean;
  quickRows: QuickRow[];
  offer: OfferModel | null;
  fitView: FitViewModel | null;
  changes: ChangeRow[];
  undone: UndoneRow[];
  /** Always false: What changed stays open in every offer state. */
  collapseChanges: boolean;
  showAdjust: boolean;
  /** Meta lines above the footer (only "reload to see changes"). */
  notes: string[];
  /**
   * WebAble runs here only because the popup was opened: one meta line with an
   * "Allow on all sites" link, until the person hides it.
   */
  askAllSites: boolean;
  footer: FooterSlots;
}

const applied = (changes: readonly AppliedChange[]): AppliedChange[] =>
  changes.filter((c) => c.status === 'applied');

/** Split "Line spacing was undone. It made ..." into its title and its reason. */
export function undoneRow(change: AppliedChange): UndoneRow {
  const { detail } = explainUndone(change);
  const cut = detail.indexOf('. ');
  const title =
    cut > 0
      ? detail.slice(0, cut)
      : `${OP_CATALOG[change.op].label} was undone`;
  const rest = cut > 0 ? detail.slice(cut + 2) : detail;
  return { op: change.op, title, detail: rest };
}

export function offerModel(planned: PlannedOp | null): OfferModel | null {
  if (!planned) return null;
  const { question, reason } = offerQuestion(planned.trace);
  return { op: planned.op, question, reason, planned };
}

/** Reason chips after an undo: short, 1-3 words, never about the person. */
export function reasonChips(op: OpId): ReasonChip[] {
  const def = OP_CATALOG[op];
  const chips: ReasonChip[] = [
    { reason: 'dont_want', label: 'Didn’t want it' },
  ];
  if (def.dim !== null && def.levels.length > 1) {
    chips.push(
      { reason: 'too_much', label: 'Too much' },
      { reason: 'too_little', label: 'Not enough' },
    );
  }
  if (def.scope === 'region')
    chips.push({ reason: 'needed_that', label: 'Needed that' });
  chips.push({ reason: 'broke_page', label: 'Broke the page' });
  return chips;
}

const QUICK: ReadonlyArray<{ key: QuickKey; op: OpId; label: string }> = [
  { key: 'text', op: 'text_floor', label: COPY.quickText },
  { key: 'targets', op: 'target_size', label: COPY.quickTargets },
  { key: 'calm', op: 'calm_motion', label: COPY.quickCalm },
];

/** The quick switches tell the truth: a pin the checks undid here reads Off. */
export function quickRows(
  view: Pick<TabDetail, 'quick' | 'quickUndone' | 'changes'>,
): QuickRow[] {
  const undoneKeys = view.quickUndone ?? [];
  return QUICK.map(({ key, op, label }) => {
    const undone = view.quick[key] && undoneKeys.includes(key);
    const change = undone
      ? view.changes.find((c) => c.op === op && c.status === 'undone_by_checks')
      : undefined;
    return {
      key,
      op,
      label,
      on: view.quick[key] && !undone,
      undone: undone ? undoneHere(change?.vcode) : null,
    };
  });
}

/** States with no Fit view block: WebAble can't run, read or reach the page, or is paused or off here. */
const FIT_VIEW_HIDDEN: ReadonlySet<PopupStatus> = new Set([
  'cant_run',
  'unreadable',
  'needs_site_access',
  'paused',
  'off',
]);

/**
 * The Fit view block for this tab, or null when there is nothing worth
 * saying: the page can't be shown and the person hasn't asked for Fit view
 * here and triage doesn't suggest it.
 */
export function fitViewModel(
  view: Pick<TabDetail, 'status' | 'fitView' | 'account'>,
): FitViewModel | null {
  const fv = view.fitView;
  if (!fv || FIT_VIEW_HIDDEN.has(view.status)) return null;
  const on = fv.open || fv.tabMode;
  const shown = fv.available || fv.open;
  const why = fv.why ? FIT_VIEW_WHY[fv.why] : null;
  const engaged = on || fv.mode === 'auto' || fv.verdict === 'compose';
  if (!shown && !(engaged && why)) return null;

  const toggle: FitViewModel['toggle'] =
    shown || on
      ? {
          on,
          description: why ?? (on ? COPY.fitViewOn : COPY.fitViewDesc),
        }
      : null;
  const pending = fv.open && fv.planner === 'pending';
  return {
    toggle,
    always:
      fv.mode !== 'off' && (on || fv.mode === 'auto')
        ? { on: fv.mode === 'auto' }
        : null,
    line: toggle ? (pending ? COPY.planning : null) : why,
    better: fv.open && fv.planner === 'ready' && fv.source === 'heuristic',
    consent:
      fv.open &&
      fv.planner === 'unavailable' &&
      view.account.signedIn &&
      view.account.aiLayout !== true &&
      fv.needsConsent === true,
  };
}

/**
 * The local dev planner switch (Settings): its value in a development build
 * with a loopback planner, null (no switch) in every other build.
 */
export const devPlannerSwitch = (prefs: Prefs): boolean | null =>
  typeof prefs.devPlanner === 'boolean' ? prefs.devPlanner : null;

/**
 * "Simplify busy pages automatically" (settings.autoSimplify, docs/11 §2):
 * on unless the person turned it off (older workers do not say: on).
 */
export const autoSimplifySwitch = (prefs: Prefs): boolean =>
  prefs.autoSimplify !== false;

/**
 * Fit view's Text − / + override (settings.fitTextStep); 0 means Fit view
 * uses the fit's own size.
 */
export function fitTextStep(prefs: Prefs): number {
  const step: unknown = prefs.fitTextStep;
  return typeof step === 'number' && Number.isFinite(step)
    ? Math.round(step)
    : 0;
}

/** "In Fit view, text is 2 steps larger than your fit." (null at 0). */
export function fitTextLine(step: number): string | null {
  if (step === 0) return null;
  const steps = plural(Math.abs(step), 'step', 'steps');
  return `In Fit view, text is ${steps} ${step > 0 ? 'larger' : 'smaller'} than your fit.`;
}

/** Resets Fit view's text override. */
export const RESET_FIT_TEXT: Extract<UiMessage, { type: 'ui:set-prefs' }> = {
  type: 'ui:set-prefs',
  fitTextStep: 0,
};

/** The page's origin for a one-site permission request, or null (not http). */
export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** The account's action for the end slot: Your fit when signed in, else Sign in. */
function accountAction(view: TabDetail): FooterAction {
  return !view.account.signedIn && !view.account.needsReauth
    ? 'sign_in'
    : 'fit';
}

function footerFor(
  status: PopupStatus,
  view: TabDetail,
  count: number,
): FooterSlots {
  switch (status) {
    case 'off':
      return [null, accountAction(view)];
    case 'cant_run':
      // The body carries the one action (Tune, Sign in or Open your fit).
      return ['sent', null];
    case 'adapted':
      if (count > 0) return ['sent', 'undo_all'];
      break;
    case 'nothing_to_change':
      // After Undo all (or the last Undo) on this page view.
      if (view.undoneByYou.length > 0) return ['sent', 'redo_all'];
      break;
  }
  return ['sent', accountAction(view)];
}

function cantRunAction(view: TabDetail): PrimaryAction {
  if (!view.account.calibrated) return { kind: 'tune', label: COPY.tune };
  if (!view.account.signedIn && !view.account.needsReauth)
    return { kind: 'sign_in', label: COPY.signIn };
  return { kind: 'fit', label: COPY.openFit };
}

export function popupModel(view: TabDetail): PopupModel {
  const status = view.status;
  const copy = stateCopy(view);
  const live = applied(view.changes);
  const count = live.length;
  const reauth = view.account.needsReauth && status !== 'off';
  const pageRuns =
    status !== 'off' && status !== 'cant_run' && status !== 'unreadable';

  let siteSwitch: PopupModel['siteSwitch'] = null;
  if (status === 'paused') siteSwitch = { on: false };
  else if (
    status === 'adapted' ||
    status === 'nothing_to_change' ||
    status === 'all_undone' ||
    status === 'checking' ||
    status === 'still_checking' ||
    status === 'first_run'
  )
    siteSwitch = { on: true };

  let primary: PrimaryAction | null = null;
  if (status === 'paused') primary = { kind: 'resume', label: COPY.resume };
  else if (status === 'off') primary = { kind: 'turn_on', label: COPY.turnOn };
  else if (status === 'unreadable')
    primary = { kind: 'reload', label: COPY.reload };
  else if (status === 'needs_site_access')
    primary = { kind: 'allow', label: COPY.allowSite };
  else if (status === 'cant_run') primary = cantRunAction(view);

  // Tailor's offers are about the original page, out of sight while simplified.
  const offer =
    pageRuns &&
    status !== 'paused' &&
    status !== 'needs_site_access' &&
    view.fitView?.open !== true
      ? offerModel(view.offer)
      : null;

  const showChangeList =
    pageRuns && status !== 'paused' && status !== 'needs_site_access';
  const changes: ChangeRow[] = showChangeList
    ? live.map((c) => ({ op: c.op, label: OP_CATALOG[c.op].label, change: c }))
    : [];
  const undone: UndoneRow[] = showChangeList
    ? view.changes.filter((c) => c.status === 'undone_by_checks').map(undoneRow)
    : [];

  // Signed out and on-device only live in Settings, not here.
  const notes: string[] = [];
  if (view.needsReload && pageRuns && status !== 'paused')
    notes.push(COPY.needsReload);
  const askAllSites =
    pageRuns &&
    !view.allSites &&
    !view.allSitesAskHidden &&
    status !== 'needs_site_access' &&
    status !== 'paused';

  // First run carries its own quick switches instead of the Adjust panel.
  const showAdjust =
    status === 'adapted' ||
    status === 'nothing_to_change' ||
    status === 'all_undone';

  return {
    domainLine: displayDomain(view.domain),
    copy,
    reauth,
    siteSwitch,
    primary,
    quick: status === 'first_run',
    quickRows: status === 'first_run' ? quickRows(view) : [],
    offer,
    fitView: fitViewModel(view),
    changes,
    undone,
    collapseChanges: false,
    showAdjust,
    notes,
    askAllSites,
    footer: footerFor(status, view, count),
  };
}

/** Whether the popup should keep asking for a fresh view (the page is still being checked). */
export const isChecking = (status: PopupStatus): boolean =>
  status === 'checking' || status === 'still_checking';
