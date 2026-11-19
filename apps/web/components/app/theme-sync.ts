import type { ThemePreference } from '../shell/theme';

/**
 * Which theme wins when this browser and the account disagree: the most recent
 * explicit choice (the site footer, Settings, or another browser's Settings).
 * Pure, for tests.
 */
export function themeDecision({
  local,
  localAt,
  account,
  accountAt,
}: {
  local: ThemePreference;
  localAt: number | null;
  account: ThemePreference;
  accountAt: number | null;
}): 'save-local' | 'apply-account' | 'none' {
  if (local === account) return 'none';
  if (localAt !== null && (accountAt === null || localAt > accountAt))
    return 'save-local';
  return 'apply-account';
}
