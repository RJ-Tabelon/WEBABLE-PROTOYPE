// Owner: C1, round 3: T, round 4: P (the passive fit). The in-page engine: implements EngineApi and owns EngineState.
//
// Boot order (SPEC "Architecture", round 3; round 6 for size): wait for load (1.5 s cap) and 400 ms DOM quiet ->
// settings + fit from the background -> if disabled, paused for this origin or no fit: idle (the pill still mounts) ->
// reader -> text zoom and page column planned once and applied in one step (one tab zoom change), checked once; a
// failed check falls back once (column off, then the next lower zoom preset) and stops; the site's settled size is
// kept for the session -> fit ops (verified) -> heading ramp (verified, single headings dropped) -> Jev understand ->
// decisions -> ops from decisions (verified) -> the simplified page (Calm view) by itself, once, on reading pages
// (round 8 needed them busy, round 10 opens it on every one; ./busy: before the person starts using the page, never on
// sign-in, checkout, account or statement pages, not on a site set to "Original page") and on task pages (a form with
// a clear main action) at structure level 2, else offered. Late overlays (cookie banners, chat panels) get an
// incremental Jev read.
// SPA navigations re-run the element ops; zoom, column and behaviour ops stay. Nothing re-sizes a page on its own: late
// Jev reads, learning, overlays and DOM changes never touch zoom or column; the person's A−/A+, width controls and
// accepted offers do, in one step.
// Round 9 (./reword): once the page is fitted, alongside Jev's read, paragraphs are rewritten the way the person likes
// things explained (from their AI assistant's answer), swapped in place with a thin mark; one ledger entry and one
// toast per page, Undo shows the page's own words, "Original page" shows the untouched page.
// Round 10 (./compose): the WebAble page asks for its groups as components (api.compose); one ledger entry per page
// once every group has an answer, no toast.

import {
  DEFAULT_SETTINGS, candidateSource, chooseOfferForFit, columnLimits, decideElements, heuristicSpec, nearestPreset, personZoomLadder,
  planColumn, repairSpec, stepColumn, stepZoom, summarizeDecisions, summarizeFitForModel,
  effectiveFit, effectiveFitSources, fitSignature, passiveOffer, PASSIVE_OFFER_KIND,
  applyMeaning, DRAWER_FINE, FINE_MIN_P, leadWords, localMeaningVerdict, meaningPasses, meaningRequest, purposeWords,
} from '@webable/core';
import type {
  BgRequest, CheckName, CheckResult, ElementDecision, ElementEvidence, ElementJudgment, FitProfile, FitSpec, FitSummaryForModel, HealthStatus,
  JevMetrics, LedgerEntry, Offer, OfferKind, OpKind, OutlineNode, OverlayAction, PageDigest, PageOutline, PageUnderstanding,
  RedesignResult, Role, Settings, StruggleJudgment, StruggleKind, TabReport, VisualVerdict, ZoomPlan,
  DimensionBelief, FitDimension, PassiveFitState,
  FineRole, MeaningVerdict, PageMeaning,
} from '@webable/core';
import type { EngineApi, EngineState, Toast } from '../contracts';
import { isOurUi } from '../ui/mount';
import { ask as askBackground, askExt, errText, plainError, tell, type HealthInfo, type ZoomInfo } from './bus';
import { createActivity } from './activity';
import { OverlayManager, type OverlayView } from './overlays';
import { createStore, throttle } from './store';
import { routeKey, settle, sleep, waitForLoad, waitForQuiet, waitForVisible, watchNavigation } from './nav';
import { PageReader, collapse, type NodeInfo, type ReadResult } from './reader';
import { Tailor, resetBackgroundCache, type ColumnOp, type Op } from './tailor';
import { TEXT_SCALE_MAX, TEXT_SCALE_MIN, TextMap, WIDTH_TRIALS, fallbackTextScale, planTextScale, scaleWords, textCover, textMapOp, textScaleGate, widthLimitedZoom } from './textmap';
import { Verifier, calmCoverage, completeSpec, plainCheck, type Snapshot } from './verify-dom';
import { noteOfferOutcome, startSignals, type SignalsHost } from './signals';
import { isExcludedHost } from './hosts';
import { PassiveObserver, readMediaFacts, watchMedia } from './passive';
import { pageMeaning } from '../ui/calm/meaning';
import { distractionShare, isDistraction, openVerdict, type OpenVerdict } from './busy';
import { MAX_PICKS, createReword, type RewordSummary } from './reword';
import { createCompose, type ComposeSummary } from './compose';

export interface Controller {
  api: EngineApi;
  start(): Promise<void>;
  stop(): void;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function safeOurs(t: EventTarget | null): boolean {
  if (t instanceof Element && t.tagName === 'WEBABLE-UI') return true;
  try {
    return isOurUi(t);
  } catch {
    return false;
  }
}

function quote(name: string, words = 6): string {
  const w = collapse(name).split(' ').filter(Boolean);
  if (!w.length) return '';
  const s = w.length > words ? `${w.slice(0, words).join(' ')}…` : w.join(' ');
  return `“${s}”`;
}

function p2(p: number): string {
  return (Math.round(p * 100) / 100).toFixed(2);
}

function r2(p: number): number {
  return Math.round(p * 100) / 100;
}

function pct(z: number): string {
  return `${Math.round(z * 100)}%`;
}

/* ------------------------------------------------------------------ */
/* Per-site memory (round 3): text steps and page width               */
/* ------------------------------------------------------------------ */

interface SitePrefs {
  /** A−/A+ steps from the fit's zoom. */
  textStep?: number;
  /** The person's page width: 'off' (full width) or a column width in screen px. */
  column?: 'off' | number;
  /** When the automatic column last did not fit this site (ms); it stays off until COLUMN_RETRY_MS has passed. */
  columnFailed?: number;
  /** Round 8: the person closed the simplified page that opened by itself here: keep this site's own layout. */
  original?: boolean;
}

const SITE_PREFS_KEY = 'sitePrefs';
/**
 * A site whose page did not fit the automatic column stays at full width for two weeks (round 6: no retry on every
 * visit; Narrower or Automatic in the WebAble panel tries it again at once).
 */
const COLUMN_RETRY_MS = 14 * 24 * 3600 * 1000;

/**
 * Page zoom is the browser's own zoom: what the site does at the narrower viewport (line-clamped headlines, links
 * folded into its menu, sections it hides, its own type sizes for that width) is the site's designed layout at that
 * size, the same as Ctrl +. Zoom rolls back only for what breaks a page: sideways scrolling and text drawn over text.
 */
const ZOOM_IGNORES: CheckName[] = ['clipping', 'reachability', 'content_loss', 'hierarchy'];
/**
 * The page column is a narrower window: the site's own narrower layout folding a menu, hiding a link or setting
 * smaller headings is its design (heading_scale runs after). Text cut off, text over text and sideways scrolling
 * still roll it back.
 */
const COLUMN_IGNORES: CheckName[] = ['reachability', 'content_loss', 'hierarchy'];

function siteKey(): string {
  return (location.hostname || location.origin).replace(/^www\./, '');
}

async function loadSitePrefs(): Promise<SitePrefs> {
  try {
    const got = await chrome.storage.local.get(SITE_PREFS_KEY);
    const all = (got[SITE_PREFS_KEY] ?? {}) as Record<string, SitePrefs>;
    return { ...(all[siteKey()] ?? {}) };
  } catch {
    return {};
  }
}

async function saveSitePrefs(patch: Partial<Record<keyof SitePrefs, SitePrefs[keyof SitePrefs] | undefined>>): Promise<void> {
  try {
    const got = await chrome.storage.local.get(SITE_PREFS_KEY);
    const all = { ...((got[SITE_PREFS_KEY] ?? {}) as Record<string, SitePrefs>) };
    const next: Record<string, unknown> = { ...(all[siteKey()] ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === 0) delete next[k];
      else next[k] = v;
    }
    if (Object.keys(next).length) all[siteKey()] = next as SitePrefs;
    else delete all[siteKey()];
    const keys = Object.keys(all);
    if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete all[k];
    await chrome.storage.local.set({ [SITE_PREFS_KEY]: all });
  } catch {
    /* storage unavailable: the choice holds for this page only */
  }
}

/* ------------------------------------------------------------------ */
/* The size a site settled at, for this browser session (round 6)      */
/* ------------------------------------------------------------------ */

/**
 * The text zoom and page column a site settled at after its one check (and fallback), kept for the browser session: a
 * reload, a revisit or another page of the site applies it in one step with no trials (every zoom change shows
 * Chrome's zoom bubble).
 */
interface SettledSize {
  /** What it was planned for: the fit's text size, the person's A−/A+ steps and width choice on this site. */
  sig: string;
  /** The text zoom (the tab's zoom without the column's share). */
  zoom: number;
  /** Column width in screen px, or null for full width. */
  column: number | null;
  mode: 'auto' | 'person';
  /** Round 11: the text map's factor on a narrow screen whose width capped the zoom (absent: none). */
  textScale?: number;
}

function settledKey(): string {
  return `settled:${siteKey()}`;
}

async function loadSettled(): Promise<SettledSize | null> {
  try {
    const k = settledKey();
    const got = await chrome.storage.session.get(k);
    const v = got[k] as SettledSize | undefined;
    return v && typeof v.sig === 'string' && Number.isFinite(v.zoom) && v.zoom > 0 ? v : null;
  } catch {
    return null;
  }
}

function saveSettled(v: SettledSize): void {
  try {
    void chrome.storage.session.set({ [settledKey()]: v }).catch(() => undefined);
  } catch {
    /* session storage unavailable: this page view keeps its size, the next one plans again */
  }
}

/* ------------------------------------------------------------------ */
/* Pages Calm view never opens on by itself (round 6)                  */
/* ------------------------------------------------------------------ */

const SEARCH_HOSTS = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yahoo\.com|ecosia\.org|startpage\.com|search\.brave\.com|baidu\.com|yandex\.[a-z.]+|ask\.com|aol\.com)$/i;
const APP_HOSTS = /(^|\.)(docs\.google\.com|drive\.google\.com|calendar\.google\.com|meet\.google\.com|chat\.google\.com|notion\.so|figma\.com|canva\.com|trello\.com|airtable\.com|miro\.com|linear\.app|asana\.com|teams\.microsoft\.com|office\.com|onedrive\.live\.com|chatgpt\.com|claude\.ai|youtube\.com|maps\.google\.com)$/i;

/** A search results page: a search engine, a search URL, or a search box at the top over a list of results. */
function isSearchResults(pageKind: string): boolean {
  const host = location.hostname;
  const searchUrl = /\/search\b|\/results\b|\/s$/.test(location.pathname) || /[?&](q|query|search|search_query|k|p|text|wd)=/.test(location.search);
  if (SEARCH_HOSTS.test(host) && (searchUrl || location.pathname === '/' || location.pathname === '')) return true;
  if (pageKind === 'search results page') return true;
  if (!searchUrl) return false;
  // A box to search in near the top, and results under it (headed links).
  const vh = document.documentElement.clientHeight || innerHeight;
  const box = Array.from(document.querySelectorAll('input[type="search"], [role="search"] input, input[name="q"], input[name="query"], input[name="search"]'))
    .find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top < vh * 0.4;
    });
  if (!box) return false;
  return document.querySelectorAll('a[href] h3, h3 a[href], h2 a[href], a[href] h2').length >= 5;
}

/** A web app or mail: the page is a tool to work in, not a page to read (Calm view would replace the tool). */
function isWebApp(privatePage: boolean): boolean {
  if (privatePage || APP_HOSTS.test(location.hostname)) return true;
  // Embedded video players (JW Player, video.js) mark themselves role="application" too; only an application box
  // that holds most of the page's text is the page itself.
  const apps = Array.from(document.querySelectorAll('[role="application"]')).slice(0, 20);
  if (apps.length) {
    const all = (document.body?.innerText ?? '').length;
    if (apps.some((el) => all > 0 && ((el as HTMLElement).innerText ?? '').length >= 0.5 * all)) return true;
  }
  const vw = document.documentElement.clientWidth || innerWidth;
  const vh = document.documentElement.clientHeight || innerHeight;
  for (const el of Array.from(document.querySelectorAll('[contenteditable="true"], [contenteditable=""], canvas')).slice(0, 20)) {
    const r = el.getBoundingClientRect();
    if (r.width * r.height >= 0.25 * vw * vh) return true;
  }
  return false;
}

/** Round 8: what the person reads when the page could not be read (the server or Jev did not answer). */
const UNREAD_LINE = "Couldn't read this page right now. Text size and buttons still work.";

/** What counts as the person starting to use the page (round 8): then the page is never swapped on its own. */
const INTERACT_EVENTS = ['pointerdown', 'keydown', 'scroll'] as const;

/** Text size steps on the simplified page: one step is 15% (0.85× to 1.6×). */
const CALM_STEP_MIN = -1;
const CALM_STEP_MAX = 4;

const OP_NOUN: Record<OpKind, string> = {
  page_zoom: 'page zoom',
  text_map: 'the larger text',
  spacing: 'line spacing',
  contrast: 'the darker text',
  weight: 'the heavier text',
  measure: 'the shorter lines',
  targets: 'the larger click areas',
  steady_clicks: 'steady clicks',
  debounce: 'double-click protection',
  motion: 'stopped motion',
  dim: 'the fading',
  promote_main: 'the main-button outline',
  unpin_sticky: 'the unpinned top bar',
  focus_ring: 'the focus ring',
  calm_view: 'the calm layout',
  unobstruct: 'the moved overlay',
  column: 'the narrower page',
  heading_scale: 'the larger headings',
};

const OFFER_TOAST: Record<OfferKind, string> = {
  bigger_targets: 'Buttons are easier to hit on this page',
  steady_clicks: 'Steady clicks are on for this page',
  debounce: 'Accidental double clicks are ignored on this page',
  larger_text: 'Text is larger on this page',
  calm_view: 'Calm view is open',
  main_actions: 'The main button is easier to find',
};

const FOLD_ROLES: Role[] = ['advertising', 'recommendations', 'popup_overlay'];
const PROTECT_ROLE_LIST: Role[] = ['main_content', 'form_field', 'action_button', 'navigation', 'help_contact', 'consent_notice', 'account_utility'];

function addMetrics(a: JevMetrics, b: JevMetrics): JevMetrics {
  return {
    model: b.model || a.model,
    calls: a.calls + b.calls,
    questions: a.questions + b.questions,
    inputTokens: a.inputTokens + b.inputTokens,
    wallMs: a.wallMs + b.wallMs,
    serverMs: a.serverMs === null && b.serverMs === null ? null : (a.serverMs ?? 0) + (b.serverMs ?? 0),
    costUsd: a.costUsd + b.costUsd,
  };
}

function isUnderstanding(x: unknown): x is PageUnderstanding {
  return !!x && typeof x === 'object' && Array.isArray((x as PageUnderstanding).elements) && !!(x as PageUnderstanding).metrics;
}

function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function outlineSignature(o: PageOutline): string {
  return hashString(o.nodes.map((n) => `${n.kind}:${n.label}:${n.parent ?? ''}`).join('|'));
}

/** Minimal spec when the core heuristic is unavailable: everything open, in page order. */
function fallbackSpec(outline: PageOutline): FitSpec {
  const tops = outline.nodes.filter((n) => !n.parent).map((n) => n.id);
  const sections: FitSpec['sections'] = [];
  for (let i = 0; i < tops.length; i += 40) {
    sections.push({
      heading_ref: null, label: i === 0 ? 'Overview' : 'More on this page', role: i === 0 ? 'primary' : 'other',
      nodes: tops.slice(i, i + 40), layout: 'as_is', emphasis: i === 0 ? 'lead' : 'normal', state: 'open',
      why: i === 0 ? 'main_task' : 'reference_info', show_first: 0,
    });
  }
  if (!sections.length) {
    sections.push({ heading_ref: null, label: 'Overview', role: 'primary', nodes: [], layout: 'as_is', emphasis: 'lead', state: 'open', why: 'main_task', show_first: 0 });
  }
  return { page_type: 'other', task: 'other', strip: [], sections, primary_action: null, form_steps: [], density: 'comfortable' };
}

function fallbackSummary(fit: FitProfile): FitSummaryForModel {
  const body = fit.text.override ?? fit.text.bodyPx;
  const t = fit.targets.minPx ?? 24;
  return {
    text_need: body >= 22 ? 'large' : body >= 18 ? 'some' : 'none',
    target_need: t >= 56 ? 'large' : t >= 40 ? 'some' : 'none',
    clutter_tolerance: fit.attention.clutter.p >= 0.6 ? 'low' : fit.attention.clutter.p >= 0.3 ? 'medium' : 'high',
    structure_level: fit.attention.structureLevel,
    motion: fit.attention.motion.on ? 'reduce' : 'fine',
    polarity: fit.polarity.value,
  };
}

/** The meaning check's answer for one page (round 7). */
interface MeaningGate {
  key: string;
  pass: boolean;
  by: 'jev' | 'device';
  leadsWithMain: number;
  missingMain: number;
}

function initialState(): EngineState {
  return {
    phase: 'idle',
    fit: null,
    settings: { ...DEFAULT_SETTINGS },
    startedAt: performance.now(),
    digest: null,
    outline: null,
    ops: [],
    checks: [],
    ledger: [],
    understanding: null,
    decisions: [],
    lens: { on: false },
    calm: { open: false, loading: false, spec: null, source: null, aiReady: false, redesign: null, visual: null },
    struggle: { latest: null, history: [], waiting: [], offers: [] },
    toasts: [],
    showingOriginal: false,
    overlays: [],
    ai: 'on',
    column: { on: false, widthPx: null, minPx: 720, maxPx: 1600 },
    textStep: 0,
    pageZoom: 1,
    passive: null,
    textZoom: 1,
    textScale: 1,
    reword: { status: 'off', source: null, items: [], showingOriginal: false, version: 0 },
    compose: { status: 'idle', groups: {}, version: 0 },
  };
}

/* ------------------------------------------------------------------ */
/* The passive fit (round 4): offers and announcements                 */
/* ------------------------------------------------------------------ */

/** Per need: when its offer or question was last shown, and until when the person said not now. */
type PassiveOfferMemory = Partial<Record<FitDimension, { shownAt?: number; askedAt?: number; snoozedUntil?: number }>>;
/** An offer on screen that came from what WebAble learned (its question tells it apart from a live-struggle offer). */
interface PassiveOfferMeta { dim: FitDimension; action: 'offer' | 'ask'; question: string }
const PASSIVE_OFFERS_KEY = 'passiveOffers';
/** Learned needs already announced with a toast ("Text is larger because you zoomed in on 4 sites this week."). */
const PASSIVE_SEEN_KEY = 'passiveSeen';
/** An unanswered offer comes back on a later page, but not sooner than this. */
const PASSIVE_OFFER_GAP_MS = 10 * 60 * 1000;
const PASSIVE_NOT_NOW_MS = 24 * 3600 * 1000;
const PASSIVE_ASK_EVERY_MS = 7 * 24 * 3600 * 1000;
const PASSIVE_NEVER_MS = 30 * 24 * 3600 * 1000;
/** Click areas for "bigger buttons on every site" (signals.md: 44 px). */
const PASSIVE_TARGETS_PX = 44;

/** The op that carries each learned need on a page. */
const PASSIVE_OP: Partial<Record<FitDimension, OpKind>> = { text_size: 'page_zoom', targets: 'targets', steady_clicks: 'steady_clicks' };
const PASSIVE_NOUN: Partial<Record<FitDimension, string>> = { text_size: 'larger text', targets: 'bigger click areas', steady_clicks: 'steady clicks' };
const PASSIVE_DONE: Partial<Record<FitDimension, string>> = {
  text_size: 'Text is larger on every site',
  targets: 'Buttons are easier to hit on every site',
  steady_clicks: 'Steady clicks are on for every site',
};

async function loadLocal<T>(key: string, fallback: T): Promise<T> {
  try {
    const got = await chrome.storage.local.get(key);
    const v = got[key];
    return v && typeof v === 'object' ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

async function saveLocal(key: string, value: unknown): Promise<void> {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch {
    /* storage unavailable: the memory holds for this page only */
  }
}

/* ------------------------------------------------------------------ */
/* Controller                                                          */
/* ------------------------------------------------------------------ */

export function createController(): Controller {
  const store = createStore<EngineState>(initialState());
  const activity = createActivity((pendingWork) => store.set({ pendingWork }));
  const ask = <T,>(req: BgRequest, timeoutMs?: number): Promise<T> => {
    const send = () => askBackground<T>(req, timeoutMs);
    return activity.isContentRequest(req) ? activity.run(send) : send();
  };
  const reader = new PageReader();
  const verifyIds = new WeakMap<Element, string>();
  /** The other way round, so a check's element ids can be looked up (elementFor), held weakly. */
  const verifyEls = new Map<string, WeakRef<Element>>();
  let verifyNext = 1;
  const idOf = (el: Element): string => {
    const rid = reader.idFor(el);
    if (rid) return rid;
    let v = verifyIds.get(el);
    if (!v) {
      v = `v${verifyNext++}`;
      verifyIds.set(el, v);
      if (verifyEls.size > 20000) verifyEls.clear();
      verifyEls.set(v, new WeakRef(el));
    }
    return v;
  };
  /**
   * The page column is a narrower virtual window (Tailor.columnOp): the tab's zoom is the text zoom × colMul and the
   * body is drawn at 1/colMul with CSS zoom. Everything that plans text size works in text zoom (zoomInfo's factor);
   * state.pageZoom is the tab's real zoom (our UI divides by it) and state.textZoom the zoom text is shown at.
   */
  let colMul = 1;
  /** The tab zoom WebAble last set, to tell the person's own Ctrl +/− apart while the column is on. */
  let lastTabZoom: number | null = null;
  const setZoomState = (tab: number) => {
    if (!(Number.isFinite(tab) && tab > 0)) return;
    const text = Math.round((tab / colMul) * 10000) / 10000;
    const cur = store.get();
    if (Math.abs(cur.pageZoom - tab) > 0.001 || Math.abs((cur.textZoom ?? cur.pageZoom) - text) > 0.001) store.set({ pageZoom: tab, textZoom: text });
  };
  /** The factor Chrome reports after a setZoom (the background rounds to whole percents), else what was asked. */
  const realTab = (got: unknown, asked: number): number => (typeof got === 'number' && Number.isFinite(got) && got > 0 ? got : asked);
  /** Set the tab's zoom for a text zoom (× the column's multiplier). state.pageZoom is Chrome's own factor after it. */
  const setTextZoom = async (text: number): Promise<void> => {
    const tab = Math.round(text * colMul * 10000) / 10000;
    lastTabZoom = tab;
    const got = await ask<number>({ type: 'setZoom', factor: tab });
    lastTabZoom = realTab(got, tab);
    setZoomState(lastTabZoom);
    passiveObs.syncZoom(lastTabZoom);
  };
  const tailor = new Tailor({
    ask: <T,>(req: BgRequest) => {
      if (req.type === 'setZoom') {
        const tab = Math.round(req.factor * colMul * 10000) / 10000;
        lastTabZoom = tab;
        return ask<T>({ ...req, factor: tab }).then((got) => {
          lastTabZoom = realTab(got, tab);
          return got;
        });
      }
      return ask<T>(req);
    },
    zoomInfo: () => zoomInfo(),
    screenWidth: () => screenWidth(),
    columnScale: (k) => columnScale(k),
    isOurUi: safeOurs,
    idOf,
    onBehaviour: (kind) => {
      behaviourCounts[kind]++;
    },
    // Right after the zoom op's setZoom: lastTabZoom holds the factor Chrome reported for it.
    onZoom: (factor) => {
      const tab = lastTabZoom ?? factor * colMul;
      setZoomState(tab);
      passiveObs.syncZoom(tab);
    },
  });
  const verifier = new Verifier({ idOf, isOurUi: safeOurs });
  /** Round 11: every text size × one factor, on narrow screens where the page's width capped the zoom. */
  const textMap = new TextMap({ isOurUi: (el) => safeOurs(el), sheets: tailor.sheets });

  // Engine-internal state (not part of EngineState).
  let generation = 0;
  let read: ReadResult | null = null;
  let plan: ZoomPlan | null = null;
  let opsList: Op[] = [];
  /** This site's remembered text steps and page width. */
  let sitePrefs: SitePrefs = {};
  /** The window's width (screen px) the page column was planned for: a window resize re-plans it, a zoom change does not. */
  let columnWin = 0;
  /** A size step is running, or ran a moment ago (its own resize events are not the person's zoom). */
  let sizing = 0;
  let sizedAt = 0;
  /** A real SPA navigation waiting out its debounce. */
  let navTimer: ReturnType<typeof setTimeout> | null = null;
  const undoneKinds = new Set<OpKind>();
  const opOffer = new Map<string, OfferKind>();
  let judged = new Set<string>();
  let decided = new Set<string>();
  /** Every element Jev has answered for on this page, so later partial reads extend the decisions instead of replacing them. */
  let jevEls = new Map<string, ElementEvidence>();
  let incrementalRounds = 0;
  /** A significant change arrived before Jev's first answer; read again once it lands. */
  let pendingLate = false;
  let lastIncrementalAt = 0;
  let incrementalTimer: ReturnType<typeof setTimeout> | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushFirstAt = 0;
  let pendingAdded: Element[] = [];
  let pendingChanged = new Set<Element>();
  let mo: MutationObserver | null = null;
  let stopNav: (() => void) | null = null;
  let stopSignals: (() => void) | null = null;
  let stopped = false;
  let errors: string[] = [];
  const behaviourCounts = { steady: 0, debounce: 0 };
  // Calm view
  let calmOpenedAt = 0;
  let calmEngaged = false;
  let calmGen = 0;
  let heuristicSpecCache: FitSpec | null = null;
  let pendingAi: { spec: FitSpec; result: RedesignResult } | null = null;
  let calmWasOpen = false;
  // Round 8, round 10: the WebAble page by default on reading pages. When this page started (performance.now();
  // 0 = the document load), when the person last clicked, pressed a key or scrolled past one screen, whether the
  // simplified page opened by itself on this page (closing it then sets the site to "Original page"), and that the
  // decision was made (once per page).
  let pageAt = 0;
  let interactedAt = -1;
  let autoOpenedHere = false;
  let autoDecided = false;
  /** A refit (the person changed a setting) closed the simplified page: open it again once the page is read. */
  let reopenAfterRefit: 'auto' | 'person' | null = null;
  /** Text size steps taken in the simplified page (the panel's text size while it is open); kept for the session. */
  let calmTextStep = 0;
  const redesignCache = new Map<string, RedesignResult>();
  // Round 7: the meaning check. Calm view is opened or offered on a page only when it leads with what the page exists
  // to show and leaves none of it out (Jev's verdict on a structure-only summary; checked on the device without Jev).
  let meaningGate: MeaningGate | null = null;
  let meaningRun: Promise<MeaningGate | null> | null = null;
  const dismissedOffers = new Map<OfferKind, number>();
  // The passive fit (round 4): the stored warm-up fit (state.fit is effectiveFit(baseFit, state.passive)), offers on
  // screen that came from what WebAble learned, and ops whose Undo also tells WebAble the learned need was wrong.
  let baseFit: FitProfile | null = null;
  const passiveOffers = new Map<OfferKind, PassiveOfferMeta>();
  const passiveUndo = new Map<string, FitDimension>();
  let passiveTimer: ReturnType<typeof setTimeout> | null = null;
  let stopMedia: (() => void) | null = null;

  const getFit = () => store.get().fit;

  /* ---------------- ledger, ops, toasts, errors ---------------- */

  const log = (e: Omit<LedgerEntry, 'at'>) => {
    const entry: LedgerEntry = { at: Math.round(performance.now() - store.get().startedAt), ...e };
    if (entry.p !== undefined) entry.p = r2(entry.p);
    store.set((s) => ({ ledger: [...s.ledger, entry].slice(-240) }));
  };

  const activeColumn = (): ColumnOp | null => (opsList.find((o) => o.rec.kind === 'column' && o.active) as ColumnOp | undefined) ?? null;

  /* ---------------- round 11: the text map (narrow screens whose width capped the zoom) ---------------- */

  const activeTextMap = (): Op | null => opsList.find((o) => o.rec.kind === 'text_map' && o.active) ?? null;
  /** The factor every text size is multiplied by now (1: zoom alone). */
  const textScaleNow = (): number => (activeTextMap() && textMap.active ? textMap.scale : 1);
  /**
   * The largest text zoom this page view is known to take on a narrow screen without scrolling sideways (measured by
   * the size step that found it), or null when the width never capped the zoom here.
   */
  let widthCap: number | null = null;
  /** The page read as the site sets it: the text map is lifted while the reader measures (no runaway re-reads). */
  const readPage = (): ReadResult => textMap.suspend(() => reader.read());
  /** Body text as the person sees it at text zoom `zoom`: the page's own size × zoom × the text map. */
  const effBody = (r: ReadResult, zoom: number): number => Math.round(r.pageBodyPx * zoom * textScaleNow() * 10) / 10;
  /** The plan, the state and the panel follow the text map. */
  const syncTextScale = (): void => {
    const k = textScaleNow();
    if (plan && read) plan = { ...plan, textScale: k, effectiveBodyPx: Math.round(read.pageBodyPx * plan.zoom * k * 10) / 10 };
    if ((store.get().textScale ?? 1) !== k) store.set({ textScale: k });
  };

  /** Viewport width in screen px (CSS px × zoom). */
  const screenWidth = (): number => {
    const zoom = store.get().pageZoom;
    return (document.documentElement.clientWidth || innerWidth) * (zoom > 0 ? zoom : 1);
  };
  /** The window's own width in screen px (scrollbars included, so a scrollbar coming and going does not move it). */
  const windowW = (): number => innerWidth * (store.get().pageZoom > 0 ? store.get().pageZoom : 1);
  /** The zoom text is shown at (the tab's zoom without the column's share). */
  const textZoomNow = (): number => store.get().pageZoom / colMul;

  const columnState = (): EngineState['column'] => {
    const op = activeColumn();
    const sw = screenWidth();
    const lim = columnLimits(sw);
    return { on: !!op, widthPx: op ? op.spec.widthPx : null, minPx: lim?.minPx ?? 720, maxPx: lim?.maxPx ?? Math.max(720, Math.round(sw - 128)) };
  };

  const syncOps = () => {
    const column = columnState();
    const cur = store.get().column;
    const same = cur.on === column.on && cur.widthPx === column.widthPx && cur.minPx === column.minPx && cur.maxPx === column.maxPx;
    store.set({ ops: opsList.map((o) => ({ ...o.rec, targetIds: [...o.rec.targetIds] })), ...(same ? {} : { column }) });
  };

  const addError = (msg: string) => {
    if (!msg) return;
    errors = [...errors.filter((e) => e !== msg), msg].slice(-20);
    pushReport();
  };

  let toastSeq = 0;
  const toast = (text: string, undoOpId?: string) => {
    const t: Toast = undoOpId ? { id: `t${++toastSeq}`, text, undoOpId } : { id: `t${++toastSeq}`, text };
    store.set((s) => ({ toasts: [...s.toasts, t].slice(-4) }));
    if (!undoOpId) {
      setTimeout(() => store.set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), 6000);
    }
  };

  /* ---------------- round 9: paragraphs rewritten the way the person likes things explained ---------------- */

  /** The one ledger line for a page's rewrites (logged again after a refit clears the ledger). */
  const logReword = (s: RewordSummary) => {
    const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
    if (!s.changed) {
      log({
        source: 'jev',
        title: s.picked ? 'Kept this page’s own words: no new version passed every check' : 'This page already reads the way you like things explained',
        detail: `From what ${s.source} knows about you. Jev read ${n(s.looked, 'paragraph')} for you${s.picked ? ` and picked ${s.picked}; each new version dropped a number, a condition or a link, so the page keeps its own words` : ' and none was harder than it needs to be'}.`,
        action: 'kept',
      });
      return;
    }
    const extra = [
      s.failed ? `${n(s.failed, 'paragraph')} kept the page’s own words because a check failed.` : '',
      s.overCap ? `${s.overCap} more stayed as they are (at most ${MAX_PICKS} a page).` : '',
    ].filter(Boolean).join(' ');
    log({
      source: 'jev',
      title: `Rewrote ${n(s.changed, 'paragraph')} the way you like things explained`,
      detail: `From what ${s.source} knows about you. Jev picked ${s.picked} of ${n(s.looked, 'paragraph')}; ${s.changed === 1 ? 'the rewrite' : `every rewrite`} kept its numbers and facts (checked by code and by Jev).${extra ? ` ${extra}` : ''} Click the green line beside one to see the page’s own words.`,
      action: 'applied',
      opId: s.opId,
    });
  };
  const reword = createReword({
    ask: (req, timeoutMs) => ask(req, timeoutMs),
    isOurs: (el) => safeOurs(el),
    sensitive: () => !!read?.sensitive || !!store.get().digest?.hasSensitiveFields,
    purpose: () => store.get().understanding?.purpose?.kind ?? null,
    calmOpen: () => store.get().calm.open,
    reducedMotion: () => {
      try {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
      } catch {
        /* no media queries */
      }
      return !!store.get().fit?.attention.motion.on;
    },
    publish: (next) => store.set({ reword: next }),
    log,
    finished: (s) => {
      logReword(s);
      if (s.changed) toast(`Rewrote ${s.changed} paragraph${s.changed === 1 ? '' : 's'} the way you like`, s.opId);
    },
  });

  /* ---------------- round 10: the WebAble page's groups laid out for the person ---------------- */

  /** The one ledger line for a page's groups (replaces the last one when later groups are answered; no toast). */
  const logCompose = (s: ComposeSummary) => {
    const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
    const source = store.get().reword?.source ?? null;
    const forWhom = source ? `From what ${source} knows about you.` : 'Laid out for any reader (no answer from an AI assistant added yet).';
    const lo = s.better.length ? Math.min(...s.better) : null;
    const hi = s.better.length ? Math.max(...s.better) : null;
    const range = lo === null || hi === null ? null : lo === hi ? p2(lo) : `${p2(lo)}–${p2(hi)}`;
    const others = s.failed - s.unreachable;
    const extra = [
      s.kept ? `${n(s.kept, 'part')} read better in the page’s own words, so ${s.kept === 1 ? 'it keeps them' : 'they keep them'}.` : '',
      others ? `${n(others, 'part')} kept the page’s own words because a check failed.` : '',
      s.unreachable ? `${n(s.unreachable, 'part')} couldn’t be checked right now, so ${s.unreachable === 1 ? 'it shows' : 'they show'} the page’s own words.` : '',
    ].filter(Boolean).join(' ');
    let entry: Omit<LedgerEntry, 'at'>;
    if (s.laidOut) {
      entry = {
        source: 'jev',
        title: `Laid out ${n(s.laidOut, 'part')} of this page in a clearer way for you`,
        detail: `${forWhom} WebAble looked at ${n(s.asked, 'part')}; ${s.laidOut === 1 ? 'the one laid out' : `all ${s.laidOut} laid out`} kept every number and link (checked by code and by Jev)${range ? `, and Jev’s probability ${s.laidOut === 1 ? 'it is' : 'each is'} easier for you than the page’s own text is ${range}` : ''}.${extra ? ` ${extra}` : ''}`,
        action: 'applied',
        opId: s.opId,
      };
    } else if (s.unreachable === s.asked) {
      entry = { source: 'jev', title: 'Couldn’t lay out this page’s parts right now; it shows the page’s own words', detail: 'The WebAble server could not be reached.', action: 'skipped', opId: s.opId };
    } else {
      entry = { source: 'jev', title: 'Kept this page’s own words in every part', detail: `${forWhom} WebAble looked at ${n(s.asked, 'part')}. ${extra}`.trim(), action: 'kept', opId: s.opId };
    }
    store.set((st) => ({ ledger: st.ledger.filter((e) => e.opId !== s.opId) }));
    log(entry);
  };
  const hostNow = (): string => {
    try {
      return location.hostname;
    } catch {
      return '';
    }
  };
  const composer = createCompose({
    ask: (req, timeoutMs) => ask(req, timeoutMs),
    page: () => ({ title: document.title.slice(0, 200), host: hostNow(), purpose: store.get().understanding?.purpose?.kind ?? null }),
    // Like the paragraph rewrites: never from pages with password or payment fields, or mail, chat and banking sites.
    blocked: () => !!read?.sensitive || !!store.get().digest?.hasSensitiveFields || isExcludedHost(hostNow()),
    publish: (next) => store.set({ compose: next }),
    finished: (s) => logCompose(s),
  });

  /* ---------------- report to the background (throttled 500 ms) ---------------- */

  const buildReport = (): TabReport => {
    const s = store.get();
    const u = s.understanding;
    let summary: { folded: number; protected: number; mainId: string | null } = { folded: 0, protected: 0, mainId: null };
    try {
      summary = summarizeDecisions(s.decisions);
    } catch {
      summary = {
        folded: s.decisions.filter((d) => d.verdict === 'fold').length,
        protected: s.decisions.filter((d) => d.verdict === 'protect').length,
        mainId: s.decisions.find((d) => d.verdict === 'promote')?.id ?? null,
      };
    }
    return {
      url: location.href,
      phase: s.phase,
      fitApplied: s.ops.some((o) => o.status === 'applied' && opsList.find((x) => x.rec.id === o.id)?.source === 'fit'),
      ops: s.ops,
      checks: s.checks,
      ledger: s.ledger.slice(-120),
      understanding: u ? { metrics: u.metrics, decisions: u.metrics.questions || s.decisions.length, folded: summary.folded, protected: summary.protected, mainId: summary.mainId } : null,
      struggle: s.struggle.latest,
      redesign: s.calm.redesign ? { chosen: s.calm.redesign.chosen, autoApply: s.calm.redesign.autoApply, ms: s.calm.redesign.llm.ms } : null,
      errors,
      overlays: s.overlays,
      ai: s.ai,
    };
  };
  const pushReport = throttle(() => {
    if (stopped) return;
    tell({ type: 'report', report: buildReport() });
  }, 500);
  store.subscribe(() => pushReport());

  /* ---------------- one writer at a time (verified batches, overlay moves) ---------------- */

  let lockChain: Promise<unknown> = Promise.resolve();
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = lockChain.then(fn, fn);
    lockChain = run.catch(() => undefined);
    return run;
  }

  /* ---------------- overlays that cover the task ("make room") ---------------- */

  /** What the task needs in view: the main action, main-form fields in the first screens, the h1. */
  function taskTargets(): Element[] {
    const out: Element[] = [];
    const promoted = store.get().decisions.find((d) => d.verdict === 'promote');
    const main = promoted ? reader.elementFor(promoted.id) : null;
    if (main) out.push(main);
    const vh = document.documentElement.clientHeight || innerHeight;
    if (!main) {
      // No main pick (a portal home page): the buttons Jev scored most likely to be the main action stand in for it.
      const likely = store.get().decisions
        .filter((d) => d.verdict !== 'fold' && d.judgment.main >= 0.1)
        .sort((a, b) => b.judgment.main - a.judgment.main)
        .slice(0, 2);
      for (const d of likely) {
        const el = reader.elementFor(d.id);
        if (!el || !el.isConnected || !el.matches('a[href], button, [role="button"], input[type="submit"]')) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom > 0 && r.top < vh) out.push(el);
      }
    }
    if (read) {
      for (const n of read.nodes.values()) {
        if (out.length >= 14) break;
        if (!n.inMain || !n.el.isConnected) continue;
        if (n.kind !== 'field' && n.kind !== 'select' && n.kind !== 'checkbox' && n.kind !== 'radio') continue;
        const r = n.el.getBoundingClientRect();
        if (r.bottom > 0 && r.top < vh) out.push(n.el);
      }
    }
    const h1 = Array.from(document.querySelectorAll('h1')).find((h) => !safeOurs(h) && h.getBoundingClientRect().height > 0);
    if (h1) out.push(h1);
    return out;
  }

  const overlays = new OverlayManager({
    ask: <T,>(req: BgRequest) => ask<T>(req),
    isOurUi: safeOurs,
    ensureId: (el) => reader.ensureId(el),
    decisions: () => store.get().decisions,
    elementFor: (id) => reader.elementFor(id) ?? verifyEls.get(id)?.deref() ?? null,
    taskTargets,
    mainRoot: () => read?.mainRoot ?? null,
    sheets: tailor.sheets,
    lock: withLock,
    addOp: (op) => {
      opsList.push(op);
      syncOps();
    },
    syncOps: () => syncOps(),
    log: (e) => log(e),
    toast: (text, undoOpId) => toast(text, undoOpId),
    publish: (list: OverlayView[]) => store.set({ overlays: list }),
    // Scans also run under the Calm view, so the page is already clear when the person closes it.
    paused: () => {
      const s = store.get();
      return stopped || s.showingOriginal || !(s.phase === 'tailored' || s.phase === 'understood' || s.phase === 'calm');
    },
    quiet: () => store.get().calm.open,
    ledgerHas: (title) => store.get().ledger.some((e) => e.title === title),
  });

  /* ---------------- zoom ---------------- */

  /** The text zoom (`factor`: the tab's zoom without the page column's share) and the tab's own zoom (`tab`). */
  async function zoomInfo(): Promise<{ factor: number; tab: number; personChanged: boolean }> {
    const out = (tab: number, personChanged: boolean) => ({ factor: Math.round((tab / colMul) * 10000) / 10000, tab, personChanged });
    try {
      const z = await askExt<ZoomInfo>({ type: 'zoomInfo' });
      if (z && Number.isFinite(z.factor)) return out(z.factor, !!z.personChanged);
    } catch {
      /* fall back to getZoom */
    }
    try {
      const f = await ask<number>({ type: 'getZoom' });
      return out(Number.isFinite(f) && f > 0 ? f : 1, false);
    } catch {
      return out(colMul, false);
    }
  }

  /**
   * Draw the page column at scale k (1 = none): the tab's zoom becomes text zoom ÷ k, capped at Chrome's 500%.
   * Resolves after the resize with the k in effect.
   */
  async function columnScale(k: number): Promise<number> {
    const zi = await zoomInfo();
    const text = zi.factor > 0 ? zi.factor : 1;
    let mul = k > 0 && k < 1 ? 1 / k : 1;
    mul = Math.max(1, Math.min(mul, 5 / text));
    // Already drawn at this scale with the tab's zoom set for it (round 6: the size step set both at once). Chrome
    // keeps whole percents, so a tab zoom within 0.6% is the same zoom.
    if (Math.abs(mul - colMul) < 0.0005 && Math.abs(zi.tab - text * mul) < 0.006) return 1 / colMul;
    colMul = mul;
    const resized = waitResize(900);
    await setTextZoom(text);
    await resized;
    await sleep(250);
    return 1 / mul;
  }

  const waitResize = (cap = 600) => new Promise<void>((resolve) => {
    const t = setTimeout(done, cap);
    function done() {
      clearTimeout(t);
      window.removeEventListener('resize', done);
      resolve();
    }
    window.addEventListener('resize', done, { once: true });
  });

  /* ---------------- applying and verifying a batch ---------------- */

  interface BatchOptions {
    quiet?: boolean;
    /** Probe the whole page's main text (text size, spacing, heading and column batches). */
    wide?: boolean;
    /** Checks this batch does not roll back for (see SnapshotContext.ignore). */
    ignore?: CheckName[];
  }

  function applyBatch(batch: Op[], r: ReadResult | null, opts: BatchOptions = {}): Promise<Op[]> {
    if (!batch.length || stopped) return Promise.resolve([]);
    return activity.run(() => withLock(() => applyBatchNow(batch, r, opts)));
  }

  async function applyBatchNow(batch: Op[], r: ReadResult | null, opts: BatchOptions = {}): Promise<Op[]> {
    const fit = getFit();
    if (!batch.length || stopped) return [];
    const gen = generation;
    if (store.get().showingOriginal) {
      // Recorded now, applied when the person turns the original page off.
      for (const op of batch) opsList.push(op);
      syncOps();
      return batch;
    }
    const probe = verifier.probe(r, batch.flatMap((o) => o.elements), { wide: !!opts.wide });
    const coverOps = [...opsList.filter((o) => o.active), ...batch];
    const mainRoot = r?.mainRoot ?? null;
    const before = verifier.snapshot(probe, { ops: opsList.filter((o) => o.active), coverOps, contrastFloor: fit?.contrast.floor, mainRoot });
    verifier.watchVolatile();
    const zoomInBatch = batch.some((o) => o.rec.kind === 'page_zoom');
    for (const op of batch) {
      try {
        await op.apply();
      } catch (err) {
        op.rec.status = 'skipped';
        op.rec.reason = `${op.rec.reason}; not applied: ${errText(err)}`;
        if (!opts.quiet) log({ source: op.source, title: `Could not apply ${OP_NOUN[op.rec.kind]}`, detail: plainError(err), action: 'skipped', opId: op.rec.id });
      }
      opsList.push(op);
    }
    // A zoom change: wait for the resize, then a moment for the site's own responsive scripts (menus that fold).
    if (zoomInBatch) {
      await waitResize();
      await sleep(350);
    }
    await settle();
    if (gen !== generation || stopped) {
      verifier.stopVolatile();
      return [];
    }
    const outcome = await verifier.verify(
      batch.filter((o) => o.active), before, probe,
      { ops: opsList, coverOps, contrastFloor: fit?.contrast.floor, mainRoot, guardOps: [], ...(opts.ignore ? { ignore: opts.ignore } : {}) },
      async (op) => {
        await op.revert();
        op.rec.status = 'reversed';
      },
      async (op) => {
        await op.apply();
        op.rec.status = 'applied';
      },
    );
    verifier.stopVolatile();
    for (const op of batch) {
      if (op.active && !opts.quiet) log({ source: op.source, title: op.title, detail: op.detail, p: op.p, action: 'applied', opId: op.rec.id });
    }
    for (const d of outcome.droppedEls) {
      if (opts.quiet) continue;
      log({
        source: 'check',
        title: `Kept ${d.count} heading${d.count === 1 ? '' : 's'} at the site's own size where a larger one did not fit`,
        detail: d.result.detail,
        action: 'skipped',
        opId: d.op.rec.id,
      });
    }
    for (const rv of outcome.reversed) {
      if (opts.quiet && rv.op.rec.kind === 'column') continue; // a quiet column batch is summed up by its caller
      const where = /\bin the ([a-z ]+?)(?= is| are| now| can| faded| hid| disappeared| got| sticks| \(|$)/.exec(rv.result.detail)?.[1];
      log({
        source: 'check',
        title: `Reversed ${OP_NOUN[rv.op.rec.kind]}: ${plainCheck(rv.result.name)}${where ? ` in the ${where}` : ''}`,
        detail: rv.result.detail,
        action: 'reversed',
        opId: rv.op.rec.id,
      });
    }
    if (outcome.dropped) {
      log({ source: 'check', title: `Kept ${outcome.dropped} click area${outcome.dropped === 1 ? '' : 's'} at the original size where a larger one would not reach`, action: 'skipped' });
    }
    store.set((s) => ({ checks: [...s.checks, ...outcome.checks].slice(-80) }));
    syncOps();
    return batch.filter((o) => o.active);
  }

  async function revertOp(op: Op): Promise<void> {
    if (!op.active) return;
    try {
      await op.revert();
    } catch (err) {
      addError(plainError(err));
    }
  }

  /**
   * Take ops off, newest first. The page column's CSS comes off without a zoom change of its own, so the page goes
   * back to the person's own size with one tab zoom change (Chrome shows its bubble for each).
   */
  async function revertAll(list: Op[]): Promise<void> {
    const col = list.find((o) => o.rec.kind === 'column' && o.active) as ColumnOp | undefined;
    const zoomed = list.some((o) => o.rec.kind === 'page_zoom' && o.active);
    sizing++;
    try {
      if (col) {
        col.release();
        colMul = 1;
      }
      for (const op of [...list].reverse()) if (op.active) await revertOp(op);
      if (col && !zoomed) await setTextZoom(plan?.ownZoom ?? 1).catch((err: unknown) => addError(plainError(err)));
    } finally {
      sizing--;
      sizedAt = Date.now();
    }
  }

  /* ---------------- boot ---------------- */

  /**
   * Settings, the stored warm-up fit and what WebAble has learned (round 4). The page is fitted with
   * effectiveFit(warm-up, learned): with no warm-up at all it still fits from Chrome's settings and learning.
   */
  async function loadSettingsAndFit(): Promise<{ settings: Settings; fit: FitProfile; base: FitProfile | null; passive: PassiveFitState | null }> {
    let settings: Settings = { ...DEFAULT_SETTINGS };
    let fit: FitProfile | null = null;
    let passive: PassiveFitState | null = null;
    try {
      const s = await ask<Partial<Settings> | null>({ type: 'getSettings' });
      settings = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
    } catch (err) {
      addError(plainError(err));
    }
    try {
      fit = await ask<FitProfile | null>({ type: 'getFit' });
      if (fit && fit.v !== 'fit.1') fit = null;
    } catch (err) {
      addError(plainError(err));
    }
    try {
      // The OS preferences this page sees travel with the request (the worker has no matchMedia).
      const req = { type: 'getPassive' as const, media: readMediaFacts() };
      const p = await ask<PassiveFitState | null>(req, 4000);
      if (p && p.v === 'passive.1') passive = p;
    } catch {
      passive = null; // an older worker or a reloaded extension: fit from the warm-up alone
    }
    let eff: FitProfile;
    try {
      eff = effectiveFit(fit, passive);
    } catch {
      eff = fit ?? effectiveFit(null, null);
    }
    return { settings, fit: eff, base: fit, passive };
  }

  /** AI availability from the server's /health ('on' | 'off' | 'no_credits'), for the panel's "AI layouts off" line. */
  async function refreshHealth(): Promise<void> {
    try {
      const h = await askExt<HealthInfo>({ type: 'health' });
      const ai: HealthStatus['ai'] = h.ai === 'on' || h.ai === 'off' || h.ai === 'no_credits'
        ? h.ai
        : h.ok && h.openai !== false ? 'on' : 'off';
      if (store.get().ai !== ai) store.set({ ai });
    } catch {
      if (store.get().ai !== 'off') store.set({ ai: 'off' });
    }
  }

  /** True on the first Jev read of this page in this browser session (that read skips the server's cache). */
  async function firstReadInSession(): Promise<boolean> {
    const key = `read:${hashString(`${location.origin}${location.pathname}`)}`;
    try {
      const got = await chrome.storage.session.get(key);
      if (got[key]) return false;
      await chrome.storage.session.set({ [key]: Date.now() });
      return true;
    } catch {
      return false;
    }
  }

  function pausedHere(settings: Settings): boolean {
    return settings.pausedOrigins.includes(location.origin) || settings.pausedOrigins.includes(location.hostname);
  }

  /* ---------------- text size and the page column (round 3) ---------------- */

  /** One person action at a time (A−/A+, Narrower/Wider): each one is verified before the next starts. */
  let personChain: Promise<unknown> = Promise.resolve();
  function personAction(fn: () => Promise<void>): void {
    const run = personChain.then(fn, fn);
    personChain = run.catch((err: unknown) => addError(plainError(err)));
  }

  /** Zoom stopped short of the person's size: say so, and offer Calm view (it renders at their size). */
  function noteSizeShortfall(p: ZoomPlan): void {
    if (!p.capped || p.step !== 0) return;
    const eff = Math.round(p.bodyPx * p.zoom * (p.textScale ?? 1));
    const target = Math.round(p.targetPx);
    log({
      source: 'fit',
      title: `Text is ${eff} px here; your size is ${target} px`,
      detail: `Zoom stops at ${pct(p.cap)} on fitted pages, so this page's ${p.bodyPx} px text stays short of your size. Calm view shows the page at your size.`,
      action: 'offered',
    });
    const s = store.get();
    if (s.struggle.offers.length || (dismissedOffers.get('calm_view') ?? 0) > Date.now()) return;
    if (meaningGate && !meaningGate.pass) return;
    const offer: Offer = {
      kind: 'calm_view',
      question: 'Show this page at your text size?',
      fact: `Zoom stops at ${pct(p.cap)} here, so text is ${eff} px, not ${target} px.`,
      why: 'Calm view sets the whole page at your size, and every control still works the original page.',
      p: 1,
    };
    store.set({ struggle: { ...s.struggle, offers: [offer] } });
  }

  /** Whether this page gets a column, and how wide: the site's remembered choice, then the fit, then automatic. */
  function columnWish(zooming: boolean): { mode: 'auto' | 'person'; fixedPx: number | null } | null {
    const pref = sitePrefs.column;
    if (pref === 'off') return null;
    if (typeof pref === 'number' && pref > 0) return { mode: 'person', fixedPx: pref };
    const fitPref = getFit()?.layout?.column ?? 'auto';
    if (fitPref === 'off') return null;
    if (typeof fitPref === 'number' && fitPref > 0) return { mode: 'person', fixedPx: fitPref };
    if (sitePrefs.columnFailed && Date.now() - sitePrefs.columnFailed < COLUMN_RETRY_MS) return null;
    // Automatic: on pages WebAble zooms.
    return zooming ? { mode: 'auto', fixedPx: null } : null;
  }

  /** The column width (screen px) for text zoom `zoom`, or null for full width. */
  function columnWidthFor(zoom: number, wish: { mode: 'auto' | 'person'; fixedPx: number | null } | null): number | null {
    if (!wish || undoneKinds.has('column')) return null;
    const planned = planColumn({ screenW: screenWidth(), zoom, charPx: read?.body.charPx ?? 8, fixedPx: wish.fixedPx });
    return planned ? planned.widthPx : null;
  }

  /**
   * The page's body size as the page sets it now. The page column narrows the window, and a site may switch to the
   * type scale it uses at that width: the body size read at the start, scaled by how its running text changed.
   */
  function liveBodyPx(r: ReadResult): number {
    if (!activeColumn()) return r.pageBodyPx;
    const collect = (pick: (t: ReadResult['texts'][number]) => boolean): Array<[number, number]> => {
      const out: Array<[number, number]> = [];
      for (const t of r.texts) {
        if (!t.inMain || !t.el.isConnected || !(t.fontPx > 0) || !pick(t)) continue;
        const v = parseFloat(getComputedStyle(t.el).fontSize);
        if (Number.isFinite(v) && v > 0) out.push([v / t.fontPx, t.chars]);
        if (out.length >= 300) break;
      }
      return out;
    };
    let ratios = collect((t) => t.running && t.chars >= 60);
    // A page of headline links (a news front page) has little running text: its headlines are its body.
    if (ratios.length < 3) ratios = collect((t) => t.headingLevel === null && t.chars >= 20);
    if (!ratios.length) return r.pageBodyPx;
    ratios.sort((a, b) => a[0] - b[0]);
    const total = ratios.reduce((a, x) => a + x[1], 0);
    let acc = 0;
    let med = 1;
    for (const [q, w] of ratios) {
      acc += w;
      if (acc >= total / 2) {
        med = q;
        break;
      }
    }
    return Math.round(r.pageBodyPx * med * 10) / 10;
  }

  /* ---------------- one size step: text zoom and column together (round 6) ---------------- */

  /** A page size: the text zoom and the page column (null: full width). */
  interface SizeTarget {
    zoom: number;
    column: number | null;
    mode: 'auto' | 'person';
  }

  interface SizeStep {
    ok: boolean;
    /** Whether the tab's zoom or the column changed at all. */
    changed: boolean;
    fails: CheckResult[];
    /** The page's width after the step and its viewport (CSS px), for the fallback's zoom. */
    scrollW: number;
    viewW: number;
    /** The scale the column was drawn at (1 = no column). */
    k: number;
    zoomOp: Op | null;
    colOp: ColumnOp | null;
    /** The page before the first step, so a fallback is checked against the page as the site made it. */
    base: { snap: Snapshot; probe: Element[] } | null;
  }

  /** The size the page shows now. */
  function sizeNow(): SizeTarget {
    const col = activeColumn();
    return { zoom: Math.round(textZoomNow() * 10000) / 10000, column: col ? col.spec.widthPx : null, mode: col?.spec.mode ?? 'auto' };
  }

  /** The person's own zoom (what the page had before WebAble). */
  const ownZoom = (): number => plan?.ownZoom ?? 1;

  /**
   * Move the page from its size now to `t` in one step: the column's CSS and the tab's zoom change together, so
   * Chrome's zoom changes once (and shows its zoom bubble once). Checked once, with no reversals; the caller picks the
   * one fallback. Runs under the write lock.
   */
  async function stepSize(r: ReadResult, t: SizeTarget, o: { source: LedgerEntry['source']; step: number; base?: SizeStep['base']; check?: boolean }): Promise<SizeStep> {
    const fit = getFit();
    const own = ownZoom();
    const sw = screenWidth();
    const win = windowW();
    let k = 1;
    if (t.column && sw > 0) {
      const mul = Math.min(sw / t.column, 5 / Math.max(0.25, t.zoom));
      k = mul > 1.0005 ? 1 / mul : 1;
    }
    const mul = 1 / k;
    const wantTab = Math.round(t.zoom * mul * 100) / 100;
    const curCol = activeColumn();
    const curZoom = opsList.filter((x) => x.rec.kind === 'page_zoom' && x.active);
    const zi = await zoomInfo();
    const sameZoom = Math.abs(zi.tab - wantTab) < 0.006 && (Math.abs(t.zoom - own) < 0.005 ? !curZoom.length : curZoom.length > 0);
    const sameCol = k === 1 ? !curCol : !!curCol && curCol.spec.widthPx === t.column && Math.abs(colMul - mul) < 0.002;
    if ((sameZoom && sameCol) || stopped) {
      return { ok: true, changed: false, fails: [], scrollW: 0, viewW: 0, k: 1 / colMul, zoomOp: curZoom[0] ?? null, colOp: curCol, base: o.base ?? null };
    }
    // The same text zoom with only the column changing keeps its zoom op (its Undo in the ledger still works).
    const keptZoom = curZoom.length === 1 && t.zoom > own + 0.005 && Math.abs(textZoomNow() - t.zoom) < 0.005 ? curZoom[0] ?? null : null;
    const basePlan = plan ?? tailor.planZoom(fit ?? fallbackFitLike(), r.pageBodyPx, own, false, 0);
    const zPlan: ZoomPlan = { ...basePlan, zoom: t.zoom, step: o.step, effectiveBodyPx: Math.round(r.pageBodyPx * t.zoom * 10) / 10 };
    const zop = keptZoom ? null : tailor.zoomOp(zPlan, own);
    if (zop) zop.source = o.source;
    const cop = k < 1 && t.column ? tailor.columnOp({ widthPx: t.column, zoom: t.zoom, mode: t.mode, scale: k }) : null;
    const batch = [zop, cop].filter((x): x is Op => !!x);
    const checked = [keptZoom ?? zop, cop].filter((x): x is Op => !!x);
    const check = o.check !== false && checked.length > 0;
    const coverOps = [...opsList.filter((x) => x.active), ...batch];
    const mainRoot = r.mainRoot ?? null;
    let snapBase = o.base ?? null;
    if (check && !snapBase) {
      const probe = verifier.probe(r, [], { wide: true });
      snapBase = { snap: verifier.snapshot(probe, { ops: opsList.filter((x) => x.active), coverOps, contrastFloor: fit?.contrast.floor, mainRoot }), probe };
    }
    if (check) verifier.watchVolatile();
    sizing++;
    const resized = waitResize(900);
    try {
      // Off with the old size and on with the new one: the column's CSS comes off without a zoom change, the tab's
      // zoom is set once for text and column together, then the column's CSS goes on at the scale it was set for.
      if (curCol) {
        curCol.release();
        curCol.rec.status = 'reversed';
        opsList = opsList.filter((x) => x !== curCol);
      }
      for (const z of curZoom) {
        if (z === keptZoom) continue;
        z.active = false; // superseded: the new op's Undo goes back to the person's own zoom
        z.rec.status = 'reversed';
      }
      colMul = mul;
      if (zop) await zop.apply();
      else await setTextZoom(keptZoom ? t.zoom : own);
      if (cop) {
        await cop.apply();
        columnWin = win;
      }
      for (const op of batch) opsList.push(op);
      if (Math.abs(zi.tab - wantTab) >= 0.006) {
        await resized;
        // A moment for the site's own responsive scripts (menus that fold).
        await sleep(350);
      }
      await settle();
    } catch (err) {
      for (const op of batch) {
        if (op.active) continue;
        op.rec.status = 'skipped';
        op.rec.reason = `${op.rec.reason}; not applied: ${errText(err)}`;
      }
      addError(plainError(err));
    } finally {
      sizing--;
      sizedAt = Date.now();
    }
    syncOps();
    if (!check || !snapBase || stopped) {
      if (check) verifier.stopVolatile();
      return { ok: true, changed: true, fails: [], scrollW: 0, viewW: 0, k, zoomOp: zop ?? keptZoom, colOp: cop, base: snapBase };
    }
    const res = verifier.check(checked.filter((x) => x.active), snapBase.snap, snapBase.probe, {
      ops: opsList.filter((x) => x.active), coverOps, contrastFloor: fit?.contrast.floor, mainRoot, ignore: cop ? COLUMN_IGNORES : ZOOM_IGNORES,
    });
    verifier.stopVolatile();
    store.set((s) => ({ checks: [...s.checks, ...res.checks].slice(-80) }));
    return { ok: !res.fails.length, changed: true, fails: res.fails, scrollW: res.scrollW, viewW: res.viewW, k, zoomOp: zop ?? keptZoom, colOp: cop, base: snapBase };
  }

  /**
   * The one fallback after a failed size step. With the column on, the column comes off at the same text zoom: the
   * site's own layout at the full window is wider than the column's, so the column is the likely cause, unless the
   * page needs more width than the window has even without it. Without the column (or when it would still not fit),
   * the next lower zoom preset, or lower when the page scrolled sideways: the largest zoom that leaves the page the
   * width it needs.
   */
  function fallbackFor(t: SizeTarget, res: SizeStep, largePrint: boolean): SizeTarget {
    const own = ownZoom();
    const sw = screenWidth() || innerWidth;
    const sideways = res.fails.some((f) => f.name === 'overflow') && res.scrollW > res.viewW + 8;
    const tab = t.zoom / (res.k > 0 ? res.k : 1);
    let maxZ = Infinity;
    if (sideways) {
      // Screen px the page's content needs; the column's side bands come off with it.
      const need = res.scrollW * tab - (res.colOp && t.column ? Math.max(0, sw - t.column) / 2 : 0);
      if (need > sw + 8) maxZ = (t.zoom * sw) / need;
    }
    if (res.colOp && maxZ >= t.zoom) return { zoom: t.zoom, column: null, mode: t.mode };
    let z = stepZoom(t.zoom, -1, largePrint);
    for (let i = 0; i < 8 && z > own + 0.005 && z > maxZ + 0.001; i++) {
      const lower = stepZoom(z, -1, largePrint);
      if (lower >= z) break;
      z = lower;
    }
    if (!(z > own + 0.005) || z >= t.zoom) z = own;
    return { zoom: z, column: null, mode: t.mode };
  }

  /** The words for what a failed check saw ("made the page scroll sideways"). */
  function failWords(fails: CheckResult[]): string {
    const f = fails[0];
    return f ? plainCheck(f.name).replace(/^it /, '') : 'failed a check';
  }

  /**
   * What the size is planned for: the fit's text size and the person's A−/A+ steps and width choice on this site, and
   * (round 11) whether the screen is narrow, so a phone turned sideways plans again.
   */
  function sizeSig(fit: FitProfile): string {
    return JSON.stringify([
      fit.text.override ?? fit.text.bodyPx, !!fit.text.largePrint, fit.text.source === 'default' && fit.text.override == null,
      fit.layout?.column ?? 'auto', sitePrefs.textStep ?? 0, sitePrefs.column ?? null, textScaleGate(screenWidth()),
    ]);
  }

  function rememberSize(t: SizeTarget): void {
    const fit = getFit();
    if (!fit) return;
    const k = textScaleNow();
    saveSettled({ sig: sizeSig(fit), zoom: t.zoom, column: t.column, mode: t.mode, ...(k > 1.001 ? { textScale: k } : {}) });
  }

  /* ---------------- round 11: the text map step ---------------- */

  /**
   * The checks a text map rolls back for: all of them. It is WebAble's own CSS, not the site's design at a size, so
   * text cut off, text over text, sideways scrolling, sizes out of order, lost content and unreachable controls all
   * count.
   */
  const TEXT_IGNORES: CheckName[] = [];

  /** The page before the first text step (the verifier's snapshot, and where text was already partly covered). */
  type TextBase = { snap: Snapshot; probe: Element[]; cover: Map<Element, number> } | null;

  interface TextStep {
    ok: boolean;
    fails: CheckResult[];
    op: Op | null;
    /** The page before the first text step, so the one fallback is checked against the page without the map. */
    base: TextBase;
  }

  /** The page with every text size × k (null: the site's own sizes) in one step, checked once. Runs under the lock. */
  async function stepTextScale(r: ReadResult, k: number | null, o: { source: LedgerEntry['source']; zoom: number; wantZoom: number; base?: TextBase; check?: boolean }): Promise<TextStep> {
    const cur = activeTextMap();
    if (stopped || (k === null && !cur) || (cur && k !== null && Math.abs(textMap.scale - k) < 0.005)) {
      return { ok: true, fails: [], op: cur, base: o.base ?? null };
    }
    const fit = getFit();
    const op = k === null ? null : textMapOp(textMap, k, {
      zoom: o.zoom, wantZoom: o.wantZoom, source: o.source, bodyPx: r.pageBodyPx, targetPx: fit ? fit.text.override ?? fit.text.bodyPx : null, idOf,
    });
    const check = o.check !== false && !!op;
    const coverOps = [...opsList.filter((x) => x.active && x !== cur), ...(op ? [op] : [])];
    const mainRoot = r.mainRoot ?? null;
    let base = o.base ?? null;
    if (check && !base && op) {
      const probe = verifier.probe(r, [], { wide: true });
      base = {
        snap: verifier.snapshot(probe, { ops: opsList.filter((x) => x.active), coverOps, contrastFloor: fit?.contrast.floor, mainRoot }),
        probe,
        cover: textCover(op.elements, safeOurs),
      };
    }
    if (check) verifier.watchVolatile();
    try {
      if (cur) {
        // Superseded: the new op takes the page over (its Undo goes back to the site's own sizes).
        cur.active = false;
        cur.rec.status = 'reversed';
        if (!op) textMap.clear();
      }
      if (op) {
        await op.apply();
        opsList.push(op);
      }
      await settle();
    } catch (err) {
      if (op && !op.active) {
        op.rec.status = 'skipped';
        op.rec.reason = `${op.rec.reason}; not applied: ${errText(err)}`;
      }
      addError(plainError(err));
    }
    syncOps();
    syncTextScale();
    if (!check || !base || !op || !op.active || stopped) {
      if (check) verifier.stopVolatile();
      return { ok: true, fails: [], op: op && op.active ? op : null, base };
    }
    const res = verifier.check([op], base.snap, base.probe, {
      ops: opsList.filter((x) => x.active), coverOps, contrastFloor: fit?.contrast.floor, mainRoot, ignore: TEXT_IGNORES,
    });
    verifier.stopVolatile();
    // The page must never scroll sideways because of the map: the overflow check allows 8 px for zoom rounding; the
    // map is checked at the same zoom as its base, so any new sideways scroll counts.
    const ovB = base.snap.measure.docScrollW - base.snap.measure.viewportW;
    const ovA = res.scrollW - res.viewW;
    let fails = res.fails;
    let checks = res.checks;
    if (ovA > Math.max(0, ovB) && !fails.some((f) => f.name === 'overflow')) {
      const f: CheckResult = { name: 'overflow', pass: false, detail: `The page now scrolls sideways (by ${Math.round(ovA)} px)`, opId: op.rec.id };
      fails = [...fails, f];
      checks = [...checks.filter((c) => c.name !== 'overflow'), f];
    }
    // Text partly covered: the end of a line now running under a button or box beside it (the verifier samples the
    // middle of a line only). Only new cover counts, on screen.
    const after = textCover(op.elements, safeOurs, base.cover);
    const covered: Element[] = [];
    for (const [el, n] of after) if (n > (base.cover.get(el) ?? 0) && !verifier.volatileHas(el)) covered.push(el);
    if (covered.length) {
      const f: CheckResult = { name: 'overlap', pass: false, detail: `Text is now partly covered by something else (${covered.slice(0, 4).map(idOf).join(', ')})`, opId: op.rec.id };
      fails = [...fails, f];
      checks = [...checks.filter((c) => !(c.name === 'overlap' && c.pass)), f];
    }
    store.set((s) => ({ checks: [...s.checks, ...checks].slice(-80) }));
    return { ok: !fails.length, fails, op, base };
  }

  /**
   * The one smaller try after the map at k failed a check: halfway; when the page scrolled sideways or text got
   * covered, the largest k at which neither happens (measured by laying the page out at trial sizes, the map still on
   * at k), alone when those were the only failures, else whichever is smaller. Null: nothing worth trying.
   */
  function textFallback(first: TextStep, k: number): number | null {
    let half = fallbackTextScale(k);
    const base = first.base;
    const measurable = (f: CheckResult) => f.name === 'overflow' || f.name === 'overlap';
    if (base && first.op && first.op.active && first.fails.some(measurable)) {
      const de = document.documentElement;
      const ovB = Math.max(0, base.snap.measure.docScrollW - base.snap.measure.viewportW);
      const els = first.op.elements;
      const kd = textMap.largestScale(k, () => {
        if (de.scrollWidth - de.clientWidth > ovB) return false;
        for (const [el, n] of textCover(els, safeOurs, base.cover)) if (n > (base.cover.get(el) ?? 0)) return false;
        return true;
      });
      if (kd === null) return null;
      const only = first.fails.every(measurable);
      const pick = only || half === null ? kd : Math.min(half, kd);
      half = pick >= TEXT_SCALE_MIN && pick < k - 0.005 ? pick : null;
    }
    return half;
  }

  /**
   * The text map for a page whose zoom the width stopped at `zoom` (round 11): k, checked; one smaller k when a check
   * fails (textFallback); then the site's own sizes. Says in the ledger what happened.
   */
  async function fitTextScale(gen: number, r: ReadResult, k: number, zoom: number, wantZoom: number, source: LedgerEntry['source'], kind: 'first' | 'navigation' | 'refit', remembered: boolean): Promise<void> {
    const t0 = performance.now();
    const first = await withLock(() => stepTextScale(r, k, { source, zoom, wantZoom }));
    if (gen !== generation || stopped) return;
    let res = first;
    let used: number | null = k;
    if (!first.ok) {
      const half = textFallback(first, k);
      if (half !== null) {
        res = await withLock(() => stepTextScale(r, half, { source: 'check', zoom, wantZoom, base: first.base }));
        if (gen !== generation || stopped) return;
        used = half;
      }
      if (half === null || !res.ok) {
        await withLock(() => stepTextScale(r, null, { source: 'check', zoom, wantZoom, check: false }));
        used = null;
      }
      log({
        source: 'check',
        title: used !== null
          ? `Made the text ${scaleWords(used)}× bigger, not ${scaleWords(k)}×: ${scaleWords(k)}× ${failWords(first.fails)}`
          : `Kept this page’s own text sizes: ${scaleWords(k)}× ${failWords(first.fails)}${half !== null ? ` and ${scaleWords(half)}× ${failWords(res.fails)}` : ''}`,
        detail: `${first.fails[0]?.detail ?? ''} WebAble changed the text once, tried one smaller size, and stopped.`.trim(),
        action: 'reversed',
      });
    }
    const op = activeTextMap();
    if (op && kind !== 'navigation') {
      const ms = Math.round(performance.now() - t0);
      const st = textMap.stats;
      const left = [st.skipped.icon ? `${st.skipped.icon} icons` : '', st.skipped.control ? `${st.skipped.control} form fields too short for bigger text` : '', st.skipped.hidden ? `${st.skipped.hidden} hidden labels` : ''].filter(Boolean).join(', ');
      log({
        source: op.source,
        title: op.title,
        detail: `${op.detail ?? ''} ${st.tokened} text elements${left ? ` (left as they are: ${left})` : ''}; checked in ${ms} ms.${remembered ? ' This is the size this site settled at earlier in this session.' : ''}`,
        action: 'applied',
        opId: op.rec.id,
      });
    }
    syncTextScale();
  }

  /** The page now scrolls sideways (the overflow check failed and the page is wider than its window). */
  function sideways(res: SizeStep): boolean {
    return res.fails.some((f) => f.name === 'overflow') && res.scrollW > res.viewW + 8;
  }

  /** The automatic column did not fit this site: it stays off here (remembered), instead of a try on every visit. */
  function noteColumnFailed(t: SizeTarget): void {
    if (t.mode !== 'auto' || !t.column) return;
    sitePrefs.columnFailed = Date.now();
    void saveSitePrefs({ columnFailed: sitePrefs.columnFailed });
  }

  /**
   * Text size and the page column for this page view: planned once, applied in one step and checked once. A failed
   * check falls back once and stops (the rare fallback that still fails goes back to the site's own size). The result
   * is kept for the session, so a reload or another page of the site applies it straight away. A same-document
   * navigation keeps the size as it is. Returns the plan and the zoom a check turned down, if any.
   */
  async function fitSize(gen: number, r: ReadResult, fit: FitProfile, zi: { factor: number; tab: number; personChanged: boolean }, kind: 'first' | 'navigation' | 'refit'): Promise<{ p: ZoomPlan; reversedAt: number | null }> {
    const kept = opsList.some((o) => (o.rec.kind === 'page_zoom' || o.rec.kind === 'column') && o.active);
    const own = kept && plan ? plan.ownZoom : zi.factor;
    if (kind === 'navigation' && plan) {
      // A new route of the same page view: zoom, column and text map stay exactly as they are.
      const p = { ...plan, bodyPx: r.pageBodyPx, textScale: textScaleNow(), effectiveBodyPx: effBody(r, plan.zoom) };
      plan = p;
      return { p, reversedAt: null };
    }
    let p = tailor.planZoom(fit, r.pageBodyPx, own, zi.personChanged, sitePrefs.textStep ?? 0);
    plan = p;
    if (undoneKinds.has('page_zoom') || store.get().showingOriginal) return { p, reversedAt: null };
    const largePrint = !!fit.text.largePrint;
    const settled = await loadSettled();
    if (gen !== generation) return { p, reversedAt: null };
    // Round 11: a narrow screen (a phone): the text map, never the zoom, makes text bigger there.
    const narrow = textScaleGate(screenWidth());
    let t: SizeTarget;
    let remembered = false;
    let rememberedScale: number | null = null;
    if (settled && settled.sig === sizeSig(fit) && !zi.personChanged) {
      // This site settled earlier in this session: its final size, with no trials.
      remembered = true;
      const z = settled.zoom > own + 0.005 ? settled.zoom : own;
      const lim = columnLimits(screenWidth());
      const col = settled.column && lim ? Math.min(lim.maxPx, Math.max(lim.minPx, settled.column)) : null;
      t = { zoom: z, column: col, mode: settled.mode };
      if (narrow && settled.textScale && settled.textScale > 1.001) rememberedScale = settled.textScale;
    } else {
      const wish = columnWish(p.zoom > own + 0.005);
      t = { zoom: p.zoom, column: columnWidthFor(p.zoom, wish), mode: wish?.mode ?? 'auto' };
    }
    // On a phone the page never gets narrower: zoom lays the page out at a narrower width (and the column is a narrower
    // window), which on a 390 px screen folds and squeezes the site. The page stays at the person's own zoom and full
    // width, and the text map carries the whole planned size.
    const wantZoom = t.zoom;
    if (narrow) t = { zoom: own, column: null, mode: t.mode };
    // A refit plans from the site's own text sizes: a text map from the last plan comes off first (the size the site
    // settled at keeps it as it is).
    if (activeTextMap() && !rememberedScale) await withLock(() => stepTextScale(r, null, { source: 'fit', zoom: t.zoom, wantZoom: t.zoom, check: false }));
    widthCap = null;
    const first = await withLock(() => stepSize(r, t, { source: p.step ? 'person' : 'fit', step: p.step }));
    if (gen !== generation || stopped) return { p, reversedAt: null };
    let final = t;
    let reversedAt: number | null = null;
    let res = first;
    if (narrow) widthCap = own;
    else if (first.ok && rememberedScale) widthCap = t.zoom;
    if (!first.ok && narrow && !t.column && sideways(first)) {
      // Round 11: the page can't get narrower on this screen. Not a linear guess: the largest zoom that gives the page
      // the width it measured, measured again there, at most WIDTH_TRIALS more steps; then the person's own zoom.
      const ladder = personZoomLadder(largePrint);
      const tried: number[] = [t.zoom];
      let cur = t;
      let trials = 0;
      while (!res.ok && trials < WIDTH_TRIALS && sideways(res)) {
        const z = widthLimitedZoom({ screenPx: res.viewW * cur.zoom, scrollW: res.scrollW, failedZoom: cur.zoom, own, ladder });
        if (z === null) break;
        const next: SizeTarget = { zoom: z, column: null, mode: t.mode };
        res = await withLock(() => stepSize(r, next, { source: 'check', step: p.step, base: first.base }));
        if (gen !== generation || stopped) return { p, reversedAt: null };
        trials++;
        tried.push(z);
        cur = next;
      }
      final = cur;
      if (!res.ok) {
        // Nothing above the person's own zoom fits: back to it, and the text map carries the size.
        if (Math.abs(cur.zoom - own) > 0.005) {
          await withLock(() => stepSize(r, { zoom: own, column: null, mode: t.mode }, { source: 'check', step: p.step, check: false }));
        }
        final = { zoom: own, column: null, mode: t.mode };
        res = { ...res, zoomOp: null, colOp: null };
      }
      widthCap = final.zoom;
      reversedAt = t.zoom;
      log({
        source: 'check',
        title: `Kept this page at ${pct(final.zoom)}: ${pct(t.zoom)} ${failWords(first.fails)}`,
        detail: `${first.fails[0]?.detail ?? ''} The page can’t get narrower than about ${Math.round(first.scrollW)} px on this phone, so WebAble measured the largest zoom it fits at (tried ${tried.map(pct).join(', ')}: ${trials} more size step${trials === 1 ? '' : 's'}) and makes the text bigger by itself instead.`.trim(),
        action: 'reversed',
      });
    } else if (!first.ok) {
      const fb = fallbackFor(t, first, largePrint);
      if (t.column) noteColumnFailed(t);
      const second = await withLock(() => stepSize(r, fb, { source: 'check', step: p.step, base: first.base }));
      if (gen !== generation || stopped) return { p, reversedAt: null };
      res = second;
      final = fb;
      if (!second.ok && Math.abs(fb.zoom - own) > 0.005) {
        // The fallback still broke the page: back to the site's own size, and it stays there this session.
        await withLock(() => stepSize(r, { zoom: own, column: null, mode: t.mode }, { source: 'check', step: p.step, check: false }));
        final = { zoom: own, column: null, mode: t.mode };
        res = { ...second, zoomOp: null, colOp: null };
      }
      if (final.zoom < t.zoom - 0.005) reversedAt = t.zoom;
      // On a phone a narrower layout that breaks (text over text, text cut off) caps the zoom just as a sideways scroll
      // does: the text map carries the rest of the size, under its own checks.
      if (narrow && !t.column && final.zoom < t.zoom - 0.005) widthCap = final.zoom;
      log({
        source: 'check',
        title: final.zoom < t.zoom - 0.005
          ? `Kept this page at ${pct(final.zoom)}: ${pct(t.zoom)}${t.column ? ' with the page column' : ''} ${failWords(first.fails)}`
          : `Kept this page at full width: the narrower page ${failWords(first.fails)}`,
        detail: `${first.fails[0]?.detail ?? ''} WebAble changed the size once and stopped; ${t.column && t.mode === 'auto' ? 'the column stays off on this site (Narrower in the WebAble panel tries it again)' : 'this size holds for this site until you change it'}.`.trim(),
        action: 'reversed',
      });
    }
    const zOp = res.zoomOp && res.zoomOp.active ? res.zoomOp : null;
    const zNow = zOp ? final.zoom : own;
    p = { ...p, zoom: zNow, textScale: textScaleNow(), effectiveBodyPx: effBody(r, zNow) };
    plan = p;
    if (zOp && kind !== 'navigation') {
      log({ source: zOp.source, title: zOp.title, detail: `${zOp.detail} Body text was measured at ${r.pageBodyPx} px (${r.body.source}).${remembered ? ' This is the size this site settled at earlier in this session.' : ''}`, action: 'applied', opId: zOp.rec.id });
    }
    const col = activeColumn();
    if (col && kind !== 'navigation') log({ source: col.source, title: col.title, detail: col.detail, action: 'applied', opId: col.rec.id });
    // Round 11: the width capped the zoom on a narrow screen: every text size × k, the rest of the way to the plan.
    if (narrow && widthCap !== null && !undoneKinds.has('text_map')) {
      const k = rememberedScale ?? planTextScale(wantZoom, zNow);
      if (k !== null) {
        await fitTextScale(gen, r, k, zNow, rememberedScale !== null ? zNow * rememberedScale : wantZoom, p.step ? 'person' : 'fit', kind, remembered);
        if (gen !== generation || stopped) return { p: plan ?? p, reversedAt };
        p = plan ?? p;
      }
    }
    rememberSize({ ...final, zoom: zNow });
    return { p, reversedAt };
  }

  /**
   * Text to `next` zoom (the person's A−/A+ or an accepted offer): the column is re-planned for the new size and both
   * change in one step. If the check fails, the column comes off when only the column broke the page; otherwise the
   * page goes back to the size it had.
   */
  async function textTo(r: ReadResult, next: number, source: LedgerEntry['source'], step: number): Promise<{ ok: boolean; zoomOp: Op | null; columnOff: boolean }> {
    const cur = sizeNow();
    const own = ownZoom();
    // A narrow screen (a phone): the page stays at full width and the text map carries the size.
    if (textScaleGate(screenWidth()) && !cur.column) return textToNarrow(r, next, source, step);
    const wish = columnWish(next > own + 0.005);
    const t: SizeTarget = { zoom: next, column: columnWidthFor(next, wish), mode: wish?.mode ?? 'auto' };
    const res = await withLock(() => stepSize(r, t, { source, step }));
    const finish = (to: SizeTarget, op: Op | null, columnOff: boolean) => {
      if (plan) plan = { ...plan, zoom: to.zoom, step, effectiveBodyPx: effBody(r, to.zoom) };
      return { ok: true, zoomOp: op && op.active ? op : null, columnOff };
    };
    if (res.ok) return finish(t, res.zoomOp, false);
    if (!t.column && next > cur.zoom + 0.005 && textScaleGate(screenWidth()) && sideways(res) && !undoneKinds.has('text_map')) {
      // The page can't get narrower on this phone: it stays at the zoom it has, and the text map goes the rest of the way.
      await withLock(() => stepSize(r, cur, { source: 'check', step: plan?.step ?? 0, check: false }));
      widthCap = cur.zoom;
      return textToNarrow(r, next, source, step);
    }
    // The person asked for this size: with the column on, the size stays and the column comes off (when the page can
    // take the size at full width); otherwise the page goes back as it was.
    const fb = res.colOp ? fallbackFor(t, res, !!getFit()?.text.largePrint) : null;
    if (fb && Math.abs(fb.zoom - next) < 0.005) {
      noteColumnFailed(t);
      const res2 = await withLock(() => stepSize(r, fb, { source, step, base: res.base }));
      if (res2.ok) return finish(fb, res2.zoomOp, true);
    }
    await withLock(() => stepSize(r, cur, { source: 'check', step: plan?.step ?? 0, check: false }));
    log({ source: 'check', title: `Kept the page as it was: ${pct(next)} ${failWords(res.fails)}`, detail: res.fails[0]?.detail ?? '', action: 'reversed' });
    return { ok: false, zoomOp: null, columnOff: false };
  }

  /**
   * Round 11: text to `next` (a size on the zoom ladder) on a narrow screen: the page stays at the person's own zoom
   * (a phone never gets a narrower page) and every text size × next ÷ own. Each part is checked; a failure puts the
   * page back to the size it had. The returned op is the one that carries the size (the text map when it is on).
   */
  async function textToNarrow(r: ReadResult, next: number, source: LedgerEntry['source'], step: number): Promise<{ ok: boolean; zoomOp: Op | null; columnOff: boolean }> {
    const cur = sizeNow();
    const curK = textScaleNow();
    const own = ownZoom();
    const cap = own;
    const zoom = own;
    const k = next > cap + 0.005 && !undoneKinds.has('text_map') ? planTextScale(next, cap) : null;
    const restore = async (fails: CheckResult[], what: string) => {
      await withLock(() => stepTextScale(r, null, { source: 'check', zoom: cur.zoom, wantZoom: cur.zoom, check: false }));
      await withLock(() => stepSize(r, cur, { source: 'check', step: plan?.step ?? 0, check: false }));
      if (curK > 1.001) await withLock(() => stepTextScale(r, curK, { source: 'check', zoom: cur.zoom, wantZoom: cur.zoom * curK, check: false }));
      log({ source: 'check', title: `Kept the page as it was: ${what} ${failWords(fails)}`, detail: fails[0]?.detail ?? '', action: 'reversed' });
      return { ok: false, zoomOp: null, columnOff: false };
    };
    if (Math.abs(zoom - cur.zoom) > 0.005) {
      // The zoom moves (below the cap): the text map comes off first, so the zoom is checked on the site's own sizes.
      if (curK > 1.001) await withLock(() => stepTextScale(r, null, { source, zoom: cur.zoom, wantZoom: cur.zoom, check: false }));
      const res = await withLock(() => stepSize(r, { zoom, column: null, mode: cur.mode }, { source, step }));
      if (!res.ok) return restore(res.fails, pct(zoom));
    }
    if (k !== null) {
      const res = await withLock(() => stepTextScale(r, k, { source, zoom, wantZoom: next }));
      if (!res.ok) {
        // The one smaller try (as when the page was fitted); taken only when it is still a step the person asked for.
        const kb = textFallback(res, k);
        const further = kb !== null && (next > cur.zoom * curK ? kb > curK + 0.005 || Math.abs(zoom - cur.zoom) > 0.005 : true);
        const res2 = kb !== null && further ? await withLock(() => stepTextScale(r, kb, { source: 'check', zoom, wantZoom: next, base: res.base })) : null;
        if (!res2?.ok) return restore(res.fails, `text ${scaleWords(k)}× bigger`);
      }
    } else if (textScaleNow() > 1.001) await withLock(() => stepTextScale(r, null, { source, zoom, wantZoom: next, check: false }));
    if (plan) plan = { ...plan, zoom, step, textScale: textScaleNow(), effectiveBodyPx: effBody(r, zoom) };
    syncTextScale();
    const carrier = activeTextMap() ?? opsList.find((o) => o.rec.kind === 'page_zoom' && o.active) ?? null;
    return { ok: true, zoomOp: carrier, columnOff: false };
  }

  /** Follow a window resize: keep the column's planned width for the new window (a zoom change alone does nothing). */
  function reflowColumn(): void {
    const op = activeColumn();
    if (op) {
      const zoom = textZoomNow();
      const sw = screenWidth();
      // The window did not change size (a zoom change's own resize, rounding): the column stays as it is.
      if (Math.abs(windowW() - columnWin) < 24) {
        syncOps();
        return;
      }
      const lim = columnLimits(sw);
      let w: number;
      if (!lim) w = Math.round(sw);
      else if (op.spec.mode === 'auto') w = columnWidthFor(zoom, { mode: 'auto', fixedPx: null }) ?? op.spec.widthPx;
      else {
        const want = typeof sitePrefs.column === 'number' ? sitePrefs.column : op.spec.widthPx;
        w = Math.min(lim.maxPx, Math.max(lim.minPx, want));
      }
      columnWin = windowW();
      if (w !== op.spec.widthPx || Math.abs(zoom - op.spec.zoom) > 0.001) op.setWidth(w, zoom);
    }
    syncOps();
  }

  /**
   * Back to a page kept in the back/forward cache: the navigation reset the tab's per-tab zoom while the page kept
   * WebAble's styles (the page column's zoomed body among them). Put back the zoom WebAble last set.
   */
  const onPageShow = (e: PageTransitionEvent) => {
    if (!e.persisted || stopped || lastTabZoom === null || store.get().showingOriginal) return;
    const want = lastTabZoom;
    void zoomInfo().then(async (zi) => {
      if (Math.abs(zi.tab - want) <= 0.005) return;
      const got = await ask<number>({ type: 'setZoom', factor: want }).catch(() => undefined);
      setZoomState(realTab(got, want));
    });
  };

  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const onResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      // A size step's own resize: the step sets the state itself.
      if (stopped || sizing > 0 || Date.now() - sizedAt < 700) return;
      void zoomInfo().then(async (zi) => {
        if (sizing > 0 || Date.now() - sizedAt < 700) return;
        // The person's own Ctrl +/− while the column is on: Chrome stepped the tab's (column-raised) zoom; take one
        // step along the text sizes instead, so the page column keeps its width and the steps feel like Chrome's.
        if (colMul > 1.001 && lastTabZoom !== null && Math.abs(zi.tab - lastTabZoom) > 0.005 && activeColumn()) {
          const prevText = lastTabZoom / colMul;
          const next = Math.abs(zi.tab - 1) < 0.005 ? 1 : stepZoom(prevText, zi.tab > lastTabZoom ? 1 : -1, !!getFit()?.text.largePrint);
          await setTextZoom(next).catch(() => undefined);
        } else setZoomState(zi.tab);
        reflowColumn();
      });
    }, 160);
  };

  /** A−/A+: one Chrome zoom preset smaller or larger, with the column, in one step; remembered for this site. */
  async function adjustText(dir: -1 | 1): Promise<void> {
    // Round 8: on the simplified page, text size sizes the simplified page (drawn at the fit's size, whatever the zoom).
    if (store.get().calm.open) {
      const next = Math.max(CALM_STEP_MIN, Math.min(CALM_STEP_MAX, calmTextStep + dir));
      if (next === calmTextStep) {
        toast(dir > 0 ? 'Text is as large as WebAble makes it' : 'Text is as small as it goes');
        return;
      }
      calmTextStep = next;
      store.set((st) => ({ calm: { ...st.calm, textStep: next } }));
      log({ source: 'person', title: `Made the text ${dir > 0 ? 'bigger' : 'smaller'}`, action: 'applied' });
      return;
    }
    const fit = getFit();
    const r = read;
    if (!fit || !r || store.get().showingOriginal) return;
    const cur = sizeNow();
    const largePrint = !!fit.text.largePrint;
    // Round 11: with the text map on (a phone whose width capped the zoom), the steps move the size the person sees.
    const k0 = textScaleNow();
    const shownZoom = cur.zoom * k0;
    const next = stepZoom(shownZoom, dir, largePrint);
    const atMax = dir > 0 && k0 >= TEXT_SCALE_MAX - 0.005;
    if (Math.abs(next - shownZoom) < 0.005 || atMax) {
      toast(dir > 0 ? 'Text is as large as WebAble makes it' : 'Text is as small as it goes');
      return;
    }
    const ladder = personZoomLadder(largePrint);
    const idx = (z: number) => ladder.findIndex((x) => Math.abs(x - nearestPreset(z)) < 1e-6);
    const step = idx(next) - idx(plan?.fitZoom ?? cur.zoom);
    const res = await textTo(r, next, 'person', step);
    if (!res.ok) {
      toast('That text size did not fit this page, so it stayed as it was');
      return;
    }
    sitePrefs.textStep = step;
    void saveSitePrefs({ textStep: step });
    store.set({ textStep: step });
    rememberSize(sizeNow());
    // Round 4: the person's own size choice on this site is evidence about their comfortable text size.
    passiveObs.noteSize(next, 'step', dir);
    const k1 = textScaleNow();
    const z1 = sizeNow().zoom;
    log({
      source: 'person',
      title: k1 > 1.001
        ? `Text ${dir > 0 ? 'larger' : 'smaller'}: page zoom ${pct(z1)}, text ${scaleWords(k1)}× the site’s own`
        : `Text ${dir > 0 ? 'larger' : 'smaller'}: page zoom ${pct(z1)}`,
      detail: `Body text is ${Math.round(r.pageBodyPx * z1 * k1)} px here.${k1 > 1.001 ? ' The page can’t get narrower on this phone, so the text grows by itself past that zoom.' : ''}${res.columnOff ? ' The narrower page did not fit at this size, so it is at full width.' : ''} WebAble remembers this for ${siteKey()}.`,
      action: 'applied',
      ...(res.zoomOp ? { opId: res.zoomOp.rec.id } : {}),
    });
  }

  /** Page width: Narrower, Wider, back to automatic, or full width. One step, checked, remembered for this site. */
  async function adjustColumn(step: -1 | 0 | 1 | 'off'): Promise<void> {
    const r = read;
    if (!r || store.get().showingOriginal) return;
    const cur = sizeNow();
    const curStep = plan?.step ?? 0;
    if (step === 'off') {
      sitePrefs.column = 'off';
      void saveSitePrefs({ column: 'off' });
      if (cur.column) await withLock(() => stepSize(r, { ...cur, column: null }, { source: 'person', step: curStep, check: false }));
      rememberSize(sizeNow());
      syncOps();
      log({ source: 'person', title: `Showing ${siteKey()} at full width`, detail: 'Narrower in the WebAble panel brings the column back.', action: 'reversed' });
      return;
    }
    if (step === 0) {
      delete sitePrefs.column;
      delete sitePrefs.columnFailed;
      void saveSitePrefs({ column: undefined, columnFailed: undefined });
      const wish = columnWish(cur.zoom > ownZoom() + 0.005);
      const t: SizeTarget = { zoom: cur.zoom, column: columnWidthFor(cur.zoom, wish), mode: 'auto' };
      const res = await withLock(() => stepSize(r, t, { source: 'person', step: curStep }));
      if (!res.ok) {
        await withLock(() => stepSize(r, { ...cur, column: null }, { source: 'check', step: curStep, check: false }));
        log({ source: 'check', title: `Kept this page at full width: the narrower page ${failWords(res.fails)}`, detail: res.fails[0]?.detail ?? '', action: 'reversed' });
      } else if (!activeColumn()) log({ source: 'person', title: 'Page width is automatic: this page stays full width', action: 'kept' });
      else {
        const col = activeColumn();
        if (col) log({ source: 'person', title: col.title, detail: col.detail, action: 'applied', opId: col.rec.id });
      }
      rememberSize(sizeNow());
      return;
    }
    const zoom = cur.zoom;
    const sw = screenWidth();
    const lim = columnLimits(sw);
    if (!lim) {
      toast('This window is too narrow for a narrower page');
      return;
    }
    let target: number | null;
    if (!cur.column) {
      if (step === 1) {
        toast('The page is already at full width');
        return;
      }
      target = planColumn({ screenW: sw, zoom, charPx: r.body.charPx })?.widthPx ?? lim.maxPx;
      if (target >= lim.maxPx) target = stepColumn(lim.maxPx, -1, sw);
    } else {
      target = stepColumn(cur.column, step, sw);
      if (target === cur.column) {
        toast(step > 0 ? 'This is the widest column; Full width shows the whole page' : 'This is the narrowest the column goes');
        return;
      }
    }
    if (target === null) return;
    const res = await withLock(() => stepSize(r, { zoom, column: target, mode: 'person' }, { source: 'person', step: curStep }));
    if (res.ok && res.colOp) {
      sitePrefs.column = target;
      delete sitePrefs.columnFailed;
      void saveSitePrefs({ column: target, columnFailed: undefined });
      rememberSize(sizeNow());
      log({ source: 'person', title: res.colOp.title, detail: `WebAble remembers this width for ${siteKey()}.`, action: 'applied', opId: res.colOp.rec.id });
    } else {
      await withLock(() => stepSize(r, cur, { source: 'check', step: curStep, check: false }));
      toast('That width did not fit this page, so it stayed as it was');
      log({ source: 'check', title: `Kept the page as it was: a ${target} px column did not fit`, detail: res.fails[0]?.detail ?? '', action: 'reversed' });
    }
    syncOps();
  }

  /* ---------------- the passive fit (round 4): learns the need, never the cause ---------------- */

  const passiveObs = new PassiveObserver({
    ask: <T,>(req: BgRequest, timeoutMs?: number) => ask<T>(req, timeoutMs),
    bodyPx: () => read?.pageBodyPx ?? null,
    textZoom: (tab) => Math.round((tab / colMul) * 10000) / 10000,
    zooms: () => ({ fit: plan?.zoom ?? textZoomNow(), own: plan?.ownZoom ?? textZoomNow() }),
    pageKind: () => read?.pageKind ?? 'web page',
    isOurUi: safeOurs,
    confounded: (dim) => {
      const k = PASSIVE_OP[dim];
      return !!k && k !== 'page_zoom' && opsList.some((o) => o.rec.kind === k && o.active);
    },
    // The background also publishes the state; this page keeps its fit until its next page (plain evidence).
    onState: (s) => store.set({ passive: s }),
  });

  function startPassive(): void {
    passiveObs.start();
    if (!stopMedia) {
      stopMedia = watchMedia(() => {
        // The person changed a system preference (Reduce motion, Increase contrast): tell the background.
        const req = { type: 'getPassive' as const, media: readMediaFacts() };
        void ask<PassiveFitState>(req, 4000).catch(() => undefined);
      });
    }
  }

  function stopPassive(): void {
    passiveObs.stop();
    stopMedia?.();
    stopMedia = null;
  }

  /**
   * Take a new passive state.
   *  - 'refit': the person changed something (here, in another tab, in the popup or in Chrome): when the fit this page
   *    should have is different, fit the page again.
   *  - 'apply': the caller applies the change on this page itself (an accepted offer): the new fit is taken now.
   *  - 'keep': plain evidence from browsing; this page keeps its fit until its next page.
   */
  function adoptPassive(next: PassiveFitState, mode: 'refit' | 'apply' | 'keep'): void {
    let newFit: FitProfile;
    try {
      newFit = effectiveFit(baseFit, next);
    } catch {
      store.set({ passive: next });
      return;
    }
    const changed = fitSignature(newFit) !== fitSignature(store.get().fit);
    if (!changed) store.set({ passive: next, fit: newFit });
    else if (mode === 'apply') store.set({ passive: next, fit: newFit });
    else if (mode === 'refit') {
      store.set({ passive: next });
      scheduleRefit();
    } else store.set({ passive: next });
  }

  /** The ledger says where this page's fit came from when it was not (only) the warm-up. */
  function logPassiveSources(fit: FitProfile, base: FitProfile | null, passive: PassiveFitState | null): void {
    if (!passive) return;
    let sources: ReturnType<typeof effectiveFitSources>;
    try {
      sources = effectiveFitSources(base, passive);
    } catch {
      return;
    }
    const lines: string[] = [];
    for (const [dim, src] of Object.entries(sources) as Array<[FitDimension, DimensionBelief['source']]>) {
      if (src !== 'setting' && src !== 'learned' && src !== 'person') continue;
      const b = passive.beliefs[dim];
      if (b?.explanation && b.action === 'apply') lines.push(b.explanation);
    }
    if (!base && !lines.length) {
      log({ source: 'fit', title: 'No warm-up yet: WebAble fits pages from your browser settings and learns from what you do', detail: 'Nothing about you is needed to start. The 70-second warm-up is in the WebAble menu.', action: 'kept' });
      return;
    }
    if (!base) log({ source: 'fit', title: 'No warm-up yet: fitting from your browser settings and what WebAble learned', detail: `Text ${Math.round(fit.text.override ?? fit.text.bodyPx)} px${fit.targets.minPx ? `, click areas ${fit.targets.minPx} px` : ''}${fit.attention.motion.on ? ', motion paused' : ''}.`, action: 'kept' });
    for (const line of lines) log({ source: 'fit', title: line, detail: 'Learned on this laptop from what you did and what you chose. WebAble keeps what happened, never why.', action: 'kept' });
  }

  /** Run `fn` once this tab is in view (now, if it is): announcements and offers only on the page the person sees. */
  function whenVisible(gen: number, fn: () => void): void {
    if (document.visibilityState === 'visible') {
      fn();
      return;
    }
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVis);
      if (gen === generation && !stopped) fn();
    };
    document.addEventListener('visibilitychange', onVis);
  }

  /**
   * A need WebAble learned and now applies by default: its Undo here also tells WebAble it was wrong, and the first
   * page where it does something says so once, in the person's own actions, with Undo ("Text is larger because you
   * zoomed in on 4 sites this week (average 135%).").
   */
  function announceLearned(gen: number): void {
    const s = store.get();
    const passive = s.passive;
    if (!passive || s.showingOriginal || gen !== generation) return;
    let sources: ReturnType<typeof effectiveFitSources>;
    try {
      sources = effectiveFitSources(baseFit, passive);
    } catch {
      return;
    }
    const due: Array<{ dim: FitDimension; text: string; opId: string }> = [];
    for (const [dim, kind] of Object.entries(PASSIVE_OP) as Array<[FitDimension, OpKind]>) {
      if (sources[dim] !== 'learned') continue;
      const b = passive.beliefs[dim];
      if (!b || b.action !== 'apply') continue;
      const op = opsList.find((o) => o.rec.kind === kind && o.active);
      if (!op) continue; // this page did not need it: it is announced on a page where it does something
      passiveUndo.set(op.rec.id, dim);
      due.push({ dim, text: b.explanation, opId: op.rec.id });
    }
    if (!due.length) return;
    whenVisible(gen, () => {
      void (async () => {
        const seen = await loadLocal<Record<string, string>>(PASSIVE_SEEN_KEY, {});
        let changed = false;
        for (const d of due) {
          if (seen[d.dim] || gen !== generation || store.get().showingOriginal) continue;
          if (!opsList.some((o) => o.rec.id === d.opId && o.active)) continue;
          seen[d.dim] = new Date().toISOString();
          changed = true;
          toast(d.text, d.opId);
        }
        if (changed) await saveLocal(PASSIVE_SEEN_KEY, seen);
      })();
    });
  }

  /** Offer (or ask about) one learned need, a moment after the page is fitted and in view, at most once a page. */
  function schedulePassiveOffer(gen: number): void {
    if (passiveTimer) clearTimeout(passiveTimer);
    passiveTimer = null;
    whenVisible(gen, () => {
      if (passiveTimer) clearTimeout(passiveTimer);
      passiveTimer = setTimeout(() => {
        passiveTimer = null;
        if (gen === generation && !stopped) void maybePassiveOffer(gen);
      }, 1500);
    });
  }

  async function maybePassiveOffer(gen: number): Promise<void> {
    const s = store.get();
    const passive = s.passive;
    if (!passive || s.struggle.offers.length || s.calm.open || s.showingOriginal || passiveOffers.size || s.phase === 'idle') return;
    const mem = await loadLocal<PassiveOfferMemory>(PASSIVE_OFFERS_KEY, {});
    const now = Date.now();
    const picks: Array<{ b: DimensionBelief; offer: Offer }> = [];
    for (const dim of Object.keys(PASSIVE_OP) as FitDimension[]) {
      const b = passive.beliefs[dim];
      if (!b || b.source !== 'learned' || (b.action !== 'offer' && b.action !== 'ask')) continue;
      const m = mem[dim] ?? {};
      if ((m.snoozedUntil ?? 0) > now) continue;
      if (b.action === 'offer' && now - (m.shownAt ?? 0) < PASSIVE_OFFER_GAP_MS) continue;
      if (b.action === 'ask') {
        if (now - (m.askedAt ?? 0) < PASSIVE_ASK_EVERY_MS) continue;
        // A question waits for the need to show on a second site (or in an earlier session): one zoom on one site is
        // not asked about, so the weekly question is not spent before the evidence repeats.
        if (b.sites < 2 && !b.evidence.some((e) => e.weight > 0 && e.layer === 'usual')) continue;
      }
      const offer = passiveOffer(b);
      if (offer) picks.push({ b, offer });
    }
    if (!picks.length) return;
    picks.sort((x, y) => (x.b.action === y.b.action ? y.b.p - x.b.p : x.b.action === 'offer' ? -1 : 1));
    const { b, offer } = picks[0] as { b: DimensionBelief; offer: Offer };
    const cur = store.get();
    if (gen !== generation || stopped || cur.struggle.offers.length || cur.calm.open || cur.showingOriginal) return;
    passiveOffers.set(offer.kind, { dim: b.dim, action: b.action === 'ask' ? 'ask' : 'offer', question: offer.question });
    store.set({ struggle: { ...cur.struggle, offers: [offer] } });
    log({ source: 'signals', title: `Offered: ${offer.question}`, detail: `${offer.fact} Learned on this laptop from what you did.`, p: offer.p, action: 'offered' });
    mem[b.dim] = { ...(mem[b.dim] ?? {}), ...(b.action === 'ask' ? { askedAt: now } : { shownAt: now }) };
    await saveLocal(PASSIVE_OFFERS_KEY, mem);
  }

  /** "Make text larger on every site?" → yes: lock the need, fit this page now (with Undo), other pages follow. */
  async function acceptPassive(kind: OfferKind, meta: PassiveOfferMeta, offer: Offer | undefined): Promise<void> {
    const { dim } = meta;
    log({ source: 'person', title: `You accepted: ${offer?.question ?? kind}`, action: 'applied' });
    // This page applies the change itself (storage echoes never refit a page, round 6).
    let next: PassiveFitState | null = null;
    try {
      next = await ask<PassiveFitState>({ type: 'passiveFeedback', dim, action: 'confirm' }, 5000);
    } catch (err) {
      toast('WebAble could not save that choice. Try again from the WebAble panel.');
      addError(plainError(err));
      return;
    }
    if (next && next.v === 'passive.1') adoptPassive(next, 'apply');
    const mem = await loadLocal<PassiveOfferMemory>(PASSIVE_OFFERS_KEY, {});
    delete mem[dim];
    void saveLocal(PASSIVE_OFFERS_KEY, mem);
    const fit = getFit() ?? effectiveFit(baseFit, store.get().passive);
    const r = read;
    if (!r || store.get().showingOriginal) {
      toast(PASSIVE_DONE[dim] ?? 'Done');
      return;
    }
    let op: Op | null = null;
    if (dim === 'text_size') {
      const zi = await zoomInfo();
      const own = plan?.ownZoom ?? zi.factor;
      const want = tailor.planZoom(fit, r.pageBodyPx, own, false, 0);
      if (plan) plan = { ...plan, targetPx: want.targetPx, fitZoom: want.fitZoom, capped: want.capped, shortPx: want.shortPx };
      if (want.zoom > zi.factor + 0.005) {
        // As A+ does: text size and column in one step, checked once.
        const res = await textTo(r, want.zoom, 'fit', 0);
        if (res.ok && res.zoomOp) {
          op = res.zoomOp;
          rememberSize(sizeNow());
        }
      }
      if (!op) {
        const shown = Math.round(r.pageBodyPx * zi.factor);
        toast(want.zoom > zi.factor + 0.005
          ? `${PASSIVE_DONE[dim]}. On this page a larger size did not fit, so it stayed as it was`
          : `${PASSIVE_DONE[dim]}. This page already shows text at about ${shown} px`);
        return;
      }
      op.title = `Zoomed this page to ${pct(want.zoom)} for larger text on every site`;
    } else if (dim === 'targets') {
      const superseded = opsList.filter((o) => o.rec.kind === 'targets' && o.active);
      for (const o of superseded) {
        await revertOp(o);
        o.rec.status = 'reversed';
      }
      const t = tailor.targetsOp(Math.max(PASSIVE_TARGETS_PX, fit.targets.minPx ?? PASSIVE_TARGETS_PX), r, 'fit');
      const kept = t ? await applyBatch([t], r) : [];
      if (!t || !kept.includes(t)) {
        for (const o of superseded) {
          try {
            await o.apply();
            o.rec.status = 'applied';
          } catch (e) {
            addError(plainError(e));
          }
        }
        syncOps();
        toast(t
          ? `${PASSIVE_DONE[dim]}. On this page bigger areas did not fit, so it stayed as it was`
          : `${PASSIVE_DONE[dim]}. The buttons on this page are already large enough`);
        return;
      }
      op = t;
      tailor.flashTargets(t.elements, 800);
    } else if (dim === 'steady_clicks') {
      if (!opsList.some((o) => o.rec.kind === 'steady_clicks' && o.active)) {
        const s = tailor.steadyOp(fit.clicks.steady.windowMs ?? 300, fit.clicks.steady.radiusPx ?? 10);
        s.source = 'fit';
        const kept = await applyBatch([s], r);
        if (kept.includes(s)) op = s;
      }
    }
    if (!op) {
      toast(PASSIVE_DONE[dim] ?? 'Done');
      return;
    }
    passiveUndo.set(op.rec.id, dim);
    const px = dim === 'text_size' ? fit.text.override ?? fit.text.bodyPx : dim === 'targets' ? fit.targets.minPx : null;
    const done = `${PASSIVE_DONE[dim] ?? op.title}${px ? ` (${Math.round(px)} px)` : ''}`;
    log({ source: 'person', title: done, detail: `${op.title}. You chose this for every site; Undo here, or "Not right" in the WebAble panel, turns it off.`, action: 'applied', opId: op.rec.id });
    toast(done, op.rec.id);
  }

  /** "Not now" waits a day (a question, a week); "Don't suggest this" counts as "Not right" (an offer) or "no" (a question). */
  function dismissPassive(kind: OfferKind, meta: PassiveOfferMeta, forever: boolean): void {
    passiveOffers.delete(kind);
    const { dim } = meta;
    void (async () => {
      const mem = await loadLocal<PassiveOfferMemory>(PASSIVE_OFFERS_KEY, {});
      const wait = forever ? PASSIVE_NEVER_MS : meta.action === 'ask' ? PASSIVE_ASK_EVERY_MS : PASSIVE_NOT_NOW_MS;
      mem[dim] = { ...(mem[dim] ?? {}), snoozedUntil: Date.now() + wait };
      await saveLocal(PASSIVE_OFFERS_KEY, mem);
      if (!forever) return;
      if (meta.action === 'ask') {
        passiveObs.noteNo(dim);
        return;
      }
      try {
        const next = await ask<PassiveFitState>({ type: 'passiveFeedback', dim, action: 'not_right' }, 5000);
        if (next && next.v === 'passive.1') adoptPassive(next, 'keep');
      } catch {
        /* the snooze still holds */
      }
    })();
    log({ source: 'person', title: forever ? `You said no: WebAble will not suggest ${PASSIVE_NOUN[dim] ?? 'this'} again` : 'Not now: WebAble will ask again another day', action: 'skipped' });
  }

  /** The panel's "Not right" / "Forget this" (and "That's right"): this page and every open page follow. */
  async function passiveFeedbackNow(dim: FitDimension, action: 'not_right' | 'forget' | 'confirm'): Promise<void> {
    const before = store.get().passive?.beliefs[dim] ?? null;
    // This page refits from the answer below (storage echoes never refit a page, round 6).
    const next = await ask<PassiveFitState>({ type: 'passiveFeedback', dim, action }, 5000);
    const noun = PASSIVE_NOUN[dim] ?? before?.explanation ?? dim.replace(/_/g, ' ');
    const title = action === 'confirm' ? `You confirmed: ${noun}` : action === 'forget' ? `You asked WebAble to forget: ${noun}` : `You said this was not right: ${noun}`;
    log({ source: 'person', title, detail: before?.explanation ?? '', action: action === 'confirm' ? 'kept' : 'reversed' });
    if (next && next.v === 'passive.1') adoptPassive(next, 'refit');
    // An offer for this need on screen is answered.
    const s = store.get();
    const offerKind = PASSIVE_OFFER_KIND[dim];
    if (offerKind && passiveOffers.has(offerKind)) {
      passiveOffers.delete(offerKind);
      store.set({ struggle: { ...s.struggle, offers: s.struggle.offers.filter((o) => o.kind !== offerKind) } });
    }
  }

  /** The person undid a change that came from what WebAble learned or a choice they made in an offer: −3, lock released. */
  function notePassiveUndo(opId: string): void {
    const dim = passiveUndo.get(opId);
    if (!dim) return;
    passiveUndo.delete(opId);
    passiveObs.noteUndo(dim, PASSIVE_NOUN[dim] ?? 'the change');
    log({ source: 'person', title: `WebAble noted that ${PASSIVE_NOUN[dim] ?? 'this'} did not help`, detail: 'Learned needs drop sharply after an Undo; other pages follow on their next fit.', action: 'reversed' });
  }

  let refitTimer: ReturnType<typeof setTimeout> | null = null;
  /** Fit this page again from scratch (debounced): the fit, the settings or what WebAble learned changed. */
  function scheduleRefit(delayMs = 150): void {
    if (refitTimer) clearTimeout(refitTimer);
    refitTimer = setTimeout(() => {
      refitTimer = null;
      if (stopped) return;
      void (async () => {
        const c = store.get().calm;
        if (c.open) reopenAfterRefit = c.auto ? 'auto' : 'person';
        await teardownPage(true, true);
        errors = [];
        store.set({ ledger: [], startedAt: performance.now(), phase: 'idle' });
        await boot('refit');
      })();
    }, delayMs);
  }

  async function boot(kind: 'first' | 'navigation' | 'refit'): Promise<void> {
    const gen = ++generation;
    if (kind === 'navigation') {
      // A new page: the click that led here was on the last one.
      pageAt = performance.now();
      autoOpenedHere = false;
    }
    if (kind !== 'refit') autoDecided = false;
    if (kind === 'first') {
      await waitForVisible();
      await waitForLoad(1500);
      await waitForQuiet(400, 2000);
    }
    if (gen !== generation || stopped) return;
    if (kind === 'first') await askExt<unknown>({ type: 'pageStart' }).catch(() => undefined);
    if (kind !== 'navigation') void refreshHealth();
    const { settings, fit, base, passive } = await loadSettingsAndFit();
    if (gen !== generation || stopped) return;
    baseFit = base;
    store.set((s) => ({ settings, fit, passive, lens: kind === 'first' ? { on: settings.lens } : s.lens, startedAt: kind === 'navigation' ? performance.now() : s.startedAt }));

    if (!settings.enabled || pausedHere(settings)) {
      // A refit keeps the size ops in place; turned off or paused, the page goes back to the site's own size.
      if (opsList.length) {
        await revertAll(opsList);
        for (const op of opsList) if (op.rec.status === 'applied') op.rec.status = 'reversed';
        opsList = [];
        plan = null;
        syncOps();
      }
      store.set({ phase: 'idle' });
      stopPassive();
      reword.reset();
      composer.reset();
      if (!settings.enabled) log({ source: 'person', title: 'WebAble is turned off', action: 'skipped' });
      else log({ source: 'person', title: 'WebAble is paused on this site', action: 'skipped' });
      return;
    }
    startPassive();
    if (kind !== 'navigation') logPassiveSources(fit, base, passive);

    try {
      store.set({ phase: 'reading' });
      resetBackgroundCache();
      const r = readPage();
      read = r;
      store.set({ digest: r.digest, outline: r.outline });
      log({
        source: 'fit',
        title: `Read the page: ${r.outline.nodes.length} items in ${Math.max(1, Math.round(r.stats.ms))} ms`,
        detail: `${r.digest.elements.length} of them go to Jev as structure only (role, size, position, redacted labels; no page text).${r.sensitive ? ' This page has password or payment fields, so no generative AI sees it.' : ''}`,
        action: 'kept',
      });

      // 1–2. Text zoom and the page column: planned once, applied in one step, checked once, one fallback at most
      //      (round 6). Kept across same-document navigations; the site's settled size is kept for the session.
      const zi = await zoomInfo();
      if (gen !== generation) return;
      sitePrefs = await loadSitePrefs();
      if (gen !== generation) return;
      if (!!sitePrefs.original !== !!store.get().calm.originalPinned) store.set((st) => ({ calm: { ...st.calm, originalPinned: !!sitePrefs.original } }));
      const hadSize = opsList.some((o) => (o.rec.kind === 'page_zoom' || o.rec.kind === 'column') && o.active);
      if (!hadSize) setZoomState(zi.tab);
      const sized = await fitSize(gen, r, fit, zi, kind);
      if (gen !== generation) return;
      const p = sized.p;
      store.set({ textStep: p.step });
      // The text map (round 11) also made the text bigger: then the page did not keep its own size.
      const zoomOp = opsList.find((o) => (o.rec.kind === 'page_zoom' || o.rec.kind === 'text_map') && o.active);
      if (zi.factor > 1.001 && !zoomOp && kind === 'first') {
        log({ source: 'fit', title: `Kept your own zoom (${pct(zi.factor)})`, action: 'kept' });
      } else if (!zoomOp && kind === 'first' && !undoneKinds.has('page_zoom')) {
        // Say why the page kept its own size, so a page that did not grow is never a silent miss.
        const measured = `Body text here measures ${r.pageBodyPx} px (${r.body.source}); your size is ${Math.round(p.targetPx)} px.`;
        log(sized.reversedAt
          ? { source: 'check', title: `Kept this page at its own size: a ${pct(sized.reversedAt)} zoom failed a check`, detail: measured, action: 'reversed' }
          : {
              source: 'fit',
              title: 'Kept this page at its own size',
              detail: fit.text.source === 'default' && fit.text.override == null
                ? 'Your fit keeps each site’s own text size.'
                : `${measured} ${r.pageBodyPx >= p.targetPx ? 'That is already at least your size.' : 'That is close enough that zooming would change little.'}`,
              action: 'kept',
            });
      }
      if (kind !== 'navigation') noteSizeShortfall(p);

      // 3. Fit ops (planned after zoom and column so boxes are current), one write phase, verified.
      const fitOps = tailor.planFitOps(fit, r, { column: !!activeColumn() }).filter((o) => {
        if (undoneKinds.has(o.rec.kind)) return false;
        // Persistent behaviour ops that are already running stay as they are.
        if (o.persistent && opsList.some((x) => x.rec.kind === o.rec.kind && x.rec.status === 'applied')) return false;
        return true;
      });
      await applyBatch(fitOps, r, { wide: true });
      if (gen !== generation) return;

      // 4. Headings: raise weak ones to the minimum ramp (verified; a heading that does not fit keeps its size).
      if (!undoneKinds.has('heading_scale')) {
        // Planned on the site's own sizes (the text map lifted); the map then multiplies the raised headings too.
        const hs = textMap.suspend(() => tailor.headingScaleOp(r, liveBodyPx(r)));
        if (hs) await applyBatch([hs], r, { wide: true });
        if (gen !== generation) return;
      }
      watchCarousels(gen, r);
      store.set({ phase: 'tailored' });
      // Round 9: paragraphs fitted to the person, alongside Jev's read. A refit keeps the rewrites as they are (it
      // starts them only when there are none, after WebAble was turned back on).
      const last = kind === 'refit' ? reword.lastSummary() : null;
      if (last) logReword(last);
      else if (kind !== 'refit' || (store.get().reword?.status ?? 'off') === 'off') {
        void reword.start().catch((err: unknown) => {
          console.warn('[WebAble] paragraphs', err);
        });
      }
      // Round 10: a refit keeps the page's groups as they are (same page, same ids); say so again.
      const lastCompose = kind === 'refit' ? composer.lastSummary() : null;
      if (lastCompose) logCompose(lastCompose);
      startStruggle();
      watchLateContent();
      overlays.schedule('fitted');
      // Round 4: say what learning changed here (with Undo), then offer what it is fairly sure of.
      if (kind !== 'navigation') announceLearned(gen);
      schedulePassiveOffer(gen);

      // 3. Jev reads the page (async; the fit is already applied).
      await understand(gen, r);
    } catch (err) {
      console.warn('[WebAble] boot failed', err);
      addError(`Something went wrong while fitting this page: ${errText(err)}`);
      // Keep the page working: undo everything this run applied.
      await revertAll(opsList);
      for (const op of opsList) if (op.rec.status === 'applied') op.rec.status = 'reversed';
      syncOps();
      store.set({ phase: 'error' });
    }
  }

  /* ---------------- Jev understanding and decisions ---------------- */

  async function understand(gen: number, r: ReadResult): Promise<void> {
    if (!r.digest.elements.length) {
      log({ source: 'jev', title: 'Nothing on this page needed a decision', action: 'skipped' });
      return;
    }
    let u: PageUnderstanding;
    try {
      const noCache = await firstReadInSession();
      const res = await ask<PageUnderstanding>(noCache ? { type: 'understand', digest: r.digest, noCache: true } : { type: 'understand', digest: r.digest });
      if (!isUnderstanding(res)) throw new Error('Unexpected answer from Jev');
      u = res;
    } catch (err) {
      if (gen !== generation) return;
      // Round 8: one plain line for the person (the technical reason stays in the detail).
      log({ source: 'jev', title: UNREAD_LINE, detail: plainError(err), action: 'skipped' });
      addError(UNREAD_LINE);
      return;
    }
    if (gen !== generation || stopped) return;
    judged = new Set(u.elements.map((e) => e.id));
    jevEls = new Map(r.digest.elements.map((e) => [e.id, e] as const));
    const decisions = decide(u, r.digest, r);
    const m = u.metrics;
    store.set({ understanding: u, decisions, digest: r.digest, phase: store.get().calm.open ? 'calm' : 'understood' });
    if (u.cached) {
      const f = u.firstRead;
      log({
        source: 'jev',
        title: `Jev's read of this page came from the cache: ${m.questions} decisions${f ? ` (first read ${Math.round(f.wallMs)} ms, $${f.costUsd.toFixed(4)})` : ''}`,
        detail: `This page has the same structure as an earlier visit, so no new Jev call was made: this view cost $0.${f ? ` ${f.model || 'jev'} · ${f.calls} call${f.calls === 1 ? '' : 's'} · ${f.inputTokens.toLocaleString()} tokens on the first read.` : ''}`,
        action: 'kept',
      });
    } else {
      log({
        source: 'jev',
        title: `Jev read this page: ${m.questions} decisions in ${(m.wallMs / 1000).toFixed(2)} s ($${m.costUsd.toFixed(4)})`,
        detail: `${m.model || 'jev'} · ${m.calls} call${m.calls === 1 ? '' : 's'}${m.serverMs !== null ? ` · server ${m.serverMs} ms` : ''} · ${m.inputTokens.toLocaleString()} tokens`,
        action: 'kept',
      });
    }
    await applyDecisions(decisions, r, null);
    if (gen !== generation) return;
    overlays.schedule('jev');
    // Round 7: before Calm view is opened or offered, check that it keeps what this page is for.
    meaningRun = checkMeaning(gen, r);
    const gate = await meaningRun;
    if (gen !== generation) return;
    maybeAutoCalm(r, decisions, gate);
    // Overlays that appeared while Jev was answering (cookie banners at 0.8 s, chat panels) get their own read.
    if (pendingLate) {
      pendingLate = false;
      scheduleIncremental();
    }
  }

  /** The latest read's digest, but listing every element Jev has answered for (latest evidence wins). */
  function judgedDigest(latest: PageDigest): PageDigest {
    if (!jevEls.size) return latest;
    const els = new Map(jevEls);
    for (const e of latest.elements) if (els.has(e.id)) els.set(e.id, e);
    for (const e of latest.elements) if (!els.has(e.id)) els.set(e.id, e);
    return { ...latest, elements: [...els.values()].filter((e) => reader.elementFor(e.id)?.isConnected ?? false) };
  }

  function decide(u: PageUnderstanding, digest: PageDigest, r: ReadResult): ElementDecision[] {
    const judgedIds = new Set(u.elements.map((e) => e.id));
    const d: PageDigest = { ...digest, elements: digest.elements.filter((e) => judgedIds.has(e.id)) };
    try {
      return decideElements(u, d, r.local);
    } catch (err) {
      addError(`Decisions could not be made: ${errText(err)}`);
      return [];
    }
  }

  function describe(id: string, j: ElementJudgment | null): { noun: string; name: string } {
    const n = read?.nodes.get(id);
    const name = n?.name ?? '';
    let noun = 'this item';
    if (n) {
      if (n.carousel) noun = 'the moving promo banner';
      else if (n.consent) noun = 'the cookie notice';
      else if (n.iframeKind === 'ad_network' || n.ad) noun = 'the ad';
      else if (n.help && /chat|assistant/i.test(`${n.classWords.join(' ')} ${name}`)) noun = 'the chat panel';
      else if (n.overlay) noun = j?.role === 'popup_overlay' ? 'the popup' : 'the floating panel';
      else if (j?.role === 'recommendations') noun = n.cards ? 'the product cards' : 'the recommendations';
      else if (j?.role === 'advertising') noun = n.kind === 'button' || n.kind === 'link' ? 'the promotion button' : 'the promotion';
      else if (j?.role === 'popup_overlay') noun = 'the popup';
      else if (n.kind === 'button') noun = 'the button';
      else if (n.kind === 'link') noun = 'the link';
      else if (n.kind === 'field' || n.kind === 'select' || n.kind === 'checkbox' || n.kind === 'radio') noun = 'the field';
    }
    return { noun, name };
  }

  function strongProtect(d: ElementDecision): boolean {
    const j = d.judgment;
    if (d.reasons.some((x) => x.includes('(rule)'))) return true;
    if (j.help >= 0.3 || j.task >= 0.3) return true;
    if (!FOLD_ROLES.includes(j.role)) return true;
    const topProtect = Math.max(0, ...PROTECT_ROLE_LIST.map((role) => j.roleProbs[role] ?? 0));
    return topProtect >= 0.3;
  }

  function guardFold(el: Element, protectedEls: Element[]): boolean {
    if (el === document.body || el === document.documentElement || el === read?.mainRoot) return false;
    if (!el.isConnected || safeOurs(el)) return false;
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    if (r.width * r.height > 0.7 * vw * Math.max(vh, r.height > vh ? vh : r.height) && r.width > 0.9 * vw && r.height > 0.9 * vh) return false;
    if (document.activeElement && el.contains(document.activeElement) && document.activeElement !== document.body) return false;
    for (const p of protectedEls) if (p !== el && el.contains(p)) return false;
    if (el.querySelector('input:not([type="hidden"]), select, textarea, [contenteditable="true"]')) return false;
    if (el.closest('[data-wa-dim]')) return false;
    return true;
  }

  /**
   * A carousel may be dimmed as a whole even though its own dots and arrows are protected (dimming fades, every
   * control stays usable and comes back on hover or focus), unless it holds help, consent, a field, focus or the
   * main action.
   */
  function guardCarousel(car: Element, r: ReadResult): boolean {
    if (car === document.body || car === document.documentElement || car === r.mainRoot || !car.isConnected || safeOurs(car)) return false;
    const rect = car.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    if (rect.width > 0.9 * vw && rect.height > 0.9 * vh) return false;
    if (document.activeElement && document.activeElement !== document.body && car.contains(document.activeElement)) return false;
    if (car.querySelector('input:not([type="hidden"]), select, textarea, [contenteditable="true"]')) return false;
    if (car.closest('[data-wa-dim]')) return false;
    for (const n of r.nodes.values()) if ((n.help || n.consent) && car.contains(n.el)) return false;
    for (const d of store.get().decisions) {
      if (d.verdict !== 'promote' && d.verdict !== 'keep_popup') continue;
      const el = reader.elementFor(d.id);
      if (el && car.contains(el)) return false;
    }
    return true;
  }

  async function applyDecisions(decisions: ElementDecision[], r: ReadResult, only: Set<string> | null): Promise<void> {
    const fit = getFit();
    if (!fit) return;
    const subset = decisions.filter((d) => (!only || only.has(d.id)) && !decided.has(d.id));
    for (const d of subset) decided.add(d.id);
    // Elements a fold must never cover. A weak protection (an ad whose only protect signal is a small
    // action_button share, like "Schedule now" inside a promo carousel) does not stop its container from being
    // dimmed: dimming fades but keeps every control usable, and it comes back on hover or focus.
    const protectedEls: Element[] = [];
    for (const d of decisions) {
      if (d.verdict === 'promote' || d.verdict === 'keep_popup' || (d.verdict === 'protect' && strongProtect(d))) {
        const el = reader.elementFor(d.id);
        if (el) protectedEls.push(el);
      }
    }
    // Help and consent nodes the reader found are protected too (local rule).
    for (const n of r.nodes.values()) if ((n.help || n.consent) && n.el.isConnected) protectedEls.push(n.el);

    const ops: Op[] = [];
    const foldCands: Array<{ el: Element; title: string; detail: string; p: number; noun: string }> = [];
    let foldsSkipped = 0;
    const protectEntries: Array<Omit<LedgerEntry, 'at'>> = [];
    let protectedQuiet = 0;
    // One ledger line per protected region: skip items inside one already mentioned, and say "cookie notice" once.
    const mentioned: Element[] = [];
    let consentSaid = store.get().ledger.some((e) => e.title === 'Left the cookie notice for you to answer');
    const alreadyMentioned = (el: Element) => mentioned.some((m) => m === el || m.contains(el) || el.contains(m));
    for (const d of subset) {
      const el = reader.elementFor(d.id);
      if (!el) continue;
      const j = d.judgment;
      const { noun, name } = describe(d.id, j);
      const node: NodeInfo | undefined = r.nodes.get(d.id);
      switch (d.verdict) {
        case 'fold': {
          // A floating popup Jev folded is tucked out of the way by the overlay module, not dimmed in place.
          if (overlays.inOverlay(el)) break;
          if (fit.attention.structureLevel < 1 || undoneKinds.has('dim')) {
            foldsSkipped++;
            break;
          }
          // A rotating carousel: dim the whole carousel, not the slide that happened to be showing (the next slide
          // would come in at full colour).
          const carousel = r.carousels.find((c) => c !== el && c.isConnected && c.contains(el));
          const target = carousel && guardCarousel(carousel, r) ? carousel : el;
          if (!guardFold(target, protectedEls)) {
            foldsSkipped++;
            break;
          }
          if (foldCands.some((f) => f.el.contains(target) || target.contains(f.el))) break;
          const foldP = Math.min(1, FOLD_ROLES.reduce((s, role) => s + (j.roleProbs[role] ?? 0), 0) || j.roleP);
          const roleWord = j.role === 'advertising' ? 'advertising' : j.role === 'recommendations' ? 'recommendations' : j.role === 'popup_overlay' ? 'popup' : j.role;
          const label = name && noun !== 'the cookie notice' && target === el ? ` ${quote(name, 6)}` : '';
          const what = target !== el ? 'the moving promo banner' : noun;
          foldCands.push({ el: target, title: `Dimmed ${what}${label} (${roleWord} ${p2(foldP)})`, detail: d.reasons.join('; '), p: foldP, noun: what });
          break;
        }
        case 'promote': {
          if (undoneKinds.has('promote_main') || opsList.some((o) => o.rec.kind === 'promote_main' && o.rec.status === 'applied')) break;
          const mainP = store.get().understanding?.mainPick.p ?? j.main;
          ops.push(tailor.promoteOp(el, r, fit.targets.minPx, `Outlined ${quote(name, 5) || 'the main button'}, the main action (${p2(mainP)})`, mainP));
          break;
        }
        case 'keep_popup':
          // A floating warning: the overlay module says "Kept the session warning in front (task 0.81)".
          if (overlays.inOverlay(el)) break;
          if (alreadyMentioned(el)) break;
          mentioned.push(el);
          protectEntries.push({ source: 'jev', title: `Kept ${noun === 'the popup' ? 'the notice' : noun}${name ? ` ${quote(name, 6)}` : ''} in view (part of the task ${p2(j.task)})`, detail: d.reasons.join('; '), p: j.task, action: 'kept' });
          break;
        case 'protect': {
          if (node?.consent || j.role === 'consent_notice' || r.local.consentIds.includes(d.id)) {
            // Already moved into the cookie bar: that ledger line says it was not answered.
            if (el.closest('[data-wa-ov]')) consentSaid = true;
            if (!consentSaid) {
              consentSaid = true;
              mentioned.push(el);
              protectEntries.push({ source: 'jev', title: 'Left the cookie notice for you to answer', detail: 'WebAble never answers consent notices or removes them.', p: j.roleProbs.consent_notice ?? j.roleP, action: 'protected' });
            }
          } else if (j.help >= 0.5 || j.role === 'help_contact') {
            if (alreadyMentioned(el)) break;
            mentioned.push(el);
            const helpP = Math.max(j.help, j.role === 'help_contact' ? j.roleP : 0);
            protectEntries.push({ source: 'jev', title: `Kept ${quote(name, 6) || 'the help link'} in view (help ${p2(helpP)})`, detail: d.reasons.join('; '), p: helpP, action: 'protected' });
          } else protectedQuiet++;
          break;
        }
        default:
          break;
      }
    }
    // Folds: the four most certain each get their own line and undo; the rest are dimmed together.
    foldCands.sort((a, b) => b.p - a.p);
    for (const f of foldCands.slice(0, 4)) ops.push(tailor.dimOp(f.el, f.title, f.detail, f.p));
    const rest = foldCands.slice(4, 24);
    if (rest.length) {
      const minP = Math.min(...rest.map((f) => f.p));
      const ads = rest.filter((f) => f.noun === 'the ad').length;
      const what = ads === rest.length ? 'ads' : 'ads, promotions and teasers';
      ops.push(tailor.dimOp(rest.map((f) => f.el), `Dimmed ${rest.length} more ${what} (each at least ${p2(minP)})`, rest.map((f) => f.detail).slice(0, 3).join(' | '), minP));
    }
    // Ledger: the notable protections first (help, consent, popups kept), then one summary line.
    for (const e of protectEntries.slice(0, 6)) log(e);
    if (protectedQuiet > 0 && !only) {
      log({ source: 'jev', title: `Protected ${protectedQuiet} more item${protectedQuiet === 1 ? '' : 's'} the task needs (fields, buttons, menus)`, action: 'protected' });
    }
    if (foldsSkipped > 0 && fit.attention.structureLevel < 1 && !only) {
      log({ source: 'jev', title: `Jev found ${foldsSkipped} distraction${foldsSkipped === 1 ? '' : 's'}; your fit leaves them as they are`, action: 'kept' });
    }
    if (ops.length) await applyBatch(ops, r);
  }

  /**
   * Whether Calm view may open by itself here (round 6): only on a task page (a form with a clear main action, like a
   * refill or an application) with at least two sections worth rearranging. Never on search results, web apps or
   * mail. Returns the reason it may not, for the ledger.
   */
  function autoCalmBlock(r: ReadResult, decisions: ElementDecision[]): string | null {
    if (isSearchResults(r.pageKind)) return 'search results keep their own list';
    if (isWebApp(r.privatePage)) return 'web apps and mail keep their own layout';
    const promoted = decisions.some((d) => d.verdict === 'promote');
    let spec: FitSpec | null = null;
    try {
      let summary: FitSummaryForModel;
      const fit = getFit() ?? fallbackFitLike();
      try {
        summary = summarizeFitForModel(fit);
      } catch {
        summary = fallbackSummary(fit);
      }
      spec = buildHeuristic(enrichOutline(r.outline), summary, rolesNow());
    } catch {
      spec = null;
    }
    const formPage = r.pageKind === 'form page' || spec?.page_type === 'form' || (spec?.form_steps.length ?? 0) > 0;
    if (!formPage) return 'it is not a form to fill in';
    if (!promoted && !spec?.primary_action) return 'it has no clear main action';
    const sections = (spec?.sections ?? []).filter((sec) => sec.nodes.length > 0 && sec.role !== 'consent' && sec.role !== 'legal').length;
    if (sections < 2) return 'there is little to rearrange';
    return null;
  }

  /**
   * Round 10, the reading-page default: on every reading page (round 8: busy ones only) the WebAble page opens by
   * itself, once, as soon as the page is understood (rules in ./busy). Measures the distractions' share of the page
   * for the log.
   */
  function readingPageVerdict(r: ReadResult, gate: MeaningGate | null): OpenVerdict | null {
    const s = store.get();
    const u = s.understanding;
    if (!u) return null;
    let share = 0;
    try {
      // The page's key content (Jev's main region, content of importance >= 3): a "distraction" box that wraps it is
      // a layout container judged by its teasers, and is not counted in the share.
      const key: Element[] = [];
      const mr = u.mainRegion && u.mainRegion.id !== 'none' && u.mainRegion.p >= 0.8 ? reader.elementFor(u.mainRegion.id) : null;
      if (mr) key.push(mr);
      for (const e of u.elements) {
        if ((e.importance ?? 0) < 3 || isDistraction(e)) continue;
        const el = reader.elementFor(e.id);
        if (el) key.push(el);
      }
      const boxes: Array<[Element, number]> = [];
      for (const e of u.elements) {
        if (!isDistraction(e)) continue;
        const el = reader.elementFor(e.id);
        if (!el?.isConnected || key.some((k) => k !== el && el.contains(k))) continue;
        const rc = el.getBoundingClientRect();
        boxes.push([el, Math.max(0, rc.width) * Math.max(0, rc.height)]);
      }
      const de = document.documentElement;
      const pageArea = Math.max(de.scrollWidth, de.clientWidth) * Math.max(de.scrollHeight, de.clientHeight);
      share = distractionShare(boxes, pageArea, (a, b) => a.contains(b));
    } catch {
      share = 0;
    }
    const v = openVerdict({
      purpose: u.purpose ?? null,
      mainRegion: u.mainRegion ?? null,
      elements: u.elements,
      share,
      sensitive: r.sensitive || !!r.digest.hasSensitiveFields,
      meaningPass: gate ? gate.pass : null,
      interacted: interactedAt >= 0 && interactedAt >= pageAt,
      pinned: !!sitePrefs.original,
    });
    if (v.open && isSearchResults(r.pageKind)) return { ...v, open: false, reason: 'search results keep their own list' };
    if (v.open && isWebApp(r.privatePage)) return { ...v, open: false, reason: 'web apps and mail keep their own layout' };
    if (v.open && undoneKinds.has('calm_view')) return { ...v, open: false, reason: 'you undid the simplified page here' };
    return v;
  }

  /** A click, a key press, or a scroll past one screen (trusted events only). */
  function onInteract(e: Event): void {
    if (!e.isTrusted || stopped) return;
    if (e.type === 'scroll') {
      const vh = document.documentElement.clientHeight || innerHeight;
      if ((window.scrollY || document.documentElement.scrollTop || 0) <= vh) return;
    }
    interactedAt = performance.now();
  }

  function logOpenRule(v: OpenVerdict): void {
    const u = store.get().understanding;
    const pct0 = (x: number) => `${Math.round(x * 100)}%`;
    const facts = [
      u?.purpose ? `Page: ${purposeWords(u.purpose.kind)} (${p2(u.purpose.p)})` : 'Page purpose unknown',
      u?.mainRegion ? `main content ${p2(u.mainRegion.p)}` : null,
    ].filter(Boolean).join('; ');
    const detail = `${facts}. ${v.count} ads, teasers and other distractions cover ${pct0(v.share)} of the page.`;
    console.info('[WebAble] reading page', JSON.stringify({ open: v.open, reason: v.reason, count: v.count, share: Math.round(v.share * 1000) / 1000, purpose: u?.purpose?.kind ?? null, purposeP: u?.purpose?.p ?? null, main: u?.mainRegion?.p ?? null, url: location.href }));
    log({
      source: 'layout',
      title: v.open ? 'This is a page for reading, so WebAble opened its simpler version' : `Kept this page's own layout: ${v.reason}`,
      detail,
      action: v.open ? 'applied' : 'skipped',
    });
  }

  function maybeAutoCalm(r: ReadResult, decisions: ElementDecision[], gate: MeaningGate | null): void {
    const fit = getFit();
    const s = store.get();
    if (!fit || s.calm.open || s.showingOriginal) return;
    if (reopenAfterRefit) {
      const by = reopenAfterRefit;
      reopenAfterRefit = null;
      if (!gate || gate.pass) {
        void openCalm(by === 'auto' ? 'auto' : 'person', 'Back to the simplified page after a settings change');
        return;
      }
    }
    // Decided once per page: a late read never opens it, and it never toggles back and forth.
    if (autoDecided) return;
    autoDecided = true;
    // Round 10: every reading page opens simplified by default (one fade, before the person starts using the page).
    const openV = readingPageVerdict(r, gate);
    if (openV) logOpenRule(openV);
    if (openV?.open) {
      autoOpenedHere = true;
      void openCalm('auto', 'This is a page for reading, so WebAble opened its simpler version');
      return;
    }
    // The site is set to "Original page": nothing opens by itself here.
    if (sitePrefs.original) return;
    // A Calm plan that would change what the page means is neither opened nor offered (the ledger already says why).
    if (gate && !gate.pass) return;
    const folded = decisions.filter((d) => d.verdict === 'fold').length;
    const busy = folded >= 3 || r.digest.page.element_count >= 60;
    if (!busy || fit.attention.structureLevel < 1) return;
    const block = fit.attention.structureLevel === 2 && !undoneKinds.has('calm_view') ? autoCalmBlock(r, decisions) : 'offered';
    if (block === null) {
      autoOpenedHere = true;
      void openCalm('auto', `This form is busy (${folded} distraction${folded === 1 ? '' : 's'}, ${r.digest.page.element_count} items), so it opened in Calm view`);
      return;
    }
    log({
      source: 'layout',
      title: 'A calmer layout of this page is ready: open Calm view',
      ...(block !== 'offered' ? { detail: `Calm view opens by itself only on forms with a clear main action; here ${block}.` } : {}),
      action: 'offered',
    });
  }

  /** Say honestly whether a moving banner stopped: watch it for 7 s after motion was reduced. */
  function watchCarousels(gen: number, r: ReadResult): void {
    const motion = opsList.find((o) => o.rec.kind === 'motion' && o.active);
    const roots = r.carousels.filter((c) => c.isConnected);
    if (!motion || !roots.length) return;
    let changes = 0;
    const obs = new MutationObserver((recs) => {
      for (const rec of recs) if (!(rec.type === 'attributes' && rec.attributeName?.startsWith('data-wa-'))) changes++;
    });
    for (const root of roots) obs.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'aria-hidden', 'hidden'] });
    setTimeout(() => {
      obs.disconnect();
      if (gen !== generation || stopped || !motion.active) return;
      if (changes > 0) {
        log({ source: 'fit', title: 'The moving banner keeps changing on its own; Calm view folds it away', detail: 'Its own script moves it, and it has no pause button WebAble could press.', action: 'skipped', opId: motion.rec.id });
      } else {
        log({ source: 'fit', title: 'The moving banner stopped', action: 'applied', opId: motion.rec.id });
      }
    }, 7000);
  }

  /* ---------------- late content: cookie banners, chat panels, lazy sections ---------------- */

  function watchLateContent(): void {
    if (mo) return;
    mo = new MutationObserver((records) => {
      for (const rec of records) {
        if (rec.type === 'childList') {
          for (const n of Array.from(rec.addedNodes)) {
            if (n.nodeType === 1 && !safeOurs(n as Element)) pendingAdded.push(n as Element);
          }
        } else if (rec.type === 'attributes') {
          if (rec.attributeName?.startsWith('data-wa-')) continue;
          const t = rec.target as Element;
          if (!safeOurs(t)) pendingChanged.add(t);
        }
      }
      if (pendingAdded.length > 2000) pendingAdded = pendingAdded.slice(-2000);
      if (pendingChanged.size > 600) pendingChanged = new Set([...pendingChanged].slice(-600));
      scheduleFlush();
    });
    mo.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'aria-modal'],
    });
  }

  function scheduleFlush(): void {
    const now = Date.now();
    if (!flushFirstAt) flushFirstAt = now;
    if (flushTimer) clearTimeout(flushTimer);
    const wait = now - flushFirstAt >= 1000 ? 0 : 300;
    flushTimer = setTimeout(flush, wait);
  }

  function flush(): void {
    flushTimer = null;
    flushFirstAt = 0;
    if (stopped) return;
    tailor.sheets.sync();
    const added = pendingAdded.filter((el) => el.isConnected);
    const changed = [...pendingChanged].filter((el) => el.isConnected);
    pendingAdded = [];
    pendingChanged = new Set();
    if (!read || store.get().showingOriginal) return;
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    const significant = [...added.slice(0, 120), ...changed.slice(0, 120)].some((el) => {
      if (!el.isConnected || safeOurs(el)) return false;
      const known = reader.idFor(el);
      if (known && judged.has(known)) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      const role = el.getAttribute('role');
      if (cs.position === 'fixed' && r.width * r.height >= 0.01 * vw * vh) return true;
      if (role === 'dialog' || role === 'alertdialog' || el.getAttribute('aria-modal') === 'true' || el.tagName === 'DIALOG') return true;
      if (el.tagName === 'IFRAME' && r.width * r.height >= 20000) return true;
      if (r.width * r.height >= 0.15 * vw * vh && el.querySelectorAll('*').length >= 25) return true;
      return false;
    });
    if (significant) scheduleIncremental();
  }

  function scheduleIncremental(): void {
    if (incrementalTimer || incrementalRounds >= 8) return;
    const wait = Math.max(0, 2000 - (Date.now() - lastIncrementalAt));
    incrementalTimer = setTimeout(() => {
      incrementalTimer = null;
      void incremental(generation);
    }, wait + 250);
  }

  async function incremental(gen: number): Promise<void> {
    if (stopped || gen !== generation || !read) return;
    const phase = store.get().phase;
    if (phase === 'reading' || phase === 'idle' || phase === 'error') return;
    incrementalRounds++;
    lastIncrementalAt = Date.now();
    const r = readPage();
    read = r;
    store.set({ digest: judgedDigest(r.digest), outline: r.outline });
    refreshCalmSpec();
    const u0 = store.get().understanding;
    if (!u0) {
      // Jev has not answered yet (or is unavailable): read again when the first answer lands.
      pendingLate = true;
      incrementalRounds--;
      return;
    }
    const fresh = r.digest.elements.filter((e) => !judged.has(e.id)).slice(0, 40);
    if (!fresh.length) return;
    // New items only: the page's purpose and main region were read with the whole page (round 7), so no regions here.
    const { regions: _regions, ...rest } = r.digest;
    const partial: PageDigest = { ...rest, elements: fresh, mainCandidates: [] };
    let u: PageUnderstanding;
    try {
      const res = await ask<PageUnderstanding>({ type: 'understand', digest: partial });
      if (!isUnderstanding(res)) return;
      u = res;
    } catch (err) {
      addError(plainError(err));
      return;
    }
    if (gen !== generation || stopped) return;
    for (const e of u.elements) judged.add(e.id);
    for (const e of fresh) jevEls.set(e.id, e);
    const latest = store.get().understanding ?? u0;
    const surer = !!u.purpose && !!latest.purpose && latest.purpose.p < 0.8 && u.purpose.p >= 0.9 && u.purpose.kind !== latest.purpose.kind;
    const merged: PageUnderstanding = {
      elements: [...latest.elements.filter((e) => !u.elements.some((x) => x.id === e.id)), ...u.elements],
      mainPick: latest.mainPick,
      metrics: addMetrics(latest.metrics, u.metrics),
      // The page read stays "from cache" when it was; later reads of new items add their own cost to this view.
      cached: latest.cached,
      ...(latest.firstRead ? { firstRead: latest.firstRead } : {}),
      // What the page is for and its main region come from the whole-page read; a read of a few new items keeps them,
      // unless the first read was unsure of the purpose (< 0.8) and this one is sure (>= 0.9) of another.
      ...(surer ? { purpose: u.purpose! } : latest.purpose ? { purpose: latest.purpose } : u.purpose ? { purpose: u.purpose } : {}),
      ...(latest.mainRegion ? { mainRegion: latest.mainRegion } : {}),
    };
    const union = judgedDigest(r.digest);
    const decisions = decide(merged, union, r);
    store.set({ understanding: merged, decisions, digest: union });
    // Jev became sure what the page is for: check the Calm plan's meaning again (it is not opened or offered by this).
    if (surer && !store.get().calm.open) {
      log({ source: 'jev', title: `Jev is now sure this page is ${purposeWords(merged.purpose?.kind ?? null)} (${p2(merged.purpose?.p ?? 0)})`, action: 'kept' });
      meaningRun = checkMeaning(gen, r);
      void meaningRun;
    }
    log({
      source: 'jev',
      title: `Jev read ${u.elements.length} new item${u.elements.length === 1 ? '' : 's'} on the page (${u.cached ? 'from the cache' : `${(u.metrics.wallMs / 1000).toFixed(2)} s`})`,
      detail: `${u.metrics.questions} more decisions`,
      action: 'kept',
    });
    await applyDecisions(decisions, r, new Set(u.elements.map((e) => e.id)));
    overlays.schedule('jev');
  }

  /* ---------------- struggle signals ---------------- */

  function startStruggle(): void {
    if (stopSignals) return;
    const host: SignalsHost = {
      elementFor: (id) => reader.elementFor(id),
      fit: () => store.get().fit,
      pageKind: () => read?.pageKind ?? 'web page',
      onJudgment: (j, waiting, offers) => onJudgment(j, waiting, offers),
      ask: <T,>(req: BgRequest) => ask<T>(req),
      isOurUi: safeOurs,
      onPointerOutcome: (o) => passiveObs.noteClick(o),
    };
    try {
      stopSignals = startSignals({ api: host });
    } catch (err) {
      addError(`Struggle signals could not start: ${errText(err)}`);
    }
  }

  function onJudgment(j: StruggleJudgment, waiting: StruggleKind[], offers: Offer[]): void {
    const s = store.get();
    const now = Date.now();
    // Offer choice against the fit: "Make buttons bigger" is pointless when the fit's targets already meet the need.
    const folded = s.decisions.filter((d) => d.verdict === 'fold').length;
    const pageFacts = {
      targetsApplied: opsList.some((o) => o.rec.kind === 'targets' && o.active),
      busy: folded >= 2 || (s.digest?.page.element_count ?? 0) >= 40,
      calmOpen: s.calm.open,
    };
    const fitted: Offer[] = [];
    for (const o of offers) {
      let next: Offer | null = o;
      try {
        next = chooseOfferForFit(o, s.fit, pageFacts);
      } catch {
        next = o;
      }
      if (next) fitted.push(next);
      else log({ source: 'signals', title: 'Did not offer bigger buttons: your fit already makes them large here', detail: o.why, p: o.p, action: 'skipped' });
    }
    const usable = fitted.filter((o) => (dismissedOffers.get(o.kind) ?? 0) <= now);
    const current = s.struggle.offers[0];
    const keep = current && usable.some((o) => o.kind === current.kind) ? current : usable[0];
    const shown = keep ? [keep] : current ? [current] : [];
    if (keep && (!current || current.kind !== keep.kind)) {
      log({ source: 'signals', title: `Offered: ${keep.question}`, detail: `${keep.fact} ${keep.why}`.trim(), p: keep.p, action: 'offered' });
    }
    const prevWaiting = s.struggle.waiting.join(',');
    if (waiting.length && waiting.join(',') !== prevWaiting) {
      const parts = waiting.map((k) => `${k} ${p2(j.kinds[k] ?? 0)}`);
      log({ source: 'signals', title: `Watching, not acting yet: ${parts.join(', ')}`, detail: 'Jev is unsure (0.50–0.75), so nothing changes until a second window agrees.', action: 'waiting' });
    }
    store.set({
      struggle: { latest: j, history: [...s.struggle.history, j].slice(-30), waiting, offers: shown },
    });
  }

  /* ---------------- offers ---------------- */

  async function acceptOffer(kind: OfferKind): Promise<void> {
    const s = store.get();
    const offer = s.struggle.offers.find((o) => o.kind === kind);
    store.set({ struggle: { ...s.struggle, offers: s.struggle.offers.filter((o) => o.kind !== kind) } });
    // Round 4: an offer from what WebAble learned ("Make text larger on every site?") is a choice for every site.
    const pm = passiveOffers.get(kind);
    if (pm) {
      passiveOffers.delete(kind);
      if (!offer || offer.question === pm.question) {
        await acceptPassive(kind, pm, offer);
        return;
      }
    }
    try {
      noteOfferOutcome(kind, 'accepted');
    } catch {
      /* signals not running */
    }
    log({ source: 'person', title: `You accepted: ${offer?.question ?? kind}`, action: 'applied' });
    const fit = getFit();
    const r = read;
    let op: Op | null = null;
    // Ops the new one replaces; they come back if the new one does not pass the checks.
    let superseded: Op[] = [];
    switch (kind) {
      case 'bigger_targets': {
        const current = Math.max(fit?.targets.minPx ?? 0, 0);
        const ladder = [44, 56, 72, 96];
        const T = ladder.find((x) => x > current) ?? 96;
        if (r) {
          superseded = opsList.filter((o) => o.rec.kind === 'targets' && o.active);
          for (const o of superseded) {
            await revertOp(o);
            o.rec.status = 'reversed';
          }
          op = tailor.targetsOp(T, r, 'signals');
        }
        break;
      }
      case 'steady_clicks':
        if (!opsList.some((o) => o.rec.kind === 'steady_clicks' && o.active)) {
          op = tailor.steadyOp(fit?.clicks.steady.windowMs ?? 300, fit?.clicks.steady.radiusPx ?? 10);
          op.source = 'signals';
        }
        break;
      case 'debounce':
        if (!opsList.some((o) => o.rec.kind === 'debounce' && o.active)) {
          op = tailor.debounceOp();
          op.source = 'signals';
        }
        break;
      case 'larger_text': {
        const was = sizeNow().zoom;
        const next = stepZoom(was, 1, !!fit?.text.largePrint);
        if (next > was + 0.005 && read) {
          const res = await textTo(read, next, 'signals', plan?.step ?? 0);
          const z = res.ok ? res.zoomOp : null;
          if (z) {
            opOffer.set(z.rec.id, kind);
            z.title = `Zoomed this page to ${pct(next)} (was ${pct(was)})`;
            log({ source: 'signals', title: z.title, detail: z.detail, action: 'applied', opId: z.rec.id });
            toast(`${OFFER_TOAST[kind]} (${pct(next)})`, z.rec.id);
            passiveObs.noteSize(next, 'accept', 1);
            rememberSize(sizeNow());
          } else toast('That change did not fit this page, so it was undone');
        } else {
          toast('Text is already as large as WebAble makes it');
        }
        return;
      }
      case 'calm_view':
        await openCalm('person');
        return;
      case 'main_actions': {
        const mainId = store.get().decisions.find((d) => d.verdict === 'promote')?.id ?? store.get().understanding?.mainPick.id;
        const el = mainId && mainId !== 'none' ? reader.elementFor(mainId) : null;
        if (el && !opsList.some((o) => o.rec.kind === 'promote_main' && o.active)) {
          const name = read?.nodes.get(mainId ?? '')?.name ?? '';
          op = tailor.promoteOp(el, r, fit?.targets.minPx ?? 44, `Outlined ${quote(name, 5) || 'the main button'}, the main action`, store.get().understanding?.mainPick.p ?? 0);
          op.source = 'signals';
        } else if (r) {
          op = tailor.targetsOp(Math.max(56, fit?.targets.minPx ?? 0), r, 'signals');
        }
        break;
      }
      default:
        break;
    }
    if (!op) {
      for (const o of superseded) {
        try {
          await o.apply();
          o.rec.status = 'applied';
        } catch (err) {
          addError(plainError(err));
        }
      }
      syncOps();
      return;
    }
    opOffer.set(op.rec.id, kind);
    const kept = await applyBatch([op], r);
    if (kept.includes(op) && op.rec.kind === 'targets') tailor.flashTargets(op.elements, 800);
    if (kept.includes(op)) {
      toast(OFFER_TOAST[kind], op.rec.id);
    } else {
      // The new change did not pass the checks: put back what it replaced.
      for (const o of superseded) {
        try {
          await o.apply();
          o.rec.status = 'applied';
        } catch (err) {
          addError(plainError(err));
        }
      }
      syncOps();
      toast('That change did not fit this page, so it was undone');
    }
  }

  function dismissOffer(kind: OfferKind, forever: boolean): void {
    const s = store.get();
    const offer = s.struggle.offers.find((o) => o.kind === kind);
    store.set({ struggle: { ...s.struggle, offers: s.struggle.offers.filter((o) => o.kind !== kind) } });
    const pm = passiveOffers.get(kind);
    if (pm) {
      passiveOffers.delete(kind);
      if (!offer || offer.question === pm.question) {
        dismissPassive(kind, pm, forever);
        return;
      }
    }
    dismissedOffers.set(kind, forever ? Number.MAX_SAFE_INTEGER : Date.now() + 30 * 60 * 1000);
    try {
      noteOfferOutcome(kind, forever ? 'never' : 'not_now');
    } catch {
      /* signals not running */
    }
    log({ source: 'person', title: forever ? 'You turned off this suggestion' : 'Not now: WebAble will not ask again for a while', action: 'skipped' });
  }

  /* ---------------- Calm view ---------------- */

  /**
   * Roles for the layout: Jev's role per element, except that an element Jev judged mostly help (help >= 0.5)
   * is laid out as help, so it lands in the open Help section instead of a drawer.
   */
  function rolesNow(): Record<string, Role> {
    const out: Record<string, Role> = {};
    for (const e of store.get().understanding?.elements ?? []) out[e.id] = e.role;
    for (const d of store.get().decisions) {
      if (d.verdict !== 'fold' && d.judgment.help >= 0.5 && d.judgment.role !== 'consent_notice') out[d.id] = 'help_contact';
    }
    return out;
  }

  /**
   * Outline nodes the layout must keep in view. Jev's "protect" verdict only means "never dim this"; for layout,
   * an element whose own role is a distraction (an ad's "Schedule now" link) or that sits inside something Jev
   * folded (a promo carousel's slide buttons) goes with its container, unless it is help, consent, a rule-based
   * protection (focus, required, typed value) or the main action.
   */
  function enrichOutline(outline: PageOutline): PageOutline {
    const u = store.get().understanding;
    const decisions = store.get().decisions;
    const role = new Map<string, Role>(Object.entries(rolesNow()));
    for (const e of u?.elements ?? []) if (!role.has(e.id)) role.set(e.id, e.role);
    const parent = new Map(outline.nodes.map((n) => [n.id, n.parent ?? null] as const));
    const folded = new Set(decisions.filter((d) => d.verdict === 'fold').map((d) => d.id));
    const underFold = (id: string): boolean => {
      let p = parent.get(id) ?? null;
      for (let i = 0; p && i < 40; i++) {
        if (folded.has(p)) return true;
        p = parent.get(p) ?? null;
      }
      return false;
    };
    // Round 7: Jev's fine role per element (page model v2), when it is probable enough.
    const fine = new Map<string, FineRole>();
    for (const e of u?.elements ?? []) if (e.fine && (e.fineP ?? 1) >= FINE_MIN_P) fine.set(e.id, e.fine);
    const prot = new Set<string>();
    for (const d of decisions) {
      const j = d.judgment;
      const distraction = DRAWER_FINE.has(fine.get(d.id) as FineRole);
      if (d.verdict === 'promote' || d.verdict === 'keep_popup') prot.add(d.id);
      else if (d.verdict !== 'protect') continue;
      else if (d.reasons.some((x) => x.includes('(rule)')) || j.help >= 0.3 || j.role === 'consent_notice') prot.add(d.id);
      // A teaser for other content, an ad or an upsell is never kept in view for the layout, whatever the coarse role.
      else if (!FOLD_ROLES.includes(j.role) && !underFold(d.id) && !distraction) prot.add(d.id);
    }
    const nodes: OutlineNode[] = outline.nodes.map((n) => {
      const out: OutlineNode = { ...n };
      const r = role.get(n.id);
      if (r) out.jevRole = r;
      const f = fine.get(n.id);
      if (f) out.fine = f;
      if (prot.has(n.id)) out.protected = true;
      return out;
    });
    return { ...outline, nodes };
  }

  function buildHeuristic(outline: PageOutline, summary: FitSummaryForModel, roles: Record<string, Role>): FitSpec {
    let spec: FitSpec;
    try {
      spec = heuristicSpec(outline, roles, summary);
    } catch (err) {
      addError(`The simple layout could not be built: ${errText(err)}`);
      spec = fallbackSpec(outline);
    }
    try {
      spec = repairSpec(spec, outline).spec;
    } catch {
      /* keep as is */
    }
    return withMeaning(alignPrimary(completeSpec(spec, outline).spec), outline);
  }

  /** What this page is for (round 7), from Jev's page model v2 and the content read on this device. */
  function meaningNow(outline?: PageOutline | null): PageMeaning | null {
    const o = outline ?? read?.outline ?? null;
    if (!o) return null;
    try {
      return pageMeaning({ outline: o, understanding: store.get().understanding, elementFor: (id) => reader.elementFor(id) });
    } catch {
      return null;
    }
  }

  /** A Calm spec, meaning first: the main information leads, teasers, ads and offers go to the end drawer. */
  function withMeaning(spec: FitSpec, outline: PageOutline): FitSpec {
    const m = meaningNow(outline);
    if (!m) return spec;
    try {
      return applyMeaning(spec, outline, m).spec;
    } catch {
      return spec;
    }
  }

  /**
   * The meaning check (round 7): the Calm plan this page would get, summarised as fine roles only (no page text or
   * numbers), and Jev's answer to "does it lead with what the page exists to show?" and "is main information missing?".
   * Without Jev the same question is answered on this device. A failed check keeps Calm view off this page.
   */
  async function checkMeaning(gen: number, r: ReadResult): Promise<MeaningGate | null> {
    if (!r.outline.nodes.length) return null;
    const m = meaningNow(r.outline);
    if (!m) return null;
    let spec: FitSpec;
    let req: ReturnType<typeof meaningRequest>;
    try {
      const fit = getFit() ?? fallbackFitLike();
      let summary: FitSummaryForModel;
      try {
        summary = summarizeFitForModel(fit);
      } catch {
        summary = fallbackSummary(fit);
      }
      const outline = enrichOutline(r.outline);
      spec = buildHeuristic(outline, summary, rolesNow());
      req = meaningRequest(spec, outline, m);
    } catch {
      return null;
    }
    const key = location.href;
    let by: MeaningGate['by'] = 'jev';
    let leads: number;
    let missing: number;
    let pass: boolean;
    let cost = '';
    try {
      const v = await ask<MeaningVerdict>({ type: 'meaning', req }, 6500);
      if (!v || typeof v.leadsWithMain !== 'number' || typeof v.missingMain !== 'number') throw new Error('Unexpected answer');
      leads = v.leadsWithMain;
      missing = v.missingMain;
      pass = typeof v.pass === 'boolean' ? v.pass : meaningPasses(v);
      if (v.metrics) cost = ` · ${Math.round(v.metrics.wallMs)} ms, $${v.metrics.costUsd.toFixed(4)}`;
    } catch {
      const v = localMeaningVerdict(req);
      by = 'device';
      leads = v.leadsWithMain;
      missing = v.missingMain;
      pass = v.pass;
    }
    if (gen !== generation || stopped) return null;
    const gate: MeaningGate = { key, pass, by, leadsWithMain: leads, missingMain: missing };
    meaningGate = gate;
    const page = m.purpose ? `This page is ${purposeWords(m.purpose)} (${p2(m.purposeP)}). ` : '';
    const nums = `Leads with the main information ${p2(leads)}; something main missing ${p2(missing)}.`;
    const how = by === 'jev'
      ? ` Jev saw page roles only, no page text or numbers${cost}.`
      : ' Checked on this device: Jev’s meaning check was not available.';
    if (pass) {
      log({
        source: by === 'jev' ? 'jev' : 'check',
        title: `${by === 'jev' ? 'Jev checked' : 'Checked'} that Calm view keeps what this page is for: it leads with ${leadWords(m)}`,
        detail: `${page}${nums}${how}`,
        p: leads,
        action: 'kept',
      });
    } else {
      const reason = leads < 0.8 ? 'it would not lead with what the page is for' : 'it would leave out part of the main information';
      log({
        source: by === 'jev' ? 'jev' : 'check',
        title: `Calm view is not offered on this page: ${reason}`,
        detail: `${page}${nums}${how} The page stays as it is, fitted to you.`,
        p: leads,
        action: 'skipped',
      });
      // An offer to open Calm view made before the check (text short of your size) is taken back.
      const st = store.get();
      if (st.struggle.offers.some((o) => o.kind === 'calm_view')) {
        store.set({ struggle: { ...st.struggle, offers: st.struggle.offers.filter((o) => o.kind !== 'calm_view') } });
      }
    }
    return gate;
  }

  /**
   * The Calm view's big blue action is the one Jev named (promote: main pick >= 0.90 and checks passed). A layout's
   * own guess ("Save to list" on an article) is not dressed up as the page's main action when Jev was not sure.
   */
  function alignPrimary(spec: FitSpec): FitSpec {
    const s = store.get();
    if (!s.understanding) return spec;
    const promoted = s.decisions.find((d) => d.verdict === 'promote');
    if (!promoted) return spec.primary_action === null ? spec : { ...spec, primary_action: null };
    if (spec.primary_action === promoted.id) return spec;
    const pe = reader.elementFor(promoted.id);
    const cur = spec.primary_action ? reader.elementFor(spec.primary_action) : null;
    if (pe && cur && (pe.contains(cur) || cur.contains(pe))) return spec;
    const listed = spec.sections.some((sec) => sec.nodes.includes(promoted.id)) || (read?.outline.nodes.some((n) => n.id === promoted.id) ?? false);
    return listed ? { ...spec, primary_action: promoted.id } : spec;
  }

  const onEngage = (e: Event) => {
    if (!store.get().calm.open) return;
    if (e.type === 'wheel' || e.type === 'pointerdown' || e.type === 'keydown' || e.type === 'touchstart') calmEngaged = true;
  };

  async function openCalm(by: 'auto' | 'person' = 'person', why?: string): Promise<void> {
    if (store.get().calm.open) return;
    // Round 7: a page whose Calm plan failed the meaning check keeps its own layout (the check is usually done by now).
    let gate = meaningGate;
    if (!gate && meaningRun) gate = await Promise.race([meaningRun, sleep(2500).then(() => null)]);
    if (gate && !gate.pass && gate.key === location.href) {
      toast('This page keeps its own layout: simplifying it would change what it shows first');
      log({
        source: 'check',
        title: 'Calm view did not open: it would not keep what this page is for',
        detail: `Leads with the main information ${p2(gate.leadsWithMain)}; something main missing ${p2(gate.missingMain)}. The page stays as it is, fitted to you.`,
        action: 'skipped',
      });
      return;
    }
    const s = store.get();
    if (s.calm.open) return;
    if (s.showingOriginal) showOriginal(false);
    const fit = s.fit;
    if (!read) {
      read = readPage();
      store.set({ digest: read.digest, outline: read.outline });
    }
    const r = read;
    const gen = ++calmGen;
    let summary: FitSummaryForModel;
    try {
      summary = summarizeFitForModel(fit ?? fallbackFitLike());
    } catch {
      summary = fallbackSummary(fit ?? fallbackFitLike());
    }
    const roles = rolesNow();
    const outline = enrichOutline(r.outline);
    const spec = buildHeuristic(outline, summary, roles);
    heuristicSpecCache = spec;
    const cov = calmCoverage(spec, outline);
    const key = `${location.pathname}|${outlineSignature(r.outline)}`;
    const cached = redesignCache.get(key) ?? (await readCachedRedesign(key));
    // Round 8: the page is never swapped on its own once the person started using it (they may have while the
    // layout was prepared), or when the site was just set to "Original page".
    if (by === 'auto' && ((interactedAt >= 0 && interactedAt >= pageAt) || sitePrefs.original || gen !== calmGen || store.get().calm.open)) {
      log({ source: 'layout', title: 'Kept this page as it is: you had started using it', action: 'skipped' });
      return;
    }
    const wantAi = s.settings.aiLayouts && !r.sensitive && !r.privatePage && outline.nodes.length > 0;
    // The page keeps its zoom under the Calm view (round 6): the view is drawn at 1 ÷ page zoom, so it is the fit's
    // size either way, and opening or closing it never changes the tab's zoom.
    calmOpenedAt = performance.now();
    calmEngaged = false;
    calmWasOpen = false;
    pendingAi = null;
    window.addEventListener('wheel', onEngage, { capture: true, passive: true });
    window.addEventListener('pointerdown', onEngage, { capture: true, passive: true });
    window.addEventListener('keydown', onEngage, { capture: true, passive: true });
    window.addEventListener('touchstart', onEngage, { capture: true, passive: true });

    let first = spec;
    let source: EngineState['calm']['source'] = 'heuristic';
    if (cached && wantAi) {
      const chosen = cached.candidates.find((c) => c.name === cached.chosen);
      if (chosen && cached.chosen !== 'heuristic' && cached.chosen !== 'overview' && cached.autoApply) {
        first = finishAiSpec(chosen.spec, outline);
        source = 'cached';
      }
    }
    // Round 8: opening it by hand clears the site's "Original page" setting.
    if (by === 'person' && sitePrefs.original) {
      delete sitePrefs.original;
      void saveSitePrefs({ original: undefined });
    }
    store.set((st) => ({
      phase: 'calm',
      calm: {
        open: true, loading: wantAi && !cached, spec: first, source, aiReady: false, redesign: cached ?? st.calm.redesign, visual: null,
        auto: by === 'auto', originalPinned: !!sitePrefs.original, textStep: calmTextStep,
      },
    }));
    overlays.setHidden(true);
    const m = meaningNow(r.outline);
    const leading = m && (m.template !== 'page' || m.lead.why !== 'none') ? `, leading with ${leadWords(m)}` : '';
    log({
      source: by === 'auto' ? 'layout' : 'person',
      title: why ?? (source === 'cached' ? 'Opened Calm view with the layout Jev picked last time' : `Opened Calm view${leading}`),
      detail: `Every item on the page is in this view (${Math.round(cov.coverage * 100)}% placed${cov.missing.length ? `, ${cov.missing.length} added to “More on this page”` : ''}). Every control still drives the original page.`,
      action: 'applied',
    });
    store.set((st) => ({ checks: [...st.checks, { name: 'content_loss' as const, pass: cov.coverage >= 1 || cov.missing.length === 0, detail: `Calm view places ${outline.nodes.length - cov.missing.length} of ${outline.nodes.length} items; the rest are in “More on this page”` }].slice(-80) }));
    if (!r.sensitive && !r.privatePage && !s.settings.aiLayouts) {
      log({ source: 'layout', title: 'AI layouts are off in settings, so this is the simple layout', action: 'skipped' });
    } else if (r.sensitive) {
      log({ source: 'layout', title: 'This page has password or payment fields, so no AI sees it; this is the simple layout', action: 'skipped' });
    }
    if (wantAi && !cached) void requestAi(gen, outline, summary, roles, key);
  }

  function fallbackFitLike(): FitProfile {
    return {
      v: 'fit.1', createdAt: new Date().toISOString(), inputClass: 'mouse',
      text: { bodyPx: 16, cpsPx: null, largePrint: false, conf: 0, source: 'default', override: null },
      contrast: { band: 'N', floor: 4.5 }, polarity: { value: 'light', stated: null }, weight: { floor: 400 },
      spacing: { lineHeight: 1.4, wordEm: 0, letterEm: 0 }, measure: { targetCpl: 66, maxCpl: 80, minCpl: 45 },
      targets: { minPx: null, conf: 0 }, clicks: { steady: { on: false, windowMs: 300, radiusPx: 10 }, debounce: false },
      attention: { motion: { p: 0, on: false }, clutter: { p: 0 }, structureLevel: 1 },
      baselines: { searchSecMedian: null, slipRate: 0, repeatRate: 0, missRate: 0 },
      calibration: { version: 'default', durationSec: 0, skipped: [] },
    };
  }

  function finishAiSpec(spec: FitSpec, outline: PageOutline): FitSpec {
    let out = spec;
    try {
      out = repairSpec(spec, outline).spec;
    } catch {
      /* the server repaired it already */
    }
    return withMeaning(alignPrimary(completeSpec(out, outline).spec), outline);
  }

  async function readCachedRedesign(key: string): Promise<RedesignResult | undefined> {
    try {
      const k = `calm:${hashString(key)}`;
      const got = await chrome.storage.session.get(k);
      const v = got[k] as { at: number; res: RedesignResult } | undefined;
      if (v && Date.now() - v.at < 30 * 60 * 1000) {
        redesignCache.set(key, v.res);
        return v.res;
      }
    } catch {
      /* session storage not available to content scripts */
    }
    return undefined;
  }

  function writeCachedRedesign(key: string, res: RedesignResult): void {
    redesignCache.set(key, res);
    try {
      void chrome.storage.session.set({ [`calm:${hashString(key)}`]: { at: Date.now(), res } }).catch(() => undefined);
    } catch {
      /* ignore */
    }
  }

  async function requestAi(gen: number, outline: PageOutline, summary: FitSummaryForModel, roles: Record<string, Role>, key: string): Promise<void> {
    const t0 = performance.now();
    let res: RedesignResult;
    try {
      res = await ask<RedesignResult>({ type: 'redesign', outline, fit: summary, roles });
      if (!res || !Array.isArray(res.candidates)) throw new Error('Unexpected answer');
    } catch (err) {
      if (gen !== calmGen) return;
      store.set((s) => ({ calm: { ...s.calm, loading: false } }));
      log({ source: 'layout', title: 'No other layout was available, so this is the simple layout', detail: plainError(err), action: 'skipped' });
      return;
    }
    writeCachedRedesign(key, res);
    if (gen !== calmGen || !store.get().calm.open) return;
    const chosen = res.candidates.find((c) => c.name === res.chosen);
    store.set((s) => ({ calm: { ...s.calm, loading: false, redesign: res } }));
    const ms = Math.round(performance.now() - t0);
    if (!chosen || res.chosen === 'heuristic') {
      const best = [...res.candidates].filter((c) => candidateSource(c) !== 'heuristic').sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0))[0];
      const bestWord = best && candidateSource(best) === 'ai' ? 'AI layout' : 'other layout';
      log({
        source: 'layout',
        title: `Jev kept the simple layout: no ${res.ai === 'on' ? 'other' : 'local'} layout was clearly easier`,
        detail: best ? `Best ${bestWord} (${best.name}): ${Math.round((best.pEasier ?? 0) * 100)}% likely easier, ${Math.round((best.pHides ?? 0) * 100)}% chance something needed is folded` : undefined,
        action: 'kept',
      });
      return;
    }
    const spec = finishAiSpec(chosen.spec, outline);
    pendingAi = { spec, result: res };
    const easier = Math.round((chosen.pEasier ?? 0) * 100);
    const hides = Math.round((chosen.pHides ?? 0) * 100);
    // Round 6: once Calm view is open its layout never changes by itself; the new layout waits until it is chosen.
    store.set((s) => ({ calm: { ...s.calm, aiReady: true } }));
    log({
      source: 'layout',
      title: `A layout picked by Jev is ready (${easier}% likely easier)`,
      detail: `${hides}% chance something needed is folded. It waits until you choose it, so the view never changes under you${ms ? ` · ${(ms / 1000).toFixed(1)} s` : ''}.`,
      p: chosen.pEasier,
      action: 'offered',
    });
  }

  function visualFacts(): { controls: string[]; help: string[]; mainLabel: string | null } {
    const digest = store.get().digest;
    const decisions = store.get().decisions;
    const byId = new Map((digest?.elements ?? []).map((e) => [e.id, e] as const));
    const controls = (digest?.elements ?? [])
      .filter((e) => ['input', 'select', 'textarea', 'fieldset'].includes(e.tag) || /checkbox|radio|textbox|combobox|radiogroup/.test(e.role_hint))
      .map((e) => e.label)
      .filter(Boolean)
      .slice(0, 12);
    const help = decisions
      .filter((d) => d.judgment.role === 'help_contact' || d.judgment.help >= 0.5)
      .map((d) => byId.get(d.id)?.label ?? '')
      .filter(Boolean)
      .slice(0, 6);
    const mainId = decisions.find((d) => d.verdict === 'promote')?.id ?? null;
    return { controls, help, mainLabel: mainId ? byId.get(mainId)?.label ?? null : null };
  }

  async function swapToAi(by: 'auto' | 'person', why: string, ms?: number): Promise<void> {
    const pending = pendingAi;
    if (!pending || !store.get().calm.open) return;
    const gen = calmGen;
    // Two Calm layouts show different parts of the page on the first screen by design (a stepper keeps later
    // fields in later steps), so "is every control from before still shown" is not a fair question here; the
    // DOM coverage check already proves every item is placed. Jev checks for cut-off or faint text and the main button.
    const facts = { ...visualFacts(), controls: [] as string[], help: [] as string[] };
    let haveBefore = false;
    try {
      await ask<unknown>({ type: 'visualVerify', ...facts, phase: 'before' });
      haveBefore = true;
    } catch {
      haveBefore = false;
    }
    if (gen !== calmGen || !store.get().calm.open) return;
    pendingAi = null;
    store.set((s) => ({ calm: { ...s.calm, spec: pending.spec, source: 'ai', aiReady: false } }));
    log({
      source: by === 'auto' ? 'layout' : 'person',
      title: by === 'auto' ? 'Switched to the layout Jev picked for your fit' : 'You chose the layout Jev picked',
      detail: `${why}${ms ? ` · ${(ms / 1000).toFixed(1)} s` : ''}`,
      action: 'applied',
    });
    if (!haveBefore) return;
    await settle();
    await sleep(400);
    if (gen !== calmGen || !store.get().calm.open) return;
    let verdict: VisualVerdict;
    try {
      verdict = await ask<VisualVerdict>({ type: 'visualVerify', ...facts, phase: 'after' });
      if (!verdict || typeof verdict.rollback !== 'boolean') return;
    } catch (err) {
      log({ source: 'check', title: 'The screenshot check was not available', detail: plainError(err), action: 'skipped' });
      return;
    }
    if (gen !== calmGen) return;
    store.set((s) => ({ calm: { ...s.calm, visual: verdict } }));
    const reasons: string[] = [];
    if (verdict.clipped >= 0.7) reasons.push(`text cut off ${p2(verdict.clipped)}`);
    if (verdict.faint >= 0.7) reasons.push(`faint text ${p2(verdict.faint)}`);
    if (verdict.keepsControls <= 0.3) reasons.push(`a form control missing ${p2(1 - verdict.keepsControls)}`);
    if (verdict.keepsHelp <= 0.3) reasons.push(`a help link missing ${p2(1 - verdict.keepsHelp)}`);
    const result: CheckResult = verdict.rollback
      ? { name: 'visual', pass: false, detail: `Jev compared screenshots: ${reasons.join(', ') || 'a problem'}` }
      : { name: 'visual', pass: true, detail: `Jev compared screenshots: nothing cut off ${p2(1 - verdict.clipped)}, text readable ${p2(1 - verdict.faint)}${verdict.mainVisible !== null ? `, main button visible ${p2(verdict.mainVisible)}` : ''}` };
    store.set((s) => ({ checks: [...s.checks, result].slice(-80) }));
    if (verdict.rollback && heuristicSpecCache) {
      store.set((s) => ({ calm: { ...s.calm, spec: heuristicSpecCache, source: 'heuristic' } }));
      log({ source: 'check', title: `Reversed the new layout: Jev's screenshot check saw ${reasons[0] ?? 'a problem'}`, detail: result.detail, action: 'reversed' });
      toast('Went back to the simple layout: the screenshot check found a problem');
    } else {
      log({ source: 'check', title: 'Jev checked the new layout against a screenshot: no text cut off or too faint', detail: result.detail, action: 'kept' });
    }
  }

  function refreshCalmSpec(): void {
    const s = store.get();
    if (!s.calm.open || !s.calm.spec || !read) return;
    const outline = enrichOutline(read.outline);
    let spec = s.calm.spec;
    try {
      spec = repairSpec(spec, outline).spec;
    } catch {
      /* keep */
    }
    const done = completeSpec(spec, outline);
    const aligned = alignPrimary(done.spec);
    const next = done.added || aligned !== s.calm.spec ? withMeaning(aligned, outline) : aligned;
    if (done.added || next !== s.calm.spec) store.set({ calm: { ...s.calm, spec: next } });
    if (heuristicSpecCache) heuristicSpecCache = withMeaning(alignPrimary(completeSpec(heuristicSpecCache, outline).spec), outline);
  }

  /**
   * Close the simplified page. The person closing it (`how` undefined) on a page where it opened by itself sets the
   * site to "Original page" (round 8); a peek at one control, showing the untouched page or leaving the page does not.
   */
  function closeCalm(how?: 'peek' | 'internal'): void {
    const s = store.get();
    if (!s.calm.open) return;
    const pin = how === undefined && autoOpenedHere && !sitePrefs.original;
    if (pin) {
      sitePrefs.original = true;
      void saveSitePrefs({ original: true });
    }
    calmGen++;
    pendingAi = null;
    window.removeEventListener('wheel', onEngage, { capture: true });
    window.removeEventListener('pointerdown', onEngage, { capture: true });
    window.removeEventListener('keydown', onEngage, { capture: true });
    window.removeEventListener('touchstart', onEngage, { capture: true });
    store.set({
      calm: { ...s.calm, open: false, loading: false, aiReady: false, originalPinned: !!sitePrefs.original },
      phase: s.understanding ? 'understood' : s.phase === 'calm' ? 'tailored' : s.phase,
    });
    log({
      source: 'person',
      title: pin ? `Showing the original page; WebAble will keep ${siteKey()} as it is` : 'Showing the page with your adjustments',
      action: 'kept',
    });
    overlays.setHidden(store.get().showingOriginal);
    overlays.schedule('calm-closed');
    reword.calmClosed();
  }

  /* ---------------- original page, undo ---------------- */

  function showOriginal(on: boolean): void {
    const s = store.get();
    if (on === s.showingOriginal) return;
    if (on) {
      calmWasOpen = s.calm.open;
      if (s.calm.open) closeCalm('internal');
      store.set({ showingOriginal: true });
      overlays.setHidden(true);
      reword.pageOriginal(true);
      void (async () => {
        await revertAll(opsList);
        syncTextScale();
      })();
      log({ source: 'person', title: 'Showing the original page', action: 'kept' });
    } else {
      store.set({ showingOriginal: false });
      reword.pageOriginal(false);
      void (async () => {
        // Zoom and column come back in one tab zoom change: the zoom op sets the tab's zoom for the column's scale.
        const col = opsList.find((o) => o.rec.kind === 'column' && o.rec.status === 'applied' && !o.active) as ColumnOp | undefined;
        const zoomBack = opsList.some((o) => o.rec.kind === 'page_zoom' && o.rec.status === 'applied' && !o.active);
        if (col?.spec.scale && col.spec.scale < 1 && zoomBack) colMul = 1 / col.spec.scale;
        const tm = opsList.find((o) => o.rec.kind === 'text_map' && o.rec.status === 'applied' && !o.active);
        for (const op of opsList) {
          if (op.rec.status === 'applied' && !op.active && op !== tm) {
            try {
              await op.apply();
            } catch (err) {
              addError(plainError(err));
            }
          }
        }
        if (tm && !store.get().showingOriginal) {
          // Round 11: the text map reads the site's own sizes for the window it is on: after the zoom's resize.
          if (zoomBack) await waitResize(900);
          await settle();
          try {
            await tm.apply();
          } catch (err) {
            addError(plainError(err));
          }
          syncTextScale();
        }
        overlays.setHidden(store.get().calm.open);
        overlays.schedule('original-off');
        if (calmWasOpen) {
          calmWasOpen = false;
          await openCalm('person', 'Back to your fitted page in Calm view');
        }
      })();
      log({ source: 'person', title: 'Back to your fitted page', action: 'applied' });
    }
  }

  function undoOp(opId: string): void {
    store.set((s) => ({ toasts: s.toasts.filter((t) => t.undoOpId !== opId) }));
    if (reword.ownsOp(opId)) {
      // Round 9: the rewritten paragraphs show the page's own words (each mark still flips one back).
      reword.showOriginalWords(true);
      log({ source: 'person', title: 'Showing the page’s own words in every paragraph WebAble rewrote', action: 'reversed', opId });
      return;
    }
    const op = opsList.find((o) => o.rec.id === opId);
    if (!op || op.rec.status !== 'applied') return;
    // Moved overlays: the overlay module brings them back and remembers "leave" for this site and kind.
    if (op.rec.kind === 'unobstruct' && overlays.undo(opId)) return;
    notePassiveUndo(opId);
    void (async () => {
      const r = read;
      if ((op.rec.kind === 'page_zoom' || op.rec.kind === 'column') && r) {
        // One step back: the person's own zoom (without WebAble's zoom the automatic column has no reason to stay), or
        // the same text size at full width. One tab zoom change.
        const cur = sizeNow();
        const col = activeColumn();
        const t: SizeTarget = op.rec.kind === 'page_zoom'
          ? { zoom: ownZoom(), column: col && col.spec.mode === 'person' ? col.spec.widthPx : null, mode: col?.spec.mode ?? 'auto' }
          : { ...cur, column: null };
        undoneKinds.add(op.rec.kind);
        await withLock(() => stepSize(r, t, { source: 'person', step: plan?.step ?? 0, check: false }));
        if (op.rec.kind === 'page_zoom' && plan) plan = { ...plan, zoom: ownZoom(), effectiveBodyPx: effBody(r, ownZoom()) };
      } else await revertOp(op);
      op.rec.status = 'reversed';
      undoneKinds.add(op.rec.kind);
      syncOps();
      if (op.rec.kind === 'text_map' || op.rec.kind === 'page_zoom') syncTextScale();
      const offer = opOffer.get(opId);
      if (offer) {
        try {
          noteOfferOutcome(offer, 'undone');
        } catch {
          /* signals not running */
        }
      }
    })();
    log({ source: 'person', title: `Undid: ${op.title}`, action: 'reversed', opId });
  }

  /* ---------------- navigation, settings changes, teardown ---------------- */

  /**
   * Take the page's ops off. `full`: everything (a refit); else persistent ops stay (a same-document navigation).
   * `keepSize`: a refit keeps zoom and column on the page, so the new plan moves from them in one step (or not at all).
   */
  async function teardownPage(full: boolean, keepSize = false): Promise<void> {
    if (incrementalTimer) clearTimeout(incrementalTimer);
    incrementalTimer = null;
    if (passiveTimer) clearTimeout(passiveTimer);
    passiveTimer = null;
    passiveOffers.clear();
    if (store.get().calm.open) closeCalm('internal');
    const keep: Op[] = [];
    const drop: Op[] = [];
    for (const op of opsList) {
      const sizeOp = op.rec.kind === 'page_zoom' || op.rec.kind === 'column' || op.rec.kind === 'text_map';
      if ((!full && op.persistent && op.rec.status === 'applied') || (keepSize && sizeOp && op.active)) keep.push(op);
      else drop.push(op);
    }
    await revertAll(drop);
    opsList = keep;
    syncTextScale();
    if (full) {
      if (!keepSize) {
        tailor.sheets.clear();
        plan = null;
        widthCap = null;
      }
      undoneKinds.clear();
    }
    judged = new Set();
    decided = new Set();
    jevEls = new Map();
    meaningGate = null;
    meaningRun = null;
    incrementalRounds = 0;
    pendingLate = false;
    overlays.reset();
    overlays.setHidden(false);
    reader.reset();
    read = null;
    const s = store.get();
    const keptEntries = s.ledger.filter((e) => e.opId && keep.some((o) => o.rec.id === e.opId)).map((e) => ({ ...e, at: 0 }));
    store.set({
      digest: null, outline: null, understanding: null, decisions: [], checks: [], ledger: keptEntries,
      calm: { open: false, loading: false, spec: null, source: null, aiReady: false, redesign: null, visual: null },
      struggle: { latest: null, history: [], waiting: [], offers: [] },
      toasts: [],
      showingOriginal: false,
    });
    reword.pageOriginal(false);
    syncOps();
    if (stopSignals) {
      stopSignals();
      stopSignals = null;
    }
  }

  let lastRoute = routeKey(location.href);
  let lastUrl = location.href;
  /** origin + path (+ a hash route): a change of query or plain hash alone is the same page. */
  const pageKey = (href: string): string => {
    try {
      const u = new URL(href);
      return `${u.origin}${u.pathname}${/^#!?\//.test(u.hash) ? u.hash : ''}`;
    } catch {
      return href;
    }
  };
  function onNavigate(url: string): void {
    const key = routeKey(url);
    if (key === lastRoute || stopped) return;
    const samePage = pageKey(url) === pageKey(lastUrl);
    lastRoute = key;
    lastUrl = url;
    if (samePage) {
      // Same path, new query or hash (Google rewrites its URL as you type or scroll): the same page. Zoom, column and
      // Calm view stay; new content gets Jev's incremental read.
      scheduleIncremental();
      return;
    }
    // A real SPA navigation: wait until the route has stopped changing (redirect chains, routers that push twice).
    if (navTimer) clearTimeout(navTimer);
    navTimer = setTimeout(() => {
      navTimer = null;
      if (stopped) return;
      void (async () => {
        passiveObs.newPage();
        reword.newPage();
        composer.reset();
        await teardownPage(false);
        errors = [];
        void boot('navigation');
      })();
    }, 600);
  }

  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || stopped) return;
    const fitChanged = 'fit' in changes;
    const settingsChange = changes.settings;
    let needsReboot = fitChanged;
    if (settingsChange) {
      const oldS = { ...DEFAULT_SETTINGS, ...((settingsChange.oldValue as Partial<Settings> | undefined) ?? {}) };
      const newS = { ...DEFAULT_SETTINGS, ...((settingsChange.newValue as Partial<Settings> | undefined) ?? {}) };
      if (oldS.enabled !== newS.enabled || pausedHere(oldS) !== pausedHere(newS) || oldS.serverOrigin !== newS.serverOrigin) needsReboot = true;
      if (oldS.lens !== newS.lens) toggleLens(newS.lens);
      store.set({ settings: newS });
    }
    if (needsReboot) {
      // A new warm-up also republishes what WebAble learned a moment later; one refit reads both.
      scheduleRefit(fitChanged ? 300 : 150);
      return;
    }
    // Round 4: what WebAble learned changed. The person's own changes (here, in another tab, in the popup, in Chrome's
    // settings) fit open pages again; plain evidence from browsing waits for each tab's next page.
    // Round 6: never on its own. What WebAble learned (or a change in another tab, the popup or Chrome's settings) is
    // taken in now and applied on this tab's next page; the page already showing keeps its size and layout.
    const passiveChange = changes.passive;
    const next = passiveChange?.newValue as PassiveFitState | undefined;
    if (next && next.v === 'passive.1') adoptPassive(next, 'keep');
  };

  function toggleLens(on?: boolean): void {
    const s = store.get();
    store.set({ lens: { on: on ?? !s.lens.on } });
  }

  /* ---------------- the API ---------------- */

  const api: EngineApi = {
    getState: () => store.get(),
    subscribe: (l) => store.subscribe(l),
    elementFor: (id) => (/^w\d+$/.test(id) ? reword.elementFor(id) : reader.elementFor(id)),
    toggleLens,
    openCalm: () => openCalm('person'),
    closeCalm: (how?: 'peek') => closeCalm(how === 'peek' ? 'peek' : undefined),
    useAiLayout: () => {
      if (pendingAi) void swapToAi('person', 'Chosen from the “A calmer layout is ready” chip');
    },
    showOriginal,
    undoOp,
    acceptOffer: (kind) => {
      void acceptOffer(kind).catch((err: unknown) => addError(plainError(err)));
    },
    dismissOffer,
    dismissToast: (id) => store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    openFitting: () => {
      void askExt<unknown>({ type: 'openFitting' }).catch((err: unknown) => addError(plainError(err)));
    },
    restoreOverlay: (id) => overlays.restore(id),
    adjustColumn: (step) => personAction(() => adjustColumn(step)),
    passiveFeedback: (dim, action) => {
      void passiveFeedbackNow(dim, action).catch((err: unknown) => {
        toast('WebAble could not save that. Try again in a moment.');
        addError(plainError(err));
      });
    },
    adjustText: (step) => personAction(() => adjustText(step)),
    showOriginalWords: (on) => {
      reword.showOriginalWords(on);
      log({ source: 'person', title: on ? 'Showing the page’s own words in every paragraph WebAble rewrote' : 'Showing WebAble’s rewritten paragraphs again', action: on ? 'reversed' : 'applied' });
    },
    toggleParagraph: (id) => reword.toggleParagraph(id),
    rewordFor: (node) => reword.rewordFor(node),
    compose: (groups) => composer.compose(groups),
  };

  return {
    api,
    async start() {
      stopped = false;
      overlays.start();
      stopNav = watchNavigation((url) => onNavigate(url));
      try {
        chrome.storage.onChanged.addListener(onStorage);
      } catch {
        /* storage events unavailable */
      }
      window.addEventListener('resize', onResize, { passive: true });
      window.addEventListener('pageshow', onPageShow);
      for (const t of INTERACT_EVENTS) window.addEventListener(t, onInteract, { capture: true, passive: true });
      await boot('first');
    },
    stop() {
      stopped = true;
      generation++;
      overlays.stop();
      stopNav?.();
      stopNav = null;
      stopSignals?.();
      stopSignals = null;
      mo?.disconnect();
      mo = null;
      if (flushTimer) clearTimeout(flushTimer);
      if (incrementalTimer) clearTimeout(incrementalTimer);
      if (resizeTimer) clearTimeout(resizeTimer);
      if (navTimer) clearTimeout(navTimer);
      if (refitTimer) clearTimeout(refitTimer);
      if (passiveTimer) clearTimeout(passiveTimer);
      stopPassive();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pageshow', onPageShow);
      for (const t of INTERACT_EVENTS) window.removeEventListener(t, onInteract, { capture: true });
      try {
        chrome.storage.onChanged.removeListener(onStorage);
      } catch {
        /* ignore */
      }
      // The column's CSS comes off with the zoom: one tab zoom change back to the person's own.
      textMap.dispose();
      void revertAll(opsList).catch(() => undefined);
      reword.dispose();
      composer.reset();
      tailor.sheets.clear();
      pushReport.cancel();
    },
  };
}
