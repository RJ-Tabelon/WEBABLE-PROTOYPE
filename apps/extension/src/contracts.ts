// Contract between the in-page engine (src/engine) and the in-page UI (src/ui).
// The engine owns all state; the UI subscribes and calls the actions below.

import type {
  CheckResult, ElementDecision, FitProfile, FitSpec, HealthStatus, LedgerEntry, Offer, OfferKind,
  OpRecord, OverlayAction, PageDigest, PageOutline, PageUnderstanding, PassiveFitState, FitDimension, RedesignResult, Settings, StruggleJudgment,
  StruggleKind, VisualVerdict, RewordKind, ComposeBlock, ComposeGroupIn,
} from '@webable/core';

/** Round 9: one piece of a rewritten paragraph. Links are the page's own anchors, live in the page. */
export type RewordInline = { t: 'text'; text: string } | { t: 'link'; el: Element; text: string; href: string | null };

/** Round 9: a rewritten paragraph as the simplified page renders it (the same words the original page shows). */
export interface RewordView {
  id: string;
  kind: RewordKind;
  /** 'original' after the person clicked the mark (or "Original page"): render the page's own words. */
  showing: 'new' | 'original';
  lead: RewordInline[];
  items: RewordInline[][];
  ordered: boolean;
}

/** Round 9: one paragraph WebAble looked at for this person. */
export interface RewordItem {
  id: string; // 'w<k>'
  /** Jev's probability that this paragraph is harder for this person than it needs to be. */
  need: number;
  how: Record<RewordKind | 'keep', number>;
  pick: RewordKind | null;
  state: 'kept' | 'waiting' | 'rewritten' | 'failed' | 'original';
  /** Why a rewrite was not used ('numbers', 'dropped', 'late', 'layout'…). */
  reason?: string;
  /** The first words of the original, for the Jev view and the log. */
  snippet: string;
}

export interface Toast {
  id: string;
  text: string; // 'Buttons are bigger on this page'
  undoOpId?: string; // toasts with an undo never time out
}

export interface EngineState {
  phase: 'idle' | 'reading' | 'tailored' | 'understood' | 'calm' | 'error';
  /** Content requests and page changes still in progress (may overlap). */
  pendingWork?: number;
  fit: FitProfile | null;
  settings: Settings;
  startedAt: number; // performance.now() at boot
  digest: PageDigest | null;
  outline: PageOutline | null;
  ops: OpRecord[];
  checks: CheckResult[];
  ledger: LedgerEntry[];
  understanding: PageUnderstanding | null;
  decisions: ElementDecision[];
  lens: { on: boolean };
  calm: {
    open: boolean;
    loading: boolean;
    spec: FitSpec | null;
    source: 'heuristic' | 'ai' | 'cached' | null;
    aiReady: boolean; // an AI layout arrived while the person was busy: show the chip
    redesign: RedesignResult | null;
    visual: VisualVerdict | null;
    /** Round 8: the simplified page opened by itself on this page (a busy reading page, or a task form). */
    auto?: boolean;
    /**
     * Round 8: this site is set to "Original page" (the person closed the simplified page after it opened by itself);
     * nothing opens by itself here until the person opens it again. Drives the panel's "Original page" switch:
     * on = closeCalm(), off = openCalm().
     */
    originalPinned?: boolean;
    /** Round 8: text size steps on the simplified page (the panel's text size while it is open; 1 step = 15%). */
    textStep?: number;
  };
  struggle: {
    latest: StruggleJudgment | null;
    history: StruggleJudgment[];
    waiting: StruggleKind[];
    offers: Offer[]; // at most one is shown at a time
  };
  toasts: Toast[];
  showingOriginal: boolean;
  overlays: OverlayAction[];
  ai: HealthStatus['ai'];
  /** The page-width column (round 3): content held to a centred column so enlarged pages don't fill the screen. */
  column: { on: boolean; widthPx: number | null; minPx: number; maxPx: number };
  /** Text size steps the person took on this site (0 = the fit's size). */
  textStep: number;
  /** The tab's current page zoom (1 = 100%). In-page UI divides by it so it stays the same physical size. */
  pageZoom: number;
  /** Round 4: what WebAble has learned about the person's needs (null until loaded). */
  passive: PassiveFitState | null;
  /**
   * The zoom text is shown at. Equal to pageZoom, except with the page column on: the column is a narrower virtual
   * window, the tab's zoom is raised by screen ÷ column and the body is drawn back down by the same factor.
   */
  textZoom?: number;
  /**
   * Round 11: on a narrow screen where the page's width capped the zoom, every text size on the page is also this
   * many times the site's own (the text map); body text is shown at textZoom x textScale. 1 or absent: zoom alone.
   */
  textScale?: number;
  /**
   * Round 9: paragraphs rewritten for this person, from what their AI assistant knows about them.
   * 'off': no AI answer imported, WebAble off, or not a page where it runs. 'none': nothing needed changing.
   */
  reword?: {
    status: 'off' | 'scoring' | 'writing' | 'done' | 'none' | 'error';
    /** The assistant the person's answer came from ('ChatGPT'), for plain lines like "from what ChatGPT knows about you". */
    source: string | null;
    items: RewordItem[];
    /** Every rewritten paragraph is showing the page's own words. */
    showingOriginal: boolean;
    /** Bumps whenever any paragraph changes, so the simplified page re-renders. */
    version: number;
  };
  /** Round 10: the WebAble page's groups as components (keyed by ComposeGroupIn.id). */
  compose?: {
    status: 'idle' | 'working' | 'done';
    groups: Record<string, ComposeGroupState>;
    /** Bumps whenever a group changes, so the WebAble page re-renders. */
    version: number;
  };
}

/** Round 10: one group of the WebAble page. 'waiting' and 'kept'/'failed' render the page's own blocks. */
export interface ComposeGroupState {
  id: string;
  state: 'waiting' | 'ready' | 'kept' | 'failed';
  blocks: ComposeBlock[] | null;
  /** Jev's probability that the layout is easier for this person than the page's own text. */
  better: number | null;
  reason?: string;
  /** performance.now() when it became ready (the view settles it in once). */
  readyAt?: number;
}

export interface EngineApi {
  getState(): EngineState;
  subscribe(listener: (s: EngineState) => void): () => void;

  /** The DOM element behind an outline or digest id ('n<k>'), or null if it is gone. */
  elementFor(id: string): Element | null;

  toggleLens(on?: boolean): void;
  openCalm(): Promise<void>;
  /** Close the simplified page. Closing one that opened by itself sets the site to "Original page"; a peek at one control does not. */
  closeCalm(how?: 'peek'): void;
  useAiLayout(): void; // accept the AI layout chip
  showOriginal(on: boolean): void; // one click back to the untouched page
  undoOp(opId: string): void;
  acceptOffer(kind: OfferKind): void;
  dismissOffer(kind: OfferKind, forever: boolean): void;
  dismissToast(id: string): void;
  openFitting(): void;
  /** Undo one overlay action (restores the overlay; remembers 'leave' for this site and kind). */
  restoreOverlay(id: string): void;
  /** Page width: -1 narrower, 1 wider, 0 back to automatic, 'off' full width. Remembered per site. */
  adjustColumn(step: -1 | 0 | 1 | 'off'): void;
  /** Text size: one zoom preset smaller or larger than the fit, remembered per site. */
  adjustText(step: -1 | 1): void;
  /** Round 4: the person corrects a learned need ('not_right' lowers it, 'forget' clears it, 'confirm' locks it). */
  passiveFeedback(dim: FitDimension, action: 'not_right' | 'forget' | 'confirm'): void;
  /** Round 9: every rewritten paragraph shows the page's own words (true) or the rewritten ones again (false). */
  showOriginalWords(on: boolean): void;
  /** Round 9: one paragraph back to the page's own words, or forward to the rewrite again. */
  toggleParagraph(id: string): void;
  /** Round 9: the rewrite for the paragraph that contains this node, or null (render the page's own words). */
  rewordFor(node: Node): RewordView | null;
  /**
   * Round 10: ask for these groups as components. Array order is priority (first screen first). Groups already
   * asked for (same id) are not asked again; results arrive in state.compose.groups.
   */
  compose(groups: ComposeGroupIn[]): void;
}
