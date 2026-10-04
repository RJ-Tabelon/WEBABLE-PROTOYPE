/** Plain rectangle, so geometry stays testable without a layout engine. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const boxOf = (r: {
  left: number;
  top: number;
  right: number;
  bottom: number;
}): Box => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

export const width = (b: Box): number => Math.max(0, b.right - b.left);
export const height = (b: Box): number => Math.max(0, b.bottom - b.top);
export const area = (b: Box): number => width(b) * height(b);

export function intersection(a: Box, b: Box): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

export function inflate(b: Box, dx: number, dy: number): Box {
  return {
    left: b.left - dx,
    top: b.top - dy,
    right: b.right + dx,
    bottom: b.bottom + dy,
  };
}

export function translate(b: Box, dx: number, dy: number): Box {
  return {
    left: b.left + dx,
    top: b.top + dy,
    right: b.right + dx,
    bottom: b.bottom + dy,
  };
}

/** Distance from a point to the nearest point of a rectangle (0 inside). */
export function distPointBox(x: number, y: number, b: Box): number {
  const cx = Math.max(b.left, Math.min(x, b.right));
  const cy = Math.max(b.top, Math.min(y, b.bottom));
  return Math.hypot(x - cx, y - cy);
}

/** Horizontal and vertical gaps between two boxes (0 when they overlap on that axis). */
export function gaps(a: Box, b: Box): { dx: number; dy: number } {
  const dx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
  const dy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
  return { dx, dy };
}

export interface TargetBox {
  id: number;
  box: Box;
}

/**
 * Uniform-grid neighbour index for target boxes. Cells are `cell` px square;
 * a box is registered in every cell it touches.
 */
export class BoxGrid<T extends TargetBox> {
  private readonly cells = new Map<number, T[]>();

  constructor(
    items: readonly T[],
    private readonly cell: number,
  ) {
    for (const t of items) {
      this.forCells(t.box, (key) => {
        const list = this.cells.get(key);
        if (list) list.push(t);
        else this.cells.set(key, [t]);
      });
    }
  }

  private key(gx: number, gy: number): number {
    return gx * 100_003 + gy;
  }

  private forCells(b: Box, fn: (key: number) => void): void {
    const x0 = Math.floor(b.left / this.cell);
    const x1 = Math.floor(b.right / this.cell);
    const y0 = Math.floor(b.top / this.cell);
    const y1 = Math.floor(b.bottom / this.cell);
    // Guard against pathological boxes (whole-page overlays).
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return;
    for (let gx = x0; gx <= x1; gx++)
      for (let gy = y0; gy <= y1; gy++) fn(this.key(gx, gy));
  }

  /** Items whose boxes touch the cells overlapping `b` (deduplicated). */
  near(b: Box): T[] {
    const seen = new Set<number>();
    const out: T[] = [];
    this.forCells(b, (key) => {
      for (const t of this.cells.get(key) ?? []) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        out.push(t);
      }
    });
    return out;
  }
}

export interface SpacingTarget extends TargetBox {
  /** True when either side is below the tested size. */
  small: boolean;
  /** Returns true when this target contains or is contained by the other. */
  nested?: (other: SpacingTarget) => boolean;
}

/**
 * WCAG 2.5.8 spacing test (axe-core get-offset algorithm), parameterised by
 * the circle diameter `px`. An undersized target fails when a `px` circle
 * centred on it intersects another target, or the circle of another
 * undersized target. Returns the worst clearance per failing target id.
 */
export function spacingFailures(
  targets: readonly SpacingTarget[],
  px: number,
): Map<number, number> {
  const rad = px / 2;
  const grid = new BoxGrid(targets, Math.max(2 * px, 64));
  const fails = new Map<number, number>();
  for (const a of targets) {
    if (!a.small) continue;
    const cx = (a.box.left + a.box.right) / 2;
    const cy = (a.box.top + a.box.bottom) / 2;
    let worst = Infinity;
    for (const b of grid.near({
      left: cx - px,
      top: cy - px,
      right: cx + px,
      bottom: cy + px,
    })) {
      if (b.id === a.id) continue;
      if (a.nested?.(b) || b.nested?.(a)) continue;
      const toRect = distPointBox(cx, cy, b.box);
      const bcx = (b.box.left + b.box.right) / 2;
      const bcy = (b.box.top + b.box.bottom) / 2;
      const toCircle = b.small
        ? Math.hypot(cx - bcx, cy - bcy) - rad
        : Infinity;
      worst = Math.min(worst, toRect, toCircle);
    }
    if (worst < rad) fails.set(a.id, worst);
  }
  return fails;
}

/** Nearest gap (edge to edge) from `a` to any other box nearby, per axis. */
export function nearestGaps<T extends TargetBox>(
  a: T,
  grid: BoxGrid<T>,
  reach: number,
  skip?: (other: T) => boolean,
): { x: number; y: number } {
  let gx = Infinity;
  let gy = Infinity;
  for (const b of grid.near(inflate(a.box, reach, reach))) {
    if (b.id === a.id || skip?.(b)) continue;
    const { dx, dy } = gaps(a.box, b.box);
    // Neighbour beside (overlapping vertically) constrains horizontal growth, and vice versa.
    if (dy === 0 && dx >= 0) gx = Math.min(gx, dx);
    if (dx === 0 && dy >= 0) gy = Math.min(gy, dy);
    if (dx > 0 && dy > 0) {
      // Diagonal neighbour: the growth square must stay clear of it.
      const d = Math.max(dx, dy);
      gx = Math.min(gx, d);
      gy = Math.min(gy, d);
    }
  }
  return { x: gx, y: gy };
}
