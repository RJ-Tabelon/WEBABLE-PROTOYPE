// Owner: D2. Helpers for the chrome's CSS strings (constructed stylesheets, never url()).

/** A length in design pixels. `--u` is one design pixel in CSS px, set from the fit and the tab zoom. */
export const u = (n: number): string => `calc(${n} * var(--u, 1px))`;

/** The person's minimum control size (CSS px), with an optional multiplier. */
export const target = (k = 1): string => (k === 1 ? 'var(--wa-target, 44px)' : `calc(${k} * var(--wa-target, 44px))`);

export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const DISPLAY_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const MONO_STACK = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/** Verdict colours for the Lens. Fixed across themes; white text on each is at least 4.5:1. */
export const VERDICT = {
  promote: '#0071E3',
  protect: '#2D6A3E',
  fold: '#B64400',
  keep_popup: '#6B3FC4',
  keep: '#5E5E63',
  pending: '#86868B',
} as const;
