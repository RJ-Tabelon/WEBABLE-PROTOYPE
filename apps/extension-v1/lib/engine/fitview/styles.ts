import type { FitLayout, TypeTier } from '@webable/core';

import { displayStack, fontStack, X_HEIGHT_ADJUST } from './fonts';
import { sectionsCss } from './styles-sections';

/**
 * Fit view styles (docs/12 "Showroom" §4–5): the visual language of
 * apple.com and the Google Store (neutral surfaces, white cards on a grey
 * canvas, soft elevation, pill controls, one blue for actions, size-led
 * type) rescoped to the view's closed shadow root. Fit view re-presents
 * other sites, so it has its own palette; it shares only the fern accent
 * with WebAble's "Made to Measure" (packages/tokens).
 *
 * Every length comes from the person's FitLayout, in CSS px at 100% zoom, and
 * is divided by the live zoom when the sheet is built, so text lands at F
 * device-independent px whatever zoom the tab is at (docs/10 §4.6). The
 * palette is the one the solver picked from the fit (polarity, contrast
 * floor); the OS settings for forced colours and reduced motion still apply
 * on top.
 *
 * Fern marks only WebAble's own controls (the strip's group, notes, folded
 * counts). The site's actions are blue: filled for the one primary action,
 * tonal or blue text for the rest.
 *
 * This sheet owns the tokens, type, page chrome (strip, hero, notes, More)
 * and the shared primitives (buttons, chips, fields, media, reading sheet).
 * Sections and records (cards, rows, grids, drawers, the buy box) are styled
 * by styles-sections.ts, appended below. Custom properties on :host carry
 * the rhythm and radii for it:
 *   --fv-pad (page side padding), --fv-band (between bands),
 *   --fv-head-gap, --fv-card-gap, --fv-card-pad, --fv-pill-pad,
 *   --fv-r-card, --fv-r-panel, --fv-r-media, --fv-r-field,
 *   --fv-edge (1 px, 2 px above standard: fields, hairlines),
 *   --fv-card-edge (0 standard, 1 px more, 2 px max: cards and controls),
 *   --fv-hair (hairline width), --fv-w-em (weight of controls, prices,
 *   badges), --fv-dur (hover transition, 0 ms when motion is reduced).
 */

type Tokens = Readonly<Record<string, string>>;

/** Showroom light and dark (docs/12 §4.1). Colours only; shadows are below. */
export const FV_PALETTES: Readonly<Record<'light' | 'dark', Tokens>> = {
  light: {
    '--canvas': '#F5F5F7',
    '--surface-raised': '#FFFFFF',
    '--surface-tonal': '#E8E8ED',
    '--surface-hover': '#DCDCE1',
    '--surface-press': '#D2D2D7',
    '--well': '#F5F5F7',
    '--ink': '#1D1D1F',
    '--ink-2': '#5E5E63',
    '--line': '#D2D2D7',
    '--line-strong': '#86868B',
    '--action': '#0071E3',
    '--on-action': '#FFFFFF',
    '--action-hover': '#0077ED',
    '--link': '#0066CC',
    '--badge': '#B64400',
    '--accent': '#2D6A3E',
    '--on-accent': '#FFFFFF',
    '--accent-hover': '#22552F',
    '--accent-tint': '#E4EFE6',
    '--warning': '#7A4800',
    '--warning-tint': '#FAEFD9',
    '--focus': '#0071E3',
    '--selection': '#B3D7FF',
    '--glass': 'rgba(255, 255, 255, 0.72)',
  },
  dark: {
    '--canvas': '#000000',
    '--surface-raised': '#1C1C1E',
    '--surface-tonal': '#2C2C2E',
    '--surface-hover': '#3A3A3C',
    '--surface-press': '#48484A',
    '--well': '#2C2C2E',
    '--ink': '#F5F5F7',
    '--ink-2': '#A1A1A6',
    '--line': '#38383A',
    '--line-strong': '#8E8E93',
    '--action': '#0071E3',
    '--on-action': '#FFFFFF',
    '--action-hover': '#0077ED',
    '--link': '#2997FF',
    '--badge': '#FF9F45',
    '--accent': '#8FCB9B',
    '--on-accent': '#0F1A12',
    '--accent-hover': '#A9D9B2',
    '--accent-tint': '#1B2B1F',
    '--warning': '#F2B75E',
    '--warning-tint': '#2E2412',
    '--focus': '#2997FF',
    '--selection': '#1F4E85',
    '--glass': 'rgba(22, 22, 23, 0.78)',
  },
};

/**
 * 'more' contrast: secondary ink becomes ink, hairlines become control
 * edges, and links and the action fill darken (light) or lighten (dark) to
 * about 7:1.
 */
const MORE: Readonly<Record<'light' | 'dark', Tokens>> = {
  light: {
    '--link': '#0040DD',
    '--action': '#0040DD',
    '--action-hover': '#0036BD',
    '--focus': '#0040DD',
  },
  dark: {
    '--link': '#6CB4FF',
    '--action': '#6CB4FF',
    '--on-action': '#000000',
    '--action-hover': '#8CC4FF',
    '--focus': '#6CB4FF',
  },
};

/**
 * 'max' contrast: pure ink on paper with solid edges on cards and controls;
 * radii, spacing and type stay the standard ones. Fern is darkened (light)
 * or lightened (dark) so it keeps >= 7:1 against the canvas.
 */
const MAX: Readonly<Record<'light' | 'dark', Tokens>> = {
  light: {
    '--canvas': '#FFFFFF',
    '--surface-raised': '#FFFFFF',
    '--surface-tonal': '#F0F0F0',
    '--surface-hover': '#E0E0E0',
    '--surface-press': '#D0D0D0',
    '--well': '#FFFFFF',
    '--ink': '#000000',
    '--ink-2': '#000000',
    '--line': '#000000',
    '--line-strong': '#000000',
    '--action': '#0040DD',
    '--on-action': '#FFFFFF',
    '--action-hover': '#0033B3',
    '--link': '#0040DD',
    '--badge': '#8A2E00',
    '--accent': '#1E4D2B',
    '--on-accent': '#FFFFFF',
    '--accent-hover': '#143820',
    '--accent-tint': '#E4EFE6',
    '--warning': '#5C3600',
    '--warning-tint': '#FFFFFF',
    '--focus': '#000000',
    '--selection': '#B3D7FF',
    '--glass': '#FFFFFF',
  },
  dark: {
    '--canvas': '#000000',
    '--surface-raised': '#000000',
    '--surface-tonal': '#1A1A1A',
    '--surface-hover': '#2A2A2A',
    '--surface-press': '#383838',
    '--well': '#1A1A1A',
    '--ink': '#FFFFFF',
    '--ink-2': '#FFFFFF',
    '--line': '#FFFFFF',
    '--line-strong': '#FFFFFF',
    '--action': '#6CB4FF',
    '--on-action': '#000000',
    '--action-hover': '#8CC4FF',
    '--link': '#6CB4FF',
    '--badge': '#FFB366',
    '--accent': '#A9D9B2',
    '--on-accent': '#000000',
    '--accent-hover': '#C3E6CA',
    '--accent-tint': '#0F1F13',
    '--warning': '#FFD08A',
    '--warning-tint': '#000000',
    '--focus': '#FFFFFF',
    '--selection': '#1F4E85',
    '--glass': '#000000',
  },
};

/** One shadow layer: x, y, blur (CSS px at 100%) and black's alpha. */
type Layer = readonly [number, number, number, number];

/** Elevation (docs/12 §4.1). Dark cards are set apart by their surface, not a shadow. */
const SHADOWS: Readonly<
  Record<'light' | 'dark', Record<'card' | 'lift' | 'float', Layer[] | null>>
> = {
  light: {
    card: [
      [0, 1, 2, 0.04],
      [0, 6, 20, 0.06],
    ],
    lift: [
      [0, 2, 4, 0.05],
      [0, 12, 32, 0.1],
    ],
    float: [[0, 12, 40, 0.16]],
  },
  dark: {
    card: null,
    lift: null,
    float: [[0, 12, 40, 0.6]],
  },
};

/**
 * The palette the solver chose: polarity, then the contrast floor. `px`
 * draws the shadow lengths (the sheet passes its zoom-divided px).
 */
export function paletteTokens(
  palette: FitLayout['palette'],
  px: (n: number) => string = (n) => `${n}px`,
): Tokens {
  const scheme = palette.scheme === 'dark' ? 'dark' : 'light';
  const shadow = (layers: Layer[] | null): string =>
    palette.contrast === 'max' || !layers
      ? 'none'
      : layers
          .map(
            ([x, y, b, a]) => `${px(x)} ${px(y)} ${px(b)} rgba(0, 0, 0, ${a})`,
          )
          .join(', ');
  const s = SHADOWS[scheme];
  const shadows = {
    '--shadow-card': shadow(s.card),
    '--shadow-lift': shadow(s.lift),
    '--shadow-float': shadow(s.float),
  };
  if (palette.contrast === 'max') return { ...MAX[scheme], ...shadows };
  const base = FV_PALETTES[scheme];
  if (palette.contrast === 'standard') return { ...base, ...shadows };
  return {
    ...base,
    ...MORE[scheme],
    '--ink-2': base['--ink'] ?? '',
    '--line': base['--line-strong'] ?? '',
    ...shadows,
  };
}

/** Text tiers, largest first. Adjacent pairs must stay distinguishable. */
export const TIER_NAMES = [
  'pageHeading',
  'sectionHeading',
  'title',
  'body',
  'meta',
] as const;
export type TierName = (typeof TIER_NAMES)[number];

/** CSS class carrying each tier. */
export const TIER_CLASS: Readonly<Record<TierName, string>> = {
  pageHeading: 't-page',
  sectionHeading: 't-section',
  title: 't-title',
  body: 't-body',
  meta: 't-meta',
};

/** A page title longer than this is drawn at the section size (an Amazon product name). */
export const LONG_TITLE_CHARS = 70;
/** The h1 class that draws a long page title at the section size. */
export const LONG_TITLE_CLASS = 't-page--long';

const round = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * The size a tier is drawn at. Meta never goes below the person's body size
 * F (docs/11 R9: no text below F); at F it is set apart by its secondary ink,
 * so the view keeps at most five text styles (R8).
 */
export function tierPx(layout: FitLayout, name: TierName): number {
  const t = layout.type;
  return name === 'meta' ? Math.max(t.meta.px, t.body.px) : t[name].px;
}

/**
 * The weight of controls, prices, badges and the site name: 500, or the
 * body weight when the person's floor is heavier (docs/12 §4.2). With body
 * and the three heading tiers this is the fifth text style.
 */
export function emphasisWeight(layout: FitLayout): TypeTier['weight'] {
  return Math.max(500, layout.type.body.weight) as TypeTier['weight'];
}

/** Text −/+ inside the view: one step is about an eighth of the size. */
export const NUDGE_RATIO = 1.125;
/** The furthest the nudges may move text from the solved size. */
export const NUDGE_LIMIT = 4;

/**
 * The layout after `steps` presses of Text − / +, applied on this device at
 * once while the worker records the override (docs/10 §7). Every tier scales by
 * the same factor, so rank order and tier ratios are unchanged; controls grow
 * with their text but never below the hit-area floor, and card widths follow
 * the text (the solver sizes them in multiples of F).
 */
export function nudgeLayout(layout: FitLayout, steps: number): FitLayout {
  const s = Math.max(-NUDGE_LIMIT, Math.min(NUDGE_LIMIT, Math.round(steps)));
  if (s === 0) return layout;
  const f = NUDGE_RATIO ** s;
  const tier = (t: TypeTier): TypeTier => ({
    ...t,
    px: Math.round(t.px * f * 2) / 2,
  });
  const grid = Object.fromEntries(
    Object.entries(layout.grid).map(([k, v]) => [
      k,
      { ...v, minWidthPx: Math.round(v.minWidthPx * f) },
    ]),
  ) as FitLayout['grid'];
  return {
    ...layout,
    type: {
      ...layout.type,
      pageHeading: tier(layout.type.pageHeading),
      sectionHeading: tier(layout.type.sectionHeading),
      title: tier(layout.type.title),
      body: tier(layout.type.body),
      meta: tier(layout.type.meta),
    },
    target: {
      ...layout.target,
      controlPx: Math.max(
        layout.target.minPx,
        Math.round(layout.target.controlPx * f),
      ),
    },
    grid,
  };
}

/**
 * Heading leading (docs/12 §4.2): page 1.08, section 1.14, title 1.25, and
 * never below 1.15 once the person reads with more than 1.5 line height.
 */
export function headingLeading(
  name: 'pageHeading' | 'sectionHeading' | 'title',
  lineHeight: number,
): number {
  const base =
    name === 'pageHeading' ? 1.08 : name === 'sectionHeading' ? 1.14 : 1.25;
  return lineHeight > 1.5 ? Math.max(1.15, base) : base;
}

/** Heading tracking (em), only while the person's letter spacing is 0. */
const TRACKING = {
  pageHeading: -0.022,
  sectionHeading: -0.016,
  title: -0.01,
} as const;

function vars(o: Tokens): string {
  return Object.entries(o)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ');
}

/**
 * The whole view sheet for one layout at one zoom. Rebuilt (replaceSync) when
 * the zoom changes or the person nudges text; it is a few kilobytes.
 */
export function fitViewCss(layout: FitLayout, zoom: number): string {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const px = (n: number): string => `${round(n / z)}px`;
  const t = layout.type;
  const F = t.body.px;
  const T = layout.target.minPx;
  const ctl = Math.max(layout.target.controlPx, T);
  const gap = Math.max(layout.target.gapPx, 8);
  const sp = layout.space;
  const lh = round(Math.max(1.2, t.lineHeight));
  const metaLh = round(Math.max(1.3, lh - 0.1));
  const wEm = emphasisWeight(layout);
  const wStrong = Math.max(600, t.body.weight);
  const tracked = t.letterSpacingEm === 0;
  const contrast = layout.palette.contrast;
  const light = layout.palette.scheme !== 'dark';
  const max = contrast === 'max';
  // Field edges and hairlines; card and control edges only above standard.
  const edge = contrast === 'standard' ? 1 : 2;
  const cardEdge = contrast === 'standard' ? 0 : contrast === 'more' ? 1 : 2;
  const hair = max ? 2 : 1;
  const focusW = contrast === 'standard' ? 3 : 4;
  const reduce = layout.motion === 'reduce';
  const dur = reduce ? '0ms' : '180ms';
  const ease = 'cubic-bezier(0.25, 0.1, 0.25, 1)';
  // Rhythm (docs/12 §4.3), in CSS px at 100%.
  const band = Math.max(64, 4 * F);
  const headGap = Math.max(20, 1.25 * F);
  const cardGap = Math.max(20, F);
  const cardPad = Math.max(20, 1.25 * F);
  const pillPad = Math.max(20, 1.25 * F);
  const sheetPad = Math.max(32, 2 * F);
  const pageW = 1280;
  const measure = `calc(${round(t.maxLineCh)} * 0.5em)`;
  const sidePad = `max(${px(24)}, 4vw, ${px(F)})`;
  const stripH = Math.max(56, T + 12);
  const tier = (name: TierName, k: TypeTier, leading: number): string => {
    const cue =
      k.cue === 'space'
        ? `margin-block-start: ${px(Math.max(1.5 * F, sp.groupGapPx))};`
        : k.cue === 'rule'
          ? `border-block-start: ${px(2)} solid var(--line-strong); padding-block-start: ${px(Math.max(4, sp.unitPx))};`
          : k.cue === 'band'
            ? `background: var(--surface-tonal); padding: ${px(Math.max(4, sp.unitPx / 2))} ${px(sp.unitPx)}; border-radius: ${px(14)};`
            : '';
    const heading = name !== 'body' && name !== 'meta';
    const track =
      heading && tracked
        ? ` letter-spacing: ${TRACKING[name as keyof typeof TRACKING]}em;`
        : '';
    const face = heading ? ` font-family: ${displayStack(t.font)};` : '';
    return `.${TIER_CLASS[name]} { font-size: ${px(tierPx(layout, name))}; font-weight: ${k.weight}; line-height: ${leading};${track}${face} }
.${TIER_CLASS[name]}.cue { ${cue} }`;
  };
  const tokens = paletteTokens(layout.palette, px);
  const r = {
    card: px(22),
    panel: px(28),
    media: px(16),
    field: px(14),
  };

  return `
:host {
  all: initial;
  ${vars(tokens)}
  --fv-gap: ${px(gap)};
  --fv-unit: ${px(sp.unitPx)};
  --fv-ctl: ${px(ctl)};
  --fv-min: ${px(T)};
  --fv-edge: ${px(edge)};
  --fv-card-edge: ${px(cardEdge)};
  --fv-hair: ${px(hair)};
  --fv-pad: ${sidePad};
  --fv-band: min(${px(band)}, 12vh);
  --fv-head-gap: ${px(headGap)};
  --fv-card-gap: ${px(cardGap)};
  --fv-card-pad: ${px(cardPad)};
  --fv-pill-pad: ${px(pillPad)};
  --fv-r-card: ${r.card};
  --fv-r-panel: ${r.panel};
  --fv-r-media: ${r.media};
  --fv-r-field: ${r.field};
  --fv-w-em: ${wEm};
  --fv-dur: ${dur};
  --fv-ease: ${ease};
}
*, *::before, *::after { box-sizing: border-box; }
dialog.fv {
  position: fixed; inset: 0;
  width: 100%; height: 100%; max-width: none; max-height: none;
  margin: 0; padding: 0; border: 0; overflow: hidden;
  background: var(--canvas); color: var(--ink);
  color-scheme: ${layout.palette.scheme};
  pointer-events: auto;
  font-family: ${fontStack(t.font)};
  font-size-adjust: ex-height ${X_HEIGHT_ADJUST};
  font-size: ${px(F)}; font-weight: ${t.body.weight}; line-height: ${lh};
  word-spacing: ${round(t.wordSpacingEm)}em;
  letter-spacing: ${round(t.letterSpacingEm)}em;
  text-align: start; text-transform: none; font-style: normal;
  -webkit-font-smoothing: antialiased;
  -webkit-text-size-adjust: none; text-size-adjust: none;
  overflow-wrap: anywhere;
}
dialog.fv:not([open]) { display: none; }
dialog.fv::backdrop { background: var(--canvas); }
::selection { background: var(--selection); color: var(--ink); }
.fv-scroller {
  position: absolute; inset: 0;
  overflow: auto; overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.fv-page {
  width: 100%; max-width: ${px(pageW)};
  margin-inline: auto; padding-inline: var(--fv-pad);
  padding-block-end: var(--fv-band);
}
.fv-sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
}
h1, h2, h3, h4, p, ul, ol, li, figure, blockquote, pre, table, fieldset, legend, dl, dd { margin: 0; padding: 0; }
ul.fv-plain, ol.fv-plain { list-style: none; }
img { display: block; max-width: 100%; }
strong, b { font-weight: ${wStrong}; }

/* ---------- Type tiers (FitLayout.type, docs/12 §4.2) ---------- */
${tier('pageHeading', t.pageHeading, headingLeading('pageHeading', lh))}
${tier('sectionHeading', t.sectionHeading, headingLeading('sectionHeading', lh))}
${tier('title', t.title, headingLeading('title', lh))}
${tier('body', t.body, lh)}
${tier('meta', t.meta, metaLh)}
.t-meta { color: var(--ink-2); }
/* A long page title stays the h1, drawn at the section size. */
.t-page.${LONG_TITLE_CLASS} { font-size: ${px(t.sectionHeading.px)}; line-height: ${headingLeading('sectionHeading', lh)};${tracked ? ` letter-spacing: ${TRACKING.sectionHeading}em;` : ''} }
.fv-strong { font-weight: ${wEm}; }

/* ---------- Skip link ---------- */
.fv-skip {
  position: absolute; inset-inline-start: var(--fv-pad); top: ${px(sp.unitPx)}; z-index: 5;
  transform: translateY(-200%);
}
.fv-skip:focus-visible { transform: none; }

/* ---------- Strip: sticky, frosted (docs/12 §5) ---------- */
.fv-strip { position: relative; z-index: 3; pointer-events: none; }
.fv-strip > * { pointer-events: auto; }
.fv-strip.is-sticky { position: sticky; top: 0; }
.fv-strip__bar {
  background: var(--glass);
  ${max ? '' : '-webkit-backdrop-filter: saturate(180%) blur(20px); backdrop-filter: saturate(180%) blur(20px);'}
  border-block-end: var(--fv-hair) solid var(--line);
}
.fv-strip.fv-tight .fv-strip__inner { padding-block: ${px(2)}; gap: ${px(4)}; }
.fv-strip__inner {
  position: relative;
  width: 100%; max-width: ${px(pageW)}; margin-inline: auto;
  padding: ${px(6)} var(--fv-pad);
  display: flex; flex-direction: column; gap: ${px(8)};
}
.fv-strip__row {
  display: flex; flex-wrap: wrap; align-items: center;
  min-height: ${px(stripH - 12)};
  column-gap: ${px(Math.max(12, gap))}; row-gap: ${px(6)};
}
.fv-site { display: inline-flex; flex-wrap: wrap; align-items: center; gap: ${px(4)} ${px(10)}; min-width: 0; }
.fv-site__name { font-weight: ${wEm}; }
.fv-strip__row > .fv-search { flex: 1 1 ${px(14 * F)}; min-width: min(100%, ${px(9 * F)}); max-width: ${px(Math.max(560, 30 * F))}; }
.fv-strip__row > .fv-wa-controls { margin-inline-start: auto; }
.fv-strip .fv-btn, .fv-strip .fv-wa { white-space: nowrap; }
.fv-wa-controls { display: flex; flex-wrap: wrap; align-items: center; gap: ${px(8)}; }
/* Text − / Text +: one segmented tonal pill. */
.fv-seg {
  display: inline-flex; align-items: stretch; flex: none;
  border-radius: 999px; background: var(--surface-tonal);
  border: var(--fv-card-edge) solid var(--line-strong);
}
.fv-seg > .fv-wa { background: transparent; border: 0; padding-inline: max(${px(14)}, 0.85em); position: relative; }
.fv-seg > .fv-wa + .fv-wa::before {
  content: ''; position: absolute; inset-inline-start: 0; inset-block: 25%;
  width: var(--fv-hair); background: var(--line-strong);
}
.fv-insecure {
  display: inline-flex; align-items: center;
  padding: 0 ${px(10)}; border-radius: 999px;
  background: var(--warning-tint); color: var(--warning);
  border: var(--fv-card-edge) solid var(--warning);
  font-weight: ${wEm};
}

/* ---------- The site's search: a pill field ---------- */
.fv-search { display: flex; flex-wrap: nowrap; gap: ${px(8)}; align-items: center; min-width: 0; }
.fv-search__field { position: relative; flex: 1 1 auto; min-width: 0; display: flex; }
.fv-search__icon {
  position: absolute; inset-inline-start: max(${px(14)}, 0.8em); top: 50%;
  width: 1.05em; height: 1.05em; transform: translateY(-50%);
  fill: none; stroke: var(--ink-2); stroke-width: 2; stroke-linecap: round;
  pointer-events: none;
}
.fv-search .fv-input {
  flex: 1 1 auto; min-width: 0;
  border-radius: 999px; background: var(--surface-tonal);
  border-width: var(--fv-card-edge);
  padding-inline: calc(max(${px(14)}, 0.8em) + 1.6em) max(${px(16)}, 0.9em);
}
.fv-search .fv-input:focus { box-shadow: inset 0 0 0 ${px(2)} var(--focus); }

/* ---------- More (the strip's other controls, WebAble's switches) ---------- */
.fv-more {
  position: absolute; z-index: 4; top: calc(100% + ${px(8)}); inset-inline-end: var(--fv-pad);
  width: min(${px(26 * F)}, calc(100% - 2 * var(--fv-pad)));
  max-height: 70vh; overflow: auto; overscroll-behavior: contain;
  padding: ${px(Math.max(16, sp.unitPx))};
  display: flex; flex-direction: column; gap: ${px(Math.max(12, sp.unitPx))};
  background: var(--surface-raised); color: var(--ink);
  border: var(--fv-card-edge) solid var(--line-strong); border-radius: ${r.card};
  box-shadow: var(--shadow-float);
}
.fv-more[hidden] { display: none; }
.fv-more__group { display: flex; flex-direction: column; gap: ${px(8)}; }
.fv-more__group + .fv-more__group { border-block-start: var(--fv-hair) solid var(--line); padding-block-start: ${px(Math.max(12, sp.unitPx))}; }
.fv-more .fv-row-pills { gap: ${px(8)}; }
.fv-switch {
  appearance: none; margin: 0; cursor: pointer;
  display: flex; align-items: center; justify-content: space-between; gap: var(--fv-gap);
  width: 100%; min-height: var(--fv-ctl); min-width: var(--fv-min);
  padding: ${px(4)} ${px(Math.max(14, sp.unitPx))};
  border: var(--fv-card-edge) solid var(--line-strong); border-radius: ${r.field};
  background: var(--surface-tonal); color: var(--ink);
  font: inherit; font-weight: ${wEm}; letter-spacing: inherit; word-spacing: inherit; text-align: start;
  transition: background-color var(--fv-dur) var(--fv-ease);
}
.fv-switch__track {
  flex: none; position: relative; width: 2.3em; height: 1.35em; border-radius: 999px;
  background: var(--line-strong);
  border: var(--fv-card-edge) solid var(--ink);
  transition: background-color var(--fv-dur) var(--fv-ease);
}
.fv-switch__track::after {
  content: ''; position: absolute; top: 50%; inset-inline-start: 0.12em;
  width: 1.1em; height: 1.1em; border-radius: 50%; transform: translateY(-50%);
  background: #FFFFFF; box-shadow: 0 ${px(1)} ${px(3)} rgba(0, 0, 0, 0.2);
}
.fv-switch[aria-checked="true"] .fv-switch__track { background: var(--accent); }
.fv-switch[aria-checked="true"] .fv-switch__track::after { inset-inline-start: auto; inset-inline-end: 0.12em; background: var(--on-accent); }

/* ---------- WebAble notes: floating cards with a fern dot ---------- */
/* On the canvas under the bar; while the strip is stuck they float over the
   page, and only the cards take the pointer. */
.fv-strip > .fv-notes {
  width: 100%; max-width: ${px(pageW)}; margin-inline: auto;
  padding: ${px(12)} var(--fv-pad) 0;
  display: flex; flex-direction: column; align-items: flex-end; gap: ${px(8)};
  pointer-events: none;
}
.fv-notes > *, .fv-status > * { pointer-events: auto; }
.fv-notes:not(:has(> :not([hidden]))) { display: none; }
.fv-intro, .fv-offer, .fv-notice, .fv-status__line {
  display: flex; flex-wrap: wrap; align-items: center; gap: ${px(8)} ${px(Math.max(12, gap))};
  width: fit-content; max-width: min(100%, ${px(Math.max(520, 34 * F))});
  padding: ${px(Math.max(10, sp.unitPx * 0.6))} ${px(Math.max(16, sp.unitPx))};
  border-radius: ${r.card};
  background: var(--surface-raised); color: var(--ink);
  border: var(--fv-card-edge) solid var(--line-strong);
  box-shadow: var(--shadow-float);
}
.fv-intro::before, .fv-offer::before, .fv-notice::before, .fv-status__line::before {
  content: ''; flex: none; width: 0.55em; height: 0.55em; border-radius: 50%;
  background: var(--accent);
}
.fv-intro > p, .fv-offer > p, .fv-status__line > p { flex: 1 1 ${px(12 * F)}; min-width: 0; }
.fv-intro[hidden], .fv-offer[hidden], .fv-notice[hidden], .fv-status[hidden] { display: none; }
.fv-status { display: flex; flex-direction: column; align-items: flex-end; gap: ${px(8)}; }

/* ---------- Hero: the page's title and its line (docs/11 R1) ---------- */
.fv-orient {
  display: flex; flex-direction: column; align-items: flex-start;
  gap: ${px(Math.max(8, 0.5 * F))};
  padding-block-start: min(${px(Math.max(32, 2 * F))}, 8vh);
}
.fv-orient > h1 { margin: 0; max-width: 100%; }
.fv-orient > .fv-pageline { max-width: ${measure}; }
.fv-orient.fv-tight { padding-block-start: ${px(sp.unitPx)}; gap: ${px(4)}; }
/* Articles: the hero sits on the reading sheet's column. */
main.fv-main:has(.fv-article) > .fv-orient[data-layout="reading"] {
  width: 100%; max-width: calc(${measure} + 2 * max(${px(16)}, min(${px(sheetPad)}, 6vw)));
  margin-inline: auto; padding-inline: max(${px(16)}, min(${px(sheetPad)}, 6vw));
}
.fv-hero { display: flex; flex-wrap: wrap; align-items: center; gap: ${px(8)} ${px(Math.max(12, gap))}; }
.fv-hero > p { margin: 0; }

/* ---------- Layout helpers ---------- */
main.fv-main { display: block; outline: none; }
.fv-stack { display: flex; flex-direction: column; gap: ${px(Math.max(12, sp.unitPx))}; }
.fv-stack > * { min-width: 0; }
.fv-group { display: flex; flex-direction: column; gap: ${px(Math.max(12, sp.unitPx))}; }
.fv-heading { margin-block-start: ${px(sp.unitPx)}; }
.fv-text { max-width: ${measure}; }
.fv-collapsed[hidden] { display: none; }
.fv-row-pills { display: flex; flex-wrap: wrap; gap: ${px(Math.max(8, gap))}; align-items: center; }
.fv-row-pills > li { display: flex; max-width: 100%; }
.fv-links { display: flex; flex-direction: column; gap: ${px(4)}; align-items: flex-start; }
.fv-links > li { display: flex; max-width: 100%; }
.fv-meta { display: flex; flex-wrap: wrap; column-gap: ${px(sp.unitPx)}; row-gap: 0; align-items: baseline; }
.fv-actions { display: flex; flex-wrap: wrap; gap: ${px(Math.max(8, gap))}; align-items: center; }
.fv-sep { color: var(--ink-2); white-space: pre; }
/* A link in a line of facts is a target of its own (health checks it). */
:is(.fv-meta, .fv-facts, .fv-rating) a.fv-inline { display: inline-flex; align-items: center; min-height: var(--fv-min); min-width: var(--fv-min); }

/* ---------- Reading sheet (docs/12 §5 Reading) ---------- */
.fv-article {
  width: 100%; max-width: calc(${measure} + 2 * max(${px(16)}, min(${px(sheetPad)}, 6vw)));
  margin-inline: auto;
  padding: max(${px(16)}, min(${px(sheetPad)}, 6vw));
  display: flex; flex-direction: column; gap: ${px(Math.max(16, F))};
  background: var(--surface-raised); color: var(--ink);
  border-radius: ${r.panel};
  border: var(--fv-card-edge) solid var(--line-strong);
  box-shadow: var(--shadow-card);
}
.fv-prose { max-width: ${measure}; display: flex; flex-direction: column; gap: ${round(Math.max(1, lh - 0.4))}em; }
.fv-prose ul, .fv-prose ol { padding-inline-start: 1.4em; display: flex; flex-direction: column; gap: ${px(sp.unitPx / 2)}; }
.fv-prose blockquote { border-inline-start: ${px(3)} solid var(--line-strong); padding-inline-start: ${px(Math.max(16, sp.unitPx))}; color: var(--ink); }
.fv-prose pre { overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: ${px(Math.max(16, sp.unitPx))}; background: var(--surface-tonal); border-radius: ${r.field}; }
.fv-prose code, .fv-prose pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 1em; }
.fv-prose figure { display: flex; flex-direction: column; gap: ${px(8)}; }
.fv-prose figure .fv-thumb, .fv-prose figure img { border-radius: ${r.media}; height: auto; }
.fv-prose figcaption { color: var(--ink-2); }
.fv-prose h2, .fv-prose h3, .fv-prose h4 { margin-block-start: ${px(Math.max(16, F))}; }
/* Superscripts and subscripts stay at the person's size (no text below F). */
.fv-prose sup, .fv-prose sub { font-size: 1em; line-height: 0; }
.fv-prose sup { vertical-align: 0.4em; }
.fv-prose sub { vertical-align: -0.25em; }
/* A link that is a line of its own is a target, not a word in a sentence. */
a.fv-solo { display: inline-flex; align-items: center; min-height: var(--fv-min); min-width: var(--fv-min); }
/* Short lines that sat side by side read as one line of text again. */
.fv-prose .fv-lines { margin: 0; }
.fv-prose .fv-lines > * { display: inline; margin: 0 ${px(sp.unitPx * 1.5)} 0 0; }
.fv-prose .fv-lines > a.fv-solo, .fv-prose .fv-lines > .fv-btn { display: inline-flex; vertical-align: baseline; }
.fv-table-wrap { max-width: 100%; overflow-x: auto; }
.fv-table { border-collapse: collapse; min-width: 50%; }
.fv-table th, .fv-table td {
  text-align: start; vertical-align: top;
  padding: ${px(sp.unitPx / 2)} ${px(sp.unitPx)};
  border-block-end: var(--fv-hair) solid var(--line);
}
.fv-table th { font-weight: ${wEm}; }
a.fv-inline { color: var(--link); text-decoration: underline; text-underline-offset: 0.18em; text-decoration-thickness: max(1px, 0.06em); }
a.fv-inline:hover { text-decoration-thickness: 0.12em; }

/* ---------- On this page: a tonal card of blue links (docs/11 R6) ---------- */
.fv-outline {
  display: flex; flex-direction: column; align-items: flex-start; gap: ${px(4)};
  padding: ${px(cardPad * 0.8)} ${px(cardPad)};
  border-radius: ${r.card};
  background: var(--surface-tonal);
  border: var(--fv-card-edge) solid var(--line-strong);
}
.fv-outline > h2 { margin-block-end: ${px(4)}; }
.fv-outline ol { list-style: none; display: flex; flex-direction: column; gap: 0; }
.fv-outline ol[hidden] { display: none; }
.fv-outline > .fv-wa { margin-block-start: ${px(8)}; }
.fv-jump {
  appearance: none; margin: 0; padding: 0; border: 0; background: none; cursor: pointer;
  display: inline-flex; align-items: center; min-height: var(--fv-min); min-width: var(--fv-min);
  font: inherit; color: var(--link); text-align: start; letter-spacing: inherit; word-spacing: inherit;
  text-decoration: ${max ? 'underline' : 'none'}; text-underline-offset: 0.18em;
}
.fv-jump:hover { text-decoration: underline; }

/* ---------- Controls: pills (docs/12 §5) ---------- */
.fv-btn, .fv-pill, .fv-wa {
  appearance: none; margin: 0;
  display: inline-flex; align-items: center; justify-content: center; gap: 0.35em;
  min-height: var(--fv-ctl); min-width: var(--fv-min);
  padding: ${px(4)} var(--fv-pill-pad);
  border-radius: 999px; border: var(--fv-card-edge) solid var(--line-strong);
  background: var(--surface-tonal); color: var(--ink);
  font: inherit; font-size: ${px(F)}; font-weight: ${wEm}; line-height: 1.25; letter-spacing: inherit; word-spacing: inherit;
  text-align: center; text-decoration: none; cursor: pointer;
  max-width: 100%; overflow-wrap: anywhere;
  transition: background-color var(--fv-dur) var(--fv-ease), color var(--fv-dur) var(--fv-ease), border-color var(--fv-dur) var(--fv-ease);
}
/* The site's one primary action: the blue pill. */
.fv-btn--fill { background: var(--action); color: var(--on-action); border-color: var(--action); }
/* Other text actions: blue words and a chevron, no fill, still a full target. */
.fv-btn--link, .fv-btn--quiet {
  background: transparent; border-color: transparent; color: var(--link);
  padding-inline: ${px(4)}; justify-content: flex-start; gap: 0.2em;
  ${max ? 'text-decoration: underline; text-underline-offset: 0.18em;' : ''}
}
.fv-btn--quiet { font-weight: ${t.body.weight}; }
/* Round icon buttons: a state toggle (a star), an overflow menu (⋯). */
.fv-btn--icon, .fv-toggle { padding: 0; width: var(--fv-ctl); min-width: var(--fv-ctl); border-radius: 999px; flex: none; }
.fv-btn--long { justify-content: flex-start; text-align: start; border-radius: ${r.field}; }
.fv-btn--small { flex: none; }
/* In a column, a control is as wide as its words, never stretched. */
:is(.fv-stack, .fv-product, .fv-prose, .fv-group, .fv-rec__body) > :is(.fv-btn, .fv-pill, .fv-wa, a.fv-row-link, .fv-check) { align-self: flex-start; }
/* Chips: selected is filled ink. */
.fv-pill[aria-current]:not([aria-current="false"]), .fv-pill[aria-pressed="true"], .fv-pill[aria-selected="true"] {
  background: var(--ink); color: var(--canvas); border-color: var(--ink);
}
/* WebAble's own controls: fern. */
.fv-wa { background: var(--accent-tint); color: var(--accent); border-color: var(--accent); }
.fv-wa--fill { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.fv-wa--ghost { background: transparent; border-color: ${cardEdge ? 'var(--accent)' : 'transparent'}; padding-inline: max(${px(14)}, 0.85em); }
a.fv-row-link {
  display: inline-flex; align-items: center; justify-content: flex-start;
  min-height: var(--fv-ctl); min-width: var(--fv-min); max-width: 100%;
  padding: ${px(2)} 0;
  color: var(--link); text-align: start; text-decoration: ${max ? 'underline' : 'none'};
  text-underline-offset: 0.18em; font-weight: ${t.body.weight};
}
a.fv-row-link:hover { text-decoration: underline; }
.fv-btn[disabled], .fv-btn[aria-disabled="true"], .fv-pill[aria-disabled="true"] { opacity: 0.5; cursor: default; }
@media (hover: hover) and (pointer: fine) {
  .fv-btn:hover, .fv-pill:hover, .fv-seg > .fv-wa:hover { background: var(--surface-hover); }
  .fv-btn--fill:hover { background: var(--action-hover); border-color: var(--action-hover); }
  .fv-btn--link:hover, .fv-btn--quiet:hover { background: transparent; text-decoration: underline; text-underline-offset: 0.18em; }
  .fv-pill[aria-current]:not([aria-current="false"]):hover, .fv-pill[aria-pressed="true"]:hover, .fv-pill[aria-selected="true"]:hover { background: var(--ink); }
  .fv-wa:hover { background: color-mix(in srgb, var(--accent) 12%, var(--accent-tint)); }
  .fv-wa--ghost:hover { background: var(--accent-tint); }
  .fv-wa--fill:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
}
.fv-btn:active, .fv-pill:active { background: var(--surface-press); }
.fv-btn--fill:active { background: var(--action); filter: brightness(0.92); }
.fv-chev { width: 0.7em; height: 0.7em; flex: none; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; transition: transform var(--fv-dur) var(--fv-ease); }
.fv-chev:dir(rtl):not(.fv-chev--down) { transform: scaleX(-1); }
[aria-expanded="true"] > .fv-chev--down { transform: rotate(180deg); }
.fv-icon { width: 1.3em; height: 1.3em; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linejoin: round; stroke-linecap: round; }
.fv-icon--dots { stroke-width: 3.4; }
.fv-toggle[aria-pressed="true"] .fv-icon { fill: currentColor; }

/* ---------- Fields ---------- */
.fv-field { display: flex; flex-direction: column; gap: ${px(6)}; max-width: calc(${round(Math.max(t.maxLineCh, 30))} * 0.5em); }
.fv-label { font-weight: ${wEm}; }
.fv-input {
  appearance: none; margin: 0;
  min-height: var(--fv-ctl); min-width: var(--fv-min); width: 100%;
  padding: ${px(4)} max(${px(14)}, 0.8em);
  border: var(--fv-edge) solid var(--line-strong); border-radius: ${r.field};
  background: var(--surface-raised); color: var(--ink);
  font: inherit; letter-spacing: inherit; word-spacing: inherit;
  transition: border-color var(--fv-dur) var(--fv-ease), box-shadow var(--fv-dur) var(--fv-ease);
}
/* Focus: a 2 px focus edge (no layout shift), plus the ring. */
.fv-input:focus { border-color: var(--focus); box-shadow: inset 0 0 0 ${px(Math.max(0, 2 - edge))} var(--focus); }
textarea.fv-input { min-height: calc(var(--fv-ctl) * 2.5); resize: vertical; }
.fv-select { position: relative; display: flex; }
select.fv-input { padding-inline-end: 2.4em; background-image: none; cursor: pointer; }
.fv-select > .fv-chev { position: absolute; inset-inline-end: max(${px(14)}, 0.8em); top: 50%; margin-top: -0.35em; pointer-events: none; color: var(--ink-2); }
.fv-input::placeholder { color: var(--ink-2); opacity: 1; }
.fv-check {
  position: relative;
  display: flex; align-items: center; gap: ${px(Math.max(10, sp.unitPx * 0.75))};
  width: fit-content; max-width: 100%;
  min-height: var(--fv-ctl); min-width: var(--fv-min);
  padding: ${px(4)} max(${px(14)}, 0.8em);
  border-radius: ${r.field}; border: var(--fv-edge) solid var(--line-strong);
  background: var(--surface-raised); cursor: pointer;
}
.fv-check input { margin: 0; width: 1.1em; height: 1.1em; flex: none; accent-color: var(--action); }
.fv-options { border: 0; display: flex; flex-direction: column; gap: ${px(8)}; min-width: 0; }
.fv-options > legend { font-weight: ${wEm}; margin-block-end: ${px(8)}; }
/* A radio set: tonal pills, the chosen one filled ink. */
.fv-options__list { display: flex; flex-wrap: wrap; gap: ${px(8)}; }
.fv-options__list > .fv-check {
  border-radius: 999px; border: var(--fv-card-edge) solid var(--line-strong);
  background: var(--surface-tonal); padding-inline: var(--fv-pill-pad);
  font-weight: ${wEm};
  transition: background-color var(--fv-dur) var(--fv-ease), color var(--fv-dur) var(--fv-ease);
}
.fv-options__list > .fv-check > input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.fv-options__list > .fv-check:has(> input:checked) { background: var(--ink); color: var(--canvas); border-color: var(--ink); }
.fv-options__list > .fv-check:has(> input:disabled) { opacity: 0.5; cursor: default; }
.fv-options__list > .fv-check:has(> input:focus-visible) { outline: ${px(focusW)} solid var(--focus); outline-offset: ${px(2)}; }
@media (hover: hover) and (pointer: fine) {
  .fv-options__list > .fv-check:not(:has(> input:checked)):hover { background: var(--surface-hover); }
}

/* ---------- Disclosures (WebAble's own, fern) ---------- */
.fv-disclosure { display: flex; flex-direction: column; gap: ${px(Math.max(12, sp.unitPx))}; }
.fv-disclosure__bar { display: flex; flex-wrap: wrap; align-items: center; gap: ${px(8)} var(--fv-gap); }
.fv-disclosure__count { color: var(--ink-2); }

/* ---------- Media (docs/12 §5 Media) ---------- */
.fv-thumb {
  position: relative; width: 100%; overflow: hidden;
  aspect-ratio: var(--fv-ar, 16 / 9);
  border-radius: ${r.media};
  background: var(--well);
}
.fv-thumb > img { width: 100%; height: 100%; object-fit: cover; }
/* Products and images: the whole picture in a soft well. */
.fv-thumb--contain > img { object-fit: contain; padding: 8%; ${light && !max ? 'mix-blend-mode: multiply;' : ''} }
${
  light
    ? ''
    : /* Product shots are drawn on white: in the dark a soft light well lets
         picture and well read as one tile, not a white box on grey. */
      `.fv-thumb--contain { background: #E8E8ED; }
.fv-thumb--contain > img { mix-blend-mode: multiply; }`
}
.fv-thumb-open, .fv-thumb--open { display: block; border-radius: ${r.media}; cursor: pointer; }
.fv-badge { display: inline-flex; align-items: center; color: var(--badge); font-size: ${px(F)}; font-weight: ${wEm}; }
/* The duration badge, bottom-right on the picture. */
.fv-thumb .fv-badge {
  position: absolute; inset-inline-end: ${px(8)}; inset-block-end: ${px(8)};
  padding: ${px(1)} ${px(8)}; border-radius: ${px(8)};
  background: rgba(0, 0, 0, 0.72); color: #FFFFFF; line-height: 1.3;
}

/* ---------- "Use this on the page" and quiet lines ---------- */
.fv-onpage {
  display: flex; flex-wrap: wrap; align-items: center; gap: ${px(8)} var(--fv-gap);
  padding: ${px(cardPad * 0.8)} ${px(cardPad)};
  border-radius: ${r.media};
  background: var(--surface-raised);
  border: var(--fv-card-edge) solid var(--line-strong);
  box-shadow: var(--shadow-card);
}
.fv-onpage__label { flex: 1 1 ${px(10 * F)}; min-width: 0; }
.fv-quiet { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: ${px(4)} ${px(sp.unitPx)}; color: var(--ink-2); }
/* A control whose name is a paragraph: the words, then a small button. */
.fv-longctl { display: flex; flex-wrap: wrap; align-items: center; gap: var(--fv-gap); }
.fv-longctl__text { flex: 1 1 ${px(12 * F)}; min-width: 0; margin: 0; }

/* ---------- Sheet (mirrored menus and listboxes) ---------- */
.fv-sheet {
  position: fixed; z-index: 6;
  max-height: min(70vh, ${px(12 * ctl)}); overflow: auto; overscroll-behavior: contain;
  min-width: min(${px(14 * F)}, calc(100vw - ${px(2 * sp.pagePadPx)}));
  max-width: calc(100vw - ${px(2 * sp.pagePadPx)});
  padding: ${px(8)};
  border-radius: ${r.card};
  background: var(--surface-raised); color: var(--ink);
  border: var(--fv-card-edge) solid var(--line-strong);
  box-shadow: var(--shadow-float);
  display: flex; flex-direction: column; gap: ${px(2)};
}
.fv-sheet[hidden] { display: none; }
.fv-sheet__opt {
  appearance: none; margin: 0; display: flex; align-items: center; justify-content: space-between; gap: var(--fv-gap);
  width: 100%; min-height: var(--fv-ctl); min-width: var(--fv-min);
  padding: ${px(2)} max(${px(14)}, 0.8em);
  border: 0; border-radius: ${px(12)};
  background: transparent; color: var(--ink);
  font: inherit; font-weight: ${wEm}; text-align: start; cursor: pointer; letter-spacing: inherit; word-spacing: inherit;
}
.fv-sheet__opt[aria-current="true"] { background: var(--surface-tonal); }
.fv-sheet__opt[aria-current="true"]::after {
  content: ''; flex: none; width: 0.35em; height: 0.7em; margin-inline-end: 0.2em;
  border-inline-end: ${px(2.5)} solid var(--link); border-block-end: ${px(2.5)} solid var(--link);
  transform: translateY(-15%) rotate(45deg);
}
.fv-sheet__opt:hover, .fv-sheet__opt:focus-visible { background: var(--surface-hover); }

/* ---------- Loading, peek ---------- */
.fv-loading {
  position: fixed; inset-inline: 0; top: 0; z-index: 7;
  display: flex; justify-content: center; pointer-events: none;
}
.fv-loading[hidden] { display: none; }
.fv-loading__pill {
  margin-top: ${px(Math.max(12, sp.unitPx))};
  padding: ${px(8)} ${px(pillPad)};
  border-radius: 999px; background: var(--surface-raised); color: var(--ink); font-weight: ${wEm};
  border: var(--fv-card-edge) solid var(--line-strong);
  box-shadow: var(--shadow-float);
}
main.fv-main[aria-busy="true"] { opacity: 0.55; }
.fv-peek {
  position: fixed; inset: auto auto ${px(24)} 50%; transform: translateX(-50%);
  pointer-events: auto;
  margin: 0; padding: 0; border: 0; overflow: visible; background: transparent;
  font-family: ${fontStack(t.font)};
  font-size-adjust: ex-height ${X_HEIGHT_ADJUST};
  font-size: ${px(F)}; line-height: 1.2; color: var(--ink);
  color-scheme: ${layout.palette.scheme};
}
.fv-peek:not(:popover-open) { display: none; }
.fv-peek .fv-wa { box-shadow: var(--shadow-float); }

/* ---------- Sections and records (styles-sections.ts) ---------- */
${sectionsCss({ layout, px, F, T, ctl, gap, reduce })}

/* ---------- Focus ---------- */
:focus { outline: none; }
:focus-visible {
  outline: ${px(focusW)} solid var(--focus);
  outline-offset: ${px(2)};
}
/* Focus the view moves itself (on open, after "Show n more") draws no ring
   until the keyboard is in use (host.ts sets is-kbd on the first key). */
dialog.fv:not(.is-kbd) :focus-visible { outline: none; }
dialog.fv:not(.is-kbd) .fv-options__list > .fv-check:has(> input:focus-visible) { outline: none; }
/* <main> takes focus on open (screen readers start at the content); it is not a control. */
main.fv-main:focus, main.fv-main:focus-visible { outline: none; }

/* ---------- Reduced motion (the fit, or the OS) ---------- */
${reduce ? '* { transition: none !important; animation: none !important; }' : ''}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
  :host { --fv-dur: 0ms; }
}

/* ---------- Forced colours (Windows contrast themes) ---------- */
@media (forced-colors: active) {
  dialog.fv, dialog.fv::backdrop { background: Canvas; color: CanvasText; }
  .fv-strip__bar { backdrop-filter: none; border-block-end: 1px solid CanvasText; }
  .fv-btn, .fv-pill, .fv-wa, .fv-seg, .fv-input, .fv-check, .fv-switch, .fv-sheet__opt { border: 1px solid ButtonText; }
  .fv-seg > .fv-wa { border: 0; }
  .fv-btn--link, .fv-btn--quiet { border-color: transparent; color: LinkText; text-decoration: underline; }
  a.fv-row-link, a.fv-inline, .fv-jump { color: LinkText; }
  .fv-pill[aria-current]:not([aria-current="false"]), .fv-pill[aria-pressed="true"], .fv-pill[aria-selected="true"], .fv-options__list > .fv-check:has(> input:checked), .fv-wa--fill, .fv-btn--fill {
    forced-color-adjust: none; background: Highlight; color: HighlightText; border-color: Highlight;
  }
  .fv-switch[aria-checked="true"] .fv-switch__track { forced-color-adjust: none; background: Highlight; }
  .fv-onpage, .fv-intro, .fv-offer, .fv-notice, .fv-status__line, .fv-sheet, .fv-more, .fv-article, .fv-outline, .fv-loading__pill, .fv-insecure { border: 1px solid CanvasText; }
  .fv-intro::before, .fv-offer::before, .fv-notice::before, .fv-status__line::before { forced-color-adjust: none; background: CanvasText; }
  .fv-thumb .fv-badge { forced-color-adjust: none; background: Canvas; color: CanvasText; border: 1px solid CanvasText; }
  .fv-search__icon { stroke: CanvasText; }
  :focus-visible { outline-color: Highlight; }
  .fv-options__list > .fv-check:has(> input:focus-visible) { outline-color: Highlight; }
}
`;
}
