import type { VerifyCode } from '@webable/core/policy/types';
import type { ExtensionStatus } from '@webable/ui';

import type { FitViewUnavailable, PopupStatus } from '../protocol';
import type { TabDetail } from '../sw/ui';

/**
 * Popup copy (design-final 10.2 and 13). Calm, exact, short; pages and
 * functions, never people; "Tune" and "your fit"; no exclamation marks.
 */

export type StateGlyph = ExtensionStatus | 'still-checking';

export interface StateCopy {
  glyph: StateGlyph;
  title: string;
  sentence: string;
}

const count = (n: number): string => `${n} ${n === 1 ? 'change' : 'changes'}`;

/** The state the popup shows, derived from the worker's view. Pure. */
export function stateCopy(
  view: Pick<
    TabDetail,
    | 'status'
    | 'changes'
    | 'domain'
    | 'undoneByYou'
    | 'account'
    | 'offer'
    | 'triageLine'
    | 'fitView'
  >,
): StateCopy {
  const applied = view.changes.filter((c) => c.status === 'applied').length;
  const site = view.domain ?? 'This page';
  if (view.account.needsReauth && view.status !== 'off')
    return {
      glyph: 'attention',
      title: 'Sign in again to sync',
      sentence: 'Your fit still works on this device.',
    };
  const base = baseCopy(view.status, applied, site, {
    undoneByYou: view.undoneByYou.length > 0,
    calibrated: view.account.calibrated,
    offer: view.offer !== null,
  });
  // Fit view shows the page restructured (docs/11): that is what changed,
  // whatever Tailor holds underneath.
  if (view.fitView?.open && SIMPLIFIABLE.has(view.status))
    return {
      glyph: 'adapted',
      title: 'Page simplified',
      sentence: view.triageLine ?? 'The same content, in a calmer layout.',
    };
  return withTriage(base, view);
}

/** States in which the page is read and adapted, so a simplified view can be said. */
const SIMPLIFIABLE: ReadonlySet<PopupStatus> = new Set([
  'adapted',
  'nothing_to_change',
  'all_undone',
]);

const FITS_TITLE = 'This page already fits you';

const sameWords = (a: string, b: string): boolean =>
  a.replace(/[.\s]+$/, '').toLowerCase() ===
  b.replace(/[.\s]+$/, '').toLowerCase();

/**
 * Triage's one line ("Small text and crowded buttons for your fit.") becomes
 * the sentence once WebAble has finished with the page (docs/10 §3.2). A
 * page that triage says needs something is never said to "already fit you";
 * an undo by the person, or a page that fits, keeps the state's own words.
 */
function withTriage(
  base: StateCopy,
  view: Pick<TabDetail, 'status' | 'undoneByYou' | 'triageLine' | 'fitView'>,
): StateCopy {
  const line = view.triageLine;
  if (!line) return base;
  const fits = view.fitView
    ? view.fitView.verdict === 'fits'
    : sameWords(line, FITS_TITLE);
  if (fits) return base;
  if (view.status === 'adapted') return { ...base, sentence: line };
  if (view.status === 'nothing_to_change' && view.undoneByYou.length === 0)
    return { ...base, title: 'Nothing changed here', sentence: line };
  return base;
}

export interface CopyContext {
  /** The person undid changes on this page view. */
  undoneByYou: boolean;
  /** There is a tuned fit; otherwise pages are checked against the basic fit. */
  calibrated: boolean;
  /** An offer is waiting on this page. */
  offer: boolean;
}

export function baseCopy(
  status: PopupStatus,
  applied: number,
  site: string,
  { undoneByYou, calibrated, offer }: CopyContext,
): StateCopy {
  switch (status) {
    case 'first_run':
      return {
        glyph: 'on',
        title: 'Basic fit is on',
        sentence:
          'Small safe fixes work on every site. Tune WebAble to you for more.',
      };
    case 'checking':
      return {
        glyph: 'checking',
        title: 'Checking this page…',
        sentence: 'The page stays as it is until WebAble is sure.',
      };
    case 'still_checking':
      return {
        glyph: 'still-checking',
        title: 'Still checking',
        sentence: 'Keep reading. Nothing changes until it’s done.',
      };
    case 'adapted':
      return {
        glyph: 'adapted',
        title: `Adapted · ${count(applied)}`,
        sentence: 'Each one passed WebAble’s checks.',
      };
    case 'nothing_to_change':
      if (undoneByYou)
        return {
          glyph: 'on',
          title: 'Changes undone on this page',
          sentence: 'The page is as the site made it.',
        };
      // "Already fits you" only when there is nothing left to suggest.
      if (offer)
        return {
          glyph: 'on',
          title: 'Nothing changed here',
          sentence: 'WebAble has one suggestion.',
        };
      return {
        glyph: 'on',
        title: FITS_TITLE,
        sentence: calibrated
          ? 'WebAble checked it against your fit.'
          : 'WebAble checked it against the basic fit.',
      };
    case 'all_undone':
      return {
        glyph: 'on',
        title: 'WebAble undid its changes here',
        sentence:
          'They didn’t pass its checks on this page. The page is as the site made it.',
      };
    case 'paused':
      return {
        glyph: 'paused',
        title: 'Paused on this site',
        sentence: `${site} looks the way the site made it.`,
      };
    case 'off':
      return {
        glyph: 'paused',
        title: 'WebAble is off',
        sentence: 'No site is being changed.',
      };
    case 'cant_run':
      return {
        glyph: 'cant-run',
        title: 'WebAble can’t change this page',
        sentence:
          'Chrome doesn’t let extensions change its own pages or the Web Store.',
      };
    case 'unreadable':
      return {
        glyph: 'attention',
        title: 'WebAble couldn’t read this page',
        sentence: 'Reload the page to try again. Nothing was changed.',
      };
    case 'needs_site_access':
      return {
        glyph: 'on',
        title: 'Allow WebAble on this site',
        sentence: 'WebAble changes pages only where you let it.',
      };
  }
}

/** Short reasons for a quick switch the checks undid: "Undone here: it cut off text". */
const UNDONE_SHORT: Readonly<Record<VerifyCode, string>> = {
  clip: 'it cut off text',
  overlap: 'it made text overlap',
  overflow: 'it pushed content past the edge',
  contrast_drop: 'it made text harder to read',
  focus_hidden: 'it hid the keyboard outline',
  control_collapsed: 'it made a control too small',
  layout_shift: 'it made the page jump',
  focus_lost: 'it moved your place on the page',
  timeout: 'the page took too long to check',
  apply_error: 'it didn’t work on this page',
  hierarchy: 'it made small text bigger than headings',
  inconsistent: 'it sized matching items differently',
  truncation: 'it cut off more text than before',
  nav_hidden: 'it hid the site’s menu or search',
};

export const undoneHere = (vcode: VerifyCode | undefined): string =>
  `Undone here: ${UNDONE_SHORT[vcode ?? 'apply_error']}`;

/**
 * A page zoom the checks lowered by one step and kept (docs/10 §5.1): the
 * row's note under its 100% -> 125% mark.
 */
const ZOOM_LOWERED: Readonly<Partial<Record<VerifyCode, string>>> = {
  nav_hidden: 'Lowered so the site’s menu stays in view',
  overflow: 'Lowered so the page fits the window',
};

export const zoomLowered = (vcode: VerifyCode): string =>
  ZOOM_LOWERED[vcode] ?? 'Lowered to suit this page';

/** Why Fit view can't show this page, in one plain line. */
export const FIT_VIEW_WHY: Readonly<Record<FitViewUnavailable, string>> = {
  not_representable: 'This page can’t be shown in Fit view.',
  blocked_overlay: 'Close the site’s pop-up first, then try Fit view.',
  excluded: 'Fit view isn’t used on banking, health or government sites.',
  stale: 'The page changed while Fit view was opening. Try again.',
  error: 'Fit view didn’t open on this page. Try again.',
};

export const COPY = {
  siteSwitch: 'WebAble on this site',
  whatChanged: 'What changed',
  showOnPage: 'Show on page',
  undo: 'Undo',
  undoAll: 'Undo all',
  redoAll: 'Redo all',
  whatWasSent: 'What was sent',
  yourFit: 'Your fit',
  openFit: 'Open your fit',
  signIn: 'Sign in',
  settings: 'Settings',
  back: 'Back',
  adjust: 'Adjust for this site',
  quickTitle: 'Quick changes for this site',
  quickText: 'Larger text',
  quickTargets: 'Bigger click targets',
  quickCalm: 'Calmer page',
  tune: 'Tune WebAble to you',
  tuneMeta: 'About 6 minutes. Skip any part.',
  resume: 'Resume on this site',
  turnOn: 'Turn WebAble on',
  reload: 'Reload page',
  allowSite: 'Allow on this site',
  allowAll: 'Allow on all sites',
  orAllowAll: 'Or allow on all sites',
  why: 'Why?',
  whyUndone:
    'WebAble checks every change right after it makes it. If a change cuts off text, overlaps it, or hides the keyboard outline, WebAble puts it back at once. The rest of the page is not affected.',
  signedOut: 'Your fit is on this device only. Sign in to use it elsewhere.',
  onDevice: 'Suggestions run on this device only.',
  activeTabOnly: 'WebAble is on here because you opened it from the toolbar.',
  hideAsk: 'Hide this line',
  siteAccess:
    'With access, WebAble reads the layout of each page in this browser to adjust it. Page text and anything you type never leave your browser.',
  needsReload: 'Reload the page to see WebAble’s changes.',
  textSize: 'Text size',
  lineSpacing: 'Line spacing',
  targets: 'Bigger click targets',
  targetsDesc: 'Up to 44 px where there’s room',
  motion: 'Pause moving things',
  everywhere: 'Use these on every site',
  notResponding: 'WebAble isn’t responding',
  notRespondingBody:
    'Nothing on this page changed. Close WebAble and open it again.',
  fitView: 'Simplify this page',
  fitViewDesc: 'The same content, in a calmer layout built for your fit.',
  fitViewOn: 'Simplified for your fit.',
  alwaysHere: 'Always here',
  alwaysHereDesc: 'Simplify this site every time.',
  autoSimplify: 'Simplify busy pages automatically',
  autoSimplifyDesc:
    'Busy pages open simplified when your fit shows they slow you down. The original page is one click away.',
  planning: 'Planning a better layout…',
  betterReady: 'A better layout is ready',
  switchLayout: 'Switch',
  switchLayoutLabel: 'Switch to the better layout',
  betterLayouts: 'Better layouts',
  betterLayoutsNote:
    'Fit view can get better layouts from OpenAI if you allow it.',
  fitViewNotice:
    'WebAble now simplifies busy pages for your fit: the same content, in a calmer layout. Pages that are only a little small are zoomed instead.',
  hideNotice: 'Hide this note',
  devPlanner: 'Local dev planner',
  devPlannerDesc:
    'Plans Fit view layouts on this computer with pnpm dev:compose. Development builds only.',
  fitTextReset: 'Reset Fit view text',
} as const;
