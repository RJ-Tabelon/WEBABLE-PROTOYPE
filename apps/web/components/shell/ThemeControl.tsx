'use client';

import { Icon, SegmentedControl, cx } from '@webable/ui';
import { useSyncExternalStore } from 'react';
import {
  isThemePreference,
  readTheme,
  subscribeTheme,
  writeTheme,
  type ThemePreference,
} from './theme';

const OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

export interface ThemeControlProps {
  /** Accessible name of the group. Default "Theme". */
  label?: string;
  /** Id of a visible label to use instead of `label`. */
  labelledBy?: string;
  /** Called after the preference is stored and applied, e.g. to sync it to the account. */
  onChange?: (preference: ThemePreference) => void;
  className?: string;
}

/**
 * System · Light · Dark (design-final §7.10). Applies instantly and remembers the
 * choice (and when it was made: `wa-theme-at`).
 *
 * It also carries a native select, hidden by default. Where three segments
 * cannot fit (the footer at 320 px and 2x text), the surface's CSS shows the
 * select instead (§7.5: "if a label would wrap, use a native <select>").
 */
export function ThemeControl({
  label = 'Theme',
  labelledBy,
  onChange,
  className,
}: ThemeControlProps) {
  const theme = useSyncExternalStore(
    subscribeTheme,
    readTheme,
    () => 'system' as const,
  );
  const select = (next: ThemePreference) => {
    // A choice made here is newer than whatever the account holds.
    writeTheme(next, { explicit: true });
    onChange?.(next);
  };
  const naming = labelledBy
    ? { 'aria-labelledby': labelledBy }
    : { 'aria-label': label };
  return (
    <span className={cx('wa-theme-control', className)}>
      {labelledBy ? (
        <SegmentedControl
          labelledBy={labelledBy}
          options={OPTIONS}
          value={theme}
          onValueChange={select}
        />
      ) : (
        <SegmentedControl
          label={label}
          options={OPTIONS}
          value={theme}
          onValueChange={select}
        />
      )}
      <span className="wa-select wa-theme-control__select">
        <select
          {...naming}
          className="wa-input wa-select__control"
          value={theme}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (isThemePreference(next)) select(next);
          }}
        >
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={20} className="wa-select__chevron" />
      </span>
    </span>
  );
}
