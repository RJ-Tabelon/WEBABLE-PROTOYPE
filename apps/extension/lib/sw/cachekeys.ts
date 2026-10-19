import type { PageContext, RegionEvidence } from '@webable/core/page/types';
import { nameKey } from '@webable/core/skeleton/locate';
import type { Skeleton } from '@webable/core/skeleton/types';
import {
  CATALOG_VERSION,
  COMPOSE_PINNED_MODEL,
  COMPOSE_SCHEMA_VERSION,
  JEV_PINNED_MODEL,
} from '@webable/core/versions';

import { canonicalJson, hmacHex } from '../storage/crypto';

/**
 * Answer-cache keys (ai-architecture.md 5). Everything is HMAC-SHA256 under
 * the per-install secret, so stored keys reveal nothing about sites or pages
 * and cannot be linked across installs. The profile is deliberately not part
 * of any key: answers are page facts.
 */

/** siteKey = HMAC(installSecret, eTLD+1), 64 bits. */
export function siteKey(secret: string, domain: string): Promise<string> {
  return hmacHex(secret, ['site', domain], 8);
}

/** Region answers: HMAC(secret, siteKey | componentKey | catalog | model). */
export function regionAnswerKey(
  secret: string,
  site: string,
  componentKey: string,
  model: string = JEV_PINNED_MODEL,
): Promise<string> {
  return hmacHex(
    secret,
    ['region', site, componentKey, CATALOG_VERSION, model],
    16,
  );
}

/**
 * The page signature: page signals, how main was found, and the structural
 * outline of the regions (zone, landmark, tag, pinning, class words). Counts
 * and heading words are left out on purpose, so every article of one template
 * shares a signature.
 */
export function pageSignature(
  page: PageContext,
  regions: Record<string, RegionEvidence>,
): string {
  const outline = Object.values(regions)
    .map((ev) =>
      [
        ev.zone,
        ev.landmark,
        ev.tag,
        ev.pinned,
        [...ev.class_words].sort().join(' '),
      ].join('|'),
    )
    .sort();
  return canonicalJson({
    signals: [...page.signals].sort(),
    found_by: page.main.found_by,
    zone: page.main.zone,
    regions: outline,
  });
}

/** Page-level answers (main pick, page type) keyed by the page signature. */
export function pageAnswerKey(
  secret: string,
  site: string,
  kind: 'main' | 'page',
  signature: string,
  extra: readonly string[] = [],
  model: string = JEV_PINNED_MODEL,
): Promise<string> {
  return hmacHex(
    secret,
    [kind, site, signature, ...extra, CATALOG_VERSION, model],
    16,
  );
}

/**
 * A page template on a site: HMAC(secret, template | siteKey | path shape),
 * 64 bits. Keys the triage prior and the page scale in the site record; the
 * path shape itself is never stored.
 */
export function templateKey(
  secret: string,
  site: string,
  shape: string,
): Promise<string> {
  return hmacHex(secret, ['template', site, shape], 8);
}

/**
 * Layout-planner specs (docs/10 §6): HMAC(secret, compose | siteKey | path
 * shape | schema | model). The structure hash is left out on purpose: one
 * key holds up to 3 structural variants, picked by locator resolution.
 */
export function composeKey(
  secret: string,
  site: string,
  shape: string,
  model: string = COMPOSE_PINNED_MODEL,
): Promise<string> {
  return hmacHex(
    secret,
    ['compose', site, shape, COMPOSE_SCHEMA_VERSION, model],
    16,
  );
}

/** HMAC of one normalised label (core `nameKey`), as stored in spec locators. */
export function nameHash(secret: string, key: string): Promise<string> {
  return hmacHex(secret, ['name', key], 8);
}

/**
 * Every label in a skeleton hashed ahead of time: `toStoredSpec` and
 * `fromStoredSpec` take a synchronous hash, WebCrypto is asynchronous. Returns
 * the lookup they need; an unknown key hashes to '' (no name).
 */
export async function nameHasher(
  secret: string,
  skeleton: Pick<Skeleton, 'nodes'>,
): Promise<(key: string) => string> {
  const keys = new Set<string>();
  for (const n of skeleton.nodes) {
    if (typeof n.label !== 'string') continue;
    const k = nameKey(n.label);
    if (k) keys.add(k);
  }
  const map = new Map<string, string>();
  await Promise.all(
    [...keys].map(async (k) => map.set(k, await nameHash(secret, k))),
  );
  return (key) => map.get(key) ?? '';
}
