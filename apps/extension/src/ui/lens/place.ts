// Owner: L. Collision-free chip placement for the Jev Lens. Pure: the caller reads every rect first, then this
// decides, then the caller writes. No DOM here.
//
//  1. Skip elements off screen or under 4 px. Same-class pairs that overlap (IoU >= 0.6) share one chip (×2).
//  2. Covered elements (probed by the caller) get no chip.
//  3. Same-class chips whose elements sit within 48 px of each other merge into one chip.
//  4. Budget: the highest priorities (weight × 10 + p) get chips; the rest are counted as "+N in list".
//  5. Greedy, by priority, on a 64 px collision grid. Header, sheet, pill and the main action's own box are
//     reserved first. Slots: previous, above-left, above-right, below-left, inside (big non-field boxes only),
//     left, right, then ±24 px slides along the top edge. Chips never overlap. The main chip evicts the lowest
//     priority chip it collides with; any other chip without a slot goes to the list. A leader line is drawn when a
//     chip ends up more than 12 px from its element.

export interface Rect { x: number; y: number; w: number; h: number }

export interface PlaceItem {
  id: string;
  /** Display class; only equal classes merge. 'main' and 'rule' never merge. */
  cls: string;
  box: Rect;
  priority: number;
  /** Form fields: never put a chip inside them. */
  field?: boolean;
  /** Hovered row or pinned card: always gets a chip, first. */
  forced?: boolean;
}

export interface ChipPlan {
  /** Stable key for the chip: its first member's id. */
  key: string;
  cls: string;
  ids: string[];
  /** Union of the members' boxes. */
  anchor: Rect;
  x: number;
  y: number;
  w: number;
  h: number;
  priority: number;
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
}

export interface PlaceOptions {
  vw: number;
  vh: number;
  reserved: Rect[];
  budget: number;
  /** Previous slot per chip key, relative to its anchor's top-left. */
  prev: Map<string, { dx: number; dy: number }>;
  /** Chip size for a cluster of members (the caller knows the text and font). */
  size: (cls: string, ids: string[]) => { w: number; h: number };
  /** Same-class merge distance (px). */
  mergePx?: number;
  gap?: number;
}

export interface PlaceResult {
  chips: ChipPlan[];
  /** Ids that have no chip because of the budget or no free slot ("+N in list"). */
  listed: string[];
  /** Ids skipped as off screen or too small. */
  offscreen: string[];
}

const EDGE = 4;
const CELL = 64;

export function iou(a: Rect, b: Rect): number {
  const iw = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const ih = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/** Gap between two rects (0 when they touch or overlap). */
export function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.hypot(dx, dy);
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function union(rs: Rect[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rs) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Spatial hash of placed rects on a 64 px grid, so each slot test looks only at nearby chips. */
class Grid {
  private cells = new Map<number, number[]>();
  private readonly rects: Array<{ r: Rect; owner: number }> = [];
  private key(cx: number, cy: number): number {
    return (cx + 1024) * 4096 + (cy + 1024);
  }
  add(r: Rect, owner: number): void {
    const i = this.rects.length;
    this.rects.push({ r, owner });
    for (let cx = Math.floor(r.x / CELL); cx <= Math.floor((r.x + r.w) / CELL); cx++) {
      for (let cy = Math.floor(r.y / CELL); cy <= Math.floor((r.y + r.h) / CELL); cy++) {
        const k = this.key(cx, cy);
        const list = this.cells.get(k);
        if (list) list.push(i);
        else this.cells.set(k, [i]);
      }
    }
  }
  /** Owners of live rects that overlap r (owner -1 = reserved). */
  hits(r: Rect, dead: Set<number>): Set<number> {
    const out = new Set<number>();
    for (let cx = Math.floor(r.x / CELL); cx <= Math.floor((r.x + r.w) / CELL); cx++) {
      for (let cy = Math.floor(r.y / CELL); cy <= Math.floor((r.y + r.h) / CELL); cy++) {
        for (const i of this.cells.get(this.key(cx, cy)) ?? []) {
          const e = this.rects[i]!;
          if (dead.has(e.owner)) continue;
          if (overlaps(r, e.r)) out.add(e.owner);
        }
      }
    }
    return out;
  }
}

class DSU {
  private p: number[];
  constructor(k: number) {
    this.p = Array.from({ length: k }, (_, i) => i);
  }
  find(i: number): number {
    while (this.p[i] !== i) {
      this.p[i] = this.p[this.p[i]!]!;
      i = this.p[i]!;
    }
    return i;
  }
  join(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

/**
 * Two same-class elements share a chip when they overlap (IoU >= 0.6), when their chips would land on the same
 * spot (top-left corners within `px`), or when both are small controls within `px` of each other. Big blocks that
 * merely sit near each other keep their own chips, so a merged chip never floats between two distant blocks.
 */
export function shouldMerge(a: Rect, b: Rect, px: number): boolean {
  if (iou(a, b) >= 0.6) return true;
  if (Math.hypot(a.x - b.x, a.y - b.y) <= px) return true;
  const small = (r: Rect) => r.h <= 80 && r.w <= 420;
  return small(a) && small(b) && rectGap(a, b) <= px;
}

export function onScreen(r: Rect, vw: number, vh: number): boolean {
  return r.w >= 4 && r.h >= 4 && r.x + r.w > 0 && r.y + r.h > 0 && r.x < vw && r.y < vh;
}

export function placeChips(items: PlaceItem[], o: PlaceOptions): PlaceResult {
  const gap = o.gap ?? 4;
  const mergePx = o.mergePx ?? 48;
  const offscreen: string[] = [];
  const live: PlaceItem[] = [];
  for (const it of items) {
    if (onScreen(it.box, o.vw, o.vh)) live.push(it);
    else offscreen.push(it.id);
  }

  // 1 + 3: merge same-class neighbours (overlapping pairs, then close ones). Forced, main, the page-region
  // label and the plain-rule chip stay alone.
  const dsu = new DSU(live.length);
  const mergeable = (a: PlaceItem, b: PlaceItem) =>
    a.cls === b.cls && a.cls !== 'main' && a.cls !== 'page' && a.cls !== 'rule' && !a.forced && !b.forced;
  for (let i = 0; i < live.length; i++) {
    for (let k = i + 1; k < live.length; k++) {
      const a = live[i]!;
      const b = live[k]!;
      if (!mergeable(a, b)) continue;
      if (shouldMerge(a.box, b.box, mergePx)) dsu.join(i, k);
    }
  }
  const groups = new Map<number, PlaceItem[]>();
  for (let i = 0; i < live.length; i++) {
    const r = dsu.find(i);
    const g = groups.get(r);
    if (g) g.push(live[i]!);
    else groups.set(r, [live[i]!]);
  }
  interface Cluster { key: string; cls: string; members: PlaceItem[]; anchor: Rect; priority: number; forced: boolean; field: boolean }
  const clusters: Cluster[] = [];
  for (const members of groups.values()) {
    members.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    const forced = members.some((m) => m.forced);
    const priority = Math.max(...members.map((m) => m.priority)) + (forced ? 1000 : 0);
    clusters.push({
      key: members[0]!.id,
      cls: members[0]!.cls,
      members,
      anchor: union(members.map((m) => m.box)),
      priority,
      forced,
      field: members.some((m) => m.field),
    });
  }
  clusters.sort((a, b) => b.priority - a.priority || a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x);

  // 4: budget (forced chips never count against it).
  const listed: string[] = [];
  const chosen: Cluster[] = [];
  let used = 0;
  for (const c of clusters) {
    if (c.forced || used < o.budget) {
      chosen.push(c);
      if (!c.forced) used++;
    } else listed.push(...c.members.map((m) => m.id));
  }

  // 5: greedy placement.
  const grid = new Grid();
  for (const r of o.reserved) grid.add(r, -1);
  const dead = new Set<number>();
  const placed = new Map<number, ChipPlan>();
  const clampX = (x: number, w: number) => Math.max(EDGE, Math.min(o.vw - w - EDGE, x));
  const clampY = (y: number, h: number) => Math.max(EDGE, Math.min(o.vh - h - EDGE, y));

  chosen.forEach((c, idx) => {
    const ids = c.members.map((m) => m.id);
    const { w, h } = o.size(c.cls, ids);
    const A = c.anchor;
    const cands: Array<[number, number]> = [];
    const prev = o.prev.get(c.key);
    if (prev) cands.push([A.x + prev.dx, A.y + prev.dy]);
    cands.push([A.x, A.y - h - gap]); // above-left
    cands.push([A.x + A.w - w, A.y - h - gap]); // above-right
    cands.push([A.x, A.y + A.h + gap]); // below-left
    // Inside only when every member is itself a big block: a chip never sits on a small control's own text.
    const big = !c.field && c.members.every((m) => m.box.w >= w + 2 * gap && m.box.h >= h * 3);
    if (big) cands.push([A.x + gap, A.y + gap]); // inside, top-left
    cands.push([A.x - w - gap, A.y]); // left
    cands.push([A.x + A.w + gap, A.y]); // right
    for (const k of [1, -1, 2, -2, 3, -3, 4, -4]) cands.push([A.x + 24 * k, A.y - h - gap]); // slides along the top
    if (big) cands.push([A.x + A.w - w - gap, A.y + gap]); // inside, top-right

    let slot: Rect | null = null;
    let evict: Set<number> | null = null;
    let fallback: { r: Rect; hits: Set<number> } | null = null;
    for (const [cx, cy] of cands) {
      const r: Rect = { x: clampX(cx, w), y: clampY(cy, h), w, h };
      const hits = grid.hits(r, dead);
      if (hits.size === 0) {
        slot = r;
        break;
      }
      // The main chip and the "what this page is for" label may evict chips (never reserved areas).
      if ((c.cls === 'main' || c.cls === 'page') && !hits.has(-1) && !fallback) fallback = { r, hits };
    }
    if (!slot && (c.cls === 'main' || c.cls === 'page')) {
      if (fallback) {
        slot = fallback.r;
        evict = fallback.hits;
      } else {
        // Every slot touches our own chrome: take the first one anyway; the main action always has a chip.
        const [cx, cy] = cands[0]!;
        slot = { x: clampX(cx, w), y: clampY(cy, h), w, h };
      }
    }
    if (!slot && c.forced) {
      const [cx, cy] = cands[0]!;
      slot = { x: clampX(cx, w), y: clampY(cy, h), w, h };
    }
    if (!slot) {
      listed.push(...ids);
      return;
    }
    if (evict) {
      for (const owner of evict) {
        const victim = placed.get(owner);
        if (!victim) continue;
        dead.add(owner);
        placed.delete(owner);
        listed.push(...victim.ids);
      }
    }
    grid.add({ x: slot.x - 1, y: slot.y - 1, w: slot.w + 2, h: slot.h + 2 }, idx);
    placed.set(idx, {
      key: c.key,
      cls: c.cls,
      ids,
      anchor: A,
      x: slot.x,
      y: slot.y,
      w,
      h,
      priority: c.priority,
      leader: leaderFor(slot, A),
    });
  });

  return { chips: [...placed.values()], listed, offscreen };
}

/** A 1 px line from the chip to its element when they are more than 12 px apart. */
export function leaderFor(chip: Rect, el: Rect): ChipPlan['leader'] {
  const near = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  // Closest points between the two rects.
  const ex = near(chip.x + chip.w / 2, el.x, el.x + el.w);
  const ey = near(chip.y + chip.h / 2, el.y, el.y + el.h);
  const cx = near(ex, chip.x, chip.x + chip.w);
  const cy = near(ey, chip.y, chip.y + chip.h);
  if (Math.hypot(ex - cx, ey - cy) <= 12) return null;
  return { x1: cx, y1: cy, x2: ex, y2: ey };
}

/** Chip budget for a viewport: clamp(area / 80 000, 6, 14), in physical pixels (12 at 1280 × 720). */
export function chipBudget(physW: number, physH: number): number {
  return Math.max(6, Math.min(14, Math.round((physW * physH) / 80_000)));
}

/**
 * Splits the viewport into cells along every box edge; each cell takes the kind of the smallest box covering it
 * (a folded ad inside a kept column stays folded, a help link inside a folded block stays kept). Returns, per kind,
 * disjoint rectangles (row runs merged straight down), so an evenodd path built from them never refills an overlap.
 */
export function cellRegions(vw: number, vh: number, boxes: Array<{ r: Rect; kind: string }>): Map<string, Rect[]> {
  const out = new Map<string, Rect[]>();
  const clipped: Array<{ x0: number; y0: number; x1: number; y1: number; kind: string; area: number }> = [];
  for (const b of boxes) {
    const x0 = Math.max(0, b.r.x);
    const y0 = Math.max(0, b.r.y);
    const x1 = Math.min(vw, b.r.x + b.r.w);
    const y1 = Math.min(vh, b.r.y + b.r.h);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    clipped.push({ x0, y0, x1, y1, kind: b.kind, area: b.r.w * b.r.h });
  }
  if (!clipped.length) return out;
  clipped.sort((a, b) => a.area - b.area);
  const xs = [...new Set(clipped.flatMap((c) => [c.x0, c.x1]))].sort((a, b) => a - b);
  const ys = [...new Set(clipped.flatMap((c) => [c.y0, c.y1]))].sort((a, b) => a - b);
  const runs: Array<{ kind: string; x0: number; x1: number; y0: number; y1: number }> = [];
  for (let yi = 0; yi < ys.length - 1; yi++) {
    const y0 = ys[yi]!;
    const y1 = ys[yi + 1]!;
    const cy = (y0 + y1) / 2;
    let run: { kind: string; x0: number } | null = null;
    for (let xi = 0; xi < xs.length - 1; xi++) {
      const x0 = xs[xi]!;
      const cx = (x0 + xs[xi + 1]!) / 2;
      let kind: string | null = null;
      for (const c of clipped) {
        if (cx > c.x0 && cx < c.x1 && cy > c.y0 && cy < c.y1) {
          kind = c.kind;
          break;
        }
      }
      if (run && run.kind !== kind) {
        runs.push({ kind: run.kind, x0: run.x0, x1: x0, y0, y1 });
        run = null;
      }
      if (kind !== null && !run) run = { kind, x0 };
    }
    if (run) runs.push({ kind: run.kind, x0: run.x0, x1: xs[xs.length - 1]!, y0, y1 });
  }
  const open = new Map<string, { kind: string; x0: number; x1: number; y0: number; y1: number }>();
  const done: Array<{ kind: string; x0: number; x1: number; y0: number; y1: number }> = [];
  for (const r of runs) {
    const k = `${r.kind}|${r.x0}|${r.x1}`;
    const o = open.get(k);
    if (o && Math.abs(o.y1 - r.y0) < 0.01) o.y1 = r.y1;
    else {
      if (o) done.push(o);
      open.set(k, { ...r });
    }
  }
  done.push(...open.values());
  for (const h of done) {
    const list = out.get(h.kind) ?? [];
    list.push({ x: h.x0, y: h.y0, w: h.x1 - h.x0, h: h.y1 - h.y0 });
    out.set(h.kind, list);
  }
  return out;
}

/** Subpaths for a list of disjoint rectangles. */
export function rectsPath(rs: Rect[]): string {
  let d = '';
  for (const h of rs) d += `M${r1(h.x)} ${r1(h.y)}H${r1(h.x + h.w)}V${r1(h.y + h.h)}H${r1(h.x)}Z`;
  return d;
}

/**
 * The scrim: one evenodd path, the viewport minus disjoint holes over every lit box. Each spot on screen takes the
 * decision of the smallest element covering it.
 */
export function scrimPath(vw: number, vh: number, boxes: Array<{ r: Rect; lit: boolean }>): string {
  const outer = `M0 0H${r1(vw)}V${r1(vh)}H0Z`;
  const regions = cellRegions(vw, vh, boxes.map((b) => ({ r: b.r, kind: b.lit ? 'lit' : 'dim' })));
  return outer + rectsPath(regions.get('lit') ?? []);
}

const r1 = (v: number): string => String(Math.round(v * 10) / 10);
