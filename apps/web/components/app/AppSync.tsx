'use client';

import { useEffect } from 'react';

import { readFitUi, writeFitUi } from '../shell/fit-ui';
import { readTheme, type ThemePreference, writeTheme } from '../shell/theme';
import { type FitUi, toFitUiInput } from './fit/ui';

export interface AppSyncProps {
  /** The theme saved on the account, or null when it couldn't be read. */
  theme: ThemePreference | null;
  /** The UI fit from the current profile, or null before the first Tune. */
  fitUi: FitUi | null;
}

/**
 * Brings this browser in line with the account when the app opens: the saved
 * theme (System, Light or Dark) and WebAble's own UI fit ("we wear our own
 * adaptations"). Both are also kept in localStorage, so the boot scripts apply
 * them before first paint next time. Renders nothing.
 */
export function AppSync({ theme, fitUi }: AppSyncProps) {
  useEffect(() => {
    if (theme && readTheme() !== theme) writeTheme(theme);
  }, [theme]);

  const serialized = fitUi ? JSON.stringify(fitUi) : null;
  useEffect(() => {
    if (!serialized) return;
    const ui = JSON.parse(serialized) as FitUi;
    const stored = readFitUi();
    const next = toFitUiInput(ui);
    // Only write when something differs, so other tabs aren't woken for nothing.
    if (
      !stored ||
      JSON.stringify(stored.vars) !== JSON.stringify(ui.vars) ||
      (stored.motion === 'reduce') !== (ui.motion === 'reduce')
    ) {
      writeFitUi(next);
    }
  }, [serialized]);

  return null;
}
