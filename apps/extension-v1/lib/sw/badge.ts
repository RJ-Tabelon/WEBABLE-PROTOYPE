import type { PopupStatus } from '../protocol';

/**
 * Toolbar icon, badge and title per state (design-final 10.2 and 10.4).
 * - The title is always set, so the state exists as text.
 * - Badges only for the change count and "!" (sign in again). Offers never badge.
 * - Paused, off and can't-run use the grey tile; everything else the ink tile.
 * - No toolbar animation.
 */
export type IconVariant = 'ink' | 'paused' | 'cant';

export interface BadgeState {
  icon: IconVariant;
  text: string;
  /** Badge background and text colours (only meaningful with text). */
  color: string;
  textColor: string;
  title: string;
}

export const BADGE_ACCENT = '#2D6A3E'; // white text 6.48:1
export const BADGE_WARN = '#F0B45C'; // ink text 9.46:1
export const BADGE_INK = '#1A1A17';
export const BADGE_WHITE = '#FFFFFF';

export interface BadgeInput {
  status: PopupStatus;
  /** Applied changes (undone-by-checks excluded). */
  count: number;
  needsReauth: boolean;
}

const plain = (icon: IconVariant, title: string): BadgeState => ({
  icon,
  text: '',
  color: BADGE_ACCENT,
  textColor: BADGE_WHITE,
  title,
});

export function badgeFor({
  status,
  count,
  needsReauth,
}: BadgeInput): BadgeState {
  if (status === 'off') return plain('paused', 'WebAble: off');
  if (status === 'cant_run')
    return plain('cant', "WebAble can't change this page");
  if (status === 'paused')
    return plain('paused', 'WebAble: paused on this site');
  if (needsReauth)
    return {
      icon: 'ink',
      text: '!',
      color: BADGE_WARN,
      textColor: BADGE_INK,
      title: 'WebAble: sign in again to sync',
    };
  if (status === 'unreadable')
    return plain('ink', "WebAble couldn't read this page");
  if (status === 'needs_site_access')
    return plain('ink', 'WebAble: open to use on this page');
  const n = Math.max(0, Math.round(count));
  if (n > 0 && (status === 'adapted' || status === 'first_run'))
    return {
      icon: 'ink',
      text: n > 99 ? '99+' : String(n),
      color: BADGE_ACCENT,
      textColor: BADGE_WHITE,
      title: `WebAble: ${n} ${n === 1 ? 'change' : 'changes'} on this page`,
    };
  return plain('ink', 'WebAble: on');
}

/** Icon files per variant (public/icons). Sizes 16/24/32 for the toolbar. */
export function iconPaths(variant: IconVariant): Record<string, string> {
  if (variant === 'ink')
    return {
      '16': '/icons/16.png',
      '24': '/icons/24.png',
      '32': '/icons/32.png',
    };
  return {
    '16': `/icons/${variant}-16.png`,
    '24': `/icons/${variant}-24.png`,
    '32': `/icons/${variant}-32.png`,
  };
}
