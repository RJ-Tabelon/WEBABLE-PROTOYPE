import type {
  AdaptEvent,
  AdaptationPlan,
  AppliedChange,
  FitLayout,
  OpId,
  PageContext,
  PageSignals,
  RegionEvidence,
  Skeleton,
  SpecEnvelope,
  TriageKind,
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
  /** WebAble's own UI should not animate (settings.reduceMotion, or the fit's motion need). */
  reduceMotion: boolean;
  /** The keyboard shortcuts as Chrome reports them (chrome.commands.getAll), '' when unset. */
  shortcuts: { focusLayer: string; undoAll: string; fitView?: string };
  /** Fit view is on in this tab (tab mode, docs/10 §4.5): re-present this page once it settles. */
  fitViewTab?: boolean;
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
  /**
   * `restored`: this document already has a running engine (a bfcache restore,
   * or a second injection found the per-document guard). cs:applied with the
   * current plan and changes follows.
   */
  | { type: 'cs:hello'; restored?: true }
  | { type: 'cs:signals'; signals: PageSignals; evidence: PageEvidence }
  | {
      type: 'cs:applied';
      planId: string;
      changes: AppliedChange[];
      /**
       * After a page-scale change: what the zoom guard checks (docs/10 §5.1).
       * Horizontal overflow, and whether primary navigation or the search
       * field disappeared compared with the layout features at 100%.
       */
      viewport?: {
        zoom: number;
        overflowPx: number;
        navLinks: number;
        searchVisible: boolean;
        /** Titles newly cut off by an ellipsis or a clamp since the reading at 100%. */
        newlyEllipsised?: number;
        /** Titles compared for that count. */
        titlesShown?: number;
      };
    }
  | { type: 'cs:interaction'; tabSession: string }
  | {
      type: 'cs:event';
      event: Omit<
        AdaptEvent,
        'v' | 'id' | 't' | 'domain' | 'tabSession' | 'opVer'
      >;
    }
  | {
      type: 'cs:friction';
      signal: 'misclick_burst' | 'rage_click' | 'zoom_in' | 'scroll_reversal';
      /** Ops the signal is evidence for. */
      ops: OpId[];
    }
  | {
      type: 'cs:offer-answer';
      op: OpId;
      answer: 'accept' | 'dismiss' | 'never_here' | 'timeout';
    }
  /**
   * The toast's Undo all. The engine has already undone every change in the
   * page; it sends no per-change undo events for this action. The worker
   * records them, resets zoom and marks the changes undone (no sw:undo echo).
   */
  | { type: 'cs:undo-all'; source: 'toast' }
  /**
   * Open (or re-open after a route change) Fit view with this page's
   * skeleton. The worker builds or recalls the spec, validates it, solves the
   * layout from the fit, injects the Fit view script if needed, and replies.
   */
  | {
      type: 'cs:fitview-request';
      skeleton: Skeleton;
      reason: FitViewOpenReason;
    }
  /** Fit view lifecycle and defects, for learning and the popup. */
  | { type: 'cs:fitview-event'; event: FitViewEvent };

/** Why Fit view is opening. */
export type FitViewOpenReason =
  | 'offer' // the person accepted the in-page offer or toast action
  | 'popup' // the popup switch
  | 'shortcut' // the toggle-fit-view command
  | 'auto' // "Always here" or Your fit's busy-pages choice
  | 'tab_mode' // a new page in a tab where Fit view is on
  | 'route' // an SPA route change while open
  | 'switch'; // the person accepted "A better layout is ready"

export type FitViewEvent =
  | {
      kind: 'opened';
      source: 'heuristic' | 'planner';
      reason: FitViewOpenReason;
      ms: number;
    }
  | {
      kind: 'closed';
      reason: 'original' | 'not_representable' | 'route' | 'error' | 'paused';
      afterMs: number;
      /** Proxied actions taken while open (a navigation counts as a keep). */
      actions: number;
    }
  | { kind: 'peek'; on: boolean }
  | {
      kind: 'proxy_failed';
      role: 'link' | 'button' | 'input' | 'toggle' | 'select';
      why: 'not_found' | 'fingerprint' | 'no_effect' | 'blocked';
    }
  | { kind: 'conservation_failed'; missing: number }
  /** The in-page Fit view offer (toast action or chip) was answered. */
  | {
      kind: 'offer';
      surface: 'toast' | 'chip';
      answer: 'accept' | 'dismiss' | 'timeout';
    }
  | { kind: 'text_nudge'; step: 1 | -1 }
  /** "Always here" switched in Fit view's top strip (same as the popup's, scope 'site'). */
  | { kind: 'always'; on: boolean };

export interface ContentReplies {
  'cs:hello': HelloReply;
  /** `announce`: show the first-visit toast for this site (the service worker remembers where it has). */
  /**
   * `fitViewOffer`: offer Fit view on this page (the worker decided it is
   * warranted and within the offer budget; absent = do not offer).
   * `fitViewAuto`: restructure this page on arrival (docs/11 §2): hold
   * Tailor, and open Fit view with reason 'auto' once the page settles.
   */
  'cs:signals': {
    /**
     * As every plan the worker sends (sw:plan too): triage blanked
     * (toContent), and `ownZoom`, the person's own zoom, set so the engine
     * sizes for the tab's whole zoom (ownZoom x zoom).
     */
    plan: AdaptationPlan;
    announce?: boolean;
    fitViewOffer?: boolean;
    fitViewAuto?: boolean;
  };
  'cs:applied': { ok: true };
  'cs:interaction': { ok: true };
  'cs:event': { ok: true };
  'cs:friction': { offer: AdaptationPlan['ops'][number] | null };
  'cs:offer-answer': { plan: AdaptationPlan | null };
  'cs:undo-all': { ok: true };
  'cs:fitview-request': FitViewOpenReply;
  'cs:fitview-event': { ok: true };
}

/**
 * Everything Fit view needs to render. The fit itself never reaches the
 * content script: only the solved layout numbers do.
 */
export type FitViewOpenReply =
  | {
      ok: true;
      envelope: SpecEnvelope;
      layout: FitLayout;
      /** Zoom the page is at while Fit view is open (the person's own); the renderer divides by it. */
      zoom: number;
      /** Shown in Fit view's top strip, computed by the worker (punycode raw). */
      site: { label: string; secure: boolean };
      /** A planner spec is on its way; offer "A better layout is ready" when it lands. */
      plannerPending: boolean;
      /**
       * Fit view opens by itself on this site ("Always here"); the top strip
       * shows the switch in this state. Absent when the site cannot have it.
       */
      alwaysHere?: boolean;
      /**
       * The first time WebAble restructures a page on its own (docs/11 §2):
       * the top strip shows one line saying what happened and that
       * "Original page" brings the site back.
       */
      intro?: boolean;
      /**
       * Atkinson Hyperlegible Next (woff2, base64; runtime messages are JSON),
       * sent only when this document has not registered the face yet.
       */
      font?: string;
    }
  | { ok: false; why: FitViewUnavailable };

export type FitViewUnavailable =
  'not_representable' | 'blocked_overlay' | 'excluded' | 'stale' | 'error';

/** Live state of Fit view in a tab, for the popup. */
export interface FitViewTabState {
  /** This page can be re-presented (triage). */
  available: boolean;
  open: boolean;
  /** Tab mode: Fit view follows navigation in this tab until "Original page". */
  tabMode: boolean;
  /** How Fit view reaches this site: offered, opened automatically ("Always here"), or off. */
  mode: 'off' | 'offer' | 'auto';
  source: 'heuristic' | 'planner' | null;
  planner: 'unavailable' | 'idle' | 'pending' | 'ready' | 'failed';
  /**
   * The only thing keeping the planner off this page is the person's consent
   * ("Better Fit view layouts"); the popup links to it only then.
   */
  needsConsent?: boolean;
  verdict: TriageKind | null;
  /** Why it is unavailable, as a reason code the popup renders. */
  why: FitViewUnavailable | null;
}

// ---------------------------------------------------------------------------
// Service worker -> content script (chrome.tabs.sendMessage)
// ---------------------------------------------------------------------------

export type WorkerToContent =
  /** Late page-analysis refinement or a changed decision (e.g. accepted offer). */
  | {
      type: 'sw:plan';
      plan: AdaptationPlan;
      reason: 'refine' | 'offer_accepted' | 'settings';
      /** Refinements are valid only for the plan they were computed from. */
      basePlanId?: string;
    }
  | {
      type: 'sw:undo';
      op: OpId | 'all';
      /** AI protection updates must belong to this document's current plan. */
      basePlanId?: string;
      reason?:
        'dont_want' | 'too_much' | 'too_little' | 'broke_page' | 'needed_that';
    }
  | { type: 'sw:set-level'; op: OpId; level: number }
  | { type: 'sw:pause' }
  | { type: 'sw:resume' }
  | { type: 'sw:show-on-page'; op: OpId | null; on: boolean }
  | { type: 'sw:reading-guide'; on: boolean }
  | { type: 'sw:offer'; offer: AdaptationPlan['ops'][number] }
  | { type: 'sw:get-changes' }
  /** The focus-layer command: move keyboard focus into WebAble's in-page message, if one is showing. */
  | { type: 'sw:focus-layer' }
  /**
   * An offer for this op was answered in the popup, or expired. The engine
   * hides its chip if it shows this op, and sends nothing back.
   */
  | { type: 'sw:offer-resolved'; op: OpId }
  /**
   * Open or close Fit view (popup, shortcut, auto). For 'open' the content
   * script extracts a skeleton and answers with cs:fitview-request.
   */
  | {
      type: 'sw:fitview';
      action: 'open' | 'close';
      reason: FitViewOpenReason | 'original';
    }
  /** A planner spec for the open template is ready (offer "A better layout is ready"). */
  | { type: 'sw:fitview-spec'; envelope: SpecEnvelope }
  /**
   * The tab's zoom changed (page scale applied, stepped down, suspended for
   * Fit view, or the person zoomed). `zoom` is the tab's absolute zoom factor
   * (what Fit view divides by); `scale` is WebAble's page scale relative to
   * the person's own zoom (as AdaptationPlan.zoom), when WebAble set it.
   */
  | {
      type: 'sw:zoom';
      zoom: number;
      owner: 'webable' | 'person';
      scale?: number;
    };

export interface WorkerReplies {
  'sw:plan': { changes: AppliedChange[] };
  'sw:undo': { changes: AppliedChange[] };
  'sw:set-level': { changes: AppliedChange[] };
  'sw:pause': { ok: true };
  /**
   * `restarting`: nothing was planned on this page yet (it loaded while
   * WebAble was off or the site was paused). The engine is planning now and
   * reports with cs:signals and cs:applied like a fresh load.
   */
  'sw:resume': { changes: AppliedChange[]; restarting?: true };
  'sw:show-on-page': { ok: true };
  'sw:reading-guide': { ok: true };
  'sw:offer': { ok: true };
  'sw:get-changes': { changes: AppliedChange[]; status: EngineStatus };
  'sw:focus-layer': { ok: boolean };
  'sw:offer-resolved': { ok: true };
  'sw:fitview': { ok: boolean };
  'sw:fitview-spec': { ok: true };
  'sw:zoom': { ok: true };
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
    /** Consent to layout planning with OpenAI (accounts.ai_layout). */
    aiLayout?: boolean;
    calibrated: boolean;
  };
  allSites: boolean;
  enabled: boolean;
  /** Page analysis contributed to this page's plan. */
  analyzed: boolean;
  lastSentAt: number | null;
  /** Fit view for this tab (absent while the page is still being read). */
  fitView?: FitViewTabState;
}

/** The popup's quick switches: text (text_floor), targets (target_size), calm (calm_motion). */
export type QuickKey = 'text' | 'targets' | 'calm';

export type UiToWorker =
  | { type: 'ui:view'; tabId: number }
  | { type: 'ui:undo'; tabId: number; op: OpId | 'all' }
  | {
      type: 'ui:set-level';
      tabId: number;
      op: OpId;
      level: number;
      scope: 'site' | 'everywhere';
    }
  | {
      type: 'ui:toggle-op';
      tabId: number;
      op: OpId;
      on: boolean;
      scope: 'site' | 'everywhere';
    }
  | { type: 'ui:pause-site'; tabId: number; paused: boolean }
  | { type: 'ui:enabled'; enabled: boolean }
  | {
      type: 'ui:offer-answer';
      tabId: number;
      op: OpId;
      answer: 'accept' | 'dismiss' | 'never_here';
    }
  | {
      type: 'ui:rate';
      tabId: number;
      op: OpId;
      rating: 'helped' | 'not_helped';
    }
  | { type: 'ui:show-on-page'; tabId: number; op: OpId | null; on: boolean }
  | { type: 'ui:reading-guide'; tabId: number; on: boolean }
  | { type: 'ui:grant-all-sites' }
  /** Re-apply what the person undid on this page ('all' after Undo all). */
  | { type: 'ui:redo'; tabId: number; op: OpId | 'all' }
  /** Clear the "Use these on every site" levels and replan open tabs. */
  | { type: 'ui:clear-everywhere' }
  /** Sent after the popup's own chrome.permissions.request for one origin succeeds. */
  | { type: 'ui:grant-site'; tabId: number; origin: string }
  | { type: 'ui:receipts' }
  | { type: 'ui:sign-out' }
  /**
   * Fit view switch. scope 'page': open or close in this tab (tab mode).
   * scope 'site': "Always here" on or off for this site.
   */
  | { type: 'ui:fit-view'; tabId: number; on: boolean; scope: 'page' | 'site' }
  /** Accept "A better layout is ready" from the popup. */
  | { type: 'ui:fit-view-switch'; tabId: number };
