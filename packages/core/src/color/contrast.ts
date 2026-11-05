// Owner: A2.
// WCAG 2 contrast maths, a CSS colour parser that understands what getComputedStyle returns in Chrome
// (rgb/rgba, and oklch/oklab/lab/lch/color() when the author used them), and a solver that lifts a
// foreground colour to a contrast ratio by moving its OKLCH lightness only, so the hue survives.

export interface Rgba { r: number; g: number; b: number; a: number }

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255],
  gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192], maroon: [128, 0, 0], navy: [0, 0, 128],
  teal: [0, 128, 128], olive: [128, 128, 0], purple: [128, 0, 128], orange: [255, 165, 0], yellow: [255, 255, 0],
  lime: [0, 255, 0], aqua: [0, 255, 255], cyan: [0, 255, 255], fuchsia: [255, 0, 255], magenta: [255, 0, 255],
  darkgray: [169, 169, 169], darkgrey: [169, 169, 169], lightgray: [211, 211, 211], lightgrey: [211, 211, 211],
  dimgray: [105, 105, 105], dimgrey: [105, 105, 105], gainsboro: [220, 220, 220], whitesmoke: [245, 245, 245],
  darkblue: [0, 0, 139], darkred: [139, 0, 0], darkgreen: [0, 100, 0], royalblue: [65, 105, 225],
  steelblue: [70, 130, 180], slategray: [112, 128, 144], slategrey: [112, 128, 144], tomato: [255, 99, 71],
  crimson: [220, 20, 60], gold: [255, 215, 0], pink: [255, 192, 203], brown: [165, 42, 42], beige: [245, 245, 220],
  ivory: [255, 255, 240], snow: [255, 250, 250], linen: [250, 240, 230], indigo: [75, 0, 130], coral: [255, 127, 80],
  salmon: [250, 128, 114], khaki: [240, 230, 140], tan: [210, 180, 140], orchid: [218, 112, 214],
  turquoise: [64, 224, 208], skyblue: [135, 206, 235], dodgerblue: [30, 144, 255], firebrick: [178, 34, 34],
  seagreen: [46, 139, 87], forestgreen: [34, 139, 34], midnightblue: [25, 25, 112], aliceblue: [240, 248, 255],
  ghostwhite: [248, 248, 255], honeydew: [240, 255, 240], mintcream: [245, 255, 250], lavender: [230, 230, 250],
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** One numeric token: '12', '12.5%', '-0.3', '45deg', '0.5turn', 'none'. */
interface Tok { v: number; pct: boolean; unit: string }

function tokens(args: string): { main: Tok[]; alpha: Tok | null } | null {
  const parts = args.split('/');
  if (parts.length > 2) return null;
  const mainPart = parts[0] ?? '';
  const alphaPart = parts[1];
  const parse = (s: string): Tok[] | null => {
    const out: Tok[] = [];
    for (const raw of s.replace(/,/g, ' ').trim().split(/\s+/)) {
      if (!raw) continue;
      if (raw === 'none') { out.push({ v: 0, pct: false, unit: '' }); continue; }
      const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/i.exec(raw);
      if (!m || m[1] === undefined) return null;
      const unit = (m[2] ?? '').toLowerCase();
      out.push({ v: Number(m[1]), pct: unit === '%', unit: unit === '%' ? '' : unit });
    }
    return out;
  };
  const main = parse(mainPart);
  if (!main) return null;
  let alpha: Tok | null = null;
  if (alphaPart !== undefined) {
    const a = parse(alphaPart);
    if (!a || a.length !== 1 || a[0] === undefined) return null;
    alpha = a[0];
  } else if (args.includes(',') && main.length === 4) {
    // legacy comma syntax: rgba(r, g, b, a)
    alpha = main.pop() ?? null;
  }
  return { main, alpha };
}

const alphaOf = (t: Tok | null): number => (t ? clamp(t.pct ? t.v / 100 : t.v, 0, 1) : 1);

function hueDeg(t: Tok): number {
  switch (t.unit) {
    case 'rad': return (t.v * 180) / Math.PI;
    case 'grad': return t.v * 0.9;
    case 'turn': return t.v * 360;
    default: return t.v;
  }
}

const srgbEncode = (x: number): number => {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  return s * (a <= 0.0031308 ? 12.92 * a : 1.055 * a ** (1 / 2.4) - 0.055);
};
const srgbDecode = (x: number): number => {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  return s * (a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4);
};

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];
const mul = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

// CSS Color 4 reference matrices.
const XYZ65_TO_LIN_SRGB: Mat3 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const D50_TO_D65: Mat3 = [
  [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
  [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
  [0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
];
const LIN_P3_TO_XYZ65: Mat3 = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];

/** Linear-light sRGB (0..1, may be out of gamut) to a clamped 0..255 Rgba. */
function fromLinear(lin: Vec3, a: number): Rgba {
  return {
    r: clamp(srgbEncode(lin[0]), 0, 1) * 255,
    g: clamp(srgbEncode(lin[1]), 0, 1) * 255,
    b: clamp(srgbEncode(lin[2]), 0, 1) * 255,
    a,
  };
}

function oklabToLinear(L: number, a: number, b: number): Vec3 {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function linearToOklab(r: number, g: number, b: number): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function labD50ToLinear(L: number, a: number, b: number): Vec3 {
  const k = 24389 / 27;
  const e = 216 / 24389;
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const x = fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k;
  const y = L > k * e ? fy ** 3 : L / k;
  const z = fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k;
  const xyz50: Vec3 = [x * 0.96422, y, z * 0.82521];
  return mul(XYZ65_TO_LIN_SRGB, mul(D50_TO_D65, xyz50));
}

function hslToRgb(h: number, s: number, l: number): Vec3 {
  const hh = (((h % 360) + 360) % 360) / 30;
  const f = (n: number): number => {
    const k = (n + hh) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** Parse a CSS colour as Chrome's computed style reports it. Returns null for unknown or context colours. */
export function parseColor(css: string): Rgba | null {
  const s = css.trim().toLowerCase();
  if (!s) return null;
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const named = NAMED[s];
  if (named) return { r: named[0], g: named[1], b: named[2], a: 1 };

  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h)) return null;
    const ex = (i: number, len: number): number => {
      const part = h.slice(i, i + len);
      return parseInt(len === 1 ? part + part : part, 16);
    };
    if (h.length === 3 || h.length === 4) {
      return { r: ex(0, 1), g: ex(1, 1), b: ex(2, 1), a: h.length === 4 ? ex(3, 1) / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      return { r: ex(0, 2), g: ex(2, 2), b: ex(4, 2), a: h.length === 8 ? ex(6, 2) / 255 : 1 };
    }
    return null;
  }

  const fm = /^([a-z-]+)\((.*)\)$/.exec(s);
  if (!fm || fm[1] === undefined || fm[2] === undefined) return null;
  const fn = fm[1];
  const body = fm[2];

  if (fn === 'color') {
    const sm = /^\s*([a-z0-9-]+)\s+(.*)$/.exec(body);
    if (!sm || sm[1] === undefined || sm[2] === undefined) return null;
    const t = tokens(sm[2]);
    if (!t || t.main.length !== 3) return null;
    const v = t.main.map((x) => (x.pct ? x.v / 100 : x.v)) as Vec3;
    const a = alphaOf(t.alpha);
    const dec: Vec3 = [srgbDecode(v[0]), srgbDecode(v[1]), srgbDecode(v[2])];
    switch (sm[1]) {
      case 'srgb': return fromLinear(dec, a);
      case 'srgb-linear': return fromLinear(v, a);
      case 'display-p3': return fromLinear(mul(XYZ65_TO_LIN_SRGB, mul(LIN_P3_TO_XYZ65, dec)), a);
      case 'xyz':
      case 'xyz-d65': return fromLinear(mul(XYZ65_TO_LIN_SRGB, v), a);
      case 'xyz-d50': return fromLinear(mul(XYZ65_TO_LIN_SRGB, mul(D50_TO_D65, v)), a);
      default: return null;
    }
  }

  const t = tokens(body);
  if (!t || t.main.length !== 3) return null;
  const [c0, c1, c2] = t.main as [Tok, Tok, Tok];
  const a = alphaOf(t.alpha);
  switch (fn) {
    case 'rgb':
    case 'rgba': {
      const ch = (x: Tok): number => clamp(x.pct ? x.v * 2.55 : x.v, 0, 255);
      return { r: ch(c0), g: ch(c1), b: ch(c2), a };
    }
    case 'hsl':
    case 'hsla': {
      const [r, g, b] = hslToRgb(hueDeg(c0), clamp(c1.v / 100, 0, 1), clamp(c2.v / 100, 0, 1));
      return { r: clamp(r, 0, 1) * 255, g: clamp(g, 0, 1) * 255, b: clamp(b, 0, 1) * 255, a };
    }
    case 'hwb': {
      let w = clamp(c1.v / 100, 0, 1);
      let bl = clamp(c2.v / 100, 0, 1);
      if (w + bl >= 1) { const sum = w + bl; w /= sum; bl /= sum; }
      const [r, g, b] = hslToRgb(hueDeg(c0), 1, 0.5).map((x) => x * (1 - w - bl) + w) as Vec3;
      return { r: r * 255, g: g * 255, b: b * 255, a };
    }
    case 'oklab': {
      const L = c0.pct ? c0.v / 100 : c0.v;
      return fromLinear(oklabToLinear(L, c1.pct ? c1.v * 0.004 : c1.v, c2.pct ? c2.v * 0.004 : c2.v), a);
    }
    case 'oklch': {
      const L = c0.pct ? c0.v / 100 : c0.v;
      const C = c1.pct ? c1.v * 0.004 : c1.v;
      const H = (hueDeg(c2) * Math.PI) / 180;
      return fromLinear(oklabToLinear(L, C * Math.cos(H), C * Math.sin(H)), a);
    }
    case 'lab':
      return fromLinear(labD50ToLinear(c0.v, c1.pct ? c1.v * 1.25 : c1.v, c2.pct ? c2.v * 1.25 : c2.v), a);
    case 'lch': {
      const C = c1.pct ? c1.v * 1.5 : c1.v;
      const H = (hueDeg(c2) * Math.PI) / 180;
      return fromLinear(labD50ToLinear(c0.v, C * Math.cos(H), C * Math.sin(H)), a);
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* WCAG 2 maths                                                        */
/* ------------------------------------------------------------------ */

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/** Source-over compositing of fg onto bg. A translucent bg is first flattened onto white (the canvas). */
export function compositeOver(fg: Rgba, bg: Rgba): Rgba {
  const base = bg.a >= 1 ? bg : bg.a <= 0 ? WHITE : compositeOver(bg, WHITE);
  const a = clamp(fg.a, 0, 1);
  return {
    r: fg.r * a + base.r * (1 - a),
    g: fg.g * a + base.g * (1 - a),
    b: fg.b * a + base.b * (1 - a),
    a: 1,
  };
}

/** WCAG 2 relative luminance of an sRGB colour (alpha ignored). */
export function relativeLuminance(c: Rgba): number {
  const ch = (v: number): number => srgbDecode(clamp(v, 0, 255) / 255);
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/** WCAG 2 contrast ratio (1..21). Translucent colours are composited: fg over bg, bg over white. */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const back = bg.a >= 1 ? bg : compositeOver(bg, WHITE);
  const front = fg.a >= 1 ? fg : compositeOver(fg, back);
  const l1 = relativeLuminance(front);
  const l2 = relativeLuminance(back);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Text contrast target T_c for a fit's floor (4.5 / 7 / max ≥ 15) and the text's size class
 * (WCAG large text: ≥ 24 px, or ≥ 18.66 px at weight ≥ 700). N: 4.5 / 3, M: 7 / 4.5, S: 15 / 7.
 */
export function contrastTarget(floor: number, fontPx: number, fontWeight = 400): number {
  const large = fontPx >= 24 || (fontPx >= 18.66 && fontWeight >= 700);
  if (floor >= 15) return large ? 7 : 15;
  if (floor >= 7) return large ? 4.5 : 7;
  return large ? 3 : 4.5;
}

/* ------------------------------------------------------------------ */
/* OKLCH lightness solver                                              */
/* ------------------------------------------------------------------ */

export interface Oklch { L: number; C: number; H: number }

export function toOklch(c: Rgba): Oklch {
  const [L, a, b] = linearToOklab(srgbDecode(c.r / 255), srgbDecode(c.g / 255), srgbDecode(c.b / 255));
  const C = Math.hypot(a, b);
  let H = (Math.atan2(b, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}

const inGamut = (v: Vec3): boolean => v.every((x) => x >= -1e-4 && x <= 1 + 1e-4);

/** OKLCH to sRGB, reducing chroma (never hue or lightness) until the colour fits the sRGB gamut. */
export function fromOklch(o: Oklch, alpha = 1): Rgba {
  const L = clamp(o.L, 0, 1);
  const h = (o.H * Math.PI) / 180;
  const at = (C: number): Vec3 => oklabToLinear(L, C * Math.cos(h), C * Math.sin(h));
  let lin = at(o.C);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = o.C;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(at(mid))) lo = mid; else hi = mid;
    }
    lin = at(lo);
  }
  return fromLinear(lin, alpha);
}

const round255 = (c: Rgba): Rgba => ({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b), a: 1 });

/** '#rrggbb', or '#rrggbbaa' when translucent. */
export function toHex(c: Rgba): string {
  const h = (v: number): string => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  return c.a >= 1 ? base : `${base}${h(c.a * 255)}`;
}

/**
 * Lift a foreground colour until it reaches `ratio` against `bg`, changing only OKLCH lightness (chroma is
 * reduced only when the sRGB gamut forces it; hue is kept so colour-coded meaning survives). Moves away from
 * the background's lightness; if that direction cannot reach the ratio, tries the other; falls back to black
 * or white. Returns an opaque '#rrggbb'. A colour that already meets the ratio comes back unchanged (flattened).
 */
export function liftToRatio(fg: Rgba, bg: Rgba, ratio: number): string {
  const back = bg.a >= 1 ? bg : compositeOver(bg, WHITE);
  const front = round255(fg.a >= 1 ? fg : compositeOver(fg, back));
  const target = clamp(ratio, 1, 21);
  if (contrastRatio(front, back) >= target) return toHex(front);

  const lb = relativeLuminance(back);
  const maxDark = (lb + 0.05) / 0.05; // the ratio against black
  const maxLight = 1.05 / (lb + 0.05); // the ratio against white
  let dir: 1 | -1 = relativeLuminance(front) <= lb ? -1 : 1;
  if (dir === -1 && maxDark < target && maxLight > maxDark) dir = 1;
  else if (dir === 1 && maxLight < target && maxDark > maxLight) dir = -1;
  const extreme: Rgba = dir === -1 ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
  if ((dir === -1 ? maxDark : maxLight) < target) return toHex(extreme);

  const o = toOklch(front);
  const candidate = (L: number): Rgba => round255(fromOklch({ L, C: o.C, H: o.H }));
  const ok = (L: number): boolean => contrastRatio(candidate(L), back) >= target;
  const end = dir === -1 ? 0 : 1;
  if (!ok(end)) return toHex(extreme);

  // Binary search for the smallest lightness move that reaches the target (18 iterations).
  let lo = o.L; // fails
  let hi = end; // passes
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid; else lo = mid;
  }
  return toHex(candidate(hi));
}
