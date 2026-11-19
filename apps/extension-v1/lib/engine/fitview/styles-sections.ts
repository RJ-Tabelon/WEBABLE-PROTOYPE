import type { FitLayout } from '@webable/core';

/**
 * Showroom styles for sections and records (docs/12 §5–6): section heads,
 * card grids and card templates, grouped row lists, the buy box, spotlight
 * panels, link grids, form panels, menus and drawers. `fitViewCss`
 * (styles.ts) appends this to the view sheet; tokens, type tiers and the
 * shared primitives (buttons, chips, inputs, media boxes) live there.
 *
 * Rhythm, radii, edges and the emphasis weight come from the custom
 * properties styles.ts sets on :host (--fv-band, --fv-head-gap,
 * --fv-card-gap, --fv-card-pad, --fv-r-card, --fv-r-panel, --fv-r-media,
 * --fv-card-edge, --fv-hair, --fv-w-em, --fv-dur, --fv-ease); every other
 * length is CSS px at 100% zoom through `px`. Text is drawn only in the five
 * styles of §4.2 (the tier classes, and body at --fv-w-em): no rule here sets
 * a font size.
 */
export interface SheetContext {
  layout: FitLayout;
  /** CSS px at 100% zoom -> a length at the live zoom. */
  px: (n: number) => string;
  /** Body size F, hit-area floor T, control height, gap (all CSS px at 100%). */
  F: number;
  T: number;
  ctl: number;
  gap: number;
  reduce: boolean;
}

/** Below this content width (CSS px at 100%) the buy box and spotlights stack. */
export const WIDE_PX = 900;

export function sectionsCss(ctx: SheetContext): string {
  const { layout, px, F, reduce } = ctx;
  const t = layout.type;
  const max = layout.palette.contrast === 'max';
  const measure = `calc(${Math.round(t.maxLineCh * 1000) / 1000} * 0.5em)`;
  const wide = px(WIDE_PX);
  // Small steps inside cards and rows.
  const s4 = px(4);
  const s6 = px(6);
  const s8 = px(8);
  const inner = px(Math.max(8, 0.5 * F));
  const step = px(Math.max(12, 0.75 * F));
  const rowPad = px(Math.max(12, 0.75 * F));
  const bigGap = px(Math.max(24, 1.5 * F));
  const panelPad = `max(${px(20)}, min(${px(Math.max(32, 2 * F))}, 5vw))`;
  const avatar = px(Math.max(48, 3 * F));
  const rowThumb = px(Math.max(64, 3.5 * F));
  const turn = px(Math.max(32, 1.8 * F));
  const underline = max
    ? 'text-decoration: underline; text-underline-offset: 0.18em;'
    : 'text-decoration: none;';
  const lift = reduce
    ? ''
    : `@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
  .fv-card:not(.fv-card--media):hover { transform: translateY(${px(-2)}); box-shadow: var(--shadow-lift); }
}`;

  return `
/* ---------- Bands and section heads (docs/12 §5) ---------- */
.fv-section { margin-block-start: var(--fv-band); min-width: 0; }
.fv-main > .fv-section:first-child { margin-block-start: var(--fv-head-gap); }
/* The main thing starts close under the hero (PRIMARY_START_SHARE). */
.fv-main > .fv-section[data-primary] { margin-block-start: clamp(var(--fv-head-gap), 5vh, var(--fv-band)); }
.fv-main > .fv-section.fv-tight { margin-block-start: ${inner}; }
.fv-section.fv-tight > .fv-section__head { margin-block-end: ${s8}; }
.fv-section__head {
  display: flex; flex-wrap: wrap; align-items: baseline;
  column-gap: ${px(0.3 * t.sectionHeading.px)}; row-gap: 0;
  margin-block-end: var(--fv-head-gap);
}
.fv-section__head > :is(h1, h2, h3) { margin: 0; flex: 0 1 auto; min-width: 0; }
/* Apple's grey continuation: "Related 12 videos". */
.fv-section__count { margin: 0; color: var(--ink-2); }
.fv-drawer .fv-section, .fv-collapsed > .fv-section { margin-block-start: 0; }
.fv-drawer .fv-section + .fv-section { margin-block-start: var(--fv-head-gap); }

/* ---------- The list's own chips, right above it (docs/11 M7) ---------- */
.fv-listtools { display: flex; flex-direction: column; gap: ${s8}; margin-block-end: var(--fv-head-gap); }
.fv-listtools > .fv-tools__label { margin: 0; }
.fv-listtools > .fv-stack { flex-direction: row; flex-wrap: wrap; align-items: flex-start; column-gap: var(--fv-gap); row-gap: ${s8}; }
.fv-listtools > .fv-stack > .fv-disclosure { display: contents; }
.fv-listtools > .fv-stack > .fv-disclosure > .fv-collapsed { flex-basis: 100%; }

/* ---------- Collections (docs/12 §6.2) ---------- */
.fv-records { display: flex; flex-direction: column; gap: calc(var(--fv-card-gap) * 1.6); min-width: 0; }
.fv-grid {
  display: grid; gap: var(--fv-card-gap); align-items: stretch;
  grid-template-columns: repeat(var(--fv-cols, 1), minmax(0, 1fr));
}
/* The lead record spans two columns, its picture 16:9. */
.fv-records.has-lead .fv-rec.is-lead { grid-column: span 2; }
.fv-listmore { display: flex; flex-wrap: wrap; align-items: flex-start; gap: ${s8} var(--fv-gap); }
.fv-listmore[hidden] { display: none; }
.fv-listmore > .fv-disclosure { flex-basis: 100%; }
.fv-sponsored .fv-wa { background: transparent; border-color: var(--line-strong); color: var(--ink-2); font-weight: inherit; }
.fv-rec__more { display: none; }
.fv-records.is-details .fv-rec__more { display: flex; }
.fv-spacer { display: block; }
.fv-more-on-page { margin-block-start: ${s8}; }

/* Titles open the item; facts read as one quiet line. */
.fv-rec-title { margin: 0; min-width: 0; }
.fv-rec-title :is(a, button.fv-open) {
  display: inline-flex; align-items: center; gap: ${s6};
  min-height: var(--fv-min); min-width: var(--fv-min); max-width: 100%;
  margin: 0; padding: 0; border: 0; background: none; cursor: pointer;
  color: inherit; font: inherit; letter-spacing: inherit; word-spacing: inherit; text-align: start;
  ${underline}
}
.fv-rec-title :is(a, button.fv-open):hover { text-decoration: underline; text-underline-offset: 0.18em; }
.fv-eyebrow { margin: 0; }
.fv-facts { display: block; margin: 0; }
.fv-price { color: var(--ink); font-weight: var(--fv-w-em); }
.fv-desc { margin: 0; max-width: ${measure}; }
.fv-rec__body { min-width: 0; display: flex; flex-direction: column; gap: ${s6}; }
.fv-rec__side { display: flex; flex-wrap: wrap; align-items: center; gap: var(--fv-gap); }
.fv-rec__select { flex: none; padding: 0; border: 0; background: transparent; justify-content: center; }
.fv-rec__head { display: flex; align-items: flex-start; gap: ${s8}; min-width: 0; }
.fv-rec__head > .fv-rec-title { flex: 1 1 auto; }

/* Cards: white on the canvas, soft elevation, no borders at standard contrast. */
.fv-card {
  position: relative; min-width: 0;
  display: flex; flex-direction: column; gap: ${inner};
  padding: var(--fv-card-pad);
  border-radius: var(--fv-r-card);
  background: var(--surface-raised); color: var(--ink);
  border: var(--fv-card-edge) solid var(--line-strong);
  box-shadow: var(--shadow-card);
  transition: transform var(--fv-dur) var(--fv-ease), box-shadow var(--fv-dur) var(--fv-ease);
}
.fv-card > .fv-rec__body { flex: 1 1 auto; }
/* Actions line up at the bottom of a row of cards. */
.fv-card > .fv-rec__side { margin-block-start: auto; }
.fv-card > :is(.fv-thumb, .fv-thumb-open) { flex: none; }
/* A picture that opens the site's viewer is a button: no button chrome. */
button.fv-thumb-open {
  appearance: none; margin: 0; padding: 0; border: 0; background: none;
  width: 100%; color: inherit; font: inherit; text-align: inherit;
}
${lift}

/* Tile (products, features): the picture whole in a soft well (.fv-thumb--contain).
   The well stops growing past a store-shelf height, so a wide tile shows its
   title and price on the first screen instead of one huge picture. */
.fv-card--tile > .fv-rec__side { margin-inline-start: -${s4}; }
.fv-card--tile > :is(.fv-thumb, .fv-thumb-open), .fv-card--tile > .fv-thumb-open > .fv-thumb {
  max-height: min(36vh, ${px(Math.max(240, 13 * F))});
}

/* Media (videos, images): no chrome, the picture leads. */
.fv-card--media {
  padding: 0; gap: ${px(Math.max(10, 0.6 * F))};
  background: transparent; border: 0; border-radius: 0; box-shadow: none;
}

/* Story (articles, posts, events): the picture flush on top. */
.fv-card--story { padding: 0; gap: 0; }
.fv-card--story .fv-thumb { border-radius: 0; }
.fv-card--story > :is(.fv-thumb, .fv-thumb-open) {
  overflow: hidden;
  border-radius: calc(var(--fv-r-card) - var(--fv-card-edge)) calc(var(--fv-r-card) - var(--fv-card-edge)) 0 0;
}
.fv-card--story > .fv-rec__body { padding: var(--fv-card-pad); gap: ${s8}; }
.fv-card--story > .fv-rec__side { padding: 0 var(--fv-card-pad) var(--fv-card-pad); }

/* Grouped list: one raised card, rows inside with inset hairlines. */
.fv-rows {
  display: flex; flex-direction: column; min-width: 0;
  border-radius: var(--fv-r-card);
  background: var(--surface-raised); color: var(--ink);
  border: var(--fv-card-edge) solid var(--line-strong);
  box-shadow: var(--shadow-card);
}
.fv-row {
  position: relative; min-width: 0; min-height: var(--fv-min);
  display: flex; flex-wrap: wrap; align-items: flex-start;
  gap: ${s8} ${step};
  padding: ${rowPad} var(--fv-card-pad);
}
.fv-rows > .fv-row + .fv-row::before {
  content: ''; position: absolute; inset-block-start: 0; inset-inline: var(--fv-card-pad) 0;
  border-block-start: var(--fv-hair) solid var(--line);
}
.fv-records--airy .fv-row { padding-block: ${px(Math.max(18, 1.1 * F))}; }
.fv-row > .fv-rec__body { flex: 1 1 ${px(Math.min(480, 12 * F))}; gap: ${s4}; }
.fv-row > .fv-rec__side { flex: none; align-self: center; }
.fv-row > :is(.fv-thumb, .fv-thumb-open) { flex: none; width: auto; border-radius: ${px(12)}; }
.fv-thumb.fv-row__thumb { width: ${rowThumb}; aspect-ratio: 1 / 1; border-radius: ${px(12)}; }
/* Results read as links. */
.fv-row--result .fv-rec-title :is(a, button.fv-open) { color: var(--link); }
/* A plain link record: the whole title row, its chevron trailing. */
.fv-rec.fv-row--link .fv-rec-title > :is(a, button.fv-open) { display: flex; width: 100%; justify-content: space-between; }
.fv-rec.fv-row--link .fv-chev, .fv-listlink > .fv-chev { color: var(--ink-2); }

/* Message: sender and time, then the subject and the snippet. */
.fv-msg__top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 ${s8}; min-width: 0; }
.fv-msg__from { margin: 0; flex: 1 1 auto; min-width: 0; }
.fv-msg__time { margin: 0; margin-inline-start: auto; flex: none; }
.fv-dot { flex: none; align-self: center; width: ${px(10)}; height: ${px(10)}; border-radius: 50%; background: var(--link); visibility: hidden; }
.fv-rec.is-unread .fv-dot { visibility: visible; }
.fv-rec.is-unread .fv-rec-title { font-weight: var(--fv-w-em); }
.fv-row--message .fv-desc { color: var(--ink-2); }

/* Person: a round avatar beside the name. */
.fv-card--person { flex-flow: row wrap; align-items: center; gap: ${step}; }
.fv-card--person > .fv-rec__body { flex: 1 1 ${px(Math.min(320, 8 * F))}; }
.fv-card--person > .fv-rec__side { margin-block-start: 0; }
.fv-rec .fv-thumb.fv-avatar { flex: none; width: ${avatar}; height: ${avatar}; aspect-ratio: 1 / 1; border-radius: 50%; }
.fv-rec > .fv-thumb-open:has(> .fv-avatar) { flex: none; border-radius: 50%; }
.fv-row--person { align-items: center; }

/* ---------- Link rows and link grids (docs/12 §6.1) ---------- */
.fv-row--link:not(.fv-rec) { padding: 0; }
.fv-listlink {
  appearance: none; margin: 0; flex: 1 1 auto; width: 100%;
  display: flex; align-items: center; justify-content: space-between; gap: var(--fv-gap);
  min-height: var(--fv-ctl); min-width: var(--fv-min);
  padding: ${px(Math.max(10, 0.6 * F))} var(--fv-card-pad);
  border: 0; border-radius: 0; background: transparent; color: var(--ink);
  font: inherit; letter-spacing: inherit; word-spacing: inherit; text-align: start; cursor: pointer;
  ${underline}
  transition: background-color var(--fv-dur) var(--fv-ease);
}
.fv-rows > .fv-row:first-child > .fv-listlink { border-start-start-radius: var(--fv-r-card); border-start-end-radius: var(--fv-r-card); }
.fv-rows > .fv-row:last-child > .fv-listlink { border-end-start-radius: var(--fv-r-card); border-end-end-radius: var(--fv-r-card); }
.fv-listlink:is([aria-current]:not([aria-current="false"]), [aria-pressed="true"]) { font-weight: var(--fv-w-em); }
.fv-linkgrid {
  display: grid; align-items: start;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, ${px(14 * F)}), 1fr));
  gap: ${s4} var(--fv-card-gap);
}
.fv-linkgrid > li, .fv-linkgrid__col > li { display: flex; min-width: 0; }
.fv-linkgrid__group { display: flex; flex-direction: column; gap: ${s4}; min-width: 0; margin-block-end: ${px(Math.max(16, F))}; }
.fv-linkgrid__head { margin: 0; color: var(--ink); font-weight: var(--fv-w-em); }
.fv-linkgrid__col { display: flex; flex-direction: column; }
.fv-gridlink {
  appearance: none; margin: 0; padding: 0; border: 0; background: none; cursor: pointer;
  display: inline-flex; align-items: center;
  min-height: var(--fv-ctl); min-width: var(--fv-min); max-width: 100%;
  color: var(--ink-2); font: inherit; letter-spacing: inherit; word-spacing: inherit; text-align: start;
  ${underline} text-underline-offset: 0.18em;
}
.fv-gridlink:is(:hover, :focus-visible) { color: var(--ink); text-decoration: underline; }
.fv-gridlink:is([aria-current]:not([aria-current="false"]), [aria-pressed="true"]) { color: var(--ink); font-weight: var(--fv-w-em); }
@media (hover: hover) and (pointer: fine) {
  .fv-listlink:hover { background: var(--surface-hover); }
}

/* ---------- Buy box (docs/12 §6.1 buy_box) ---------- */
.fv-product { container-type: inline-size; display: flex; flex-direction: column; gap: var(--fv-head-gap); min-width: 0; }
.fv-product__top { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; gap: ${bigGap}; }
/* From 900 px: the picture (7) beside the buying column (5); the column reads first. */
@container (min-width: ${wide}) {
  .fv-product__top { grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); }
  .fv-product__top > .fv-product__media { grid-column: 1; grid-row: 1; }
  .fv-product__top > .fv-product__buy { grid-column: 2; grid-row: 1; }
}
.fv-product__buy { display: flex; flex-direction: column; gap: ${px(Math.max(14, 0.9 * F))}; min-width: 0; }
.fv-product__buy > :is(h1, h2) { margin: 0; }
.fv-product__media { display: flex; flex-direction: column; gap: ${s8}; min-width: 0; }
.fv-product__media > .fv-thumb-open { border-radius: var(--fv-r-panel); }
/* The well is a raised panel: the canvas is the grey a well would be. */
.fv-thumb.fv-product__img { border-radius: var(--fv-r-panel); max-height: 62vh; background: var(--surface-raised); border: var(--fv-card-edge) solid var(--line-strong); }
.fv-prices { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: ${s4} ${step}; }
.fv-prices > .is-primary { color: var(--ink); }
.fv-rating { margin: 0; }
.fv-options-block { gap: ${px(Math.max(14, 0.9 * F))}; }
.fv-picker { display: flex; flex-direction: column; gap: ${s8}; min-width: 0; }
.fv-picker__label { margin: 0; }
/* Buying actions: full-width pills, the first one filled. */
.fv-product__buy > :is(.fv-actions, .fv-buyopts) { flex-direction: column; align-items: stretch; gap: ${s8}; }
.fv-product__buy > :is(.fv-actions, .fv-buyopts) > * { width: 100%; }
.fv-product__facts {
  display: flex; flex-direction: column; gap: ${s6};
  padding: ${px(Math.max(14, 0.9 * F))} ${px(Math.max(16, F))};
  border-radius: var(--fv-r-media);
  background: var(--surface-tonal); color: var(--ink);
}
.fv-product__facts > p { margin: 0; }

/* ---------- Spotlight panels (docs/12 §6.1 spotlight) ---------- */
.fv-spotlights { container-type: inline-size; display: flex; flex-direction: column; gap: var(--fv-card-gap); min-width: 0; }
.fv-spotlight {
  display: grid; grid-template-columns: minmax(0, 1fr); align-items: center;
  gap: ${bigGap};
  padding: ${panelPad};
  border-radius: var(--fv-r-panel);
  background: var(--surface-raised); color: var(--ink);
  border: var(--fv-card-edge) solid var(--line-strong);
  box-shadow: var(--shadow-card);
}
@container (min-width: ${wide}) {
  .fv-spotlight.has-media:not(.fv-spotlight--hero) { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
}
.fv-spotlight__text { display: flex; flex-direction: column; align-items: flex-start; gap: ${step}; min-width: 0; }
.fv-spotlight__text > .fv-stack { align-self: stretch; }
.fv-spotlight .fv-heading { margin-block-start: 0; }
.fv-spotlight__media { min-width: 0; }
.fv-spotlight__media > .fv-thumb-open { border-radius: var(--fv-r-media); }
.fv-spotlight__media .fv-thumb { max-height: 56vh; }
/* A promo hero below the top: one centred panel, its picture under the words. */
.fv-spotlight--hero { justify-items: center; text-align: center; }
.fv-spotlight--hero .fv-spotlight__text, .fv-spotlight--hero :is(.fv-stack, .fv-group) { align-items: center; }
.fv-spotlight--hero :is(.fv-stack, .fv-group) > :is(.fv-btn, .fv-pill, a.fv-row-link) { align-self: center; }
.fv-spotlight--hero .fv-actions { justify-content: center; }
.fv-spotlight--hero .fv-spotlight__media { width: 100%; }

/* ---------- Form panel (docs/12 §6.1 form_panel) ---------- */
.fv-formpanel {
  width: 100%; max-width: ${px(Math.max(560, 34 * F))};
  padding: ${panelPad};
  border-radius: var(--fv-r-card);
  background: var(--surface-raised); color: var(--ink);
  border: var(--fv-card-edge) solid var(--line-strong);
  box-shadow: var(--shadow-card);
}
.fv-formpanel > .fv-stack { gap: ${px(Math.max(16, F))}; }
.fv-formpanel .fv-field { max-width: none; }

/* ---------- As is: players and frames in a media-radius frame ---------- */
.fv-asis > figure > .fv-thumb, .fv-asis > .fv-onpage { border-radius: var(--fv-r-media); }

/* ---------- More on this page: drawers as raised cards (docs/12 §5) ---------- */
.fv-drawers { margin-block-start: var(--fv-band); display: flex; flex-direction: column; gap: ${px(Math.max(10, 0.6 * F))}; }
.fv-drawers > h2 { margin-block-end: ${s8}; }
.fv-drawer {
  min-width: 0;
  border-radius: var(--fv-r-card);
  background: var(--surface-raised); color: var(--ink);
  border: var(--fv-card-edge) solid var(--line-strong);
  box-shadow: var(--shadow-card);
}
.fv-drawer > .fv-disclosure { gap: 0; }
.fv-drawer > .fv-disclosure > .fv-disclosure__bar { display: block; }
.fv-drawer .fv-drawer__toggle {
  width: 100%; justify-content: flex-start; gap: ${px(Math.max(10, 0.6 * F))};
  min-height: var(--fv-ctl);
  padding: ${px(Math.max(14, 0.8 * F))} var(--fv-card-pad);
  border: 0; border-radius: var(--fv-r-card);
  background: transparent; color: var(--ink);
  text-align: start; line-height: inherit;
}
.fv-drawer__title { flex: 0 1 auto; min-width: 0; }
.fv-drawer__count {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  min-width: ${px(2 * F)}; padding: 0 ${px(10)}; border-radius: 999px; line-height: 1.6;
  background: var(--surface-tonal); color: var(--accent);
}
.fv-drawer__chev {
  flex: none; margin-inline-start: auto;
  display: inline-flex; align-items: center; justify-content: center;
  width: ${turn}; height: ${turn}; border-radius: 50%;
  background: var(--surface-tonal); color: var(--ink);
  transition: background-color var(--fv-dur) var(--fv-ease);
}
.fv-drawer__toggle[aria-expanded="true"] .fv-drawer__chev > .fv-chev { transform: rotate(180deg); }
@media (hover: hover) and (pointer: fine) {
  .fv-drawer .fv-drawer__toggle:hover { background: transparent; }
  .fv-drawer .fv-drawer__toggle:hover .fv-drawer__chev { background: var(--surface-hover); }
}
.fv-drawer > .fv-disclosure > .fv-collapsed { padding: 0 var(--fv-card-pad) var(--fv-card-pad); min-width: 0; }

/* ---------- Forced colours: surfaces become edges ---------- */
@media (forced-colors: active) {
  .fv-card:not(.fv-card--media), .fv-rows, .fv-drawer, .fv-spotlight, .fv-formpanel, .fv-product__facts { border: 1px solid CanvasText; }
  .fv-drawer .fv-drawer__toggle { border: 0; }
  .fv-drawer__count, .fv-drawer__chev { border: 1px solid CanvasText; }
  .fv-rows > .fv-row + .fv-row::before { border-color: CanvasText; }
  .fv-dot { forced-color-adjust: none; background: CanvasText; }
  .fv-row--result .fv-rec-title a, a.fv-listlink, a.fv-gridlink { color: LinkText; }
}
`;
}
