// Owner: X (round 7). Logos that identify things: the site's own mark, and team or organisation logos that label data.

import { cleanName, descendants, genericLogoName, hasWord, isImage, textOf } from './text';
import { isLogoish } from './scoreboard';
import type { SNode } from './types';

const LOGO_WORD = /^(logo|logos|brand|branding|wordmark|logotype|masthead|sitelogo)$/;

/** True when the link goes to the site's home page. */
export function isHomeHref(href: string | undefined, pageUrl: string): boolean {
  if (href === undefined) return false;
  try {
    const u = new URL(href, pageUrl);
    const here = new URL(pageUrl);
    if (u.hostname.replace(/^www\./, '') !== here.hostname.replace(/^www\./, '')) return false;
    return /^\/(index\.[a-z]{2,5}|home\/?|default\.aspx)?$/i.test(u.pathname) && !u.hash;
  } catch {
    return false;
  }
}

function hasMark(n: SNode): SNode | null {
  return descendants(n).find((d) => isImage(d) && d.w * d.h >= 300) ?? null;
}

export interface SiteLogo {
  /** The node that carries the data: the home link when there is one, else the picture. */
  holder: SNode;
  /** The picture itself (img or svg). */
  mark: SNode;
  label: string;
}

/**
 * The site's own mark: a home link holding a picture in the top band, or a picture whose class or alt says logo or
 * brand. `siteName` (og:site_name and similar) names it when the page states one.
 */
export function findSiteLogo(root: SNode, pageUrl: string, siteName: string | null | undefined): SiteLogo | null {
  const top = descendants(root).filter((n) => n.y < 320 && n.y + n.h > -50);
  let holder: SNode | null = null;
  let mark: SNode | null = null;
  for (const n of top) {
    if (n.tag !== 'a') continue;
    const m = hasMark(n);
    if (!m) continue;
    if (isHomeHref(n.attrs?.href, pageUrl) || hasWord(n, LOGO_WORD) || hasWord(m, LOGO_WORD) || /logo/i.test(m.attrs?.alt ?? '')) {
      holder = n;
      mark = m;
      break;
    }
  }
  if (!holder) {
    const pic = top.find((n) => isImage(n) && n.w * n.h >= 300 && (hasWord(n, LOGO_WORD) || /logo/i.test(`${n.attrs?.alt ?? ''} ${n.attrs?.src ?? ''}`)));
    if (pic) {
      holder = pic;
      mark = pic;
    }
  }
  if (!holder || !mark) return null;
  const named = [siteName ?? '', holder.attrs?.label ?? '', mark.attrs?.alt ?? '', mark.attrs?.label ?? '', mark.attrs?.title ?? '', textOf(holder)]
    .map(cleanName)
    .find((s) => s && !genericLogoName(s) && s.length <= 60);
  return { holder, mark, label: named ?? '' };
}

/**
 * Logos in the content that name a team or organisation (alt text, not a generic "Team Logo"), outside chrome. Logos
 * inside scoreboards are named from the scoreboard instead (see index.ts).
 */
export function findContentLogos(root: SNode, excluded: (n: SNode) => boolean): Array<{ node: SNode; label: string }> {
  const out: Array<{ node: SNode; label: string }> = [];
  for (const n of descendants(root)) {
    if (!isLogoish(n) || excluded(n)) continue;
    const alt = n.attrs?.alt ?? n.attrs?.label ?? '';
    const says = /logo|crest|badge|seal|emblem/i.test(`${n.cls} ${alt} ${n.attrs?.src ?? ''}`);
    if (!says) continue;
    const label = cleanName(alt);
    if (!label || genericLogoName(label)) continue;
    out.push({ node: n, label });
  }
  return out.slice(0, 24);
}
