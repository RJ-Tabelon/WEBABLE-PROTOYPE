// Paused sites by domain. The popup pauses an origin ("https://www.npr.org"); the website pauses a domain
// ("npr.org"). Both mean the same site. No chrome APIs here, so the popup can import it without the account code.

import type { LocalSite } from '@webable/core/bridge/protocol';

/** A paused entry (an origin from the popup, or a domain from the website) as a domain without www. */
export function domainOf(entry: string): string {
  let host = entry;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(entry)) host = new URL(entry).hostname;
  } catch {
    /* keep the entry */
  }
  return host.toLowerCase().replace(/^www\./, '');
}

export function siteList(
  paused: readonly string[],
  prefs: Record<string, unknown>,
): LocalSite[] {
  const pausedSet = new Set(paused.map(domainOf));
  const domains = new Set([...pausedSet, ...Object.keys(prefs).map(domainOf)]);
  return [...domains]
    .filter((d) => d.length > 0 && d.length <= 253)
    .sort()
    .map((domain) => ({
      domain,
      paused: pausedSet.has(domain),
      blocked: [],
      pinned: [],
      lastChanges: 0,
      lastVisit: 0,
    }));
}
