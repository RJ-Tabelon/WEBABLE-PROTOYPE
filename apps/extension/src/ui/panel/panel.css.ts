// Owner: P, U. Root theme bridge, the shared controls the Jev view uses, and the WebAble button
// and sheet. Two roots share these rules: the chrome layer (data-layer="ui": button, sheet, dock, cookie bar), which
// is CSS-zoomed so one CSS px is one design pixel at any page zoom (--u is 1px there), and the page layer
// (data-layer="page": the Jev view), which follows page coordinates and sizes with --u.
//
// The button, sheet, note, pop-up card and cookie bar use the --k-* tokens: the onboarding's look (warm off-white,
// near-black ink, one deep green accent) in light mode, the fit's dark and maximum-contrast palettes otherwise.
import { DISPLAY_STACK, FONT_STACK, target, u } from './css-util';
import { logoCss } from '../Logo';

export const rootCss = /* css */ `
${logoCss}
:host { all: initial !important; }
.wa-layer {
  margin: 0; padding: 0; border: 0; inset: 0; width: 100vw; height: 100dvh;
  max-width: none; max-height: none; background: transparent; overflow: visible;
  pointer-events: none; color: inherit; position: fixed; display: block;
}
.wa-layer.wa-nopopover { z-index: 2147483646; }
.wa-root {
  --c-canvas: var(--wa-canvas, #F5F5F7);
  --c-raised: var(--wa-raised, #FFFFFF);
  --c-tonal: var(--wa-tonal, #E8E8ED);
  --c-hover: var(--wa-hover, #DCDCE1);
  --c-press: var(--wa-press, #D2D2D7);
  --c-ink: var(--wa-ink, #1D1D1F);
  --c-ink2: var(--wa-ink-2, #5E5E63);
  --c-line: var(--wa-line, #D2D2D7);
  --c-line-strong: var(--wa-line-strong, #86868B);
  --c-action: var(--wa-action, #0071E3);
  --c-on-action: var(--wa-on-action, #FFFFFF);
  --c-action-hover: var(--wa-action-hover, #0077ED);
  --c-link: var(--wa-link, #0066CC);
  --c-accent: var(--wa-accent, #2D6A3E);
  --c-on-accent: var(--wa-on-accent, #FFFFFF);
  --c-accent-hover: var(--wa-accent-hover, #22552F);
  --c-accent-tint: var(--wa-accent-tint, #E4EFE6);
  --c-warn: var(--wa-warning, #7A4800);
  --c-warn-tint: var(--wa-warning-tint, #FAEFD9);
  --c-focus: var(--wa-focus, #0071E3);
  --c-glass: var(--wa-glass, rgba(255, 255, 255, 0.78));
  --c-sheet: rgba(245, 245, 247, 0.9);
  --c-shadow-card: var(--wa-shadow-card, 0 1px 2px rgba(0,0,0,.04), 0 6px 20px rgba(0,0,0,.06));
  --c-shadow-float: var(--wa-shadow-float, 0 12px 40px rgba(0,0,0,.16));
  --c-edge: var(--wa-edge-color, transparent);

  --k-card: #FFFFFF;
  --k-canvas: #F5F4F0;
  --k-ink: #16150F;
  --k-ink2: #5E5C55;
  --k-ink3: #8B8880;
  --k-line: #E6E3DC;
  --k-line-strong: #D4D0C6;
  --k-accent: #17694A;
  --k-accent-tint: #E6F1EB;
  --k-on-ink: #FFFFFF;
  --k-edge: transparent;
  --k-shadow: 0 1px 2px rgba(22,21,15,.05), 0 18px 48px rgba(22,21,15,.14);
  --k-shadow-btn: 0 1px 2px rgba(22,21,15,.08), 0 8px 24px rgba(22,21,15,.14);
  --k-ease: cubic-bezier(.2,.8,.2,1);

  font-family: ${FONT_STACK};
  font-size: ${u(15)};
  line-height: 1.45;
  color: var(--c-ink);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  font-kerning: normal;
  letter-spacing: 0;
  text-align: left;
  pointer-events: none;
}
.wa-root[data-mode="dark"] {
  --c-canvas: var(--wa-canvas, #000000);
  --c-raised: var(--wa-raised, #1C1C1E);
  --c-tonal: var(--wa-tonal, #2C2C2E);
  --c-hover: var(--wa-hover, #3A3A3C);
  --c-press: var(--wa-press, #48484A);
  --c-ink: var(--wa-ink, #F5F5F7);
  --c-ink2: var(--wa-ink-2, #A1A1A6);
  --c-line: var(--wa-line, #38383A);
  --c-line-strong: var(--wa-line-strong, #8E8E93);
  --c-link: var(--wa-link, #2997FF);
  --c-accent: var(--wa-accent, #8FCB9B);
  --c-on-accent: var(--wa-on-accent, #0F1A12);
  --c-accent-hover: var(--wa-accent-hover, #A9D9B2);
  --c-accent-tint: var(--wa-accent-tint, #1B2B1F);
  --c-warn: var(--wa-warning, #F2B75E);
  --c-warn-tint: var(--wa-warning-tint, #2E2412);
  --c-focus: var(--wa-focus, #2997FF);
  --c-glass: var(--wa-glass, rgba(22, 22, 23, 0.82));
  --c-sheet: rgba(28, 28, 30, 0.92);
  --c-shadow-card: none;
  --c-shadow-float: var(--wa-shadow-float, 0 12px 40px rgba(0,0,0,.6));

  --k-card: #1C1C1E; --k-canvas: #2C2C2E; --k-ink: #F5F5F7; --k-ink2: #A1A1A6; --k-ink3: #8E8E93;
  --k-line: #38383A; --k-line-strong: #636366; --k-accent: #8FCB9B; --k-accent-tint: #1B2B1F; --k-on-ink: #1C1C1E;
  --k-edge: #38383A; --k-shadow: 0 18px 48px rgba(0,0,0,.6); --k-shadow-btn: 0 8px 24px rgba(0,0,0,.5);
}
.wa-root[data-mode="max"] {
  --c-canvas: var(--wa-canvas, #FFFFFF); --c-raised: var(--wa-raised, #FFFFFF); --c-tonal: var(--wa-tonal, #F0F0F0);
  --c-hover: var(--wa-hover, #E2E2E2); --c-press: var(--wa-press, #D4D4D4);
  --c-ink: var(--wa-ink, #000000); --c-ink2: var(--wa-ink-2, #000000);
  --c-line: var(--wa-line, #000000); --c-line-strong: var(--wa-line-strong, #000000);
  --c-action: var(--wa-action, #0040DD); --c-action-hover: var(--wa-action-hover, #0033B8); --c-link: var(--wa-link, #0040DD);
  --c-focus: var(--wa-focus, #000000);
  --c-accent: var(--wa-accent, #1F4D2B); --c-accent-hover: var(--wa-accent-hover, #163A20); --c-accent-tint: var(--wa-accent-tint, #E4EFE6);
  --c-warn: var(--wa-warning, #5C3600); --c-warn-tint: var(--wa-warning-tint, #FAEFD9);
  --c-glass: var(--wa-glass, rgba(255,255,255,.97)); --c-sheet: var(--wa-raised, #FFFFFF);
  --c-shadow-card: none; --c-shadow-float: var(--wa-shadow-float, none);
  --c-edge: var(--wa-edge-color, #000000);

  --k-card: #FFFFFF; --k-canvas: #FFFFFF; --k-ink: #000000; --k-ink2: #000000; --k-ink3: #000000;
  --k-line: #000000; --k-line-strong: #000000; --k-accent: #0B4D33; --k-accent-tint: #FFFFFF; --k-on-ink: #FFFFFF;
  --k-edge: #000000; --k-shadow: none; --k-shadow-btn: none;
}
.wa-root *, .wa-root *::before, .wa-root *::after { box-sizing: border-box; }
:where(.wa-root) button { font: inherit; color: inherit; letter-spacing: inherit; }
.wa-root :focus { outline: none; }
.wa-root :focus-visible {
  outline: ${u(3)} solid var(--c-focus);
  outline-offset: ${u(2)};
}
/* Headings take focus only so screen readers start there; they are not controls, so no ring. */
.wa-root [tabindex="-1"]:focus-visible { outline: none; }
.wa-sr {
  position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.wa-num { font-variant-numeric: tabular-nums; }

/* ---------- shared buttons (the Jev view and the simplified page) ---------- */
.wa-btn {
  appearance: none; -webkit-appearance: none;
  display: inline-flex; align-items: center; justify-content: center; gap: ${u(8)};
  min-height: ${target()}; min-width: ${target()};
  padding: 0 ${u(18)};
  border: ${u(1)} solid var(--c-edge); border-radius: 999px;
  background: var(--c-tonal); color: var(--c-ink);
  font-size: ${u(15)}; font-weight: 500; line-height: 1.2; white-space: nowrap;
  cursor: pointer; user-select: none; -webkit-user-select: none;
  transition: background-color 160ms ease, color 160ms ease, box-shadow 160ms ease;
  pointer-events: auto;
}
.wa-btn:hover { background: var(--c-hover); }
.wa-btn:active { background: var(--c-press); }
.wa-btn[disabled] { opacity: 0.55; cursor: default; }
.wa-btn[aria-pressed="true"]:not(.wa-btn-primary):not(.wa-btn-accent) { background: var(--c-ink); color: var(--c-raised); }
.wa-btn-primary { background: var(--c-action); color: var(--c-on-action); }
.wa-btn-primary:hover { background: var(--c-action-hover); }
.wa-btn-primary:active { background: var(--c-action); }
.wa-btn-accent { background: var(--c-accent); color: var(--c-on-accent); }
.wa-btn-accent:hover { background: var(--c-accent-hover); }
.wa-btn-quiet { background: transparent; color: var(--c-link); padding: 0 ${u(10)}; }
.wa-btn-quiet:hover { background: var(--c-tonal); }
.wa-btn-block { width: 100%; }
.wa-btn-sm { min-height: max(${u(34)}, calc(0.8 * var(--wa-target, 44px))); min-width: 0; padding: 0 ${u(14)}; font-size: ${u(14)}; }
.wa-iconbtn {
  appearance: none; display: inline-grid; place-items: center;
  width: max(${u(36)}, calc(0.8 * var(--wa-target, 44px))); height: max(${u(36)}, calc(0.8 * var(--wa-target, 44px)));
  border: ${u(1)} solid var(--c-edge); border-radius: 999px; background: var(--c-tonal); color: var(--c-ink2);
  cursor: pointer; pointer-events: auto; transition: background-color 160ms ease, color 160ms ease;
  flex: none;
}
.wa-iconbtn:hover { background: var(--c-hover); color: var(--c-ink); }
.wa-link {
  appearance: none; background: none; border: 0; padding: ${u(4)} ${u(2)}; margin: 0;
  color: var(--c-link); font-size: ${u(14)}; font-weight: 500; cursor: pointer; pointer-events: auto;
  text-decoration: none; border-radius: ${u(6)};
}
.wa-link:hover { text-decoration: underline; text-underline-offset: ${u(3)}; }
.wa-dot { position: relative; width: ${u(10)}; height: ${u(10)}; border-radius: 999px; background: var(--c-line-strong); flex: none; }
.wa-dot[data-state="changed"] { background: var(--c-accent); }
.wa-chip {
  display: inline-flex; align-items: center; max-width: 100%;
  padding: ${u(2)} ${u(9)}; border-radius: 999px; font-size: ${u(12)}; font-weight: 500; line-height: 1.45;
  background: var(--c-tonal); color: var(--c-ink2); border: ${u(1)} solid var(--c-edge);
}
.wa-empty { padding: ${u(14)} ${u(12)}; font-size: ${u(14)}; color: var(--c-ink2); }
.wa-shimmer {
  display: inline-block; height: ${u(12)}; border-radius: ${u(6)}; width: 60%;
  background: linear-gradient(90deg, var(--c-tonal) 0%, var(--c-hover) 50%, var(--c-tonal) 100%);
  background-size: 200% 100%; animation: wa-shimmer 1.3s linear infinite;
}
@keyframes wa-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@keyframes wa-rise { from { opacity: 0; transform: translateY(${u(10)}) scale(.98); } to { opacity: 1; transform: none; } }
@keyframes wa-k-in { from { opacity: 0; transform: translateY(${u(8)}); } to { opacity: 1; transform: none; } }

/* ---------- the WebAble button: a circle with the shared three-piece logo ---------- */
.wa-fab {
  position: relative; flex: none; appearance: none; margin: 0; padding: 0;
  display: grid; place-items: center;
  width: max(${u(52)}, var(--wa-target, 44px)); height: max(${u(52)}, var(--wa-target, 44px));
  border-radius: 50%; border: ${u(1)} solid var(--k-edge);
  background: var(--k-card); color: var(--k-ink); box-shadow: var(--k-shadow-btn);
  cursor: pointer; pointer-events: auto;
  transition: transform 200ms var(--k-ease), background-color 200ms var(--k-ease);
}
.wa-fab:hover { background: var(--k-canvas); }
.wa-fab:active { transform: scale(.96); }
.wa-fab[aria-expanded="true"] { background: var(--k-canvas); }
.wa-fab .wa-logo { width: ${u(32)}; height: ${u(32)}; }
.wa-fab[data-state="paused"] .wa-logo, .wa-fab[data-state="off"] .wa-logo { color: var(--k-ink3); }
.wa-fab[data-changed] { border-color: var(--k-accent); }

/* ---------- the sheet: a white card above the button ---------- */
.wa-sheet {
  position: relative; flex: 0 1 auto; min-height: 0;
  width: min(${u(360)}, calc(var(--wa-vw, 100vw) - ${u(40)}));
  display: flex; flex-direction: column;
  border-radius: ${u(24)}; border: ${u(1)} solid var(--k-edge);
  background: var(--k-card); color: var(--k-ink); box-shadow: var(--k-shadow);
  font-size: ${u(16)}; line-height: ${u(22)};
  max-height: calc(var(--wa-vh, 100vh) - ${u(180)}); overflow-y: auto;
  pointer-events: auto; overflow-x: hidden;
  animation: wa-sheet-in 200ms var(--k-ease) both; transform-origin: bottom right;
}
.wa-sheet[data-side="left"] { transform-origin: bottom left; }
@keyframes wa-sheet-in { from { opacity: 0; transform: translateY(${u(8)}) scale(.98); } to { opacity: 1; transform: none; } }
.wa-fab:focus-visible, .wa-sheet :focus-visible, .wa-note :focus-visible, .wa-offer :focus-visible, .wa-cbar :focus-visible {
  outline: ${u(3)} solid var(--k-accent); outline-offset: ${u(3)};
}
.wa-sheet [tabindex="-1"]:focus-visible { outline: none; }

.wa-sh-head { flex: none; display: flex; align-items: flex-start; gap: ${u(12)}; padding: ${u(20)} ${u(16)} 0 ${u(20)}; }
.wa-sh-title { flex: 1; min-width: 0; }
.wa-sh-title h2 {
  display: flex; align-items: center; gap: ${u(8)};
  margin: 0; font-family: ${DISPLAY_STACK}; font-size: ${u(17)}; line-height: ${u(22)}; font-weight: 600;
  letter-spacing: -0.01em; color: var(--k-ink);
}
.wa-sh-title p {
  margin: ${u(2)} 0 0; font-size: ${u(15)}; line-height: ${u(20)}; color: var(--k-ink2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wa-sh-x {
  position: relative; flex: none; appearance: none; margin: ${u(-4)} 0 0; padding: 0;
  display: grid; place-items: center; width: ${u(36)}; height: ${u(36)}; border-radius: 50%;
  border: 0; background: var(--k-canvas); color: var(--k-ink2); cursor: pointer;
  transition: color 200ms var(--k-ease);
}
.wa-sh-x::after { content: ""; position: absolute; inset: ${u(-6)}; border-radius: 50%; }
.wa-sh-x:hover { color: var(--k-ink); }

.wa-sh-body {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  padding: ${u(16)} ${u(20)} ${u(4)}; display: flex; flex-direction: column;
}
.wa-sh-sec { display: flex; flex-direction: column; }
.wa-sh-sec + .wa-sh-sec { margin-top: ${u(16)}; padding-top: ${u(16)}; border-top: ${u(1)} solid var(--k-line); }

/* Simplified | Original */
.wa-seg2 { display: grid; grid-template-columns: 1fr 1fr; gap: ${u(4)}; padding: ${u(4)}; border-radius: 999px; background: var(--k-canvas); }
.wa-seg2 button {
  appearance: none; margin: 0; border: 0; border-radius: 999px;
  min-height: max(${u(44)}, calc(var(--wa-target, 44px) - ${u(8)}));
  background: transparent; color: var(--k-ink2); font-size: ${u(16)}; font-weight: 600; cursor: pointer;
  transition: background-color 200ms var(--k-ease), color 200ms var(--k-ease), box-shadow 200ms var(--k-ease);
}
.wa-seg2 button:hover { color: var(--k-ink); }
.wa-seg2 button[aria-pressed="true"] {
  background: var(--k-card); color: var(--k-ink);
  box-shadow: 0 1px 2px rgba(22,21,15,.08), 0 2px 8px rgba(22,21,15,.06), 0 0 0 ${u(1)} var(--k-edge);
}
.wa-root[data-mode="max"] .wa-seg2 { box-shadow: inset 0 0 0 ${u(2)} #000000; }
.wa-root[data-mode="max"] .wa-seg2 button[aria-pressed="true"] { background: #000000; color: #FFFFFF; }

/* Text size − Aa + (a word level under the sample, never px) */
.wa-sh-size { display: flex; align-items: center; justify-content: space-between; gap: ${u(12)}; }
.wa-sh-label { font-size: ${u(16)}; font-weight: 600; color: var(--k-ink); }
.wa-stepper { display: flex; align-items: center; gap: ${u(4)}; }
.wa-step {
  appearance: none; margin: 0; padding: 0; display: grid; place-items: center;
  width: max(${u(44)}, var(--wa-target, 44px)); height: max(${u(44)}, var(--wa-target, 44px)); border-radius: 50%;
  border: ${u(1)} solid var(--k-line-strong); background: var(--k-card); color: var(--k-ink); cursor: pointer;
  transition: background-color 200ms var(--k-ease), transform 200ms var(--k-ease);
}
.wa-step:hover { background: var(--k-canvas); }
.wa-step:active { transform: scale(.94); }
.wa-step-val {
  min-width: ${u(96)}; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${u(2)};
  text-align: center; color: var(--k-ink); white-space: nowrap;
}
.wa-step-aa { display: block; font-weight: 600; line-height: 1.05; color: var(--k-ink); }
.wa-step-word { display: block; font-size: ${u(14)}; line-height: ${u(18)}; font-weight: 600; color: var(--k-accent); }
.wa-sh-note { margin: ${u(10)} 0 0; font-size: ${u(15)}; line-height: ${u(21)}; color: var(--k-ink2); }

/* What WebAble did here */
.wa-sh-h { margin: 0 0 ${u(4)}; font-size: ${u(15)}; line-height: ${u(20)}; font-weight: 600; color: var(--k-ink2); }
.wa-did-list { list-style: none; margin: 0; padding: 0; }
.wa-did { display: flex; align-items: center; gap: ${u(12)}; min-height: ${u(48)}; }
.wa-did-ic { flex: none; display: grid; place-items: center; width: ${u(20)}; color: var(--k-accent); }
.wa-did-t { flex: 1; min-width: 0; padding: ${u(6)} 0; font-size: ${u(16)}; line-height: ${u(22)}; color: var(--k-ink); text-wrap: pretty; }
.wa-did-act {
  appearance: none; flex: none; margin: 0 ${u(-8)} 0 0; border: 0; background: none;
  min-height: ${u(44)}; padding: 0 ${u(8)}; border-radius: ${u(10)};
  font-size: ${u(15)}; font-weight: 600; color: var(--k-ink2); cursor: pointer;
}
.wa-did-act:hover { color: var(--k-ink); text-decoration: underline; text-underline-offset: ${u(3)}; }
.wa-did-switch { padding-left: ${u(32)}; min-height: ${u(44)}; font-size: ${u(15)}; font-weight: 500; color: var(--k-ink2); }
.wa-did-switch[aria-checked="true"] { color: var(--k-ink); }
.wa-sh-quiet { margin: ${u(6)} 0 0; font-size: ${u(16)}; line-height: ${u(22)}; color: var(--k-ink2); }
.wa-sh-sec > .wa-sh-quiet:first-child { margin-top: 0; }
.wa-sh-quiet-top { margin: 0 0 ${u(8)}; }
.wa-sh-text {
  appearance: none; align-self: flex-start; margin: ${u(4)} 0 0 ${u(-8)}; border: 0; background: none;
  min-height: ${u(44)}; padding: 0 ${u(8)}; border-radius: ${u(10)};
  font-size: ${u(16)}; font-weight: 600; color: var(--k-ink); cursor: pointer;
  text-decoration: underline; text-underline-offset: ${u(3)};
}

/* Pause on this site */
.wa-sh-switch {
  appearance: none; margin: 0; padding: 0; border: 0; background: none; width: 100%;
  display: flex; align-items: center; justify-content: space-between; gap: ${u(12)};
  min-height: ${u(48)}; text-align: left; cursor: pointer;
  font-size: ${u(16)}; font-weight: 600; color: var(--k-ink);
}
.wa-sh-track {
  flex: none; position: relative; width: ${u(51)}; height: ${u(31)}; border-radius: 999px;
  background: var(--k-line-strong); transition: background-color 200ms var(--k-ease);
}
.wa-sh-track::after {
  content: ""; position: absolute; top: ${u(2)}; left: ${u(2)}; width: ${u(27)}; height: ${u(27)}; border-radius: 50%;
  background: #FFFFFF; box-shadow: 0 1px 3px rgba(0,0,0,.2), 0 2px 6px rgba(0,0,0,.08);
  transition: transform 200ms var(--k-ease);
}
.wa-sh-switch[aria-checked="true"] .wa-sh-track { background: var(--k-ink); }
.wa-sh-switch[aria-checked="true"] .wa-sh-track::after { transform: translateX(${u(20)}); }
.wa-root[data-mode="dark"] .wa-sh-switch[aria-checked="true"] .wa-sh-track::after { background: var(--k-card); }
.wa-root[data-mode="max"] .wa-sh-track { background: #FFFFFF; box-shadow: inset 0 0 0 ${u(2)} #000000; }
.wa-root[data-mode="max"] .wa-sh-track::after { background: #000000; box-shadow: none; }
.wa-root[data-mode="max"] .wa-sh-switch[aria-checked="true"] .wa-sh-track { background: #000000; }
.wa-root[data-mode="max"] .wa-sh-switch[aria-checked="true"] .wa-sh-track::after { background: #FFFFFF; }

/* How WebAble read this page · Your settings */
.wa-sh-foot {
  flex: none; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0 ${u(12)};
  margin: ${u(12)} ${u(20)} 0; padding: ${u(4)} 0 ${u(8)}; border-top: ${u(1)} solid var(--k-line);
}
.wa-sh-link {
  appearance: none; margin: 0 ${u(-6)}; border: 0; background: none; min-height: ${u(44)}; padding: 0 ${u(6)};
  border-radius: ${u(10)}; font-size: ${u(15)}; font-weight: 500; color: var(--k-ink2); cursor: pointer; white-space: nowrap;
}
.wa-sh-link:hover { color: var(--k-ink); text-decoration: underline; text-underline-offset: ${u(3)}; }

/* ---------- the simplified page's loading screen ---------- */
.wa-calm-loading {
  position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; pointer-events: auto;
  background: var(--k-card); color: var(--k-ink);
}
.wa-calm-loading-card { display: grid; gap: ${u(16)}; justify-items: center; text-align: center; padding: ${u(32)}; max-width: ${u(480)}; }
.wa-calm-loading-card h2 { margin: 0; font-family: ${DISPLAY_STACK}; font-size: ${u(30)}; line-height: ${u(36)}; font-weight: 600; letter-spacing: -0.02em; }
.wa-calm-loading-card p { margin: 0; font-size: ${u(18)}; line-height: ${u(28)}; color: var(--k-ink2); }
.wa-calm-loading-card .wa-kbtn { margin-top: ${u(8)}; }
.wa-spinner {
  width: ${u(34)}; height: ${u(34)}; border-radius: 999px; border: ${u(3)} solid var(--k-line);
  border-top-color: var(--k-accent); animation: wa-spin 900ms linear infinite;
}
@keyframes wa-spin { to { transform: rotate(360deg); } }

/* ---------- motion off ----------
   Reduced motion: no movement anywhere. The Jev view keeps its staggered cross-fade (opacity only), which is not motion. */
.wa-root[data-motion="reduce"] :not(.wa-lchip):not(.wa-lbox):not(.wa-lrow),
.wa-root[data-motion="reduce"] ::before, .wa-root[data-motion="reduce"] ::after {
  animation-duration: 1ms !important; animation-iteration-count: 1 !important;
  transition-duration: 1ms !important; scroll-behavior: auto !important;
}
.wa-root[data-motion="reduce"] .wa-lchip, .wa-root[data-motion="reduce"] .wa-lrow { animation-name: wa-lfade; }
.wa-root[data-motion="reduce"] .wa-lbox[data-v="pending"], .wa-root[data-motion="reduce"] .wa-lchip[data-v="pending"] { animation: none; }
@media (prefers-reduced-motion: reduce) {
  .wa-root :not(.wa-lchip):not(.wa-lbox):not(.wa-lrow), .wa-root ::before, .wa-root ::after {
    animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important;
  }
  .wa-root .wa-lchip, .wa-root .wa-lrow { animation-name: wa-lfade; }
}
`;
