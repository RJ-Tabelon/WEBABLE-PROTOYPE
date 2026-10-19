import type { SkelHrefKind } from '@webable/core/skeleton/constants';

import type { MediaInfo } from '../fitview/types';
import { normalizeSpace } from './text';

/**
 * Media sources and link targets, read live and filtered (docs/10 §4.4,
 * review 4 #12): only http(s), data: and blob: media URLs, and only
 * http(s), mailto: and tel: hrefs, ever leave these functions. A
 * javascript: URL, or anything else, is never exposed.
 */

const MEDIA_SCHEMES = new Set(['http:', 'https:', 'data:', 'blob:']);
const HREF_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** Absolute media URL, or null for an unsafe or empty one. */
export function safeMediaUrl(raw: string | null, base: string): string | null {
  const s = raw?.trim();
  if (!s) return null;
  try {
    const u = new URL(s, base);
    if (!MEDIA_SCHEMES.has(u.protocol)) return null;
    if (u.protocol === 'data:' && !/^data:image\//i.test(u.href)) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Absolute http(s)/mailto/tel URL, or null. */
export function safeHrefUrl(raw: string | null, base: string): string | null {
  const s = raw?.trim();
  if (!s) return null;
  try {
    const u = new URL(s, base);
    return HREF_SCHEMES.has(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * A srcset rebuilt from its safe candidates ("url 2x, url 640w"), resolved
 * against `base`; null when none is safe.
 */
export function sanitizeSrcset(
  srcset: string | null,
  base: string,
): string | null {
  if (!srcset?.trim()) return null;
  const out: string[] = [];
  for (const { url, desc } of parseSrcset(srcset)) {
    const safe = safeMediaUrl(url, base);
    if (!safe) continue;
    out.push(/^\d+(?:\.\d+)?[wx]$/.test(desc) ? `${safe} ${desc}` : safe);
    if (out.length >= 16) break;
  }
  return out.length ? out.join(', ') : null;
}

/**
 * srcset candidates (HTML "parse a srcset attribute", simplified): a URL is
 * a run of non-whitespace (so data: URLs keep their commas), trailing commas
 * end a candidate, otherwise descriptors run to the next comma.
 */
export function parseSrcset(s: string): Array<{ url: string; desc: string }> {
  const out: Array<{ url: string; desc: string }> = [];
  let i = 0;
  const ws = (c: string | undefined): boolean =>
    c !== undefined && /\s/.test(c);
  while (i < s.length && out.length < 64) {
    while (i < s.length && (ws(s[i]) || s[i] === ',')) i++;
    if (i >= s.length) break;
    const start = i;
    while (i < s.length && !ws(s[i])) i++;
    let url = s.slice(start, i);
    let desc = '';
    if (url.endsWith(',')) url = url.replace(/,+$/, '');
    else {
      const d = i;
      while (i < s.length && s[i] !== ',') i++;
      desc = s.slice(d, i).trim();
    }
    if (url) out.push({ url, desc });
  }
  return out;
}

/** First url(...) in a computed background-image value. */
export function backgroundImageUrl(value: string | null): string | null {
  if (!value || value === 'none') return null;
  const m =
    /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)\s]*))\s*\)/.exec(
      value,
    );
  if (!m) return null;
  const raw = m[1] ?? m[2] ?? m[3] ?? '';
  return raw.replace(/\\(.)/g, '$1') || null;
}

/** Attributes lazy loaders keep the real source in (src holds a placeholder). */
const LAZY_SRC = [
  'data-src',
  'data-lazy-src',
  'data-lazy',
  'data-original',
  'data-url',
  'data-hi-res-src',
  'data-thumb',
];
const LAZY_SRCSET = ['data-srcset', 'data-lazy-srcset'];

/** A 1x1 or tiny inline placeholder (blank GIF, SVG spacer). */
function isPlaceholder(url: string): boolean {
  return /^data:image\/(?:gif|png|svg\+xml)[;,]/i.test(url) && url.length < 400;
}

function lazySrc(el: Element, base: string): string | null {
  for (const a of LAZY_SRC) {
    const v = safeMediaUrl(el.getAttribute(a), base);
    if (v) return v;
  }
  return null;
}

function lazySrcset(el: Element, base: string): string | null {
  for (const a of LAZY_SRCSET) {
    const v = sanitizeSrcset(el.getAttribute(a), base);
    if (v) return v;
  }
  return null;
}

/** Best <source> srcset of a <picture> (first one whose media query matches). */
function pictureSource(pic: Element, base: string): string | null {
  const view = pic.ownerDocument.defaultView;
  for (const s of pic.querySelectorAll(':scope > source')) {
    const media = s.getAttribute('media');
    if (media && view && !view.matchMedia(media).matches) continue;
    const set =
      sanitizeSrcset(s.getAttribute('srcset'), base) ?? lazySrcset(s, base);
    if (set) return set;
  }
  return null;
}

/** First URL of a srcset (the fallback src when nothing else is known). */
function firstOfSrcset(set: string | null): string | null {
  if (!set) return null;
  return parseSrcset(set)[0]?.url ?? null;
}

function sizeOf(el: Element): { width: number; height: number } {
  const r = el.getBoundingClientRect();
  if (r.width > 0 && r.height > 0)
    return { width: Math.round(r.width), height: Math.round(r.height) };
  const img = el as HTMLImageElement;
  if (img.naturalWidth > 0 && img.naturalHeight > 0)
    return { width: img.naturalWidth, height: img.naturalHeight };
  const w = Number(el.getAttribute('width'));
  const h = Number(el.getAttribute('height'));
  return {
    width: Number.isFinite(w) && w > 0 ? w : 0,
    height: Number.isFinite(h) && h > 0 ? h : 0,
  };
}

function imgInfo(img: HTMLImageElement, base: string): MediaInfo {
  const pic =
    img.parentElement?.localName === 'picture' ? img.parentElement : null;
  const alt = normalizeSpace(img.getAttribute('alt') ?? '');
  const lazy = lazySrc(img, base);
  const loaded = img.complete && img.naturalWidth > 0;
  let src: string | null = null;
  if (loaded) {
    const cur = safeMediaUrl(img.currentSrc || img.src, base);
    // A loaded placeholder means the real image is still lazy.
    src = cur && isPlaceholder(cur) && lazy ? lazy : cur;
  }
  const srcset =
    (pic ? pictureSource(pic, base) : null) ??
    sanitizeSrcset(img.getAttribute('srcset'), base) ??
    lazySrcset(img, base);
  if (!src) {
    const attr = safeMediaUrl(img.getAttribute('src'), base);
    src =
      lazy ??
      (attr && !isPlaceholder(attr) ? attr : null) ??
      firstOfSrcset(srcset);
  }
  return { src, srcset, alt, ...sizeOf(img) };
}

const EMPTY: MediaInfo = {
  src: null,
  srcset: null,
  width: 0,
  height: 0,
  alt: '',
};

function bgInfo(el: Element, base: string): MediaInfo | null {
  const view = el.ownerDocument.defaultView;
  if (!view) return null;
  const url = backgroundImageUrl(view.getComputedStyle(el).backgroundImage);
  const src = safeMediaUrl(url, base) ?? lazySrc(el, base);
  if (!src) return null;
  const alt = normalizeSpace(
    el.getAttribute('aria-label') ??
      (el.getAttribute('role') === 'img'
        ? (el.getAttribute('title') ?? '')
        : ''),
  );
  return { src, srcset: null, alt, ...sizeOf(el) };
}

/**
 * The image (or video poster) behind a media-like element: an img, picture,
 * video, a background-image box, or a container whose first visible image
 * is its thumbnail (a thumbnail link).
 */
export function mediaInfo(el: Element): MediaInfo {
  const base = el.ownerDocument.baseURI;
  const tag = el.localName;
  if (tag === 'img') return imgInfo(el as HTMLImageElement, base);
  if (tag === 'picture') {
    const img = el.querySelector('img');
    if (img) return imgInfo(img, base);
  }
  if (tag === 'video') {
    const v = el as HTMLVideoElement;
    const poster = safeMediaUrl(v.getAttribute('poster'), base);
    return {
      src: poster,
      srcset: null,
      alt: normalizeSpace(el.getAttribute('aria-label') ?? ''),
      ...sizeOf(el),
    };
  }
  const own = bgInfo(el, base);
  if (own) return own;
  // A container: its first image, then a background-image box inside it.
  const img = el.querySelector('img');
  if (img) return imgInfo(img, base);
  const poster = el.querySelector('video[poster]');
  if (poster) return mediaInfo(poster);
  let n = 0;
  for (const d of el.querySelectorAll('*')) {
    if (++n > 60) break;
    const r = d.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) continue;
    const info = bgInfo(d, base);
    if (info) return info;
  }
  return { ...EMPTY };
}

/** Absolute http(s)/mailto/tel href of the link `el` is, sits in, or (alone) contains. */
export function linkHref(el: Element): string | null {
  const base = el.ownerDocument.baseURI;
  const link =
    el.closest('a[href], area[href]') ??
    (() => {
      const inner = el.querySelectorAll('a[href]');
      if (inner.length === 0) return null;
      // Several anchors to the same target (thumbnail + title) count as one.
      const first = inner[0] as HTMLAnchorElement;
      for (const a of inner)
        if ((a as HTMLAnchorElement).href !== first.href) return null;
      return first;
    })();
  if (!link) return null;
  return safeHrefUrl(link.getAttribute('href'), base);
}

/** Registrable-domain approximation (no public suffix list in the page). */
export function siteOf(hostname: string): string {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (/^[\d.]+$/.test(h) || h.includes(':')) return h;
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const tld = parts[parts.length - 1] ?? '';
  const sld = parts[parts.length - 2] ?? '';
  // co.uk, com.au, ne.jp, org.br...: three labels make the site.
  const twoLevel =
    tld.length === 2 &&
    (sld.length <= 3 ||
      /^(?:gov|org|com|net|edu|ac|co|or|ne|go|gob)$/.test(sld));
  return parts.slice(twoLevel ? -3 : -2).join('.');
}

/** Where an href goes relative to the tab's page: same site, other site, a fragment, or nowhere. */
export function hrefKind(raw: string | null, pageUrl: string): SkelHrefKind {
  const s = raw?.trim();
  if (!s) return 'none';
  if (s.startsWith('#')) return 'fragment';
  let u: URL;
  let page: URL;
  try {
    page = new URL(pageUrl);
    u = new URL(s, page);
  } catch {
    return 'none';
  }
  if (u.protocol === 'javascript:') return 'none';
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'other';
  if (
    u.origin === page.origin &&
    u.pathname === page.pathname &&
    u.search === page.search &&
    u.hash
  )
    return 'fragment';
  return siteOf(u.hostname) === siteOf(page.hostname) ? 'same' : 'other';
}

/**
 * Well-known identity providers' sign-in pages. A site's own "Sign in" often
 * goes there (YouTube to accounts.google.com); the validator lets such a
 * link into the account slot even though it leaves the tab's site.
 */
const IDENTITY_PROVIDERS: ReadonlyArray<readonly [string, RegExp]> = [
  ['accounts.google.com', /^\//],
  ['login.microsoftonline.com', /^\//],
  ['login.live.com', /^\//],
  ['appleid.apple.com', /^\//],
  ['www.facebook.com', /^\/(?:login|dialog\/oauth)/],
  ['github.com', /^\/(?:login|session)/],
];

/** The link goes to a well-known identity provider's sign-in page (https only). */
export function isIdentityProvider(
  raw: string | null,
  pageUrl: string,
): boolean {
  const s = raw?.trim();
  if (!s) return false;
  let u: URL;
  try {
    u = new URL(s, pageUrl);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  return IDENTITY_PROVIDERS.some(
    ([host, path]) => u.hostname === host && path.test(u.pathname),
  );
}
