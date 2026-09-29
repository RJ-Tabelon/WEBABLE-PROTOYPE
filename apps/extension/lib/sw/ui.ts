import type { OpId } from '@webable/core/ops/catalog';
import type { SentReceipt } from '@webable/core/bridge/protocol';
import type { SystemSignals } from '@webable/core/profile/defaults';
import type { FitProfile } from '@webable/core/profile/schema';

import type { TabView, UiToWorker } from '../protocol';
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
  /** The page was paused when it loaded; it adapts after a reload. */
  needsReload: boolean;
  /** Suggestions run on this device only (signed out, no consent, or analysis unavailable). */
  onDeviceOnly: boolean;
  prefs: Prefs;
  links: Links;
}

export interface Prefs {
  theme: Theme;
  reduceMotion: boolean;
  /** The fit profile, for WebAble's own text scale and targets (fitUiVars). */
  profile: FitProfile | null;
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
  | { type: 'ui:set-prefs'; theme?: Theme; reduceMotion?: boolean }
  /** matchMedia results from an extension page (the worker has no window). */
  | { type: 'ui:system'; signals: SystemSignals }
  | { type: 'ui:welcome' }
  /** Mark the offer on screen in the popup as seen (counts against the budget once). */
  | { type: 'ui:offer-seen'; tabId: number }
  /** First-run quick switches for this site. */
  | {
      type: 'ui:quick';
      tabId: number;
      key: 'text' | 'targets' | 'calm';
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
