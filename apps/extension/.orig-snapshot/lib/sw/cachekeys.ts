import type { PageContext, RegionEvidence } from '@webable/core/page/types';
import { CATALOG_VERSION, JEV_PINNED_MODEL } from '@webable/core/versions';

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
