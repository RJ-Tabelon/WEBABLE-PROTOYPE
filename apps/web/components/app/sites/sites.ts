import { type LocalSite, OP_CATALOG, OP_IDS, type OpId } from '@webable/core';

/**
 * Local site list helpers for /app/sites. The list comes from this browser's
 * extension and never reaches the server. Pure.
 */

export type SiteChange =
  | { kind: 'pause'; paused: boolean }
  | { kind: 'block'; op: OpId; blocked: boolean }
  | { kind: 'forget' };

export function isOpId(value: string): value is OpId {
  return (OP_IDS as readonly string[]).includes(value);
}

/** Op ids the app knows, in catalog order, with their labels. Unknown ids are dropped. */
export function opLabels(
  ids: readonly string[],
): Array<{ op: OpId; label: string }> {
  const known = new Set(ids.filter(isOpId));
  return OP_IDS.filter((op) => known.has(op)).map((op) => ({
    op,
    label: OP_CATALOG[op].label,
  }));
}

/** Most recently visited first; ties by name, so the order is stable. */
export function sortSites(sites: readonly LocalSite[]): LocalSite[] {
  return [...sites].sort(
    (a, b) => b.lastVisit - a.lastVisit || a.domain.localeCompare(b.domain),
  );
}

/** What the list should look like right after a change, before the extension answers. */
export function applyLocally(
  sites: readonly LocalSite[],
  domain: string,
  change: SiteChange,
): LocalSite[] {
  if (change.kind === 'forget') return sites.filter((s) => s.domain !== domain);
  return sites.map((site) => {
    if (site.domain !== domain) return site;
    if (change.kind === 'pause') return { ...site, paused: change.paused };
    const blocked = change.blocked
      ? [...new Set([...site.blocked, change.op])]
      : site.blocked.filter((op) => op !== change.op);
    return { ...site, blocked };
  });
}

/** Case-insensitive match on the domain. */
export function filterSites(
  sites: readonly LocalSite[],
  query: string,
): LocalSite[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...sites];
  return sites.filter((s) => s.domain.toLowerCase().includes(q));
}

/** Show a find box once the list is long enough to need one. */
export const FILTER_AFTER = 10;
