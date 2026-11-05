// Owner: P (round 4). The passive fit: what WebAble learns without asking. WebAble learns the need, never the cause.
//
// signals.md §4 ("Passive fit"). One belief per functional need (FitDimension). Code does all the maths; Jev only
// answers attribution questions ("was this zoom for text or for a picture?"), which arrive here as a weight w in [0, 1].
//  - Text size is a Gaussian over log2(comfortable body px / 16). Prior: Chrome's default font × default zoom, σ0 0.25
//    when either was changed, else 0.5. Each zoom the person holds on a real site is an observation
//    y = log2(zoom × siteBodyPx / 16), σ_obs 0.3, weighted w × 0.5^(days / 30). Not zooming is never evidence.
//  - Binary needs (bigger click areas, steady clicks) are log-odds from L0 = logit(0.10). A miss adds
//    w · ln(0.283 / 0.063) = +1.50 and a clean click ln(0.717 / 0.937) = −0.27 (Hurst 2008 error rates), capped at ±2 per
//    page; the total decays back to L0 with a 14-day half-life and is clamped to ±4.
//  - The person overrides everything: "Not right" adds −2, Undo adds −3, and an explicit answer locks the value.
//  - Two layers. "Now" (this browser session) may offer. "Usual" applies by default only on evidence from ≥ 3 sites on
//    ≥ 2 days, and no single day moves it by more than 2.5, so one bad day never becomes the person's usual.
//  - Actions: P ≥ 0.9 and the multi-day rule met → apply with Undo; 0.7–0.9 → offer; 0.4–0.7 (and acting would move
//    at least one step) → at most one question a week; else nothing. A setting the person chose is applied as set.
//  - Every belief explains itself in the person's own actions ("Text is larger because you zoomed in on 4 sites this
//    week (average 133%).").
// `effectiveFit` merges it all into the FitProfile the page is fitted with: person-locked > warm-up > learned (usual,
// apply) > settings > default. With no warm-up at all, WebAble still fits from settings and learning.
//
// Kept: what happened on the page (hostnames, counts, zoom levels, body text sizes) and what the person chose.
// Never kept or computed: physiology, age, emotion or a condition. No tremor frequency, no keystroke timing, no age.
import type {
  BrowserSettings, DimensionBelief, FitDimension, FitProfile, Offer, OfferKind, PassiveEvidence, PassiveFitState,
} from '../types';
import { defaultFit, fitSources as savedFitSources } from './derive';

/* ------------------------------------------------------------------ */
/* Constants (signals.md §4; the thresholds are design choices)        */
/* ------------------------------------------------------------------ */

export const FIT_DIMENSIONS: readonly FitDimension[] = Object.freeze([
  'text_size', 'contrast', 'targets', 'steady_clicks', 'motion', 'clutter', 'reading_support', 'colors',
] as FitDimension[]);

const logit = (p: number): number => Math.log(p / (1 - p));
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export const PASSIVE = Object.freeze({
  /** Binary needs start at P = 0.10. */
  priorP: 0.1,
  /** Hurst 2008 per-click error rates: 28.3% (people who need help pointing) vs 6.3% (typical) in real use. */
  missRateNeed: 0.283,
  missRateTypical: 0.063,
  /** ln(0.283 / 0.063) = +1.502 per miss. */
  llrMiss: Math.log(0.283 / 0.063),
  /** ln(0.717 / 0.937) = −0.268 per clean click. */
  llrClean: Math.log((1 - 0.283) / (1 - 0.063)),
  /** One page view moves a binary belief by at most this much either way. */
  pageCap: 2,
  /** One local day moves the "usual" layer by at most this much either way. */
  usualDayCap: 2.5,
  /** Log-odds are kept within ±4. */
  clamp: 4,
  halfLifeDays: 14,
  textHalfLifeDays: 30,
  /** UNVERIFIED in the brief; the spread of one held zoom around the comfortable size, in log2 units. */
  textSigmaObs: 0.3,
  textSigmaPriorChanged: 0.25,
  textSigmaPrior: 0.5,
  /** One Chrome zoom step from 100% (110%), in log2 units. */
  zoomStep: Math.log2(1.1),
  notRight: -2,
  undo: -3,
  apply: 0.9,
  offer: 0.7,
  ask: 0.4,
  usualSites: 3,
  usualDays: 2,
  /** An "on every site?" offer needs the need on at least this many sites. */
  offerSites: 2,
  askEveryDays: 7,
  /** Click areas: 24 px for a fine pointer, 44 px for a coarse one or when the need applies. */
  targetsFine: 24,
  targetsCoarse: 44,
  targetsNeed: 44,
  /** A weak prior only: dark mode is often chosen for looks. */
  darkSchemeLlr: 0.85,
  maxRecordsPerDim: 300,
  maxAgeDays: 120,
  /** Evidence older than this does not count towards the multi-day rule's sites and days. */
  usualWindowDays: 30,
  maxBeliefEvidence: 12,
  /**
   * A size record is named in explanations and counted towards the multi-day rule's sites and days only when its
   * attribution weight is at least this: a zoom Jev says was for a picture still enters the maths at its small weight,
   * but "You zoomed in on 2 sites" never counts it.
   */
  namedWeight: 0.5,
});

export const L0 = logit(PASSIVE.priorP);

const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ */
/* Stored evidence                                                     */
/* ------------------------------------------------------------------ */

/**
 * What kind of thing a record says happened.
 * zoom: the person held a zoom ≥ 5 s · step: A−/A+ in WebAble's panel · site_zoom: a per-site zoom Chrome already had
 * at install · accept: the person took a "larger text" offer on one page · clicks: one page view's pointer clicks ·
 * not_right / undo: the person corrected a learned need · answer_no: an explicit "no" to WebAble's question.
 */
export type PassiveRecordKind = 'zoom' | 'step' | 'site_zoom' | 'accept' | 'clicks' | 'not_right' | 'undo' | 'answer_no';

/** A PassiveEvidence with the counts behind it (stored on this laptop only; hostnames, never URLs). */
export interface PassiveRecord extends PassiveEvidence {
  kind?: PassiveRecordKind;
  /** clicks: pointer clicks on the page view, and how many of them were misses of this dimension's kind. */
  clicks?: number;
  misses?: number;
  /** One id per page view: later flushes of the same page replace its record (the ±2 cap is per page). */
  page?: string;
  /** Size observations: the zoom held and the site's own body text size (CSS px at 100%). */
  zoom?: number;
  bodyPx?: number;
}

/** An explicit choice. `on: false` is "not for me" and beats everything the warm-up, settings or learning say. */
export interface PassiveLock {
  on: boolean;
  value: number | null;
  at: string;
}

export interface PassiveStore {
  v: 'passive-store.1';
  settings: BrowserSettings | null;
  settingsAt: string | null;
  records: PassiveRecord[];
  locks: Partial<Record<FitDimension, PassiveLock>>;
  createdAt: string;
}

export function emptyPassiveStore(now: Date = new Date()): PassiveStore {
  return { v: 'passive-store.1', settings: null, settingsAt: null, records: [], locks: {}, createdAt: now.toISOString() };
}

export function isPassiveStore(x: unknown): x is PassiveStore {
  if (!x || typeof x !== 'object') return false;
  const s = x as Partial<PassiveStore>;
  return s.v === 'passive-store.1' && Array.isArray(s.records) && !!s.locks && typeof s.locks === 'object';
}

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = Object.freeze({
  defaultFontPx: null,
  minFontPx: null,
  defaultZoom: null,
  siteZooms: [],
  reducedMotion: false,
  contrastMore: false,
  forcedColors: false,
  colorScheme: 'light',
  reducedTransparency: false,
  languages: [],
  pointer: 'fine',
  anyHover: true,
}) as BrowserSettings;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const half = (v: number): number => Math.round(v * 2) / 2;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const isDim = (d: unknown): d is FitDimension => typeof d === 'string' && (FIT_DIMENSIONS as readonly string[]).includes(d);

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Local calendar day, 'YYYY-MM-DD'. */
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whole local days between t and now (0 = today). */
function daysBefore(t: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(t)) / DAY_MS);
}

/** Hostname for evidence: lower case, no 'www.', no port, no path. Null when it does not look like one. */
export function siteName(s: string | null | undefined): string | null {
  if (!s) return null;
  let h = String(s).trim().toLowerCase();
  h = h.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
  if (!h || h.length > 80 || !/^[a-z0-9.-]+$/.test(h)) return null;
  return h;
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, error < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

const decay = (ageDays: number, halfLife: number): number => (ageDays <= 0 ? 1 : 0.5 ** (ageDays / halfLife));

function pct(z: number): string {
  return `${Math.round(z * 100)}%`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* ------------------------------------------------------------------ */
/* The update rules (exported for tests and the simulation)            */
/* ------------------------------------------------------------------ */

/**
 * One click into a binary belief, exactly as signals/sim_passive_fit.py does it: a miss adds w · 1.50, a clean click
 * −0.27; the page's running total stays within ±2 (the part past the cap is dropped), and L stays within ±4.
 */
export function clickStep(L: number, pageSum: number, miss: boolean, w = 1): { L: number; pageSum: number; d: number } {
  let d = miss ? clamp(w, 0, 1) * PASSIVE.llrMiss : PASSIVE.llrClean;
  const cap = PASSIVE.pageCap;
  if (Math.abs(pageSum + d) > cap) d = Math.max(-cap - pageSum, Math.min(cap - pageSum, d));
  return { L: clamp(L + d, -PASSIVE.clamp, PASSIVE.clamp), pageSum: pageSum + d, d };
}

/** A page view's capped contribution from its click outcomes in order (true = a miss of this kind). */
export function pageClickWeight(outcomes: readonly boolean[], w = 1): number {
  let sum = 0;
  for (const miss of outcomes) sum = clickStep(0, sum, miss, w).pageSum;
  return r3(sum);
}

/** The text observation for a held zoom: log2(zoom × siteBodyPx / 16). */
export function textObservation(zoom: number, siteBodyPx: number): number {
  const z = finite(zoom) && zoom > 0 ? zoom : 1;
  const b = finite(siteBodyPx) && siteBodyPx > 0 ? siteBodyPx : 16;
  return Math.log2((z * b) / 16);
}

/** The action a probability earns (the multi-day rule gates 'apply'). */
export function actionFor(p: number, multiDay: boolean): DimensionBelief['action'] {
  if (p >= PASSIVE.apply && multiDay) return 'apply';
  if (p >= PASSIVE.offer) return 'offer';
  if (p >= PASSIVE.ask) return 'ask';
  return 'none';
}

/**
 * An offer to change *every* site waits until the need has shown on at least two sites: one site may just be small
 * or crowded. Until then a strong belief is held at 'ask' (and the page only asks once it has a second site or an
 * earlier session to go on). Applying by default already needs ≥ 3 sites on ≥ 2 days.
 */
export function everySiteAction(action: DimensionBelief['action'], sites: number): DimensionBelief['action'] {
  return action === 'offer' && sites < PASSIVE.offerSites ? 'ask' : action;
}

/* ------------------------------------------------------------------ */
/* Adding evidence and the person's feedback                           */
/* ------------------------------------------------------------------ */

const SIZE_KINDS: ReadonlySet<PassiveRecordKind> = new Set<PassiveRecordKind>(['zoom', 'step', 'site_zoom', 'accept']);
const FEEDBACK_KINDS: ReadonlySet<PassiveRecordKind> = new Set<PassiveRecordKind>(['not_right', 'undo']);

/** Clean one incoming record, or null when it is not usable. Nothing but the known fields is kept. */
export function cleanRecord(x: unknown, now: Date = new Date()): PassiveRecord | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Partial<PassiveRecord>;
  if (!isDim(r.dim) || !finite(r.weight)) return null;
  const at = timeOf(r.at) ?? now.getTime();
  if (at > now.getTime() + 60_000) return null;
  const kinds: PassiveRecordKind[] = ['zoom', 'step', 'site_zoom', 'accept', 'clicks', 'not_right', 'undo', 'answer_no'];
  const kind: PassiveRecordKind | undefined = kinds.includes(r.kind as PassiveRecordKind)
    ? (r.kind as PassiveRecordKind)
    : r.dim === 'text_size' && finite(r.value) ? 'zoom' : undefined;
  if (!kind) return null;
  let weight = r.weight;
  if (SIZE_KINDS.has(kind)) {
    if (r.dim !== 'text_size' || !finite(r.value)) return null;
    weight = clamp(weight, 0, 1);
  } else if (kind === 'clicks') weight = clamp(weight, -PASSIVE.pageCap, PASSIVE.pageCap);
  else if (FEEDBACK_KINDS.has(kind)) weight = clamp(weight, -3, 0);
  else weight = 0;
  const out: PassiveRecord = {
    dim: r.dim,
    weight: r3(weight),
    what: typeof r.what === 'string' ? r.what.replace(/\s+/g, ' ').trim().slice(0, 160) : '',
    at: new Date(at).toISOString(),
    layer: r.layer === 'usual' ? 'usual' : 'now',
    kind,
  };
  const site = siteName(r.site);
  if (site) out.site = site;
  if (finite(r.value)) out.value = half(clamp(r.value, 6, 96));
  if (finite(r.zoom)) out.zoom = Math.round(clamp(r.zoom, 0.25, 5) * 100) / 100;
  if (finite(r.bodyPx)) out.bodyPx = half(clamp(r.bodyPx, 6, 96));
  if (finite(r.clicks)) out.clicks = Math.max(0, Math.round(r.clicks));
  if (finite(r.misses)) out.misses = Math.max(0, Math.min(out.clicks ?? Infinity, Math.round(r.misses)));
  if (typeof r.page === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(r.page)) out.page = r.page;
  return out;
}

function prune(records: PassiveRecord[], now: Date): PassiveRecord[] {
  const cut = now.getTime() - PASSIVE.maxAgeDays * DAY_MS;
  const kept = records.filter((r) => (timeOf(r.at) ?? 0) >= cut);
  kept.sort((a, b) => (timeOf(a.at) ?? 0) - (timeOf(b.at) ?? 0));
  const byDim = new Map<FitDimension, number>();
  const out: PassiveRecord[] = [];
  for (let i = kept.length - 1; i >= 0; i--) {
    const r = kept[i] as PassiveRecord;
    const n = byDim.get(r.dim) ?? 0;
    if (n >= PASSIVE.maxRecordsPerDim) continue;
    byDim.set(r.dim, n + 1);
    out.push(r);
  }
  return out.reverse();
}

/**
 * Add evidence. A record with the same page view id and dimension replaces the earlier one (content scripts send a
 * page's running, capped total each time). An explicit "no" locks the need off; Undo releases a lock.
 */
export function addEvidence(store: PassiveStore, items: readonly unknown[], now: Date = new Date()): PassiveStore {
  let records = [...store.records];
  const locks = { ...store.locks };
  for (const raw of items) {
    const r = cleanRecord(raw, now);
    if (!r) continue;
    if (r.kind === 'answer_no') {
      locks[r.dim] = { on: false, value: null, at: r.at };
      continue;
    }
    if (r.kind === 'undo') delete locks[r.dim];
    if (r.page) records = records.filter((x) => !(x.page === r.page && x.dim === r.dim && x.kind === r.kind));
    records.push(r);
  }
  return { ...store, records: prune(records, now), locks };
}

/** Forget every learned record of one need (settings are read again, never stored as evidence). */
function forgetRecords(store: PassiveStore, dim: FitDimension): PassiveRecord[] {
  return store.records.filter((r) => r.dim !== dim);
}

/**
 * The person corrects one need, through the panel's "Not right" / "Forget this" or by accepting an offer ('confirm').
 * What it does depends on where the need came from (the current belief):
 *  - confirm: locks it on at its current value.
 *  - learned: "Not right" adds −2; "Forget this" deletes what was learned.
 *  - person (locked): "Not right" releases the lock and adds −2; "Forget this" releases it and deletes the records.
 *  - settings or warm-up: WebAble cannot change Chrome or the warm-up, so both lock the need off for now (a newer
 *    warm-up wins again).
 */
export function applyFeedback(
  store: PassiveStore,
  belief: DimensionBelief | null,
  dim: FitDimension,
  action: 'not_right' | 'forget' | 'confirm',
  now: Date = new Date(),
): PassiveStore {
  const at = now.toISOString();
  const locks = { ...store.locks };
  let records = [...store.records];
  const source = belief?.source ?? 'default';
  if (action === 'confirm') {
    let value = belief?.value ?? null;
    if (dim === 'targets' && !(finite(value) && value > PASSIVE.targetsFine)) value = PASSIVE.targetsNeed;
    locks[dim] = { on: true, value, at };
    return { ...store, locks };
  }
  if (source === 'setting' || source === 'warmup') {
    locks[dim] = { on: false, value: null, at };
    return { ...store, locks };
  }
  const wasLocked = !!locks[dim];
  delete locks[dim];
  if (action === 'forget') records = forgetRecords(store, dim);
  else if (source === 'learned' || wasLocked) {
    records.push({ dim, weight: PASSIVE.notRight, what: 'You said this was not right', at, layer: 'usual', kind: 'not_right' });
  }
  return { ...store, records: prune(records, now), locks };
}

/** Merge the latest browser settings into the store (null fields keep what was known). */
export function withSettings(store: PassiveStore, patch: Partial<BrowserSettings>, now: Date = new Date()): PassiveStore {
  const prev = store.settings ?? { ...DEFAULT_BROWSER_SETTINGS, siteZooms: [], languages: [] };
  const next: BrowserSettings = { ...prev };
  const set = <K extends keyof BrowserSettings>(k: K) => {
    const v = patch[k];
    if (v !== undefined) next[k] = v as BrowserSettings[K];
  };
  (Object.keys(DEFAULT_BROWSER_SETTINGS) as Array<keyof BrowserSettings>).forEach(set);
  next.siteZooms = (next.siteZooms ?? [])
    .map((z) => ({ site: siteName(z.site) ?? '', zoom: Math.round(z.zoom * 100) / 100 }))
    .filter((z) => z.site && finite(z.zoom) && z.zoom > 0)
    .slice(-50);
  next.languages = (next.languages ?? []).filter((l) => typeof l === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l)).slice(0, 8);
  const changed = JSON.stringify(prev) !== JSON.stringify(next) || !store.settings;
  return changed ? { ...store, settings: next, settingsAt: now.toISOString() } : store;
}

/* ------------------------------------------------------------------ */
/* Beliefs                                                             */
/* ------------------------------------------------------------------ */

export interface BuildOptions {
  now?: Date;
  /** When this browser session started (the "now" layer). Defaults to the start of today. */
  sessionStart?: string | null;
  /** The warm-up's profile, if any (its values outrank learning; a newer warm-up beats an older lock). */
  base?: FitProfile | null;
  /** 'Mac' makes the settings sentences say "your Mac". */
  os?: 'Mac' | 'Windows' | 'ChromeOS' | 'Linux' | null;
}

/** A base fit from a warm-up (or a demo fit), as opposed to the untouched default. */
export function isWarmup(base: FitProfile | null | undefined): base is FitProfile {
  if (!base || base.v !== 'fit.1') return false;
  const v = base.calibration?.version ?? 'default';
  return v !== 'default' && v !== 'passive';
}

/**
 * Where the saved warm-up fit says one need came from ('warmup', 'person', 'setting' or 'default'). The warm-up writes
 * these; fits saved before round 4 count anything measured as the warm-up.
 */
export function baseSource(base: FitProfile | null | undefined, dim: FitDimension): DimensionBelief['source'] {
  if (!isWarmup(base)) return 'default';
  try {
    return savedFitSources(base)[dim] ?? 'default';
  } catch {
    return 'default';
  }
}

/** The warm-up (or the person, on its result screen) decided this need: it outranks learning and settings. */
function warmDecided(base: FitProfile | null | undefined, dim: FitDimension): boolean {
  const s = baseSource(base, dim);
  return s === 'warmup' || s === 'person';
}

/** The body size the person gets from Chrome's own settings (CSS px at 100%, before WebAble), and whether they set it. */
export function settingsTextPx(s: BrowserSettings | null | undefined): { px: number; changed: boolean; font: number; zoom: number } {
  const font = s && finite(s.defaultFontPx) && s.defaultFontPx > 0 ? s.defaultFontPx : 16;
  const zoom = s && finite(s.defaultZoom) && s.defaultZoom > 0 ? s.defaultZoom : 1;
  const changed = Math.abs(font - 16) >= 0.5 || Math.abs(zoom - 1) >= 0.01;
  return { px: half(font * zoom), changed, font, zoom };
}

function lockFor(store: PassiveStore, dim: FitDimension, base: FitProfile | null | undefined): PassiveLock | null {
  const l = store.locks[dim];
  if (!l) return null;
  // A newer warm-up wins over an older explicit choice (the person just measured again).
  if (isWarmup(base)) {
    const lt = timeOf(l.at) ?? 0;
    const bt = timeOf(base.createdAt) ?? 0;
    if (bt > lt) return null;
  }
  return l;
}

interface Ctx {
  store: PassiveStore;
  now: number;
  nowIso: string;
  session: number;
  base: FitProfile | null;
  warm: boolean;
  settings: BrowserSettings | null;
  os: BuildOptions['os'];
}

function toEvidence(r: PassiveRecord, session: number): PassiveEvidence {
  const e: PassiveEvidence = { dim: r.dim, weight: r.weight, what: r.what, at: r.at, layer: (timeOf(r.at) ?? 0) >= session ? 'now' : 'usual' };
  if (r.site) e.site = r.site;
  if (finite(r.value)) e.value = r.value;
  return e;
}

function recentFirst(rs: PassiveRecord[]): PassiveRecord[] {
  return [...rs].sort((a, b) => (timeOf(b.at) ?? 0) - (timeOf(a.at) ?? 0));
}

function settingEvidence(dim: FitDimension, what: string, ctx: Ctx): PassiveEvidence {
  return { dim, weight: PASSIVE.clamp, what, at: ctx.store.settingsAt ?? ctx.nowIso, layer: 'usual' };
}

function computer(ctx: Ctx): string {
  return ctx.os === 'Mac' ? 'your Mac' : 'your computer';
}

/** "today", "this week", "in the last 12 days", for the evidence times given. */
function periodWords(times: number[], now: number): string {
  if (!times.length) return '';
  const oldest = daysBefore(Math.min(...times), now);
  if (oldest <= 0) return 'today';
  if (oldest === 1 && times.every((t) => daysBefore(t, now) <= 1)) return 'since yesterday';
  if (oldest < 7) return 'this week';
  return `in the last ${oldest + 1} days`;
}

function belief(dim: FitDimension, p: number, value: number | null, source: DimensionBelief['source'], action: DimensionBelief['action'],
  explanation: string, evidence: PassiveEvidence[], ctx: Ctx, extra: { locked?: boolean; sites?: number; days?: number; updatedAt?: string } = {}): DimensionBelief {
  return {
    dim,
    p: r3(clamp(p, 0, 1)),
    value,
    source,
    action,
    explanation,
    evidence: evidence.slice(0, PASSIVE.maxBeliefEvidence),
    locked: !!extra.locked,
    sites: extra.sites ?? 0,
    days: extra.days ?? 0,
    updatedAt: extra.updatedAt ?? ctx.nowIso,
  };
}

/** Decayed sum of the person's corrections (−2, −3) on one need, in log-odds. */
function feedbackOffset(records: PassiveRecord[], now: number): number {
  let off = 0;
  for (const r of records) {
    if (!r.kind || !FEEDBACK_KINDS.has(r.kind)) continue;
    const t = timeOf(r.at) ?? now;
    off += r.weight * decay((now - t) / DAY_MS, PASSIVE.halfLifeDays);
  }
  return off;
}

/* ---------------- text size (Gaussian) ---------------- */

interface TextObs { site: string | null; day: string; t: number; y: number; w: number; zoom: number | null; rec: PassiveRecord }

export interface TextPosterior { mu: number; sigma: number; mu0: number; sigma0: number; n: number }

/** The posterior over log2(comfortable px / 16) from the settings prior and size observations. */
export function textPosterior(settings: BrowserSettings | null | undefined, obs: Array<{ y: number; w: number; ageDays: number }>): TextPosterior {
  const sp = settingsTextPx(settings);
  const mu0 = Math.log2((sp.font / 16) * sp.zoom);
  const sigma0 = sp.changed ? PASSIVE.textSigmaPriorChanged : PASSIVE.textSigmaPrior;
  let tau = 1 / (sigma0 * sigma0);
  let num = mu0 * tau;
  const so2 = PASSIVE.textSigmaObs * PASSIVE.textSigmaObs;
  let n = 0;
  for (const o of obs) {
    const w = clamp(o.w, 0, 1) * decay(o.ageDays, PASSIVE.textHalfLifeDays);
    if (!(w > 0) || !finite(o.y)) continue;
    tau += w / so2;
    num += (w * o.y) / so2;
    n++;
  }
  return { mu: num / tau, sigma: 1 / Math.sqrt(tau), mu0, sigma0, n };
}

/** P(the comfortable size is at least one Chrome zoom step above `basePx`), i.e. the 80% interval excludes it at 0.9. */
export function textNeedP(post: TextPosterior, basePx: number): number {
  const t = Math.log2(basePx / 16) + PASSIVE.zoomStep;
  return normalCdf((post.mu - t) / post.sigma);
}

function textObservations(ctx: Ctx): TextObs[] {
  const rs = ctx.store.records.filter((r) => r.dim === 'text_size' && r.kind && SIZE_KINDS.has(r.kind) && finite(r.value));
  // One observation per site and day (the latest), so zooming in and out on one page counts once.
  const byKey = new Map<string, TextObs>();
  for (const r of rs) {
    const t = timeOf(r.at) ?? ctx.now;
    const day = dayKey(t);
    const key = `${r.site ?? '?'}|${day}`;
    const o: TextObs = { site: r.site ?? null, day, t, y: Math.log2((r.value as number) / 16), w: r.weight, zoom: finite(r.zoom) ? r.zoom : null, rec: r };
    const prev = byKey.get(key);
    if (!prev || prev.t <= t) byKey.set(key, o);
  }
  return [...byKey.values()].sort((a, b) => a.t - b.t);
}

function textExplanation(kind: 'apply' | 'offer' | 'ask', up: TextObs[], now: number): string {
  const sites = [...new Set(up.map((o) => o.site).filter((s): s is string => !!s))];
  const when = periodWords(up.map((o) => o.t), now);
  const zooms = up.map((o) => o.zoom).filter((z): z is number => z !== null && z > 1);
  const avg = zooms.length ? zooms.reduce((a, b) => a + b, 0) / zooms.length : null;
  const where = sites.length === 1 ? `on ${sites[0]}` : `on ${plural(Math.max(sites.length, 1), 'site')}`;
  const allSteps = up.every((o) => o.rec.kind === 'step');
  const did = allSteps ? 'made text larger' : 'zoomed in';
  if (kind === 'apply') return `Text is larger because you ${did} ${where} ${when}${avg ? ` (average ${pct(avg)})` : ''}.`.replace(/\s+\./, '.');
  return `You ${did} ${where} ${when}.`.replace(/\s+\./, '.');
}

function textBelief(ctx: Ctx): DimensionBelief {
  const dim: FitDimension = 'text_size';
  const recs = ctx.store.records.filter((r) => r.dim === dim);
  const sp = settingsTextPx(ctx.settings);
  const lock = lockFor(ctx.store, dim, ctx.base);
  const warmText0 = warmDecided(ctx.base, 'text_size');
  const refPx = Math.max(warmText0 && ctx.base ? (ctx.base.text.override ?? ctx.base.text.bodyPx) : sp.px, ctx.settings?.minFontPx ?? 0);
  // What the person did that points to larger text (a zoom back out is still counted in the maths, not listed here).
  const evidence = recentFirst(recs.filter((r) => r.kind && SIZE_KINDS.has(r.kind) && finite(r.value) && r.value >= refPx * 1.1 - 0.25 && r.weight >= PASSIVE.namedWeight))
    .map((r) => toEvidence(r, ctx.session));
  if (lock) {
    const v = lock.on ? (finite(lock.value) ? lock.value : null) : null;
    const text = lock.on
      ? `You chose larger text on every site${v ? ` (${Math.round(v)} px)` : ''}.`
      : 'You turned larger text off; WebAble leaves text at each site’s size.';
    return belief(dim, lock.on ? 1 : 0, v, 'person', lock.on ? 'apply' : 'none', text, evidence, ctx, { locked: true, updatedAt: lock.at });
  }
  const warmText = warmDecided(ctx.base, 'text_size');
  const warmPx = warmText && ctx.base ? (ctx.base.text.override ?? ctx.base.text.bodyPx) : null;
  const basePx = Math.max(warmPx ?? sp.px, ctx.settings?.minFontPx ?? 0);

  const obs = textObservations(ctx);
  const post = textPosterior(ctx.settings, obs.map((o) => ({ y: o.y, w: o.w, ageDays: (ctx.now - o.t) / DAY_MS })));
  const valuePx = half(16 * 2 ** post.mu);
  const pg = post.n ? clamp(textNeedP(post, basePx), 1e-4, 1 - 1e-4) : PASSIVE.priorP;
  const p = sigmoid(logit(pg) + feedbackOffset(recs, ctx.now));
  const up = obs.filter((o) => 16 * 2 ** o.y >= basePx * 1.1 - 0.25 && o.w >= PASSIVE.namedWeight && ctx.now - o.t <= PASSIVE.usualWindowDays * DAY_MS);
  const sites = new Set(up.map((o) => o.site ?? '?')).size;
  const days = new Set(up.map((o) => o.day)).size;
  const multiDay = sites >= PASSIVE.usualSites && days >= PASSIVE.usualDays;
  const moves = valuePx >= basePx * 1.1 - 0.25;
  const last = obs.length ? new Date((obs[obs.length - 1] as TextObs).t).toISOString() : ctx.nowIso;
  const extra = { sites, days, updatedAt: last };

  // Learning that points past what is in effect: offered (a warm-up value is never overridden silently).
  if (post.n && moves) {
    let action = everySiteAction(actionFor(p, multiDay), sites);
    if (warmText && action === 'apply') action = 'offer';
    if (action !== 'none') {
      return belief(dim, p, valuePx, 'learned', action, textExplanation(action === 'apply' ? 'apply' : action === 'offer' ? 'offer' : 'ask', up.length ? up : obs, ctx.now), evidence, ctx, extra);
    }
  }
  if (warmText && warmPx) {
    const larger = warmPx > 16.5;
    const text = larger
      ? `Text is ${Math.round(warmPx)} px, the size you read fastest at in your warm-up.`
      : 'Your warm-up found the usual text size comfortable.';
    return belief(dim, larger ? Math.max(0.9, ctx.base?.text.conf ?? 0) : 0.1, warmPx, 'warmup', larger ? 'apply' : 'none', text, evidence, ctx, { updatedAt: ctx.base?.createdAt ?? ctx.nowIso });
  }
  const minPx = ctx.settings?.minFontPx ?? 0;
  if (sp.changed || minPx > 16) {
    const parts: string[] = [];
    if (Math.abs(sp.font - 16) >= 0.5) parts.push(`Chrome’s default font size is ${Math.round(sp.font)} px`);
    if (Math.abs(sp.zoom - 1) >= 0.01) parts.push(`Chrome zooms every page to ${pct(sp.zoom)}`);
    if (minPx > 16) parts.push(`Chrome’s smallest font size is ${Math.round(minPx)} px`);
    const px = Math.max(sp.px, minPx);
    const text = `Text starts at ${Math.round(px)} px because ${parts.join(' and ')}.`;
    return belief(dim, 1, px, 'setting', 'apply', text, [settingEvidence(dim, parts.join('; ').replace(/^./, (c) => c.toUpperCase()), ctx), ...evidence], ctx, { sites, days });
  }
  const named = obs.filter((o) => o.w >= PASSIVE.namedWeight);
  const text = named.length ? textExplanation('ask', named, ctx.now) : 'Text stays at each site’s own size.';
  return belief(dim, post.n ? p : PASSIVE.priorP, post.n ? valuePx : null, post.n ? 'learned' : 'default', 'none', text, evidence, ctx, extra);
}

/* ---------------- binary needs (log-odds) ---------------- */

export interface BinaryLayers {
  usualL: number;
  nowL: number;
  sites: number;
  days: number;
  multiDay: boolean;
  /** Recent clicks and misses for the explanation (most recent pages until 80 clicks). */
  clicks: number;
  misses: number;
  lastAt: number | null;
}

/**
 * Both layers for one binary need from its records. Records are page-capped already. The usual layer caps each local
 * day at ±2.5; the now layer is the usual layer before this session plus this session's pages, uncapped by day.
 * Corrections (−2, −3) are never capped. Everything decays toward L0 with a 14-day half-life, within ±4.
 */
export function binaryLayers(records: PassiveRecord[], now: number, session: number): BinaryLayers {
  const rs = records
    .filter((r) => r.kind === 'clicks' || (r.kind && FEEDBACK_KINDS.has(r.kind)))
    .map((r) => ({ r, t: timeOf(r.at) ?? now }))
    .sort((a, b) => a.t - b.t);
  const run = (useDayCapUntil: number): number => {
    let off = 0;
    let lastT: number | null = null;
    const dayTotals = new Map<string, number>();
    for (const { r, t } of rs) {
      if (lastT !== null) off *= decay((t - lastT) / DAY_MS, PASSIVE.halfLifeDays);
      lastT = t;
      let d = r.weight;
      if (r.kind === 'clicks' && t < useDayCapUntil) {
        const k = dayKey(t);
        const before = dayTotals.get(k) ?? 0;
        const after = clamp(before + d, -PASSIVE.usualDayCap, PASSIVE.usualDayCap);
        d = after - before;
        dayTotals.set(k, after);
      }
      off = clamp(L0 + off + d, -PASSIVE.clamp, PASSIVE.clamp) - L0;
    }
    if (lastT !== null) off *= decay((now - lastT) / DAY_MS, PASSIVE.halfLifeDays);
    return L0 + off;
  };
  const usualL = run(Infinity);
  const nowL = run(session);
  const win = now - PASSIVE.usualWindowDays * DAY_MS;
  const pos = rs.filter(({ r, t }) => r.kind === 'clicks' && r.weight > 0 && t >= win);
  const sites = new Set(pos.map(({ r }) => r.site ?? '?')).size;
  const days = new Set(pos.map(({ t }) => dayKey(t))).size;
  let clicks = 0;
  let misses = 0;
  for (let i = rs.length - 1; i >= 0 && clicks < 80; i--) {
    const { r } = rs[i] as { r: PassiveRecord };
    if (r.kind !== 'clicks') continue;
    clicks += r.clicks ?? 0;
    misses += r.misses ?? 0;
  }
  const lastAt = rs.length ? (rs[rs.length - 1] as { t: number }).t : null;
  return { usualL, nowL, sites, days, multiDay: sites >= PASSIVE.usualSites && days >= PASSIVE.usualDays, clicks, misses, lastAt };
}

const CLICK_WORDS: Partial<Record<FitDimension, { fact: (m: number, n: number) => string; applied: string }>> = {
  targets: { fact: (m, n) => `${m} of your last ${n} clicks landed just beside a button.`, applied: 'Click areas are bigger: ' },
  steady_clicks: { fact: (m, n) => `${m} of your last ${n} clicks slipped off the button before it clicked.`, applied: 'Steady clicks are on: ' },
};

function lowerFirst(s: string): string {
  return /^\d/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

function clickBelief(dim: 'targets' | 'steady_clicks', ctx: Ctx): DimensionBelief {
  const recs = ctx.store.records.filter((r) => r.dim === dim);
  const evidence = recentFirst(recs.filter((r) => r.kind !== 'not_right')).map((r) => toEvidence(r, ctx.session));
  const lock = lockFor(ctx.store, dim, ctx.base);
  const words = CLICK_WORDS[dim] as { fact: (m: number, n: number) => string; applied: string };
  const noun = dim === 'targets' ? 'bigger click areas' : 'steady clicks';
  if (lock) {
    const v = dim === 'targets' ? (finite(lock.value) ? lock.value : PASSIVE.targetsNeed) : null;
    const text = lock.on
      ? dim === 'targets' ? `You chose bigger click areas on every site (${v} px).` : 'You turned on steady clicks for every site.'
      : `You turned ${noun} off.`;
    return belief(dim, lock.on ? 1 : 0, lock.on ? v : null, 'person', lock.on ? 'apply' : 'none', text, evidence, ctx, { locked: true, updatedAt: lock.at });
  }
  const L = binaryLayers(recs, ctx.now, ctx.session);
  const pUsual = sigmoid(L.usualL);
  const pNow = sigmoid(L.nowL);
  const pMax = Math.max(pUsual, pNow);
  const learnedAction: DimensionBelief['action'] = pUsual >= PASSIVE.apply && L.multiDay ? 'apply' : everySiteAction(actionFor(pMax, false), L.sites);
  const fact = L.clicks > 0 && L.misses > 0 ? words.fact(L.misses, L.clicks) : '';
  const extra = { sites: L.sites, days: L.days, updatedAt: L.lastAt ? new Date(L.lastAt).toISOString() : ctx.nowIso };
  const base = ctx.base;
  const warmMeasured = warmDecided(base, dim);
  const warmOn = warmMeasured && base ? (dim === 'targets' ? (base.targets.minPx ?? 0) > PASSIVE.targetsFine : base.clicks.steady.on) : false;
  if (warmOn && base) {
    const text = dim === 'targets'
      ? `Click areas are ${base.targets.minPx} px, from your warm-up.`
      : 'Steady clicks are on: in your warm-up, a few clicks slipped off the button.';
    return belief(dim, Math.max(0.9, base.targets.conf), dim === 'targets' ? base.targets.minPx : null, 'warmup', 'apply', text, evidence, ctx, { updatedAt: base.createdAt });
  }
  const value = dim === 'targets' ? PASSIVE.targetsNeed : null;
  if (learnedAction !== 'none' && fact) {
    // A warm-up that measured no need outranks learning: learning may offer, never apply on its own.
    const action = warmMeasured && learnedAction === 'apply' ? 'offer' : learnedAction;
    const text = action === 'apply' ? `${words.applied}${lowerFirst(fact)}` : fact;
    return belief(dim, action === 'apply' ? pUsual : pMax, value, 'learned', action, text, evidence, ctx, extra);
  }
  if (dim === 'targets' && ctx.settings?.pointer === 'coarse') {
    const text = `Click areas are at least ${PASSIVE.targetsCoarse} px because this computer’s main pointer is a touch screen.`;
    return belief(dim, 1, PASSIVE.targetsCoarse, 'setting', 'apply', text, [settingEvidence(dim, 'Your main pointer is a touch screen', ctx), ...evidence], ctx);
  }
  if (warmMeasured && base) {
    return belief(dim, 0.1, null, 'warmup', 'none', dim === 'targets' ? 'Your warm-up found ordinary click areas easy to hit.' : 'Your clicks in the warm-up stayed on target.', evidence, ctx, { updatedAt: base.createdAt });
  }
  return belief(dim, pMax, null, recs.length ? 'learned' : 'default', 'none', fact || (dim === 'targets' ? 'Click areas stay at each site’s size.' : 'Clicks work as the site made them.'), evidence, ctx, extra);
}

/* ---------------- needs set in Chrome, the OS or the warm-up ---------------- */

function lockedBelief(dim: FitDimension, lock: PassiveLock, onText: string, offText: string, ctx: Ctx, evidence: PassiveEvidence[] = []): DimensionBelief {
  return belief(dim, lock.on ? 1 : 0, lock.on ? lock.value : null, 'person', lock.on ? 'apply' : 'none', lock.on ? onText : offText, evidence, ctx, { locked: true, updatedAt: lock.at });
}

function motionBelief(ctx: Ctx): DimensionBelief {
  const dim: FitDimension = 'motion';
  const lock = lockFor(ctx.store, dim, ctx.base);
  if (lock) return lockedBelief(dim, lock, 'You chose to pause moving parts on every site.', 'You turned paused motion off; pages move as their sites made them.', ctx);
  if (ctx.settings?.reducedMotion) {
    return belief(dim, 1, null, 'setting', 'apply', `Motion is paused because ${computer(ctx)} is set to Reduce motion.`, [settingEvidence(dim, `${computer(ctx).replace(/^./, (c) => c.toUpperCase())} is set to Reduce motion`, ctx)], ctx);
  }
  const b = ctx.base;
  if (warmDecided(b, dim) && b) {
    if (b.attention.motion.on) return belief(dim, Math.max(0.7, b.attention.motion.p), null, 'warmup', 'apply', 'Moving parts are paused: in your warm-up, motion slowed your search down.', [], ctx, { updatedAt: b.createdAt });
    return belief(dim, b.attention.motion.p, null, 'warmup', 'none', 'Your warm-up found moving parts did not slow you down.', [], ctx, { updatedAt: b.createdAt });
  }
  return belief(dim, PASSIVE.priorP, null, 'default', 'none', 'Pages move as their sites made them.', [], ctx);
}

function contrastBelief(ctx: Ctx): DimensionBelief {
  const dim: FitDimension = 'contrast';
  const lock = lockFor(ctx.store, dim, ctx.base);
  if (lock) return lockedBelief(dim, { ...lock, value: lock.on ? 7 : null }, 'You chose darker faint text on every site.', 'You turned darker text off.', ctx);
  const b = ctx.base;
  const warmBand = warmDecided(b, dim) && b ? b.contrast.band : null;
  if (warmBand && warmBand !== 'N' && b) {
    const text = warmBand === 'S' ? 'Faint text is as dark as it goes, from your warm-up.' : 'Faint text is darker (7:1), from your warm-up.';
    return belief(dim, 0.9, b.contrast.floor, 'warmup', 'apply', text, [], ctx, { updatedAt: b.createdAt });
  }
  if (ctx.settings?.contrastMore && !ctx.settings.forcedColors) {
    return belief(dim, 1, 7, 'setting', 'apply', `Faint text is darker because ${computer(ctx)} is set to Increase contrast.`, [settingEvidence(dim, `${computer(ctx).replace(/^./, (c) => c.toUpperCase())} is set to Increase contrast`, ctx)], ctx);
  }
  if (warmBand === 'N' && b) return belief(dim, 0.1, null, 'warmup', 'none', 'Your warm-up found faint grey text readable.', [], ctx, { updatedAt: b.createdAt });
  return belief(dim, PASSIVE.priorP, null, 'default', 'none', 'Text keeps the site’s colours.', [], ctx);
}

function colorsBelief(ctx: Ctx): DimensionBelief {
  const dim: FitDimension = 'colors';
  const lock = lockFor(ctx.store, dim, ctx.base);
  if (lock) return lockedBelief(dim, lock, 'You chose these page colours for every site.', 'You chose to keep each site’s own colours.', ctx);
  const s = ctx.settings;
  if (s?.forcedColors) {
    return belief(dim, 1, null, 'setting', 'apply', `Page colours are left to ${computer(ctx)}, which is set to use its own high-contrast colours.`, [settingEvidence(dim, `${computer(ctx).replace(/^./, (c) => c.toUpperCase())} uses its own high-contrast colours`, ctx)], ctx);
  }
  const b = ctx.base;
  if (warmDecided(b, dim) && b && b.polarity.value !== 'none') {
    return belief(dim, 0.9, null, 'warmup', 'apply', b.polarity.value === 'dark' ? 'Pages are shown dark, as you chose in your warm-up.' : 'Pages are shown light, as you chose in your warm-up.', [], ctx, { updatedAt: b.createdAt });
  }
  if (s?.colorScheme === 'dark') {
    // A weak prior only (dark mode is often chosen for looks): never acted on by itself.
    return belief(dim, sigmoid(L0 + PASSIVE.darkSchemeLlr), null, 'setting', 'none', `${computer(ctx).replace(/^./, (c) => c.toUpperCase())} uses dark mode; WebAble keeps each site’s colours unless you choose dark pages.`, [], ctx);
  }
  return belief(dim, PASSIVE.priorP, null, 'default', 'none', 'Pages keep their own colours.', [], ctx);
}

function clutterBelief(ctx: Ctx): DimensionBelief {
  const dim: FitDimension = 'clutter';
  const lock = lockFor(ctx.store, dim, ctx.base);
  if (lock) return lockedBelief(dim, lock, 'You chose Calm view for busy pages.', 'You turned Calm view off for busy pages.', ctx);
  const b = ctx.base;
  if (warmDecided(b, dim) && b && b.attention.structureLevel > 0) {
    const text = b.attention.structureLevel === 2
      ? 'Calm view opens on busy pages: in your warm-up, busy pages slowed your search down.'
      : 'Calm view is offered on busy pages, from your warm-up.';
    return belief(dim, Math.max(0.7, b.attention.clutter.p), null, 'warmup', 'apply', text, [], ctx, { updatedAt: b.createdAt });
  }
  if (warmDecided(b, dim) && b) return belief(dim, b.attention.clutter.p, null, 'warmup', 'none', 'Your warm-up found busy pages did not slow you down.', [], ctx, { updatedAt: b.createdAt });
  return belief(dim, PASSIVE.priorP, null, 'default', 'none', 'Busy pages stay as their sites made them.', [], ctx);
}

function readingBelief(ctx: Ctx): DimensionBelief {
  const dim: FitDimension = 'reading_support';
  const lock = lockFor(ctx.store, dim, ctx.base);
  if (lock) return lockedBelief(dim, lock, 'You chose more space between lines on every site.', 'You turned reading help off.', ctx);
  return belief(dim, PASSIVE.priorP, null, 'default', 'none', 'Line spacing stays as each site sets it.', [], ctx);
}

/**
 * Every belief, decayed to `now`. Pure: the background calls it after each change and on every read.
 */
export function buildPassiveState(store: PassiveStore, opts: BuildOptions = {}): PassiveFitState {
  const nowD = opts.now ?? new Date();
  const now = nowD.getTime();
  const session = timeOf(opts.sessionStart ?? null) ?? startOfDay(now);
  const base = opts.base && opts.base.v === 'fit.1' ? opts.base : null;
  const ctx: Ctx = {
    store, now, nowIso: nowD.toISOString(), session, base, warm: isWarmup(base), settings: store.settings, os: opts.os ?? null,
  };
  const beliefs: Record<FitDimension, DimensionBelief> = {
    text_size: textBelief(ctx),
    contrast: contrastBelief(ctx),
    targets: clickBelief('targets', ctx),
    steady_clicks: clickBelief('steady_clicks', ctx),
    motion: motionBelief(ctx),
    clutter: clutterBelief(ctx),
    reading_support: readingBelief(ctx),
    colors: colorsBelief(ctx),
  };
  return { v: 'passive.1', settings: store.settings, beliefs, updatedAt: ctx.nowIso };
}

/* ------------------------------------------------------------------ */
/* The fit the page is fitted with                                     */
/* ------------------------------------------------------------------ */

export type FitSources = Record<FitDimension, DimensionBelief['source']>;

function copyFit(f: FitProfile): FitProfile {
  return JSON.parse(JSON.stringify(f)) as FitProfile;
}

function setText(fit: FitProfile, px: number, conf: number): void {
  const v = half(clamp(px, 8, 96));
  fit.text = { bodyPx: v, cpsPx: fit.text.cpsPx, largePrint: v >= 32, conf: Math.round(clamp(conf, 0, 1) * 100) / 100, source: 'stated', override: null };
}

/**
 * The fit and where each part of it came from. Order: the person's explicit choice > the warm-up > what WebAble learned
 * (usual layer, apply) > Chrome and OS settings > the default. Reduced motion, increased contrast and forced colours are
 * taken as set (they only ever add), unless the person turned them off.
 */
export function resolveFit(base: FitProfile | null, passive: PassiveFitState | null): { fit: FitProfile; sources: FitSources } {
  const warm = isWarmup(base);
  const fit = copyFit(base && base.v === 'fit.1' ? base : defaultFit());
  if (!base) fit.calibration = { version: 'passive', durationSec: 0, skipped: [] };
  const s = passive?.settings ?? null;
  const B = passive?.beliefs ?? null;
  const sources = Object.fromEntries(FIT_DIMENSIONS.map((d) => [d, warmDecided(base, d) ? baseSource(base, d) : 'default'])) as FitSources;
  const lock = (d: FitDimension): DimensionBelief | null => {
    const b = B?.[d];
    return b && b.locked && b.source === 'person' ? b : null;
  };
  const learned = (d: FitDimension): DimensionBelief | null => {
    const b = B?.[d];
    return b && b.source === 'learned' && b.action === 'apply' ? b : null;
  };

  // Text size.
  const tl = lock('text_size');
  const sp = settingsTextPx(s);
  if (tl) {
    sources.text_size = 'person';
    if (tl.action === 'apply' && finite(tl.value)) setText(fit, tl.value, 1);
    else fit.text = { ...defaultFit().text };
  } else if (warmDecided(base, 'text_size')) {
    sources.text_size = baseSource(base, 'text_size');
  } else if (learned('text_size') && finite(learned('text_size')?.value)) {
    const b = learned('text_size') as DimensionBelief;
    setText(fit, b.value as number, b.p);
    sources.text_size = 'learned';
  } else if (sp.changed) {
    setText(fit, sp.px, 0.9);
    sources.text_size = 'setting';
  } else {
    sources.text_size = baseSource(base, 'text_size') === 'setting' ? 'setting' : 'default';
  }
  const minPx = s && finite(s.minFontPx) ? s.minFontPx : 0;
  if (!(tl && tl.action !== 'apply') && minPx > (fit.text.override ?? fit.text.bodyPx)) {
    setText(fit, minPx, Math.max(fit.text.conf, 0.9));
    if (sources.text_size === 'default') sources.text_size = 'setting';
  }

  // Contrast (more contrast is taken as set; forced colours leave colours to the computer).
  const cl = lock('contrast');
  if (cl) {
    sources.contrast = 'person';
    if (cl.action === 'apply') {
      if (fit.contrast.floor < 7) fit.contrast = { band: 'M', floor: 7 };
    } else fit.contrast = { band: 'N', floor: 4.5 };
  } else if (s?.contrastMore && !s.forcedColors && fit.contrast.floor < 7) {
    fit.contrast = { band: 'M', floor: 7 };
    sources.contrast = 'setting';
  } else if (learned('contrast') && fit.contrast.floor < 7) {
    fit.contrast = { band: 'M', floor: 7 };
    sources.contrast = 'learned';
  }

  // Click areas.
  const kl = lock('targets');
  if (kl) {
    sources.targets = 'person';
    fit.targets = kl.action === 'apply' ? { minPx: Math.round(finite(kl.value) ? kl.value : PASSIVE.targetsNeed), conf: 1 } : { minPx: null, conf: 0 };
  } else if (warmDecided(base, 'targets')) {
    sources.targets = baseSource(base, 'targets');
  } else if (learned('targets')) {
    const b = learned('targets') as DimensionBelief;
    fit.targets = { minPx: Math.round(finite(b.value) ? b.value : PASSIVE.targetsNeed), conf: Math.round(b.p * 100) / 100 };
    sources.targets = 'learned';
  } else if (s?.pointer === 'coarse') {
    fit.targets = { minPx: PASSIVE.targetsCoarse, conf: 0.6 };
    sources.targets = 'setting';
  }

  // Steady clicks.
  const st = lock('steady_clicks');
  if (st) {
    sources.steady_clicks = 'person';
    fit.clicks = { ...fit.clicks, steady: { ...fit.clicks.steady, on: st.action === 'apply' } };
  } else if (warmDecided(base, 'steady_clicks')) {
    sources.steady_clicks = baseSource(base, 'steady_clicks');
  } else if (learned('steady_clicks')) {
    fit.clicks = { ...fit.clicks, steady: { ...fit.clicks.steady, on: true } };
    sources.steady_clicks = 'learned';
  }

  // Motion (Reduce motion is taken as set).
  const ml = lock('motion');
  if (ml) {
    sources.motion = 'person';
    fit.attention = { ...fit.attention, motion: ml.action === 'apply' ? { p: 1, on: true } : { p: 0, on: false } };
  } else if (s?.reducedMotion) {
    fit.attention = { ...fit.attention, motion: { p: 1, on: true } };
    sources.motion = 'setting';
  } else if (learned('motion')) {
    fit.attention = { ...fit.attention, motion: { p: Math.max(fit.attention.motion.p, 0.9), on: true } };
    sources.motion = 'learned';
  }

  // Busy pages.
  const ql = lock('clutter');
  if (ql) {
    sources.clutter = 'person';
    fit.attention = { ...fit.attention, structureLevel: ql.action === 'apply' ? (Math.max(1, fit.attention.structureLevel) as 1 | 2) : 0 };
  } else if (!warmDecided(base, 'clutter') && learned('clutter')) {
    fit.attention = { ...fit.attention, structureLevel: 1 };
    sources.clutter = 'learned';
  }

  // Colours (forced colours: leave them to the computer).
  const pl = lock('colors');
  if (pl) {
    sources.colors = 'person';
    if (pl.action !== 'apply') fit.polarity = { value: 'none', stated: fit.polarity.stated };
  } else if (s?.forcedColors) {
    fit.polarity = { value: 'none', stated: fit.polarity.stated };
    sources.colors = 'setting';
  }

  // Reading support: a little more space between lines when the person asked for it.
  const rl = lock('reading_support');
  if ((rl && rl.action === 'apply') || learned('reading_support')) {
    fit.spacing = { ...fit.spacing, lineHeight: Math.max(fit.spacing.lineHeight, 1.6) };
    sources.reading_support = rl ? 'person' : 'learned';
  } else if (rl) sources.reading_support = 'person';

  return { fit, sources };
}

/** The FitProfile the page is fitted with: the warm-up (if any) merged with settings and what WebAble learned. */
export function effectiveFit(base: FitProfile | null, passive: PassiveFitState | null): FitProfile {
  return resolveFit(base, passive).fit;
}

/** Where each need in the effective fit came from. */
export function effectiveFitSources(base: FitProfile | null, passive: PassiveFitState | null): FitSources {
  return resolveFit(base, passive).sources;
}

/** A short key of everything in a fit that changes a page, to tell whether a page needs fitting again. */
export function fitSignature(fit: FitProfile | null | undefined): string {
  if (!fit) return 'none';
  return JSON.stringify([
    fit.text.override ?? fit.text.bodyPx, fit.text.source === 'default' && fit.text.override == null, fit.text.largePrint,
    fit.contrast.floor, fit.polarity.value, fit.weight.floor, fit.spacing.lineHeight, fit.spacing.wordEm, fit.spacing.letterEm,
    fit.targets.minPx, fit.clicks.steady.on, fit.clicks.debounce, fit.attention.motion.on, fit.attention.structureLevel,
    fit.layout?.column ?? 'auto',
  ]);
}

/* ------------------------------------------------------------------ */
/* Offers and questions from what WebAble learned                      */
/* ------------------------------------------------------------------ */

export const PASSIVE_OFFER_KIND: Partial<Record<FitDimension, OfferKind>> = Object.freeze({
  text_size: 'larger_text',
  targets: 'bigger_targets',
  steady_clicks: 'steady_clicks',
});

/** The dimension behind a passive offer kind. */
export function passiveDimFor(kind: OfferKind): FitDimension | null {
  for (const [d, k] of Object.entries(PASSIVE_OFFER_KIND)) if (k === kind) return d as FitDimension;
  return null;
}

/**
 * The offer card for a learned need at 'offer' (or the weekly question at 'ask'). A question with a fact in the
 * person's own actions: "Make text larger on every site?" · "You zoomed in on 2 sites today."
 */
export function passiveOffer(b: DimensionBelief | null | undefined): Offer | null {
  if (!b || b.source !== 'learned' || (b.action !== 'offer' && b.action !== 'ask')) return null;
  const kind = PASSIVE_OFFER_KIND[b.dim];
  if (!kind) return null;
  const ask = b.action === 'ask';
  const fact = b.explanation;
  if (b.dim === 'text_size') {
    const px = finite(b.value) ? Math.round(b.value) : null;
    const zooms = b.evidence.filter((e) => e.weight > 0 && /zoomed in to (\d+)%/.test(e.what));
    const avg = zooms.length ? Math.round(zooms.reduce((a, e) => a + Number(/zoomed in to (\d+)%/.exec(e.what)?.[1] ?? 100), 0) / zooms.length) : null;
    return {
      kind,
      question: ask ? 'Would larger text help on every site?' : 'Make text larger on every site?',
      fact,
      why: `${avg ? `On average you zoomed to ${avg}%. ` : ''}WebAble would set body text to about ${px ?? 'your'} px on every site by zooming, so each page keeps its own layout. Undo is one click.`,
      p: b.p,
    };
  }
  if (b.dim === 'targets') {
    return {
      kind,
      question: ask ? 'Would bigger buttons help on every site?' : 'Make buttons bigger on every site?',
      fact,
      why: `Buttons and links would get click areas of at least ${Math.round(finite(b.value) ? b.value : PASSIVE.targetsNeed)} px on every site. Nothing moves; the area you can click grows. Undo is one click.`,
      p: b.p,
    };
  }
  return {
    kind,
    question: ask ? 'Would steady clicks help on every site?' : 'Turn on steady clicks on every site?',
    fact,
    why: 'A small slip while you click would still click what you pressed, on every site. Undo is one click.',
    p: b.p,
  };
}

/* ------------------------------------------------------------------ */
/* A realistic week, for the demo ("Show a week of learning")          */
/* ------------------------------------------------------------------ */

/**
 * A week of evidence ending now: zooms held on 4 sites over 3 days (average 135%), missed clicks on 3 sites (about one
 * click in four landed just beside a button), a lighter page, and slips on 2 sites. With default settings and no
 * warm-up it gives: text size applied (learned on 4 sites), bigger click areas offered (about one click in four landed beside a button), steady clicks left off.
 */
export function demoHistory(now: Date = new Date()): PassiveRecord[] {
  const at = (daysAgo: number, hour: number): string => {
    const d = new Date(now.getTime());
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, 0, 0, 0);
    return new Date(Math.min(d.getTime(), now.getTime() - 5 * 60_000)).toISOString();
  };
  const zoom = (site: string, z: number, body: number, daysAgo: number, hour: number, w = 0.9): PassiveRecord => ({
    dim: 'text_size', weight: w, what: `You zoomed in to ${pct(z)} on ${site}`, site, at: at(daysAgo, hour), layer: 'usual',
    value: half(z * body), kind: 'zoom', zoom: z, bodyPx: body,
  });
  /** Outcomes with `m` misses spread evenly through `n` clicks, the way they happen. */
  const spread = (n: number, m: number): boolean[] => {
    const out: boolean[] = [];
    for (let i = 0; i < n; i++) out.push(m > 0 && Math.floor(((i + 1) * m) / n) > Math.floor((i * m) / n));
    return out;
  };
  /** One page view: `n` pointer clicks, `near` landed just beside a button, `slip` slipped off one while pressing. */
  const page = (site: string, n: number, near: number, slip: number, daysAgo: number, hour: number, id: string): PassiveRecord[] => [
    {
      dim: 'targets', weight: pageClickWeight(spread(n - slip, near), 0.85),
      what: near ? `${near} of ${n} clicks on ${site} landed just beside a button` : `${n} clicks on ${site}, none beside a button`,
      site, at: at(daysAgo, hour), layer: 'usual', kind: 'clicks', clicks: n, misses: near, page: id,
    },
    {
      dim: 'steady_clicks', weight: pageClickWeight(spread(n - near, slip), 0.85),
      what: slip ? `${slip} of ${n} clicks on ${site} slipped off the button` : `${n} clicks on ${site}, none slipped`,
      site, at: at(daysAgo, hour), layer: 'usual', kind: 'clicks', clicks: n, misses: slip, page: id,
    },
  ];
  return [
    zoom('nytimes.com', 1.25, 18, 5, 9),
    zoom('cvs.com', 1.5, 16, 5, 19),
    ...page('cvs.com', 24, 6, 4, 5, 19, 'demo-cvs-1'),
    ...page('wikipedia.org', 6, 0, 0, 4, 21, 'demo-wiki-1'),
    zoom('weather.gov', 1.25, 16, 3, 8),
    ...page('mail.google.com', 30, 7, 3, 3, 10, 'demo-gmail-1'),
    zoom('mail.google.com', 1.5, 14, 3, 10, 0.85),
    ...page('weather.gov', 20, 5, 3, 1, 18, 'demo-weather-1'),
    zoom('cvs.com', 1.25, 16, 1, 18),
  ];
}
