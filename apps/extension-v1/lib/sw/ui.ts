import type { OpId } from '@webable/core/ops/catalog';
import type { SentReceipt } from '@webable/core/bridge/protocol';
import type { SystemSignals } from '@webable/core/profile/defaults';
import type { FitProfile } from '@webable/core/profile/schema';

import type { QuickKey, TabView, UiToWorker } from '../protocol';
import type { Theme } from '../storage/settings';
import type { UndoReason } from './undo';

/**
 * Popup and welcome page <-> worker, beyond the shared `UiToWorker` contract.
 * TabDetail extends TabView with what the popup needs to render every state
 * without a second round trip.
 */
export interface TabDetail extends TabView {
  /** Ops the person undid on this page view. */
  undoneByYou: OpId[];
  /** Undos still inside the reason-chip window (the popup may ask why). */
  reasonOpen: Array<{ op: OpId; until: number }>;
  /** This site's rule (Adjust, quick switches). */
  site: {
    paused: boolean;
    pins: OpId[];
    blocks: OpId[];
    levels: Partial<Record<OpId, number>>;
  };
  /** Levels the Adjust sliders show: manual, else in effect, else the default. */
  levels: { text_floor: number; line_spacing: number; target_size: number };
  /** First-run quick switches for this site. */
  quick: { text: boolean; targets: boolean; calm: boolean };
  /**
   * Quick switches that are pinned but whose op WebAble's checks undid on this
   * page (the change's `vcode` says why). The popup shows them Off with the
   * reason and leaves the pin alone.
   */
  quickUndone: QuickKey[];
  /** Show on page is on for this tab (cleared on navigation). */
  showing: boolean;
  /** Levels set with "Use these on every site" (settings.globalLevels). */
  globalOverrides: Partial<
    Record<'text_floor' | 'line_spacing' | 'target_size', number>
  >;
  /** Last successful sync with the account, ms since epoch. */
  lastSyncAt: number | null;
  /** The person hid the "Allow on all sites" line in the main view. */
  allSitesAskHidden: boolean;
  /** The page was paused when it loaded; it adapts after a reload. */
  needsReload: boolean;
  /** Suggestions run on this device only (signed out, no consent, or analysis unavailable). */
  onDeviceOnly: boolean;
  /**
   * One line on what this page needs for the fit, from triage (core
   * `triageLine`: "This page already fits you.", "Small text for your fit.");
   * null while the page is being read or on pages WebAble does not run on.
   */
  triageLine?: string | null;
  prefs: Prefs;
  links: Links;
}

export interface Prefs {
  theme: Theme;
  reduceMotion: boolean;
  /** The fit profile, for WebAble's own text scale and targets (fitUiVars). */
  profile: FitProfile | null;
  /**
   * The local dev planner switch (settings.devPlanner): its value in a
   * development build whose compose URL is loopback, null in every other
   * build (nothing to show).
   */
  devPlanner?: boolean | null;
  /**
   * Fit view's own Text − / + override (settings.fitTextStep): whole steps
   * of 1.125x from the fit's size, 0 when Fit view uses the fit as is.
   */
  fitTextStep?: number;
  /** "Simplify busy pages automatically" (settings.autoSimplify). */
  autoSimplify?: boolean;
}

export interface Links {
  fit: string;
  tune: string;
  help: string;
  connect: string;
  privacy: string;
}

export interface WelcomeState {
  allSites: boolean;
  connected: boolean;
  email: string | null;
  enabled: boolean;
  links: Links;
  prefs: Prefs;
}

export type UiExtra =
  | { type: 'ui:prefs' }
  | {
      type: 'ui:set-prefs';
      theme?: Theme;
      reduceMotion?: boolean;
      /** Hide the "Allow on all sites" line in the main view (it stays in Settings). */
      hideAllSitesAsk?: boolean;
      /** Development builds only: plan Fit view layouts with the local dev planner. */
      devPlanner?: boolean;
      /** Fit view's text override, in whole steps within ±FIT_TEXT_STEPS_MAX (0 resets it). */
      fitTextStep?: number;
      /** "Simplify busy pages automatically" (docs/11 §2). */
      autoSimplify?: boolean;
    }
  /** matchMedia results from an extension page (the worker has no window). */
  | { type: 'ui:system'; signals: SystemSignals }
  | { type: 'ui:welcome' }
  /** Mark the offer on screen in the popup as seen (counts against the budget once). */
  | { type: 'ui:offer-seen'; tabId: number }
  /** First-run quick switches for this site. */
  | {
      type: 'ui:quick';
      tabId: number;
      key: QuickKey;
      on: boolean;
    }
  /** "Use these on every site": this site's levels and switches become the default. */
  | { type: 'ui:use-everywhere'; tabId: number }
  /** The optional reason chip after an undo (inside or after the 8 s window). */
  | { type: 'ui:undo-reason'; tabId: number; op: OpId; reason: UndoReason }
  /** Test-only: accepted only by e2e builds. */
  | { type: 'e2e:seed'; profile?: unknown; reset?: boolean; account?: unknown }
  | { type: 'e2e:state' };

export type UiMessage = UiToWorker | UiExtra;

export interface UiReplies {
  'ui:view': TabDetail;
  'ui:receipts': SentReceipt[];
  'ui:prefs': Prefs;
  'ui:welcome': WelcomeState;
  'ui:grant-all-sites': WelcomeState;
}

/** Worker -> extension pages broadcast: the view for a tab changed. */
export interface UiChanged {
  type: 'ui:changed';
  tabId: number | null;
}
