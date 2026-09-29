import type {
  AdaptEvent,
  AdaptationPlan,
  AppliedChange,
  OpId,
  PageContext,
  PageSignals,
  RegionEvidence,
} from '@webable/core';

/**
 * Messages inside the extension. The service worker is the only component that
 * holds a session, talks to the network, and owns learning state. The content
 * script measures, applies, verifies, and reports; it never sees tokens.
 */

// ---------------------------------------------------------------------------
// Content script -> service worker (chrome.runtime.sendMessage)
// ---------------------------------------------------------------------------

export interface HelloReply {
  enabled: boolean;
  paused: boolean;
  /** Ops whose registered pre-paint stylesheet is active for this profile. */
  prePaint: OpId[];
  /** Per-tab random id; learning events use it instead of anything linkable. */
  tabSession: string;
}

/** Page-analysis evidence, built with vocabFilter(); the only structure that can leave the device. */
export interface PageEvidence {
  page: PageContext;
  /** Region component key -> evidence, for regions local rules could not decide. */
  regions: Record<string, RegionEvidence>;
  /** Main-content candidate keys when main content is ambiguous (2-4). */
  mainCandidates?: string[];
}

export type ContentToWorker =
  | { type: 'cs:hello' }
  | { type: 'cs:signals'; signals: PageSignals; evidence: PageEvidence }
  | { type: 'cs:applied'; planId: string; changes: AppliedChange[] }
  | { type: 'cs:event'; event: Omit<AdaptEvent, 'v' | 'id' | 't' | 'domain' | 'tabSession' | 'opVer'> }
  | {
      type: 'cs:friction';
      signal: 'misclick_burst' | 'rage_click' | 'zoom_in' | 'scroll_reversal';
      /** Ops the signal is evidence for. */
      ops: OpId[];
    }
  | { type: 'cs:offer-answer'; op: OpId; answer: 'accept' | 'dismiss' | 'never_here' | 'timeout' };

export interface ContentReplies {
  'cs:hello': HelloReply;
  /** `announce`: show the first-visit toast for this site (the service worker remembers where it has). */
  'cs:signals': { plan: AdaptationPlan; announce?: boolean };
  'cs:applied': { ok: true };
  'cs:event': { ok: true };
  'cs:friction': { offer: AdaptationPlan['ops'][number] | null };
  'cs:offer-answer': { plan: AdaptationPlan | null };
}

// ---------------------------------------------------------------------------
// Service worker -> content script (chrome.tabs.sendMessage)
// ---------------------------------------------------------------------------

export type WorkerToContent =
  /** Late page-analysis refinement or a changed decision (e.g. accepted offer). */
  | { type: 'sw:plan'; plan: AdaptationPlan; reason: 'refine' | 'offer_accepted' | 'settings' }
  | { type: 'sw:undo'; op: OpId | 'all'; reason?: 'dont_want' | 'too_much' | 'too_little' | 'broke_page' | 'needed_that' }
  | { type: 'sw:set-level'; op: OpId; level: number }
  | { type: 'sw:pause' }
  | { type: 'sw:resume' }
  | { type: 'sw:show-on-page'; op: OpId | null; on: boolean }
  | { type: 'sw:reading-guide'; on: boolean }
  | { type: 'sw:offer'; offer: AdaptationPlan['ops'][number] }
  | { type: 'sw:get-changes' }
  /** The focus-layer command: move keyboard focus into WebAble's in-page message, if one is showing. */
  | { type: 'sw:focus-layer' };

export interface WorkerReplies {
  'sw:plan': { changes: AppliedChange[] };
  'sw:undo': { changes: AppliedChange[] };
  'sw:set-level': { changes: AppliedChange[] };
  'sw:pause': { ok: true };
  'sw:resume': { changes: AppliedChange[] };
  'sw:show-on-page': { ok: true };
  'sw:reading-guide': { ok: true };
  'sw:offer': { ok: true };
  'sw:get-changes': { changes: AppliedChange[]; status: EngineStatus };
  'sw:focus-layer': { ok: boolean };
}

export type EngineStatus = 'idle' | 'checking' | 'ready' | 'unreadable';

// ---------------------------------------------------------------------------
// Popup / welcome page <-> service worker
// ---------------------------------------------------------------------------

/** Every popup state from the design spec (design-final.md 10.2). */
export type PopupStatus =
  | 'first_run'
  | 'checking'
  | 'still_checking'
  | 'adapted'
  | 'nothing_to_change'
  | 'all_undone'
  | 'paused'
  | 'off'
  | 'cant_run'
  | 'unreadable'
  | 'needs_site_access';

export interface TabView {
  tabId: number;
  /** Shown to the person locally; never sent anywhere. */
  domain: string | null;
  status: PopupStatus;
  changes: AppliedChange[];
  offer: AdaptationPlan['ops'][number] | null;
  account: {
    signedIn: boolean;
    email: string | null;
    needsReauth: boolean;
    cloudAnalysis: boolean;
    calibrated: boolean;
  };
  allSites: boolean;
  enabled: boolean;
  /** Page analysis contributed to this page's plan. */
  analyzed: boolean;
  lastSentAt: number | null;
}

export type UiToWorker =
  | { type: 'ui:view'; tabId: number }
  | { type: 'ui:undo'; tabId: number; op: OpId | 'all' }
  | { type: 'ui:set-level'; tabId: number; op: OpId; level: number; scope: 'site' | 'everywhere' }
  | { type: 'ui:toggle-op'; tabId: number; op: OpId; on: boolean; scope: 'site' | 'everywhere' }
  | { type: 'ui:pause-site'; tabId: number; paused: boolean }
  | { type: 'ui:enabled'; enabled: boolean }
  | { type: 'ui:offer-answer'; tabId: number; op: OpId; answer: 'accept' | 'dismiss' | 'never_here' }
  | { type: 'ui:rate'; tabId: number; op: OpId; rating: 'helped' | 'not_helped' }
  | { type: 'ui:show-on-page'; tabId: number; op: OpId | null; on: boolean }
  | { type: 'ui:reading-guide'; tabId: number; on: boolean }
  | { type: 'ui:grant-all-sites' }
  | { type: 'ui:receipts' }
  | { type: 'ui:sign-out' };
