/**
 * "We wear our own adaptations" (design-final §2.3): the website, app and Tune flow
 * apply the person's text scale, target minimum, extra leading, spacing, motion and
 * contrast. Whoever knows the fit (sign-in, Tune, Settings) calls `writeFitUi`; the
 * boot script re-applies it before first paint on every later page load.
 *
 * Storage: localStorage `wa-fit-ui`, JSON `{ v: 1, vars, motion?, contrast? }`.
 * Only the four profile hooks below are accepted, and only as bounded numbers, so a
 * tampered entry can never inject arbitrary CSS.
 *
 * `fitUiVars()` from `@webable/core` (profile/describe) returns a flat record of these
 * variables; pass it straight to `writeFitUi`.
 */

export const FIT_UI_STORAGE_KEY = 'wa-fit-ui';
const CHANGE_EVENT = 'wa-fit-ui-change';

/** Profile hooks defined in tokens.css, with the bounds this helper accepts. */
export const FIT_UI_BOUNDS = {
  '--wa-text-scale': { min: 0.75, max: 3, unit: '' },
  '--wa-target-min': { min: 24, max: 96, unit: 'px' },
  '--wa-leading-add': { min: 0, max: 1, unit: '' },
  '--wa-space-scale': { min: 0.75, max: 3, unit: '' },
} as const;

export type FitUiVar = keyof typeof FIT_UI_BOUNDS;
export const FIT_UI_VARS = Object.keys(FIT_UI_BOUNDS) as FitUiVar[];

export type FitUiVars = Partial<Record<FitUiVar, string>>;

export interface FitUiState {
  v: 1;
  vars: FitUiVars;
  /** `reduce` sets `data-wa-motion="reduce"` on <html>. */
  motion?: 'reduce' | 'standard';
  /** `more` sets `data-wa-contrast="more"`; `standard` opts out of the OS setting. */
  contrast?: 'more' | 'standard';
}

/** Either a flat record of variables (as `fitUiVars()` returns) or a full state. */
export type FitUiInput =
  | Partial<Record<FitUiVar, string | number>>
  | {
      vars?: Partial<Record<FitUiVar, string | number>>;
      motion?: 'reduce' | 'standard';
      contrast?: 'more' | 'standard';
    };

function normalizeValue(name: FitUiVar, raw: unknown): string | undefined {
  const bounds = FIT_UI_BOUNDS[name];
  let n: number;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string') {
    const m = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/.exec(raw);
    if (!m || (m[2] && bounds.unit !== 'px')) return undefined;
    n = Number(m[1]);
  } else return undefined;
  if (!Number.isFinite(n) || n < bounds.min || n > bounds.max) return undefined;
  const rounded = Math.round(n * 1000) / 1000;
  return `${rounded}${bounds.unit}`;
}

/** Validates unknown input (storage, profile) into a state, dropping anything unexpected. */
export function normalizeFitUi(input: unknown): FitUiState | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  const source =
    record.vars && typeof record.vars === 'object'
      ? (record.vars as Record<string, unknown>)
      : record;
  const vars: FitUiVars = {};
  for (const name of FIT_UI_VARS) {
    const value = normalizeValue(name, source[name]);
    if (value !== undefined) vars[name] = value;
  }
  const state: FitUiState = { v: 1, vars };
  if (record.motion === 'reduce' || record.motion === 'standard')
    state.motion = record.motion;
  if (record.contrast === 'more' || record.contrast === 'standard')
    state.contrast = record.contrast;
  return state;
}

/** Applies a state to <html> (or another root), removing anything it does not set. */
export function applyFitUi(
  state: FitUiState | null,
  root: HTMLElement = document.documentElement,
): void {
  for (const name of FIT_UI_VARS) {
    const value = state?.vars[name];
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  if (state?.motion === 'reduce') root.setAttribute('data-wa-motion', 'reduce');
  else root.removeAttribute('data-wa-motion');
  if (state?.contrast) root.setAttribute('data-wa-contrast', state.contrast);
  else root.removeAttribute('data-wa-contrast');
}

export function readFitUi(): FitUiState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(FIT_UI_STORAGE_KEY);
    return raw ? normalizeFitUi(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/**
 * Stores, applies and broadcasts the person's UI fit. Returns the normalised state
 * that was saved. Safe to call on every profile load.
 */
export function writeFitUi(input: FitUiInput): FitUiState {
  const state = normalizeFitUi(input) ?? { v: 1, vars: {} };
  if (typeof window === 'undefined') return state;
  try {
    window.localStorage.setItem(FIT_UI_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: the fit still applies to this page.
  }
  applyFitUi(state);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: state }));
  return state;
}

/** Forgets the stored fit (sign-out, "Reset WebAble's look") and restores defaults. */
export function clearFitUi(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(FIT_UI_STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
  applyFitUi(null);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: null }));
}

/** Re-applies the fit when another tab changes it. Returns an unsubscribe function. */
export function subscribeFitUi(
  onChange: (state: FitUiState | null) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== FIT_UI_STORAGE_KEY) return;
    const state = readFitUi();
    applyFitUi(state);
    onChange(state);
  };
  const onLocal = (event: Event) =>
    onChange((event as CustomEvent<FitUiState | null>).detail ?? null);
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onLocal);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onLocal);
  };
}

/**
 * Inline, dependency-free version of `applyFitUi(readFitUi())` for the <head>. It
 * mirrors `normalizeFitUi`: known variables only, bounded numbers only.
 */
export const FIT_UI_BOOT_SCRIPT = `(function(){try{var raw=localStorage.getItem('${FIT_UI_STORAGE_KEY}');if(!raw)return;var s=JSON.parse(raw);if(!s||typeof s!=='object')return;var v=s.vars&&typeof s.vars==='object'?s.vars:s;var b=${JSON.stringify(
  FIT_UI_BOUNDS,
)};var r=document.documentElement;for(var k in b){var x=v[k];var m=typeof x==='number'?[0,String(x),'']:typeof x==='string'?/^\\s*(\\d+(?:\\.\\d+)?)\\s*(px)?\\s*$/.exec(x):null;if(!m)continue;if(m[2]&&b[k].unit!=='px')continue;var n=Number(m[1]);if(!isFinite(n)||n<b[k].min||n>b[k].max)continue;r.style.setProperty(k,(Math.round(n*1000)/1000)+b[k].unit)}if(s.motion==='reduce')r.setAttribute('data-wa-motion','reduce');if(s.contrast==='more'||s.contrast==='standard')r.setAttribute('data-wa-contrast',s.contrast)}catch(e){}})();`;
