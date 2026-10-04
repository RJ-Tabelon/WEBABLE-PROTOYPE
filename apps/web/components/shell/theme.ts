/**
 * Theme preference: System, Light or Dark (design-final §4). Stored per browser in
 * localStorage `wa-theme` and applied as `data-theme` on <html> before first paint
 * by the boot script. `system` removes the attribute so prefers-color-scheme decides.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'wa-theme';
const CHANGE_EVENT = 'wa-theme-change';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function readTheme(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(
  preference: ThemePreference,
  root: HTMLElement = document.documentElement,
): void {
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}

/**
 * localStorage key for when the person last chose a theme on this device
 * (ms since epoch). Only explicit choices (the theme control) set it; the app
 * compares it with the account's theme to decide which one is newer.
 */
export const THEME_SET_AT_STORAGE_KEY = 'wa-theme-at';

export interface WriteThemeOptions {
  /**
   * The person chose this now (the theme control), rather than the app syncing
   * a stored value. Also stamps `wa-theme-at` with `Date.now()`.
   */
  explicit?: boolean;
}

/** Stores, applies and broadcasts a preference (other controls on the page stay in sync). */
export function writeTheme(
  preference: ThemePreference,
  { explicit = false }: WriteThemeOptions = {},
): void {
  if (typeof window === 'undefined') return;
  try {
    if (preference === 'system')
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    if (explicit)
      window.localStorage.setItem(THEME_SET_AT_STORAGE_KEY, String(Date.now()));
  } catch {
    // Storage can be unavailable (private mode, blocked); the choice still applies now.
  }
  applyTheme(preference);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: preference }));
}

/**
 * When the person last chose a theme on this device (ms since epoch), or null
 * if they never did here (or storage is unavailable).
 */
export function readThemeSetAt(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(THEME_SET_AT_STORAGE_KEY);
    if (raw === null) return null;
    const at = Number(raw);
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

/** Subscribes to preference changes from this page and from other tabs. */
export function subscribeTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    applyTheme(readTheme());
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** Inline, dependency-free version of `applyTheme(readTheme())` for the <head>. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var r=document.documentElement;if(t==='light'||t==='dark'){r.setAttribute('data-theme',t)}else{r.removeAttribute('data-theme')}}catch(e){}})();`;
