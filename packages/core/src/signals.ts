// Struggle sense: code gate -> one Jev call -> code policy -> an offer, never an imposed change. Owner: A1.
//
// Stage 1 (C2, content script) counts interaction events over a sliding window into StruggleCounts.
// Stage 2 `gate`: a Bernoulli CUSUM on "this click needed a retry" plus count gates decides whether to ask Jev.
// Stage 3 `toSignals` + `buildStruggleCall`: bands relative to the person's own baseline and code-written evidence
//   sentences, asked as the 9 measured questions (research-struggle §4.3, jev_struggle_questions.json, byte-exact).
// Stage 4 `decideOffers`: thresholds, persistence, the interruption budget, and the offer wording.
// Jev never sees pointer coordinates, page text, URLs or anything typed. Wording is about the page and the clicks,
// never about the person.
import type {
  FitProfile, JevMetrics, Offer, OfferKind, StruggleCounts, StruggleJudgment, StruggleKind, StruggleSignals,
} from './types';
import { choiceOf, noulOf, scoreOf } from './jev/api';
import type { JevQuestion, JevResponse } from './jev/api';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const STRUGGLE = Object.freeze({
  // gate
  cusumCall: 3.0, // never on fewer than 3 retries
  cusumHold: 4.5, // re-ask sooner inside an episode
  defaultMissRate: 0.05,
  minCheckGapSec: 15, // <= 1 call / 15 s / tab
  sameReasonGapSec: 30,
  ambientGapSec: 60,
  maxChecksPerHour: 20,
  maxChecksPerEpisode: 3,
  // policy
  tau: 0.75,
  tauRepeat: 0.8,
  waitLow: 0.5,
  levelMin: 1.0, // help_level "Slightly"
  levelProminent: 2.0,
  siteFault: 0.7,
  deliberateVeto: 0.4,
  pointingWindows: 2, // research-jev §4.4: 2 consecutive windows (the stricter brief)
  // interruption budget
  firstOfferMs: 10_000,
  offerGapMs: 90_000,
  maxPerDay: 6,
  notNowMs: 30 * 60_000,
  maxKindsPerPage: 2,
});

/* ------------------------------------------------------------------ */
/* The measured question set (byte-identical to jev_struggle_questions.json) */
/* ------------------------------------------------------------------ */

export const STRUGGLE_QUESTIONS: Readonly<Record<string, JevQuestion>> = Object.freeze({
  pointing_struggle: {
    type: 'noul',
    instructions:
      'Using `pointing` and `evidence`, is this person having genuine difficulty operating on-screen controls with the pointer (landing just outside buttons, slipping off a button while clicking, clicking the same control twice by accident, or needing several tries for one control)?',
    criteria: {
      true: "Repeated near-misses, slips, accidental double clicks or retries on ordinary controls, clearly worse than the person's usual",
      false: "Clicks mostly land on target; any misses are within the person's usual, or only on tiny controls while moving fast",
    },
  },
  accidental_repeat: {
    type: 'noul',
    instructions:
      'Using `pointing` and `evidence`, did the person activate the same control twice by accident (a second click a fraction of a second after the first that they then had to undo)?',
  },
  reading_struggle: {
    type: 'noul',
    instructions:
      'Using `reading` and `evidence`, is this person straining to read the text as it is currently shown (zooming in, scrolling back to re-read the same passage, unusually slow progress through the text)?',
    criteria: {
      true: 'Zooming in, repeatedly re-reading the same passage, or reading far slower than usual',
      false: "Steady reading at the person's usual pace; scrolling back is rare or brief",
    },
  },
  finding_struggle: {
    type: 'noul',
    instructions:
      'Using `finding` and `evidence`, is this person struggling to find what they are looking for on this page (hovering over many items without choosing, scrolling up and down repeatedly, searching the page, leaving and quickly returning)?',
    criteria: {
      true: 'Prolonged hunting: many items inspected without acting, repeated back-and-forth scrolling, page search',
      false: 'The person moves fairly directly to what they want',
    },
  },
  form_struggle: {
    type: 'noul',
    instructions:
      "Using `forms` and `evidence`, is this person stuck on a form field (long pause on a field without typing, returning to the same field, repeated error messages, lingering over the field's label or help)?",
    criteria: {
      true: 'Long pauses or repeated returns or errors on the same field',
      false: 'Fields are filled steadily with at most one quick correction',
    },
  },
  site_not_responding: {
    type: 'noul',
    instructions:
      "Using `site` and `pointing`, are the failed or repeated clicks better explained by the website being slow or broken (controls that gave no response, page freezes, requests still loading) than by the person's aim?",
    criteria: {
      true: 'Clicks landed on real controls but the page did not react, or the page was frozen or still loading',
      false: 'The page reacted normally whenever a control was actually hit',
    },
  },
  deliberate_activity: {
    type: 'noul',
    instructions:
      'Using `context` and all signals, is the unusual pointer activity better explained by something the person is doing on purpose, such as drawing, dragging, selecting text, playing a game, or fast expert clicking, rather than by difficulty?',
    criteria: {
      true: 'Purposeful activity that only looks unusual: drawing, dragging, games, expert speed',
      false: 'Errors the person then has to undo or repeat, such as a control switched on and straight back off',
    },
  },
  best_help: {
    type: 'choice',
    instructions:
      'Given all signals, which single change would most help this person right now? Choose none if nothing is needed or the website is at fault, and unclear if the signals conflict or are too weak.',
    criteria: {
      bigger_targets: {
        what: 'Make buttons and links larger and better spaced so they are easier to hit',
        signals: 'near-misses and retries landing just outside controls',
        not_for: 'slips during the click itself; reading difficulty',
      },
      steady_clicks: {
        what: 'Steady clicking: count a click on the control where the press began even if the pointer slides off before release, and ignore an accidental second click within a fraction of a second',
        signals: 'lost clicks; pointer moving while the button is held; a control switched twice in under 250 ms',
        not_for: 'landing outside the control before pressing',
      },
      larger_text: {
        what: 'Increase text size and line spacing',
        signals: 'zooming in; slow reading of small text',
        not_for: 'understanding difficult wording at a comfortable size',
      },
      explain_passage: {
        what: 'Offer a plain-language explanation beside a dense passage, keeping the original',
        signals: 're-reading the same complex passage at a comfortable text size',
        not_for: 'text that is simply too small',
      },
      calm_view: {
        what: 'Show a calmer view of the page with only the main content and actions',
        signals: 'hunting across a cluttered page with many competing items',
        not_for: 'a simple page',
      },
      find_helper: {
        what: "Show a short list of the page's main actions and sections to jump to",
        signals: 'searching the page; hovering across many menu items; scrolling back and forth',
        not_for: 'reading difficulty',
      },
      explain_field: {
        what: 'Explain in plain language what a form field is asking for, beside the field',
        signals: 'long pause or repeated errors on one field',
        not_for: 'fields the person fills without hesitation',
      },
      none: 'No change needed: the person is getting on fine, or the problem is the website',
      unclear: 'Signals conflict or are too weak to choose',
    },
  },
  help_level: {
    type: 'score',
    instructions: 'How much is difficulty slowing this person down on this page right now?',
    criteria: [
      'Not at all: actions succeed on the first try and progress is steady',
      'Slightly: an occasional miss or re-read, quickly recovered',
      'Clearly: repeated misses, re-reads or hunting are adding noticeable time',
      'Severely: the person keeps failing at the same step and may give up',
    ],
  },
});

/** The measured `about` line (state key order is fixed: Jev anchors on what it reads first). */
export function struggleAbout(seconds: number): string {
  return (
    `Signals computed by WebAble's own code from the last ${seconds} seconds of one person using one web page. ` +
    "Counts, rates and comparisons are exact. 'usual' means this person's own typical value from earlier sessions. " +
    'No page text or personal content is included.'
  );
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);
const int = (x: unknown): number => Math.round(num(x));
const f2 = (p: number): string => p.toFixed(2);
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

function missRate(fit: FitProfile | null | undefined): number {
  const r = fit?.baselines?.missRate;
  const p = typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : STRUGGLE.defaultMissRate;
  return Math.min(0.3, Math.max(0.01, p));
}

/** Clicks that needed a retry: a confirmed near-miss or a lost click. */
export function retryClicks(c: StruggleCounts): number {
  return Math.min(int(c.clicks), int(c.nearMissClicks) + int(c.lostClicks));
}

/** "3 of 9 (about 1 in 3)" */
export function oneInText(k: number, n: number): string {
  return k === 0 ? `0 of ${n}` : `${k} of ${n} (about 1 in ${Math.max(1, Math.round(n / k))})`;
}

/** Band relative to the person's usual value (research-jev bench: steps 1.5x / 3x / 6x). */
export function baselineBand(x: number, usual: number): string {
  if (!(usual > 0)) return x <= 0 ? 'none' : x <= 1 ? 'a little above usual' : x <= 3 ? 'well above usual' : 'far above usual';
  const r = x / usual;
  return r <= 1.5 ? 'usual' : r <= 3 ? 'a little above usual' : r <= 6 ? 'well above usual' : 'far above usual';
}

/* ------------------------------------------------------------------ */
/* Stage 2: the gate                                                   */
/* ------------------------------------------------------------------ */

export interface CusumState {
  s: number;
  checks: number;
  /** ms since page start (counts.timeOnPageSec x 1000) of the last check. */
  lastCheckAt: number | null;
  /** counts.timeOnPageSec at the previous gate() call, to avoid double counting overlapping windows. */
  lastGateSec?: number | null;
  /** Checks in the current episode (reset when the statistic returns to 0). */
  episodeChecks?: number;
  /** Page seconds of recent checks, for the per-hour budget. */
  checkTimes?: number[];
  lastReason?: string | null;
  lastSignature?: string | null;
}

export function initialCusum(): CusumState {
  return { s: 0, checks: 0, lastCheckAt: null, lastGateSec: null, episodeChecks: 0, checkTimes: [], lastReason: null, lastSignature: null };
}

/** After an offer is accepted or dismissed, start the statistic again. */
export function resetCusum(state: CusumState): CusumState {
  return { ...state, s: 0, episodeChecks: 0 };
}

/** CUSUM weights for the person's usual retry rate p0 against p1 = max(0.2, 3 p0). */
export function cusumWeights(fit: FitProfile | null | undefined): { p0: number; p1: number; hit: number; clean: number } {
  const p0 = missRate(fit);
  const p1 = Math.min(0.6, Math.max(0.2, 3 * p0));
  return { p0, p1, hit: Math.log(p1 / p0), clean: Math.log((1 - p1) / (1 - p0)) };
}

/** Which kinds of difficulty the window's own counts point at (code gates; Jev is asked only after one fires). */
export function gateKinds(c: StruggleCounts, s: number): StruggleKind[] {
  const k: StruggleKind[] = [];
  const dead = int(c.deadClicks);
  if ((s >= STRUGGLE.cusumCall || int(c.lostClicks) >= 2) && dead === 0) k.push('pointing');
  if (int(c.repeatClicks) >= 2) k.push('accidental_repeat');
  if (int(c.zoomInEvents) >= 1 || int(c.scrollBacks) >= 2 || int(c.longPausesOnShortText) >= 2 || int(c.sidewaysScrolls) >= 3) k.push('reading');
  if (int(c.hoverHunts) >= 1 || int(c.popupsDismissed) >= 2) k.push('finding');
  if (dead >= 3) k.push('site_fault');
  return k;
}

function signature(c: StruggleCounts): string {
  return [c.clicks, c.nearMissClicks, c.lostClicks, c.repeatClicks, c.deadClicks, c.zoomInEvents, c.scrollBacks,
    c.sidewaysScrolls, c.longPausesOnShortText, c.popupsDismissed, c.hoverHunts, c.longFieldDwells, c.typingCorrections]
    .map(int).join(',');
}

function active(c: StruggleCounts): boolean {
  return int(c.clicks) >= 3 || int(c.scrollBacks) + int(c.zoomInEvents) + int(c.hoverHunts) + int(c.longFieldDwells) +
    int(c.popupsDismissed) + int(c.deadClicks) + int(c.sidewaysScrolls) + int(c.typingCorrections) >= 1;
}

function gateReason(kinds: StruggleKind[], c: StruggleCounts, s: number): string {
  const parts: string[] = [];
  for (const k of kinds) {
    if (k === 'pointing') {
      const r = retryClicks(c);
      parts.push(int(c.lostClicks) >= 2 && s < STRUGGLE.cusumCall
        ? `pointing: ${int(c.lostClicks)} clicks slipped off a control`
        : `pointing: ${r} of ${int(c.clicks)} clicks needed a second try (statistic ${s.toFixed(1)}, asks at ${STRUGGLE.cusumCall.toFixed(1)})`);
    } else if (k === 'accidental_repeat') parts.push(`repeat: ${int(c.repeatClicks)} quick double activations`);
    else if (k === 'reading') parts.push(`reading: ${int(c.zoomInEvents)} zoom-ins, ${int(c.scrollBacks)} scroll-backs`);
    else if (k === 'finding') parts.push(`finding: ${int(c.hoverHunts)} hover hunts, ${int(c.popupsDismissed)} popups closed`);
    else if (k === 'site_fault') parts.push(`page: ${int(c.deadClicks)} clicks got no response`);
  }
  return parts.join('; ');
}

/**
 * Decide whether to ask Jev now. Updates a Bernoulli CUSUM on "this click needed a retry" (+ln(p1/p0) per retry,
 * +ln((1-p1)/(1-p0)) per clean click, floor 0) with the window's counts, scaled by how much of the window is new
 * since the last call, and never below what the current window alone shows. Asks when a gate fires and the call
 * budget allows (>= 15 s apart, <= 20 per page-hour), or for a routine check every 60 s while the person is active.
 */
export function gate(state: CusumState, counts: StruggleCounts, fit: FitProfile): { check: boolean; state: CusumState; reason: string } {
  const nowSec = num(counts.timeOnPageSec);
  const w = cusumWeights(fit);
  const clicks = int(counts.clicks);
  const r = retryClicks(counts);
  const llr = r * w.hit + (clicks - r) * w.clean;
  const prevSec = state.lastGateSec ?? null;
  const windowSec = Math.max(1, num(counts.windowMs) / 1000 || 60);
  const fresh = prevSec === null ? 1 : Math.min(1, Math.max(0, (nowSec - prevSec) / windowSec));
  const s = Math.max(0, (Number.isFinite(state.s) ? state.s : 0) + fresh * llr, llr);

  const kinds = gateKinds(counts, s);
  let episodeChecks = state.episodeChecks ?? 0;
  if (s < 0.5 && kinds.length === 0) episodeChecks = 0;
  const checkTimes = (state.checkTimes ?? []).filter((t) => nowSec - t < 3600);
  const next: CusumState = { ...state, s, lastGateSec: nowSec, episodeChecks, checkTimes };

  const sinceLast = state.lastCheckAt === null ? Infinity : nowSec - state.lastCheckAt / 1000;
  const no = (reason: string) => ({ check: false, state: next, reason });
  if (sinceLast < STRUGGLE.minCheckGapSec) return no(`waiting: last check ${Math.round(sinceLast)} s ago`);
  if (checkTimes.length >= STRUGGLE.maxChecksPerHour) return no('waiting: hourly check budget used');

  const sig = signature(counts);
  let reason = '';
  if (kinds.length > 0) {
    const key = kinds.join(',');
    const pointingOnly = kinds.length === 1 && kinds[0] === 'pointing';
    if (pointingOnly && episodeChecks >= STRUGGLE.maxChecksPerEpisode) return no('waiting: this episode was already checked');
    const urgent = kinds.includes('pointing') && s >= STRUGGLE.cusumHold;
    if (key === state.lastReason && sinceLast < STRUGGLE.sameReasonGapSec && !urgent) return no(`waiting: same signals checked ${Math.round(sinceLast)} s ago`);
    if (key === state.lastReason && sig === state.lastSignature && !urgent) return no('waiting: nothing new since the last check');
    reason = gateReason(kinds, counts, s);
    next.lastReason = key;
    if (kinds.includes('pointing')) next.episodeChecks = episodeChecks + 1;
  } else {
    if (!(sinceLast >= STRUGGLE.ambientGapSec) || !active(counts) || sig === state.lastSignature) {
      return no(s > 0 ? `nothing to check (statistic ${s.toFixed(1)})` : 'nothing to check');
    }
    reason = 'routine check: activity in the last minute';
    next.lastReason = 'ambient';
  }
  next.checks = (state.checks ?? 0) + 1;
  next.lastCheckAt = Math.round(nowSec * 1000);
  next.checkTimes = [...checkTimes, nowSec];
  next.lastSignature = sig;
  return { check: true, state: next, reason };
}

/* ------------------------------------------------------------------ */
/* Stage 3: what Jev sees                                              */
/* ------------------------------------------------------------------ */

type Section = 'context' | 'pointing' | 'reading' | 'finding' | 'site' | 'forms';

/** Flat signal key -> state section. Keys follow the measured state (research-struggle §4.2) where they match. */
export const SIGNAL_SECTIONS: Readonly<Record<string, Section>> = Object.freeze({
  input_device: 'context', page_kind: 'context', seconds_observed: 'context', time_on_page: 'context', task_progress: 'context',
  clicks_on_controls: 'pointing', near_misses: 'pointing', near_miss_rate: 'pointing', lost_clicks: 'pointing',
  accidental_double_clicks: 'pointing', clicks_on_wrong_control_then_undone: 'pointing', pointer_path: 'pointing',
  zoom_changes: 'reading', zoom_now_percent: 'reading', full_rereads: 'reading', sideways_scrolling: 'reading',
  long_pauses_on_short_text: 'reading', text_highlighting_while_reading: 'reading',
  hover_hunts: 'finding', popups_dismissed: 'finding',
  clicks_with_no_page_response: 'site',
  long_pauses_on_fields: 'forms', typing_corrections: 'forms',
});

const PROGRESS: Record<StruggleCounts['progress'], string> = {
  none: 'no progress yet', some: 'some progress', steady: 'steady progress',
};

/** Short evidence sentences, written by code from the counts. About clicks and the page, never about the person. */
export function evidenceSentences(c: StruggleCounts): string[] {
  const out: string[] = [];
  const clicks = int(c.clicks);
  const nm = int(c.nearMissClicks);
  const lost = int(c.lostClicks);
  if (nm > 0) out.push(`${nm} of the last ${clicks} clicks landed just outside a control and were followed by a click on that control within 2 s`);
  if (lost > 0) out.push(`${lost} ${plural(lost, 'click was', 'clicks were')} lost: the press began on a control but the pointer slid off before release`);
  const rep = int(c.repeatClicks);
  if (rep > 0) out.push(`${rep} ${plural(rep, 'time', 'times')} a control was switched twice within 250 ms and set back within 2 s`);
  const wrong = int(c.wrongThenUndone);
  if (wrong > 0) out.push(`${wrong} ${plural(wrong, 'click', 'clicks')} on the wrong control ${plural(wrong, 'was', 'were')} undone straight away`);
  const dead = int(c.deadClicks);
  if (dead > 0) out.push(`${dead} ${plural(dead, 'click', 'clicks')} on controls got no visible response from the page within 1 s`);
  const zoom = int(c.zoomInEvents);
  if (zoom > 0) out.push(`the page was zoomed in ${zoom} ${plural(zoom, 'time', 'times')} and is now at ${Math.round(num(c.zoomLevel) * 100 || 100)}%`);
  const back = int(c.scrollBacks);
  if (back > 0) out.push(`the person scrolled back up to re-read ${back} ${plural(back, 'time', 'times')}`);
  const side = int(c.sidewaysScrolls);
  if (side >= 2) out.push(`the page was scrolled sideways ${side} times to see the ends of lines`);
  const pauses = int(c.longPausesOnShortText);
  if (pauses > 0) out.push(`${pauses} long ${plural(pauses, 'pause', 'pauses')} on short pieces of text`);
  const hunts = int(c.hoverHunts);
  if (hunts > 0) out.push(`${hunts} ${plural(hunts, 'time', 'times')} the pointer moved over many items for 20 s or more without choosing any`);
  const pops = int(c.popupsDismissed);
  if (pops > 0) out.push(`${pops} ${plural(pops, 'popup was', 'popups were')} closed`);
  const dwell = int(c.longFieldDwells);
  if (dwell > 0) out.push(`${dwell} long ${plural(dwell, 'pause', 'pauses')} on a form field without typing`);
  const fixes = int(c.typingCorrections);
  if (fixes >= 3) out.push(`${fixes} typing corrections in form fields`);
  return out.slice(0, 8);
}

/** Bands relative to the person's own baseline (raw counts in parentheses) plus evidence sentences. */
export function toSignals(counts: StruggleCounts, fit: FitProfile, pageKind: string): StruggleSignals {
  const c = counts;
  const seconds = Math.max(1, Math.round(num(c.windowMs) / 1000) || 60);
  const p0 = missRate(fit);
  const clicks = int(c.clicks);
  const r = retryClicks(c);
  const wobble = num(c.pathWobble);
  const told = fit?.calibration && num(fit.calibration.durationSec) > 0 ? 'the person told us' : 'not asked';
  const sig: StruggleSignals = {
    page_kind: String(pageKind || 'web page').slice(0, 80),
    time_on_page: `${int(c.timeOnPageSec)} s`,
    task_progress: PROGRESS[c.progress] ?? 'unknown',
    input_device: `${fit?.inputClass ?? 'mouse'} (${told})`,
    seconds_observed: String(seconds),
  };
  sig.clicks_on_controls = String(clicks);
  sig.near_misses = String(int(c.nearMissClicks));
  sig.near_miss_rate = clicks === 0
    ? 'no clicks'
    : `${baselineBand(r / clicks, p0)}: ${oneInText(r, clicks)} needed a second try; usual about 1 in ${Math.round(1 / p0)}`;
  sig.lost_clicks = String(int(c.lostClicks));
  sig.accidental_double_clicks = String(int(c.repeatClicks));
  sig.clicks_on_wrong_control_then_undone = String(int(c.wrongThenUndone));
  sig.pointer_path = clicks === 0 ? 'no clicks' : wobble >= 0.4 ? 'wobbly' : wobble >= 0.25 ? 'somewhat wobbly' : 'steady';
  sig.zoom_changes = String(int(c.zoomInEvents));
  if (int(c.zoomInEvents) > 0) sig.zoom_now_percent = String(Math.round(num(c.zoomLevel) * 100 || 100));
  sig.full_rereads = String(int(c.scrollBacks));
  sig.sideways_scrolling = String(int(c.sidewaysScrolls));
  sig.long_pauses_on_short_text = String(int(c.longPausesOnShortText));
  sig.text_highlighting_while_reading = String(int(c.textSelections));
  sig.hover_hunts = int(c.hoverHunts) === 0 ? '0' : `${baselineBand(int(c.hoverHunts), 0)} (${int(c.hoverHunts)} stretches of 20 s or more pointing at many items without choosing one)`;
  sig.popups_dismissed = String(int(c.popupsDismissed));
  sig.clicks_with_no_page_response = String(int(c.deadClicks));
  sig.long_pauses_on_fields = String(int(c.longFieldDwells));
  sig.typing_corrections = String(int(c.typingCorrections));
  evidenceSentences(c).forEach((e, i) => { sig[`evidence_${i + 1}`] = e; });
  return sig;
}

function typed(v: string): string | number | boolean {
  if (/^(0|[1-9]\d{0,6})$/.test(v)) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

/** One window per call: state {about, context, evidence, pointing, reading, finding, site, forms} + the 9 questions. */
export function buildStruggleCall(signals: StruggleSignals): { state: unknown; questions: Record<string, JevQuestion> } {
  const sections: Record<Section, Record<string, string | number | boolean>> = {
    context: {}, pointing: {}, reading: {}, finding: {}, site: {}, forms: {},
  };
  const evidence: string[] = [];
  const evKeys = Object.keys(signals).filter((k) => /^evidence_\d+$/.test(k)).sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)));
  for (const k of evKeys) {
    const v = signals[k];
    if (typeof v === 'string' && v.trim()) evidence.push(v);
  }
  for (const [k, v] of Object.entries(signals)) {
    if (/^evidence_\d+$/.test(k) || typeof v !== 'string') continue;
    const sec = SIGNAL_SECTIONS[k] ?? 'context';
    sections[sec][k] = sec === 'context' && k !== 'seconds_observed' ? v : typed(v);
  }
  const ctx = sections.context;
  const seconds = typeof ctx.seconds_observed === 'number' ? ctx.seconds_observed : 60;
  const context: Record<string, string | number | boolean> = {
    input_device: ctx.input_device ?? 'mouse (not asked)',
    page_kind: ctx.page_kind ?? 'web page',
    seconds_observed: seconds,
    time_on_page: ctx.time_on_page ?? 'unknown',
    task_progress: ctx.task_progress ?? 'unknown',
  };
  for (const [k, v] of Object.entries(ctx)) if (!(k in context)) context[k] = v;
  const state = {
    about: struggleAbout(seconds),
    context,
    evidence,
    pointing: sections.pointing,
    reading: sections.reading,
    finding: sections.finding,
    site: sections.site,
    forms: sections.forms,
  };
  return { state, questions: { ...STRUGGLE_QUESTIONS } };
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/** StruggleJudgment plus the best_help distribution (used to route within a domain). */
export interface StruggleJudgmentDetail extends StruggleJudgment {
  bestHelp: Record<string, number>;
}

const share = (a: number, b: number): number => (a + b > 0 ? a / (a + b) : 0);

/**
 * Kinds map to the measured Nouls; `slipping` and `dense_text` split the pointing and reading Nouls by Jev's
 * best_help preference (steady_clicks vs bigger_targets; explain_passage vs larger_text). Missing answers are 0.
 */
export function parseStruggle(resp: JevResponse, metrics: JevMetrics): StruggleJudgmentDetail {
  const n = (id: string): number => noulOf(resp, id) ?? 0;
  const bh = choiceOf(resp, 'best_help');
  const probs = bh?.probs ?? {};
  const pointing = n('pointing_struggle');
  const reading = n('reading_struggle');
  const lvl = scoreOf(resp, 'help_level');
  const kinds: Record<StruggleKind, number> = {
    pointing,
    slipping: round2(pointing * share(probs.steady_clicks ?? 0, probs.bigger_targets ?? 0)),
    accidental_repeat: n('accidental_repeat'),
    reading,
    dense_text: round2(reading * share(probs.explain_passage ?? 0, probs.larger_text ?? 0)),
    finding: n('finding_struggle'),
    form: n('form_struggle'),
    deliberate: n('deliberate_activity'),
    site_fault: n('site_not_responding'),
  };
  return { level: lvl ? Math.min(3, Math.max(0, lvl.score)) : 0, kinds, metrics, bestHelp: probs };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Stage 4: offers                                                     */
/* ------------------------------------------------------------------ */

export interface OfferMemory {
  lastOfferAt: number | null;
  today: number;
  snoozedUntil: Record<string, number>;
  off: string[];
  streak: Partial<Record<StruggleKind, number>>;
  /** Local date (YYYY-MM-DD) that `today` counts. */
  day?: string;
  /** nowMs - pageAgeMs of the page the per-page list belongs to. */
  pageStart?: number | null;
  /** Offer kinds already shown on this page view (each at most once, at most 2 kinds). */
  pageShown?: OfferKind[];
}

export function initialOfferMemory(): OfferMemory {
  return { lastOfferAt: null, today: 0, snoozedUntil: {}, off: [], streak: {}, day: '', pageStart: null, pageShown: [] };
}

/** "Not now": this kind is not offered again for 30 minutes. */
export function snoozeOffer(mem: OfferMemory, kind: OfferKind, nowMs: number): OfferMemory {
  return { ...mem, snoozedUntil: { ...mem.snoozedUntil, [kind]: nowMs + STRUGGLE.notNowMs } };
}

/** "Don't suggest this": off until turned back on in settings. */
export function turnOffOffer(mem: OfferMemory, kind: OfferKind): OfferMemory {
  return mem.off.includes(kind) ? mem : { ...mem, off: [...mem.off, kind] };
}

/** Copy per offer kind (research-struggle §7.2): question, primary button, toast after applying. */
export const OFFER_COPY: Readonly<Record<OfferKind, { question: string; primary: string; toast: string }>> = Object.freeze({
  bigger_targets: { question: 'Make buttons bigger on this page?', primary: 'Make bigger', toast: 'Buttons are bigger on this page.' },
  steady_clicks: { question: 'Count a click where the press starts?', primary: 'Turn on steady clicks', toast: 'Steady clicks is on for this site.' },
  debounce: { question: 'Ignore quick double clicks here?', primary: 'Ignore double clicks', toast: 'Quick double clicks are ignored on this site.' },
  larger_text: { question: 'Make text larger on this page?', primary: 'Make larger', toast: 'Text is larger on this page.' },
  calm_view: { question: 'See a calmer version of this page?', primary: 'Preview', toast: 'Calm view is on.' },
  main_actions: { question: 'Show the main things you can do here?', primary: 'Show list', toast: 'The main actions are listed in the panel.' },
});

interface Domain {
  kind: StruggleKind;
  tau: number;
  needsLevel: boolean;
  windows: number;
  vetoDeliberate: boolean;
  evidence: (c: StruggleCounts) => boolean;
  offer: (j: StruggleJudgment, c: StruggleCounts) => OfferKind;
  what: string; // how Jev's Noul reads in "Why this?"
}

const DOMAINS: readonly Domain[] = [
  {
    kind: 'pointing', tau: STRUGGLE.tau, needsLevel: true, windows: STRUGGLE.pointingWindows, vetoDeliberate: true,
    evidence: (c) => retryClicks(c) >= 3 || int(c.lostClicks) >= 2,
    offer: (j, c) => {
      const p = j.kinds.pointing ?? 0;
      const slip = p > 0 ? (j.kinds.slipping ?? 0) / p : int(c.lostClicks) > int(c.nearMissClicks) ? 1 : 0;
      return slip > 0.5 ? 'steady_clicks' : 'bigger_targets';
    },
    what: 'clicks keep missing their controls',
  },
  {
    kind: 'accidental_repeat', tau: STRUGGLE.tauRepeat, needsLevel: false, windows: 1, vetoDeliberate: true,
    evidence: (c) => int(c.repeatClicks) >= 2,
    offer: () => 'debounce',
    what: 'controls were switched twice by accident',
  },
  {
    kind: 'reading', tau: STRUGGLE.tau, needsLevel: true, windows: 1, vetoDeliberate: false,
    evidence: (c) => int(c.zoomInEvents) >= 1 || int(c.scrollBacks) >= 2 || int(c.longPausesOnShortText) >= 2 || int(c.sidewaysScrolls) >= 3,
    // A zoom-in is an expressed size need (research-struggle §0.6); re-reading gets larger text too.
    offer: () => 'larger_text',
    what: 'the text here is hard going as shown',
  },
  {
    kind: 'finding', tau: STRUGGLE.tau, needsLevel: true, windows: 1, vetoDeliberate: false,
    evidence: (c) => int(c.hoverHunts) >= 1 || int(c.popupsDismissed) >= 2 || int(c.scrollBacks) >= 3,
    offer: (j) => {
      const bh = (j as Partial<StruggleJudgmentDetail>).bestHelp;
      return bh && (bh.find_helper ?? 0) > (bh.calm_view ?? 0) ? 'main_actions' : 'calm_view';
    },
    what: 'things are hard to find on this page',
  },
];

/** Consecutive judgments, newest first, at or above each kind's threshold. */
function streaks(history: StruggleJudgment[]): Partial<Record<StruggleKind, number>> {
  const out: Partial<Record<StruggleKind, number>> = {};
  for (const d of DOMAINS) {
    let n = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if ((history[i]?.kinds?.[d.kind] ?? 0) >= d.tau) n++;
      else break;
    }
    out[d.kind] = n;
  }
  return out;
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function normalize(mem: OfferMemory | null | undefined, nowMs: number, pageAgeMs: number): OfferMemory {
  const base = mem ?? initialOfferMemory();
  const m: OfferMemory = {
    lastOfferAt: base.lastOfferAt ?? null,
    today: num(base.today),
    snoozedUntil: { ...(base.snoozedUntil ?? {}) },
    off: [...(base.off ?? [])],
    streak: { ...(base.streak ?? {}) },
    day: base.day ?? '',
    pageStart: base.pageStart ?? null,
    pageShown: [...(base.pageShown ?? [])],
  };
  const key = dayKey(nowMs);
  if (m.day !== key) {
    m.day = key;
    m.today = 0;
  }
  const start = nowMs - Math.max(0, pageAgeMs);
  if (m.pageStart === null || m.pageStart === undefined || Math.abs(start - m.pageStart) > 5000) {
    m.pageStart = start;
    m.pageShown = [];
  }
  return m;
}

function offerText(kind: OfferKind, c: StruggleCounts): { fact: string; numbers: string } {
  const clicks = int(c.clicks);
  const r = retryClicks(c);
  const lost = int(c.lostClicks);
  switch (kind) {
    case 'bigger_targets':
      return {
        fact: r > 0 && clicks > 0 ? `${r} of the last ${clicks} clicks here needed a second try.` : 'Some buttons here are small.',
        numbers: `${r} of the last ${clicks} clicks needed a second try on the same button.`,
      };
    case 'steady_clicks':
      return {
        fact: lost > 0 ? `${lost} ${plural(lost, 'click', 'clicks')} here slipped off a button before release.` : 'A click can slip off a button before release.',
        numbers: `${lost} of the last ${clicks} clicks slipped off a button before release.`,
      };
    case 'debounce': {
      const n = int(c.repeatClicks);
      return {
        fact: n >= 2 ? `A switch here turned on and straight back off ${n} times.` : 'A switch turned on and straight back off.',
        numbers: `${n} times a control was switched twice within 250 ms and set back.`,
      };
    }
    case 'larger_text': {
      const zoom = int(c.zoomInEvents);
      const pct = Math.round(num(c.zoomLevel) * 100 || 100);
      if (zoom > 0 && pct > 100) return { fact: `This page was zoomed in to ${pct}%.`, numbers: `The page was zoomed in ${zoom} ${plural(zoom, 'time', 'times')}, to ${pct}%.` };
      const back = int(c.scrollBacks);
      if (back >= 2) return { fact: `Text here was scrolled back to ${back} times.`, numbers: `The page was scrolled back to re-read ${back} times.` };
      return { fact: 'Text on this page can be made larger.', numbers: `${int(c.longPausesOnShortText)} long pauses on short text.` };
    }
    case 'calm_view':
      return {
        fact: 'Same page, fewer distractions. Every button still works.',
        numbers: `${int(c.hoverHunts)} stretches of pointing at many items without choosing one; ${int(c.popupsDismissed)} popups closed.`,
      };
    case 'main_actions':
      return {
        fact: 'This page has many links and buttons.',
        numbers: `${int(c.hoverHunts)} stretches of pointing at many items without choosing one.`,
      };
  }
}

function makeOffer(kind: OfferKind, d: Domain, j: StruggleJudgment, c: StruggleCounts, streak: number): Offer {
  const p = j.kinds[d.kind] ?? 0;
  const t = offerText(kind, c);
  const checks = d.windows > 1 ? `, in ${streak} checks in a row` : '';
  return {
    kind,
    question: OFFER_COPY[kind].question,
    fact: t.fact,
    why:
      `${t.numbers} WebAble counted this on your device. To check the suggestion, it sent only counts like these: ` +
      `no page text and nothing you typed. Jev: ${f2(p)} that ${d.what}${checks} (offers start at ${f2(d.tau)}).`,
    p,
  };
}

/**
 * Turn the judgment history into at most one offer. Rules: the domain Noul >= 0.75 (0.80 for accidental repeats)
 * with local evidence in that domain, help_level >= 1.0 (not for repeats), site_not_responding < 0.70, and
 * deliberate_activity < 0.40 for pointing and repeats; pointing must hold for 2 consecutive checks. 0.50-0.75 waits.
 * Budget: no offer in the first 10 s, only at an idle moment, >= 90 s apart, <= 6 a day, each kind once per page
 * and <= 2 kinds per page, "Not now" snoozes 30 min, "Don't suggest" turns a kind off.
 */
export function decideOffers(
  history: StruggleJudgment[], counts: StruggleCounts, mem: OfferMemory, nowMs: number, pageAgeMs: number, idle: boolean,
): { offers: Offer[]; waiting: StruggleKind[]; mem: OfferMemory } {
  const m = normalize(mem, nowMs, pageAgeMs);
  const latest = history[history.length - 1];
  m.streak = streaks(history);
  if (!latest) return { offers: [], waiting: [], mem: m };
  const k = latest.kinds;
  if ((k.site_fault ?? 0) >= STRUGGLE.siteFault) return { offers: [], waiting: [], mem: m };
  const deliberate = (k.deliberate ?? 0) >= STRUGGLE.deliberateVeto;
  const levelOk = latest.level >= STRUGGLE.levelMin;

  const waiting: StruggleKind[] = [];
  const eligible: Array<{ kind: OfferKind; d: Domain; p: number; streak: number }> = [];
  for (const d of DOMAINS) {
    const p = k[d.kind] ?? 0;
    if (d.vetoDeliberate && deliberate) continue;
    if (p < STRUGGLE.waitLow) continue;
    const streak = m.streak[d.kind] ?? 0;
    const ready = p >= d.tau && streak >= d.windows && (!d.needsLevel || levelOk);
    if (!ready) {
      waiting.push(d.kind);
      continue;
    }
    if (!d.evidence(counts)) continue; // act only on the domain the counts point at (no cross-talk offers)
    eligible.push({ kind: d.offer(latest, counts), d, p, streak });
  }

  const shown = m.pageShown ?? [];
  const budgetOk =
    pageAgeMs >= STRUGGLE.firstOfferMs &&
    idle &&
    (m.lastOfferAt === null || nowMs - m.lastOfferAt >= STRUGGLE.offerGapMs) &&
    m.today < STRUGGLE.maxPerDay &&
    shown.length < STRUGGLE.maxKindsPerPage;
  const allowed = budgetOk
    ? eligible.filter((e) =>
      !m.off.includes(e.kind) && !m.off.includes(e.d.kind) &&
      !((m.snoozedUntil[e.kind] ?? 0) > nowMs) && !((m.snoozedUntil[e.d.kind] ?? 0) > nowMs) &&
      !shown.includes(e.kind))
    : [];
  allowed.sort((a, b) => b.p - a.p);
  const pick = allowed[0];
  if (!pick) return { offers: [], waiting, mem: m };

  m.lastOfferAt = nowMs;
  m.today += 1;
  m.pageShown = [...shown, pick.kind];
  return { offers: [makeOffer(pick.kind, pick.d, latest, counts, pick.streak)], waiting, mem: m };
}

/* ------------------------------------------------------------------ */
/* Offer choice against the fit (round 2)                              */
/* ------------------------------------------------------------------ */

/** What the page looks like for the person right now, for choosing between offers. */
export interface OfferPageFacts {
  /** The fit's own hit-area size is already applied on this page. */
  targetsApplied: boolean;
  /** Smallest hit area among the page's main buttons and links after the fit, in CSS px (null when unknown). */
  smallestTargetPx?: number | null;
  /** The page is busy enough for a calmer layout (folded distractions or many items). */
  busy: boolean;
  calmOpen: boolean;
}

/** The fit's targets meet the need when they are applied and at least 44 px (WCAG 2.5.5's size). */
export function fitTargetsMeetNeed(fit: FitProfile | null | undefined, page: OfferPageFacts): boolean {
  const min = fit?.targets?.minPx ?? null;
  if (min === null || !Number.isFinite(min) || min < 44) return false;
  if (page.smallestTargetPx !== undefined && page.smallestTargetPx !== null) return page.smallestTargetPx >= Math.min(min, 44);
  return page.targetsApplied;
}

/**
 * The offer to show for a struggle offer, given the fit. "Make buttons bigger" is not offered when the fit's own
 * targets already meet the need (Rosa's are 56 px): bigger buttons would change nothing visible. Then the Calm view
 * is offered on a busy page (fewer things to aim at), else nothing. Every other offer passes through.
 */
export function chooseOfferForFit(offer: Offer, fit: FitProfile | null | undefined, page: OfferPageFacts): Offer | null {
  if (offer.kind !== 'bigger_targets') return offer;
  if (!fitTargetsMeetNeed(fit, page)) return offer;
  if (!page.busy || page.calmOpen) return null;
  const px = Math.round(fit?.targets?.minPx ?? 44);
  return {
    kind: 'calm_view',
    question: OFFER_COPY.calm_view.question,
    fact: 'Same page, fewer things to aim at. Every button still works.',
    why: `Buttons here already have ${px} px click areas from your fit, so bigger buttons would not help. ${offer.why}`,
    p: offer.p,
  };
}
