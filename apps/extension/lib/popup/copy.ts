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
    'status' | 'changes' | 'domain' | 'undoneByYou' | 'account'
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
  return baseCopy(view.status, applied, site, view.undoneByYou.length > 0);
}

export function baseCopy(
  status: PopupStatus,
  applied: number,
  site: string,
  undoneByYou: boolean,
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
      return undoneByYou
        ? {
            glyph: 'on',
            title: 'Changes undone on this page',
            sentence: 'The page is as the site made it.',
          }
        : {
            glyph: 'on',
            title: 'This page already fits you',
            sentence: 'WebAble checked it against your fit.',
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

export const COPY = {
  siteSwitch: 'WebAble on this site',
  whatChanged: 'What changed',
  showOnPage: 'Show on page',
  undo: 'Undo',
  undoAll: 'Undo all',
  whatWasSent: 'What was sent',
  yourFit: 'Your fit',
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
  allowAll: 'Allow on all sites',
  why: 'Why?',
  whyUndone:
    'WebAble checks every change right after it makes it. If a change cuts off text, overlaps it, or hides the keyboard outline, WebAble puts it back at once. The rest of the page is not affected.',
  signedOut: 'Your fit is on this device only. Sign in to use it elsewhere.',
  onDevice: 'Suggestions run on this device only.',
  activeTabOnly:
    'WebAble is adapting this page because you opened it. Allow all sites to adapt pages as they load.',
  siteAccess:
    'With access, WebAble reads the layout of each page on this device to adjust it. Page text and anything you type never leave your computer.',
  needsReload: 'Reload the page to see WebAble’s changes.',
  textSize: 'Text size',
  lineSpacing: 'Line spacing',
  targets: 'Bigger click targets',
  targetsDesc: 'At least 44 px',
  motion: 'Pause moving things',
  everywhere: 'Use these on every site',
  notResponding: 'WebAble isn’t responding',
  notRespondingBody:
    'Nothing on this page changed. Close WebAble and open it again.',
} as const;
