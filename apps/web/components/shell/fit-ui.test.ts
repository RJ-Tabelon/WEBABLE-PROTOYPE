// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FIT_UI_BOOT_SCRIPT,
  FIT_UI_STORAGE_KEY,
  applyFitUi,
  clearFitUi,
  fitUiForPath,
  fitUiSizesApply,
  normalizeFitUi,
  readFitUi,
  writeFitUi,
} from './fit-ui';
import {
  THEME_BOOT_SCRIPT,
  THEME_STORAGE_KEY,
  readTheme,
  writeTheme,
} from './theme';

const root = () => document.documentElement;

function resetRoot() {
  root().removeAttribute('style');
  root().removeAttribute('data-theme');
  root().removeAttribute('data-wa-motion');
  root().removeAttribute('data-wa-contrast');
  localStorage.clear();
}

// Tune wears the fit; the public pages are checked on their own below.
beforeEach(() => window.history.replaceState(null, '', '/tune'));
afterEach(resetRoot);

describe('normalizeFitUi', () => {
  it('accepts a flat record of profile hooks and bounds every value', () => {
    expect(
      normalizeFitUi({
        '--wa-text-scale': 1.25,
        '--wa-target-min': '56px',
        '--wa-leading-add': '0.2',
        '--wa-space-scale': 9,
        '--evil': 'red',
      }),
    ).toEqual({
      v: 1,
      vars: {
        '--wa-text-scale': '1.25',
        '--wa-target-min': '56px',
        '--wa-leading-add': '0.2',
      },
    });
  });

  it('rejects CSS injection and wrong units', () => {
    const state = normalizeFitUi({
      vars: {
        '--wa-text-scale': '1; background: red',
        '--wa-leading-add': '0.2px',
      },
      motion: 'reduce',
      contrast: 'loud',
    });
    expect(state).toEqual({ v: 1, vars: {}, motion: 'reduce' });
  });

  it('returns null for non-objects', () => {
    expect(normalizeFitUi('x')).toBeNull();
    expect(normalizeFitUi(null)).toBeNull();
  });
});

describe('writeFitUi / readFitUi / clearFitUi', () => {
  it('stores, applies and clears the fit on <html>', () => {
    writeFitUi({
      vars: { '--wa-text-scale': 1.5 },
      motion: 'reduce',
      contrast: 'more',
    });
    expect(root().style.getPropertyValue('--wa-text-scale')).toBe('1.5');
    expect(root().dataset.waMotion).toBe('reduce');
    expect(root().dataset.waContrast).toBe('more');
    expect(readFitUi()?.vars['--wa-text-scale']).toBe('1.5');

    clearFitUi();
    expect(root().style.getPropertyValue('--wa-text-scale')).toBe('');
    expect(root().hasAttribute('data-wa-motion')).toBe(false);
    expect(localStorage.getItem(FIT_UI_STORAGE_KEY)).toBeNull();
  });

  it('applyFitUi removes variables the new state does not set', () => {
    applyFitUi({
      v: 1,
      vars: { '--wa-text-scale': '2', '--wa-space-scale': '1.5' },
    });
    applyFitUi({ v: 1, vars: { '--wa-space-scale': '1.25' } });
    expect(root().style.getPropertyValue('--wa-text-scale')).toBe('');
    expect(root().style.getPropertyValue('--wa-space-scale')).toBe('1.25');
  });
});

describe('the public pages keep their designed size', () => {
  it('knows which pages are public', () => {
    for (const path of ['/', '/get', '/research/', '/help', '/privacy'])
      expect(fitUiSizesApply(path)).toBe(false);
    expect(fitUiSizesApply('/accessibility')).toBe(false);
    for (const path of ['/tune', '/app/settings', '/sign-in', '/getting'])
      expect(fitUiSizesApply(path)).toBe(true);
  });

  it('drops the sizes but keeps motion and contrast', () => {
    const state = normalizeFitUi({
      vars: { '--wa-text-scale': 1.75 },
      motion: 'reduce',
      contrast: 'more',
    });
    expect(fitUiForPath(state, '/')).toEqual({
      v: 1,
      vars: {},
      motion: 'reduce',
      contrast: 'more',
    });
    expect(fitUiForPath(state, '/tune')).toBe(state);
  });

  it('writeFitUi on a public page stores the fit without resizing the page', () => {
    window.history.replaceState(null, '', '/');
    writeFitUi({ vars: { '--wa-text-scale': 1.75 }, motion: 'reduce' });
    expect(readFitUi()?.vars['--wa-text-scale']).toBe('1.75');
    expect(root().style.getPropertyValue('--wa-text-scale')).toBe('');
    expect(root().dataset.waMotion).toBe('reduce');
  });

  it('the fit boot script leaves the sizes off the public pages', () => {
    localStorage.setItem(
      FIT_UI_STORAGE_KEY,
      JSON.stringify({
        vars: { '--wa-text-scale': '1.75', '--wa-target-min': '72px' },
        motion: 'reduce',
      }),
    );
    for (const path of ['/', '/research', '/help/']) {
      window.history.replaceState(null, '', path);
      new Function(FIT_UI_BOOT_SCRIPT)();
      expect(root().style.getPropertyValue('--wa-text-scale')).toBe('');
      expect(root().style.getPropertyValue('--wa-target-min')).toBe('');
      expect(root().dataset.waMotion).toBe('reduce');
    }
    window.history.replaceState(null, '', '/app');
    new Function(FIT_UI_BOOT_SCRIPT)();
    expect(root().style.getPropertyValue('--wa-text-scale')).toBe('1.75');
  });
});

describe('boot scripts', () => {
  it('the fit boot script applies only valid stored values', () => {
    localStorage.setItem(
      FIT_UI_STORAGE_KEY,
      JSON.stringify({
        vars: {
          '--wa-text-scale': '1.25',
          '--wa-target-min': '72px',
          '--wa-space-scale': 'red',
        },
        motion: 'reduce',
      }),
    );
    new Function(FIT_UI_BOOT_SCRIPT)();
    expect(root().style.getPropertyValue('--wa-text-scale')).toBe('1.25');
    expect(root().style.getPropertyValue('--wa-target-min')).toBe('72px');
    expect(root().style.getPropertyValue('--wa-space-scale')).toBe('');
    expect(root().dataset.waMotion).toBe('reduce');
  });

  it('the fit boot script survives corrupt storage', () => {
    localStorage.setItem(FIT_UI_STORAGE_KEY, '{not json');
    expect(() => new Function(FIT_UI_BOOT_SCRIPT)()).not.toThrow();
  });

  it('the theme boot script sets data-theme only for light or dark', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    new Function(THEME_BOOT_SCRIPT)();
    expect(root().dataset.theme).toBe('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    new Function(THEME_BOOT_SCRIPT)();
    expect(root().hasAttribute('data-theme')).toBe(false);
  });

  it('writeTheme stores the choice and system removes it', () => {
    writeTheme('light');
    expect(readTheme()).toBe('light');
    expect(root().dataset.theme).toBe('light');
    writeTheme('system');
    expect(readTheme()).toBe('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(root().hasAttribute('data-theme')).toBe(false);
  });
});
