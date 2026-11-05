// What makes the web harder for this person, and how strongly (docs/design/ONBOARDING.md, round 8c point 5).
// Six struggles, each 0-100, from the saved settings (FitProfile) plus, when we have them, their own numbers from the
// onboarding (RunEvidence). The results page leads with the strongest as cards: the problem, their evidence in plain
// spoken numbers, then what WebAble does about it. Pure and deterministic: the chart, the cards and the tests read the
// same numbers. Nothing here ever puts a pixel value or a technical word in front of a person.
import type { FitProfile } from '@webable/core';
import type { RunEvidence } from '../logic/evidence';

export type StruggleId = 'text' | 'faint' | 'buttons' | 'slips' | 'busy' | 'motion';

/** Chart order, clockwise from the top. */
export const STRUGGLE_ORDER: readonly StruggleId[] = ['text', 'faint', 'buttons', 'slips', 'busy', 'motion'];

export const STRUGGLE_LABELS: Record<StruggleId, string> = {
  text: 'Small text',
  faint: 'Faint text',
  buttons: 'Small buttons',
  slips: 'Click slips',
  busy: 'Busy pages',
  motion: 'Moving things',
};

export const PROBLEM_LINES: Record<StruggleId, string> = {
  text: 'Small text slows you down.',
  faint: 'Faint grey text is hard for you to read.',
  buttons: 'Small buttons are easy to miss.',
  slips: 'Your clicks don’t always land where you meant.',
  busy: 'Busy pages slow you down.',
  motion: 'Moving things pull your attention away.',
};

/** Follows "WebAble fixes this:". */
export const FIX_LINES: Record<StruggleId, string> = {
  text: 'Text is made larger on every site, and headings stay in order.',
  faint: 'Faint text is made darker.',
  buttons: 'Buttons and links get easier to hit.',
  slips: 'Your clicks stay on what you meant to press.',
  busy: 'Busy pages become a clean, simple page.',
  motion: 'Moving things are paused.',
};

/** The evidence line when there are no numbers of their own (settings opened later, or the demo): from the fit, no numbers. */
export const FIT_LINES: Record<StruggleId, string> = {
  text: 'You read best when text is larger than most websites make it.',
  faint: 'You read best when words are darker than many websites make them.',
  buttons: 'You hit things best when they are bigger than most websites make them.',
  slips: 'Sometimes a press slides off what you meant before you let go.',
  busy: 'Ads, pop-ups and crowded pages make things harder to find.',
  motion: 'Slideshows and moving ads make it hard to keep your place.',
};

/** Shown in place of the fix line when the person has turned that fix off below. */
export const FIX_OFF_LINE = 'Turned off for now. You can turn it back on below.';

/** Simplified busy pages are on for everyone, and busy pages slow everyone a little, so this never drops below this. */
export const BUSY_FLOOR = 35;
/** A struggle this strong gets a card. */
export const CARD_MIN = 25;
/** A struggle this strong is worth leading with ("Here's what makes the web harder for you."). */
export const STRONG = 50;
export const MAX_CARDS = 4;

export interface Struggle {
  id: StruggleId;
  label: string;
  value: number; // 0-100, how strongly it gets in their way
}

export interface StruggleCard {
  id: StruggleId;
  value: number;
  problem: string;
  /** One line in their own numbers, or the fit-only line when we have none. */
  evidence: string;
  /** True when `evidence` came from their own numbers. */
  measured: boolean;
  fix: string;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/* ---------------- From the fit ---------------- */

/** The text size WebAble shows (a size the person set wins over the measured one). Internal; never shown as a number. */
export function bodyPxOf(fit: FitProfile): number {
  return finite(fit.text?.override ?? fit.text?.bodyPx, 16);
}

/** The smallest click area WebAble makes, or null when it leaves click areas alone. Internal; never shown. */
export function minPxOf(fit: FitProfile): number | null {
  const t = fit.targets?.minPx;
  return typeof t === 'number' && Number.isFinite(t) && t > 24 ? t : null;
}

/**
 * Text: nothing at the web's usual size, all of it at one and a half times that and up. Log scale, because size is
 * felt as a ratio.
 */
export function textValue(px: number): number {
  if (!(px > 16.5)) return 0;
  return Math.round(clamp((100 * Math.log(px / 16)) / Math.log(1.5), 0, 100));
}

/** Click areas: nothing at the usual minimum, some at 44, all of it at 72 and up, log scale. */
export function buttonsValue(minPx: number | null): number {
  if (minPx == null || minPx <= 24) return 0;
  return Math.round(clamp((100 * Math.log(minPx / 24)) / Math.log(3), 0, 100));
}

/** Whether WebAble's fix for this struggle is on in these settings. A card only promises a fix that is on. */
export function fixOn(id: StruggleId, fit: FitProfile): boolean {
  switch (id) {
    case 'text':
      return bodyPxOf(fit) > 16.5;
    case 'faint':
      return (fit.contrast?.band ?? 'N') !== 'N';
    case 'buttons':
      return minPxOf(fit) != null;
    case 'slips':
      return !!fit.clicks?.steady?.on;
    case 'busy':
      return true;
    case 'motion':
      return !!fit.attention?.motion?.on;
  }
}

function fitStrength(id: StruggleId, fit: FitProfile): number {
  switch (id) {
    case 'text':
      return textValue(bodyPxOf(fit));
    case 'faint': {
      const band = fit.contrast?.band ?? 'N';
      return band === 'S' ? 85 : band === 'M' ? 55 : 0;
    }
    case 'buttons':
      return buttonsValue(minPxOf(fit));
    case 'slips': {
      const slip = clamp(finite(fit.baselines?.slipRate, 0.02), 0, 1);
      return fit.clicks?.steady?.on ? clamp(55 + slip * 200, 55, 85) : 0;
    }
    case 'busy': {
      const level = fit.attention?.structureLevel ?? 0;
      const clutterP = clamp(finite(fit.attention?.clutter?.p, 0.25), 0, 1);
      return clamp(Math.max(BUSY_FLOOR, level === 2 ? 80 : level === 1 ? 58 : 0, clutterP * 100), BUSY_FLOOR, 100);
    }
    case 'motion': {
      const p = clamp(finite(fit.attention?.motion?.p, 0.3), 0, 1);
      return fit.attention?.motion?.on ? clamp(50 + p * 35, 50, 85) : 0;
    }
  }
}

/* ---------------- From their own numbers ---------------- */

/** The same words core reads from the "Did anything get in your way?" chips. */
const saidMoving = (ev: RunEvidence): boolean => (ev.gotInWay ?? []).some((c) => /mov|motion|animat/i.test(c));
const saidBusy = (ev: RunEvidence): boolean => (ev.gotInWay ?? []).some((c) => /too much|busy|clutter|crowd/i.test(c));

const sites = (ev: RunEvidence): RunEvidence['sites'] => (Array.isArray(ev.sites) ? ev.sites : []);
const siteNearMisses = (ev: RunEvidence): number => sites(ev).reduce((n, s) => n + count(s.nearMisses), 0);

/** Slipped presses and all presses: the whole flow when we have it, else just the real sites. */
function slipCounts(ev: RunEvidence): { slips: number; presses: number } {
  if (ev.pointing) return { slips: count(ev.pointing.slips), presses: count(ev.pointing.presses) };
  return sites(ev).reduce(
    (a, s) => ({ slips: a.slips + count(s.slips), presses: a.presses + count(s.presses) }),
    { slips: 0, presses: 0 },
  );
}

const readingSlowdown = (ev: RunEvidence): number | null => {
  const s = ev.reading?.slowdown;
  return typeof s === 'number' && Number.isFinite(s) && s >= 1.05 ? s : null;
};

const busyRatio = (ev: RunEvidence): RunEvidence['busySlowdown'] => {
  const b = ev.busySlowdown;
  return b && Number.isFinite(b.ratio) && b.ratio >= 1.15 && b.busyName && b.quietName ? b : null;
};

function evidenceStrength(id: StruggleId, ev: RunEvidence): number {
  switch (id) {
    case 'text': {
      const s = readingSlowdown(ev);
      const tooSmall = count(ev.reading?.tooSmallCount);
      return Math.max(s ? clamp((s - 1) * 200, 0, 100) : 0, tooSmall ? 30 + 10 * Math.min(tooSmall, 3) : 0);
    }
    case 'faint':
      return ev.faint?.missedCommonGrey ? 65 : 0;
    case 'buttons': {
      const p = ev.pointing;
      const missed = p && count(p.smallTotal) > 0 ? count(p.smallMisses) / count(p.smallTotal) : 0;
      const near = siteNearMisses(ev);
      return Math.max(missed > 0 ? clamp(25 + 150 * missed, 0, 100) : 0, near ? Math.min(55, 25 + 10 * near) : 0);
    }
    case 'slips': {
      const { slips, presses } = slipCounts(ev);
      if (!slips) return 0;
      const rate = presses > 0 ? slips / presses : 0.05;
      return clamp(20 + rate * 800, 0, 100);
    }
    case 'busy': {
      const b = busyRatio(ev);
      return Math.max(b ? clamp((b.ratio - 1) * 100, 0, 100) : 0, saidBusy(ev) ? 60 : 0);
    }
    case 'motion':
      return saidMoving(ev) ? 70 : sites(ev).some((s) => s.motionSeen) ? 20 : 0;
  }
}

/**
 * How strongly each struggle gets in their way, in chart order. The fit decides whether it is a real need (so every
 * card's fix is true); their own numbers can make it stronger. A struggle whose fix is off stays below a card.
 */
export function struggleValues(fit: FitProfile, evidence: RunEvidence | null = null): Struggle[] {
  return STRUGGLE_ORDER.map((id) => {
    const ev = evidence ? evidenceStrength(id, evidence) : 0;
    const value = fixOn(id, fit) ? Math.max(fitStrength(id, fit), ev) : Math.min(ev * 0.5, CARD_MIN - 1);
    return { id, label: STRUGGLE_LABELS[id], value: Math.round(clamp(value, 0, 100)) };
  });
}

/* ---------------- Speech ---------------- */

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** A slowdown as a spoken percentage: 1.42 → 40 ("about 40%"). Nearest 5 below 25%, nearest 10 above. */
export function aboutPercent(slowdown: number): number {
  const pct = (slowdown - 1) * 100;
  if (pct < 25) return Math.max(5, Math.round(pct / 5) * 5);
  return Math.round(pct / 10) * 10;
}

/** A ratio as spoken words: "twice", "three times", "1.5 times". Never more than one decimal. */
export function timesWords(ratio: number): string {
  if (ratio >= 2.75) {
    const n = Math.round(ratio);
    return `${NUMBER_WORDS[n] ?? String(n)} times`;
  }
  const r = ratio >= 1.25 ? Math.round(ratio * 2) / 2 : Math.round(ratio * 10) / 10;
  if (r === 2) return 'twice';
  return `${r} times`;
}

/** Their own numbers for this struggle, as one line: the first template that has data, or null. */
export function evidenceLine(id: StruggleId, ev: RunEvidence | null): string | null {
  if (!ev) return null;
  switch (id) {
    case 'text': {
      const s = readingSlowdown(ev);
      if (s) return `As the text got smaller, your reading slowed by about ${aboutPercent(s)}%.`;
      if (count(ev.reading?.tooSmallCount)) return 'Some sentences were too small to read.';
      return null;
    }
    case 'faint':
      return ev.faint?.missedCommonGrey ? 'You couldn’t make out words in the light grey many websites use.' : null;
    case 'buttons': {
      const p = ev.pointing;
      if (p && count(p.smallMisses) > 0 && count(p.smallTotal) > 0) {
        return `You missed ${count(p.smallMisses)} of the ${count(p.smallTotal)} smaller dots.`;
      }
      if (siteNearMisses(ev)) return 'Some of your clicks on real sites landed just beside what you aimed for.';
      return null;
    }
    case 'slips': {
      const { slips } = slipCounts(ev);
      return slips ? `${slips} of your presses slipped off what you were pressing.` : null;
    }
    case 'busy': {
      const b = busyRatio(ev);
      if (b) return `Finding something on ${b.busyName} took you ${timesWords(b.ratio)} as long as on ${b.quietName}.`;
      if (saidBusy(ev)) return 'You said there was too much on the page.';
      return null;
    }
    case 'motion': {
      if (saidMoving(ev)) return 'You said moving things got in your way.';
      const site = sites(ev).find((s) => s.motionSeen);
      return site ? `Something was moving on ${site.name} while you searched.` : null;
    }
  }
}

const byValue = (a: Struggle, b: Struggle): number =>
  b.value - a.value || STRUGGLE_ORDER.indexOf(a.id) - STRUGGLE_ORDER.indexOf(b.id);

/** The struggle cards, strongest first, at most four, each with its problem, their evidence and the fix. */
export function struggleCards(
  fit: FitProfile,
  evidence: RunEvidence | null = null,
  values: Struggle[] = struggleValues(fit, evidence),
): StruggleCard[] {
  return values
    .filter((s) => s.value >= CARD_MIN)
    .sort(byValue)
    .slice(0, MAX_CARDS)
    .map((s) => {
      const own = evidenceLine(s.id, evidence);
      return {
        id: s.id,
        value: s.value,
        problem: PROBLEM_LINES[s.id],
        evidence: own ?? FIT_LINES[s.id],
        measured: own != null,
        fix: FIX_LINES[s.id],
      };
    });
}

/** True when at least one struggle is strong enough to lead with "Here's what makes the web harder for you." */
export function anyStrong(values: Struggle[]): boolean {
  return values.some((s) => s.value >= STRONG);
}

/** Plain words for how strongly it gets in the way, for the chart's hidden table (never a number). */
export function amountWords(value: number): string {
  if (value >= 70) return 'A lot';
  if (value >= STRONG) return 'Quite a bit';
  if (value >= CARD_MIN) return 'A little';
  return 'Hardly at all';
}
