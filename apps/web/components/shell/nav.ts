/**
 * Navigation for the site, footer and app shells. Route owners can change a path
 * here without touching the shell components.
 */
export interface NavLink {
  href: string;
  label: string;
}

/** Site header links (design-final §7.8). */
export const SITE_NAV: readonly NavLink[] = [
  { href: '/#how', label: 'How it works' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/research', label: 'Research' },
  { href: '/help', label: 'Help' },
];

export const SIGN_IN: NavLink = { href: '/sign-in', label: 'Sign in' };
/** The site's one primary action (§7.8, §14): install first, then tune. */
export const GET_STARTED: NavLink = { href: '/get', label: 'Add to Chrome' };
/** The primary action for a signed-in visitor: back to their fit. */
export const YOUR_FIT: NavLink = { href: '/app', label: 'Your fit' };

export interface FooterColumn {
  heading: string;
  links: readonly NavLink[];
}

/** Footer columns (design-final §7.10). Help, Privacy, What WebAble sends, Accessibility and Research are required. */
export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    heading: 'Product',
    links: [
      { href: '/#how', label: 'How it works' },
      { href: '/tune', label: 'Tune WebAble' },
      { href: '/app', label: 'Your fit' },
    ],
  },
  {
    heading: 'Trust',
    links: [
      { href: '/privacy', label: 'Privacy' },
      { href: '/privacy#what-webable-sends', label: 'What WebAble sends' },
      { href: '/accessibility', label: 'Accessibility' },
    ],
  },
  {
    heading: 'Support',
    links: [
      { href: '/help', label: 'Help' },
      { href: '/help#contact', label: 'Contact' },
      { href: '/research', label: 'Research' },
    ],
  },
];

export type AppNavIcon =
  'fit' | 'changes' | 'sites' | 'privacy' | 'settings' | 'help';

export interface AppNavLink extends NavLink {
  icon: AppNavIcon;
}

/** App rail (design-final §7.9): Help is pinned at the bottom and never hidden. */
export const APP_NAV: readonly AppNavLink[] = [
  { href: '/app', label: 'Your fit', icon: 'fit' },
  { href: '/app/changes', label: 'Changes', icon: 'changes' },
  { href: '/app/sites', label: 'Sites', icon: 'sites' },
  { href: '/app/privacy', label: 'Privacy', icon: 'privacy' },
  { href: '/app/settings', label: 'Settings', icon: 'settings' },
];

export const APP_HELP: AppNavLink = {
  href: '/help',
  label: 'Help',
  icon: 'help',
};

/**
 * Whether `href` is the current page. Hash links are never current; `/app` only
 * matches itself, deeper paths match their own subtree.
 */
export function isCurrent(
  pathname: string | null,
  href: string,
  exact = false,
): boolean {
  if (!pathname || href.includes('#')) return false;
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (exact || href === '/' || href === '/app') return clean === href;
  return clean === href || clean.startsWith(`${href}/`);
}
