/**
 * The hero's fit marks draw once per browser session (design-final §8, §12). This
 * module holds that rule so it can be tested without a browser.
 */

/** sessionStorage key recording that the hero draw has run in this session. */
export const HERO_DRAWN_KEY = 'ws-hero-drawn';

/** The part of `Storage` the rule needs. */
export type DrawStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Whether this view of the hero may run the draw, recording the claim so later views
 * in the same session are static. Unavailable or failing storage (private modes,
 * blocked site data) means the marks draw each time rather than never.
 */
export function claimHeroDraw(
  storage: DrawStorage | null | undefined,
): boolean {
  if (!storage) return true;
  try {
    if (storage.getItem(HERO_DRAWN_KEY) === '1') return false;
  } catch {
    return true;
  }
  try {
    storage.setItem(HERO_DRAWN_KEY, '1');
  } catch {
    // Nothing to record; the draw simply runs again next time.
  }
  return true;
}

/** `window.sessionStorage`, or null where reading it throws. */
export function sessionStore(): DrawStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
