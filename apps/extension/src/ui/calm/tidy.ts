// Owner: round 8b (SIMPLIFIED.md). What the simplified page leaves out and how it names what it keeps:
// - rule 1: the site's chrome (share, follow, app promos, account links, ads, newsletter boxes, search on reading pages,
//   menus and the legal footer) is never drawn as content; menu and footer links go to one closed "Site links (N)";
// - rule 2: a machine label or a placeholder ("Open Menu Icon", "CNN logo", "Related card", "Dianomi ad container
//   (4015-358)", "share with x") is never shown, and all-lowercase labels read in sentence case;
// - rule 3: the same item twice (same address, or the same words) is shown once;
// - rule 5: related stories become one list of real titles, "More from {site}";
// - rule 7: the page's own "Listen to this article" control, found so one quiet button can press it.
// Everything here only reads the page.
import { hrefKey } from '@webable/core';
import {
  type Block, type CardLinkBlock, type ControlBlock, type FlowBlock, TOOL_RE, clean, isShown, nameOf, storyFromLink, textOf,
} from './model';

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

/** "Related card", "Related item", "Story", "Untitled": words a site leaves where a title should be. */
const PLACEHOLDER = /^(related|recommended|suggested|sponsored|promoted|promo|teaser|story|article|card|item|items|link|links|content|untitled|null|undefined|none|n\/a|loading\W*|placeholder)( (card|cards|item|items|link|links|content|story|stories|module|article))?$/i;
/** Words that name a part of the page's machinery when they end a short label ("Open Menu Icon", "CNN logo"). */
const MACHINE_END = /\b(icon|logo|logotype|container|button|btn|svg|image|img|placeholder|widget)s?$/i;
/** An internal id in a label: "(4015-358)", "#a1b2c3", "ad_slot_3". */
const MACHINE_ID = /\(\s*\w*\d{2,}[-_:/]\d+\w*\s*\)|#[0-9a-f]{6,}\b|\b[a-z]+_[a-z0-9]+\b/i;
/** A label that reads like code ("header-nav-toggle", "openMenu", "btn_share"). */
const CODEY = /^[a-z]{2,}[a-z0-9]*([A-Z][a-z0-9]+)+$|^[a-z0-9]+([-_][a-z0-9]+){2,}$|^[a-z0-9]+(_[a-z0-9]+)+$/;

/** Rule 2: a label nobody should read (a machine label, an internal id or a placeholder). */
export function isMachineLabel(raw: string): boolean {
  const t = clean(raw);
  if (!t) return true;
  if (PLACEHOLDER.test(t)) return true;
  if (CODEY.test(t)) return true;
  if (MACHINE_ID.test(t) && t.split(/\s+/).length <= 8) return true;
  const words = t.split(/\s+/).length;
  if (words <= 4 && MACHINE_END.test(t.replace(/\s*\([^)]*\)\s*$/, ''))) return true;
  return /^(share|copy link|copy the link)\b/i.test(t) && t === t.toLowerCase();
}

const SOCIAL = 'facebook|x|twitter|instagram|youtube|tiktok|threads|linkedin|pinterest|snapchat|whatsapp|reddit|bluesky|flipboard|tumblr|mastodon|rss';
const SHARE_RE = new RegExp(`^(share|sharing|save|saved|bookmark|print|email|e-mail|copy)\\b|\\bcopy (the )?link\\b|^(${SOCIAL})$|\\b(share|post) (on|to|with|via) (${SOCIAL}|email)\\b`, 'i');
const FOLLOW_RE = new RegExp(`^(follow|visit|find|join|like|add|connect with|subscribe to) (us|our [\\w ]+|[\\w .&']{1,30}) on\\b|^follow\\b|\\bon (${SOCIAL})$`, 'i');
const APP_RE = /\b(app store|google play|play store|get (it|the app)|download (the|our)\b.*\bapps?\b|download on (the )?app|get the [\w ]+ app|open in (the )?app)\b|^(our|get|download|try)\b.{0,40}\bapps?$/i;
const ACCOUNT_RE = /^(subscribe|subscribe now|subscribe today|sign ?in|sign ?up|sign ?out|log ?in|log ?out|register|create (an |your )?account|my account|account|your account|join now|manage (my )?(account|subscription)|start (your |a )?free trial|try [\w ]+ free|get (unlimited )?access|become a (member|subscriber))$/i;
const AD_RE = /^(ad|ads|advert|advertisement|advertisements|sponsored|sponsored (content|links?|stories|by [\w .&'-]+)|paid (content|post|partner( content)?|for by [\w .&'-]+)|promoted( (content|stories))?|partner content|ad feedback|feedback|from our (partners|sponsors)|recommended by|around the web)$/i;
const NEWSLETTER_RE = /\b(newsletter|sign up for (our|the)|get (our|the) [\w ]*(email|newsletter)|enter your email|inbox)\b/i;
const MENU_RE = /^((open|close|show|hide|toggle|expand|collapse)( the)? )?((main|site|primary|mobile|navigation|nav) )?(menu|navigation|nav|sections?|search|more)( (icon|button|toggle))?$/i;
const UTIL_RE = /^(skip to [\w ]+|back to top|top|scroll to top|close|cancel|ok|okay|done|go|submit|next|previous|prev|more|less|show more|show less|load more|see more|read more|continue reading|play|pause|mute|unmute|replay|watch now|listen now|toggle [\w ]+|, ?opens in (a )?new (window|tab)|opens in (a )?new (window|tab))$/i;
const LEGAL_TEXT = /(©|\(c\)\s*\d{4}|\ball rights reserved\b|™|®|\bcopyright\b)/i;

/** Rule 1: the site's own tools and chrome (share, follow, app, account, ad, newsletter, menu and utility labels). */
export function isChromeLabel(raw: string): boolean {
  const t = clean(raw).replace(/[,.]?\s*opens? in (a )?new (window|tab)$/i, '').trim();
  if (!t) return true;
  return (
    TOOL_RE.test(t) || SHARE_RE.test(t) || FOLLOW_RE.test(t) || APP_RE.test(t) || ACCOUNT_RE.test(t) || AD_RE.test(t) ||
    MENU_RE.test(t) || UTIL_RE.test(t)
  );
}

/** A label to show: trimmed, the screen-reader suffix dropped, all-lowercase put in sentence case. */
export function cleanLabel(raw: string): string {
  let t = clean(raw).replace(/[,.]?\s*\(?opens? in (a )?new (window|tab)\)?$/i, '').trim();
  // An address ("wcjb.com/livestream") keeps its own case.
  const address = !/\s/.test(t) && /[./@]/.test(t);
  if (!address && /[a-z]/.test(t) && t === t.toLowerCase()) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

/** Normalised words for "the same item": lowercase, letters and digits only. */
export function normText(raw: string): string {
  return clean(raw).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Same address: without the fragment and a trailing slash. */
export function sameHref(href: string | null | undefined): string {
  if (!href) return '';
  return hrefKey(href).replace(/\/+$/, '').toLowerCase();
}

/** An address on this page itself (a "#top" or "#section" link). */
function onThisPage(href: string | null): boolean {
  if (!href) return false;
  if (href.startsWith('#')) return true;
  try {
    const u = new URL(href, location.href);
    return u.hash !== '' && hrefKey(u.href) === hrefKey(location.href);
  } catch {
    return false;
  }
}

function sameSite(href: string | null): boolean {
  if (!href) return true;
  try {
    const host = new URL(href, location.href).hostname.replace(/^www\./, '');
    const here = location.hostname.replace(/^www\./, '');
    const root = (h: string): string => h.split('.').slice(-2).join('.');
    return host === here || root(host) === root(here);
  } catch {
    return false;
  }
}

const AD_BOX = '[class*="sponsor" i],[class*="dianomi" i],[class*="taboola" i],[class*="outbrain" i],[class*="paid-" i],[class*="native-ad" i],[data-ad],[data-ad-unit],[id^="google_ads" i],[class*="ad-slot" i],[class*="ad-container" i],[class*="ad-feedback" i]';

/** Inside an ad box the page marks as one (a Dianomi, Taboola or "sponsor" container). */
export function inAdBox(el: Element | null): boolean {
  try {
    return !!el?.closest(AD_BOX);
  } catch {
    return false;
  }
}

const CHROME_BOX = 'nav,header,footer,[role=navigation],[role=banner],[role=contentinfo]';

/**
 * In the site's own menu, banner or footer: a nav, header or footer that is not part of the main content (an article's
 * own "On this page" nav or footer stays content), or anything the page marks as its banner or content info.
 */
export function inSiteChrome(el: Element | null): boolean {
  if (!el) return false;
  try {
    if (el.closest('[role=banner],[role=contentinfo]')) return true;
    const c = el.closest('nav,header,footer,[role=navigation]');
    return !!c && !c.parentElement?.closest('article,main,[role=main]');
  } catch {
    return false;
  }
}

function elOf(b: Block): Element | null {
  if ('el' in b && b.el instanceof Element) return b.el;
  return b.src instanceof Element ? b.src : b.src.parentElement;
}

/* ------------------------------------------------------------------ */
/* Stories and links                                                   */
/* ------------------------------------------------------------------ */

/** A real headline: at least four words and 24 characters, not chrome, not a placeholder. */
export function isHeadline(t: string): boolean {
  const s = clean(t);
  return s.length >= 24 && s.split(/\s+/).length >= 4 && !isChromeLabel(s) && !isMachineLabel(s) && !NEWSLETTER_RE.test(s);
}

/** One story for "More from {site}", with a cleaned title, or null when it is not a real story. */
export function storyFrom(b: Block, fromChrome: boolean): CardLinkBlock | null {
  if (fromChrome) return null;
  if (b.b === 'cardlink') {
    const title = cleanLabel(b.title);
    if (!isHeadline(title) || inAdBox(b.el) || !sameSite(b.href)) return null;
    if ([b.kicker, ...b.lines].some((l) => !!l && AD_RE.test(clean(l)))) return null;
    if (b.el.closest(CHROME_BOX) && !b.image) return null;
    return { ...b, title, kicker: b.kicker && !isMachineLabel(b.kicker) ? cleanLabel(b.kicker) : null };
  }
  if (b.b === 'control' && b.role === 'link' && !b.primary && !b.help) {
    const title = cleanLabel(b.text);
    if (!isHeadline(title) || inAdBox(b.el) || !sameSite(b.href) || b.el.closest(CHROME_BOX)) return null;
    return { ...storyFromLink(b), title };
  }
  return null;
}

/** One link for "Site links": a short page link with a real label that is not chrome. */
export function siteLinkFrom(b: Block): ControlBlock | null {
  if (b.b === 'control') {
    if (b.role !== 'link' || b.primary || !b.href || onThisPage(b.href) || /^(javascript|tel|mailto):/i.test(b.href)) return null;
    const text = cleanLabel(b.text);
    if (!text || text.length > 48 || isMachineLabel(text) || isChromeLabel(text) || inAdBox(b.el)) return null;
    return text === b.text ? b : { ...b, text };
  }
  if (b.b === 'cardlink') {
    const text = cleanLabel(b.title);
    if (!b.href || !text || text.length > 48 || isMachineLabel(text) || isChromeLabel(text) || inAdBox(b.el)) return null;
    return { b: 'control', el: b.el, role: 'link', text, href: b.href, primary: false, help: false, selected: false, popup: false, key: `${b.key}l`, src: b.src };
  }
  return null;
}

/** The links of a flow that is only links (a footer line "Terms · Privacy · Cookies"), as link blocks. */
function flowLinks(f: FlowBlock): ControlBlock[] | null {
  const links = f.parts.filter((p) => p.t === 'link');
  if (!links.length) return null;
  const words = f.parts.filter((p) => p.t === 'text').map((p) => (p.t === 'text' ? p.text : '')).join('');
  if (/[\p{L}\p{N}]{3,}/u.test(words.replace(/[|·•,/-]/g, ''))) return null;
  const out: ControlBlock[] = [];
  links.forEach((p, i) => {
    if (p.t !== 'link') return;
    out.push({ b: 'control', el: p.el, role: 'link', text: p.text, href: p.href, primary: false, help: p.help, selected: false, popup: false, key: `${f.key}f${i}`, src: p.el });
  });
  return out;
}

/** Running words worth keeping at the end of a reading page (not a label, a legal line or an ad line). */
function isRealText(t: string): boolean {
  const s = clean(t);
  if (s.length < 60 || LEGAL_TEXT.test(s) || NEWSLETTER_RE.test(s) || AD_RE.test(s)) return false;
  return /[.!?:]/.test(s) || s.split(/\s+/).length >= 12;
}

export interface EndPart { key: string; label: string; blocks: Block[]; chrome: boolean }

export interface EndMatter {
  /** Real related stories, de-duplicated ("More from {site}"). */
  stories: CardLinkBlock[];
  /** Menu and footer links, de-duplicated ("Site links (N)"). */
  links: ControlBlock[];
  /** Real words that are neither (an author's note, a table): kept, in their part. */
  rest: Array<{ key: string; label: string; blocks: Block[] }>;
  /** How many items were left out as chrome. */
  dropped: number;
}

/** Rule 3: the first item for each address and each wording. */
export class Seen {
  private hrefs = new Set<string>();
  private words = new Set<string>();
  /** True the first time an item with this address or these words is offered. */
  fresh(href: string | null | undefined, text: string): boolean {
    const h = sameHref(href);
    const w = normText(text);
    if ((h && this.hrefs.has(h)) || (w && this.words.has(w))) return false;
    if (h) this.hrefs.add(h);
    if (w) this.words.add(w);
    return true;
  }

  /** True the first time this address is offered (items with no address always are). */
  freshHref(href: string | null | undefined): boolean {
    const h = sameHref(href);
    if (!h) return true;
    if (this.hrefs.has(h)) return false;
    this.hrefs.add(h);
    return true;
  }
}

/**
 * Sort what is left at the end of a reading page: stories to "More from {site}", menu and footer links to "Site
 * links", real words kept in their part, and the site's chrome dropped (rules 1–3). `seenStories` holds what the page
 * already shows, so a story is never listed twice.
 */
export function sortEnd(parts: EndPart[], seenStories: Seen = new Seen()): EndMatter {
  const stories: CardLinkBlock[] = [];
  const links: ControlBlock[] = [];
  const rest: EndMatter['rest'] = [];
  const seenLinks = new Seen();
  let dropped = 0;
  const addLink = (b: Block): boolean => {
    const l = siteLinkFrom(b);
    if (!l) return false;
    if (seenLinks.fresh(l.href, l.text)) links.push(l);
    return true;
  };
  for (const part of parts) {
    const kept: Block[] = [];
    let heading: Block | null = null;
    const walk = (bs: Block[]): void => {
      for (const b of bs) {
        switch (b.b) {
          case 'list':
            b.items.forEach(walk);
            break;
          case 'group':
            walk(b.blocks);
            break;
          case 'cardlink':
          case 'control': {
            const s = storyFrom(b, part.chrome);
            if (s) {
              if (seenStories.fresh(s.href, s.title)) stories.push(s);
              break;
            }
            if (!addLink(b)) dropped++;
            break;
          }
          case 'flow': {
            const ls = flowLinks(b);
            if (ls) {
              ls.forEach((l) => addLink(l) || dropped++);
              break;
            }
            if (!part.chrome && isRealText(b.text)) {
              if (heading) kept.push(heading);
              heading = null;
              kept.push(b);
            } else dropped++;
            break;
          }
          case 'heading':
            heading = isMachineLabel(b.text) || isChromeLabel(b.text) || NEWSLETTER_RE.test(b.text) ? null : b;
            break;
          case 'table':
          case 'rtable':
            if (!part.chrome) {
              if (heading) kept.push(heading);
              heading = null;
              kept.push(b);
            } else dropped++;
            break;
          default:
            // Pictures, embedded frames, players, search and sign-up fields: the site's, not the story's.
            dropped++;
        }
      }
    };
    walk(part.blocks);
    if (kept.length) rest.push({ key: part.key, label: part.label, blocks: kept });
  }
  return { stories, links, rest, dropped };
}

/* ------------------------------------------------------------------ */
/* Inside the main content                                             */
/* ------------------------------------------------------------------ */

const AD_PEEK = /\b(ad|ads|advert\w*|sponsor\w*|dianomi|taboola|outbrain|paid)\b|\(\s*\d+[-_]\d+\s*\)/i;

/**
 * Rules 1–3 inside the content the page keeps: share and follow bars, account and app links, ad frames and "Paid
 * content" lines, search fields (on reading pages) and machine labels are left out; repeated stand-alone controls are
 * shown once; all-lowercase labels read in sentence case. Inline links in running text are never touched.
 */
/** A caption shown again as a line of its own (CNN prints a picture's caption twice, once cut short with "…"). */
export function isCaptionEcho(text: string, captions: string[]): boolean {
  if (!captions.length) return false;
  const t = normText(text.replace(/\s*(\.\.\.|…)\s*$/, ''));
  if (t.length < 20) return false;
  return captions.some((c) => c === t || c.startsWith(t));
}

export function scrubBlocks(bs: Block[], o: { reading: boolean; seen?: Seen; chrome?: Block[]; captions?: string[] }): Block[] {
  const seen = o.seen ?? new Seen();
  const out: Block[] = [];
  for (const b of bs) {
    // On a reading page the site's menu, banner and footer are not content: their links go to "Site links", the rest
    // (a copyright line, partner logos, a sign-up box) is left out.
    if (o.reading && b.b !== 'list' && b.b !== 'group' && !(b.b === 'control' && (b.primary || b.help)) && inSiteChrome(elOf(b))) {
      if ((b.b === 'control' || b.b === 'cardlink') && o.chrome) o.chrome.push(b);
      else if (b.b === 'flow' && o.chrome) o.chrome.push(...(flowLinks(b) ?? []));
      continue;
    }
    switch (b.b) {
      case 'control': {
        if (b.primary || b.help) {
          out.push(b);
          break;
        }
        const text = cleanLabel(b.text);
        if (isMachineLabel(text)) break;
        if (o.reading && (isChromeLabel(text) || inAdBox(b.el))) break;
        // On a reading page the same address is offered once (a form's many "Change" links all stay).
        if (o.reading && b.role === 'link' && !seen.freshHref(b.href)) break;
        out.push(text === b.text ? b : { ...b, text });
        break;
      }
      case 'cardlink': {
        const title = cleanLabel(b.title);
        // A card titled by a placeholder ("Related card") is dropped; so is one with no title, except a picture tile
        // on a page that is not for reading (a gallery or a product grid keeps its pictures).
        if (title && isMachineLabel(title)) break;
        if (!title && (o.reading || !b.image)) break;
        if (o.reading && (inAdBox(b.el) || isChromeLabel(title))) break;
        if (o.reading && !seen.freshHref(b.href)) break;
        out.push(title === b.title ? b : { ...b, title });
        break;
      }
      case 'peek':
        // An ad frame, or a frame with no name of its own, is the site's: never drawn on a reading page.
        if (o.reading && (AD_PEEK.test(b.label) || inAdBox(b.el) || (b.why === 'frame' && (!b.label || isMachineLabel(b.label))))) break;
        out.push(b.label && isMachineLabel(b.label) ? { ...b, label: '' } : b);
        break;
      case 'field':
        if (o.reading && b.search) break;
        out.push(b);
        break;
      case 'flow':
        if (o.reading && b.text.length <= 40 && AD_RE.test(clean(b.text))) break;
        if (o.reading && inAdBox(b.src instanceof Element ? b.src : b.src.parentElement)) break;
        // The site's copyright line ("© 1998 - 2026 … All Rights Reserved.") is the legal footer's.
        if (o.reading && b.text.length <= 200 && /(©|\ball rights reserved\b)/i.test(b.text)) break;
        if (o.captions && isCaptionEcho(b.text, o.captions)) break;
        out.push(b);
        break;
      case 'heading':
        if (isMachineLabel(b.text) || (o.reading && (AD_RE.test(clean(b.text)) || FOLLOW_RE.test(clean(b.text))))) break;
        out.push(b);
        break;
      case 'list': {
        const items = b.items.map((it) => scrubBlocks(it, { ...o, seen })).filter((it) => it.length);
        if (items.length) out.push({ ...b, items });
        break;
      }
      case 'group': {
        const blocks = scrubBlocks(b.blocks, { ...o, seen });
        if (blocks.length) out.push({ ...b, blocks });
        break;
      }
      default:
        out.push(b);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Listen to this article (rule 7)                                     */
/* ------------------------------------------------------------------ */

const LISTEN_RE = /^(listen|listen now|listen to (this |the )?(article|story|page|post)|play (this |the )?(article|story|audio)|play audio|hear (this |the )?(article|story)|audio (version|article)|read (it )?aloud|read (this |the )?(article|story) aloud|text to speech)\b/i;

/**
 * The article's own "Listen" or "Play audio" control: a button (or a link that stays on this page) near the
 * article's title, outside menus and footers. Null when the page has none (never a link to the site's podcasts).
 */
export function findListen(h1: Element | null): Element | null {
  if (!h1) return null;
  let top = 0;
  try {
    top = h1.getBoundingClientRect().top + window.scrollY;
  } catch {
    return null;
  }
  const cands = Array.from(document.querySelectorAll('button,[role=button],a[href],[aria-label]')).slice(0, 4000);
  for (const el of cands) {
    if (el.closest('webable-ui') || el.closest(CHROME_BOX) || inAdBox(el)) continue;
    const name = clean(nameOf(el) || el.getAttribute('aria-label') || textOf(el));
    if (!name || name.length > 60 || !LISTEN_RE.test(name)) continue;
    if (el.localName === 'a') {
      const href = el.getAttribute('href') ?? '';
      if (href && !href.startsWith('#') && !/^javascript:/i.test(href)) continue;
    } else if (!el.matches('button,[role=button]')) continue;
    if (!isShown(el)) continue;
    const r = el.getBoundingClientRect();
    const y = r.top + window.scrollY;
    if (y < top - 300 || y > top + 1.6 * (window.innerHeight || 900)) continue;
    return el;
  }
  return null;
}
