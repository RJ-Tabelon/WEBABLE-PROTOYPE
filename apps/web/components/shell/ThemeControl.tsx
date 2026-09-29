'use client';

import { SegmentedControl } from '@webable/ui';
import { useSyncExternalStore } from 'react';
import {
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

/** System · Light · Dark (design-final §7.10). Applies instantly and remembers the choice. */
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
    writeTheme(next);
    onChange?.(next);
  };
  return labelledBy ? (
    <SegmentedControl
      labelledBy={labelledBy}
      options={OPTIONS}
      value={theme}
      onValueChange={select}
      className={className}
    />
  ) : (
    <SegmentedControl
      label={label}
      options={OPTIONS}
      value={theme}
      onValueChange={select}
      className={className}
    />
  );
}
