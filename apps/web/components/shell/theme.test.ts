// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_SET_AT_STORAGE_KEY,
  THEME_STORAGE_KEY,
  readTheme,
  readThemeSetAt,
  writeTheme,
} from './theme';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.useRealTimers();
});

describe('theme preference', () => {
  it('stamps wa-theme-at only for an explicit choice', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    writeTheme('dark');
    expect(readTheme()).toBe('dark');
    expect(readThemeSetAt()).toBeNull();

    writeTheme('light', { explicit: true });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(readThemeSetAt()).toBe(Date.parse('2026-09-30T12:00:00Z'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    // "System" is also a choice: the stamp moves, the stored theme goes.
    vi.setSystemTime(new Date('2026-09-30T12:05:00Z'));
    writeTheme('system', { explicit: true });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(readThemeSetAt()).toBe(Date.parse('2026-09-30T12:05:00Z'));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('ignores a malformed stamp', () => {
    window.localStorage.setItem(THEME_SET_AT_STORAGE_KEY, 'soon');
    expect(readThemeSetAt()).toBeNull();
  });
});
