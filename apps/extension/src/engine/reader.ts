// Owner: C1. One read pass over the page (no writes).
//
// Produces:
//  - PageOutline: every visible meaningful node (ids n1…, stable across re-reads of one page view),
//  - PageDigest: the <= 40 most decision-worthy elements for Jev (structure only, labels redacted),
//  - LocalFacts for the policy, page body px, busy-ness and sensitive-field detection,
//  - samples the tailor needs (text, controls, sticky bars, carousels),
//  - an id -> Element map (WeakRef) and Element -> id (WeakMap).
// Never reads input values (only whether a field is empty), never sends hostnames, never writes to the DOM.
//
// Round 7: the walk also builds a light tree of the visible page (extract/SNode, no extra layout work). From it the
// reader reads structured content on the device (stats, scoreboards, tables, schedules, recipes, article metadata,
// logos) into `OutlineNode.data`, and the page's top-level content regions into `PageDigest.regions`.

import { allowlistWords, bodySizeFromBlocks, safeClassWords, uiLabel } from '@webable/core';
import type {
  BodyBlock, ElementEvidence, ExtractedData, LocalFacts, OutlineKind, OutlineNode, PageDigest, PageOutline, Zone,
} from '@webable/core';
import { isOurUi } from '../ui/mount';
import { extractPage, type ArticleMeta, type PageExtract, type SNode } from './extract';
import { readLdTexts, readSiteName, snapNode, svgDataUrl } from './extract/dom';

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export interface NodeInfo {
  id: string;
  el: Element;
  kind: OutlineKind;
  tag: string;
  /** Local accessible name or visible text (never sent as is; for on-device UI and ledger only). */
  name: string;
  parent: string | null;
  landmark: string;
  zone: Zone;
  fixed: boolean;
  rect: { x: number; y: number; w: number; h: number }; // page coordinates
  /** Box used for the zone: the overlay root for fixed elements, the enclosing column for small controls. */
  zoneRect: { x: number; y: number; w: number; h: number };
  classWords: string[];
  inMain: boolean;
  help: boolean;
  consent: boolean;
  promo: boolean;
  ad: boolean;
  carousel: boolean;
  overlay: boolean;
  required: boolean;
  filled: boolean;
  disabled: boolean;
  textChars: number;
  headingLevel: number | null;
  linkTarget: ElementEvidence['link_target'] | null;
  iframeKind: string | null;
  weight: ElementEvidence['visual_weight'];
  roleHint: string;
  cards: number;
}

export interface TextSample {
  el: Element;
  fontPx: number;
  weight: number;
  color: string;
  lineHeightPx: number | null;
  family: string;
  chars: number;
  words: number;
  running: boolean;
  headingLevel: number | null;
  control: boolean;
  inMain: boolean;
  clipRisk: boolean;
  /** Template signature (tag + first classes) so clip risk excludes a whole class, never one element. */
  sig: string;
  disabled: boolean;
  iconFont: boolean;
  /** Product of ancestor opacities (text under translucent layers is left alone by the contrast op). */
  opacity: number;
}

export interface ControlSample {
  el: Element;
  id: string | null;
  kind: OutlineKind;
  /** A link inside a sentence (WCAG inline exception): reported, never expanded. */
  inline: boolean;
  disabled: boolean;
  fixed: boolean;
}

export interface BodyInfo {
  px: number;
  source: string;
  /** Blocks and characters the median was taken over. */
  blocks: number;
  chars: number;
  /** CSS font shorthand of the most typical body block (for measuring). */
  font: string;
  /** Average character width of that text at body size, CSS px at 100% zoom. */
  charPx: number;
  /** The most typical body block (local only). */
  el: Element | null;
}

export interface BusyInfo {
  elementCount: number;
  controls: number;
  overlays: number;
  ads: number;
  carousels: number;
  animated: number;
  promos: number;
}

export interface ReadResult {
  at: number;
  url: string;
  digest: PageDigest;
  outline: PageOutline;
  local: LocalFacts;
  nodes: Map<string, NodeInfo>;
  pageBodyPx: number;
  /** Round 3: how the body size was found, the body text's font, and its average character width (CSS px). */
  body: BodyInfo;
  busy: BusyInfo;
  sensitive: boolean;
  /** Webmail and similar: no generative layout. */
  privatePage: boolean;
  pageKind: string;
  mainRoot: Element | null;
  texts: TextSample[];
  controls: ControlSample[];
  stickyBars: Element[];
  carousels: Element[];
  stats: { visited: number; nodes: number; ms: number };
  /** Round 7: structured content read on the device (the data itself is on the outline nodes) and the regions. */
  extracted: ExtractSummary;
}

/** Round 7: what extraction found, by outline id. Local only. */
export interface ExtractSummary {
  /** Outline nodes that carry `data`, with its kind. */
  items: Array<{ id: string; kind: ExtractedData['kind'] }>;
  /** `PageDigest.regions` ids, in document order. */
  regions: string[];
  /** Structure-only description of what each region holds (also in its digest `role_hint`). */
  regionNotes: Record<string, string>;
  /** Article metadata with the ids of its headline, byline, lead image, date and body nodes, when the page is one. */
  article: ArticleMeta | null;
  /** The node carrying the site's logo (`data.kind === 'logo'`), when found. */
  siteLogoId: string | null;
  ms: number;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const MAX_VISITED = 9000;
const MAX_NODES = 600;
const MAX_DIGEST = 40;
const MAX_MAIN_CANDIDATES = 30;
const MAX_TEXT_SAMPLES = 4000;

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'MATH', 'HEAD', 'META', 'LINK', 'TITLE', 'BASE', 'OPTION', 'OPTGROUP',
  'DATALIST', 'PARAM', 'SOURCE', 'TRACK', 'WEBABLE-UI', 'BR', 'WBR', 'AREA', 'MAP', 'OBJECT', 'EMBED',
]);
const RUNNING_TAGS = new Set(['P', 'LI', 'DD', 'DT', 'BLOCKQUOTE', 'TD', 'TH', 'FIGCAPTION']);
const TEXT_TAGS = new Set(['P', 'LI', 'DD', 'DT', 'BLOCKQUOTE', 'FIGCAPTION', 'TD', 'TH', 'LABEL', 'CAPTION', 'LEGEND', 'PRE', 'ADDRESS', 'SMALL']);
const LANDMARK_ROLES = new Set(['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'search', 'form', 'region', 'dialog', 'alertdialog']);

const REGION_WORDS = new Set([
  'promo', 'promos', 'promotion', 'banner', 'card', 'cards', 'tile', 'tiles', 'upsell', 'offer', 'offers', 'deal', 'deals',
  'hero', 'carousel', 'slider', 'slideshow', 'swiper', 'ad', 'ads', 'advert', 'advertisement', 'sponsor', 'sponsored',
  'widget', 'chat', 'modal', 'popup', 'popover', 'dialog', 'cookie', 'cookies', 'consent', 'gdpr', 'alert', 'notice',
  'rail', 'sidebar', 'recommend', 'recommended', 'recommendations', 'recs', 'related', 'trending', 'newsletter',
  'subscribe', 'survey', 'feedback', 'membership', 'upgrade', 'teaser', 'marketing', 'spotlight', 'callout', 'panel',
  'drawer', 'toast', 'snackbar', 'interstitial', 'overlay', 'paywall', 'meter', 'help', 'support', 'contact',
]);
const PROMO_WORDS = /\b(sponsored|advertisement|promo(tion)?s?|upsell|offer|deals?|sale|save \$?\d|\d+% off|free (trial|delivery|shipping|sample)|join now|sign up|subscribe|newsletter|members?hip|rewards?|limited time|shop now|learn more|try (it )?free|bogo|coupon|code [A-Z0-9]{3,}|recommended|you may also like|also (bought|viewed)|trending|most (read|popular)|weekly ad|halloween|survey|how are we doing)\b/i;
const AD_CLASS = /(^|[-_\s])(ad|ads|adsbygoogle|advert|advertisement|sponsor|sponsored|gpt|dfp|doubleclick|taboola|outbrain|promoted)([-_\s]|$)/i;
const CAROUSEL_CLASS = /(carousel|slider|slideshow|swiper|glide|splide|slick|flickity|rotator|marquee|ticker)/i;
export const CONSENT_CLASS = /(cookie|consent|gdpr|ccpa|cmp|onetrust|cookiebot|didomi|usercentrics|truste|cc-window|qc-cmp|privacy-?banner|cookie-?law)/i;
export const CHAT_CLASS = /(chat|livechat|intercom|zendesk|drift|messenger|assistant|helpdesk|support-?widget)/i;
const HELP_NAME = /\b(help|contact|support|chat|call|phone|faq|faqs|questions?|pharmacist|customer (service|care)|assist(ance|ant)?|feedback|live agent|talk to)\b/i;
const NOTICE_CLASS = /(^|[-_\s])(alert|warning|warn|notice|error|danger|caution|important|timeout|expire|expiring)([-_\s]|$)/i;
const IAB_SIZES: Array<[number, number]> = [
  [300, 250], [336, 280], [728, 90], [970, 90], [970, 250], [160, 600], [300, 600], [320, 50], [320, 100], [468, 60], [250, 250],
];
const PRIVATE_HOSTS = /(^|\.)(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com|mail\.yahoo\.com|mail\.proton\.me|app\.slack\.com|web\.whatsapp\.com|messenger\.com|discord\.com)$/i;

/** Bundled iframe host -> category table (the category is sent, never the hostname). */
const IFRAME_HOSTS: Array<[RegExp, string]> = [
  [/(doubleclick\.net|googlesyndication\.com|googleadservices\.com|adnxs\.com|amazon-adsystem\.com|taboola\.com|outbrain\.com|criteo\.(com|net)|adsrvr\.org|pubmatic\.com|rubiconproject\.com|openx\.net|moatads\.com|media\.net|yieldmo\.com|sharethrough\.com|teads\.tv|adform\.net|smartadserver\.com|33across\.com|revcontent\.com|mgid\.com|zergnet\.com|adroll\.com|quantserve\.com)$/i, 'ad_network'],
  [/(youtube\.com|youtube-nocookie\.com|vimeo\.com|player\.vimeo\.com|jwplayer\.com|jwplatform\.com|brightcove\.(net|com)|wistia\.(com|net)|dailymotion\.com|twitch\.tv|vidyard\.com|kaltura\.com)$/i, 'video_player'],
  [/(facebook\.com|fbcdn\.net|twitter\.com|x\.com|platform\.twitter\.com|instagram\.com|tiktok\.com|linkedin\.com|pinterest\.com|reddit\.com|threads\.net)$/i, 'social_embed'],
  [/(google\.com\/maps|maps\.google\.|mapbox\.com|openstreetmap\.org|bing\.com\/maps|here\.com|arcgis\.com)/i, 'map'],
  [/(intercom\.io|intercomcdn\.com|zendesk\.com|zdassets\.com|livechatinc\.com|drift\.com|driftt\.com|hubspot\.com|tawk\.to|olark\.com|genesys\.com|purecloud\.com|salesforceliveagent\.com|ada\.support|gorgias\.chat|freshchat\.com|crisp\.chat|liveperson\.net)$/i, 'chat_widget'],
  [/(onetrust\.com|cookielaw\.org|cookiebot\.com|didomi\.io|usercentrics\.eu|trustarc\.com|consensu\.org|quantcast\.com|cookieyes\.com|termly\.io|iubenda\.com)$/i, 'consent_manager'],
  [/(stripe\.com|stripe\.network|paypal\.com|braintreegateway\.com|braintree-api\.com|adyen\.com|squareup\.com|checkout\.com|klarna\.com|affirm\.com|afterpay\.com)$/i, 'payment'],
  [/(recaptcha\.net|google\.com\/recaptcha|hcaptcha\.com|challenges\.cloudflare\.com|arkoselabs\.com)/i, 'captcha'],
  [/(qualtrics\.com|surveymonkey\.com|medallia\.com|foresee\.com|usabilla\.com|hotjar\.com|typeform\.com|getfeedback\.com)$/i, 'survey'],
  [/(google-analytics\.com|googletagmanager\.com|segment\.(io|com)|mixpanel\.com|clarity\.ms)$/i, 'analytics'],
];

/** A tiny fallback vocabulary, used only if the core allowlist is unavailable (fail closed). */
const FALLBACK_VOCAB = new Set(
  ('search sign in out up log account cart bag checkout buy add to remove menu home help contact us support chat call ' +
    'about privacy terms cookies cookie accept reject all manage preferences settings close open more less show hide next ' +
    'previous back continue submit send save cancel confirm delete edit apply book order orders refill prescriptions ' +
    'pickup delivery store stores price prices quantity size color details description reviews review questions answers ' +
    'related recommended for you sponsored ad ads advertisement offers deals sale shop now learn join start free trial ' +
    'subscribe newsletter email password name address phone date time today select choose option options yes no ok ' +
    'skip main content navigation footer header page pages results filter filters sort view list grid map share print ' +
    'download upload file files video play pause stop mute volume full screen language english español the a an and or of ' +
    'in on at by with your our my this that is are be it from new weekly health pharmacy vaccines photo savings').split(/\s+/),
);

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

export function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function words(s: string): string[] {
  return collapse(s).split(' ').filter(Boolean);
}

function firstWords(s: string, n: number): string {
  const w = words(s);
  return w.length <= n ? w.join(' ') : `${w.slice(0, n).join(' ')}…`;
}

function crudeRedact(s: string): string {
  return s
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[link]')
    .replace(/[$€£¥]\s?\d[\d,.]*/g, '[amount]')
    .replace(/\d[\d\s().,/#:-]*\d|\d/g, '[number]');
}

/** Redacted UI label (core uiLabel); fails closed to a crude redaction if core is unavailable. */
export function safeUiLabel(s: string, maxWords = 15): string {
  const text = collapse(s);
  if (!text) return '';
  try {
    return uiLabel(text, maxWords);
  } catch {
    return firstWords(crudeRedact(text), maxWords).replace(/…$/, '');
  }
}

/** Allowlisted interface words (core allowlistWords); fails closed to a tiny vocabulary. */
export function safeAllowlist(s: string, maxWords = 8): string {
  const text = collapse(s);
  if (!text) return '';
  let out: string;
  try {
    out = allowlistWords(text);
  } catch {
    out = text
      .split(' ')
      .map((w) => (FALLBACK_VOCAB.has(w.toLowerCase().replace(/[^a-zñ]/gi, '')) ? w.replace(/\d/g, '#') : '·'))
      .join(' ');
  }
  const w = words(out);
  // Collapse runs of placeholders so "· · · ·" becomes "·".
  const squashed: string[] = [];
  for (const x of w) {
    if (x === '·' && squashed[squashed.length - 1] === '·') continue;
    squashed.push(x);
  }
  return squashed.slice(0, maxWords).join(' ');
}

interface Rgb { r: number; g: number; b: number; a: number }

/** Parse a computed colour (rgb()/rgba(); computed styles use these for sRGB colours). */
export function parseRgb(css: string): Rgb | null {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(css.trim());
  if (!m) {
    if (css === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    return null;
  }
  let a = 1;
  if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { r: parseFloat(m[1] ?? '0'), g: parseFloat(m[2] ?? '0'), b: parseFloat(m[3] ?? '0'), a };
}

function saturation(c: Rgb): number {
  const max = Math.max(c.r, c.g, c.b) / 255;
  const min = Math.min(c.r, c.g, c.b) / 255;
  if (max === 0) return 0;
  return (max - min) / max;
}

function luminance(c: Rgb): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

export function ratio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Split id and class into lowercase alphabetic words, dropping hashes and framework noise. */
export function classWordsOf(el: Element, max = 6): string[] {
  const raw = `${el.id ?? ''} ${typeof el.className === 'string' ? el.className : (el.getAttribute('class') ?? '')}`;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of raw.split(/[\s]+/)) {
    if (!token || token.length > 40) continue;
    // css-modules / styled-components hashes: mixed digits and letters in one chunk
    for (const part of token
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/[-_:.\s/[\]]+/)) {
      const w = part.toLowerCase();
      if (w.length < 2 || w.length > 18) continue;
      if (!/^[a-z]+$/.test(w)) continue;
      if (/^(css|sc|jsx|js|tw|ng|v|x|y|el|is|has|col|row|mt|mb|ml|mr|pt|pb|pl|pr|px|py|mx|my|md|lg|sm|xs|xl|w|h|d|flex|grid|block|inline|hidden|relative|absolute|items|justify|gap|text|font|bg|border|rounded|shadow|p|m)$/.test(w)) continue;
      if (seen.has(w)) continue;
      seen.add(w);
      out.push(w);
      if (out.length >= max) return out;
    }
  }
  return out;
}

function siteOf(host: string): string {
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join('.');
  // co.uk, com.au and similar
  if (/^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/.test(last2) && parts.length >= 3) return parts.slice(-3).join('.');
  return last2;
}

export function iframeKindOf(src: string): string {
  if (!src || src === 'about:blank' || src.startsWith('javascript:')) return 'inline_frame';
  let u: URL;
  try {
    u = new URL(src, location.href);
  } catch {
    return 'other';
  }
  if (u.protocol === 'data:' || u.protocol === 'blob:') return 'inline_frame';
  const host = u.hostname.toLowerCase();
  if (siteOf(host) === siteOf(location.hostname.toLowerCase())) return 'same_site';
  const hostPath = `${host}${u.pathname}`;
  for (const [re, kind] of IFRAME_HOSTS) {
    if (re.test(host) || re.test(hostPath)) return kind;
  }
  return 'other_site';
}

export function linkTargetOf(a: Element): ElementEvidence['link_target'] | null {
  const href = a.getAttribute('href');
  if (href === null) return null;
  const h = href.trim();
  if (!h || h.startsWith('#') || h.toLowerCase().startsWith('javascript:')) return 'same page';
  let u: URL;
  try {
    u = new URL(h, location.href);
  } catch {
    return 'this website';
  }
  if (u.protocol === 'mailto:' || u.protocol === 'tel:' || u.protocol === 'sms:') return 'this website';
  if (u.origin === location.origin && u.pathname === location.pathname && u.search === location.search && u.hash) {
    return 'same page';
  }
  if (siteOf(u.hostname.toLowerCase()) === siteOf(location.hostname.toLowerCase())) return 'this website';
  return 'another website';
}

/** Text of an element, skipping option lists, scripts and our UI, capped. */
export function visibleTextOf(el: Element, cap = 400): string {
  let out = '';
  const walk = (n: Node): boolean => {
    if (out.length >= cap) return false;
    if (n.nodeType === 3) {
      out += (n as Text).data;
      out += ' ';
      return true;
    }
    if (n.nodeType !== 1) return true;
    const e = n as Element;
    const t = e.tagName;
    if (t === 'SCRIPT' || t === 'STYLE' || t === 'NOSCRIPT' || t === 'TEMPLATE' || t === 'SELECT' || t === 'OPTION' || t === 'TEXTAREA' || t === 'WEBABLE-UI') return true;
    if (e.getAttribute('aria-hidden') === 'true') return true;
    for (let c = e.firstChild; c; c = c.nextSibling) if (!walk(c)) return false;
    return true;
  };
  walk(el);
  return collapse(out).slice(0, cap);
}

function directText(el: Element): string {
  let s = '';
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) s += (c as Text).data;
  }
  return collapse(s);
}

/** Simplified accessible name: labelledby, aria-label, labels, alt, title, then visible text. */
export function accessibleName(el: Element): string {
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const parts: string[] = [];
    for (const id of by.split(/\s+/)) {
      const ref = id ? el.ownerDocument.getElementById(id) : null;
      if (ref) parts.push(visibleTextOf(ref, 200));
    }
    const s = collapse(parts.join(' '));
    if (s) return s;
  }
  const al = el.getAttribute('aria-label');
  if (al && collapse(al)) return collapse(al);
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
    const input = el as HTMLInputElement;
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    if (tag === 'INPUT' && (type === 'submit' || type === 'button' || type === 'reset')) {
      // The visible label of a button input is its value attribute (markup, not typed by the person).
      return collapse(el.getAttribute('value') ?? (type === 'reset' ? 'Reset' : 'Submit'));
    }
    if (tag === 'INPUT' && type === 'image') return collapse(el.getAttribute('alt') ?? 'Submit');
    const labels = input.labels ? Array.from(input.labels) : [];
    const lt = collapse(labels.map((l) => visibleTextOf(l, 200)).join(' '));
    if (lt) return lt;
    const ph = el.getAttribute('placeholder');
    if (ph && collapse(ph)) return collapse(ph);
    const title = el.getAttribute('title');
    if (title) return collapse(title);
    return '';
  }
  if (tag === 'IMG' || (tag === 'INPUT' && el.getAttribute('type') === 'image')) {
    return collapse(el.getAttribute('alt') ?? el.getAttribute('title') ?? '');
  }
  if (tag === 'SVG' || tag === 'svg') {
    const t = el.querySelector('title');
    return collapse(t?.textContent ?? '');
  }
  if (tag === 'IFRAME') return collapse(el.getAttribute('title') ?? '');
  const text = visibleTextOf(el, 300);
  if (text) return text;
  // Icon-only controls: look for an image alt inside
  const img = el.querySelector('img[alt]');
  if (img) return collapse(img.getAttribute('alt') ?? '');
  return collapse(el.getAttribute('title') ?? '');
}

function shapeOf(text: string): string | null {
  const t = collapse(text);
  if (!t) return null;
  if (t.length <= 40) {
    if (/^[^\d]{0,6}[$€£¥]\s?\d[\d,.]*\s*\S{0,6}$/.test(t) || /^\d[\d,.]*\s?(USD|EUR|GBP)$/i.test(t)) return 'price';
    if (/\b\d(\.\d)?\s*(out of|\/)\s*5\b|★/.test(t)) return 'rating';
    if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(t)) return 'email';
    if (/^(\+?\d[\d\s().-]{6,}\d)$/.test(t)) return 'phone';
    if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$|^\d{4}-\d{2}-\d{2}$|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}(, \d{4})?$/i.test(t)) return 'date';
    if (/^\d{1,2}:\d{2}\s?(am|pm)?$/i.test(t)) return 'time';
    if (/^https?:\/\//i.test(t)) return 'url';
    if (/^\(?\d{1,5}\)?$/.test(t)) return 'count';
    if (/^#?\d{6,}$/.test(t)) return 'id';
  }
  return null;
}

function lengthBucket(n: number): number {
  const buckets = [10, 20, 40, 60, 80, 100, 150, 200, 300, 400, 600];
  for (const b of buckets) if (n <= b) return b;
  return 600;
}

function landmarkOfTag(el: Element, insideSectioning: boolean): string | null {
  const role = (el.getAttribute('role') ?? '').toLowerCase();
  if (role && LANDMARK_ROLES.has(role)) return role === 'alertdialog' ? 'dialog' : role;
  switch (el.tagName) {
    case 'HEADER':
      return insideSectioning ? null : 'banner';
    case 'FOOTER':
      return insideSectioning ? null : 'contentinfo';
    case 'NAV':
      return 'navigation';
    case 'MAIN':
      return 'main';
    case 'ASIDE':
      return 'complementary';
    case 'FORM':
      return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || el.hasAttribute('name') ? 'form' : null;
    case 'SEARCH':
      return 'search';
    case 'DIALOG':
      return (el as HTMLDialogElement).open ? 'dialog' : null;
    case 'SECTION':
      return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : null;
    default:
      return null;
  }
}

function inputType(el: Element): string {
  return (el.getAttribute('type') ?? 'text').toLowerCase();
}

/** Outline kind for an interactive element, or null. */
function controlKindOf(el: Element, cs: CSSStyleDeclaration, parentPointer: boolean): OutlineKind | null {
  const tag = el.tagName;
  const role = (el.getAttribute('role') ?? '').toLowerCase();
  switch (role) {
    case 'button':
    case 'menuitem':
    case 'menuitemcheckbox':
    case 'menuitemradio':
    case 'tab':
    case 'option':
      return 'button';
    case 'link':
      return 'link';
    case 'checkbox':
    case 'switch':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'combobox':
    case 'listbox':
      return 'select';
    case 'textbox':
    case 'searchbox':
    case 'spinbutton':
    case 'slider':
      return 'field';
    default:
      break;
  }
  if (tag === 'A') return el.hasAttribute('href') ? 'link' : null;
  if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
  if (tag === 'SELECT') return 'select';
  if (tag === 'TEXTAREA') return 'field';
  if (tag === 'INPUT') {
    const t = inputType(el);
    if (t === 'hidden') return null;
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return 'button';
    return 'field';
  }
  if ((el as HTMLElement).isContentEditable && el.getAttribute('contenteditable') !== null) return 'field';
  // Clickable divs: pointer cursor where the parent is not pointer, and keyboard reachable or with an inline handler.
  if (cs.cursor === 'pointer' && !parentPointer && (el.hasAttribute('tabindex') || el.hasAttribute('onclick'))) return 'button';
  return null;
}

function isRunningText(tag: string, chars: number, wordCount: number): boolean {
  if (RUNNING_TAGS.has(tag)) return chars >= 2;
  return chars >= 40 && wordCount >= 6;
}

function headingLevelOf(el: Element): number | null {
  const m = /^H([1-6])$/.exec(el.tagName);
  if (m) return Number(m[1]);
  if ((el.getAttribute('role') ?? '') === 'heading') {
    const lvl = Number(el.getAttribute('aria-level') ?? '2');
    return Number.isFinite(lvl) && lvl >= 1 && lvl <= 6 ? lvl : 2;
  }
  return null;
}

function fieldFilled(el: Element): boolean {
  // Only whether the field is empty; the value itself is never read into any structure.
  const tag = el.tagName;
  if (tag === 'INPUT') {
    const t = inputType(el);
    if (t === 'checkbox' || t === 'radio') return (el as HTMLInputElement).checked;
    if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image' || t === 'hidden') return false;
    return (el as HTMLInputElement).value.length > 0;
  }
  if (tag === 'TEXTAREA') return (el as HTMLTextAreaElement).value.length > 0;
  if (tag === 'SELECT') return (el as HTMLSelectElement).selectedIndex > 0;
  return false;
}

function isDisabled(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled === true) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  return !!el.closest('fieldset[disabled]');
}

function isIconFont(family: string): boolean {
  return /icon|awesome|material symbols|material icons|glyph|fontello|ionicons|feather|remixicon|bootstrap-icons|dashicons/i.test(family);
}

/* ------------------------------------------------------------------ */
/* The reader                                                          */
/* ------------------------------------------------------------------ */

interface Ctx {
  parentId: string | null;
  landmark: string;
  sectioning: boolean; // inside article/aside/main/nav/section (header/footer lose landmark meaning)
  fixed: boolean;
  inMain: boolean;
  inControl: boolean;
  hLevel: number | null;
  inText: boolean;
  inTable: boolean;
  pointer: boolean;
  opacity: number;
}

interface Draft {
  info: NodeInfo;
  node: OutlineNode;
  score: number;
  order: number;
  /** Round 7: added after the walk for a region or a data box (never in `digest.elements`, never capped away). */
  forced?: boolean;
}

export class PageReader {
  private ids = new WeakMap<Element, string>();
  private refs = new Map<string, WeakRef<Element>>();
  private next = 1;

  /** Forget all ids (a new page view). */
  reset(): void {
    this.ids = new WeakMap();
    this.refs.clear();
    this.next = 1;
  }

  idFor(el: Element): string | null {
    return this.ids.get(el) ?? null;
  }

  elementFor(id: string): Element | null {
    const el = this.refs.get(id)?.deref() ?? null;
    if (!el || !el.isConnected) return null;
    return el;
  }

  /** The element's id, assigning a new one when the reader has not seen it (overlay roots, their buttons). */
  ensureId(el: Element): string {
    return this.assign(el);
  }

  private assign(el: Element): string {
    const have = this.ids.get(el);
    if (have) return have;
    if (this.next > 9999) this.next = 1; // ids must stay n1..n9999
    const id = `n${this.next++}`;
    this.ids.set(el, id);
    this.refs.set(id, new WeakRef(el));
    return id;
  }

  read(): ReadResult {
    const t0 = performance.now();
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    const frameW = pageFrame().width;
    const sx = scrollX;
    const sy = scrollY;
    const docH = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0, vh);
    const body = document.body;

    const drafts: Draft[] = [];
    const draftById = new Map<string, Draft>();
    const texts: TextSample[] = [];
    const controls: ControlSample[] = [];
    const stickyBars: Element[] = [];
    const carousels: Element[] = [];
    const landmarksSeen: string[] = [];
    const headings: string[] = [];
    let visited = 0;
    let sensitive = false;
    let animated = 0;

    if (document.querySelector(SENSITIVE_SELECTOR)) sensitive = true;
    const mains = Array.from(document.querySelectorAll('main, [role="main"]')).filter((m) => {
      const r = m.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const mainRoot: Element | null = mains[0] ?? scoreMain(body);
    const mainIsBody = !!body && mainRoot === body;
    const bands = { headerBottom: 0, footerTop: docH };

    const stack: Array<{ el: Element; ctx: Ctx; ps: SNode; ci: number }> = [];
    const rootCtx: Ctx = {
      parentId: null, landmark: 'none', sectioning: false, fixed: false, inMain: mainIsBody, inControl: false,
      hLevel: null, inText: false, inTable: false, pointer: false, opacity: 1,
    };
    // Round 7: the light tree of the visible page, built as the walk goes (see extract/types.ts).
    const snapRoot: SNode = {
      tag: 'body', cls: body ? `${body.id ?? ''} ${body.getAttribute('class') ?? ''}`.toLowerCase().trim() : '', text: '',
      x: 0, y: 0, w: Math.max(vw, document.documentElement.scrollWidth), h: docH, fs: 16, fw: 400, kids: [],
    };
    if (body) snapRoot.el = body;
    const snapByEl = new Map<Element, SNode>();
    if (body) snapByEl.set(body, snapRoot);
    const pushChildren = (el: Element, ctx: Ctx, ps: SNode) => {
      let kids: Element[];
      const sr = (el as HTMLElement).shadowRoot;
      if (sr) kids = Array.from(sr.children);
      else if (el.tagName === 'SLOT') {
        const assigned = (el as HTMLSlotElement).assignedElements({ flatten: true });
        kids = assigned.length ? assigned : Array.from(el.children);
      } else kids = Array.from(el.children);
      for (let i = kids.length - 1; i >= 0; i--) {
        const k = kids[i];
        if (k) stack.push({ el: k, ctx, ps, ci: i });
      }
    };
    const add = (d: Draft) => {
      drafts.push(d);
      draftById.set(d.info.id, d);
      return d;
    };
    if (body) pushChildren(body, rootCtx, snapRoot);

    let order = 0;
    while (stack.length) {
      const item = stack.pop();
      if (!item) break;
      const { el, ctx, ps } = item;
      if (++visited > MAX_VISITED) break;
      const tag = el.tagName.toUpperCase();
      if (SKIP_TAGS.has(tag)) continue;
      if (safeIsOurs(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      if (cs.display === 'contents') {
        pushChildren(el, ctx, ps);
        continue;
      }
      if (!el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })) continue;
      const op = parseFloat(cs.opacity);
      if (op === 0) continue;
      const rect = el.getBoundingClientRect();
      // Screen-reader-only boxes and content pushed off the page are not part of what is seen.
      if (rect.width <= 1 && rect.height <= 1 && cs.overflow !== 'visible') continue;
      const pageX = rect.left + sx;
      const pageY = rect.top + sy;
      const position = cs.position;
      const selfFixed = position === 'fixed' || (position === 'sticky' && rect.top <= 2 && rect.width >= 0.6 * frameW);
      const fixed = ctx.fixed || selfFixed;
      if (!fixed && (rect.right + sx < 0 || rect.bottom + sy < 0)) continue;
      if (cs.animationName && cs.animationName !== 'none' && cs.animationIterationCount === 'infinite') animated++;
      const sn = snapNode(el, tag, cs, rect, sx, sy, item.ci);
      if (position === 'fixed' || ps.fixed) sn.fixed = true;
      ps.kids.push(sn);
      snapByEl.set(el, sn);

      const role = (el.getAttribute('role') ?? '').toLowerCase();
      const lm = landmarkOfTag(el, ctx.sectioning);
      const landmark = lm ?? ctx.landmark;
      if (lm && rect.width > 0 && rect.height > 0 && !landmarksSeen.includes(lm)) landmarksSeen.push(lm);
      if (lm === 'banner' && !fixed) bands.headerBottom = Math.max(bands.headerBottom, pageY + rect.height);
      if (lm === 'contentinfo' && !fixed) bands.footerTop = Math.min(bands.footerTop, pageY);
      const chromeLandmark = lm === 'banner' || lm === 'contentinfo' || lm === 'navigation';
      const inMain = (ctx.inMain || el === mainRoot || lm === 'main') && !chromeLandmark;
      const sectioning = ctx.sectioning || tag === 'ARTICLE' || tag === 'ASIDE' || tag === 'MAIN' || tag === 'NAV' || tag === 'SECTION';
      const opacity = ctx.opacity * (Number.isFinite(op) ? op : 1);
      const pointer = cs.cursor === 'pointer';
      const area = rect.width * rect.height;
      const cw = classWordsOf(el);
      const cwStr = cw.join(' ');
      const disabled = isDisabled(el);
      const dtext = directText(el);
      const base: Ctx = { ...ctx, landmark, sectioning, fixed, inMain, pointer, opacity };

      // Iframes are opaque boxes; payment frames mark the page sensitive.
      if (tag === 'IFRAME') {
        const kind = iframeKindOf(el.getAttribute('src') ?? '');
        if (kind === 'payment') sensitive = true;
        if (area >= 400 && !ctx.inControl) {
          const d = add(this.draft(el, 'media', tag, ctx, landmark, fixed, rect, pageX, pageY, cw, inMain, order++));
          d.info.iframeKind = kind;
          d.info.ad = kind === 'ad_network' || isIabSize(rect.width, rect.height);
          d.info.consent = kind === 'consent_manager';
          d.info.help = kind === 'chat_widget';
          d.info.overlay = selfFixed;
          d.info.roleHint = 'none';
          d.node.shape = 'embedded frame';
        }
        continue;
      }

      // Images, video, canvas and SVG are leaves.
      if (tag === 'PICTURE') {
        pushChildren(el, ctx, sn);
        continue;
      }
      if (tag === 'IMG' || tag === 'SVG' || tag === 'CANVAS' || tag === 'VIDEO' || tag === 'AUDIO') {
        const media = tag === 'VIDEO' || tag === 'AUDIO';
        if (media) {
          const v = el as HTMLMediaElement;
          if (v.autoplay || !v.paused) animated++;
        }
        const minSide = tag === 'SVG' ? 24 : 32;
        if (!ctx.inControl && ctx.hLevel === null && rect.width >= minSide && rect.height >= minSide) {
          const d = add(this.draft(el, media ? 'media' : 'image', tag, ctx, landmark, fixed, rect, pageX, pageY, cw, inMain, order++));
          d.node.shape = media ? (tag === 'VIDEO' ? 'video' : 'audio') : area > 90000 ? 'image large' : 'image';
          d.info.roleHint = media ? (tag === 'VIDEO' ? 'video' : 'audio') : 'img';
        }
        continue;
      }

      // Inside a control: only text samples (label spans), no nodes.
      if (ctx.inControl) {
        if (dtext) this.textSample(el, cs, texts, ctx, inMain, true, opacity, disabled);
        pushChildren(el, base, sn);
        continue;
      }

      // Controls.
      const ck = controlKindOf(el, cs, ctx.pointer);
      if (ck) {
        const d = add(this.draft(el, ck, tag, ctx, landmark, fixed, rect, pageX, pageY, cw, inMain, order++));
        d.info.disabled = disabled;
        if (ck === 'field' || ck === 'select' || ck === 'checkbox' || ck === 'radio') {
          d.info.required = (el as HTMLInputElement).required === true || el.getAttribute('aria-required') === 'true';
          d.info.filled = fieldFilled(el);
          d.node.shape = fieldShape(el, ck);
        }
        if (ck === 'link') d.info.linkTarget = linkTargetOf(el);
        d.info.help = HELP_NAME.test(d.info.name) || /^(tel|mailto|sms):/i.test(el.getAttribute('href') ?? '');
        d.info.overlay = selfFixed && area >= 0.01 * vw * vh;
        d.info.roleHint = roleHintOf(el, ck, disabled);
        d.info.promo = PROMO_WORDS.test(d.info.name);
        const inline = ck === 'link' && ctx.inText && cs.display.startsWith('inline') && cs.display !== 'inline-block' && cs.display !== 'inline-flex';
        controls.push({ el, id: d.info.id, kind: ck, inline, disabled, fixed });
        if (dtext) this.textSample(el, cs, texts, ctx, inMain, true, opacity, disabled);
        pushChildren(el, { ...base, inControl: true, parentId: d.info.id }, sn);
        continue;
      }

      // Headings.
      const hl = ctx.hLevel === null ? headingLevelOf(el) : null;
      if (hl !== null) {
        const d = add(this.draft(el, 'heading', tag, ctx, landmark, fixed, rect, pageX, pageY, cw, inMain, order++));
        d.node.level = hl;
        d.info.headingLevel = hl;
        d.info.roleHint = `heading level ${hl}`;
        if (hl <= 3 && headings.length < 8) {
          const label = safeUiLabel(d.info.name, 10);
          if (label) headings.push(label);
        }
        const hctx: Ctx = { ...base, hLevel: hl, parentId: d.info.id };
        if (dtext) this.textSample(el, cs, texts, hctx, inMain, false, opacity, false);
        pushChildren(el, hctx, sn);
        continue;
      }

      // Any element with direct text is a text sample (for size, weight and contrast ops).
      if (dtext) this.textSample(el, cs, texts, ctx, inMain, false, opacity, disabled);

      let next: Ctx = base;
      if (ctx.hLevel === null) {
        if (tag === 'TABLE' && area > 0) {
          // Tables: one node; controls inside are still found.
          const d = add(this.draft(el, 'table', tag, ctx, landmark, fixed, rect, pageX, pageY, cw, inMain, order++));
          const t = el as HTMLTableElement;
          const rows = t.rows?.length ?? 0;
          const cols = t.rows?.[0]?.cells.length ?? 0;
          d.node.shape = `table ${rows} x ${cols}`;
          d.info.roleHint = 'table';
          d.info.textChars = collapse(el.textContent ?? '').length;
          next = { ...base, parentId: d.info.id, inTable: true };
        } else if (!ctx.inTable) {
          const isList = (tag === 'UL' || tag === 'OL' || tag === 'DL' || role === 'list') && countVisibleChildren(el) >= 2;
          const cards = isList ? 0 : repeatedCards(el);
          let made: Draft | null = null;
          if (isList || cards >= 4) {
            const n = isList ? countVisibleChildren(el) : cards;
            made = add(this.draft(el, 'list', tag, ctx, landmark, fixed, rect, pageX, pageY, cw, inMain, order++));
            made.node.shape = cards >= 4 ? `cards x ${n}` : `list x ${n}`;
            made.info.cards = cards >= 4 ? cards : 0;
            made.info.roleHint = 'list';
            made.info.textChars = collapse(el.textContent ?? '').length;
            made.info.carousel = CAROUSEL_CLASS.test(cwStr) || /carousel/i.test(el.getAttribute('aria-roledescription') ?? '');
            if (made.info.carousel) carousels.push(el);
            markPromo(made.info, el, cwStr);
          } else {
            const why = regionReason(el, tag, role, cs, rect, cw, cwStr, selfFixed, lm, vw, vh, docH, ctx, area);
            // Regions that carry their own running text become text nodes (keeping the region flags),
            // so a renderer that shows children never loses that text.
            const textRegion = why !== null && dtext.length >= 20 && why !== 'landmark' && why !== 'overlay' && why !== 'fieldset' && why !== 'notice';
            if (why && !textRegion) {
              const parent = ctx.parentId ? draftById.get(ctx.parentId) : undefined;
              const box = { x: pageX, y: pageY, w: rect.width, h: rect.height };
              if (parent && parent.info.kind !== 'text' && parent.info.kind !== 'list' && nearlySame(parent.info.rect, box)) {
                // A wrapper of the same box: merge flags into the existing node.
                parent.info.consent = parent.info.consent || CONSENT_CLASS.test(cwStr);
                parent.info.carousel = parent.info.carousel || CAROUSEL_CLASS.test(cwStr);
                parent.info.ad = parent.info.ad || AD_CLASS.test(cwStr);
                parent.info.help = parent.info.help || (!parent.info.consent && CHAT_CLASS.test(cwStr));
                for (const w of cw) if (!parent.info.classWords.includes(w) && parent.info.classWords.length < 6) parent.info.classWords.push(w);
              } else {
                made = add(this.draft(el, why === 'notice' ? 'notice' : 'region', tag, ctx, landmark, fixed, rect, pageX, pageY, cw, inMain, order++));
                this.regionFlags(made, el, tag, role, lm, cwStr, selfFixed, area, vw, vh, carousels);
              }
            } else if (shouldBeText(el, tag, cs, dtext, ctx)) {
              const full = visibleTextOf(el, 2000);
              if (full && area > 0) {
                made = add(this.draft(el, 'text', tag, ctx, landmark, fixed, rect, pageX, pageY, cw, inMain, order++, full));
                made.info.textChars = full.length;
                made.info.help = HELP_NAME.test(firstWords(full, 16)) && full.length < 200;
                made.info.roleHint = 'text';
                made.node.shape = shapeOf(full) ?? (tag === 'P' || full.length > 80 ? `paragraph text(${lengthBucket(full.length)})` : `text(${lengthBucket(full.length)})`);
                if (textRegion) this.regionFlags(made, el, tag, role, lm, cwStr, selfFixed, area, vw, vh, carousels);
                next = { ...base, inText: true };
              }
            }
          }
          if (made) next = { ...next, parentId: made.info.id };
        }
      }

      // Sticky header and footer bars for the tailor (never consent notices or dialogs).
      if (selfFixed && rect.width >= 0.6 * frameW && (rect.top <= 2 || rect.bottom >= vh - 2) && rect.height >= 24
        && !CONSENT_CLASS.test(cwStr) && role !== 'dialog' && role !== 'alertdialog' && tag !== 'DIALOG') {
        stickyBars.push(el);
      }

      pushChildren(el, next, sn);
    }

    // Round 7: structured content and the page's regions, read from the tree the walk built. Adds nodes for regions and
    // data boxes the walk did not make into nodes (before zones, so they get theirs).
    const ext = this.applyExtract(snapRoot, mainRoot ? snapByEl.get(mainRoot) ?? null : null, drafts, draftById, mainRoot, vw, vh);

    // Zones and positions need the header/footer bands, so compute them after the walk.
    const forms = mainRoot
      ? Array.from(mainRoot.querySelectorAll('form, fieldset'))
        .map((f) => {
          const r = f.getBoundingClientRect();
          return { top: r.top + sy, bottom: r.bottom + sy, left: r.left + sx, right: r.right + sx };
        })
        .filter((r) => r.bottom > r.top)
      : [];
    for (const d of drafts) {
      d.info.zone = zoneOf(d.info, vw, vh, sx, sy, bands);
      d.node.zone = d.info.zone;
      d.info.weight = visualWeightOf(d.info.el);
    }

    // Cap the outline (keep DOM order; prefer structural nodes, controls and the first screens).
    let kept = drafts;
    if (drafts.length > MAX_NODES) {
      const ranked = [...drafts].sort((a, b) => nodePriority(b, vh) - nodePriority(a, vh)).slice(0, MAX_NODES);
      const keepSet = new Set(ranked.map((d) => d.info.id));
      kept = drafts.filter((d) => keepSet.has(d.info.id));
      const byEl = new Map(kept.map((d) => [d.info.el, d.info.id] as const));
      for (const d of kept) {
        if (d.node.parent && !keepSet.has(d.node.parent)) {
          let p = d.info.el.parentElement;
          let found: string | undefined;
          while (p && !found) {
            found = byEl.get(p);
            p = p.parentElement;
          }
          if (found) d.node.parent = found;
          else delete d.node.parent;
          d.info.parent = found ?? null;
        }
      }
    }

    const nodes = new Map<string, NodeInfo>();
    const outlineNodes: OutlineNode[] = [];
    for (const d of kept) {
      nodes.set(d.info.id, d.info);
      if (d.info.help || d.info.consent || d.info.required || d.info.filled || d.node.kind === 'notice') d.node.protected = true;
      outlineNodes.push(d.node);
    }

    // Page body size (round 3): char-weighted median over paragraph-like blocks in main, leaving out footers, legal and
    // fine print, consent, chat, promotions, asides and one-line metadata (core bodySizeFromBlocks).
    const bodyInfo = measureBody(texts);
    const pageBodyPx = bodyInfo.px;

    // Element count: separate items a person sees (not structural wrappers).
    const elementCount = kept.filter((d) => d.info.kind !== 'region' && d.info.kind !== 'list').length;

    // Digest: the most decision-worthy elements, scored, with quotas; then DOM order.
    const keptById = new Map(kept.map((d) => [d.info.id, d] as const));
    for (const d of kept) d.score = digestScore(d.info, vw) + contentBonus(d, keptById);
    // Nodes added only as regions are not candidates for element judgments (they go in `regions`); data boxes are.
    // An article's body is what the page exists to show: it always has a place, so Jev gives it a role (body text)
    // and the meaning check sees the story, not a headline among ads and buttons.
    const bodyId = ext.article?.bodyId ?? null;
    const picked = pickDigest(kept.filter((d) => !d.forced || d.node.data || d.info.id === bodyId), bodyId);
    const evidence: ElementEvidence[] = picked.map((d) => toEvidence(d, forms, vw, vh, sx, sy, docH, kept));
    const keptIds = new Set(kept.map((d) => d.info.id));
    const regionDrafts = ext.regions.filter((d) => keptIds.has(d.info.id));
    const regionEvidence: ElementEvidence[] = regionDrafts.map((d) => {
      const ev = toEvidence(d, forms, vw, vh, sx, sy, docH, kept);
      const note = ext.notes.get(d.info.id);
      if (note) ev.role_hint = `${ev.role_hint} holding ${note}`;
      if (ev.text_chars === undefined && d.info.textChars > 0) ev.text_chars = d.info.textChars;
      return ev;
    });
    const mainCandidates = picked
      .filter((d) => (d.info.kind === 'button' || d.info.kind === 'link') && !d.info.disabled
        && d.info.zone !== 'header_band' && d.info.zone !== 'footer_band' && d.info.landmark !== 'navigation')
      .map((d) => d.info.id)
      .slice(0, MAX_MAIN_CANDIDATES);

    // Local facts for the policy (ids are digest ids).
    const active = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const within = (outer: Element, pred: (n: NodeInfo) => boolean): boolean => {
      for (const n of nodes.values()) if ((n.el === outer || outer.contains(n.el)) && pred(n)) return true;
      return false;
    };
    const local: LocalFacts = { focusedIds: [], requiredIds: [], filledIds: [], consentIds: [], offsiteIds: [] };
    for (const d of picked) {
      const el = d.info.el;
      const id = d.info.id;
      if (active && (el === active || el.contains(active))) local.focusedIds.push(id);
      if (within(el, (n) => n.required)) local.requiredIds.push(id);
      if (within(el, (n) => n.filled)) local.filledIds.push(id);
      if (d.info.consent || d.info.iframeKind === 'consent_manager' || inConsentBox(el, mainRoot)) local.consentIds.push(id);
      if (d.info.linkTarget === 'another website') local.offsiteIds.push(id);
    }

    const busy: BusyInfo = {
      elementCount,
      controls: controls.length,
      overlays: kept.filter((d) => d.info.overlay).length,
      ads: kept.filter((d) => d.info.ad).length,
      carousels: carousels.length,
      animated,
      promos: kept.filter((d) => d.info.promo && (d.info.kind === 'region' || d.info.kind === 'list')).length,
    };

    const pageKind = pageKindOf(kept, forms.length, texts);
    const digest: PageDigest = {
      v: 'digest.1',
      page: {
        title: safeUiLabel(document.title, 12),
        url_path: redactPath(location.pathname),
        headings,
        landmarks: landmarksSeen,
        viewport: `${vw < 700 ? 'mobile' : vw < 1000 ? 'tablet' : 'desktop'}, ${vw} x ${vh}`,
        element_count: elementCount,
      },
      elements: evidence,
      mainCandidates,
      hasSensitiveFields: sensitive,
      lang: (document.documentElement.lang || navigator.language || 'en').slice(0, 5).toLowerCase(),
    };
    if (regionEvidence.length) digest.regions = regionEvidence;

    const extracted: ExtractSummary = {
      items: kept.filter((d) => d.node.data).map((d) => ({ id: d.info.id, kind: (d.node.data as ExtractedData).kind })),
      regions: regionDrafts.map((d) => d.info.id),
      regionNotes: Object.fromEntries(regionDrafts.map((d) => [d.info.id, ext.notes.get(d.info.id) ?? ''] as const).filter(([, v]) => v)),
      article: ext.article,
      siteLogoId: ext.siteLogoId && keptIds.has(ext.siteLogoId) ? ext.siteLogoId : null,
      ms: ext.ms,
    };
    if (ext.error) extracted.error = ext.error;

    return {
      at: performance.now(),
      url: location.href,
      digest,
      outline: { v: 'outline.1', nodes: outlineNodes, pageTypeHint: pageKind },
      local,
      nodes,
      pageBodyPx: Math.round(pageBodyPx * 10) / 10,
      body: bodyInfo,
      busy,
      sensitive,
      privatePage: PRIVATE_HOSTS.test(location.hostname),
      pageKind,
      mainRoot,
      texts,
      controls,
      stickyBars,
      carousels,
      stats: { visited, nodes: kept.length, ms: Math.round((performance.now() - t0) * 10) / 10 },
      extracted,
    };
  }

  /* -------------------------------------------------------------- */
  /* Round 7: structured content and regions                         */
  /* -------------------------------------------------------------- */

  /**
   * Run extraction over the walk's tree, put each item's data on its node (adding a node for a data box or a region
   * the walk did not make one for), and return the region nodes and notes. Never throws: a failure leaves the outline
   * as the walk made it.
   */
  private applyExtract(
    root: SNode, main: SNode | null, drafts: Draft[], draftById: Map<string, Draft>, mainRoot: Element | null,
    vw: number, vh: number,
  ): { regions: Draft[]; notes: Map<string, string>; article: ArticleMeta | null; siteLogoId: string | null; ms: number; error?: string } {
    const t0 = performance.now();
    const empty = { regions: [] as Draft[], notes: new Map<string, string>(), article: null, siteLogoId: null };
    let ex: PageExtract;
    try {
      ex = extractPage({ root, main, ld: readLdTexts(), siteName: readSiteName(), url: location.href, vw, vh });
    } catch (err) {
      return { ...empty, ms: Math.round(performance.now() - t0), error: `extract: ${String(err instanceof Error ? err.message : err).slice(0, 160)}` };
    }
    try {
      const byEl = new Map<Element, Draft>(drafts.map((d) => [d.info.el, d] as const));
      const ensure = (sn: SNode | null | undefined): Draft | null => {
        const el = sn?.el;
        if (!el || !el.isConnected) return null;
        return byEl.get(el) ?? this.forceDraft(el, sn, drafts, byEl, draftById, mainRoot);
      };
      const idNear = (sn: SNode | null | undefined): string | undefined => {
        const el = sn?.el;
        if (!el) return undefined;
        const own = byEl.get(el);
        if (own) return own.info.id;
        const inside = drafts.find((d) => el.contains(d.info.el));
        if (inside) return inside.info.id;
        return nearestDraft(el, byEl)?.info.id;
      };
      for (const it of ex.items) {
        if (it.data.kind === 'logo') {
          const d = it.node.el ? byEl.get(it.node.el) : undefined;
          if (!d || d.node.data) continue;
          let src = it.data.src;
          if (!src && it.mark?.el && it.mark.tag === 'svg') src = svgDataUrl(it.mark.el);
          if (src) d.node.data = { kind: 'logo', src, label: it.data.label };
          continue;
        }
        const d = ensure(it.node);
        if (!d) continue;
        let data: ExtractedData = it.data;
        if (data.kind === 'stats' && it.valueNodes) {
          const ids = it.valueNodes.map((v) => idNear(v));
          data = { ...data, items: data.items.map((x, i) => (ids[i] ? { ...x, nodeId: ids[i] } : x)) };
        } else if (data.kind === 'schedule' && it.rowNodes) {
          const ids = it.rowNodes.map((v) => idNear(v));
          data = { ...data, items: data.items.map((x, i) => (ids[i] ? { ...x, nodeId: ids[i] } : x)) };
        }
        d.node.data = data;
      }
      let article: ArticleMeta | null = null;
      if (ex.article) {
        article = { ...ex.article.meta };
        const set = (k: 'headlineId' | 'bylineId' | 'leadImageId' | 'dateId', sn: SNode | null) => {
          const id = idNear(sn);
          if (id) article![k] = id;
        };
        set('headlineId', ex.article.headline);
        set('bylineId', ex.article.byline);
        set('leadImageId', ex.article.leadImage);
        set('dateId', ex.article.date);
        const body = ensure(ex.article.body);
        if (body) article.bodyId = body.info.id;
      }
      const regions: Draft[] = [];
      const notes = new Map<string, string>();
      for (const r of ex.regions) {
        const d = ensure(r);
        if (!d || regions.includes(d)) continue;
        regions.push(d);
        const note = ex.regionNotes.get(r);
        if (note) notes.set(d.info.id, note);
      }
      const siteLogoId = ex.siteLogo?.el ? byEl.get(ex.siteLogo.el)?.info.id ?? null : null;
      drafts.forEach((d, i) => {
        d.order = i;
      });
      return { regions, notes, article, siteLogoId, ms: Math.round((performance.now() - t0) * 10) / 10 };
    } catch (err) {
      return { ...empty, ms: Math.round(performance.now() - t0), error: `apply: ${String(err instanceof Error ? err.message : err).slice(0, 160)}` };
    }
  }

  /** A node for an element the walk passed over (a region or a data box), placed in document order under its parent. */
  private forceDraft(
    el: Element, sn: SNode, drafts: Draft[], byEl: Map<Element, Draft>, draftById: Map<string, Draft>, mainRoot: Element | null,
  ): Draft | null {
    const parent = nearestDraft(el, byEl);
    // Never inside a control or a heading (their insides are never nodes).
    if (parent && (CONTROL_KINDS.has(parent.info.kind) || parent.info.kind === 'heading')) return null;
    const tag = el.tagName.toUpperCase();
    const kind: OutlineKind = tag === 'TABLE' ? 'table' : (tag === 'UL' || tag === 'OL' || tag === 'DL') ? 'list' : 'region';
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const sectioning = !!el.parentElement?.closest('article, aside, main, nav, section');
    const lm = landmarkOfTag(el, sectioning);
    const landmark = lm ?? parent?.info.landmark ?? 'none';
    const ctx: Ctx = {
      parentId: parent?.info.id ?? null, landmark, sectioning, fixed: sn.fixed === true, inMain: false, inControl: false,
      hLevel: null, inText: false, inTable: false, pointer: false, opacity: 1,
    };
    const inMain = !!mainRoot && (mainRoot === el || mainRoot.contains(el)) && lm !== 'banner' && lm !== 'contentinfo' && lm !== 'navigation';
    const d = this.draft(el, kind, tag, ctx, landmark, sn.fixed === true, rect, rect.left + scrollX, rect.top + scrollY, classWordsOf(el), inMain, 0);
    d.forced = true;
    d.info.textChars = collapse(el.textContent ?? '').length;
    if (kind === 'table') {
      const t = el as HTMLTableElement;
      d.node.shape = `table ${t.rows?.length ?? 0} x ${t.rows?.[0]?.cells.length ?? 0}`;
      d.info.roleHint = 'table';
    } else if (kind === 'list') {
      d.node.shape = `list x ${countVisibleChildren(el)}`;
      d.info.roleHint = 'list';
    } else {
      const role = (el.getAttribute('role') ?? '').toLowerCase();
      d.info.roleHint = roleHintForRegion(el, tag, role, lm, d.info);
      const cards = repeatedCards(el);
      if (cards >= 4) d.info.cards = cards;
    }
    // Document order: before the first node inside or after this element.
    let at = drafts.length;
    for (let i = 0; i < drafts.length; i++) {
      const other = (drafts[i] as Draft).info.el;
      const pos = el.compareDocumentPosition(other);
      if (pos & Node.DOCUMENT_POSITION_CONTAINED_BY || (pos & Node.DOCUMENT_POSITION_FOLLOWING && !(pos & Node.DOCUMENT_POSITION_CONTAINS))) {
        at = i;
        break;
      }
    }
    drafts.splice(at, 0, d);
    byEl.set(el, d);
    draftById.set(d.info.id, d);
    // Nodes inside it that hung from its parent now hang from it.
    const parentId = parent?.info.id;
    for (let j = at + 1; j < drafts.length; j++) {
      const x = drafts[j] as Draft;
      if (!el.contains(x.info.el)) break;
      if (x.node.parent === parentId) {
        x.node.parent = d.info.id;
        x.info.parent = d.info.id;
      }
    }
    return d;
  }

  /* -------------------------------------------------------------- */

  private draft(
    el: Element, kind: OutlineKind, tag: string, ctx: Ctx, landmark: string, fixed: boolean, rect: DOMRect,
    pageX: number, pageY: number, cw: string[], inMain: boolean, order: number, knownText?: string,
  ): Draft {
    const id = this.assign(el);
    const name = kind === 'text' ? (knownText ?? visibleTextOf(el, 2000)) : collapse(accessibleName(el));
    const own = { x: Math.round(pageX), y: Math.round(pageY), w: Math.round(rect.width), h: Math.round(rect.height) };
    const info: NodeInfo = {
      id, el, kind, tag: tag.toLowerCase(), name, parent: ctx.parentId, landmark, zone: 'center_column', fixed,
      rect: own,
      zoneRect: zoneRectOf(el, fixed, own),
      classWords: [...cw], inMain, help: false, consent: false, promo: false, ad: false, carousel: false, overlay: false,
      required: false, filled: false, disabled: false, textChars: name.length, headingLevel: null, linkTarget: null,
      iframeKind: null, weight: 'medium', roleHint: kind, cards: 0,
    };
    const labelSource = kind === 'region' || kind === 'notice' ? regionTitle(el) : name;
    const label = kind === 'text' || kind === 'table' || kind === 'list' ? '' : safeAllowlist(labelSource, 8);
    const node: OutlineNode = { id, kind, label };
    if (ctx.parentId) node.parent = ctx.parentId;
    if (landmark !== 'none') node.landmark = landmark;
    return { info, node, score: 0, order };
  }

  private regionFlags(
    d: Draft, el: Element, tag: string, role: string, lm: string | null, cwStr: string, selfFixed: boolean, area: number,
    vw: number, vh: number, carousels: Element[],
  ): void {
    const info = d.info;
    const sample = visibleTextOf(el, 600);
    info.overlay = (selfFixed && area >= 0.01 * vw * vh && lm !== 'banner' && lm !== 'contentinfo')
      || ((role === 'dialog' || role === 'alertdialog' || tag === 'DIALOG' || el.getAttribute('aria-modal') === 'true') && selfFixed);
    info.consent = CONSENT_CLASS.test(cwStr) || CONSENT_CLASS.test(el.id) || (info.overlay && /\bcookies?\b/i.test(sample))
      || (/\b(we|this (site|website)) uses? cookies\b/i.test(sample) && sample.length < 900);
    info.carousel = CAROUSEL_CLASS.test(cwStr) || /carousel/i.test(el.getAttribute('aria-roledescription') ?? '');
    if (info.carousel) carousels.push(el);
    info.help = !info.consent && role !== 'navigation' && lm !== 'navigation' && lm !== 'contentinfo'
      && (CHAT_CLASS.test(cwStr) || (HELP_NAME.test(firstWords(sample, 12)) && area < 0.25 * vw * vh));
    info.ad = AD_CLASS.test(cwStr) || (isIabSize(info.rect.w, info.rect.h) && /\b(ad|advertisement|sponsored)\b/i.test(sample.slice(0, 160)));
    markPromo(info, el, cwStr);
    info.roleHint = roleHintForRegion(el, tag, role, lm, info);
    info.textChars = sample.length >= 600 ? collapse(el.textContent ?? '').length : sample.length;
  }

  private textSample(
    el: Element, cs: CSSStyleDeclaration, out: TextSample[], ctx: Ctx, inMain: boolean, control: boolean, opacity: number,
    disabled: boolean,
  ): void {
    if (out.length >= MAX_TEXT_SAMPLES) return;
    const text = directText(el);
    if (!text) return;
    const fontPx = parseFloat(cs.fontSize);
    if (!Number.isFinite(fontPx) || fontPx <= 0) return;
    const wordCount = words(text).length;
    const lh = cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight);
    const tag = el.tagName.toUpperCase();
    const clamp = cs.getPropertyValue('-webkit-line-clamp');
    const overflowHidden = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
    const clipRisk = cs.textOverflow === 'ellipsis'
      || (!!clamp && clamp !== 'none')
      || (overflowHidden && (cs.whiteSpace === 'nowrap' || el.scrollHeight > el.clientHeight + 1))
      || cs.position === 'absolute';
    const classes = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 3).sort().join('.');
    // Running text is judged on the block's whole text (a <p> with inline links still counts).
    const blockChars = RUNNING_TAGS.has(tag) ? Math.max(text.length, collapse(el.textContent ?? '').length) : text.length;
    out.push({
      el,
      fontPx,
      weight: parseFloat(cs.fontWeight) || 400,
      color: cs.color,
      lineHeightPx: lh !== null && Number.isFinite(lh) ? lh : null,
      family: cs.fontFamily,
      chars: text.length,
      words: wordCount,
      running: !control && ctx.hLevel === null && isRunningText(tag, blockChars, wordCount),
      headingLevel: ctx.hLevel ?? headingLevelOf(el),
      control: control || ctx.inControl,
      inMain,
      clipRisk,
      sig: `${tag}.${classes}`,
      disabled,
      iconFont: isIconFont(cs.fontFamily),
      opacity,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Walk helpers                                                        */
/* ------------------------------------------------------------------ */

const CONTROL_KINDS = new Set<OutlineKind>(['button', 'link', 'field', 'select', 'checkbox', 'radio']);

/** The nearest ancestor (across shadow roots) that is a node. */
function nearestDraft(el: Element, byEl: Map<Element, Draft>): Draft | null {
  let p: Element | null = el.parentElement ?? ((el.getRootNode() as ShadowRoot).host ?? null);
  let guard = 0;
  while (p && guard++ < 200) {
    const d = byEl.get(p);
    if (d) return d;
    p = p.parentElement ?? ((p.getRootNode() as ShadowRoot).host ?? null);
  }
  return null;
}

const SENSITIVE_SELECTOR = [
  'input[type="password"]', 'input[autocomplete^="cc-"]', 'input[autocomplete="one-time-code"]',
  'input[autocomplete="current-password"]', 'input[autocomplete="new-password"]', 'input[name*="cvv" i]',
  'input[name*="cvc" i]', 'input[name*="cardnumber" i]', 'input[name*="card_number" i]', 'input[id*="cardnumber" i]',
].join(', ');
const CONSENT_SELECTOR = '[class*="cookie" i], [id*="cookie" i], [class*="consent" i], [id*="consent" i], [id*="onetrust" i], [id*="CybotCookiebot" i], [class*="gdpr" i]';
/**
 * Inside a cookie/consent box. Page-wide wrappers do not count: sites mark <body> (or the page wrapper) with
 * classes such as "has-cookie" while their banner shows, which would otherwise make every element a consent notice.
 */
function inConsentBox(el: Element, mainRoot: Element | null): boolean {
  let a: Element | null = el.closest(CONSENT_SELECTOR);
  while (a) {
    if (a !== document.body && a !== document.documentElement && !(mainRoot && a !== mainRoot && a.contains(mainRoot)) && a !== mainRoot) return true;
    a = a.parentElement?.closest(CONSENT_SELECTOR) ?? null;
  }
  return false;
}
const BLOCK_CHILD_TAGS = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'FORM', 'FIELDSET', 'BLOCKQUOTE', 'PRE', 'DL', 'FIGURE', 'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'MAIN']);

function shouldBeText(el: Element, tag: string, cs: CSSStyleDeclaration, dtext: string, ctx: Ctx): boolean {
  const display = cs.display;
  const inlineLevel = display === 'inline' || display === 'inline flow' || display === 'ruby';
  // Inline elements inside a text block are part of that block.
  if (inlineLevel && ctx.inText) return false;
  if (dtext.length >= 2) return true;
  if (!TEXT_TAGS.has(tag)) return false;
  for (const c of Array.from(el.children)) if (BLOCK_CHILD_TAGS.has(c.tagName)) return false;
  return collapse(el.textContent ?? '').length >= 2;
}

function safeIsOurs(el: Element): boolean {
  if (el.tagName === 'WEBABLE-UI') return true;
  try {
    return isOurUi(el);
  } catch {
    return false;
  }
}

function countVisibleChildren(el: Element): number {
  let n = 0;
  for (const c of Array.from(el.children)) {
    const r = c.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) n++;
    if (n > 200) break;
  }
  return n;
}

/** Number of repeated sibling cards (same tag and class signature, each with a link or heading), or 0. */
export function repeatedCards(el: Element): number {
  const kids = el.children;
  if (kids.length < 4 || kids.length > 400) return 0;
  const counts = new Map<string, number>();
  let best = 0;
  for (const k of Array.from(kids)) {
    const sig = `${k.tagName}.${(typeof k.className === 'string' ? k.className : '').split(/\s+/).filter((c) => !/active|selected|current|first|last|odd|even/i.test(c)).sort().join('.')}`;
    const n = (counts.get(sig) ?? 0) + 1;
    counts.set(sig, n);
    if (n > best) best = n;
  }
  if (best < 4) return 0;
  // A run of paragraphs is prose (an article body), not cards, even when its sentences carry links.
  const top = [...counts.entries()].find(([, n]) => n === best)?.[0] ?? '';
  if (top.startsWith('P.')) return 0;
  // Each card needs a heading, a button, or a link that titles it: a link that is a word inside a sentence doesn't.
  let titled = 0;
  for (const k of Array.from(kids).slice(0, 12)) {
    if (k.querySelector('h2, h3, h4, button')) {
      titled++;
      continue;
    }
    const all = (k.textContent ?? '').trim().length;
    const linked = Array.from(k.querySelectorAll('a[href]')).reduce((n, a) => n + (a.textContent ?? '').trim().length, 0);
    if (linked > 0 && (all < 40 || linked >= 0.4 * all)) titled++;
  }
  return titled >= Math.min(4, kids.length) ? best : 0;
}

type RegionWhy = 'landmark' | 'overlay' | 'words' | 'boxed' | 'ad' | 'carousel' | 'section' | 'fieldset' | 'notice';

function regionReason(
  el: Element, tag: string, role: string, cs: CSSStyleDeclaration, rect: DOMRect, cw: string[], cwStr: string,
  selfFixed: boolean, lm: string | null, vw: number, vh: number, docH: number, ctx: Ctx, area: number,
): RegionWhy | null {
  if (rect.width < 1 || rect.height < 1) return null;
  if (role === 'alert' || role === 'status' || role === 'alertdialog' || (el.getAttribute('aria-live') === 'assertive')) {
    // Only a notice someone can see: rendered text (not text inside hidden children), not aria-hidden.
    if (!el.closest('[aria-hidden="true"]') && renderedText(el).length >= 3) return 'notice';
    if (role !== 'alertdialog') return null;
  }
  if (lm) return 'landmark';
  if (tag === 'FIELDSET') return 'fieldset';
  if (tag === 'DIALOG' || role === 'dialog' || el.getAttribute('aria-modal') === 'true') return 'overlay';
  if (selfFixed && area >= 0.01 * vw * vh) return 'overlay';
  if (/carousel/i.test(el.getAttribute('aria-roledescription') ?? '')) return 'carousel';
  if (ctx.inText) return null;
  const pageArea = vw * docH;
  if (area < 5000 || rect.width < 100 || rect.height < 36 || area > 0.6 * pageArea) return null;
  if (isIabSize(rect.width, rect.height)) return 'ad';
  if (AD_CLASS.test(cwStr) && area >= 2000) return 'ad';
  if (CAROUSEL_CLASS.test(cwStr)) return 'carousel';
  if (NOTICE_CLASS.test(cwStr) && area < 0.3 * vw * vh && !el.closest('[aria-hidden="true"]') && renderedText(el).length >= 3) return 'notice';
  if (cw.some((w) => REGION_WORDS.has(w))) return 'words';
  if ((tag === 'SECTION' || tag === 'ARTICLE') && el.querySelector(':scope > h2, :scope > h3, :scope > header h2, :scope > header h3, :scope > div > h2')) return 'section';
  // Visually boxed containers (own background, border or shadow) that hold a control and some text.
  const bg = parseRgb(cs.backgroundColor);
  const boxed = (bg && bg.a > 0.3 && !isWhiteish(bg)) || hasBorder(cs) || cs.boxShadow !== 'none' || cs.backgroundImage !== 'none';
  if (boxed && area < 0.35 * vw * vh * 2 && el.querySelector('a[href], button, [role="button"], input, select')) {
    if (collapse(el.textContent ?? '').length >= 8) return 'boxed';
  }
  return null;
}

/** Text as rendered (CSS-hidden children excluded), capped; for the few notice candidates only. */
function renderedText(el: Element): string {
  const t = el instanceof HTMLElement ? el.innerText : el.textContent;
  return collapse((t ?? '').slice(0, 400));
}

function isWhiteish(c: Rgb): boolean {
  return c.r > 245 && c.g > 245 && c.b > 245;
}

function hasBorder(cs: CSSStyleDeclaration): boolean {
  const w = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth) + parseFloat(cs.borderBottomWidth);
  if (!(w >= 2)) {
    const left = parseFloat(cs.borderLeftWidth);
    return left >= 3; // accent stripe
  }
  return true;
}

function isIabSize(w: number, h: number): boolean {
  return IAB_SIZES.some(([iw, ih]) => Math.abs(w - iw) <= 2 && Math.abs(h - ih) <= 2);
}

function nearlySame(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return Math.abs(a.x - b.x) <= 8 && Math.abs(a.y - b.y) <= 8 && Math.abs(a.w - b.w) <= 16 && Math.abs(a.h - b.h) <= 16;
}

function markPromo(info: NodeInfo, el: Element, cwStr: string): void {
  if (info.consent) return;
  const sample = visibleTextOf(el, 300);
  info.promo = PROMO_WORDS.test(sample) || /promo|upsell|offer|deal|sponsor|recommend|related|trending|newsletter|membership|marketing|spotlight|hero/.test(cwStr);
}

/** The heading just before an element (its own or an ancestor's previous siblings, two levels up), or ''. */
function headingBefore(el: Element): string {
  let a: Element | null = el;
  for (let up = 0; a && up < 3; up++, a = a.parentElement) {
    for (let s = a.previousElementSibling, k = 0; s && k < 3; s = s.previousElementSibling, k++) {
      const h = /^H[1-6]$/.test(s.tagName) || s.getAttribute('role') === 'heading' ? s : s.querySelector('h1, h2, h3, h4, [role="heading"]');
      if (h) return visibleTextOf(h, 120);
    }
  }
  return '';
}

function regionTitle(el: Element): string {
  const al = el.getAttribute('aria-label');
  if (al) return al;
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const ref = document.getElementById(by.split(/\s+/)[0] ?? '');
    if (ref) return visibleTextOf(ref, 120);
  }
  const h = el.querySelector('legend, h1, h2, h3, h4, [role="heading"]');
  if (h) return visibleTextOf(h, 120);
  return '';
}

function fieldShape(el: Element, kind: OutlineKind): string {
  const parts: string[] = [];
  if (kind === 'field') {
    const t = el.tagName === 'TEXTAREA' ? 'textarea' : inputType(el);
    parts.push(`field ${t}`);
    const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase();
    if (ac && /^[a-z -]{2,30}$/.test(ac) && !ac.startsWith('cc-')) parts.push(`autocomplete ${ac}`);
  } else if (kind === 'select') {
    const n = el.tagName === 'SELECT' ? (el as HTMLSelectElement).options.length : 0;
    parts.push(n ? `options x ${n}` : 'select');
  } else if (kind === 'checkbox' || kind === 'radio') {
    parts.push((el as HTMLInputElement).checked ? `${kind} checked` : kind);
  }
  if ((el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true') parts.push('required');
  return parts.join(', ');
}

function roleHintOf(el: Element, kind: OutlineKind, disabled: boolean): string {
  let base: string;
  const role = (el.getAttribute('role') ?? '').toLowerCase();
  switch (kind) {
    case 'link':
      base = el.querySelector('img, svg, picture') && collapse(el.textContent ?? '').length < 3 ? 'link (image)' : 'link';
      break;
    case 'button':
      base = role && role !== 'button' ? role : 'button';
      break;
    case 'field': {
      const t = inputType(el);
      base = el.tagName === 'TEXTAREA' ? 'textbox' : t === 'search' || role === 'searchbox' ? 'searchbox' : role === 'slider' || t === 'range' ? 'slider' : 'textbox';
      break;
    }
    case 'select':
      base = 'combobox';
      break;
    default:
      base = kind;
  }
  if (disabled) base += ' (disabled)';
  if ((el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true') base += ' (required)';
  return base;
}

function roleHintForRegion(el: Element, tag: string, role: string, lm: string | null, info: NodeInfo): string {
  if (role === 'dialog' || role === 'alertdialog' || tag === 'DIALOG' || el.getAttribute('aria-modal') === 'true') return 'dialog';
  if (info.consent && info.overlay) return 'dialog';
  if (lm) return lm;
  if (tag === 'FIELDSET') {
    const radios = el.querySelectorAll('input[type="radio"]').length;
    const checks = el.querySelectorAll('input[type="checkbox"]').length;
    return radios >= 2 ? 'radiogroup' : checks >= 2 ? 'group of checkboxes' : 'group';
  }
  if (role) return role;
  return 'region';
}

/**
 * The box the page is laid out in, in viewport px: the page column when WebAble holds the page to one (a narrower
 * virtual window drawn centred), else the whole viewport. In-flow content and sticky bars live in it; fixed layers
 * still span the window. Width heuristics ("a full-width bar", "the left rail") compare with it.
 */
export function pageFrame(): { left: number; width: number } {
  const vw = document.documentElement.clientWidth || innerWidth;
  if (document.documentElement.hasAttribute('data-wa-col') && document.body) {
    const r = document.body.getBoundingClientRect();
    if (r.width > 0 && r.width < vw) return { left: r.left, width: r.width };
  }
  return { left: 0, width: vw };
}

/** The box that decides an element's zone: the outermost fixed ancestor, or the nearest column-sized ancestor. */
function zoneRectOf(el: Element, fixed: boolean, own: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const box = (e: Element) => {
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  };
  if (fixed) {
    let root: Element | null = null;
    let n: Element | null = el;
    let d = 0;
    while (n && n !== document.body && d < 30) {
      const p = getComputedStyle(n).position;
      if (p === 'fixed' || p === 'sticky') root = n;
      n = n.parentElement;
      d++;
    }
    return root && root !== el ? box(root) : own;
  }
  if (own.w >= 240) return own;
  let n = el.parentElement;
  let d = 0;
  while (n && n !== document.body && d < 8) {
    const r = n.getBoundingClientRect();
    if (r.width >= 240) return r.width <= 0.98 * pageFrame().width ? box(n) : own;
    n = n.parentElement;
    d++;
  }
  return own;
}

function zoneOf(
  info: NodeInfo, vw: number, vh: number, sx: number, sy: number,
  bands: { headerBottom: number; footerTop: number },
): Zone {
  const r = info.zoneRect;
  if (info.fixed) {
    // Viewport coordinates for fixed boxes.
    const top = r.y - sy;
    const bottom = top + r.h;
    const left = r.x - sx;
    const right = left + r.w;
    if (info.landmark === 'banner' && top <= 8) return 'header_band';
    if (info.landmark === 'contentinfo' && bottom >= vh - 8) return 'footer_band';
    if (r.w >= 0.8 * vw) {
      if (top <= vh * 0.3 && bottom <= vh * 0.6) return 'overlay_top';
      if (bottom >= vh * 0.7 && top >= vh * 0.4) return 'overlay_bottom';
      return 'overlay_center';
    }
    const nearSide = left <= 48 || right >= vw - 48;
    const nearEdge = top <= vh * 0.35 || bottom >= vh * 0.65;
    if (nearSide && nearEdge && r.w * r.h <= 0.3 * vw * vh) return 'overlay_corner';
    return 'overlay_center';
  }
  const own = info.rect;
  if (info.landmark === 'banner' || (bands.headerBottom > 0 && own.y + own.h <= bands.headerBottom + 4)) return 'header_band';
  if (info.landmark === 'navigation' && own.y < bands.headerBottom + 80 && own.y < vh * 0.4) return 'header_band';
  if (info.landmark === 'contentinfo' || own.y >= bands.footerTop - 4) return 'footer_band';
  // In-flow content lives in the page frame (the page column, when WebAble holds the page to one).
  const f = pageFrame();
  const fw = f.width > 0 ? f.width : vw;
  if (r.w >= 0.85 * fw) return 'full_width_mid';
  const fx = r.x - sx - f.left;
  const cx = fx + r.w / 2;
  if (cx < 0.28 * fw && fx + r.w <= 0.42 * fw) return 'left_rail';
  if (cx > 0.68 * fw && fx >= 0.55 * fw) return 'right_rail';
  return 'center_column';
}

function visualWeightOf(el: Element): ElementEvidence['visual_weight'] {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const area = r.width * r.height;
  let score = 0;
  if (area > 40000) score += 1;
  if (area > 120000) score += 1;
  const bg = parseRgb(cs.backgroundColor);
  if (bg && bg.a > 0.5 && !isWhiteish(bg)) {
    const sat = saturation(bg);
    score += sat > 0.35 ? 2 : luminance(bg) < 0.3 ? 2 : 0.5;
  }
  if (cs.backgroundImage !== 'none' && area > 20000) score += 1;
  const fpx = parseFloat(cs.fontSize);
  if (fpx >= 20) score += 1;
  if ((parseFloat(cs.fontWeight) || 400) >= 600) score += 0.5;
  if (area < 3500 || fpx <= 12) score -= 1;
  const fg = parseRgb(cs.color);
  const backdrop = bg && bg.a > 0.5 ? bg : { r: 255, g: 255, b: 255, a: 1 };
  if (fg && saturation(fg) < 0.15 && ratio(fg, backdrop) < 6 && !(bg && bg.a > 0.5 && saturation(bg) > 0.35)) score -= 1;
  if (score >= 2.5) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

function nodePriority(d: Draft, vh: number): number {
  const k = d.info.kind;
  let p = 0;
  if (d.forced) p += 100; // regions and data boxes always stay
  if (d.node.data) p += 50;
  if (k === 'region' || k === 'list' || k === 'notice') p += 5;
  if (k === 'heading') p += 4;
  if (k === 'button' || k === 'field' || k === 'select' || k === 'checkbox' || k === 'radio') p += 4;
  if (k === 'link') p += 2;
  if (k === 'text') p += 2;
  if (d.info.help || d.info.consent || d.info.required) p += 10;
  if (d.info.rect.y < vh * 3) p += 3;
  return p;
}

function digestScore(n: NodeInfo, vw: number): number {
  let s = 0;
  const control = n.kind === 'button' || n.kind === 'link' || n.kind === 'field' || n.kind === 'select' || n.kind === 'checkbox' || n.kind === 'radio';
  if (n.overlay) s += 7;
  if (n.consent) s += 6;
  if (n.ad) s += 6;
  if (n.carousel) s += 5;
  if (n.kind === 'notice') s += 5;
  if (n.help) s += 5;
  if (n.promo && (n.kind === 'region' || n.kind === 'list')) s += 5;
  if (n.kind === 'media' && n.iframeKind) s += 4;
  if (n.kind === 'heading') s += n.headingLevel === 1 ? 4 : n.headingLevel === 2 ? 1.5 : 0.5;
  if (n.kind === 'text') s += n.inMain && n.textChars >= 120 ? 2.5 : n.inMain ? 0.5 : 0;
  if (n.kind === 'region' || n.kind === 'list') {
    if (n.landmark === 'complementary' || n.zone === 'right_rail' || n.zone === 'left_rail') s += 2.5;
    if (n.tag === 'fieldset') s += 2.5;
    if (n.roleHint === 'navigation') s += 1.5;
    if (n.roleHint === 'main' || n.roleHint === 'banner' || n.roleHint === 'contentinfo' || n.roleHint === 'form') s -= 4;
    if (n.rect.w * n.rect.h > 0.5 * vw * 900 && !n.overlay && !n.ad) s -= 1.5;
  }
  if (control) {
    s += 2;
    if (n.zone === 'center_column' || n.zone === 'right_rail' || n.zone === 'left_rail' || n.zone.startsWith('overlay') || n.zone === 'full_width_mid') s += 2;
    if (n.inMain) s += 1;
    if (n.weight === 'high') s += 1.5;
    if (n.kind === 'button') s += 1;
    if (n.zone === 'header_band' || n.landmark === 'navigation') s -= 1.5;
    if (n.zone === 'footer_band') s -= 2.5;
    if (n.disabled) s -= 1;
    if (n.linkTarget === 'another website') s += 0.5;
  }
  return s;
}

/**
 * Round 7: the parts of a page Jev must see to say what it is for. Boxes that carry extracted data (a stats grid, a
 * scoreboard, a data table, a recipe) and logos get a place in the digest; so do card grids in the main content (news
 * teasers, related items), which are what "teaser for other content" is about.
 */
function contentBonus(d: Draft, byId: Map<string, Draft>): number {
  const data = d.node.data;
  if (data) return data.kind === 'logo' ? 4 : 8;
  const n = d.info;
  const teaserGrid = isTeaserGrid;
  if (teaserGrid(n)) return 5;
  if (n.kind === 'image' && n.inMain && n.rect.w * n.rect.h >= 15000 && n.zone !== 'header_band') return 1.5;
  // A card's own buttons and links: the card grid stands for them.
  if (n.kind === 'button' || n.kind === 'link') {
    let p = d.node.parent ? byId.get(d.node.parent) : undefined;
    for (let up = 0; p && up < 6; up++, p = p.node.parent ? byId.get(p.node.parent) : undefined) {
      if (teaserGrid(p.info)) return -2.5;
    }
  }
  return 0;
}

function isTeaserGrid(x: NodeInfo): boolean {
  return x.kind === 'list' && x.cards >= 4 && x.inMain && x.zone !== 'header_band' && x.zone !== 'footer_band';
}

/** Near-duplicates (twenty "Links for game on …" buttons): kind, role, first three label words and size. */
function dupSignature(n: NodeInfo): string | null {
  if (n.kind === 'field' || n.kind === 'select' || n.kind === 'checkbox' || n.kind === 'radio' || n.help || n.consent) return null;
  const head = collapse(n.name.toLowerCase().replace(/\d+/g, '#')).split(' ').slice(0, 3).join(' ');
  return `${n.kind}|${n.roleHint}|${head}|${Math.round(n.rect.w / 20)}x${Math.round(n.rect.h / 20)}`;
}

const MAX_SAME = 3;

function pickDigest(drafts: Draft[], reserved: string | null = null): Draft[] {
  const quotas: Record<string, number> = { overlay: 6, container: 12, help: 5, field: 5, content: 4, nav: 3, action: 18, other: 6, data: 10 };
  const bucketOf = (n: NodeInfo, d: Draft): string => {
    if (n.overlay || n.consent) return 'overlay';
    // Data boxes, logos and teaser card grids in the main content: what Jev needs to tell what the page is for.
    if (d.node.data || isTeaserGrid(n)) return 'data';
    if (n.help && n.kind !== 'region') return 'help';
    if (n.kind === 'region' || n.kind === 'list' || n.kind === 'notice' || (n.kind === 'media' && n.iframeKind)) {
      return n.roleHint === 'navigation' ? 'nav' : 'container';
    }
    if (n.kind === 'field' || n.kind === 'select' || n.kind === 'checkbox' || n.kind === 'radio') return 'field';
    if (n.kind === 'heading' || n.kind === 'text' || n.kind === 'image' || n.kind === 'table') return 'content';
    if (n.kind === 'button' || n.kind === 'link') return n.landmark === 'navigation' || n.zone === 'header_band' ? 'nav' : 'action';
    return 'other';
  };
  const ranked = [...drafts].filter((d) => d.score > 0.5 && d.info.id !== reserved).sort((a, b) => b.score - a.score || a.order - b.order);
  const used: Record<string, number> = {};
  const same = new Map<string, number>();
  const kept = reserved ? drafts.find((d) => d.info.id === reserved) : undefined;
  const chosen: Draft[] = kept ? [kept] : [];
  const leftovers: Draft[] = [];
  const repeats: Draft[] = [];
  for (const d of ranked) {
    const sig = dupSignature(d.info);
    if (sig) {
      const k = (same.get(sig) ?? 0) + 1;
      same.set(sig, k);
      if (k > MAX_SAME) {
        repeats.push(d);
        continue;
      }
    }
    const b = bucketOf(d.info, d);
    if ((used[b] ?? 0) < (quotas[b] ?? 4)) {
      used[b] = (used[b] ?? 0) + 1;
      chosen.push(d);
      if (chosen.length >= MAX_DIGEST) break;
    } else leftovers.push(d);
  }
  for (const d of [...leftovers, ...repeats]) {
    if (chosen.length >= MAX_DIGEST) break;
    chosen.push(d);
  }
  return chosen.sort((a, b) => a.order - b.order);
}

function positionPhrase(
  n: NodeInfo, forms: Array<{ top: number; bottom: number; left: number; right: number }>, vw: number, vh: number,
  sx: number, sy: number, docH: number,
): string {
  const r = n.rect;
  if (n.fixed && n.zone.startsWith('overlay')) {
    const top = r.y - sy;
    const left = r.x - sx;
    if (r.w >= 0.8 * vw) return top <= vh * 0.3 ? 'top edge, full width, floating' : top >= vh * 0.4 ? 'bottom edge, full width, floating' : 'center, over the page';
    const v = top + r.h / 2 < vh / 3 ? 'top' : top + r.h / 2 > (2 * vh) / 3 ? 'bottom' : 'middle';
    const h = left + r.w / 2 < vw / 3 ? 'left' : left + r.w / 2 > (2 * vw) / 3 ? 'right' : 'center';
    if (n.zone === 'overlay_corner') return `${v} ${h} corner, floating`;
    return `${v === 'middle' && h === 'center' ? 'center' : `${v} ${h}`}, over the page`;
  }
  const cy = (r.y + r.h / 2) / Math.max(docH, 1);
  const cx = (r.x + r.w / 2 - sx) / Math.max(vw, 1);
  const v = cy < 0.08 ? 'top' : cy < 0.3 ? 'upper' : cy < 0.62 ? 'middle' : cy < 0.86 ? 'lower' : 'bottom';
  const h = cx < 0.33 ? 'left' : cx > 0.67 ? 'right' : 'center';
  let phrase: string;
  if (v === 'bottom' && n.zone === 'footer_band') phrase = 'bottom of page';
  else if (v === 'top') phrase = h === 'center' ? 'top center' : `top ${h}`;
  else if (h === 'center') phrase = v === 'middle' ? 'middle' : `${v} middle`;
  else phrase = `${v} ${h}`;
  const form = forms.find((f) => r.y >= f.top - 2 && r.y + r.h <= f.bottom + 2 && r.x >= f.left - 2 && r.x + r.w <= f.right + 2);
  const formsBottom = forms.reduce((m, f) => Math.max(m, f.bottom), -Infinity);
  if (form) phrase += ', inside the form';
  else if (forms.length && r.y >= formsBottom && n.inMain) phrase += ', below the form';
  if (!n.fixed && r.y > vh) phrase += ', below the first screen';
  return phrase;
}

function toEvidence(
  d: Draft, forms: Array<{ top: number; bottom: number; left: number; right: number }>, vw: number, vh: number,
  sx: number, sy: number, docH: number, all: Draft[],
): ElementEvidence {
  const n = d.info;
  const ev: ElementEvidence = {
    id: n.id,
    tag: n.tag,
    role_hint: n.roleHint,
    label: evidenceLabel(n, all),
    zone: n.zone,
    landmark: n.landmark,
    size: `${n.rect.w} x ${n.rect.h} px`,
    position: positionPhrase(n, forms, vw, vh, sx, sy, docH),
    fixed: n.fixed,
    class_words: safeClassWords(n.classWords, 6),
    visual_weight: n.weight,
  };
  if (n.iframeKind) ev.iframe_kind = n.iframeKind;
  if (n.linkTarget) ev.link_target = n.linkTarget;
  if (n.kind === 'text' || n.kind === 'region' || n.kind === 'list' || n.kind === 'table' || n.kind === 'notice') {
    if (n.textChars > 0) ev.text_chars = n.textChars;
  }
  if (n.cards >= 4) ev.cards = n.cards;
  return ev;
}

function evidenceLabel(n: NodeInfo, all: Draft[]): string {
  const el = n.el;
  switch (n.kind) {
    case 'text': {
      if (n.textChars >= 160) {
        const paras = Math.max(1, el.querySelectorAll('p').length || 1);
        return safeUiLabel(`Text, ${paras} paragraph${paras === 1 ? '' : 's'}, begins: ${firstWords(n.name, 9)}`, 15);
      }
      return safeUiLabel(n.name, 15);
    }
    case 'region':
    case 'notice':
    case 'list': {
      const title = regionTitle(el);
      const choiceKinds = n.tag === 'fieldset' ? ['radio', 'checkbox', 'button', 'link'] : ['button', 'link'];
      const buttons = all
        .filter((x) => choiceKinds.includes(x.info.kind) && el.contains(x.info.el) && x.info.el !== el)
        .slice(0, n.tag === 'fieldset' ? 4 : 3)
        .map((x) => firstWords(x.info.name, n.tag === 'fieldset' ? 6 : 4));
      const body = visibleTextOf(el, 200);
      let head = title ? firstWords(title, 7) : firstWords(body, 8);
      if (n.cards >= 4) {
        // Round 7: name a card grid by its section's heading and its first card ("Related News: 4 cards, first: …"),
        // so Jev can tell news teasers from the page's own content.
        const named = title || headingBefore(el);
        const first = el.firstElementChild ? firstWords(visibleTextOf(el.firstElementChild, 160), 6) : '';
        head = `${named ? firstWords(named, 6) : 'Cards'}: ${n.cards} cards${first ? `, first: ${first}` : ''}`;
      }
      else if (n.kind === 'list' && !title) head = `List of ${countVisibleChildren(el)} items, begins: ${firstWords(body, 6)}`;
      else if (!title && buttons.length && collapse(body).startsWith(collapse(buttons[0] ?? '').replace(/…$/, ''))) {
        // The region is mostly its links (a promo bar, a menu): list them once.
        return safeUiLabel(`Links: ${buttons.join(' / ')}`, 15);
      }
      const tail = buttons.length && n.cards < 4 ? ` · ${buttons.join(' / ')}` : '';
      return safeUiLabel(`${head}${tail}`, 15);
    }
    case 'media':
      if (n.iframeKind) return safeUiLabel(n.name || 'Embedded frame', 15);
      return safeUiLabel(n.name || (n.tag === 'video' ? 'Video' : 'Media'), 15);
    case 'image':
      return safeUiLabel(n.name || 'Image', 15);
    case 'checkbox':
    case 'radio': {
      // The row text around a checkbox carries the meaning ("Atorvastatin … 2 refills left").
      const rows = [el.closest('label'), el.closest('li'), el.closest('tr'), el.closest('[role="row"]'), el.parentElement];
      let rowText = '';
      for (const row of rows) {
        if (!row || row === el) continue;
        const t = visibleTextOf(row, 320);
        if (t.length > 0 && t.length <= 300) {
          rowText = t;
          break;
        }
      }
      return safeUiLabel(rowText.length > n.name.length ? rowText : n.name, 15);
    }
    default:
      return safeUiLabel(n.name, 15);
  }
}

/* ------------------------------------------------------------------ */
/* Page body size (round 3)                                            */
/* ------------------------------------------------------------------ */

const BLOCK_TAGS = new Set(['P', 'LI', 'DD', 'DT', 'BLOCKQUOTE', 'TD', 'TH', 'FIGCAPTION']);
const FOOTER_WORDS = /(^|[-_\s])(footer|site-?footer|colophon|global-?footer)([-_\s]|$)/;
const LEGAL_WORDS = /(fine-?print|small-?print|legal|disclaimer|disclosure|footnote|copyright|terms|smallprint|fineprint)/;
const PROMO_CLASS = /(^|[-_\s])(promo|promos|promotion|upsell|membership|advert|advertisement|sponsor|sponsored|marketing|newsletter|subscribe|coupon|deal|deals|offer|offers|carousel|slider|slideshow|swiper|teaser|banner)([-_\s]|$)/;
const ASIDE_CLASS = /(^|[-_\s])(sidebar|side-?bar|rail|aside|related|recommend|recommended|trending)([-_\s]|$)/;
const NAV_CLASS = /(^|[-_\s])(nav|navbar|menu|breadcrumb|breadcrumbs|pagination|tabs)([-_\s]|$)/;

/** Why the element (or an ancestor) is not running body text, or null. Cached per element. */
function notBodyReason(el: Element, cache: Map<Element, string | null>): string | null {
  const path: Element[] = [];
  let n: Element | null = el;
  let reason: string | null = null;
  while (n && n !== document.body && n !== document.documentElement) {
    if (cache.has(n)) {
      reason = cache.get(n) ?? null;
      break;
    }
    path.push(n);
    const tag = n.tagName;
    const role = (n.getAttribute('role') ?? '').toLowerCase();
    const words = `${n.id} ${typeof n.className === 'string' ? n.className : ''}`.toLowerCase();
    if (tag === 'FOOTER' || role === 'contentinfo' || FOOTER_WORDS.test(words)) reason = 'footer';
    else if (tag === 'SMALL' || LEGAL_WORDS.test(words)) reason = 'legal';
    else if (CONSENT_CLASS.test(words)) reason = 'consent';
    else if (CHAT_CLASS.test(words)) reason = 'chat';
    else if (tag === 'ASIDE' || role === 'complementary' || ASIDE_CLASS.test(words)) reason = 'aside';
    else if (tag === 'NAV' || role === 'navigation' || role === 'menu' || NAV_CLASS.test(words)) reason = 'nav';
    else if (tag === 'DIALOG' || role === 'dialog' || role === 'alertdialog') reason = 'dialog';
    else if (PROMO_CLASS.test(words) || /carousel/i.test(n.getAttribute('aria-roledescription') ?? '')) reason = 'promo';
    else if (getComputedStyle(n).position === 'fixed') reason = 'overlay';
    if (reason) break;
    n = n.parentElement;
  }
  for (const x of path) cache.set(x, reason);
  return reason;
}

let bodyCanvas: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
function measureCtx(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  if (bodyCanvas !== undefined) return bodyCanvas;
  try {
    bodyCanvas = new OffscreenCanvas(8, 8).getContext('2d');
  } catch {
    bodyCanvas = null;
  }
  return bodyCanvas;
}

const SAMPLE_PROSE = 'Select the prescriptions you want to refill, choose how you would like to get them, and review your order.';

/**
 * The page's body text: blocks of running text (a whole <p>, <li>, <td>… counts its inline links and bold words;
 * other elements count their own text) with the reasons they are not body text, then core's char-weighted median.
 */
export function measureBody(texts: TextSample[]): BodyInfo {
  const cache = new Map<Element, string | null>();
  const counted = new Set<Element>();
  const blocks: Array<BodyBlock & { el: Element; t: TextSample }> = [];
  for (const t of texts) {
    if (t.iconFont || t.opacity < 0.5) continue;
    const el = t.el;
    const owner = el.parentElement?.closest('p, li, dd, dt, blockquote, td, th, figcaption') ?? null;
    if (owner && counted.has(owner)) continue; // already counted with its paragraph
    const block = BLOCK_TAGS.has(el.tagName);
    const chars = block ? Math.min(5000, collapse(el.textContent ?? '').length) : t.chars;
    if (block) counted.add(el);
    let excluded: string | null = null;
    if (t.control) excluded = 'control';
    else if (t.headingLevel !== null) excluded = 'heading';
    else if (t.clipRisk) excluded = 'metadata';
    else excluded = notBodyReason(el, cache);
    blocks.push({ fontPx: t.fontPx, chars, inMain: t.inMain, excluded, el, t });
  }
  const fallback = document.body ? parseFloat(getComputedStyle(document.body).fontSize) : 16;
  const size = bodySizeFromBlocks(blocks, Number.isFinite(fallback) ? fallback : 16);
  // The most typical block at that size: its font and average character width size the page column.
  const atSize = blocks
    .filter((b) => !b.excluded && Math.abs(b.fontPx - size.px) < 0.6 && b.chars >= 20)
    .sort((a, b) => Number(b.inMain) - Number(a.inMain) || b.chars - a.chars);
  const pick = atSize[0] ?? null;
  const el = pick?.el ?? document.body ?? null;
  let font = '';
  let charPx = size.px * 0.5;
  if (el) {
    const cs = getComputedStyle(el);
    font = `${cs.fontStyle} ${cs.fontWeight} ${size.px}px ${cs.fontFamily}`;
    const ctx = measureCtx();
    const sample = pick ? collapse(el.textContent ?? '').slice(0, 400) : '';
    const text = sample.length >= 40 ? sample : SAMPLE_PROSE;
    if (ctx) {
      try {
        ctx.font = font;
        const w = ctx.measureText(text).width / text.length;
        if (w > 0 && Number.isFinite(w)) charPx = Math.round(w * 100) / 100;
      } catch {
        /* keep the estimate */
      }
    }
  }
  return { px: size.px, source: size.source, blocks: size.blocks, chars: size.chars, font, charPx, el: pick?.el ?? null };
}

function redactPath(p: string): string {
  const parts = p.split('/').map((seg) => {
    if (!seg) return seg;
    let s: string;
    try {
      s = decodeURIComponent(seg);
    } catch {
      s = seg;
    }
    if (/\d/.test(s) && !/^\w+\.(html?|php|aspx?)$/i.test(s)) return '[id]';
    if (s.length >= 24 && /^[\w-]+$/.test(s)) return '[id]';
    if (/@/.test(s)) return '[email]';
    return s.toLowerCase().slice(0, 40);
  });
  return parts.join('/') || '/';
}

function scoreMain(body: HTMLElement | null): Element | null {
  if (!body) return null;
  // Readability-lite: score parents of paragraphs by text length, penalise link-heavy and chrome-like containers.
  const scores = new Map<Element, number>();
  const paras = body.querySelectorAll('p, pre, td, li, article div');
  let n = 0;
  for (const p of Array.from(paras)) {
    if (++n > 1500) break;
    const len = collapse(p.textContent ?? '').length;
    if (len < 40) continue;
    const add = 1 + Math.min(3, len / 100);
    const parent = p.parentElement;
    const grand = parent?.parentElement;
    if (parent) scores.set(parent, (scores.get(parent) ?? 0) + add);
    if (grand) scores.set(grand, (scores.get(grand) ?? 0) + add / 2);
  }
  let best: Element | null = null;
  let bestScore = 0;
  for (const [el, s0] of scores) {
    const cw = classWordsOf(el).join(' ');
    let s = s0;
    if (/nav|footer|sidebar|comment|ad|promo|menu|header|related/.test(cw)) s *= 0.4;
    const text = collapse(el.textContent ?? '').length || 1;
    let linkText = 0;
    for (const a of Array.from(el.querySelectorAll('a')).slice(0, 200)) linkText += collapse(a.textContent ?? '').length;
    s *= 1 - Math.min(0.9, linkText / text);
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  }
  return bestScore >= 3 ? best : body;
}

function pageKindOf(drafts: Draft[], formCount: number, texts: TextSample[]): string {
  const inMain = drafts.filter((d) => d.info.inMain);
  const fields = inMain.filter((d) => d.info.kind === 'field' || d.info.kind === 'select' || d.info.kind === 'checkbox' || d.info.kind === 'radio').length;
  const mainText = texts.filter((t) => t.inMain && t.running).reduce((s, t) => s + t.chars, 0);
  const controls = inMain.filter((d) => d.info.kind === 'button' || d.info.kind === 'link').length;
  const hasPrice = inMain.some((d) => d.node.shape === 'price');
  const buy = inMain.some((d) => d.info.kind === 'button' && /\b(add to (cart|bag|basket)|buy now)\b/i.test(d.info.name));
  const lists = drafts.filter((d) => d.info.cards >= 6).length;
  if (hasPrice && buy) return 'online store product page';
  if ((formCount > 0 || fields >= 3) && fields >= 3) return 'form page';
  if (location.pathname.includes('search') || /[?&](q|query|search|k)=/.test(location.search)) return 'search results page';
  if (mainText >= 2000 && controls < 40) return 'article page';
  if (lists > 0) return 'listing page';
  if (location.pathname === '/' || location.pathname === '') return 'home page';
  return 'web page';
}
