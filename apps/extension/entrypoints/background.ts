// Owner: C1. The background service worker.
//
// - Routes BgRequest from content scripts to the local server (`${settings.serverOrigin}/v1/*`). Content scripts
//   never fetch the server themselves (page origin, CORS, mixed content); the worker holds no keys.
// - Per-tab zoom (chrome.tabs.setZoomSettings scope 'per-tab'), and whether the person changed it themselves.
// - Fit and settings from chrome.storage.local; TabReport per tab in chrome.storage.session (`report:<tabId>`).
// - Visual verify: captureVisibleTab PNG, downscaled so the long side is <= 1568 px, 'before' kept per tab,
//   both posted on 'after'.
// - `globalThis.__webable = { setFit, getReport, setSettings }` for the eval harness.
// - Round 4 (P): the passive fit. What the person already chose (Chrome's font sizes and zoom, read here; the OS
//   preferences, reported by pages with `getPassive`) and what happened on pages (`passiveEvidence`) become one belief
//   per need (core fit/passive.ts), stored on this laptop only: `passiveStore` (the evidence) and `passive` (the
//   PassiveFitState pages read). Zoom changes the person made (not WebAble, not a navigation) are noted per tab, so a
//   page can tell a held zoom from WebAble's own. `seedDemoHistory()` / `resetPassive()` for demos.
// - Round 9: the person's AI answer goes to `/v1/reader` once; the points come back and are kept as `reader` in
//   chrome.storage.local (the answer is not). Paragraph calls get the saved reader added here, points switched off left out.
// - Round 10: `compose` posts a page's groups to `/v1/compose` with the saved reader (points switched off left out), or
//   null when there is none (laid out for a general reader).

import {
  AI_ANSWER_MAX_CHARS, AI_ANSWER_MIN_CHARS, DEFAULT_SETTINGS, DEMO_FITS, SERVER_ORIGIN, addEvidence, applyFeedback, buildPassiveState,
  demoHistory, emptyPassiveStore, isPassiveStore, siteName, withSettings,
} from '@webable/core';
import type {
  AttributionAnswer, BrowserSettings, ComposeResponse, FitDimension, FitProfile, OverlayCloseResult, PageUnderstanding,
  PassiveFitState, PassiveRecord, PassiveStore, ReaderProfile, RedesignResult, RewordScoreResult, RewordWriteResult, Settings,
  StruggleJudgment, TabReport, VisualVerdict, VisualVerifyRequest,
} from '@webable/core';
import type { BusEnvelope, BusErrorCode, BusReply, ExtRequest, HealthInfo, ZoomInfo } from '../src/engine/bus';
import { stripLocalData, stripOutlineData } from '../src/engine/extract/strip';
import { registerSiteTasks } from '../src/sitetask/background';

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

class BgError extends Error {
  readonly code: BusErrorCode;
  readonly status: number | null;
  constructor(code: BusErrorCode, message: string, status: number | null = null) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function toReply(err: unknown): BusReply {
  if (err instanceof BgError) return { ok: false, code: err.code, error: err.message, status: err.status };
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, code: 'network', error: msg };
}

function isEnvelope(msg: unknown): msg is BusEnvelope {
  return !!msg && typeof msg === 'object' && (msg as { __wa?: unknown }).__wa === 1 && typeof (msg as { req?: { type?: unknown } }).req?.type === 'string';
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

async function getSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get('settings');
  const stored = (got.settings ?? {}) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

async function getFit(): Promise<FitProfile | null> {
  const got = await chrome.storage.local.get('fit');
  const fit = got.fit as FitProfile | undefined;
  return fit && fit.v === 'fit.1' ? fit : null;
}

async function setFit(fit: FitProfile | null): Promise<FitProfile | null> {
  if (fit === null) await chrome.storage.local.remove('fit');
  else await chrome.storage.local.set({ fit });
  return fit;
}

async function getReport(tabId: number): Promise<TabReport | null> {
  const k = `report:${tabId}`;
  const got = await chrome.storage.session.get(k);
  return (got[k] as TabReport | undefined) ?? null;
}

/* ------------------------------------------------------------------ */
/* Round 9: how the person likes things explained (from their AI)      */
/* ------------------------------------------------------------------ */

const READER_KEY = 'reader';

function isReader(x: unknown): x is ReaderProfile {
  const r = x as Partial<ReaderProfile> | null;
  return !!r && typeof r === 'object' && r.v === 'reader.1' && Array.isArray(r.points);
}

async function getReader(): Promise<ReaderProfile | null> {
  const got = await chrome.storage.local.get(READER_KEY);
  const r: unknown = got[READER_KEY];
  return isReader(r) ? r : null;
}

async function setReader(reader: ReaderProfile | null): Promise<ReaderProfile | null> {
  if (reader === null) await chrome.storage.local.remove(READER_KEY);
  else {
    if (!isReader(reader)) throw new BgError('refused', 'That is not something WebAble saved from an AI answer');
    await chrome.storage.local.set({ [READER_KEY]: reader });
  }
  return reader;
}

/** The saved reader as the server sees it: only the points the person left on. */
async function readerToSend(): Promise<ReaderProfile> {
  const reader = await getReader();
  if (!reader) throw new BgError('refused', 'No answer from an AI assistant has been added yet');
  const points = reader.points.filter((p) => p.on);
  if (!points.length) throw new BgError('refused', 'Every point from the AI answer is switched off');
  return { ...reader, points };
}

/** Round 10: the same, or null when there is no answer or every point is off (the page is laid out for anyone). */
async function readerOrNull(): Promise<ReaderProfile | null> {
  const reader = await getReader();
  if (!reader) return null;
  const points = reader.points.filter((p) => p.on);
  return points.length ? { ...reader, points } : null;
}

/* ------------------------------------------------------------------ */
/* The passive fit (round 4): learns the need, never the cause         */
/* ------------------------------------------------------------------ */

const PASSIVE_STORE_KEY = 'passiveStore';
const PASSIVE_STATE_KEY = 'passive';
/** Written with `passive` when open pages should fit again now (see withPassive). */
const PASSIVE_REFIT_KEY = 'passiveRefit';
/** The controller's memory of passive offers shown and announcements made (cleared by "Start fresh"). */
const PASSIVE_UI_KEYS = ['passiveOffers', 'passiveSeen'];

/** OS preferences a page reports (the service worker has no matchMedia). */
type MediaFacts = Partial<Pick<BrowserSettings, 'reducedMotion' | 'contrastMore' | 'forcedColors' | 'colorScheme' | 'reducedTransparency' | 'languages' | 'pointer' | 'anyHover'>>;

function osName(): 'Mac' | 'Windows' | 'ChromeOS' | 'Linux' | null {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return null;
}

let sessionStartIso: string | null = null;
async function sessionStart(): Promise<string> {
  if (sessionStartIso) return sessionStartIso;
  try {
    const got = await chrome.storage.session.get('passiveSession');
    const v = got.passiveSession;
    if (typeof v === 'string') sessionStartIso = v;
    else {
      sessionStartIso = new Date().toISOString();
      await chrome.storage.session.set({ passiveSession: sessionStartIso });
    }
  } catch {
    sessionStartIso = new Date().toISOString();
  }
  return sessionStartIso;
}

async function loadPassiveStore(): Promise<PassiveStore> {
  try {
    const got = await chrome.storage.local.get(PASSIVE_STORE_KEY);
    const v = got[PASSIVE_STORE_KEY];
    if (isPassiveStore(v)) return v;
  } catch {
    /* storage unavailable */
  }
  return emptyPassiveStore();
}

async function passiveState(store: PassiveStore): Promise<PassiveFitState> {
  return buildPassiveState(store, { now: new Date(), sessionStart: await sessionStart(), base: await getFit(), os: osName() });
}

/**
 * One writer at a time: every change reads the latest store, so concurrent tabs never drop each other's evidence.
 * `refit`: the change came from the person or their settings (a correction, an accepted offer, a demo seed, Chrome's
 * font size, Reduce motion), so open pages fit again now; plain evidence waits for each tab's next page.
 */
let passiveChain: Promise<unknown> = Promise.resolve();
function withPassive(
  mutate: (store: PassiveStore) => Promise<PassiveStore> | PassiveStore,
  opts: { refit?: boolean } = {},
): Promise<PassiveFitState> {
  const run = passiveChain.then(async () => {
    const store = await loadPassiveStore();
    const next = await mutate(store);
    const state = await passiveState(next);
    if (next !== store) {
      const refit = opts.refit || next.settingsAt !== store.settingsAt;
      await chrome.storage.local.set({ [PASSIVE_STORE_KEY]: next, [PASSIVE_STATE_KEY]: state, ...(refit ? { [PASSIVE_REFIT_KEY]: Date.now() } : {}) });
    }
    return state;
  });
  passiveChain = run.catch(() => undefined);
  return run;
}

/** Recompute and publish the state without new evidence (the warm-up's fit changed). */
function republishPassive(): void {
  void (passiveChain = passiveChain.then(async () => {
    const store = await loadPassiveStore();
    await chrome.storage.local.set({ [PASSIVE_STATE_KEY]: await passiveState(store), [PASSIVE_REFIT_KEY]: Date.now() });
  }).catch(() => undefined));
}

/** Chrome's own text settings (no permission warning) and default zoom. */
async function readChromeSettings(tabId?: number): Promise<Partial<BrowserSettings>> {
  const out: Partial<BrowserSettings> = {};
  try {
    out.defaultFontPx = (await chrome.fontSettings.getDefaultFontSize({})).pixelSize;
  } catch {
    /* fontSettings unavailable */
  }
  try {
    out.minFontPx = (await chrome.fontSettings.getMinimumFontSize({})).pixelSize;
  } catch {
    /* fontSettings unavailable */
  }
  try {
    let t = tabId;
    if (t === undefined) {
      const tabs = await chrome.tabs.query({});
      t = tabs.find((x) => typeof x.id === 'number' && /^https?:/.test(x.url ?? ''))?.id ?? tabs[0]?.id;
    }
    if (t !== undefined) {
      const z = await chrome.tabs.getZoomSettings(t);
      if (typeof z.defaultZoomFactor === 'number' && z.defaultZoomFactor > 0) out.defaultZoom = Math.round(z.defaultZoomFactor * 100) / 100;
    }
  } catch {
    /* no tab to ask */
  }
  return out;
}

let chromeReadAt = 0;
function pickMedia(m: MediaFacts | undefined): Partial<BrowserSettings> {
  if (!m || typeof m !== 'object') return {};
  const out: Partial<BrowserSettings> = {};
  if (typeof m.reducedMotion === 'boolean') out.reducedMotion = m.reducedMotion;
  if (typeof m.contrastMore === 'boolean') out.contrastMore = m.contrastMore;
  if (typeof m.forcedColors === 'boolean') out.forcedColors = m.forcedColors;
  if (m.colorScheme === 'dark' || m.colorScheme === 'light') out.colorScheme = m.colorScheme;
  if (typeof m.reducedTransparency === 'boolean') out.reducedTransparency = m.reducedTransparency;
  if (Array.isArray(m.languages)) out.languages = m.languages.filter((l): l is string => typeof l === 'string').slice(0, 8);
  if (m.pointer === 'fine' || m.pointer === 'coarse' || m.pointer === 'none') out.pointer = m.pointer;
  if (typeof m.anyHover === 'boolean') out.anyHover = m.anyHover;
  return out;
}

async function getPassive(media?: MediaFacts, tabId?: number): Promise<PassiveFitState> {
  return withPassive(async (store) => {
    let next = store;
    const m = pickMedia(media);
    if (Object.keys(m).length) next = withSettings(next, m);
    if (!next.settings || next.settings.defaultFontPx === null || Date.now() - chromeReadAt > 30_000) {
      chromeReadAt = Date.now();
      next = withSettings(next, await readChromeSettings(tabId));
    }
    return next;
  });
}

/** The person's own zoom changes per tab (not WebAble's, not a navigation's), for held-zoom evidence in the page. */
const personZoom = new Map<number, { at: number; from: number; to: number }>();

/** Note a per-site zoom the person keeps in Chrome (per-origin zoom), in the settings. */
async function notePersonSiteZoom(tabId: number, zoom: number): Promise<void> {
  let host: string | null = null;
  try {
    const tab = await chrome.tabs.get(tabId);
    host = /^https?:/.test(tab.url ?? '') ? siteName(new URL(tab.url as string).hostname) : null;
  } catch {
    host = null;
  }
  if (!host) return;
  const site = host;
  await withPassive((store) => {
    const def = store.settings?.defaultZoom ?? 1;
    const list = (store.settings?.siteZooms ?? []).filter((z) => z.site !== site);
    if (Math.abs(zoom - def) > 0.005) list.push({ site, zoom: Math.round(zoom * 100) / 100 });
    return withSettings(store, { siteZooms: list });
  }).catch(() => undefined);
}

/**
 * At install: Chrome's settings, and the per-site zooms the person already keeps in open tabs (they chose them before
 * WebAble existed; the site's body text is not known yet, so they count at half weight against a 16 px body).
 */
async function passiveInstallScan(): Promise<void> {
  const chromeSettings = await readChromeSettings();
  const def = chromeSettings.defaultZoom ?? 1;
  const zooms: Array<{ site: string; zoom: number }> = [];
  try {
    for (const tab of await chrome.tabs.query({})) {
      if (typeof tab.id !== 'number' || !/^https?:/.test(tab.url ?? '')) continue;
      const site = siteName(new URL(tab.url as string).hostname);
      if (!site || zooms.some((z) => z.site === site)) continue;
      const z = await chrome.tabs.getZoom(tab.id).catch(() => def);
      if (Math.abs(z - def) > 0.005) zooms.push({ site, zoom: Math.round(z * 100) / 100 });
    }
  } catch {
    /* no tabs */
  }
  const now = new Date().toISOString();
  await withPassive((store) => {
    let next = withSettings(store, { ...chromeSettings, siteZooms: zooms });
    const items: PassiveRecord[] = zooms.filter((z) => z.zoom > def + 0.005).map((z) => ({
      dim: 'text_size', weight: 0.5, what: `Chrome had ${z.site} zoomed to ${Math.round(z.zoom * 100)}%`, site: z.site, at: now,
      layer: 'usual', value: Math.round(z.zoom * 16 * 2) / 2, kind: 'site_zoom', zoom: z.zoom,
    }));
    if (items.length) next = addEvidence(next, items);
    return next;
  }).catch(() => undefined);
}

const NOT_RIGHT_SNOOZE_MS = 7 * 24 * 3600 * 1000;

/** Keep one need's learned offer off pages until `ms` from now (the controller's offer memory, never shortened). */
async function snoozePassiveOffer(dim: FitDimension, ms: number): Promise<void> {
  try {
    const got = await chrome.storage.local.get('passiveOffers');
    const mem = (got.passiveOffers && typeof got.passiveOffers === 'object' ? got.passiveOffers : {}) as Record<string, { snoozedUntil?: number }>;
    const until = Math.max(mem[dim]?.snoozedUntil ?? 0, Date.now() + ms);
    await chrome.storage.local.set({ passiveOffers: { ...mem, [dim]: { ...(mem[dim] ?? {}), snoozedUntil: until } } });
  } catch {
    /* storage unavailable: the −2 alone still lowers it */
  }
}

/** "Show a week of learning": a realistic week of evidence (settings and the warm-up stay as they are). */
async function seedDemoHistory(): Promise<PassiveFitState> {
  await chrome.storage.local.remove(PASSIVE_UI_KEYS).catch(() => undefined);
  return withPassive((store) => ({ ...store, records: demoHistory(new Date()), locks: {} }), { refit: true });
}

/** "Start fresh": forget everything learned and every choice made in the panel; Chrome's settings are read again. */
async function resetPassive(): Promise<PassiveFitState> {
  await chrome.storage.local.remove(PASSIVE_UI_KEYS).catch(() => undefined);
  chromeReadAt = 0;
  return withPassive(async (store) => withSettings({ ...emptyPassiveStore(), settings: store.settings, settingsAt: store.settingsAt }, await readChromeSettings()), { refit: true });
}

/* ------------------------------------------------------------------ */
/* Server calls                                                        */
/* ------------------------------------------------------------------ */

async function serverOrigin(): Promise<string> {
  const s = await getSettings();
  const o = (s.serverOrigin || SERVER_ORIGIN).replace(/\/+$/, '');
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o) ? o : SERVER_ORIGIN;
}

async function post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const origin = await serverOrigin();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webable': '1' },
      // Round 7: structured content read on the device (OutlineNode.data) never leaves it, whatever the request.
      body: JSON.stringify(stripLocalData(body)),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (ctrl.signal.aborted) throw new BgError('timeout', `The WebAble server did not answer ${path} within ${timeoutMs / 1000} s`);
    throw new BgError('network', `The WebAble server at ${origin} could not be reached`);
  }
  let text = '';
  try {
    text = await res.text();
  } catch {
    clearTimeout(timer);
    if (ctrl.signal.aborted) throw new BgError('timeout', `The WebAble server did not finish ${path} within ${timeoutMs / 1000} s`);
    throw new BgError('network', 'The answer from the WebAble server was cut off');
  }
  clearTimeout(timer);
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const j = (json ?? {}) as { error?: unknown; message?: unknown };
    const msg = typeof j.message === 'string' ? j.message : typeof j.error === 'string' ? j.error : `HTTP ${res.status}`;
    throw new BgError(res.status === 422 ? 'refused' : 'server', msg, res.status);
  }
  if (json === null) throw new BgError('bad_response', `Empty answer from ${path}`);
  return json as T;
}

async function health(): Promise<HealthInfo> {
  const origin = await serverOrigin();
  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${origin}/health`, { signal: ctrl.signal });
    const j = (await res.json()) as { ok?: unknown; jev?: { warm?: unknown; model?: unknown }; ai?: unknown; openai?: unknown };
    const ok = res.ok && j.ok !== false;
    // HealthStatus.ai ('on' | 'off' | 'no_credits'); an older server only says openai: boolean.
    const ai: HealthInfo['ai'] = j.ai === 'on' || j.ai === 'off' || j.ai === 'no_credits'
      ? j.ai
      : ok && j.openai !== false ? 'on' : 'off';
    const info: HealthInfo = { ok, ai, ms: Math.round(performance.now() - t0) };
    if (j.jev && typeof j.jev === 'object') info.jev = { warm: !!j.jev.warm, model: typeof j.jev.model === 'string' ? j.jev.model : '' };
    if (typeof j.openai === 'boolean') info.openai = j.openai;
    else info.openai = ai === 'on';
    return info;
  } catch {
    return { ok: false, ai: 'off', ms: Math.round(performance.now() - t0), error: ctrl.signal.aborted ? 'timeout' : `not reachable at ${origin}` };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Zoom                                                                */
/* ------------------------------------------------------------------ */

const ourZoom = new Map<number, number>();
const personZoomed = new Set<number>();
/**
 * The zooms WebAble set in each tab in the last few seconds. Its own changes arrive in onZoomChange after later ones
 * may have been made (the listener is async), and switching a tab to per-tab scope fires a change of its own, so a
 * change is WebAble's when it lands on any factor WebAble set recently, not only the latest.
 */
const settingZoom = new Map<number, Array<{ f: number; at: number }>>();
const OUR_ZOOM_WINDOW_MS = 2500;
function wasOurZoom(tabId: number, factor: number): boolean {
  const now = Date.now();
  const list = (settingZoom.get(tabId) ?? []).filter((z) => now - z.at < OUR_ZOOM_WINDOW_MS);
  settingZoom.set(tabId, list);
  return list.some((z) => Math.abs(z.f - factor) < 0.005);
}
const loadingAt = new Map<number, number>();

async function zoomState(tabId: number): Promise<void> {
  if (ourZoom.has(tabId)) return;
  try {
    const got = await chrome.storage.session.get(`zoom:${tabId}`);
    const v = got[`zoom:${tabId}`] as { ours: number; person: boolean } | undefined;
    if (v) {
      ourZoom.set(tabId, v.ours);
      if (v.person) personZoomed.add(tabId);
    }
  } catch {
    /* fresh worker */
  }
}

function saveZoomState(tabId: number): void {
  const ours = ourZoom.get(tabId);
  if (ours === undefined) {
    void chrome.storage.session.remove(`zoom:${tabId}`).catch(() => undefined);
    return;
  }
  void chrome.storage.session.set({ [`zoom:${tabId}`]: { ours, person: personZoomed.has(tabId) } }).catch(() => undefined);
}

async function setZoom(tabId: number, factor: number): Promise<number> {
  const f = Math.min(5, Math.max(0.25, Math.round(factor * 100) / 100));
  settingZoom.set(tabId, [...(settingZoom.get(tabId) ?? []).filter((z) => Date.now() - z.at < OUR_ZOOM_WINDOW_MS), { f, at: Date.now() }]);
  try {
    // Switching scope fires a zoom change of its own: only when the tab is not per-tab yet (round 6: fewer changes).
    const zs = await chrome.tabs.getZoomSettings(tabId).catch(() => null);
    if (!zs || zs.scope !== 'per-tab' || zs.mode !== 'automatic') await chrome.tabs.setZoomSettings(tabId, { mode: 'automatic', scope: 'per-tab' });
  } catch {
    /* some pages (chrome://) refuse; setZoom below reports it */
  }
  ourZoom.set(tabId, f);
  saveZoomState(tabId);
  // The same factor again is no change (and no zoom bubble).
  const now = await chrome.tabs.getZoom(tabId).catch(() => null);
  if (now !== null && Math.abs(now - f) < 0.005) return now;
  await chrome.tabs.setZoom(tabId, f);
  return f;
}

/* ------------------------------------------------------------------ */
/* Screenshots                                                         */
/* ------------------------------------------------------------------ */

const beforeShots = new Map<number, string>();

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function capture(windowId: number): Promise<string> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const long = Math.max(bmp.width, bmp.height);
  if (long <= 1568) {
    bmp.close();
    return dataUrl.replace(/^data:image\/png;base64,/, '');
  }
  const scale = 1568 / long;
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new BgError('bad_response', 'Could not scale the screenshot');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const out = await canvas.convertToBlob({ type: 'image/png' });
  return bytesToBase64(new Uint8Array(await out.arrayBuffer()));
}

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

function updateBadge(tabId: number, report: TabReport): void {
  const applied = report.ops.filter((o) => o.status === 'applied').length;
  const text = report.phase === 'idle' || report.phase === 'error' ? '' : applied ? String(Math.min(applied, 99)) : '';
  void chrome.action.setBadgeText({ tabId, text }).catch(() => undefined);
  void chrome.action.setBadgeBackgroundColor({ tabId, color: '#3A7D44' }).catch(() => undefined);
  void chrome.action.setTitle({ tabId, title: applied ? `WebAble: ${applied} change${applied === 1 ? '' : 's'} on this page` : 'WebAble' }).catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/* Request routing                                                     */
/* ------------------------------------------------------------------ */

async function handle(req: ExtRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const tabId = sender.tab?.id;
  const needTab = (): number => {
    if (tabId === undefined) throw new BgError('refused', 'This request needs a browser tab');
    return tabId;
  };
  switch (req.type) {
    case 'understand':
      // noCache: the page's first read in this session is a live Jev read (honest metrics); later views may be cached.
      return post<PageUnderstanding>('/v1/understand', req.noCache ? { digest: req.digest, noCache: true } : { digest: req.digest }, 12000);
    case 'struggle':
      return post<StruggleJudgment>('/v1/struggle', { signals: req.signals }, 6000);
    case 'redesign':
      return post<RedesignResult>('/v1/redesign', { outline: stripOutlineData(req.outline), fit: req.fit, roles: req.roles }, 22000);
    case 'visualVerify': {
      const t = needTab();
      const windowId = sender.tab?.windowId;
      if (windowId === undefined || !sender.tab?.active) throw new BgError('refused', 'Screenshots need the tab to be in front');
      const shot = await capture(windowId);
      if (req.phase === 'before') {
        beforeShots.set(t, shot);
        void chrome.storage.session.set({ [`vv:${t}`]: shot }).catch(() => undefined);
        return { ok: true };
      }
      let before = beforeShots.get(t);
      if (!before) {
        const got = await chrome.storage.session.get(`vv:${t}`).catch(() => ({} as Record<string, unknown>));
        before = got[`vv:${t}`] as string | undefined;
      }
      if (!before) throw new BgError('refused', 'No "before" screenshot for this tab');
      beforeShots.delete(t);
      void chrome.storage.session.remove(`vv:${t}`).catch(() => undefined);
      const body: VisualVerifyRequest = { before, after: shot, controls: req.controls, help: req.help, mainLabel: req.mainLabel };
      return post<VisualVerdict>('/v1/verify-visual', body, 15000);
    }
    case 'setZoom':
      return setZoom(needTab(), req.factor);
    case 'getZoom':
      return chrome.tabs.getZoom(needTab());
    case 'zoomInfo': {
      const t = needTab();
      await zoomState(t);
      const factor = await chrome.tabs.getZoom(t);
      const info: ZoomInfo = { factor, ours: ourZoom.get(t) ?? null, personChanged: personZoomed.has(t) };
      // Round 4: the person's latest own zoom change in this tab (any, not only after WebAble's), for held zooms.
      const pz = personZoom.get(t);
      return pz ? { ...info, personAt: pz.at, personFrom: pz.from, personTo: pz.to } : info;
    }
    case 'pageStart': {
      // A new document in this tab: per-tab zoom was reset by the navigation; forget what WebAble set.
      const t = needTab();
      ourZoom.delete(t);
      personZoomed.delete(t);
      beforeShots.delete(t);
      saveZoomState(t);
      return { ok: true };
    }
    case 'getFit':
      return getFit();
    case 'getSettings':
      return getSettings();
    case 'report': {
      const t = needTab();
      await chrome.storage.session.set({ [`report:${t}`]: req.report });
      updateBadge(t, req.report);
      return { ok: true };
    }
    case 'openFitting': {
      // The WebAble sheet's "Your settings" asks for the settings view ({ hash: 'settings' }).
      const hash = (req as { hash?: unknown }).hash === 'settings' ? '#settings' : '';
      await chrome.tabs.create({ url: chrome.runtime.getURL(`/fitting.html${hash}`) });
      return { ok: true };
    }
    case 'health':
      return health();
    case 'overlayClose':
      // Jev finds an overlay's own minimise/close button (never asked for consent notices).
      if (req.overlay.kind_hint === 'consent') throw new BgError('refused', 'WebAble never closes consent notices');
      return post<OverlayCloseResult>('/v1/overlay-close', { overlay: req.overlay, candidates: req.candidates.slice(0, 8) }, 8000);
    case 'setFit':
      return setFit(req.fit);
    case 'setSettings':
      return setSettings(req.patch);
    case 'getReport': {
      const t = req.tabId ?? tabId ?? (await activeTabId());
      return t === undefined ? null : getReport(t);
    }
    case 'getPassive':
      // Pages report the OS preferences they see (`media`, round 4); the popup asks without.
      return getPassive((req as { media?: MediaFacts }).media, tabId);
    case 'passiveEvidence': {
      // Hostnames only. A record without a site gets the sending tab's.
      let site: string | null = null;
      try {
        site = sender.tab?.url && /^https?:/.test(sender.tab.url) ? siteName(new URL(sender.tab.url).hostname) : null;
      } catch {
        site = null;
      }
      const items = (Array.isArray(req.items) ? req.items : []).slice(0, 40).map((x) => (x && typeof x === 'object' && !x.site && site ? { ...x, site } : x));
      // The person's Undo or "no" changes what every open page should show; plain evidence waits for the next page.
      const person = items.some((x) => ['undo', 'answer_no'].includes(String((x as { kind?: unknown } | null)?.kind)));
      return withPassive((store) => addEvidence(store, items), { refit: person });
    }
    case 'passiveFeedback': {
      const dim: FitDimension = req.dim;
      // "Not right" also keeps this need's offer away for a week, from the panel and the popup alike.
      if (req.action === 'not_right') await snoozePassiveOffer(dim, NOT_RIGHT_SNOOZE_MS);
      return withPassive(async (store) => {
        const current = (await passiveState(store)).beliefs[dim] ?? null;
        return applyFeedback(store, current, dim, req.action);
      }, { refit: true });
    }
    case 'attribute':
      // Jev attribution (a weight for a held zoom or a page's missed clicks). Structure-only evidence; fails closed.
      return post<AttributionAnswer>('/v1/attribute', { question: req.question }, 6000);
    case 'meaning':
      // Round 7 meaning check: structure-only summaries of the original page and the Calm plan.
      return post<unknown>('/v1/meaning', { req: req.req }, 6000);
    case 'readerImport': {
      // The answer is sent once, broken down on the server and not kept; only the points are saved, on this laptop.
      const text = String(req.req?.text ?? '').trim().slice(0, AI_ANSWER_MAX_CHARS);
      if (text.length < AI_ANSWER_MIN_CHARS) throw new BgError('refused', 'That answer is too short to learn from. Paste the whole answer.');
      const source = typeof req.req.source === 'string' && req.req.source ? req.req.source : undefined;
      const reader = await post<ReaderProfile>('/v1/reader', { req: source ? { text, source } : { text } }, 45000);
      if (!isReader(reader)) throw new BgError('bad_response', 'The WebAble server sent back something unexpected');
      return setReader(reader);
    }
    case 'getReader':
      return getReader();
    case 'setReader':
      return setReader(req.reader);
    case 'rewordScore': {
      // The saved reader goes with every call (points the person switched off never leave the laptop).
      const reader = await readerToSend();
      const paras = (Array.isArray(req.req.paras) ? req.req.paras : []).slice(0, 40);
      return post<RewordScoreResult>('/v1/reword/score', { req: { ...req.req, paras, reader } }, 10000);
    }
    case 'rewordWrite': {
      const reader = await readerToSend();
      const items = (Array.isArray(req.req.items) ? req.req.items : []).slice(0, 8);
      return post<RewordWriteResult>('/v1/reword/write', { req: { ...req.req, items, reader } }, 25000);
    }
    case 'compose': {
      // Round 10: groups of the WebAble page laid out for the person (at most 4 a call).
      const reader = await readerOrNull();
      const groups = (Array.isArray(req.req.groups) ? req.req.groups : []).slice(0, 4);
      return post<ComposeResponse>('/v1/compose', { req: { ...req.req, groups, reader } }, 20000);
    }
    default: {
      const never: never = req;
      throw new BgError('refused', `Unknown request ${(never as { type?: string }).type ?? ''}`);
    }
  }
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}

/* ------------------------------------------------------------------ */
/* Eval-harness hooks                                                  */
/* ------------------------------------------------------------------ */

type DemoName = keyof typeof DEMO_FITS;

interface WebableHooks {
  setFit(fit: FitProfile | DemoName | null): Promise<FitProfile | null>;
  getReport(target?: number | string): Promise<TabReport | null>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  /** Round 4: a realistic week of learning (zooms on 4 sites over 3 days, missed clicks on 3 sites). */
  seedDemoHistory(): Promise<PassiveFitState>;
  /** Round 4: forget everything WebAble learned. */
  resetPassive(): Promise<PassiveFitState>;
  /** Round 4: what WebAble has learned, now. */
  getPassive(): Promise<PassiveFitState>;
}

const hooks: WebableHooks = {
  async setFit(fit) {
    if (typeof fit === 'string') {
      const demo = (DEMO_FITS as Record<string, FitProfile>)[fit];
      if (!demo) throw new Error(`Unknown demo fit "${fit}" (rosa, typical, reader)`);
      return setFit({ ...demo, createdAt: new Date().toISOString() });
    }
    return setFit(fit);
  },
  async getReport(target) {
    if (typeof target === 'number') return getReport(target);
    if (typeof target === 'string') {
      // A URL (or part of one): the most recent report whose url contains it.
      const all = await chrome.storage.session.get(null);
      for (const [k, v] of Object.entries(all)) {
        if (k.startsWith('report:') && (v as TabReport | undefined)?.url?.includes(target)) return v as TabReport;
      }
      return null;
    }
    const t = await activeTabId();
    return t === undefined ? null : getReport(t);
  },
  setSettings,
  seedDemoHistory,
  resetPassive,
  getPassive: () => getPassive(),
};

/* ------------------------------------------------------------------ */
/* Worker                                                              */
/* ------------------------------------------------------------------ */

export default defineBackground(() => {
  (globalThis as { __webable?: WebableHooks }).__webable = hooks;

  // Content scripts may read and write session storage (the Calm view cache).
  void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => undefined);

  // Round 8c: the onboarding's real-website tasks (messages with a `siteTask` field; its own listener).
  registerSiteTasks();

  chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    if (!isEnvelope(msg)) return false;
    // Round 4 demo requests from the popup ("Show a week of learning", "Start fresh"), beyond the ExtRequest union.
    const demo = (msg.req as { type: string }).type;
    if (demo === 'seedDemoHistory' || demo === 'resetPassive') {
      (demo === 'seedDemoHistory' ? seedDemoHistory() : resetPassive()).then(
        (data) => sendResponse({ ok: true, data } satisfies BusReply),
        (err: unknown) => sendResponse(toReply(err)),
      );
      return true;
    }
    handle(msg.req, sender).then(
      (data) => sendResponse({ ok: true, data: data ?? null } satisfies BusReply),
      (err: unknown) => sendResponse(toReply(err)),
    );
    return true; // async reply
  });

  chrome.runtime.onInstalled.addListener((details) => {
    // Round 4: what the person already chose in Chrome, read at install (and on update), no questions asked.
    // No onboarding tab: WebAble fits from these settings at once; the warm-up stays one click away in the popup.
    if (details.reason === 'install') void passiveInstallScan();
    else void getPassive().catch(() => undefined);
  });

  // The person's own zoom wins: a change WebAble did not make stops page scale in that tab.
  chrome.tabs.onZoomChange.addListener((info) => {
    const { tabId, newZoomFactor } = info;
    // Decided now, before any await: whether WebAble set this factor a moment ago (or the scope switch fired it).
    const unchanged = Math.abs(info.oldZoomFactor - newZoomFactor) < 0.004;
    const ourChange = wasOurZoom(tabId, newZoomFactor);
    const at = Date.now();
    void (async () => {
      await zoomState(tabId);
      if (unchanged || ourChange) return;
      const loading = loadingAt.get(tabId);
      if (loading !== undefined && at - loading < 3000) return; // reset (or restored per site) by a navigation
      const ours = ourZoom.get(tabId);
      if (ours !== undefined && Math.abs(ours - newZoomFactor) < 0.005) return;
      // The person's own change (Ctrl/Cmd +/−, pinch, Chrome's menu). Round 4: noted for held-zoom evidence.
      personZoom.set(tabId, { at, from: info.oldZoomFactor, to: newZoomFactor });
      if (info.zoomSettings?.scope === 'per-origin' && ours === undefined) void notePersonSiteZoom(tabId, newZoomFactor);
      if (ours === undefined) return;
      // After WebAble set it: the person's own zoom wins from now on in this tab.
      personZoomed.add(tabId);
      saveZoomState(tabId);
    })();
  });

  chrome.tabs.onUpdated.addListener((tabId, change) => {
    // Navigations reset per-tab zoom; such a change is not the person's choice. (The new document's content
    // script sends 'pageStart', which clears what WebAble set.)
    if (change.status === 'loading') loadingAt.set(tabId, Date.now());
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    personZoom.delete(tabId);
    settingZoom.delete(tabId);
    ourZoom.delete(tabId);
    personZoomed.delete(tabId);
    beforeShots.delete(tabId);
    loadingAt.delete(tabId);
    void chrome.storage.session.remove([`report:${tabId}`, `vv:${tabId}`, `zoom:${tabId}`]).catch(() => undefined);
  });

  // Round 4: Chrome's font sizes changed: read them again (pages fit again if the effective fit changes).
  const refreshChrome = () => {
    chromeReadAt = 0;
    void getPassive().catch(() => undefined);
  };
  try {
    chrome.fontSettings.onDefaultFontSizeChanged.addListener(refreshChrome);
    chrome.fontSettings.onMinimumFontSizeChanged.addListener(refreshChrome);
  } catch {
    /* fontSettings unavailable */
  }
  // A new warm-up changes which needs it decided: publish the beliefs again.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'fit' in changes) republishPassive();
  });
});
