import {
  RING_MIN_DIAMETER,
  RING_TARGET_COUNT,
  ringDiameter,
  ringPositions,
  type Point,
  type RingInput,
} from '@webable/core';

import type { FieldTarget } from './TargetField';

/**
 * Stage geometry for the pointing tasks (cal-motor §5.2). One amplitude: an
 * ISO 9241-411 ring of 9 targets sized from the viewport, or a 1-D reciprocal
 * pair when the ring would be smaller than 120 px.
 */

/** Space kept clear inside the stage edge, CSS px. */
export const FIELD_PAD = 24;
/** Largest target the ladder can show (pointer 72, touch 96). */
export function largestTarget(input: RingInput): number {
  return input === 'touch' ? 96 : 72;
}

export interface FieldLayout {
  mode: 'ring' | 'pair';
  /** Ring diameter, or the pair's centre-to-centre distance. */
  diameter: number;
  widthPx: number;
  heightPx: number;
  center: Point;
}

const PAIR_HEIGHT_EXTRA = 96;

export function fieldLayout(
  stageWidthPx: number,
  viewport: { width: number; height: number },
  input: RingInput,
): FieldLayout {
  const largest = largestTarget(input);
  const room = Math.max(0, Math.floor(stageWidthPx - largest - 2 * FIELD_PAD));
  const preferred = ringDiameter(viewport.width, viewport.height, input);
  const diameter = Math.min(preferred, room);
  if (diameter < RING_MIN_DIAMETER) {
    const distance = Math.max(0, Math.min(room, 280));
    const heightPx = largest + 2 * FIELD_PAD + PAIR_HEIGHT_EXTRA;
    return {
      mode: 'pair',
      diameter: distance,
      widthPx: stageWidthPx,
      heightPx,
      center: { x: stageWidthPx / 2, y: heightPx / 2 },
    };
  }
  const heightPx = diameter + largest + 2 * FIELD_PAD;
  return {
    mode: 'ring',
    diameter,
    widthPx: stageWidthPx,
    heightPx,
    center: { x: stageWidthPx / 2, y: heightPx / 2 },
  };
}

function positions(layout: FieldLayout, count: number): Point[] {
  if (layout.mode === 'pair') {
    const half = layout.diameter / 2;
    return Array.from({ length: count }, (_v, i) => ({
      x: layout.center.x + (i % 2 === 0 ? -half : half),
      y: layout.center.y,
    }));
  }
  const ring = ringPositions(RING_TARGET_COUNT, layout.diameter);
  return Array.from({ length: count }, (_v, i) => {
    const p = ring[i % ring.length] ?? { x: 0, y: 0 };
    return { x: layout.center.x + p.x, y: layout.center.y + p.y };
  });
}

/** One ring block: 1 unscored positioning press, then 9 scored presses. */
export function ringBlockTargets(
  layout: FieldLayout,
  sizePx: number,
): FieldTarget[] {
  return positions(layout, RING_TARGET_COUNT + 1).map((center, i) => ({
    center,
    sizePx,
    scored: i > 0,
  }));
}

/** The return block (cal-motor S5): 1 positioning press and 5 scored presses. */
export function returnBlockTargets(
  layout: FieldLayout,
  sizePx: number,
): FieldTarget[] {
  return positions(layout, 6).map((center, i) => ({
    center,
    sizePx,
    scored: i > 0,
  }));
}

/** Warm-up (cal-motor S1): three targets in a row, unscored. */
export function warmupTargets(
  widthPx: number,
  heightPx: number,
  sizePx: number,
): FieldTarget[] {
  const y = heightPx / 2;
  const inset = Math.max(FIELD_PAD + sizePx / 2, widthPx * 0.2);
  return [inset, widthPx / 2, widthPx - inset].map((x) => ({
    center: { x, y },
    sizePx,
    scored: false,
  }));
}
