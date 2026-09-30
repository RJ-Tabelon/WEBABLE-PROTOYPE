import type { VerifyCode } from '@webable/core/policy/types';
import type { ExtensionStatus } from '@webable/ui';

import type { PopupStatus } from '../protocol';
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
    'status' | 'changes' | 'domain' | 'undoneByYou' | 'account' | 'offer'
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
  return baseCopy(view.status, applied, site, {
    undoneByYou: view.undoneByYou.length > 0,
    calibrated: view.account.calibrated,
    offer: view.offer !== null,
  });
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
        title: 'This page already fits you',
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
};

export const undoneHere = (vcode: VerifyCode | undefined): string =>
  `Undone here: ${UNDONE_SHORT[vcode ?? 'apply_error']}`;

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
} as const;
