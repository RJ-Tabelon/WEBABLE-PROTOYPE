import { fitUiVars } from '@webable/core/profile/describe';
import type { SystemSignals } from '@webable/core/profile/defaults';

import type { Prefs } from '../sw/ui';

/**
 * WebAble wears its own adaptations (design-final 2, principle 3): the popup
 * and the welcome page take the person's target minimum, extra leading and
 * spacing from their fit, and honour the theme and motion settings. Text stays
 * at the normal size (scale 1): a larger fit made the compact popup unwieldy,
 * and the browser's own zoom still enlarges it. Pure DOM writes on the root.
 */
export function applyPrefs(root: HTMLElement, prefs: Prefs): void {
  if (prefs.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', prefs.theme);

  const vars = prefs.profile ? fitUiVars(prefs.profile) : null;
  const style = vars?.style ?? {
    '--wa-text-scale': '1',
    '--wa-target-min': '44px',
    '--wa-leading-add': '0',
    '--wa-space-scale': '1',
  };
  for (const [name, value] of Object.entries(style))
    root.style.setProperty(name, value);
  root.style.setProperty('--wa-text-scale', '1');

  const reduce =
    prefs.reduceMotion || vars?.attributes['data-wa-motion'] === 'reduce';
  if (reduce) root.setAttribute('data-wa-motion', 'reduce');
  else root.removeAttribute('data-wa-motion');
}

/** OS signals an extension page can read (the worker has no window). */
export function readSystemSignals(win: Window): SystemSignals {
  const mq = (q: string): boolean => {
    try {
      return win.matchMedia(q).matches;
    } catch {
      return false;
    }
  };
  const coarse = mq('(pointer: coarse)');
  const width = win.screen?.width ?? win.innerWidth;
  const deviceClass: SystemSignals['deviceClass'] =
    coarse && width < 600
      ? 'phone'
      : coarse
        ? 'tablet'
        : width >= 1800
          ? 'desktop'
          : 'laptop';
  const input: SystemSignals['input'] = coarse
    ? 'touch'
    : mq('(pointer: fine)')
      ? 'mouse'
      : 'other';
  return {
    reducedMotion: mq('(prefers-reduced-motion: reduce)'),
    colorScheme: mq('(prefers-color-scheme: dark)') ? 'dark' : 'light',
    moreContrast: mq('(prefers-contrast: more)'),
    forcedColors: mq('(forced-colors: active)'),
    deviceClass,
    input,
  };
}
