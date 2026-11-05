// "What gets in your way": a hand-built hexagon radar of how strongly each struggle gets in the person's way.
// No numbers anywhere on it; the hidden table says the amounts in words.
// Three faint rings and hairline spokes; the shape in the accent (14% fill, 2.5 px line) with white vertex dots;
// 15 px labels outside, the top three in ink. The SVG is drawn at its real pixel size (no viewBox scaling), so labels
// stay 15 px at every width; the radius is solved from the measured label widths so labels never clip, and labels sit
// outside the outer ring so no value can ever reach them. Grows from the centre over 600 ms unless motion is reduced.
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export interface RadarProps {
  values: number[]; // 0-100, clockwise from the top
  labels: string[];
  emphasis: boolean[]; // labels drawn in ink
  words: string[]; // the amounts in plain words, for the hidden table
  summary: string; // aria-label
  reduced: boolean;
}

const COS30 = Math.cos(Math.PI / 6);
const FONT_PX = 15;
const LINE = 20; // label line height
const GAP = 14; // outer ring to label
const PAD = 4;
const MIN_SHOW = 0.07; // a zero still shows as a small step out from the centre
const MAX_R = 150;
const MIN_R = 56;
const SIDES = [1, 2, 4, 5];

let measureCtx: CanvasRenderingContext2D | null | undefined;
function textWidth(s: string, weight: number, family: string): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement('canvas').getContext('2d');
    } catch {
      measureCtx = null;
    }
  }
  if (!measureCtx) return s.length * 8.6;
  measureCtx.font = `${weight} ${FONT_PX}px ${family}`;
  return measureCtx.measureText(s).width;
}

/** Split a label into two lines at the space nearest its middle. */
function splitTwo(s: string): string[] {
  const spaces = [...s.matchAll(/ /g)].map((m) => m.index ?? 0);
  if (!spaces.length) return [s];
  const mid = s.length / 2;
  const at = spaces.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
  return [s.slice(0, at), s.slice(at + 1)];
}

interface Geometry {
  w: number;
  h: number;
  cx: number;
  cy: number;
  r: number;
  lines: string[][];
}

function geometry(width: number, labels: string[], emphasis: boolean[], family: string): Geometry {
  const w = Math.max(260, Math.floor(width));
  const weightOf = (i: number): number => (emphasis[i] ? 600 : 500);
  const sideWidth = (lines: string[][]): number =>
    Math.max(...SIDES.map((i) => Math.max(...(lines[i] ?? ['']).map((s) => textWidth(s, weightOf(i), family))))) + 3;
  const radiusFor = (lines: string[][]): number => (w / 2 - PAD - sideWidth(lines) - GAP) / COS30;

  const single = labels.map((l) => [l]);
  let lines = single;
  let r = radiusFor(single);
  if (r < 112) {
    // Narrow: break the four side labels onto two lines and take whichever leaves the bigger chart.
    const wrapped = labels.map((l, i) => (SIDES.includes(i) ? splitTwo(l) : [l]));
    const r2 = radiusFor(wrapped);
    if (r2 > r) {
      lines = wrapped;
      r = r2;
    }
  }
  r = Math.max(MIN_R, Math.min(MAX_R, Math.floor(r)));
  const cy = PAD + LINE + GAP + r;
  return { w, h: Math.ceil(cy + r + GAP + LINE + PAD), cx: w / 2, cy, r, lines };
}

const angle = (i: number): number => -Math.PI / 2 + (i * Math.PI) / 3;

function hexPoints(cx: number, cy: number, radii: number[]): string {
  return radii
    .map((rad, i) => `${(cx + rad * Math.cos(angle(i))).toFixed(2)},${(cy + rad * Math.sin(angle(i))).toFixed(2)}`)
    .join(' ');
}

/** Run `step(eased 0..1)` each frame for `ms`; returns a cancel function. */
function animate(ms: number, step: (e: number) => void, delay = 0): () => void {
  let raf = 0;
  let start = -1;
  const tick = (now: number): void => {
    if (start < 0) start = now + delay;
    const t = Math.min(1, Math.max(0, (now - start) / ms));
    step(1 - Math.pow(1 - t, 3));
    if (t < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

export function Radar(props: RadarProps): JSX.Element {
  const { values, labels, emphasis, words, summary, reduced } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(420);
  const [family, setFamily] = useState('system-ui, sans-serif');
  const [grow, setGrow] = useState(reduced ? 1 : 0);
  const [shown, setShown] = useState<number[]>(values);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setFamily(getComputedStyle(el).fontFamily || 'system-ui, sans-serif');
    const read = (): void => setWidth(Math.round(el.clientWidth) || 420);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Grow from the centre once.
  useEffect(() => {
    if (reduced) {
      setGrow(1);
      return;
    }
    return animate(600, setGrow, 120);
  }, []);

  // Glide to new values when a setting changes.
  const key = values.join(',');
  useEffect(() => {
    const from = shownRef.current;
    if (reduced || from.join(',') === key) {
      setShown(values);
      return;
    }
    return animate(260, (e) => setShown(values.map((v, i) => (from[i] ?? 0) + (v - (from[i] ?? 0)) * e)));
  }, [key, reduced]);

  const g = geometry(Math.min(width, 480), labels, emphasis, family);
  const { cx, cy, r } = g;
  const radii = shown.map((v) => r * grow * (MIN_SHOW + (1 - MIN_SHOW) * Math.max(0, Math.min(100, v)) / 100));
  const ring = (k: number): string => hexPoints(cx, cy, [0, 1, 2, 3, 4, 5].map(() => r * k));

  return (
    <div class="rd" ref={wrap}>
      <svg class="rd-svg" width={g.w} height={g.h} role="img" aria-label={summary}>
        <polygon class="rd-plate" points={ring(1)} />
        <polygon class="rd-ring" points={ring(2 / 3)} />
        <polygon class="rd-ring" points={ring(1 / 3)} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <line
            key={i}
            class="rd-spoke"
            x1={cx}
            y1={cy}
            x2={(cx + r * Math.cos(angle(i))).toFixed(2)}
            y2={(cy + r * Math.sin(angle(i))).toFixed(2)}
          />
        ))}
        <polygon class="rd-shape" points={hexPoints(cx, cy, radii)} />
        {radii.map((rad, i) => (
          <circle
            key={i}
            class="rd-dot"
            r={2.625}
            cx={(cx + rad * Math.cos(angle(i))).toFixed(2)}
            cy={(cy + rad * Math.sin(angle(i))).toFixed(2)}
            style={{ opacity: grow }}
          />
        ))}
        {labels.map((_, i) => {
          const vx = cx + r * Math.cos(angle(i));
          const vy = cy + r * Math.sin(angle(i));
          const ls = g.lines[i] ?? [''];
          const cls = `rd-label${emphasis[i] ? ' is-top' : ''}`;
          if (i === 0) {
            return (
              <text key={i} class={`${cls} rd-mid`} x={cx} y={vy - GAP}>
                {ls[0]}
              </text>
            );
          }
          if (i === 3) {
            return (
              <text key={i} class={`${cls} rd-mid`} x={cx} y={vy + GAP + 11}>
                {ls[0]}
              </text>
            );
          }
          const right = i === 1 || i === 2;
          const x = right ? vx + GAP : vx - GAP;
          const y0 = vy + 5 - ((ls.length - 1) * LINE) / 2;
          return (
            <text key={i} class={`${cls} ${right ? 'rd-start' : 'rd-end'}`} x={x} y={y0}>
              {ls.map((s, j) => (
                <tspan key={j} x={x} y={y0 + j * LINE}>
                  {s}
                </tspan>
              ))}
            </text>
          );
        })}
      </svg>
      <table class="visually-hidden">
        <caption>What gets in your way</caption>
        <thead>
          <tr>
            <th scope="col">What</th>
            <th scope="col">How much it gets in your way</th>
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={l}>
              <th scope="row">{l}</th>
              <td>{words[i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
