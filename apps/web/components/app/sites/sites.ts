import {
  formatLevel,
  type LocalSite,
  OP_CATALOG,
  OP_IDS,
  type OpId,
} from '@webable/core';

/**
 * Local site list helpers for /app/sites. The list comes from this browser's
 * extension and never reaches the server. Pure.
 */

export type SiteChange =
  | { kind: 'pause'; paused: boolean }
  | { kind: 'block'; op: OpId; blocked: boolean }
  | { kind: 'pin'; op: OpId; on: boolean }
  | { kind: 'reset' }
  | { kind: 'forget' };

/** Per-op levels a site keeps (the level index on the op's ladder). */
export type SiteLevels = Partial<Record<string, number>>;

/** A site as the page reads it: `levels` is optional for older extensions. */
export type SiteView = LocalSite & { levels?: SiteLevels };

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

/** One preference a site keeps, and the change that undoes it. */
export interface SitePreference {
  key: string;
  /** "Paused", "Always on: Click targets", "Text size 21 px", "Turned off: Line spacing" */
  label: string;
  /** The button: "Resume", "Turn off here", "Reset", "Turn back on". */
  action: string;
  /** Words after the action for screen readers ("click targets"). */
  actionContext: string;
  /** What the button sends, or null when only [Reset site] can clear it. */
  change: SiteChange | null;
}

function levelsOf(site: SiteView): Array<{ op: OpId; level: number }> {
  const levels = site.levels ?? {};
  return OP_IDS.filter(
    (op) => typeof levels[op] === 'number' && Number.isFinite(levels[op]),
  ).map((op) => ({ op, level: levels[op] as number }));
}

/** Whether the site keeps anything of its own (the list shows only these). */
export function hasRules(site: SiteView): boolean {
  return (
    site.paused ||
    site.blocked.length > 0 ||
    site.pinned.length > 0 ||
    levelsOf(site).length > 0
  );
}

/**
 * Each thing a site keeps, as its own row with the action that undoes it.
 * A level (a size set for this site) has no change of its own in the bridge,
 * so its [Reset] resets the site when the level is all the site keeps;
 * otherwise [Reset site] clears it with the rest.
 */
export function sitePreferences(site: SiteView): SitePreference[] {
  const out: SitePreference[] = [];
  if (site.paused)
    out.push({
      key: 'paused',
      label: 'Paused',
      action: 'Resume',
      actionContext: `on ${site.domain}`,
      change: { kind: 'pause', paused: false },
    });
  for (const { op, label } of opLabels(site.pinned))
    out.push({
      key: `pin-${op}`,
      label: `Always on: ${label}`,
      action: 'Turn off here',
      actionContext: `${label.toLowerCase()} on ${site.domain}`,
      change: { kind: 'pin', op, on: false },
    });
  const levels = levelsOf(site);
  const onlyLevels =
    !site.paused && site.pinned.length === 0 && site.blocked.length === 0;
  for (const { op, level } of levels) {
    const label = OP_CATALOG[op].label;
    out.push({
      key: `level-${op}`,
      label: `${label} ${formatLevel(op, level)}`,
      action: 'Reset',
      actionContext: `${label.toLowerCase()} on ${site.domain}`,
      change: onlyLevels && levels.length === 1 ? { kind: 'reset' } : null,
    });
  }
  for (const { op, label } of opLabels(site.blocked))
    out.push({
      key: `block-${op}`,
      label: `Turned off: ${label}`,
      action: 'Turn back on',
      actionContext: `${label.toLowerCase()} on ${site.domain}`,
      change: { kind: 'block', op, blocked: false },
    });
  return out;
}

/** Most recently visited first; ties by name, so the order is stable. */
export function sortSites<T extends LocalSite>(sites: readonly T[]): T[] {
  return [...sites].sort(
    (a, b) => b.lastVisit - a.lastVisit || a.domain.localeCompare(b.domain),
  );
}

/** What the list should look like right after a change, before the extension answers. */
export function applyLocally<T extends SiteView>(
  sites: readonly T[],
  domain: string,
  change: SiteChange,
): T[] {
  if (change.kind === 'forget' || change.kind === 'reset')
    return sites.filter((s) => s.domain !== domain);
  return sites
    .map((site): T => {
      if (site.domain !== domain) return site;
      switch (change.kind) {
        case 'pause':
          return { ...site, paused: change.paused };
        case 'block':
          return {
            ...site,
            blocked: change.blocked
              ? [...new Set([...site.blocked, change.op])]
              : site.blocked.filter((op) => op !== change.op),
          };
        case 'pin':
          return {
            ...site,
            pinned: change.on
              ? [...new Set([...site.pinned, change.op])]
              : site.pinned.filter((op) => op !== change.op),
          };
      }
    })
    .filter(hasRules);
}

/** Case-insensitive match on the domain. */
export function filterSites<T extends LocalSite>(
  sites: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...sites];
  return sites.filter((s) => s.domain.toLowerCase().includes(q));
}

/** Show a find box once the list is long enough to need one. */
export const FILTER_AFTER = 10;

/** The change that puts one back, for Undo in the toast. Null when there isn't one. */
export function inverse(change: SiteChange): SiteChange | null {
  switch (change.kind) {
    case 'pause':
      return { kind: 'pause', paused: !change.paused };
    case 'block':
      return { kind: 'block', op: change.op, blocked: !change.blocked };
    case 'pin':
      return { kind: 'pin', op: change.op, on: !change.on };
    case 'reset':
    case 'forget':
      return null;
  }
}

/**
 * The toast glyph means "WebAble applies a change here again": resuming, or
 * turning a change back on. Pausing and turning off are not.
 */
export function appliesAgain(change: SiteChange): boolean {
  return (
    (change.kind === 'pause' && !change.paused) ||
    (change.kind === 'block' && !change.blocked)
  );
}
