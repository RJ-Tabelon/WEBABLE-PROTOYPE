import type { AttentionSummary } from './schema';
import type {
  FindTextTrial,
  FocusSession,
  NextActionTrial,
  SearchTrial,
} from './trials';

/**
 * Focus calibration (cal-attention.md 4-5). Every effect is a within-person
 * log-time difference oriented so that a positive value means the matching
 * adaptation is expected to help:
 *
 * - clutter:  ln t(busy) - ln t(clean)
 * - motion:   ln t(animated or salient) - ln t(still)
 * - guidance: ln t(weak hierarchy) - ln t(strong hierarchy)
 * - chunking: ln t(dense) - ln t(chunked)
 *
 * `FocusSession.search` holds the scored search trials only (the practice
 * trial is not recorded). Nothing here is a trait estimate: these are
 * responses to page manipulations, shrunk later by `deriveFitProfile`.
 */

/** Search time floor after subtracting predicted movement time, seconds. */
const MIN_SEARCH_S = 0.2;
/** Timeout for a search trial, ms. */
const SEARCH_TIMEOUT_MS = 12_000;
/** Outlier rule: more than 3 MAD from the person's median log time (MAD floored). */
const OUTLIER_MADS = 3;
const MAD_FLOOR = 0.1;
/** Within-cell SD floors (cal-attention.md 3.2 assumptions pending pilot data). */
const SEARCH_SD_FLOOR = 0.3;
const READING_SD_FLOOR = 0.2;
/** Behaviour counts as "no evidence" when more than a third of trials are invalid. */
const MAX_INVALID_SHARE = 1 / 3;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((a, b) => a + b, 0) / values.length;
}

function middle(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1
    ? (s[mid] ?? 0)
    : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

function round(value: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

type Effect = NonNullable<AttentionSummary['effects']['clutter']>;

/** Pooled within-group SD across groups, floored. */
function pooledSd(
  groups: ReadonlyArray<readonly number[]>,
  floor: number,
): number {
  let ss = 0;
  let df = 0;
  for (const g of groups) {
    if (g.length < 2) continue;
    const m = mean(g);
    ss += g.reduce((a, y) => a + (y - m) ** 2, 0);
    df += g.length - 1;
  }
  const sd = df > 0 ? Math.sqrt(ss / df) : 0;
  return Math.max(sd, floor);
}

function effect(value: number, se: number, n: number): Effect {
  return {
    value: round(clamp(value, -5, 5)),
    se: round(clamp(se, 0, 5)),
    n: Math.round(clamp(n, 0, 100)),
  };
}

/** A two-group difference of means with a pooled-SD standard error, or null if a side is empty. */
function difference(
  a: readonly number[],
  b: readonly number[],
  cells: ReadonlyArray<readonly number[]>,
  floor: number,
): Effect | null {
  if (a.length === 0 || b.length === 0) return null;
  const sd = pooledSd(cells, floor);
  return effect(
    mean(a) - mean(b),
    sd * Math.sqrt(1 / a.length + 1 / b.length),
    a.length + b.length,
  );
}

interface ScoredSearch {
  trial: SearchTrial;
  y: number;
}

/** Log search time, net of predicted movement time (cal-attention.md 5). */
function searchLogTime(t: SearchTrial): number {
  const rtS = Math.max(0, t.rtMs) / 1000;
  const mtS =
    Math.max(0, Number.isFinite(t.predictedMoveMs) ? t.predictedMoveMs : 0) /
    1000;
  return Math.log(Math.max(rtS - mtS, MIN_SEARCH_S));
}

function validSearch(trials: readonly SearchTrial[]): {
  valid: ScoredSearch[];
  noEvidence: boolean;
} {
  const timely = trials
    .filter(
      (t) =>
        !t.timedOut &&
        Number.isFinite(t.rtMs) &&
        t.rtMs > 0 &&
        t.rtMs <= SEARCH_TIMEOUT_MS,
    )
    .map((trial) => ({ trial, y: searchLogTime(trial) }));
  const med = middle(timely.map((s) => s.y));
  const mad = Math.max(
    middle(timely.map((s) => Math.abs(s.y - med))),
    MAD_FLOOR,
  );
  const valid = timely.filter((s) => Math.abs(s.y - med) <= OUTLIER_MADS * mad);
  const invalid = trials.length - valid.length;
  return {
    valid,
    noEvidence:
      trials.length === 0 || invalid / trials.length > MAX_INVALID_SHARE,
  };
}

type MotionLevel = 'still' | 'moving';
const motionLevel = (t: SearchTrial): MotionLevel =>
  t.motion === 'still' ? 'still' : 'moving';

/**
 * Balanced main effect: the difference is averaged over the levels of the
 * other factor that appear on both sides, so an unbalanced session does not
 * confound clutter with motion. Falls back to the plain difference.
 */
function mainEffect(
  valid: readonly ScoredSearch[],
  side: (s: ScoredSearch) => 'hi' | 'lo',
  other: (s: ScoredSearch) => string,
): Effect | null {
  const cells = new Map<string, number[]>();
  for (const s of valid) {
    const key = `${side(s)}|${other(s)}`;
    const cell = cells.get(key) ?? [];
    cell.push(s.y);
    cells.set(key, cell);
  }
  const hi = valid.filter((s) => side(s) === 'hi').map((s) => s.y);
  const lo = valid.filter((s) => side(s) === 'lo').map((s) => s.y);
  if (hi.length === 0 || lo.length === 0) return null;
  const sd = pooledSd([...cells.values()], SEARCH_SD_FLOOR);
  const levels = [...new Set(valid.map(other))];
  const diffs = levels.flatMap((lvl) => {
    const h = cells.get(`hi|${lvl}`);
    const l = cells.get(`lo|${lvl}`);
    return h && l && h.length > 0 && l.length > 0 ? [mean(h) - mean(l)] : [];
  });
  const value = diffs.length > 0 ? mean(diffs) : mean(hi) - mean(lo);
  return effect(
    value,
    sd * Math.sqrt(1 / hi.length + 1 / lo.length),
    hi.length + lo.length,
  );
}

function guidanceEffect(trials: readonly NextActionTrial[]): Effect | null {
  const y = (t: NextActionTrial) =>
    Math.log(Math.max(Math.max(0, t.rtMs) / 1000, MIN_SEARCH_S));
  const valid = trials.filter((t) => Number.isFinite(t.rtMs) && t.rtMs > 0);
  const weak = valid.filter((t) => t.hierarchy === 'weak').map(y);
  const strong = valid.filter((t) => t.hierarchy === 'strong').map(y);
  return difference(weak, strong, [weak, strong], SEARCH_SD_FLOOR);
}

function chunkingEffect(trials: readonly FindTextTrial[]): Effect | null {
  const y = (t: FindTextTrial) =>
    Math.log(Math.max(Math.max(0, t.rtMs) / 1000, MIN_SEARCH_S));
  const valid = trials.filter(
    (t) => t.correct && Number.isFinite(t.rtMs) && t.rtMs > 0,
  );
  const dense = valid.filter((t) => t.format === 'dense').map(y);
  const chunked = valid.filter((t) => t.format === 'chunked').map(y);
  return difference(dense, chunked, [dense, chunked], READING_SD_FLOOR);
}

function preference(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(clamp(value, -2, 2));
}

/** Reduce a focus session to its persisted summary (cal-attention.md 5). */
export function summarizeFocus(session: FocusSession): AttentionSummary {
  const { valid, noEvidence } = validSearch(session.search);
  const clutter = noEvidence
    ? null
    : mainEffect(
        valid,
        (s) => (s.trial.clutter === 'busy' ? 'hi' : 'lo'),
        (s) => motionLevel(s.trial),
      );
  const motion = noEvidence
    ? null
    : mainEffect(
        valid,
        (s) => (motionLevel(s.trial) === 'moving' ? 'hi' : 'lo'),
        (s) => s.trial.clutter,
      );

  const weak = session.nextAction.filter((t) => t.hierarchy === 'weak');
  const decoyCapture =
    weak.length === 0
      ? null
      : round(
          weak.filter((t) => t.firstClick === 'decoy').length / weak.length,
        );

  const chipSet = new Set(session.chips);
  if (chipSet.size > 1) chipSet.delete('nothing');
  const chips = [...chipSet].slice(0, 5);

  const preferences = {
    still: preference(session.preferences.still),
    clean: preference(session.preferences.clean),
    chunked: preference(session.preferences.chunked),
    hierarchy: preference(session.preferences.hierarchy),
  };

  const anyData =
    session.search.length > 0 ||
    session.nextAction.length > 0 ||
    session.findText.length > 0 ||
    session.stopMotionPressed ||
    chips.length > 0 ||
    Object.values(preferences).some((p) => p !== null);

  return {
    status: anyData ? 'measured' : 'skipped',
    motionShown: session.motionShown,
    stopMotionPressed: session.stopMotionPressed,
    effects: {
      clutter,
      motion,
      guidance: guidanceEffect(session.nextAction),
      chunking: chunkingEffect(session.findText),
    },
    decoyCapture,
    preferences,
    chips,
    durationSec: round(clamp(session.durationSec, 0, 3600), 1),
  };
}
