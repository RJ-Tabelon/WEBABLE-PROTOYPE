/**
 * Size order per region (docs/10 §5.2, B6 of the 2026-10-15 eval).
 *
 * text_floor grows template fields by one curve, but a field can only grow
 * as far as every text it shares a region with allows: a reader compares
 * sizes across the whole region, not only inside one record or section.
 * Each grown field is a unit with one scale r (every instance and every
 * inline text that inherits from it scale together); every text that keeps
 * its size is a fixed point. For any two points in a group, natively more
 * than SIZE_EPS apart, the smaller must stay at or below the larger:
 *
 *   below a grown point q:  s r <= s_q r_q
 *   below a fixed point q:  s r <= s_q                in a region (a tie at most)
 *                           s r <= s_q (s / s_q)^c    in a record: the native gap,
 *                                                     compressed, stays visible
 *
 * A control's label is no ceiling for the text beside it (verify/checks.ts
 * controlCeiling): a glyph ("+", an icon) caps nothing, and other control
 * text caps no running text. Both are still capped themselves.
 *
 * Units only ever shrink, so the fixed point exists (r = 1 everywhere) and a
 * few passes reach it. A unit that would grow by less than `minGrowth` is
 * held (r = 1) and becomes a fixed point itself; units in one consistency
 * group share the smallest r, and are all held when one is.
 */

/**
 * Native sizes closer than this are no rank to keep (the verifier's and the
 * eval's tolerance: sizes 0.5 px or more apart rank).
 */
export const SIZE_EPS = 0.5;
/** Float slack on the tolerance, so sizes exactly SIZE_EPS apart rank. */
const SLACK = 1e-6;

export interface RankPoint {
  /** Native size, CSS px. */
  s: number;
  /** Index of the unit it scales with, or null for a fixed point. */
  unit: number | null;
  /**
   * A heading: in a group that lifts headings, at one native size it ranks
   * above other text (a description never outgrows its heading, GitHub's
   * "About").
   */
  heading?: boolean;
  /**
   * A control's label (verify/checks.ts controlCeiling): 'glyph' caps no
   * point, 'label' caps no running point. Never set on a heading.
   */
  control?: 'glyph' | 'label';
  /** Running text (a unit): a control's 'label' natively larger never caps it. */
  running?: boolean;
}

export interface RankGroup {
  points: readonly RankPoint[];
  /** A record (a row, a card): keep the gap under a fixed point visible. */
  compress?: boolean;
  /**
   * Headings rank above other text of their native size (a record, or a
   * heading with the text it introduces); across a whole region they do
   * not, so one section's heading never holds back another's text.
   */
  lift?: boolean;
}

export interface RankInput {
  /** Points per region and per record (any order). */
  regions: ReadonlyArray<RankGroup>;
  /** Wanted scale per unit (curve and fit caps); read, never written. */
  want: readonly number[];
  /** Units that must end at one scale (one size per template field). */
  groups?: ReadonlyArray<readonly number[]>;
  /** Exponent that compresses the gap under a fixed point (text_floor's cLow). */
  c: number;
  /** Growth below this is held: the unit keeps its size. */
  minGrowth: number;
  /** Units already held by the caller (excluded or dropped classes). */
  held?: ReadonlySet<number>;
  /**
   * Native sizes closer than this are tied (no rank to keep), CSS px.
   * Default SIZE_EPS; at a tab zoom z (own zoom x page scale) the reader's
   * half pixel is SIZE_EPS / z.
   */
  eps?: number;
  /**
   * [inner, host]: an inline unit inside another's instances (a link in a
   * paragraph) never scales past its host, and is held when the host is.
   */
  under?: ReadonlyArray<readonly [number, number]>;
}

export interface RankResult {
  /** Final scale per unit (1 when held). */
  r: number[];
  held: boolean[];
  passes: number;
}

interface Sorted {
  /** Native size (what a scale multiplies). */
  s: Float64Array;
  /** Rank: the native size, a heading lifted just past text of its size. */
  k: Float64Array;
  unit: Int32Array;
  /** As a ceiling: 0 caps every point, 1 (a control's label) no running point, 2 (a glyph) none. */
  cap: Int8Array;
  running: Uint8Array;
  compress: boolean;
}

const CAP = { all: 0, label: 1, glyph: 2 } as const;

/** Whether a point with ceiling kind `cap` bounds a point that is running or not. */
const bounds = (cap: number, running: boolean): boolean =>
  cap === CAP.all || (cap === CAP.label && !running);

function sortRegion(group: RankGroup, eps: number): Sorted {
  const points = group.points;
  const lift = group.lift === true ? 2 * eps : 0;
  const rank = (p: RankPoint): number => p.s + (p.heading ? lift : 0);
  const order = points
    .map((p, i) => i)
    .sort(
      (a, b) => rank(points[a] as RankPoint) - rank(points[b] as RankPoint),
    );
  const s = new Float64Array(order.length);
  const k = new Float64Array(order.length);
  const unit = new Int32Array(order.length);
  const cap = new Int8Array(order.length);
  const running = new Uint8Array(order.length);
  order.forEach((i, j) => {
    const p = points[i] as RankPoint;
    s[j] = p.s;
    k[j] = rank(p);
    unit[j] = p.unit ?? -1;
    cap[j] = p.control ? CAP[p.control] : CAP.all;
    running[j] = p.running ? 1 : 0;
  });
  return { s, k, unit, cap, running, compress: group.compress === true };
}

/** Passes before the solver gives up and holds what still conflicts. */
const MAX_PASSES = 60;

export function solveRanks(input: RankInput): RankResult {
  const n = input.want.length;
  const r = input.want.map((w) => (Number.isFinite(w) && w > 1 ? w : 1));
  const held = r.map((x, u) => x < 1 + input.minGrowth || !!input.held?.has(u));
  for (let u = 0; u < n; u++) if (held[u]) r[u] = 1;
  const eps = input.eps ?? SIZE_EPS;
  const regions = input.regions.map((g) => sortRegion(g, eps));
  // First index ranked above each point by eps or more, per region.
  const above = regions.map((reg) => {
    const out = new Int32Array(reg.k.length);
    let j = 0;
    for (let i = 0; i < reg.k.length; i++) {
      const lim = (reg.k[i] as number) + eps - SLACK;
      if (j < i) j = i;
      while (j < reg.k.length && (reg.k[j] as number) < lim) j++;
      out[i] = j;
    }
    return out;
  });
  const groups = input.groups ?? [];
  let passes = 0;
  for (; passes < MAX_PASSES; passes++) {
    let changed = false;
    regions.forEach((reg, k) => {
      const m = reg.s.length;
      const next = above[k] as Int32Array;
      // The lowest grown point and the smallest fixed point at or above each
      // index (the smallest fixed point is the tightest: s_q^(1-c) grows with
      // s_q), among the points that cap running text and among those that
      // cap the rest (control labels too).
      const grown = [new Float64Array(m + 1), new Float64Array(m + 1)];
      const fixed = [new Float64Array(m + 1), new Float64Array(m + 1)];
      for (const a of [...grown, ...fixed]) a[m] = Infinity;
      for (let j = m - 1; j >= 0; j--) {
        const u = reg.unit[j] as number;
        const q = reg.s[j] as number;
        const isFixed = u < 0 || (held[u] as boolean);
        for (let run = 0; run < 2; run++) {
          const g = grown[run] as Float64Array;
          const f = fixed[run] as Float64Array;
          const caps = bounds(reg.cap[j] as number, run === 1);
          g[j] = Math.min(
            g[j + 1] as number,
            !caps || isFixed ? Infinity : q * (r[u] as number),
          );
          f[j] = Math.min(f[j + 1] as number, caps && isFixed ? q : Infinity);
        }
      }
      for (let i = 0; i < m; i++) {
        const u = reg.unit[i] as number;
        if (u < 0 || held[u]) continue;
        const s = reg.s[i] as number;
        const j = next[i] as number;
        const run = reg.running[i] as number;
        const f = (fixed[run] as Float64Array)[j] as number;
        const under =
          f === Infinity
            ? Infinity
            : reg.compress
              ? f ** (1 - input.c) * s ** input.c
              : f;
        const lim =
          Math.min((grown[run] as Float64Array)[j] as number, under) / s;
        if ((r[u] as number) > lim + 1e-9) {
          r[u] = Math.max(1, lim);
          changed = true;
        }
      }
    });
    for (const [u, h] of input.under ?? []) {
      if (held[u]) continue;
      if (held[h]) {
        held[u] = true;
        r[u] = 1;
        changed = true;
      } else if ((r[u] as number) > (r[h] as number) + 1e-9) {
        r[u] = r[h] as number;
        changed = true;
      }
    }
    for (const g of groups) {
      if (g.length < 2) continue;
      const anyHeld = g.some((u) => held[u]);
      const min = Math.min(...g.map((u) => r[u] as number));
      for (const u of g) {
        if (anyHeld && !held[u]) {
          held[u] = true;
          r[u] = 1;
          changed = true;
        } else if ((r[u] as number) > min + 1e-9) {
          r[u] = min;
          changed = true;
        }
      }
    }
    for (let u = 0; u < n; u++)
      if (!held[u] && (r[u] as number) < 1 + input.minGrowth) {
        held[u] = true;
        r[u] = 1;
        changed = true;
      }
    if (!changed) return { r, held, passes: passes + 1 };
  }
  // Not settled (a long chain of shrinking units): hold every unit that
  // still sits above a point natively larger than it, then nothing is left
  // to conflict but held units, which never invert.
  regions.forEach((reg, k) => {
    const next = above[k] as Int32Array;
    for (let i = 0; i < reg.s.length; i++) {
      const u = reg.unit[i] as number;
      if (u < 0 || held[u]) continue;
      const after = (reg.s[i] as number) * (r[u] as number);
      const run = reg.running[i] === 1;
      for (let j = next[i] as number; j < reg.s.length; j++) {
        if (!bounds(reg.cap[j] as number, run)) continue;
        const v = reg.unit[j] as number;
        const q = reg.s[j] as number;
        const cap = v < 0 || held[v] ? q : q * (r[v] as number);
        if (after > cap + 1e-9) {
          held[u] = true;
          r[u] = 1;
          break;
        }
      }
    }
  });
  return { r, held, passes };
}

/**
 * For a unit added later (content that arrived after the batch): the scale
 * range that keeps its region's order with the points already settled.
 * `lo` is what natively smaller points already reach; `hi` what larger ones
 * allow (a tie at most), control labels as in solveRanks (a glyph neither
 * caps nor lifts anything). The caller takes min(want, hi), raised to lo
 * when lo <= hi.
 */
export function rankRange(
  s: number,
  points: ReadonlyArray<{
    s: number;
    after: number;
    fixed: boolean;
    control?: RankPoint['control'];
  }>,
  eps = SIZE_EPS,
  running = false,
): { lo: number; hi: number } {
  let lo = 1;
  let hi = Infinity;
  for (const p of points) {
    if (p.control === 'glyph') continue;
    if (p.s >= s + eps - SLACK) {
      if (bounds(p.control ? CAP[p.control] : CAP.all, running))
        hi = Math.min(hi, (p.fixed ? p.s : p.after) / s);
    } else if (p.s <= s - eps + SLACK) lo = Math.max(lo, p.after / s);
  }
  return { lo, hi };
}
