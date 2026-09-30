import { OFF_ATTR, sel } from './marks';

/**
 * Shared CSS. The profile-level blocks here are also shipped as static files
 * in public/prepaint/ (registered by the service worker to run before first
 * paint); a unit test keeps the two identical.
 *
 * BOOST raises specificity by (3,0,0) without matching anything extra, so a
 * WebAble rule wins over ordinary page `!important` rules that use ids
 * (engine.md 3.2 "Specificity and layers"). Page rules inside @layer with
 * !important still win; that is accepted and caught by verification.
 */
export const BOOST = ':not(#_wa_#_wa_#_wa_)';

/** Document-scope gate: pre-paint rules stand down per op or when paused. */
export const gate = (op: string): string =>
  `:where(html:not([${OFF_ATTR}~="${op}"]):not([${OFF_ATTR}~="all"]))`;

/** Focus outline: ink ring with a white casing on both sides, readable on any background. */
export function focusOutlineCss(
  widthPx: number,
  scope: 'doc' | 'shadow',
): string {
  const w = Math.max(2, Math.min(6, Math.round(widthPx)));
  const halo = w + 4; // 2 px white inside the offset gap + 2 px outside the ring
  const prefix = scope === 'doc' ? `${gate('focus_outline')} ` : '';
  return [
    `${prefix}:focus-visible${BOOST} {`,
    `  outline: ${w}px solid #1a1a17 !important;`,
    `  outline-offset: 2px !important;`,
    `  box-shadow: 0 0 0 ${halo}px #ffffff !important;`,
    `}`,
  ].join('\n');
}

/**
 * Motion reset (engine.md 3.4.8): durations to ~0 and one iteration, so
 * entry animations land on their end state (never frozen invisible) and
 * animationend still fires for page state machines.
 */
export function calmMotionCss(scope: 'doc' | 'shadow'): string {
  const p = scope === 'doc' ? `${gate('calm_motion')} ` : '';
  // In the document scope the root itself is included (smooth scrolling lives there).
  const root = scope === 'doc' ? `${gate('calm_motion')}, ` : '';
  return [
    `${root}${p}*${BOOST}, ${p}*${BOOST}::before, ${p}*${BOOST}::after {`,
    `  animation-duration: 0.001ms !important;`,
    `  animation-iteration-count: 1 !important;`,
    `  animation-delay: 0s !important;`,
    `  transition-duration: 0.001ms !important;`,
    `  transition-delay: 0s !important;`,
    `  scroll-behavior: auto !important;`,
    `}`,
  ].join('\n');
}

/** Contents of public/prepaint/*.css (the level is fixed: 3 px ring). */
export const PREPAINT_FILES = {
  'focus-outline.css': () => focusOutlineCss(3, 'doc'),
  'calm-motion.css': () => calmMotionCss('doc'),
} as const;

/** The mark selector for an internal token, with the specificity boost. */
export const tok = (t: string): string => `${sel(t)}${BOOST}`;
