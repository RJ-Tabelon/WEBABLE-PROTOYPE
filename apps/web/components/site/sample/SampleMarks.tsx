'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { SiteFitMark } from '../SiteFitMark';
import type { SampleMark } from './model';

export interface SampleMarksProps {
  /** Text size mark: a dimension line on the first body line plus a plate. */
  text?: SampleMark;
  /** Click targets mark: a plate beside the icon row (the ghost-and-fit pair is the line). */
  targets?: SampleMark;
  /** Moving things mark: a plate on a short leader from the countdown. */
  motion?: SampleMark;
  /** The fitted hit-area size, so plates clear the fit outlines around the icons. */
  hitPx: number;
  /** `draw` runs the one-time draw; `static` shows the marks already drawn. */
  mode: 'draw' | 'static';
  /**
   * Called when the plates stop (or start) fitting on the page. When they don't
   * fit (a narrow frame, or a large text scale), no plate is drawn on the page and
   * the caller shows the values beside the picture instead.
   */
  onCompactChange?: (compact: boolean) => void;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Placed {
  left: number;
  top: number;
}

/** A 12 px, 1 px leader from the countdown to its plate: down, or to the left. */
interface Leader {
  left: number;
  top: number;
  orient: 'v' | 'h';
}

interface Geometry {
  /** Nothing fits without covering the page: plates are not drawn. */
  compact: boolean;
  /** Vertical dimension line in the article's left gutter, spanning the first line box. */
  textLine?: { x: number; top: number; height: number };
  text?: Placed;
  targets?: Placed;
  leader?: Leader;
  motion?: Placed;
}

/** Gap between the icons' fit outline (plus its casing) and the plates: --space-3. */
const PLATE_GAP = 12;
/** The closest a plate may come to the fit outline when room is short. */
const MIN_GAP = 6;
/** Plates keep this far from the page's edges. */
const EDGE = 8;
/** The motion leader: 12 px long, 1 px wide. */
const LEADER = 12;
/** Space between the text plate and the first line box below it. */
const TEXT_PLATE_AIR = 2;
/** Clear air required between a plate and any glyph or other plate. */
const AIR = 1;

/**
 * The box of an element's own glyphs (the content area of its direct text, not
 * its line box), clipped to the element, in the origin's coordinates.
 */
function glyphBox(el: Element, origin: DOMRect): Box {
  const own = el.getBoundingClientRect();
  const range = document.createRange();
  let box: Box | null = null;
  for (const node of el.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      const b = {
        left: Math.max(r.left, own.left),
        top: Math.max(r.top, own.top),
        right: Math.min(r.right, own.right),
        bottom: Math.min(r.bottom, own.bottom),
      };
      box = box
        ? {
            left: Math.min(box.left, b.left),
            top: Math.min(box.top, b.top),
            right: Math.max(box.right, b.right),
            bottom: Math.max(box.bottom, b.bottom),
          }
        : b;
    }
  }
  return boxOf(box ?? own, origin);
}

function boxOf(r: DOMRect | Box, origin: DOMRect): Box {
  return {
    left: r.left - origin.left,
    top: r.top - origin.top,
    right: r.right - origin.left,
    bottom: r.bottom - origin.top,
  };
}

function intersect(a: Box, b: Box, air = 0): boolean {
  return (
    a.left < b.right + air &&
    b.left < a.right + air &&
    a.top < b.bottom + air &&
    b.top < a.bottom + air
  );
}

/**
 * Every visible run of text on the sample page, as line fragments clipped by
 * overflow (so carousel slides and countdown digits out of view don't count),
 * plus the icons with their fit outlines. Plates may not touch any of them.
 */
function obstacles(root: HTMLElement, overlay: Element, hitPx: number): Box[] {
  const origin = root.getBoundingClientRect();
  const out: Box[] = [];
  const clipOf = new Map<Element, Box | null>();
  const clipFor = (el: Element | null): Box | null => {
    if (!el || el === root) return null;
    if (clipOf.has(el)) return clipOf.get(el)!;
    const parent = clipFor(el.parentElement);
    let clip = parent;
    if (getComputedStyle(el).overflow !== 'visible') {
      const own = boxOf(el.getBoundingClientRect(), origin);
      clip = parent
        ? {
            left: Math.max(own.left, parent.left),
            top: Math.max(own.top, parent.top),
            right: Math.min(own.right, parent.right),
            bottom: Math.min(own.bottom, parent.bottom),
          }
        : own;
    }
    clipOf.set(el, clip);
    return clip;
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (overlay.contains(node) || !node.textContent?.trim()) continue;
    const clip = clipFor(node.parentElement);
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      let b = boxOf(r, origin);
      if (clip) {
        b = {
          left: Math.max(b.left, clip.left),
          top: Math.max(b.top, clip.top),
          right: Math.min(b.right, clip.right),
          bottom: Math.min(b.bottom, clip.bottom),
        };
      }
      if (b.right > b.left && b.bottom > b.top) out.push(b);
    }
  }

  for (const icon of root.querySelectorAll('.ws-sample__icon')) {
    const b = boxOf(icon.getBoundingClientRect(), origin);
    // The fit outline is centred on the icon, with a 1 px casing.
    const grow = Math.max(0, (hitPx - (b.right - b.left)) / 2) + 1;
    out.push({
      left: b.left - grow,
      top: b.top - grow,
      right: b.right + grow,
      bottom: b.bottom + grow,
    });
  }
  return out;
}

interface PlateRefs {
  text: RefObject<HTMLSpanElement | null>;
  targets: RefObject<HTMLSpanElement | null>;
  motion: RefObject<HTMLSpanElement | null>;
}

function sizeOf(ref: RefObject<HTMLSpanElement | null>) {
  const el = ref.current;
  return el ? { w: el.offsetWidth, h: el.offsetHeight } : null;
}

const rect = (left: number, top: number, w: number, h: number): Box => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

interface Candidate<T> {
  value: T;
  /** Everything the choice draws: the plate, and its leader if it has one. */
  boxes: Box[];
}

function measure(
  root: HTMLElement,
  overlay: Element,
  plates: PlateRefs,
  props: Pick<SampleMarksProps, 'text' | 'targets' | 'motion' | 'hitPx'>,
): Geometry {
  const origin = root.getBoundingClientRect();
  const width = origin.width;
  const height = origin.height;
  const g: Geometry = { compact: false };
  const placed: Box[] = [];
  let blocked: Box[] | null = null;

  // A spot is free when it stays on the page, clear of the other marks and of
  // every glyph, icon and fit outline.
  const free = (box: Box) => {
    if (
      box.left < EDGE ||
      box.right > width - EDGE ||
      box.top < 0 ||
      box.bottom > height
    )
      return false;
    if (placed.some((other) => intersect(box, other, 2))) return false;
    blocked ??= obstacles(root, overlay, props.hitPx);
    return !blocked.some((b) => intersect(box, b, AIR));
  };
  // The first candidate whose boxes are all free, or null.
  const choose = <T,>(candidates: Candidate<T>[]): T | null => {
    for (const c of candidates) {
      if (c.boxes.every(free)) {
        placed.push(...c.boxes);
        return c.value;
      }
    }
    return null;
  };
  let fits = true;

  // Click targets: beside the icon row, 12 px clear of the fit outlines, pulled
  // left (never into them) when the page is narrow.
  const icons = root.querySelectorAll('[data-anchor="tools"] .ws-sample__icon');
  const lastIcon = icons[icons.length - 1];
  const textSize = props.text ? sizeOf(plates.text) : null;
  const targetsSize = props.targets ? sizeOf(plates.targets) : null;
  let column: number | null = null;
  let outlineTop = 0;
  if (lastIcon) {
    const icon = boxOf(lastIcon.getBoundingClientRect(), origin);
    const centre = (icon.left + icon.right) / 2;
    const hit = Math.max(props.hitPx, icon.right - icon.left);
    const outlineRight = centre + hit / 2 + 1;
    outlineTop = Math.round((icon.top + icon.bottom) / 2 - hit / 2 - 1);
    const widest = Math.max(textSize?.w ?? 0, targetsSize?.w ?? 0);
    column = Math.round(
      Math.min(outlineRight + PLATE_GAP, width - EDGE - widest),
    );
    if (column < outlineRight + MIN_GAP)
      column = Math.round(outlineRight + PLATE_GAP);
  }

  if (props.targets && targetsSize) {
    const at = { left: column ?? EDGE, top: outlineTop };
    g.targets =
      choose([
        {
          value: at,
          boxes: [rect(at.left, at.top, targetsSize.w, targetsSize.h)],
        },
      ]) ?? undefined;
    if (!g.targets) fits = false;
  }

  // Text size: a dimension line on the first line box, in the left gutter, and a
  // plate in the whitespace between the icon row and the paragraph: under the
  // targets plate, or beside it when the plates are tall (a large text scale).
  const first = root.querySelector('[data-anchor="first-line"]');
  const body = root.querySelector('.ws-sample__body');
  if (props.text && textSize && first && body) {
    const para = boxOf(first.getBoundingClientRect(), origin);
    const gutter = boxOf(body.getBoundingClientRect(), origin);
    const style = getComputedStyle(first);
    const lineHeight =
      parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 16) * 1.2;
    g.textLine = {
      x: Math.round((gutter.left + para.left) / 2),
      top: Math.round(para.top),
      height: Math.round(lineHeight),
    };
    const { w, h } = textSize;
    const candidates: Candidate<Placed>[] = [];
    const under = {
      left: column ?? Math.round(para.left),
      top: Math.floor(para.top) - TEXT_PLATE_AIR - h,
    };
    candidates.push({
      value: under,
      boxes: [rect(under.left, under.top, w, h)],
    });
    if (g.targets && targetsSize) {
      const beside = {
        left: g.targets.left + targetsSize.w + 8,
        top: g.targets.top,
      };
      candidates.push({
        value: beside,
        boxes: [rect(beside.left, beside.top, w, h)],
      });
    }
    g.text = choose(candidates) ?? undefined;
    if (!g.text) fits = false;
  }

  // Moving things: a plate pinned to the countdown by a 12 px leader, hanging
  // under it, or (when that would cover text) to its left on the same line.
  const countdown = root.querySelector('[data-anchor="countdown"]');
  const motionSize = props.motion ? sizeOf(plates.motion) : null;
  if (props.motion && motionSize && countdown) {
    const glyphs = glyphBox(countdown, origin);
    const { w, h } = motionSize;
    const downTop = Math.ceil(glyphs.bottom) + AIR + 1;
    const downX = Math.round((glyphs.left + glyphs.right) / 2);
    const down: { leader: Leader; plate: Placed } = {
      leader: { left: downX, top: downTop, orient: 'v' },
      plate: { left: Math.round(glyphs.right) - w, top: downTop + LEADER },
    };
    const midY = Math.round((glyphs.top + glyphs.bottom) / 2);
    const sideRight = Math.floor(glyphs.left) - AIR - 1;
    const side: { leader: Leader; plate: Placed } = {
      leader: { left: sideRight - LEADER, top: midY, orient: 'h' },
      plate: {
        left: sideRight - LEADER - w,
        top: Math.round(midY - h / 2),
      },
    };
    const chosen = choose([
      {
        value: down,
        boxes: [
          rect(down.plate.left, down.plate.top, w, h),
          rect(downX, downTop, 1, LEADER),
        ],
      },
      {
        value: side,
        boxes: [
          rect(side.plate.left, side.plate.top, w, h),
          rect(side.leader.left, midY, LEADER, 1),
        ],
      },
    ]);
    if (chosen) {
      g.leader = chosen.leader;
      g.motion = chosen.plate;
    } else fits = false;
  }

  g.compact = !fits;
  return g;
}

/**
 * The hero's fit marks, drawn in an overlay over the sample page from measured
 * element rects (design-final §8). The overlay is absolutely positioned, ignores the
 * pointer and is hidden from assistive technology, so the page underneath lays out
 * exactly as the fit makes it: showing or hiding the marks never moves a line.
 *
 * Plates are placed only where they touch no text; when the page is too narrow for
 * that, none is drawn and `onCompactChange(true)` lets the caller show the values
 * beside the picture.
 */
export function SampleMarks({
  text,
  targets,
  motion,
  hitPx,
  mode,
  onCompactChange,
}: SampleMarksProps) {
  const ref = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const targetsRef = useRef<HTMLSpanElement>(null);
  const motionRef = useRef<HTMLSpanElement>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const reportRef = useRef(onCompactChange);
  // The marks arrive as fresh objects on every render; measure again only when
  // what they say changes.
  const latest = useRef({ text, targets, motion });
  const marksKey = [text, targets, motion]
    .map((m) => (m ? `${m.id}:${m.from ?? ''}:${m.to}:${m.unit ?? ''}` : '-'))
    .join('|');
  useLayoutEffect(() => {
    reportRef.current = onCompactChange;
    latest.current = { text, targets, motion };
  });

  useLayoutEffect(() => {
    const overlay = ref.current;
    const root = overlay?.parentElement;
    if (!overlay || !root) return;
    const plates = { text: textRef, targets: targetsRef, motion: motionRef };
    let frame = 0;
    let last: boolean | null = null;
    const run = () => {
      const next = measure(root, overlay, plates, {
        ...latest.current,
        hitPx,
      });
      setGeometry(next);
      if (next.compact !== last) {
        last = next.compact;
        reportRef.current?.(next.compact);
      }
    };
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(run);
    };
    run();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    for (const selector of [
      '.ws-sample__body',
      '.ws-sample__promo',
      '[data-anchor="first-line"]',
    ]) {
      const el = root.querySelector(selector);
      if (el) observer.observe(el);
    }
    // Plates are sized in rem: they grow with the person's text scale.
    for (const plate of [textRef, targetsRef, motionRef]) {
      if (plate.current) observer.observe(plate.current);
    }
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) update();
    });
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [marksKey, hitPx]);

  const drawn = geometry !== null && !geometry.compact;
  // Until measured (and when nothing fits), plates are laid out out of sight,
  // unseen, so their size can be read.
  const plateStyle = (at: Placed | undefined) =>
    drawn && at
      ? { left: at.left, top: at.top }
      : { left: -10000, top: 0, visibility: 'hidden' as const };

  return (
    <div
      ref={ref}
      className="ws-sample__marks"
      data-mode={mode}
      data-compact={geometry?.compact ? '' : undefined}
      aria-hidden="true"
    >
      {motion ? (
        <>
          {drawn && geometry.leader ? (
            <svg
              className="ws-marks__rule ws-marks__rule--motion"
              width={geometry.leader.orient === 'v' ? 1 : LEADER}
              height={geometry.leader.orient === 'v' ? LEADER : 1}
              style={{ left: geometry.leader.left, top: geometry.leader.top }}
              focusable="false"
            >
              {geometry.leader.orient === 'v' ? (
                <line x1="0.5" y1="0" x2="0.5" y2={LEADER} pathLength={1} />
              ) : (
                // Drawn from the countdown towards the plate.
                <line x1={LEADER} y1="0.5" x2="0" y2="0.5" pathLength={1} />
              )}
            </svg>
          ) : null}
          <SiteFitMark
            {...plateProps(motion)}
            ref={motionRef}
            className="ws-marks__plate ws-marks__plate--motion"
            style={plateStyle(geometry?.motion)}
          />
        </>
      ) : null}

      {targets ? (
        <SiteFitMark
          {...plateProps(targets)}
          ref={targetsRef}
          className="ws-marks__plate ws-marks__plate--targets"
          style={plateStyle(geometry?.targets)}
        />
      ) : null}

      {text ? (
        <>
          {geometry?.textLine ? (
            <svg
              className="ws-marks__rule ws-marks__rule--text"
              width="9"
              height={geometry.textLine.height}
              style={{
                left: geometry.textLine.x - 4,
                top: geometry.textLine.top,
              }}
              focusable="false"
            >
              <line
                className="ws-marks__tick ws-marks__tick--a"
                x1="0.5"
                y1="0.5"
                x2="8.5"
                y2="0.5"
                pathLength={1}
              />
              <line
                className="ws-marks__line"
                x1="4.5"
                y1="0.5"
                x2="4.5"
                y2={geometry.textLine.height - 0.5}
                pathLength={1}
              />
              <line
                className="ws-marks__tick ws-marks__tick--b"
                x1="0.5"
                y1={geometry.textLine.height - 0.5}
                x2="8.5"
                y2={geometry.textLine.height - 0.5}
                pathLength={1}
              />
            </svg>
          ) : null}
          <SiteFitMark
            {...plateProps(text)}
            ref={textRef}
            className="ws-marks__plate ws-marks__plate--text"
            style={plateStyle(geometry?.text)}
          />
        </>
      ) : null}
    </div>
  );
}

function plateProps(m: SampleMark) {
  return { label: m.label, from: m.from, to: m.to, unit: m.unit };
}
