/**
 * Colour maths for contrast measurement and the contrast op.
 *
 * - Metric: the WCAG 2 contrast ratio (sRGB linearisation). APCA is deliberately
 *   not used (licence and standards status, engine.md 2.4).
 * - Solver: move the foreground's OKLCH lightness away from the background,
 *   keeping hue and reducing chroma only when the colour leaves the sRGB gamut
 *   (engine.md 3.4.3). Never changes the background, hue or layout.
 *
 * Everything here is pure and DOM-free except the optional parse fallback,
 * which the engine installs with a 1x1 canvas for syntaxes such as oklch().
 */

/** [r, g, b] in 0-255, alpha in 0-1. */
export type RGBA = readonly [number, number, number, number];

export const WHITE: RGBA = [255, 255, 255, 1];
export const BLACK: RGBA = [0, 0, 0, 1];
export const TRANSPARENT: RGBA = [0, 0, 0, 0];

type ParseFallback = (css: string) => RGBA | null;
let parseFallback: ParseFallback | null = null;
const cache = new Map<string, RGBA | null>();
const CACHE_MAX = 512;

/** Install a parser for colour syntaxes the regexes below do not cover. */
export function setColorParseFallback(fn: ParseFallback | null): void {
  parseFallback = fn;
  cache.clear();
}

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

function parseAlpha(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const v = raw.trim();
  if (v.endsWith('%')) return clamp(parseFloat(v) / 100, 0, 1);
  const n = parseFloat(v);
  return Number.isFinite(n) ? clamp(n, 0, 1) : 1;
}

function parseChannel(raw: string): number {
  const v = raw.trim();
  if (v.endsWith('%')) return clamp((parseFloat(v) / 100) * 255, 0, 255);
  const n = parseFloat(v);
  return Number.isFinite(n) ? clamp(n, 0, 255) : NaN;
}

const RGB_RE =
  /^rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i;
const SRGB_RE =
  /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i;
const HEX_RE = /^#([0-9a-f]{3,8})$/i;

function parseUncached(input: string): RGBA | null {
  const css = input.trim().toLowerCase();
  if (css === 'transparent') return TRANSPARENT;
  const m = RGB_RE.exec(css);
  if (m) {
    const r = parseChannel(m[1] ?? '');
    const g = parseChannel(m[2] ?? '');
    const b = parseChannel(m[3] ?? '');
    if ([r, g, b].some((c) => Number.isNaN(c))) return null;
    return [r, g, b, parseAlpha(m[4])];
  }
  const s = SRGB_RE.exec(css);
  if (s) {
    const ch = [s[1], s[2], s[3]].map(
      (c) => clamp(parseFloat(c ?? '0'), 0, 1) * 255,
    );
    return [ch[0] ?? 0, ch[1] ?? 0, ch[2] ?? 0, parseAlpha(s[4])];
  }
  const h = HEX_RE.exec(css);
  if (h) {
    let hex = h[1] ?? '';
    if (hex.length === 3 || hex.length === 4) {
      hex = [...hex].map((c) => c + c).join('');
    }
    if (hex.length !== 6 && hex.length !== 8) return null;
    const n = (i: number): number => parseInt(hex.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), hex.length === 8 ? n(6) / 255 : 1];
  }
  return parseFallback ? parseFallback(input) : null;
}

/** Parse a computed CSS colour. Returns null when the syntax is unknown. */
export function parseColor(css: string): RGBA | null {
  if (cache.has(css)) return cache.get(css) ?? null;
  const v = parseUncached(css);
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(css, v);
  return v;
}

/** Source-over compositing of `f` on top of `b`. */
export function over(f: RGBA, b: RGBA): RGBA {
  const a = f[3] + b[3] * (1 - f[3]);
  if (a <= 0) return TRANSPARENT;
  const mix = (i: 0 | 1 | 2): number =>
    (f[i] * f[3] + b[i] * b[3] * (1 - f[3])) / a;
  return [mix(0), mix(1), mix(2), a];
}

const toLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number): number => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return c * 255;
};

/** WCAG 2 relative luminance. Alpha is ignored; composite first. */
export function luminance(c: RGBA): number {
  return (
    0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2])
  );
}

/** WCAG 2 contrast ratio in [1, 21]. The foreground is composited over the background. */
export function contrastRatio(fg: RGBA, bg: RGBA): number {
  const opaqueBg = bg[3] < 1 ? over(bg, WHITE) : bg;
  const f = fg[3] < 1 ? over(fg, opaqueBg) : fg;
  const x = luminance(f);
  const y = luminance(opaqueBg);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// ---------------------------------------------------------------------------
// OKLab / OKLCH (Björn Ottosson, 2020)
// ---------------------------------------------------------------------------

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

export function rgbToOklch(rgb: RGBA): Oklch {
  const r = toLinear(rgb[0]);
  const g = toLinear(rgb[1]);
  const b = toLinear(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

/** OKLCH to linear sRGB, unclipped (channels may leave [0, 1]). */
function oklchToLinear(
  l: number,
  c: number,
  h: number,
): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const A = c * Math.cos(rad);
  const B = c * Math.sin(rad);
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const inGamut = (lin: readonly number[]): boolean =>
  lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH to sRGB, keeping L and H and reducing chroma until the colour is in gamut. */
export function oklchToRgb(l: number, c: number, h: number): RGBA {
  const L = clamp(l, 0, 1);
  let lin = oklchToLinear(L, c, h);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(L, mid, h))) lo = mid;
      else hi = mid;
    }
    lin = oklchToLinear(L, lo, h);
  }
  const ch = lin.map((v) =>
    clamp(Math.round(fromLinear(clamp(v, 0, 1))), 0, 255),
  );
  return [ch[0] ?? 0, ch[1] ?? 0, ch[2] ?? 0, 1];
}

export interface SolveResult {
  color: RGBA;
  /** Ratio actually reached against the background. */
  ratio: number;
  /** False when the target could not be reached even at black or white. */
  reached: boolean;
}

/**
 * Smallest OKLCH lightness change of `fg` that reaches `target` against `bg`.
 * A target of 21 or more snaps to whichever of black and white contrasts most.
 */
export function solveForeground(
  fg: RGBA,
  bg: RGBA,
  target: number,
): SolveResult {
  const opaqueBg = bg[3] < 1 ? over(bg, WHITE) : bg;
  const start = fg[3] < 1 ? over(fg, opaqueBg) : fg;
  const current = contrastRatio(start, opaqueBg);
  if (current >= target) return { color: start, ratio: current, reached: true };

  const rBlack = contrastRatio(BLACK, opaqueBg);
  const rWhite = contrastRatio(WHITE, opaqueBg);
  if (target >= 21) {
    const color = rBlack >= rWhite ? BLACK : WHITE;
    return { color, ratio: Math.max(rBlack, rWhite), reached: false };
  }

  const { l, c, h } = rgbToOklch(start);
  const preferDarker = luminance(opaqueBg) > 0.18;
  const directions: Array<'darker' | 'lighter'> = preferDarker
    ? ['darker', 'lighter']
    : ['lighter', 'darker'];

  for (const dir of directions) {
    const extreme = dir === 'darker' ? rBlack : rWhite;
    if (extreme < target) continue;
    // Binary search the lightness between the current value and the extreme.
    let near = l;
    let far = dir === 'darker' ? 0 : 1;
    let best = dir === 'darker' ? BLACK : WHITE;
    for (let i = 0; i < 20; i++) {
      const mid = (near + far) / 2;
      const candidate = oklchToRgb(mid, c, h);
      if (contrastRatio(candidate, opaqueBg) >= target) {
        best = candidate;
        far = mid;
      } else {
        near = mid;
      }
    }
    return { color: best, ratio: contrastRatio(best, opaqueBg), reached: true };
  }

  const color = rBlack >= rWhite ? BLACK : WHITE;
  return { color, ratio: Math.max(rBlack, rWhite), reached: false };
}

export function rgbaToCss(c: RGBA): string {
  const r = Math.round(c[0]);
  const g = Math.round(c[1]);
  const b = Math.round(c[2]);
  return c[3] >= 1
    ? `rgb(${r} ${g} ${b})`
    : `rgb(${r} ${g} ${b} / ${+c[3].toFixed(3)})`;
}

/** Ratio for display in fit marks: "3.1:1". */
export function formatRatio(r: number): string {
  const v = Math.floor(r * 10) / 10;
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}:1`;
}
