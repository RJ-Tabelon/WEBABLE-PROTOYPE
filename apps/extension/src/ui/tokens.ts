// Owner: C, D (round 4: Calm view v3). Design tokens sized from the person's fit.
//
// Two surfaces share these tokens:
// - 'chrome' (the pill, panel, offers, toasts): the Showroom language, light by default, white cards on #F5F5F7.
// - 'calm' (the Calm view, v3): the AI-lab research-site language measured in design.md §1–§2. A white page with no
//   boxed cards, one family at 400/500, ink #121317 and meta #45474D, a narrow text column with wider pictures,
//   hairline dividers and ink pill buttons. Type comes from the person's body size F with a large-heading ratio that
//   shrinks as F grows; body line height at least 1.6; at most 68 characters a line.
// Every length is computed here (the model never computes sizes) and divided by the tab zoom when one is given.
import { type FitProfile, calmMeasureCh, calmMetaPx, calmTypeRatios } from '@webable/core';

export type ThemeMode = 'light' | 'dark' | 'max';
export interface Tokens { [name: string]: string }

export interface TokenOptions {
  /** Current tab zoom factor; lengths are divided by it. Default 1. */
  zoom?: number;
  /** Rhythm preset from the FitSpec. Default 'airy'. */
  density?: 'airy' | 'comfortable';
  /** The person's in-view text size step (Text − / Text +). Default 1. */
  scale?: number;
  /** Which surface the tokens are for. Default 'chrome'; the Calm view asks for 'calm'. */
  surface?: 'chrome' | 'calm';
}

/** Numbers behind the tokens, in CSS px at 100% zoom (before dividing by zoom). */
export interface CalmMetrics {
  F: number; // body px
  T: number; // target px (hit size)
  ctl: number; // control height
  primaryH: number; // primary action pill height
  page: number; // page heading px
  section: number; // section heading px
  title: number; // title px
  lhBody: number;
  lhPage: number;
  lhSection: number;
  lhTitle: number;
  wBody: number;
  wCtl: number;
  wHead: number;
  wordEm: number;
  letterEm: number;
  measureCh: number;
  bandGap: number;
  headGap: number;
  cardGap: number;
  cardPad: number;
  panelPad: number;
  pillPad: number;
  fieldPad: number;
  stripH: number;
  /** First band: page top padding, title → orientation line, line → task. */
  topPad: number;
  leadGap: number;
  taskGap: number;
  fieldGap: number;
  dockH: number;
  check: number; // checkbox / radio visual size
  row: number; // minimum row height in grouped lists
  colMax: number; // single task column width
  tileMin: number;
  /** Calm v3: meta text px, the text column and the picture column (px), paragraph gap, h2 space above / below. */
  meta: number;
  textCol: number;
  wideCol: number;
  /** Prose line length in px: the measure in real characters (at most 68), never wider than the text column. */
  measurePx: number;
  paraGap: number;
  h2Above: number;
  h2Below: number;
  rowPad: number;
  gutter: number;
  /** Picture corner radius: clamp(8, .75F, 16). */
  rPic: number;
  /** A form's column: min(36em, 100%). */
  formCol: number;
  /** Top bar: control height (the fit's target size, 36–48 px) and label size (15–19 px). */
  stripCtl: number;
  stripF: number;
  zoom: number;
}

const FONT_TEXT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const FONT_DISPLAY =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Shadows are never the keyword `none`, so they can be combined with edge shadows in one declaration. */
const NO_SHADOW = '0 0 0 0 transparent';

interface Palette {
  canvas: string; raised: string; tonal: string; hover: string; press: string; well: string;
  ink: string; ink2: string; line: string; lineStrong: string;
  action: string; onAction: string; actionHover: string; link: string; badge: string;
  accent: string; onAccent: string; accentHover: string; accentTint: string;
  warning: string; warningTint: string; success: string; successTint: string; focus: string; selection: string; glass: string;
  shadowCard: string; shadowLift: string; shadowFloat: string;
  edge: number; // card and control edge width in px
  edgeColor: string;
  scheme: 'light' | 'dark';
}

const LIGHT: Palette = {
  canvas: '#F5F5F7', raised: '#FFFFFF', tonal: '#E8E8ED', hover: '#DCDCE1', press: '#D2D2D7', well: '#F5F5F7',
  ink: '#1D1D1F', ink2: '#5E5E63', line: '#D2D2D7', lineStrong: '#86868B',
  action: '#0071E3', onAction: '#FFFFFF', actionHover: '#0077ED', link: '#0066CC', badge: '#B64400',
  accent: '#2D6A3E', onAccent: '#FFFFFF', accentHover: '#22552F', accentTint: '#E4EFE6',
  warning: '#7A4800', warningTint: '#FAEFD9', success: '#1E7B3C', successTint: '#E3F1E7', focus: '#0071E3', selection: '#B3D7FF',
  glass: 'rgba(255,255,255,.72)',
  shadowCard: '0 1px 2px rgba(0,0,0,.04), 0 6px 20px rgba(0,0,0,.06)',
  shadowLift: '0 2px 4px rgba(0,0,0,.05), 0 12px 32px rgba(0,0,0,.10)',
  shadowFloat: '0 12px 40px rgba(0,0,0,.16)',
  edge: 0, edgeColor: 'transparent', scheme: 'light',
};

const DARK: Palette = {
  canvas: '#000000', raised: '#1C1C1E', tonal: '#2C2C2E', hover: '#3A3A3C', press: '#48484A', well: '#2C2C2E',
  ink: '#F5F5F7', ink2: '#A1A1A6', line: '#38383A', lineStrong: '#8E8E93',
  action: '#0071E3', onAction: '#FFFFFF', actionHover: '#0077ED', link: '#2997FF', badge: '#FF9F45',
  accent: '#8FCB9B', onAccent: '#0F1A12', accentHover: '#A9D9B2', accentTint: '#1B2B1F',
  warning: '#F2B75E', warningTint: '#2E2412', success: '#6FD08C', successTint: '#12301C', focus: '#2997FF', selection: '#1F4E85',
  glass: 'rgba(22,22,23,.78)',
  shadowCard: NO_SHADOW, shadowLift: NO_SHADOW, shadowFloat: '0 12px 40px rgba(0,0,0,.6)',
  edge: 0, edgeColor: 'transparent', scheme: 'dark',
};

function moreContrast(p: Palette): Palette {
  const dark = p.scheme === 'dark';
  return {
    ...p,
    ink2: p.ink,
    line: p.lineStrong,
    link: dark ? '#6CB4FF' : '#0040DD',
    action: dark ? '#6CB4FF' : '#0040DD',
    actionHover: dark ? '#8AC4FF' : '#0033B8',
    onAction: dark ? '#000000' : '#FFFFFF',
    edge: 1,
    edgeColor: p.lineStrong,
  };
}

const MAX_LIGHT: Palette = {
  canvas: '#FFFFFF', raised: '#FFFFFF', tonal: '#F0F0F0', hover: '#E2E2E2', press: '#D4D4D4', well: '#FFFFFF',
  ink: '#000000', ink2: '#000000', line: '#000000', lineStrong: '#000000',
  action: '#0040DD', onAction: '#FFFFFF', actionHover: '#0033B8', link: '#0040DD', badge: '#8A2E00',
  accent: '#1F4D2B', onAccent: '#FFFFFF', accentHover: '#163A20', accentTint: '#FFFFFF',
  warning: '#5C3600', warningTint: '#FFFFFF', success: '#0B5A26', successTint: '#FFFFFF', focus: '#000000', selection: '#B3D7FF',
  glass: '#FFFFFF',
  shadowCard: NO_SHADOW, shadowLift: NO_SHADOW, shadowFloat: NO_SHADOW,
  edge: 2, edgeColor: '#000000', scheme: 'light',
};

const MAX_DARK: Palette = {
  canvas: '#000000', raised: '#000000', tonal: '#1A1A1A', hover: '#2A2A2A', press: '#333333', well: '#1A1A1A',
  ink: '#FFFFFF', ink2: '#FFFFFF', line: '#FFFFFF', lineStrong: '#FFFFFF',
  action: '#6CB4FF', onAction: '#000000', actionHover: '#8AC4FF', link: '#6CB4FF', badge: '#FFB366',
  accent: '#A9D9B2', onAccent: '#000000', accentHover: '#C2E6CA', accentTint: '#000000',
  warning: '#F2B75E', warningTint: '#000000', success: '#7FE09A', successTint: '#000000', focus: '#FFFFFF', selection: '#1F4E85',
  glass: '#000000',
  shadowCard: NO_SHADOW, shadowLift: NO_SHADOW, shadowFloat: NO_SHADOW,
  edge: 2, edgeColor: '#FFFFFF', scheme: 'dark',
};

/**
 * Calm view v3, light (design.md §2): a white page; ink #121317 (18.6:1) and meta #45474D (9.3:1, where the
 * references' 5.7:1 greys fail WCAG 1.4.6); hairlines #E0E0E3; field borders #8A8A8F (3.4:1, 1.4.11); #F6F6F7 for
 * picture wells and secondary pills; the primary action is an ink pill; links are blue #0040DD (7.6:1; ink links read as
 * plain text to people in testing, 2 Nov 2026); no shadows on
 * content (only on things that float: popovers and the page's popups).
 */
const CALM_LIGHT: Palette = {
  canvas: '#FFFFFF', raised: '#FFFFFF', tonal: '#F6F6F7', hover: '#EDEDEF', press: '#E3E3E6', well: '#F6F6F7',
  ink: '#121317', ink2: '#45474D', line: '#E0E0E3', lineStrong: '#8A8A8F',
  action: '#121317', onAction: '#FFFFFF', actionHover: '#2D2E34', link: '#0040DD', badge: '#45474D',
  accent: '#2D6A3E', onAccent: '#FFFFFF', accentHover: '#22552F', accentTint: '#EBF2EC',
  warning: '#7A4800', warningTint: '#FBF4E6', success: '#1E6B36', successTint: '#ECF5EE', focus: '#121317', selection: '#CFE0FC',
  glass: 'rgba(255,255,255,.9)',
  shadowCard: NO_SHADOW, shadowLift: NO_SHADOW, shadowFloat: '0 1px 2px rgba(18,19,23,.06), 0 12px 36px rgba(18,19,23,.14)',
  edge: 0, edgeColor: 'transparent', scheme: 'light',
};

const CALM_DARK: Palette = {
  canvas: '#121317', raised: '#121317', tonal: '#222328', hover: '#2C2D33', press: '#36373D', well: '#222328',
  ink: '#F3F3F5', ink2: '#B6B7BD', line: '#33343A', lineStrong: '#8A8A8F',
  action: '#F3F3F5', onAction: '#121317', actionHover: '#FFFFFF', link: '#6CB4FF', badge: '#B6B7BD',
  accent: '#8FCB9B', onAccent: '#0F1A12', accentHover: '#A9D9B2', accentTint: '#1B2B1F',
  warning: '#F2B75E', warningTint: '#2B2316', success: '#6FD08C', successTint: '#13301D', focus: '#F3F3F5', selection: '#1F4E85',
  glass: 'rgba(18,19,23,.88)',
  shadowCard: NO_SHADOW, shadowLift: NO_SHADOW, shadowFloat: '0 12px 40px rgba(0,0,0,.6)',
  edge: 0, edgeColor: 'transparent', scheme: 'dark',
};

/** Contrast band M in the Calm view: meta in full ink, hairlines and field borders at the strong grey, 1 px edges. */
function calmMoreContrast(p: Palette): Palette {
  return { ...p, ink2: p.ink, line: p.lineStrong, edge: 1, edgeColor: p.lineStrong };
}

/** Light unless the fit says dark (never from the OS setting alone); max contrast when the fit's band is S. */
export function themeModeFor(fit: FitProfile | null): ThemeMode {
  if (fit?.contrast.band === 'S') return 'max';
  if (fit?.polarity.value === 'dark') return 'dark';
  return 'light';
}

function paletteFor(fit: FitProfile | null, mode: ThemeMode, surface: 'chrome' | 'calm' = 'chrome'): Palette {
  const dark = mode === 'dark' || (mode === 'max' && fit?.polarity.value === 'dark');
  if (surface === 'calm') {
    // Maximum contrast keeps its 2 px edges; its one action stays an ink pill like every other Calm v3 action.
    if (mode === 'max') return dark ? { ...MAX_DARK, action: '#FFFFFF', onAction: '#000000', actionHover: '#E6E6E6', link: '#8AC4FF' } : { ...MAX_LIGHT, action: '#000000', onAction: '#FFFFFF', actionHover: '#1A1A1A', link: '#0033CC' };
    const base = dark ? CALM_DARK : CALM_LIGHT;
    return fit?.contrast.band === 'M' ? calmMoreContrast(base) : base;
  }
  if (mode === 'max') return dark ? MAX_DARK : MAX_LIGHT;
  const base = dark ? DARK : LIGHT;
  return fit?.contrast.band === 'M' ? moreContrast(base) : base;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Heading ratios to F, interpolated between anchors (docs/12 §4.2). */
const RAMP: Array<[number, number, number, number]> = [
  [16, 2.5, 1.75, 1.25],
  [24, 2.0, 1.5, 1.17],
  [32, 1.6, 1.3, 1.12],
  [40, 1.35, 1.18, 1.08],
];

export function typeRamp(F: number): { page: number; section: number; title: number } {
  const first = RAMP[0]!;
  const last = RAMP[RAMP.length - 1]!;
  let r: [number, number, number] = [first[1], first[2], first[3]];
  if (F >= last[0]) r = [last[1], last[2], last[3]];
  else if (F > first[0]) {
    for (let i = 0; i < RAMP.length - 1; i++) {
      const a = RAMP[i]!;
      const b = RAMP[i + 1]!;
      if (F >= a[0] && F <= b[0]) {
        const t = (F - a[0]) / (b[0] - a[0]);
        r = [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
        break;
      }
    }
  }
  return { page: F * r[0], section: F * r[1], title: F * r[2] };
}

/** Structure parameters by level (research-fitting §8.18): open sections, records first, group size, split above n sentences. */
export function structureParams(level: 0 | 1 | 2): { sectionsOpen: number; listFirst: number; groupSize: number; splitSentences: number; stepMax: number } {
  if (level === 2) return { sectionsOpen: 1, listFirst: 8, groupSize: 4, splitSentences: 3, stepMax: 5 };
  if (level === 1) return { sectionsOpen: 2, listFirst: 12, groupSize: 5, splitSentences: 4, stepMax: 8 };
  return { sectionsOpen: Infinity, listFirst: Infinity, groupSize: 6, splitSentences: Infinity, stepMax: 12 };
}

/** Width of one "0" of the body font as a share of the font size (CSS `ch`), measured once; 0.55 without a canvas. */
let chShare: number | null = null;
function chRatio(): number {
  if (chShare !== null) return chShare;
  chShare = 0.55;
  try {
    const ctx = measureCtx();
    if (ctx) {
      ctx.font = `400 100px ${FONT_TEXT}`;
      const w = ctx.measureText('0').width;
      if (w > 30 && w < 90) chShare = w / 100;
    }
  } catch {
    /* no canvas (tests): keep the estimate */
  }
  return chShare;
}

/**
 * Width of an average character of running English text, word spaces and the slack at line ends included, as a share
 * of the font size; measured once (0.47 without a canvas). CSS `ch` (a "0") is wider than an average letter, so a
 * 68ch measure holds about 85 characters; prose lines use this instead to stay at the 68 characters design.md asks for.
 */
const SAMPLE_TEXT = 'The council said the new footbridge opens on Monday, and walkers can cross the river in four minutes.';
let avgShare: number | null = null;
function avgCharRatio(): number {
  if (avgShare !== null) return avgShare;
  avgShare = 0.47;
  try {
    const ctx = measureCtx();
    if (ctx) {
      ctx.font = `400 100px ${FONT_TEXT}`;
      const w = (ctx.measureText(SAMPLE_TEXT).width / SAMPLE_TEXT.length) * 1.1;
      if (w > 30 && w < 80) avgShare = w / 100;
    }
  } catch {
    /* no canvas (tests): keep the estimate */
  }
  return avgShare;
}

function measureCtx(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  const canvas: OffscreenCanvas | HTMLCanvasElement | null =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : typeof document !== 'undefined' ? document.createElement('canvas') : null;
  return (canvas?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined) ?? null;
}

/**
 * Calm v3 sizes (design.md §2), all from the person's body size F: titles at most 2 × F (2.0 / 1.8 / 1.55 / 1.35 × F
 * at F = 17 / 24 / 32 / 40; the stylesheet also keeps them under 5.5 % of the window width), h2 1.45 / 1.35 / 1.25 /
 * 1.18, headlines 1.2 / 1.15 / 1.1 / 1.07; body line height 1.6–2.0; meta at least 16 px; a text column of
 * min(measure, 68) characters and a picture column 1.45 × as wide; paragraphs 1.1 F apart, h2 with 2.25 F above and
 * .75 F below, bands 3 F apart (at least 56 px), rows padded 1 F, gutter max(24, 1.5 F). Round 6 brought back the
 * round-3 proportions where the round-4 restyle overshot at large F.
 */
export function calmMetrics(fit: FitProfile | null, opts: TokenOptions = {}): CalmMetrics {
  const zoom = clamp(finite(opts.zoom, 1), 0.25, 5);
  const scale = clamp(finite(opts.scale, 1), 0.7, 2);
  const airy = (opts.density ?? 'airy') === 'airy';
  const stated = fit ? finite(fit.text.override ?? fit.text.bodyPx, 17) : 17;
  // Never below the references' body size; only the person's own Text − step may go a little lower.
  const F = Math.round(clamp(Math.max(16, stated) * scale, 14, 64) * 10) / 10;
  const T = clamp(finite(fit?.targets.minPx ?? null, 44), 24, 96);
  const ctl = Math.max(T, 44, Math.round(F * 2.2));
  const primaryH = Math.max(T, 52, Math.round(F * 2.55));
  const ratios = calmTypeRatios(F);
  const lhBody = clamp(Math.max(1.6, finite(fit?.spacing.lineHeight, 1.6)), 1.6, 2.0);
  const floor = clamp(finite(fit?.weight.floor, 400), 300, 700);
  const measureCh = calmMeasureCh(fit?.measure.targetCpl);
  const textCol = Math.round(measureCh * F * chRatio());
  const wideCol = Math.round(textCol * 1.45);
  const measurePx = Math.min(textCol, Math.round(measureCh * F * avgCharRatio()));
  // The top bar's controls follow the fit's target size but stay at most 48 px tall (their hit area is T).
  const stripCtl = clamp(T, 36, 48);
  return {
    F, T, ctl, primaryH,
    page: F * ratios.page, section: F * ratios.section, title: F * ratios.title,
    lhBody, lhPage: 1.08, lhSection: 1.2, lhTitle: 1.3,
    wBody: clamp(Math.max(400, floor), 400, 700),
    wCtl: clamp(Math.max(500, floor), 500, 700),
    wHead: clamp(Math.max(500, floor), 500, 700),
    wordEm: clamp(finite(fit?.spacing.wordEm, 0), 0, 0.3),
    letterEm: clamp(finite(fit?.spacing.letterEm, 0), 0, 0.15),
    measureCh,
    // Round 6: the round-3 proportions (calmer at large F): bands 3 F apart (2.5 F comfortable), a short first band.
    bandGap: airy ? Math.max(56, 3 * F) : Math.max(48, 2.5 * F),
    headGap: F,
    cardGap: Math.max(20, F),
    cardPad: Math.max(18, F),
    panelPad: Math.max(24, 1.25 * F),
    pillPad: Math.max(20, 1.1 * F),
    fieldPad: Math.max(14, 0.75 * F),
    stripH: stripCtl + 16,
    topPad: Math.max(24, 1.25 * F),
    leadGap: 0.45 * F,
    taskGap: Math.max(24, 1.4 * F),
    fieldGap: Math.max(24, 1.25 * F),
    dockH: Math.max(T, 52, Math.round(F * 2.55)) + 26,
    check: clamp(Math.round(Math.max(26, F * 1.25, T * 0.5)), 26, 44),
    row: Math.max(T, 56, Math.round(F * 2.6)),
    colMax: wideCol,
    tileMin: Math.max(240, 11 * F),
    meta: calmMetaPx(F),
    textCol,
    wideCol,
    measurePx,
    paraGap: 1.1 * F,
    h2Above: 2.25 * F,
    h2Below: 0.75 * F,
    rowPad: F,
    gutter: Math.max(24, 1.5 * F),
    rPic: clamp(0.75 * F, 8, 16),
    formCol: Math.round(36 * F),
    stripCtl,
    stripF: clamp(Math.round(0.82 * F * 10) / 10, 15, 19),
    zoom,
  };
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

export function tokensFor(fit: FitProfile | null, mode: ThemeMode, opts: TokenOptions = {}): Tokens {
  const calm = opts.surface === 'calm';
  const p = paletteFor(fit, mode, calm ? 'calm' : 'chrome');
  const m = calmMetrics(fit, opts);
  const px = (n: number): string => `${r2(n / m.zoom)}px`;
  const tracking = (em: number): string => (m.letterEm > 0 ? `${m.letterEm}em` : `${em}em`);
  return {
    // colour
    canvas: p.canvas, raised: p.raised, tonal: p.tonal, hover: p.hover, press: p.press, well: p.well,
    ink: p.ink, 'ink-2': p.ink2, line: p.line, 'line-strong': p.lineStrong,
    action: p.action, 'on-action': p.onAction, 'action-hover': p.actionHover, link: p.link, badge: p.badge,
    accent: p.accent, 'on-accent': p.onAccent, 'accent-hover': p.accentHover, 'accent-tint': p.accentTint,
    warning: p.warning, 'warning-tint': p.warningTint, success: p.success, 'success-tint': p.successTint,
    focus: p.focus, selection: p.selection, glass: p.glass,
    'shadow-card': p.shadowCard, 'shadow-lift': p.shadowLift, 'shadow-float': p.shadowFloat,
    edge: px(p.edge), 'edge-color': p.edgeColor, 'ctl-edge': px(Math.max(1, p.edge)),
    scheme: p.scheme,
    // type
    font: FONT_TEXT, 'font-display': FONT_DISPLAY,
    f: px(m.F), 'f-page': px(m.page), 'f-section': px(m.section), 'f-title': px(m.title),
    'lh-body': String(m.lhBody), 'lh-page': String(m.lhPage), 'lh-section': String(m.lhSection), 'lh-title': String(m.lhTitle),
    'w-body': String(m.wBody), 'w-ctl': String(m.wCtl), 'w-head': String(m.wHead),
    'tr-page': tracking(-0.02), 'tr-section': tracking(-0.015), 'tr-title': tracking(-0.008),
    'word-sp': `${m.wordEm}em`, 'letter-sp': `${m.letterEm}em`, measure: px(m.measurePx),
    'f-meta': px(m.meta), 'text-col': px(m.textCol), 'wide-col': px(m.wideCol), 'form-col': px(m.formCol),
    'para-gap': px(m.paraGap), 'h2-above': px(m.h2Above), 'h2-below': px(m.h2Below), 'row-pad': px(m.rowPad),
    gutter: px(m.gutter), 'r-pic': px(m.rPic),
    // size and space
    t: px(m.T), ctl: px(m.ctl), 'primary-h': px(m.primaryH), 'pill-pad': px(m.pillPad), 'field-pad': px(m.fieldPad),
    'strip-h': px(m.stripH), 'strip-ctl': px(m.stripCtl), 'strip-f': px(m.stripF), 'top-pad': px(m.topPad), 'lead-gap': px(m.leadGap), 'task-gap': px(m.taskGap),
    'field-gap': px(m.fieldGap), 'dock-h': px(m.dockH), 'band-gap': px(m.bandGap), 'head-gap': px(m.headGap), 'card-gap': px(m.cardGap),
    'card-pad': px(m.cardPad), 'panel-pad': px(m.panelPad), check: px(m.check), row: px(m.row),
    'col-max': px(m.colMax), 'page-max': px(calm ? Math.max(1280, m.wideCol + 2 * m.gutter) : 1280), 'tile-min': px(m.tileMin),
    'side-pad': px(calm ? m.gutter : Math.max(24, m.F)),
    'r-card': px(calm ? 12 : 22), 'r-panel': px(calm ? 16 : 28), 'r-media': px(calm ? m.rPic : 16), 'r-field': px(calm ? 10 : 14),
    'r-small': px(calm ? 8 : 10), 'r-pill': '999px',
    gap: px(Math.max(10, m.F * 0.6)), 'gap-s': px(Math.max(6, m.F * 0.35)), hair: px(1),
    ring: px(mode === 'max' ? 3 : 3), 'chip-h': px(Math.max(40, 1.8 * m.F)), 'f-big': px(1.25 * m.F),
  };
}

export function tokensToCss(t: Tokens, selector = ':host'): string {
  const body = Object.entries(t)
    .map(([k, v]) => `--wa-${k}:${v};`)
    .join('');
  return `${selector}{${body}}`;
}

/** The same tokens as an inline style object (custom properties go through the CSSOM, which page CSP allows). */
export function tokensToStyle(t: Tokens): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) out[`--wa-${k}`] = v;
  return out;
}
