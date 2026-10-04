'use client';

import { useId, useState } from 'react';

import { updateAccountAction } from '../../../lib/data/actions';
import { DATA_ERROR_MESSAGES } from '../../../lib/data/result';
import { ThemeControl } from '../../shell/ThemeControl';
import type { ThemePreference } from '../../shell/theme';

/**
 * Theme · System · Light · Dark, as one settings row. A choice here is an
 * explicit one: it applies at once in this browser (ThemeControl stores it with
 * the time it was made) and saves to the account, so other browsers follow on
 * their next load (the most recent explicit choice wins, see AppSync).
 */
export function ThemeRow() {
  const labelId = useId();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ThemePreference | null>(null);

  async function save(theme: ThemePreference) {
    setError(null);
    try {
      const result = await updateAccountAction({ theme });
      if (!result.ok) setError(result.error.message);
      else setSaved(theme);
    } catch {
      setError(DATA_ERROR_MESSAGES.unavailable);
    }
  }

  return (
    <li className="wa-row wa-row--split wa-setting-row">
      <div className="wa-setting-row__text">
        <p id={labelId} className="wa-row__label wa-setting-row__label">
          Theme
        </p>
        <p className="wa-setting-row__value">
          Applies here and in your other browsers
        </p>
        {error ? (
          <p className="wa-reason" role="alert">
            Saved in this browser only. {error}
          </p>
        ) : null}
      </div>
      <div className="wa-row__actions">
        <ThemeControl
          labelledBy={labelId}
          onChange={(theme) => void save(theme)}
        />
        <p className="sr-only" role="status">
          {saved ? `Theme saved: ${saved}.` : ''}
        </p>
      </div>
    </li>
  );
}
