/**
 * In-page layer styles (design-final.md 7.14, 7.17, 8, 14 "Layer" density).
 * Token values are copied from packages/tokens/src/tokens.css because the
 * layer lives in a closed shadow root on someone else's page: no web fonts,
 * no page variables. A unit test fails if these drift from tokens.css.
 */

export const LAYER_TOKENS = {
  light: {
    '--surface-raised': '#FFFFFF',
    '--surface-hover': '#E9E8E2',
    '--surface-press': '#DFDED7',
    '--surface-inverse': '#1F1F1C',
    '--surface-inverse-hover': '#34342F',
    '--canvas': '#FAFAF7',
    '--ink': '#1A1A17',
    '--ink-2': '#45443E',
    '--on-inverse': '#F3F2EC',
    '--on-inverse-2': '#C9C8C0',
    '--on-inverse-accent': '#9DD1A6',
    '--line-strong': '#7D7C73',
    '--accent': '#2D6A3E',
    '--action': '#1A1A17',
    '--action-hover': '#3A3934',
    '--action-press': '#000000',
    '--on-action': '#FFFFFF',
    '--focus': '#1A1A17',
    '--focus-inverse': '#F3F2EC',
  },
  dark: {
    '--surface-raised': '#1C1C19',
    '--surface-hover': '#2C2C28',
    '--surface-press': '#35352F',
    '--surface-inverse': '#EDECE6',
    '--surface-inverse-hover': '#D6D5CE',
    '--canvas': '#141412',
    '--ink': '#EDECE6',
    '--ink-2': '#C9C8BF',
    '--on-inverse': '#141412',
    '--on-inverse-2': '#45443E',
    '--on-inverse-accent': '#2D6A3E',
    '--line-strong': '#85847B',
    '--accent': '#8FCB9B',
    '--action': '#EDECE6',
    '--action-hover': '#FFFFFF',
    '--action-press': '#D3D2CA',
    '--on-action': '#141412',
    '--focus': '#EDECE6',
    '--focus-inverse': '#141412',
  },
  /** Fixed in both themes (in-page marks always use the light accent). */
  fixed: {
    '--inpage-accent': '#2D6A3E',
    '--inpage-casing': '#FFFFFF',
    '--z-inpage': '2147483600',
  },
} as const;

const vars = (o: Readonly<Record<string, string>>): string =>
  Object.entries(o)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ');

export function layerCss(): string {
  return `
:host {
  all: initial !important;
  display: block !important;
  position: fixed !important;
  inset: 0 !important;
  width: auto !important;
  height: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  overflow: visible !important;
  pointer-events: none !important;
  z-index: 2147483600 !important;
  color-scheme: light dark;
  ${vars(LAYER_TOKENS.light)}
  ${vars(LAYER_TOKENS.fixed)}
  --fit-fill: rgb(45 106 62 / 0.06);
  --elev-inpage: 0 0 0 1px var(--line-strong), 0 2px 4px rgb(26 26 23 / 0.10), 0 16px 40px -12px rgb(26 26 23 / 0.36);
  --font-layer: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --weight-medium: 540;
  --ease: cubic-bezier(0.22, 0.8, 0.26, 1);
  --dur-1: 100ms;
  --dur-3: 220ms;
  --shift-2: 8px;
}
@media (prefers-color-scheme: dark) {
  :host {
    ${vars(LAYER_TOKENS.dark)}
    --elev-inpage: 0 0 0 1px var(--line-strong), 0 16px 40px -12px rgb(0 0 0 / 0.60);
    --weight-medium: 520;
  }
}
*, *::before, *::after { box-sizing: border-box; }
.wa-sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
}

/* ---------- Surfaces: chip and toast (bottom-right, 16 px) ---------- */
.wa-stack {
  position: fixed; right: 16px; bottom: 16px; z-index: 2;
  display: flex; flex-direction: column; align-items: stretch; gap: 8px;
  width: min(25rem, calc(100vw - 32px));
  font-family: var(--font-layer); font-size: 16px; line-height: 1.5; font-weight: 400;
  letter-spacing: 0; text-align: start; direction: ltr;
}
.wa-stack[data-side="left"] { right: auto; left: 16px; }
.wa-stack[data-side="top"] { bottom: auto; top: 16px; }
.wa-chip, .wa-toast {
  pointer-events: auto;
  border-radius: 12px;
  box-shadow: var(--elev-inpage);
  animation: wa-in var(--dur-3) var(--ease) both;
}
.wa-chip {
  container-type: inline-size;
  background: var(--surface-raised);
  color: var(--ink);
  padding: 16px;
  display: grid;
  grid-template-columns: 1fr 44px;
  column-gap: 8px;
  row-gap: 4px;
  box-shadow: inset 3px 0 0 var(--inpage-accent), var(--elev-inpage);
}
/* Source line: the mark and "WebAble", 4 px above the question. */
.wa-chip__src {
  grid-column: 1; grid-row: 1; margin: 0;
  display: flex; align-items: center; gap: 6px;
  font-size: 15px; line-height: 1.45; font-weight: var(--weight-medium); color: var(--ink-2);
}
.wa-chip__src svg { flex: none; }
.wa-chip__q { grid-column: 1; grid-row: 2; margin: 0; font-size: 16px; font-weight: var(--weight-medium); line-height: 1.4; }
.wa-chip__why { grid-column: 1 / -1; margin: 0; font-size: 15px; line-height: 1.45; color: var(--ink-2); }
/* Centred on the source line. */
.wa-chip__close { grid-column: 2; grid-row: 1 / span 2; justify-self: end; align-self: start; margin-top: -11px; }
.wa-chip__actions {
  grid-column: 1 / -1; margin-top: 12px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
}
@container (max-width: 21.25rem) { .wa-chip__actions { grid-template-columns: 1fr; } }

.wa-toast {
  display: flex; align-items: center; gap: 12px;
  min-height: 56px;
  padding: 6px 8px 6px 16px;
  background: var(--surface-inverse);
  color: var(--on-inverse);
  --focus: var(--focus-inverse);
}
.wa-toast__check { flex: none; color: var(--on-inverse-accent); }
.wa-toast__msg { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 16px; line-height: 1.45; }

/* ---------- Buttons (md: 44 px, pill) ---------- */
.wa-btn {
  appearance: none; margin: 0;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 44px; min-width: 44px; padding: 0 16px;
  border-radius: 999px; border: 1px solid transparent;
  font: inherit; font-size: 16px; font-weight: var(--weight-medium); line-height: 1.25;
  cursor: pointer; white-space: nowrap;
  transition: background-color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease);
}
.wa-btn--primary { background: var(--action); color: var(--on-action); }
.wa-btn--secondary { background: transparent; color: var(--ink); border-color: var(--line-strong); }
.wa-btn--inverse { background: transparent; color: var(--on-inverse); border-color: var(--on-inverse-2); }
.wa-icon-btn {
  appearance: none; margin: 0; padding: 0;
  display: inline-grid; place-items: center;
  width: 44px; height: 44px; border-radius: 999px; border: 1px solid transparent;
  background: transparent; color: var(--ink-2); cursor: pointer;
}
.wa-toast .wa-icon-btn { color: var(--on-inverse-2); }
@media (hover: hover) and (pointer: fine) {
  .wa-btn--primary:hover { background: var(--action-hover); }
  .wa-btn--secondary:hover, .wa-chip .wa-icon-btn:hover { background: var(--surface-hover); color: var(--ink); }
  .wa-btn--inverse:hover, .wa-toast .wa-icon-btn:hover { background: var(--surface-inverse-hover); color: var(--on-inverse); }
}
.wa-btn--primary:active { background: var(--action-press); }
.wa-btn--secondary:active { background: var(--surface-press); }
@media (prefers-reduced-motion: no-preference) {
  :host(:not([data-motion="reduce"])) .wa-btn:active,
  :host(:not([data-motion="reduce"])) .wa-icon-btn:active { transform: translateY(1px); }
}
:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
  box-shadow: 0 0 0 7px var(--surface-raised);
}
.wa-toast :focus-visible { box-shadow: 0 0 0 7px var(--surface-inverse); }

/* ---------- Show on page: ghost and fit outlines (design-final.md 8) ----------
   Fit outlines are drawn 4 px outside the element, so strokes never cross its
   text. Only targets get a ghost and a tint; text blocks get the outline. */
.wa-marks { position: fixed; inset: 0; pointer-events: none; z-index: 1; }
.wa-ghost, .wa-fit {
  position: fixed; pointer-events: none; border-radius: 0;
}
.wa-ghost {
  border: 1px dashed #1A1A17;
  box-shadow: 0 0 0 1px var(--inpage-casing), inset 0 0 0 1px var(--inpage-casing);
}
.wa-fit {
  border: 2px solid var(--inpage-accent);
  box-shadow: 0 0 0 1px var(--inpage-casing), inset 0 0 0 1px var(--inpage-casing);
}
.wa-fit--fill { background: var(--fit-fill); }
.wa-tag {
  position: fixed; pointer-events: none;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 6px; border-radius: 4px;
  background: var(--canvas); color: var(--ink);
  box-shadow: 0 0 0 1px var(--line-strong);
  font-family: var(--font-layer); font-size: 15px; line-height: 1.45; white-space: nowrap;
}
.wa-tag__label { font-weight: var(--weight-medium); }
.wa-fitmark { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: 15px; }
.wa-fitmark__before { color: var(--ink-2); }
.wa-fitmark__after { color: var(--accent); font-weight: var(--weight-medium); }
.wa-fitmark svg { color: var(--ink-2); }

/* ---------- Reading guide ---------- */
.wa-guide { position: fixed; inset: 0; pointer-events: none; }
.wa-shade { position: fixed; left: 0; right: 0; background: rgb(26 26 23 / 0.28); }
.wa-shade--top { top: 0; }
.wa-shade--bottom { bottom: 0; }

/* ---------- Frozen animated images ---------- */
.wa-frozen { position: fixed; pointer-events: none; }

@keyframes wa-in {
  from { opacity: 0; transform: translateY(var(--shift-2)); }
  to { opacity: 1; transform: none; }
}
/* Reduced motion: the OS setting, or WebAble's own (data-motion on the host). */
@media (prefers-reduced-motion: reduce) {
  .wa-chip, .wa-toast { animation: wa-fade 100ms linear both; }
  .wa-btn, .wa-icon-btn { transition: none; }
}
:host([data-motion="reduce"]) .wa-chip, :host([data-motion="reduce"]) .wa-toast { animation: wa-fade 100ms linear both; }
:host([data-motion="reduce"]) .wa-btn, :host([data-motion="reduce"]) .wa-icon-btn { transition: none; }
@keyframes wa-fade { from { opacity: 0; } to { opacity: 1; } }
@media (forced-colors: active) {
  .wa-chip, .wa-toast, .wa-tag { border: 1px solid CanvasText; }
  .wa-btn { border-color: ButtonText; }
  .wa-fit { border-color: Highlight; background: transparent; }
  :focus-visible { outline-color: Highlight; }
}
`;
}
