import { explainUndone, offerQuestion } from '@webable/core/explain/templates';
import { OP_CATALOG, type OpId } from '@webable/core/ops/catalog';
import type { AppliedChange, PlannedOp } from '@webable/core/policy/types';

import type { PopupStatus } from '../protocol';
import type { TabDetail } from '../sw/ui';
import type { UndoReason } from '../sw/undo';
import { COPY, stateCopy, type StateCopy } from './copy';
import { displayDomain } from '../sw/domain';

/**
 * What the popup shows for a tab (design-final 10.2), as data. The React
 * view renders this and nothing else decides layout, so every state is
 * covered by unit tests. Block order is always: domain, state line,
 * sentence, state body, (offer), What changed, Adjust, footer.
 */

export type PrimaryAction =
  | { kind: 'resume'; label: string }
  | { kind: 'turn_on'; label: string }
  | { kind: 'reload'; label: string }
  | { kind: 'allow'; label: string }
  | { kind: 'fit'; label: string };

export type FooterAction = 'sent' | 'undo_all' | 'fit' | 'sign_in';

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
  offer: OfferModel | null;
  changes: ChangeRow[];
  undone: UndoneRow[];
  /** "What changed" folds into one disclosure row while an offer is showing. */
  collapseChanges: boolean;
  showAdjust: boolean;
  /** Meta lines above the footer (signed out, on-device only, reload). */
  notes: string[];
  /** WebAble runs here only because the popup was opened: offer all-sites access. */
  askAllSites: boolean;
  footer: FooterAction[];
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

const FIT = 'fit' as const;

function footerFor(
  status: PopupStatus,
  view: TabDetail,
  count: number,
): FooterAction[] {
  const signIn = !view.account.signedIn && !view.account.needsReauth;
  switch (status) {
    case 'first_run':
      return signIn ? ['sent', 'sign_in'] : ['sent', FIT];
    case 'adapted':
      return count > 0 ? ['sent', 'undo_all'] : ['sent', FIT];
    case 'off':
      return [FIT];
    case 'cant_run':
      return ['sent'];
    default:
      return ['sent', FIT];
  }
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
    primary = { kind: 'allow', label: COPY.allowAll };
  else if (status === 'cant_run')
    primary = { kind: 'fit', label: 'Open your fit' };

  const offer =
    pageRuns && status !== 'paused' && status !== 'needs_site_access'
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

  const notes: string[] = [];
  if (view.needsReload && pageRuns && status !== 'paused')
    notes.push(COPY.needsReload);
  const askAllSites =
    pageRuns &&
    !view.allSites &&
    status !== 'needs_site_access' &&
    status !== 'paused';
  if (status !== 'off' && status !== 'cant_run') {
    if (!view.account.signedIn && !view.account.needsReauth)
      notes.push(COPY.signedOut);
    else if (view.account.signedIn && view.onDeviceOnly)
      notes.push(COPY.onDevice);
  }

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
    offer,
    changes,
    undone,
    collapseChanges: offer !== null && changes.length > 0,
    showAdjust,
    notes,
    askAllSites,
    footer: footerFor(status, view, count),
  };
}

/** Whether the popup should keep asking for a fresh view (the page is still being checked). */
export const isChecking = (status: PopupStatus): boolean =>
  status === 'checking' || status === 'still_checking';
