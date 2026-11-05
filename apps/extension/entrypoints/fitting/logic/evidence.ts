// What the person struggled with, in their own numbers, for the results page (docs/design/ONBOARDING.md, round 8c).
// Built once at the end of the onboarding from the raw tasks and the real-site results, saved next to the settings,
// and shown only after everything is done. Plain counts and ratios; never pixels.
import type { FittingRaw } from '@webable/core';
import type { SiteTaskResult } from '../../../src/sitetask/types';
import { IN_THE_WAY } from './steps';

export interface RunEvidence {
  /** Reading: how much slower the smallest sentences they still read were than their large-size pace (1.4 = 40% slower). */
  reading: { slowdown: number | null; tooSmallCount: number } | null;
  /** Faint words: true when they could not make out words at the light grey many sites use (about 4.5:1 or lower). */
  faint: { missedCommonGrey: boolean } | null;
  /** Dots: misses on the smaller dots, and presses that slipped off anywhere in the flow. */
  pointing: { smallMisses: number; smallTotal: number; slips: number; presses: number } | null;
  /** Real sites, in the order visited. */
  sites: SiteTaskResult[];
  /** Busiest found time divided by quietest found time; null without one of each. */
  busySlowdown: { ratio: number; busyName: string; quietName: string } | null;
  /** What they said got in their way, as chip ids. */
  gotInWay: string[];
}

/* ------------------------------------------------------------------ */
/* How the numbers are read (the flow's own rules, not core's)         */
/* ------------------------------------------------------------------ */

/**
 * The light greys many websites use for text run from about 2:1 (#bbb) to 4.5:1 (#767676) on white. A wrong answer
 * at one of those greys, or at anything darker, means that grey is hard for them to read.
 */
export const COMMON_GREY_MIN = 2;
/** Reading words this light (or lighter) correctly at least twice means a miss at a common grey was a slip, not a need. */
const SEES_LIGHTER = 1.5;
/** Dots smaller than this (px at 100%) are "the smaller dots"; a walk that never went below it uses its smallest block. */
export const SMALL_DOT_PX = 44;

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const round2 = (x: number): number => Math.round(x * 100) / 100;
const cant = (t: object): boolean => (t as { cant?: boolean }).cant === true;

function medianOf(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function isSiteResult(x: unknown): x is SiteTaskResult {
  return !!x && typeof x === 'object' && typeof (x as SiteTaskResult).name === 'string' && typeof (x as SiteTaskResult).busy === 'boolean';
}

/**
 * Reading: median time per sentence at the smallest sizes they still answered correctly, over their median at the
 * largest sizes (up to three of each, never overlapping; needs three correct sentences). "I can't read it" answers are
 * counted as too small.
 */
export function readingEvidence(raw: FittingRaw): RunEvidence['reading'] {
  const ladder = (raw.reading?.ladder ?? []).filter((t) => finite(t.px) && finite(t.ms));
  if (!ladder.length) return null;
  const tooSmallCount = ladder.filter(cant).length;
  const read = ladder.filter((t) => t.correct && !cant(t) && t.ms > 0).sort((a, b) => a.px - b.px);
  let slowdown: number | null = null;
  if (read.length >= 3) {
    const k = read.length >= 6 ? 3 : read.length >= 4 ? 2 : 1;
    const small = read.slice(0, k);
    const large = read.slice(-k);
    const smallest = small[small.length - 1];
    const largest = large[0];
    if (smallest && largest && smallest.px < largest.px) {
      const base = medianOf(large.map((t) => t.ms));
      if (base > 0) slowdown = round2(medianOf(small.map((t) => t.ms)) / base);
    }
  }
  return { slowdown, tooSmallCount };
}

/** Faint words: a wrong answer at a common light grey (about 2:1 to 4.5:1) or darker, unless they read much lighter words. */
export function faintEvidence(raw: FittingRaw): RunEvidence['faint'] {
  const trials = (raw.reading?.faint ?? []).filter((t) => finite(t.contrast));
  if (!trials.length) return null;
  const missed = trials.some((t) => !t.correct && t.contrast >= COMMON_GREY_MIN);
  const seesLighter = trials.filter((t) => t.correct && t.contrast < SEES_LIGHTER).length >= 2;
  return { missedCommonGrey: missed && !seesLighter };
}

/**
 * Pointing: misses on the smaller dots plus the clicks on real sites that landed just beside the target. With dots,
 * smallTotal counts the smaller dots pressed plus those near misses (so smallMisses never exceeds it); with no dots,
 * smallTotal is 0 and smallMisses is the near misses alone. Slips and presses are every press in the flow and on the
 * sites (allPresses).
 */
export function pointingEvidence(raw: FittingRaw, sites: readonly SiteTaskResult[]): RunEvidence['pointing'] {
  const blocks = (raw.pointing?.blocks ?? []).filter((b) => finite(b.sizePx) && Array.isArray(b.presses) && b.presses.length);
  let small = blocks.filter((b) => b.sizePx < SMALL_DOT_PX);
  if (!small.length && blocks.length) {
    const least = Math.min(...blocks.map((b) => b.sizePx));
    small = blocks.filter((b) => b.sizePx === least && least <= SMALL_DOT_PX);
  }
  const dotPresses = small.reduce((n, b) => n + b.presses.length, 0);
  const dotMisses = small.reduce((n, b) => n + b.presses.filter((p) => !p.hit).length, 0);
  const nearMisses = sites.reduce((n, s) => n + Math.max(0, Math.round(finite(s.nearMisses) ? s.nearMisses : 0)), 0);
  const presses = raw.allPresses ?? [];
  if (!blocks.length && !presses.length && !nearMisses) return null;
  return {
    smallMisses: dotMisses + nearMisses,
    smallTotal: dotPresses ? dotPresses + nearMisses : 0,
    slips: presses.filter((p) => p.slipped).length,
    presses: presses.length,
  };
}

/**
 * Busy pages: the found time on the busiest busy site (most ads; the first on a tie) over the found time on the
 * quietest quiet site. Null without a found time on one of each.
 */
export function busyEvidence(sites: readonly SiteTaskResult[]): RunEvidence['busySlowdown'] {
  const found = sites.filter((s) => s.found && finite(s.ms) && s.ms > 0);
  const busy = found.filter((s) => s.busy);
  const quiet = found.filter((s) => !s.busy);
  if (!busy.length || !quiet.length) return null;
  const ads = (s: SiteTaskResult): number => (finite(s.adsSeen) ? s.adsSeen : 0);
  const busiest = busy.reduce((a, b) => (ads(b) > ads(a) ? b : a));
  const quietest = quiet.reduce((a, b) => (ads(b) < ads(a) ? b : a));
  return { ratio: round2((busiest.ms as number) / (quietest.ms as number)), busyName: busiest.name, quietName: quietest.name };
}

/** The chip ids they picked for "Did anything get in your way?" (never the internal stop note). */
export function gotInWayOf(raw: FittingRaw): string[] {
  const ids = new Set(IN_THE_WAY.map((c) => c.id));
  return [...new Set((raw.finding?.gotInWay ?? []).filter((c) => typeof c === 'string' && ids.has(c)))];
}

/** Implemented by the flow (round 8c). Must never throw; missing parts come back null or empty. */
export function buildEvidence(raw: FittingRaw, sites: SiteTaskResult[]): RunEvidence {
  const list = safe(() => (Array.isArray(sites) ? sites.filter(isSiteResult) : []), [] as SiteTaskResult[]);
  if (!raw || typeof raw !== 'object') {
    return { reading: null, faint: null, pointing: null, sites: list, busySlowdown: busyEvidence(list), gotInWay: [] };
  }
  return {
    reading: safe(() => readingEvidence(raw), null),
    faint: safe(() => faintEvidence(raw), null),
    pointing: safe(() => pointingEvidence(raw, list), null),
    sites: list,
    busySlowdown: safe(() => busyEvidence(list), null),
    gotInWay: safe(() => gotInWayOf(raw), []),
  };
}
