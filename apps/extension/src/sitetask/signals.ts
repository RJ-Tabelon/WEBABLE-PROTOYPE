// Cheap page signals for a real-website task: how many ads are on the page, and whether something is moving in view.
// Read a few times during a task, never on every frame.

/** Class or id tokens that mark an ad box: "ad", "ads", "top-ad", "ad-slot", "adslot", "advertisement", "sponsored"… */
const AD_TOKEN = /^(ads?|advert\w*|sponsor\w*|dfp\w*)$|^ads?[-_]|[-_]ads?([-_]|$)|adslot|adunit|ad-unit|advert|sponsor|taboola|outbrain|gpt-ad|google_ads|dfp-ad/i;

const AD_SELECTOR = [
  'iframe[id^="google_ads_iframe"]',
  'iframe[name^="google_ads_iframe"]',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="amazon-adsystem.com"]',
  'iframe[src*="adnxs.com"]',
  'iframe[src*="taboola.com"]',
  'iframe[src*="outbrain.com"]',
  'iframe[title*="advertisement" i]',
  'ins.adsbygoogle',
  '[id^="div-gpt-ad"]',
  '[data-google-query-id]',
  '[data-ad-slot]',
  '[data-ad-unit]',
  '[aria-label="advertisement" i]',
].join(',');

const AD_LABELS = new Set(['ad', 'ads', 'advertisement', 'sponsored', 'sponsored content', 'paid content', 'paid post', 'promoted', 'paid partner content']);

/** True when a class list or id reads as an ad box. */
export function looksLikeAd(classOrId: string): boolean {
  for (const token of classOrId.split(/\s+/)) {
    if (token && AD_TOKEN.test(token)) return true;
  }
  return false;
}

function boxBigEnough(el: Element, min: number): boolean {
  const r = el.getBoundingClientRect();
  return r.width >= min && r.height >= min;
}

/**
 * Ads and sponsored boxes on the page: ad iframes, ad containers (by common id and class patterns) and
 * "Advertisement" / "Sponsored" labels, each box counted once (boxes inside a counted box don't count again).
 */
export function countAds(doc: Document, skip?: (el: Element) => boolean): number {
  const found: Element[] = [];
  const add = (el: Element) => {
    if (skip?.(el)) return;
    found.push(el);
  };
  try {
    for (const el of Array.from(doc.querySelectorAll(AD_SELECTOR))) if (boxBigEnough(el, 30)) add(el);
    for (const el of Array.from(doc.querySelectorAll('[class*="ad" i], [id*="ad" i], [class*="sponsor" i], [class*="taboola" i], [class*="outbrain" i]'))) {
      if (el === doc.body || el === doc.documentElement) continue;
      const cls = typeof el.className === 'string' ? el.className : el.getAttribute('class') ?? '';
      if (!looksLikeAd(cls) && !looksLikeAd(el.id)) continue;
      if (boxBigEnough(el, 30)) add(el);
    }
  } catch {
    /* odd page: count what we have */
  }
  const boxes = new Set(found);
  const inCounted = (el: Element): boolean => {
    for (let p = el.parentElement; p; p = p.parentElement) if (boxes.has(p)) return true;
    return false;
  };
  let n = 0;
  for (const el of boxes) if (!inCounted(el)) n++;

  // Labels: a short "Advertisement" or "Sponsored" not already inside a counted box.
  const body = doc.body;
  if (body) {
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let seen = 0;
    for (let node = walker.nextNode(); node && seen < 60000; node = walker.nextNode(), seen++) {
      const text = node.nodeValue;
      if (!text || text.length > 40) continue;
      const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!AD_LABELS.has(t)) continue;
      const el = node.parentElement;
      if (!el || skip?.(el) || boxes.has(el) || inCounted(el)) continue;
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') continue;
      n++;
    }
  }
  return n;
}

function inView(el: Element, minSide: number): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < minSide || r.height < minSide) return false;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && Number(cs.opacity || '1') > 0.1;
}

const CAROUSEL_SELECTOR = [
  '[aria-roledescription="carousel" i]',
  '[class*="carousel" i]',
  '[class*="swiper" i]',
  '[class*="slick-track" i]',
  '[class*="slider" i]',
  '[class*="marquee" i]',
  '[class*="ticker" i]',
  'marquee',
].join(',');

/** Watches for something moving in view: a playing video, a running CSS animation, or a carousel that moves by itself. */
export class MotionWatch {
  private last = new Map<Element, string>();
  private lastInputAt = -Infinity;

  constructor(private readonly skip: (el: Element) => boolean) {}

  /** Call on the person's own input (press, wheel, key), so a carousel they moved doesn't count. */
  noteInput(at: number): void {
    this.lastInputAt = at;
  }

  /** True when something is moving in view now. */
  check(now: number): boolean {
    try {
      return this.video() || this.animation() || this.carousel(now);
    } catch {
      return false;
    }
  }

  private video(): boolean {
    for (const v of Array.from(document.querySelectorAll('video'))) {
      if (!v.paused && !v.ended && v.readyState >= 2 && !this.skip(v) && inView(v, 40)) return true;
    }
    return false;
  }

  private animation(): boolean {
    if (typeof document.getAnimations !== 'function') return false;
    const CssAnim = (globalThis as { CSSAnimation?: abstract new (...a: never[]) => Animation }).CSSAnimation;
    for (const a of document.getAnimations()) {
      if (a.playState !== 'running') continue;
      if (CssAnim && !(a instanceof CssAnim)) continue;
      const effect = a.effect as KeyframeEffect | null;
      const target = effect?.target;
      if (!target || this.skip(target)) continue;
      const timing = effect.getComputedTiming();
      const end = typeof timing.endTime === 'number' ? timing.endTime : Infinity;
      const at = typeof timing.localTime === 'number' ? timing.localTime : 0;
      // Long or looping animations only: a one-off fade as a menu opens isn't "moving things".
      if (end !== Infinity && end - at < 1000) continue;
      if (inView(target, 24)) return true;
    }
    return false;
  }

  private carousel(now: number): boolean {
    let moved = false;
    const quiet = now - this.lastInputAt > 2000;
    const seen = new Set<Element>();
    const list = Array.from(document.querySelectorAll(CAROUSEL_SELECTOR)).slice(0, 40);
    for (const el of list) {
      if (this.skip(el) || !inView(el, 60)) continue;
      const parts = [el, el.firstElementChild].filter((x): x is Element => !!x);
      for (const p of parts) {
        seen.add(p);
        const cs = getComputedStyle(p);
        const snap = `${cs.transform}|${cs.left}|${cs.marginLeft}|${(p as HTMLElement).scrollLeft ?? 0}`;
        const before = this.last.get(p);
        if (before !== undefined && before !== snap && quiet) moved = true;
        this.last.set(p, snap);
      }
    }
    for (const k of Array.from(this.last.keys())) if (!seen.has(k)) this.last.delete(k);
    return moved;
  }
}
