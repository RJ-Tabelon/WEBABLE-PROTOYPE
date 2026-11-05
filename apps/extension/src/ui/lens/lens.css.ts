// Owner: L. Jev Lens v2 styles: scrim, two-tone outlines, chips, card, one-row header, side sheet.
// Lengths use --lu (one design pixel: tab zoom divided out, a little larger for large text). No url().

const L = (n: number): string => `calc(${n} * var(--lu, 1px))`;
const FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const DISPLAY =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/** Class colours: white text on each is 5.0–6.5 : 1. */
export const LENS_COLOR = {
  main: '#0A6CD6',
  guarded: '#1A7F45',
  folded: '#C2410C',
  popup: '#6E40C9',
  kept: '#48484A',
  pending: '#86868B',
} as const;

/** Round 9: what WebAble changes for the person (the same green as the mark on a rewritten paragraph). */
const PARA_GREEN = '#17694A';
const HATCH = 'rgba(255,159,10,.22)';
const SCRIM = 'rgba(11,13,18,.45)';
const IN = `inset 0 0 0 ${L(1)} rgba(0,0,0,.55)`; // 1 px black inside the band
const OUT = `0 0 0 ${L(1)} #FFFFFF`; // 1 px white outside the band

function fitRules(): string {
  const out: string[] = [];
  for (let lvl = 1; lvl <= 7; lvl++) {
    const sel = Array.from({ length: lvl }, (_, i) => `[data-o="${i + 1}"]`).join(',');
    out.push(`.wa-lhead[data-fit="${lvl}"] :is(${sel}) { display: none !important; }`);
  }
  return out.join('\n');
}

export const lensCss = /* css */ `
.wa-lens {
  position: fixed; inset: 0; z-index: 20; pointer-events: none; overflow: hidden;
  font-family: ${FONT}; color: var(--c-ink, #1D1D1F); -webkit-font-smoothing: antialiased;
}
.wa-lpage, .wa-lboxes, .wa-lchips { position: absolute; inset: 0; pointer-events: none; }
.wa-lscrim, .wa-lleads { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.wa-lscrim path { fill: ${SCRIM}; }
.wa-lleads line { stroke-width: ${L(1.25)}; stroke: #FFFFFF; filter: drop-shadow(0 0 ${L(1)} rgba(0,0,0,.65)); }
.wa-lleads line[data-c="main"] { stroke: ${LENS_COLOR.main}; }
.wa-lleads line[data-c="folded"] { stroke: #FFB866; }
.wa-lleads line[data-c="guarded"] { stroke: #5FD48B; }
.wa-lleads line[data-c="popup"] { stroke: #C9A8FF; }
.wa-lleads line[data-c="page"] { stroke: #7DDEBA; }
.wa-lleads line[data-c="content"] { stroke: #8EDED4; }
.wa-lleads line[data-c="data"] { stroke: #B7C4FF; }
.wa-lleads line[data-c="task"] { stroke: #9CC6FF; }
.wa-lleads line[data-c="navigation"] { stroke: #D5DDE4; }
.wa-lleads line[data-c="help"] { stroke: #5FD48B; }
.wa-lleads line[data-c="distraction"] { stroke: #FFB866; }
.wa-lleads line[data-c="other"] { stroke: #FFFFFF; }

/* ---------- outlines: 1 px black inside, a colour band, 1 px white outside ---------- */
.wa-lbox {
  position: absolute; left: 0; top: 0; box-sizing: border-box; border-radius: ${L(7)};
  will-change: transform; transition: opacity 160ms ease, border-width 120ms ease;
}
.wa-lbox[data-c="kept"] { box-shadow: inset 0 0 0 ${L(1)} rgba(255,255,255,.7), 0 0 0 ${L(1)} rgba(0,0,0,.22); }
.wa-lbox[data-c="pending"] { border: ${L(1.5)} dashed rgba(134,134,139,.85); animation: wa-lpend 1.4s ease-in-out infinite; }
.wa-lbox[data-c="main"] {
  border: ${L(3)} solid ${LENS_COLOR.main};
  box-shadow: ${IN}, ${OUT}, 0 0 ${L(18)} ${L(3)} rgba(10,108,214,.55);
}
.wa-lbox[data-c="guarded"] { border: ${L(2)} solid ${LENS_COLOR.guarded}; box-shadow: ${IN}, ${OUT}; }
.wa-lbox[data-c="popup"] { border: ${L(2)} solid ${LENS_COLOR.popup}; box-shadow: ${IN}, ${OUT}; }
.wa-lbox[data-c="folded"] { border: ${L(2)} dashed ${LENS_COLOR.folded}; box-shadow: ${IN}, ${OUT}; }
.wa-lhatch {
  position: absolute; inset: 0; pointer-events: none;
  background-image: repeating-linear-gradient(135deg, ${HATCH} 0 ${L(6)}, transparent ${L(6)} ${L(12)});
}
.wa-lbox[data-c="unsure"] { border: ${L(2)} dashed #FFFFFF; box-shadow: ${IN}, 0 0 0 ${L(1)} rgba(0,0,0,.4); }
.wa-lbox[data-covered="true"]:not([data-c="main"]) {
  border: ${L(1)} dashed rgba(255,255,255,.95); box-shadow: 0 0 0 ${L(1)} rgba(0,0,0,.45); background-image: none;
}
/* Importance, only when Jev sent a score. No data-weight: the class outline above is unchanged.
   Essential (4) is a little heavier than supporting (3). Distractions are dashed. The rest is a hairline.
   A covered element keeps the dashed "under something" outline. */
.wa-lbox[data-weight="solid"]:not([data-covered="true"]) {
  border: ${L(2.5)} solid #1A3A4A; box-shadow: ${IN}, ${OUT};
}
.wa-lbox[data-weight="solid"][data-rank="4"]:not([data-covered="true"]) { border-width: ${L(3.5)}; }
.wa-lbox[data-weight="dashed"]:not([data-covered="true"]) {
  border: ${L(2)} dashed #C2410C; box-shadow: ${IN}, ${OUT};
}
.wa-lbox[data-weight="hair"]:not([data-covered="true"]) {
  border: ${L(1)} solid rgba(255,255,255,.75); box-shadow: 0 0 0 ${L(1)} rgba(0,0,0,.28); background-image: none;
}
/* The main region is framed on its own. Its element box does not draw a second outline. */
.wa-lbox[data-frame="outer"] { border: 0; box-shadow: none; background: none; }
.wa-lregion {
  position: absolute; left: 0; top: 0; box-sizing: border-box; border-radius: ${L(14)}; pointer-events: none;
  border: ${L(3)} solid #14634A;
  box-shadow: inset 0 0 0 ${L(1)} rgba(0,0,0,.4), 0 0 0 ${L(1)} #FFFFFF, 0 0 ${L(22)} ${L(2)} rgba(20,99,74,.38);
}
.wa-lrulebox { border: ${L(2)} dashed #FFFFFF; border-radius: ${L(10)}; box-shadow: 0 0 0 ${L(1)} rgba(0,0,0,.65), inset 0 0 0 ${L(1)} rgba(0,0,0,.65); }
.wa-lbox[data-hot="true"] { border-width: ${L(4)}; }
.wa-lbox[data-hot="true"][data-c="kept"] { box-shadow: inset 0 0 0 ${L(2)} #FFFFFF, 0 0 0 ${L(2)} rgba(0,0,0,.55); }
.wa-lens[data-focus] .wa-lbox:not([data-hot]), .wa-lens[data-focus] .wa-lchip:not([data-hot]) { opacity: .5; }

/* ---------- chips ---------- */
.wa-lchip {
  position: absolute; left: 0; top: 0; box-sizing: border-box; will-change: transform;
  display: flex; align-items: center; gap: ${L(5)}; padding: 0 ${L(9)} 0 ${L(8)};
  width: max-content; max-width: ${L(220)}; height: ${L(22)};
  border-radius: ${L(6)}; white-space: nowrap; overflow: hidden;
  font: 600 ${L(12)}/1 ${FONT}; letter-spacing: 0; color: #FFFFFF; background: ${LENS_COLOR.kept};
  box-shadow: 0 0 0 ${L(1)} rgba(255,255,255,.9), 0 ${L(2)} ${L(10)} rgba(0,0,0,.28);
  transition: opacity 160ms ease;
}
.wa-lchip svg { flex: none; width: ${L(12)}; height: ${L(12)}; }
.wa-lchip[data-c="main"] svg { width: ${L(13)}; height: ${L(13)}; }
.wa-lchip-t { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.wa-lchip-n { flex: none; font-weight: 700; font-variant-numeric: tabular-nums; }
.wa-lchip[data-c="main"] { background: ${LENS_COLOR.main}; font-size: ${L(13)}; border-radius: ${L(7)}; height: ${L(26)}; max-width: ${L(260)}; padding: 0 ${L(10)} 0 ${L(9)}; }
.wa-lchip[data-c="guarded"] { background: ${LENS_COLOR.guarded}; }
.wa-lchip[data-c="folded"] { background: ${LENS_COLOR.folded}; }
.wa-lchip[data-c="popup"] { background: ${LENS_COLOR.popup}; }
.wa-lchip[data-c="unsure"] {
  background: #FFFFFF; color: #1D1D1F; box-shadow: inset 0 0 0 ${L(1)} transparent, 0 ${L(2)} ${L(10)} rgba(0,0,0,.28);
  border: ${L(1.25)} dashed #48484A;
}
.wa-lchip[data-c="rule"] { background: #FFFFFF; color: #1D1D1F; border: ${L(1.5)} dashed #1D1D1F; }
/* Fine-role chips, one colour per family. White text on each is about 5:1 or better. */
.wa-lchip[data-c="content"] { background: #0E6A62; }
.wa-lchip[data-c="data"] { background: #2A3F8F; }
.wa-lchip[data-c="task"] { background: #0A4F9C; }
.wa-lchip[data-c="navigation"] { background: #2E4456; }
.wa-lchip[data-c="help"] { background: #1A7F45; }
.wa-lchip[data-c="distraction"] { background: #C2410C; }
.wa-lchip[data-c="other"] { background: #48484A; }
.wa-lchip[data-c="page"] {
  z-index: 2; background: #14634A; color: #FFFFFF; font-size: ${L(13)}; height: ${L(28)}; max-width: ${L(340)};
  border-radius: ${L(8)}; padding: 0 ${L(10)} 0 ${L(9)};
}
.wa-lchip[data-c="page"] svg { width: ${L(13)}; height: ${L(13)}; }
.wa-lchip[data-hot="true"] { box-shadow: 0 0 0 ${L(2)} #FFFFFF, 0 ${L(4)} ${L(16)} rgba(0,0,0,.4); }

/* ---------- entry ---------- */
.wa-lens[data-phase="enter"] .wa-lscrim, .wa-lens[data-phase="enter"] .wa-lhatch { animation: wa-lfade 180ms ease-out both; }
.wa-lens[data-phase="enter"] .wa-lbox, .wa-lens[data-phase="enter"] .wa-lregion { animation: wa-lbox 160ms ease-out both; animation-delay: var(--d, 0ms); }
.wa-lens[data-phase="enter"] .wa-lbox[data-c="pending"] { animation: wa-lpend 1.4s ease-in-out infinite; }
.wa-lens[data-phase="enter"] .wa-lchip { animation: wa-lchip 220ms cubic-bezier(.2,.8,.3,1) both; animation-delay: var(--cd, 200ms); }
.wa-lens[data-phase="enter"] .wa-lleads { animation: wa-lfade 200ms ease-out both; animation-delay: 380ms; }
.wa-lens[data-phase="steady"] .wa-lchip, .wa-lens[data-phase="steady"] .wa-lbox:not([data-c="pending"]) { animation: wa-lfade 140ms ease-out both; }
.wa-lens[data-phase="enter"] .wa-lbox[data-c="main"]::after {
  content: ""; position: absolute; inset: ${L(-6)}; border-radius: ${L(11)}; border: ${L(2)} solid ${LENS_COLOR.main};
  opacity: 0; animation: wa-lpulse 720ms ease-out 1 both; animation-delay: 480ms; pointer-events: none;
}
.wa-lens[data-motion="reduce"] { animation: wa-lfade 120ms ease-out both; }
.wa-lens[data-motion="reduce"] *, .wa-lens[data-motion="reduce"] *::after { animation: none !important; transition: none !important; }
@keyframes wa-lfade { from { opacity: 0; } to { opacity: 1; } }
@keyframes wa-lbox { from { opacity: 0; scale: 1.02; } to { opacity: 1; scale: 1; } }
@keyframes wa-lchip { from { opacity: 0; translate: 0 ${L(4)}; } to { opacity: 1; translate: 0 0; } }
@keyframes wa-lpulse { 0% { opacity: .95; scale: 1; } 100% { opacity: 0; scale: 1.08; } }
@keyframes wa-lpend { 0%, 100% { opacity: .95; } 50% { opacity: .4; } }
@keyframes wa-lsheet { from { opacity: 0; translate: ${L(14)} 0; } to { opacity: 1; translate: 0 0; } }
@keyframes wa-lrise { from { opacity: 0; translate: 0 ${L(-6)}; } to { opacity: 1; translate: 0 0; } }

/* ---------- header: one row ---------- */
.wa-lhead-wrap {
  position: absolute; top: ${L(10)}; left: ${L(10)}; right: ${L(10)}; z-index: 6;
  display: flex; justify-content: center; pointer-events: none;
}
.wa-lhead-wrap[data-sheet="open"] { right: calc(min(${L(360)}, calc(100vw - ${L(20)})) + ${L(20)}); }
.wa-lhead {
  pointer-events: auto; box-sizing: border-box; max-width: 100%; height: ${L(44)};
  display: flex; align-items: center; gap: ${L(10)}; padding: 0 ${L(6)} 0 ${L(14)};
  border-radius: ${L(14)}; overflow: hidden; white-space: nowrap;
  background: var(--c-glass, rgba(255,255,255,.82)); color: var(--c-ink, #1D1D1F);
  -webkit-backdrop-filter: saturate(180%) blur(20px); backdrop-filter: saturate(180%) blur(20px);
  box-shadow: 0 ${L(10)} ${L(32)} rgba(0,0,0,.2), 0 0 0 ${L(0.5)} rgba(0,0,0,.14);
  border: ${L(1)} solid var(--c-edge, transparent);
  font: 500 ${L(13)}/1 ${FONT};
  animation: wa-lrise 240ms cubic-bezier(.2,.8,.3,1) both;
}
.wa-lbrand { flex: none; display: inline-flex; align-items: center; gap: ${L(6)}; font: 600 ${L(14)}/1 ${DISPLAY}; letter-spacing: -0.01em; }
.wa-lpurpose { flex: none; min-width: 0; color: var(--c-ink2, #5E5E63); }
.wa-lpurpose em { font-style: italic; font-weight: 650; color: var(--c-ink, #1D1D1F); }
.wa-lpurpose b { font-weight: 700; color: var(--c-ink, #1D1D1F); font-variant-numeric: tabular-nums; }
.wa-lhead[data-clip="1"] .wa-lpurpose { flex: 1 1 auto; min-width: ${L(140)}; overflow: hidden; text-overflow: ellipsis; }
.wa-lbrand svg { color: ${LENS_COLOR.main}; width: ${L(13)}; height: ${L(13)}; }
.wa-lbtn svg, .wa-lrow-end svg { flex: none; width: ${L(12)}; height: ${L(12)}; }
.wa-lx svg { width: ${L(15)}; height: ${L(15)}; }
.wa-lcard-badge svg { flex: none; width: ${L(12)}; height: ${L(12)}; }
.wa-lcard-x svg { width: ${L(14)}; height: ${L(14)}; }
.wa-lrow-ic svg { width: ${L(11)}; height: ${L(11)}; }
.wa-lgrp-toggle svg { width: ${L(12)}; height: ${L(12)}; }
.wa-lsep { flex: none; width: ${L(1)}; height: ${L(18)}; background: var(--c-line, #D2D2D7); }
.wa-lstats { flex: none; display: inline-flex; align-items: baseline; gap: ${L(6)}; color: var(--c-ink2, #5E5E63); font-variant-numeric: tabular-nums; }
.wa-lstats b { color: var(--c-ink, #1D1D1F); font-weight: 600; }
.wa-lstats i { font-style: normal; opacity: .45; }
.wa-lcount { display: inline-block; text-align: right; }
.wa-lcache { color: var(--c-ink2, #5E5E63); }
.wa-lmodel { font: 500 ${L(11.5)}/1 ${MONO}; padding: ${L(3)} ${L(6)}; border-radius: ${L(6)}; background: var(--c-tonal, #E8E8ED); color: var(--c-ink2, #5E5E63); align-self: center; }
.wa-lpending { align-items: center; }
.wa-lbreath { width: ${L(8)}; height: ${L(8)}; border-radius: 999px; background: ${LENS_COLOR.main}; animation: wa-lpend 1.2s ease-in-out infinite; }
.wa-lbtns { flex: none; display: inline-flex; align-items: center; gap: ${L(6)}; margin-left: auto; }
.wa-lbtn {
  appearance: none; display: inline-flex; align-items: center; gap: ${L(6)}; height: ${L(32)}; padding: 0 ${L(12)};
  border: ${L(1)} solid var(--c-edge, transparent); border-radius: 999px; cursor: pointer; pointer-events: auto;
  background: var(--c-tonal, #E8E8ED); color: var(--c-ink, #1D1D1F); font: 500 ${L(13)}/1 ${FONT}; white-space: nowrap;
  transition: background-color 140ms ease, color 140ms ease;
}
.wa-lbtn:hover { background: var(--c-hover, #DCDCE1); }
.wa-lbtn[aria-pressed="true"], .wa-lbtn[aria-expanded="true"] { background: var(--c-ink, #1D1D1F); color: var(--c-raised, #FFFFFF); }
.wa-lbtn[disabled] { opacity: .5; cursor: default; }
.wa-lbtn-sm { height: ${L(28)}; padding: 0 ${L(10)}; font-size: ${L(12.5)}; }
.wa-lbadge { font-size: ${L(11.5)}; font-weight: 600; color: ${LENS_COLOR.main}; }
.wa-lbtn[aria-expanded="true"] .wa-lbadge { color: #8EC5FF; }
.wa-lbtn[aria-expanded="true"] > svg:last-child { rotate: 180deg; }
.wa-lx {
  appearance: none; flex: none; display: inline-grid; place-items: center; width: ${L(32)}; height: ${L(32)};
  border: ${L(1)} solid var(--c-edge, transparent); border-radius: 999px; cursor: pointer; pointer-events: auto;
  background: var(--c-tonal, #E8E8ED); color: var(--c-ink2, #5E5E63);
}
.wa-lx:hover { background: var(--c-hover, #DCDCE1); color: var(--c-ink, #1D1D1F); }
.wa-lens :focus-visible { outline: ${L(3)} solid var(--c-focus, #0071E3); outline-offset: ${L(2)}; }
${fitRules()}

/* ---------- card ---------- */
.wa-lcard {
  position: absolute; left: 0; top: 0; z-index: 5; box-sizing: border-box; width: ${L(304)};
  padding: ${L(11)} ${L(13)} ${L(10)}; border-radius: ${L(16)};
  background: var(--c-raised, #FFFFFF); color: var(--c-ink, #1D1D1F);
  box-shadow: 0 ${L(14)} ${L(44)} rgba(0,0,0,.3), 0 0 0 ${L(0.5)} rgba(0,0,0,.16);
  border: ${L(1)} solid var(--c-edge, transparent);
  font: 400 ${L(12.5)}/1.35 ${FONT}; pointer-events: none; will-change: transform;
  animation: wa-lfade 120ms ease-out both;
}
.wa-lcard[data-pinned="true"] { pointer-events: auto; user-select: text; -webkit-user-select: text; }
.wa-lcard-top { display: flex; align-items: center; justify-content: space-between; gap: ${L(8)}; min-height: ${L(24)}; }
.wa-lcard-badge {
  display: inline-flex; align-items: center; gap: ${L(5)}; height: ${L(22)}; padding: 0 ${L(9)} 0 ${L(8)};
  border-radius: ${L(6)}; color: #FFFFFF; background: ${LENS_COLOR.kept}; font: 600 ${L(12)}/1 ${FONT}; white-space: nowrap;
}
.wa-lcard-badge b { font-weight: 700; font-variant-numeric: tabular-nums; }
.wa-lcard-badge[data-c="main"] { background: ${LENS_COLOR.main}; }
.wa-lcard-badge[data-c="guarded"] { background: ${LENS_COLOR.guarded}; }
.wa-lcard-badge[data-c="folded"] { background: ${LENS_COLOR.folded}; }
.wa-lcard-badge[data-c="popup"] { background: ${LENS_COLOR.popup}; }
.wa-lcard-badge[data-c="unsure"] { background: #FFFFFF; color: #1D1D1F; border: ${L(1.25)} dashed #48484A; }
.wa-lcard-badge[data-c="pending"] { background: ${LENS_COLOR.pending}; }
.wa-lcard-x {
  appearance: none; display: inline-grid; place-items: center; width: ${L(26)}; height: ${L(26)}; border-radius: 999px;
  border: 0; background: var(--c-tonal, #E8E8ED); color: var(--c-ink2, #5E5E63); cursor: pointer;
}
.wa-lcard-title {
  margin: ${L(7)} 0 ${L(1)}; font: 600 ${L(14.5)}/1.25 ${DISPLAY}; letter-spacing: -0.01em;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.wa-lcard-where { margin: 0; font-size: ${L(12)}; color: var(--c-ink2, #5E5E63); }
.wa-lcard-covered { margin: ${L(6)} 0 0; font-size: ${L(12)}; font-weight: 500; color: var(--c-warn, #7A4800); }
.wa-lcard-verdict { margin: ${L(6)} 0 0; font-size: ${L(12.5)}; line-height: 1.38; }
.wa-lcard-none { margin: ${L(10)} 0 0; color: var(--c-ink2, #5E5E63); }
.wa-lcard-h {
  margin: ${L(9)} 0 ${L(4)}; font-size: ${L(10)}; font-weight: 600; letter-spacing: .05em; text-transform: uppercase;
  color: var(--c-ink2, #5E5E63);
}
.wa-lroles { display: grid; gap: ${L(2)}; }
.wa-lrole { display: grid; grid-template-columns: ${L(96)} 1fr ${L(32)}; align-items: center; gap: ${L(8)}; height: ${L(14)}; font-size: ${L(11.5)}; }
.wa-lrole-n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wa-lrole-bar { position: relative; height: ${L(6)}; border-radius: 999px; background: var(--c-tonal, #E8E8ED); overflow: hidden; }
.wa-lrole-bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; background: #8E8E93; }
.wa-lrole[data-g="fold"] .wa-lrole-bar i { background: ${LENS_COLOR.folded}; }
.wa-lrole[data-g="protect"] .wa-lrole-bar i { background: ${LENS_COLOR.guarded}; }
.wa-lrole[data-g="content"] .wa-lrole-bar i { background: #0E6A62; }
.wa-lrole[data-g="data"] .wa-lrole-bar i { background: #2A3F8F; }
.wa-lrole[data-g="task"] .wa-lrole-bar i { background: #0A4F9C; }
.wa-lrole[data-g="navigation"] .wa-lrole-bar i { background: #2E4456; }
.wa-lrole[data-g="help"] .wa-lrole-bar i { background: #1A7F45; }
.wa-lrole[data-g="distraction"] .wa-lrole-bar i { background: #C2410C; }
.wa-lrole[data-fine="true"] { grid-template-columns: minmax(${L(72)}, 46%) 1fr ${L(32)}; }
.wa-lrole-v, .wa-lt-v, .wa-ls-v { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.wa-ls { display: grid; grid-template-columns: ${L(132)} 1fr auto ${L(30)}; grid-template-areas: "n b a v"; align-items: center; gap: ${L(8)}; height: ${L(16)}; margin-bottom: ${L(3)}; font-size: ${L(11.5)}; }
.wa-ls-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wa-ls-name { grid-area: n; }
.wa-ls-v { grid-area: v; }
.wa-ls-bar { grid-area: b; position: relative; height: ${L(6)}; border-radius: 999px; background: var(--c-tonal, #E8E8ED); align-self: center; }
.wa-ls-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; background: #8E8E93; }
.wa-ls[data-k="fold"] .wa-ls-fill { background: ${LENS_COLOR.folded}; }
.wa-ls[data-k="protect"] .wa-ls-fill { background: ${LENS_COLOR.guarded}; }
.wa-ls[data-hit="false"] .wa-ls-fill { opacity: .45; }
.wa-ls-tick { position: absolute; top: ${L(-3)}; bottom: ${L(-3)}; width: ${L(2)}; margin-left: ${L(-1)}; border-radius: 1px; background: var(--c-ink, #1D1D1F); }
.wa-ls-act { grid-area: a; font-size: ${L(11)}; color: var(--c-ink2, #5E5E63); font-variant-numeric: tabular-nums; }
.wa-lt { display: grid; grid-template-columns: ${L(36)} 1fr ${L(32)}; align-items: center; gap: ${L(8)}; height: ${L(18)}; font-size: ${L(11.5)}; }
.wa-lt-name { color: var(--c-ink2, #5E5E63); }
.wa-lt-track { position: relative; height: ${L(10)}; border-radius: ${L(5)}; background: var(--c-tonal, #E8E8ED); overflow: visible; }
.wa-lt-zone { position: absolute; top: 0; bottom: 0; }
.wa-lt-zone:first-child { border-radius: ${L(5)} 0 0 ${L(5)}; }
.wa-lt-zone[data-k="fold"] { background: rgba(194,65,12,.24); }
.wa-lt-zone[data-k="protect"] { background: rgba(26,127,69,.24); border-radius: 0 ${L(5)} ${L(5)} 0; }
.wa-lt-zone[data-k="main"] { background: rgba(10,108,214,.24); border-radius: 0 ${L(5)} ${L(5)} 0; }
.wa-lt-zone[data-k="gap"] { background: repeating-linear-gradient(135deg, rgba(110,110,115,.42) 0 ${L(1.5)}, transparent ${L(1.5)} ${L(4)}); }
.wa-lt-tick { position: absolute; top: ${L(-2)}; bottom: ${L(-2)}; width: ${L(1.5)}; margin-left: ${L(-0.75)}; background: var(--c-ink2, #5E5E63); }
.wa-lt-dot {
  position: absolute; top: 50%; width: ${L(11)}; height: ${L(11)}; margin: ${L(-5.5)} 0 0 ${L(-5.5)}; border-radius: 999px;
  background: var(--c-ink, #1D1D1F); box-shadow: 0 0 0 ${L(2)} var(--c-raised, #FFFFFF);
}
.wa-lt-legend { display: flex; flex-wrap: wrap; gap: ${L(3)} ${L(10)}; margin-top: ${L(3)}; font-size: ${L(10.5)}; color: var(--c-ink2, #5E5E63); }
.wa-lt-legend span { display: inline-flex; align-items: center; gap: ${L(4)}; }
.wa-lt-legend i { width: ${L(14)}; height: ${L(8)}; border-radius: ${L(2)}; }
.wa-lt-legend i[data-k="fold"] { background: rgba(194,65,12,.3); }
.wa-lt-legend i[data-k="protect"] { background: rgba(26,127,69,.3); }
.wa-lt-legend i[data-k="gap"] { background: repeating-linear-gradient(135deg, rgba(110,110,115,.55) 0 ${L(1.5)}, transparent ${L(1.5)} ${L(4)}); box-shadow: inset 0 0 0 ${L(1)} rgba(110,110,115,.3); }
.wa-lcard-because {
  margin: ${L(8)} 0 0; padding-top: ${L(7)}; border-top: ${L(1)} solid var(--c-line, #D2D2D7);
  font-size: ${L(11.5)}; line-height: 1.4; font-variant-numeric: tabular-nums; color: var(--c-ink, #1D1D1F);
}
.wa-lcard-because span { font-weight: 600; margin-right: ${L(4)}; }
.wa-limp {
  display: flex; align-items: center; gap: ${L(8)}; margin: ${L(8)} 0 0; font-size: ${L(12)};
}
.wa-limp-k { flex: none; font-weight: 600; }
.wa-limp-meter { flex: none; display: inline-flex; gap: ${L(3)}; }
.wa-limp-meter i { width: ${L(16)}; height: ${L(8)}; border-radius: ${L(2)}; background: var(--c-tonal, #E8E8ED); }
.wa-limp[data-w="solid"] .wa-limp-meter i[data-on="true"] { background: #14634A; }
.wa-limp[data-w="dashed"] .wa-limp-meter i[data-on="true"] { background: #C2410C; }
.wa-limp[data-w="hair"] .wa-limp-meter i[data-on="true"] { background: #5E5E63; }
.wa-limp b { font-weight: 600; font-variant-numeric: tabular-nums; }

/* ---------- side sheet ---------- */
.wa-lsheet {
  position: absolute; top: ${L(10)}; right: ${L(10)}; bottom: max(${L(10)}, var(--lbottom, 0px)); z-index: 6;
  width: min(${L(360)}, calc(100vw - ${L(20)})); box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;
  border-radius: ${L(18)}; background: var(--c-sheet, rgba(245,245,247,.92)); color: var(--c-ink, #1D1D1F);
  -webkit-backdrop-filter: saturate(180%) blur(24px); backdrop-filter: saturate(180%) blur(24px);
  box-shadow: 0 ${L(14)} ${L(44)} rgba(0,0,0,.24), 0 0 0 ${L(0.5)} rgba(0,0,0,.14);
  border: ${L(1)} solid var(--c-edge, transparent);
  pointer-events: auto; font: 400 ${L(13)}/1.35 ${FONT};
  animation: wa-lsheet 220ms cubic-bezier(.2,.8,.3,1) both;
}
.wa-lsheet-head { display: flex; align-items: center; gap: ${L(8)}; padding: ${L(12)} ${L(10)} ${L(8)} ${L(16)}; }
.wa-lsheet-head h3 { flex: 1; margin: 0; font: 600 ${L(17)}/1.2 ${DISPLAY}; letter-spacing: -0.012em; }
.wa-lsheet-head h3 span { font-weight: 400; color: var(--c-ink2, #5E5E63); }
.wa-lseg { display: flex; gap: ${L(2)}; margin: 0 ${L(14)} ${L(8)}; padding: ${L(2)}; border-radius: ${L(9)}; background: var(--c-tonal, #E8E8ED); }
.wa-lseg button {
  appearance: none; flex: 1; height: ${L(28)}; border: 0; border-radius: ${L(7)}; background: transparent; cursor: pointer;
  color: var(--c-ink2, #5E5E63); font: 600 ${L(12.5)}/1 ${FONT};
}
.wa-lseg button[aria-selected="true"] { background: var(--c-raised, #FFFFFF); color: var(--c-ink, #1D1D1F); box-shadow: 0 ${L(1)} ${L(3)} rgba(0,0,0,.14); }
.wa-lseg button[disabled] { opacity: .45; cursor: default; }
.wa-lsheet-body { flex: 1; overflow: auto; overscroll-behavior: contain; padding: 0 ${L(8)} ${L(12)}; }
.wa-lempty { margin: ${L(16)} ${L(8)}; color: var(--c-ink2, #5E5E63); }
.wa-lgrp { margin-top: ${L(8)}; }
.wa-lgrp-h {
  display: flex; align-items: center; gap: ${L(6)}; width: 100%; box-sizing: border-box; padding: ${L(6)} ${L(8)} 0;
  font: 600 ${L(13)}/1.2 ${FONT}; color: var(--c-ink, #1D1D1F); background: none; border: 0; text-align: left;
}
.wa-lgrp-toggle { appearance: none; cursor: pointer; border-radius: ${L(8)}; padding-bottom: ${L(4)}; }
.wa-lgrp-toggle:hover { background: var(--c-tonal, #E8E8ED); }
.wa-lgrp-t { flex: 1; }
.wa-lgrp-n {
  min-width: ${L(20)}; padding: ${L(2)} ${L(6)}; border-radius: 999px; text-align: center; box-sizing: border-box;
  background: var(--c-tonal, #E8E8ED); color: var(--c-ink2, #5E5E63); font-size: ${L(11.5)}; font-variant-numeric: tabular-nums;
}
.wa-lgrp-rule { margin: ${L(2)} ${L(8)} ${L(4)}; font-size: ${L(11.5)}; color: var(--c-ink2, #5E5E63); }
.wa-lrows { list-style: none; margin: 0; padding: 0; display: grid; gap: ${L(1)}; }
.wa-lrow {
  appearance: none; width: 100%; min-height: ${L(44)}; box-sizing: border-box; border: 0; border-radius: ${L(10)};
  display: grid; grid-template-columns: ${L(20)} minmax(0, 1fr) auto; align-items: center; gap: ${L(10)};
  padding: ${L(5)} ${L(10)} ${L(5)} ${L(8)}; background: transparent; color: var(--c-ink, #1D1D1F); text-align: left; cursor: pointer;
  font: 500 ${L(13)}/1.25 ${FONT};
}
.wa-lrow:hover, .wa-lrow[data-hot="true"] { background: var(--c-raised, #FFFFFF); box-shadow: 0 ${L(1)} ${L(3)} rgba(0,0,0,.08); }
.wa-lrow[aria-pressed="true"] { box-shadow: inset 0 0 0 ${L(2)} ${LENS_COLOR.main}; }
.wa-lrow-ic {
  width: ${L(20)}; height: ${L(20)}; border-radius: ${L(6)}; display: inline-grid; place-items: center; color: #FFFFFF;
  background: ${LENS_COLOR.kept};
}
.wa-lrow-ic[data-c="main"] { background: ${LENS_COLOR.main}; }
.wa-lrow-ic[data-c="guarded"] { background: ${LENS_COLOR.guarded}; }
.wa-lrow-ic[data-c="folded"] { background: ${LENS_COLOR.folded}; }
.wa-lrow-ic[data-c="popup"] { background: ${LENS_COLOR.popup}; }
.wa-lrow-ic[data-c="unsure"] { background: #FFFFFF; color: #1D1D1F; box-shadow: inset 0 0 0 ${L(1.25)} #48484A; }
.wa-lrow-ic[data-c="kept"] { background: var(--c-tonal, #E8E8ED); color: var(--c-ink2, #5E5E63); }
.wa-lrow-ic[data-c="pending"] { background: ${LENS_COLOR.pending}; }
.wa-lrow-mid { min-width: 0; display: grid; gap: ${L(5)}; }
.wa-lrow-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wa-lrow-sub { font-size: ${L(11.5)}; font-weight: 400; color: var(--c-ink2, #5E5E63); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wa-lrow-track { position: relative; height: ${L(4)}; border-radius: 999px; background: var(--c-tonal, #E8E8ED); }
.wa-lrow-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; background: #8E8E93; }
.wa-lrow[data-c="main"] .wa-lrow-fill { background: ${LENS_COLOR.main}; }
.wa-lrow[data-c="guarded"] .wa-lrow-fill { background: ${LENS_COLOR.guarded}; }
.wa-lrow[data-c="folded"] .wa-lrow-fill { background: ${LENS_COLOR.folded}; }
.wa-lrow[data-c="popup"] .wa-lrow-fill { background: ${LENS_COLOR.popup}; }
.wa-lrow[data-c="unsure"] .wa-lrow-fill { background: repeating-linear-gradient(90deg, ${LENS_COLOR.folded} 0 ${L(3)}, transparent ${L(3)} ${L(5)}); }
.wa-lrow-tick { position: absolute; top: ${L(-3)}; bottom: ${L(-3)}; width: ${L(1.5)}; margin-left: ${L(-0.75)}; background: var(--c-ink, #1D1D1F); }
.wa-lrow-end { display: inline-flex; align-items: center; gap: ${L(4)}; color: var(--c-ink2, #5E5E63); }
.wa-lrow-p { min-width: ${L(30)}; text-align: right; color: var(--c-ink, #1D1D1F); font-weight: 600; font-variant-numeric: tabular-nums; }

/* ---------- round 9: paragraphs read for this person (outline, gutter tag, sheet section) ---------- */
.wa-lparas { position: absolute; inset: 0; pointer-events: none; }
.wa-lpara {
  position: absolute; left: 0; top: 0; box-sizing: border-box; border-radius: ${L(6)}; will-change: transform;
  border: ${L(1.5)} dashed rgba(134,134,139,.9); box-shadow: 0 0 0 ${L(1)} rgba(255,255,255,.7);
}
.wa-lpara[data-tone="new"] { border: ${L(2)} solid ${PARA_GREEN}; box-shadow: ${IN}, ${OUT}; }
.wa-lpara[data-tone="waiting"] { border: ${L(2)} dashed ${PARA_GREEN}; animation: wa-lpend 1.4s ease-in-out infinite; }
.wa-lpara[data-tone="checked"] { border: ${L(2)} dashed ${LENS_COLOR.folded}; box-shadow: ${IN}, ${OUT}; }
.wa-lpara[data-tone="original"] { border: ${L(2)} solid ${LENS_COLOR.kept}; box-shadow: ${IN}, ${OUT}; }
.wa-lptag {
  position: absolute; left: 0; top: 0; box-sizing: border-box; width: ${L(272)}; height: ${L(42)}; will-change: transform;
  display: grid; align-content: center; gap: ${L(3)}; padding: 0 ${L(10)}; border-radius: ${L(8)};
  color: #FFFFFF; background: ${LENS_COLOR.kept}; font: 400 ${L(11.5)}/1.15 ${FONT}; white-space: nowrap; overflow: hidden;
  box-shadow: 0 0 0 ${L(1)} rgba(255,255,255,.9), 0 ${L(2)} ${L(10)} rgba(0,0,0,.28);
}
.wa-lptag[data-tone="new"], .wa-lptag[data-tone="waiting"] { background: ${PARA_GREEN}; }
.wa-lptag[data-tone="checked"] { background: ${LENS_COLOR.folded}; }
.wa-lptag-top { display: flex; align-items: baseline; gap: ${L(6)}; font-weight: 600; font-size: ${L(12)}; }
.wa-lptag-t { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.wa-lptag-n { flex: none; margin-left: auto; font-weight: 700; font-variant-numeric: tabular-nums; }
.wa-lptag-sub { overflow: hidden; text-overflow: ellipsis; opacity: .92; }
.wa-lens[data-phase="enter"] .wa-lptag { animation: wa-lchip 220ms cubic-bezier(.2,.8,.3,1) both; animation-delay: 200ms; }
.wa-lens[data-motion="reduce"] :is(.wa-lptag, .wa-lpara) { animation: none; }
.wa-lparas-sum h4 { display: flex; align-items: center; gap: ${L(6)}; }
.wa-lparas-sum h4 .wa-lgrp-n { margin-left: auto; font: 600 ${L(11.5)}/1.2 ${FONT}; }
.wa-lrow-ic[data-c="para-new"], .wa-lrow-ic[data-c="para-waiting"] { background: ${PARA_GREEN}; }
.wa-lrow-ic[data-c="para-checked"] { background: ${LENS_COLOR.folded}; }
.wa-lrow-ic[data-c="para-original"] { background: ${LENS_COLOR.kept}; }
.wa-lrow-ic[data-c="para-kept"] { background: var(--c-tonal, #E8E8ED); color: var(--c-ink2, #5E5E63); }
.wa-lrow[data-c="para-new"] .wa-lrow-fill, .wa-lrow[data-c="para-waiting"] .wa-lrow-fill { background: ${PARA_GREEN}; }
.wa-lrow[data-c="para-checked"] .wa-lrow-fill { background: ${LENS_COLOR.folded}; }
.wa-lrow-para .wa-lrow-mid { gap: ${L(4)}; }

/* plain-rule comparison */
.wa-lcmp {
  margin: ${L(4)} ${L(4)} ${L(6)}; padding: ${L(12)} ${L(14)}; border-radius: ${L(14)};
  background: var(--c-raised, #FFFFFF); box-shadow: 0 ${L(1)} ${L(3)} rgba(0,0,0,.08); border: ${L(1)} solid var(--c-edge, transparent);
}
.wa-lcmp h4 { margin: 0 0 ${L(6)}; font: 600 ${L(14)}/1.25 ${DISPLAY}; }
.wa-lcmp ul { margin: 0; padding: 0 0 0 ${L(16)}; display: grid; gap: ${L(4)}; font-size: ${L(13)}; font-variant-numeric: tabular-nums; }
.wa-lcmp-rule { margin: ${L(8)} 0 0; font-size: ${L(12)}; color: var(--c-ink2, #5E5E63); }
.wa-lcmp-foot { margin: ${L(6)} 0 0; font-size: ${L(11.5)}; color: var(--c-ink2, #5E5E63); }

/* raw tab */
.wa-lraw section { margin: ${L(6)} ${L(4)} ${L(14)}; }
.wa-lraw h4 { margin: 0 0 ${L(4)}; font: 600 ${L(13.5)}/1.25 ${DISPLAY}; }
.wa-lraw p { margin: 0 0 ${L(8)}; font-size: ${L(12)}; color: var(--c-ink2, #5E5E63); }
.wa-ltable { display: grid; gap: ${L(1)}; max-height: ${L(220)}; overflow: auto; border-radius: ${L(10)}; background: var(--c-raised, #FFFFFF); padding: ${L(4)}; }
.wa-ltable > div { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, .9fr) auto; gap: ${L(8)}; padding: ${L(4)} ${L(6)}; font-size: ${L(11.5)}; }
.wa-ltable > div:nth-child(odd) { background: var(--c-canvas, #F5F5F7); border-radius: ${L(6)}; }
.wa-ltable span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wa-ltable-l { font-weight: 500; }
.wa-lpick { list-style: none; margin: 0; padding: 0; display: grid; gap: ${L(5)}; }
.wa-lpick li { display: grid; grid-template-columns: minmax(0, 1fr) ${L(80)} ${L(32)}; gap: ${L(8)}; align-items: center; font-size: ${L(12)}; }
.wa-lpick li[data-top="true"] { font-weight: 600; }
.wa-lpick-l { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wa-lpick-bar { position: relative; height: ${L(6)}; border-radius: 999px; background: var(--c-tonal, #E8E8ED); overflow: hidden; }
.wa-lpick-bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; background: ${LENS_COLOR.main}; }
.wa-lpick b { text-align: right; }
.wa-lraw-json-h { display: flex; align-items: center; justify-content: space-between; margin-bottom: ${L(6)}; }
.wa-lraw-json-h h4 { margin: 0; }
.wa-json {
  margin: 0; padding: ${L(12)}; border-radius: ${L(12)}; background: var(--c-raised, #FFFFFF);
  font: 400 ${L(11)}/1.55 ${MONO}; color: var(--c-ink2, #5E5E63); white-space: pre; overflow: auto; max-height: ${L(320)};
  tab-size: 2; user-select: text; -webkit-user-select: text; border: ${L(1)} solid var(--c-edge, transparent);
}
.wa-j-key { color: var(--c-ink, #1D1D1F); font-weight: 600; }
.wa-j-str { color: #1E7B34; }
.wa-j-num { color: #0058B9; }
.wa-j-lit { color: #8A2BB0; }
.wa-root[data-mode="dark"] .wa-j-str { color: #8FCB9B; }
.wa-root[data-mode="dark"] .wa-j-num { color: #6CB4FF; }
.wa-root[data-mode="dark"] .wa-j-lit { color: #D7A6F5; }
.wa-root[data-mode="dark"] .wa-lcard-covered { color: #F2B75E; }
.wa-lens .wa-num { font-variant-numeric: tabular-nums; }
.wa-lsr { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
`;
