import { AD_MARKUP_SELECTOR } from '../extract/rules';
import { normalizeSpace } from './text';

/**
 * Ad markers (docs/11 R7: ads fold into one "Sponsored (n)" line). One set
 * of rules for the skeleton's `adhint` flag and for the registry's
 * `isAd(listId, member)`, so the exemplar the planner sees and the records
 * Fit view renders agree on which items are ads.
 */

/** Ad words as class, id or component-type tokens ("ad-slot", "sponsored"). */
export const AD_RE =
  /(?:^|[\s_-])(?:ad|ads|advert|advertisement|adslot|ad-slot|sponsor|sponsored|promoted|banner-ad|dfp|gpt-ad|adsbygoogle)(?:[\s_-]|$)/i;

/** Ad attributes: data-ad, data-ad-slot, data-ad-unit, data-adtype, ad-slot... */
const AD_ATTR =
  /^(?:data-ad(?:[-_].*|s|type|id|unit|slot)?|ad-slot|data-ads-.*)$/i;

/** Known ad containers inside a record (YouTube, Amazon, generic ad tags). */
const AD_CONTAINERS = [
  AD_MARKUP_SELECTOR,
  'ytd-ad-slot-renderer',
  'ytd-in-feed-ad-layout-renderer',
  'ytd-promoted-sparkles-web-renderer',
  'ytd-promoted-video-renderer',
  'ytd-search-pyv-renderer',
  '.AdHolder',
  '.puis-sponsored-label-text',
  '.s-sponsored-label-info-icon',
  '[data-component-type="sp-sponsored-result"]',
].join(',');

/**
 * A standalone sponsored marker: "Sponsored", "Promoted content", "Ad",
 * optionally followed by a separator and a domain ("Sponsored · example.com").
 */
const MARKER =
  /^(?:(?:sponsored|promoted|advertisement|paid partnership|anzeige|gesponsert|annonce|sponsoris[ée]|patrocinado|publicidad)(?:\s+(?:ad|ads|content|post|result|listing|link|video|product))?|ad)(?:\s*[·•|:,–-].*)?$/i;

function adAttributes(el: Element): boolean {
  for (const a of el.attributes) if (AD_ATTR.test(a.name)) return true;
  return false;
}

/** The element itself carries ad markup (the skeleton's `adhint` rule, without the page-wide index). */
export function adMarked(el: Element): boolean {
  const idcls = `${el.id} ${el.getAttribute('class') ?? ''} ${el.getAttribute('data-component-type') ?? ''}`;
  return AD_RE.test(idcls) || adAttributes(el);
}

/** `el` sits in ad markup at or below `scope` (an ad slot inside an article's text block). */
export function insideAd(el: Element, scope: Element): boolean {
  for (let e: Element | null = el; e && e !== scope; e = e.parentElement) {
    if (adMarked(e)) return true;
    try {
      if (e.matches(AD_CONTAINERS)) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * The record is an ad: ad markup on it, a known ad container inside it, or
 * a short standalone "Sponsored" / "Promoted" / "Ad" marker in its own text
 * or an aria-label. Product titles that merely contain the word never
 * count: a marker is a whole short text of its own.
 */
export function isAdRecord(member: Element): boolean {
  if (adMarked(member)) return true;
  try {
    if (member.matches(AD_CONTAINERS) || member.querySelector(AD_CONTAINERS))
      return true;
  } catch {
    // A selector this engine does not support: fall through to the text checks.
  }
  const own = member.getAttribute('aria-label');
  if (own && MARKER.test(normalizeSpace(own))) return true;
  let seen = 0;
  for (const el of member.querySelectorAll('*')) {
    if (++seen > 400) break;
    const label = el.getAttribute('aria-label');
    if (label && label.length <= 40 && MARKER.test(normalizeSpace(label)))
      return true;
    if (el.childElementCount > 0) continue;
    const t = el.textContent ?? '';
    if (t.length > 40) continue;
    const s = normalizeSpace(t);
    if (s && MARKER.test(s)) return true;
  }
  return false;
}
