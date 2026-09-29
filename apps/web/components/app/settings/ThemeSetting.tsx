'use client';

import { useId, useState } from 'react';

import { updateAccountAction } from '../../../lib/data/actions';
import { DATA_ERROR_MESSAGES } from '../../../lib/data/result';
import { ThemeControl } from '../../shell/ThemeControl';
import type { ThemePreference } from '../../shell/theme';

/**
 * System · Light · Dark. Applies at once in this browser (localStorage, before
 * first paint next time) and saves to the account so other browsers follow.
 */
export function ThemeSetting() {
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
    <div className="wa-setting">
      <div>
        <p id={labelId} className="wa-row__label">
          Theme
        </p>
        <p className="wa-row__detail">
          Applies here right away, and in other browsers where you’re signed in.
        </p>
      </div>
      <div className="wa-setting__control">
        <ThemeControl
          labelledBy={labelId}
          onChange={(theme) => void save(theme)}
        />
        <p className="sr-only" role="status">
          {saved ? `Theme saved: ${saved}.` : ''}
        </p>
        {error ? (
          <p className="wa-reason" role="alert">
            Saved in this browser only. {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
