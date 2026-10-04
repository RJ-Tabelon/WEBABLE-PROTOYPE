import type { ExtensionInstall } from '../../../lib/data/installs';

/**
 * Names for a connected browser ("Chrome on macOS") from the extension's
 * install record. Pure.
 */

const BROWSERS: Readonly<Record<string, string>> = {
  chrome: 'Chrome',
  edge: 'Microsoft Edge',
  brave: 'Brave',
  opera: 'Opera',
  chromium: 'Chromium',
};

const PLATFORMS: Readonly<Record<string, string>> = {
  mac: 'macOS',
  win: 'Windows',
  linux: 'Linux',
  cros: 'ChromeOS',
  android: 'Android',
};

/** "chrome" → "Chrome"; anything unknown is title-cased ("vivaldi" → "Vivaldi"). */
function titleCase(value: string): string {
  return value
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function browserName(raw: string | null | undefined): string {
  const key = (raw ?? '').trim().toLowerCase();
  if (!key) return 'Browser';
  return BROWSERS[key] ?? titleCase(key);
}

export function platformName(raw: string | null | undefined): string | null {
  const key = (raw ?? '').trim().toLowerCase();
  if (!key) return null;
  return PLATFORMS[key] ?? titleCase(key);
}

/** "Chrome on macOS". */
export function describeInstall(
  install: Pick<ExtensionInstall, 'browser' | 'platform'>,
): string {
  const browser = browserName(install.browser);
  const platform = platformName(install.platform);
  return platform ? `${browser} on ${platform}` : browser;
}
