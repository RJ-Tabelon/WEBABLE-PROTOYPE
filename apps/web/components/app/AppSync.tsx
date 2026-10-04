'use client';

import { Button } from '@webable/ui';
import { useEffect } from 'react';

import { updateAccountAction } from '../../lib/data/actions';
import { readFitUi, writeFitUi } from '../shell/fit-ui';
import {
  readTheme,
  readThemeSetAt,
  type ThemePreference,
  writeTheme,
} from '../shell/theme';
import { usePendingFit } from '../tune/flow/storage';
import { type FitUi, toFitUiInput } from './fit/ui';
import { formatRelativeDay } from './format';
import { themeDecision } from './theme-sync';

export interface AppSyncProps {
  /** The theme saved on the account, or null when it couldn't be read. */
  theme: ThemePreference | null;
  /** When the account's theme was last chosen (ISO), or null if never. */
  themeSetAt: string | null;
  /** The UI fit from the current profile, or null before the first Tune. */
  fitUi: FitUi | null;
}

/** "Sep 28", or "today" / "yesterday" in running text. */
function day(ms: number): string {
  const shown = formatRelativeDay(ms);
  return shown === 'Today' || shown === 'Yesterday'
    ? shown.toLowerCase()
    : shown;
}

/**
 * Brings this browser in line with the account when the app opens:
 * - the theme, both ways: the most recent explicit choice wins, so a theme
 *   picked in the site footer is saved to the account, and one picked in
 *   Settings on another browser is applied here;
 * - WebAble's own UI fit ("we wear our own adaptations").
 * Both also live in localStorage, so the boot scripts apply them before first
 * paint next time. It shows one note when a fit made while signed out is still
 * waiting in this browser.
 */
export function AppSync({ theme, themeSetAt, fitUi }: AppSyncProps) {
  const pending = usePendingFit();

  useEffect(() => {
    if (!theme) return;
    const local = readTheme();
    const parsed = themeSetAt ? Date.parse(themeSetAt) : Number.NaN;
    const decision = themeDecision({
      local,
      localAt: readThemeSetAt(),
      account: theme,
      accountAt: Number.isFinite(parsed) ? parsed : null,
    });
    if (decision === 'save-local')
      void updateAccountAction({ theme: local }).catch(() => undefined);
    else if (decision === 'apply-account') writeTheme(theme);
  }, [theme, themeSetAt]);

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

  if (!pending) return null;
  return (
    <div className="wa-app-note wa-app-note--row wa-app-sync-note">
      <p className="wa-app-note__text">
        You have an unsaved fit from {day(pending.savedAt)}.
      </p>
      <div className="wa-app-note__action">
        <Button href="/tune/save" variant="primary" size="md" arrow="forward">
          Save it
        </Button>
      </div>
    </div>
  );
}
