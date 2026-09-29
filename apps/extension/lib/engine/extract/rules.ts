import type { RegionEvidence, RegionRole } from '@webable/core/page/types';

/**
 * High-precision local rules for region roles (ai-architecture.md 3.1 G4,
 * engine.md 2.10-2.12). A region whose rule precision is >= 0.90 is decided
 * locally and never sent for page analysis. Precision values are priors from
 * the published selector lists; they are re-estimated on the fixture corpus.
 */

export interface RuleHit {
  role: RegionRole;
  precision: number;
  ruleId: string;
}

/** Local decisions at or above this precision skip page analysis. */
export const DECIDED_PRECISION = 0.9;

/** Known consent-management roots (CMP vendors). */
export const CMP_SELECTOR = [
  '#onetrust-banner-sdk',
  '#onetrust-consent-sdk',
  '#CybotCookiebotDialog',
  '.qc-cmp2-container',
  '#qc-cmp2-container',
  '#truste-consent-track',
  '#didomi-host',
  '#usercentrics-root',
  '[id^="sp_message_container"]',
  '.osano-cm-window',
  '.cky-consent-container',
  '#cmplz-cookiebanner-container',
  '#iubenda-cs-banner',
  '#cookiescript_injected',
  '.cc-window.cc-banner',
  '#hs-eu-cookie-confirmation',
].join(',');

/** Known chat vendor roots. */
export const CHAT_SELECTOR = [
  '.intercom-lightweight-app',
  '#intercom-container',
  'iframe[name^="intercom"]',
  '#drift-widget',
  '#drift-frame-controller',
  '#launcher[title]',
  '#hubspot-messages-iframe-container',
  '.crisp-client',
  '#tawk-bubble-container',
  '.tawk-min-container',
  '#chat-widget-container',
  '#fc_frame',
  '#tidio-chat',
  '#olark-box',
  '.zsiq_float',
].join(',');

export const AD_MARKUP_SELECTOR = [
  'ins.adsbygoogle',
  '[data-ad-slot]',
  '[data-ad-unit]',
  '[data-ad-client]',
  'div[id^="div-gpt-ad"]',
  '[id*="google_ads"]',
].join(',');

export const RECS_VENDOR_SELECTOR = [
  '.trc_related_container',
  '.OUTBRAIN',
  '[data-widget-id^="AR_"]',
  '[id^="taboola-"]',
].join(',');

type IframeKind = RegionEvidence['iframe_kind'];

const HOSTS: ReadonlyArray<readonly [string, IframeKind]> = [
  ['doubleclick.net', 'ad_network'],
  ['googlesyndication.com', 'ad_network'],
  ['googleadservices.com', 'ad_network'],
  ['adservice.google.com', 'ad_network'],
  ['adnxs.com', 'ad_network'],
  ['amazon-adsystem.com', 'ad_network'],
  ['criteo.com', 'ad_network'],
  ['criteo.net', 'ad_network'],
  ['taboola.com', 'ad_network'],
  ['outbrain.com', 'ad_network'],
  ['adsafeprotected.com', 'ad_network'],
  ['moatads.com', 'ad_network'],
  ['pubmatic.com', 'ad_network'],
  ['rubiconproject.com', 'ad_network'],
  ['openx.net', 'ad_network'],
  ['intercom.io', 'chat_vendor'],
  ['intercomcdn.com', 'chat_vendor'],
  ['drift.com', 'chat_vendor'],
  ['driftt.com', 'chat_vendor'],
  ['zendesk.com', 'chat_vendor'],
  ['zdassets.com', 'chat_vendor'],
  ['hubspot.com', 'chat_vendor'],
  ['crisp.chat', 'chat_vendor'],
  ['tawk.to', 'chat_vendor'],
  ['livechatinc.com', 'chat_vendor'],
  ['freshchat.com', 'chat_vendor'],
  ['tidio.co', 'chat_vendor'],
  ['olark.com', 'chat_vendor'],
  ['youtube.com', 'video_host'],
  ['youtube-nocookie.com', 'video_host'],
  ['vimeo.com', 'video_host'],
  ['dailymotion.com', 'video_host'],
  ['wistia.com', 'video_host'],
  ['wistia.net', 'video_host'],
  ['jwplayer.com', 'video_host'],
  ['twitch.tv', 'video_host'],
  ['twitter.com', 'social_embed'],
  ['x.com', 'social_embed'],
  ['facebook.com', 'social_embed'],
  ['instagram.com', 'social_embed'],
  ['tiktok.com', 'social_embed'],
  ['linkedin.com', 'social_embed'],
  ['reddit.com', 'social_embed'],
  ['openstreetmap.org', 'map'],
  ['mapbox.com', 'map'],
  ['maps.google.com', 'map'],
];

/** Category of an iframe host from the bundled table. The host itself is never sent. */
export function iframeKindOfHost(host: string | null, path = ''): IframeKind {
  if (!host) return 'other';
  if (
    (host === 'www.google.com' || host === 'google.com') &&
    path.startsWith('/maps')
  )
    return 'map';
  for (const [suffix, kind] of HOSTS) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return kind;
  }
  return 'other';
}

/** IAB standard ad sizes (width x height), matched within +-2 px. */
export const IAB_SIZES: ReadonlyArray<readonly [number, number]> = [
  [300, 250],
  [336, 280],
  [728, 90],
  [970, 90],
  [970, 250],
  [160, 600],
  [300, 600],
  [120, 600],
  [320, 50],
  [320, 100],
  [468, 60],
  [250, 250],
  [200, 200],
];

export function isIabSize(w: number, h: number): boolean {
  return IAB_SIZES.some(
    ([iw, ih]) => Math.abs(w - iw) <= 2 && Math.abs(h - ih) <= 2,
  );
}

const AD_CLASS_RE =
  /(?:^|[\s_-])(ad|ads|advert|advertisement|adslot|ad-slot|dfp|sponsor|sponsored|promo)(?:$|[\s_-])/i;
const AD_LABEL_RE =
  /^(advertisement|sponsored|ad|ads|promoted|anzeige|publicidad|annonce)$/i;
const CONSENT_TEXT_RE = /cookie|consent|gdpr|privacy/i;
const CONSENT_BUTTON_RE = /accept|reject|agree|manage|settings|decline|allow/i;
const RECS_HEADING_RE =
  /recommended|you may also like|related|more from|trending|popular|most read/i;

export function hasAdClass(el: Element): boolean {
  const s = `${typeof el.className === 'string' ? el.className : ''} ${el.id}`;
  return AD_CLASS_RE.test(s);
}

export interface RuleContext {
  /** Rendered rect size (CSS px). */
  width: number;
  height: number;
  pinned: 'fixed' | 'sticky' | 'no';
  iframeKind: IframeKind;
  landmark: RegionEvidence['landmark'];
  /** First short heading/label text inside the region; read locally only. */
  labelText: string;
  /** Short text of the region (<= 400 chars); read locally only. */
  shortText: string;
  buttonTexts: readonly string[];
  hasRequiredFields: boolean;
}

/** Known third-party roots on the page, found once per extraction, with their areas. */
export interface KnownRoots {
  cmp: ReadonlyArray<readonly [Element, number]>;
  chat: ReadonlyArray<readonly [Element, number]>;
  ad: ReadonlyArray<readonly [Element, number]>;
  recs: ReadonlyArray<readonly [Element, number]>;
}

const areaOf = (el: Element): number => {
  const r = el.getBoundingClientRect();
  return r.width * r.height;
};

export function knownRoots(root: ParentNode): KnownRoots {
  const find = (sel: string): Array<readonly [Element, number]> =>
    [...root.querySelectorAll(sel)]
      .slice(0, 50)
      .map((el) => [el, areaOf(el)] as const);
  return {
    cmp: find(CMP_SELECTOR),
    chat: find(CHAT_SELECTOR),
    ad: find(AD_MARKUP_SELECTOR),
    recs: find(RECS_VENDOR_SELECTOR),
  };
}

/**
 * A region "is" a known root when it is the root, or a thin wrapper around it
 * (at most twice its area). A large container that merely includes an ad or
 * a consent banner somewhere inside is not labelled by it.
 */
function wraps(
  el: Element,
  roots: KnownRoots[keyof KnownRoots],
  elArea: number,
): boolean {
  return roots.some(
    ([r, a]) => r === el || (el.contains(r) && (a <= 0 || elArea <= 2 * a)),
  );
}

/**
 * Decide a region's role from high-precision rules, strongest first.
 * Returns null when no rule fires (the region is ambiguous locally).
 */
export function ruleFor(
  el: Element,
  ctx: RuleContext,
  known: KnownRoots = knownRoots(el),
): RuleHit | null {
  const elArea = ctx.width * ctx.height;
  if (el.matches(CMP_SELECTOR) || wraps(el, known.cmp, elArea)) {
    return { role: 'consent_banner', precision: 0.99, ruleId: 'cmp_root' };
  }
  if (el.matches(CHAT_SELECTOR) || wraps(el, known.chat, elArea)) {
    return { role: 'chat_widget', precision: 0.97, ruleId: 'chat_vendor' };
  }
  if (ctx.iframeKind === 'chat_vendor') {
    return { role: 'chat_widget', precision: 0.96, ruleId: 'chat_iframe_host' };
  }
  if (ctx.landmark === 'main')
    return { role: 'main_content', precision: 0.95, ruleId: 'landmark_main' };
  if (ctx.hasRequiredFields)
    return { role: 'form', precision: 0.95, ruleId: 'required_fields' };
  if (el.matches(AD_MARKUP_SELECTOR) || wraps(el, known.ad, elArea)) {
    return { role: 'promo_ad', precision: 0.97, ruleId: 'ad_markup' };
  }
  if (ctx.iframeKind === 'ad_network') {
    return { role: 'promo_ad', precision: 0.98, ruleId: 'ad_iframe_host' };
  }
  if (el.matches(RECS_VENDOR_SELECTOR) || wraps(el, known.recs, elArea)) {
    return { role: 'recommendations', precision: 0.95, ruleId: 'recs_vendor' };
  }
  if (ctx.landmark === 'navigation')
    return { role: 'navigation', precision: 0.95, ruleId: 'landmark_nav' };
  if (ctx.landmark === 'contentinfo')
    return { role: 'footer', precision: 0.93, ruleId: 'landmark_footer' };
  if (ctx.landmark === 'banner')
    return { role: 'navigation', precision: 0.9, ruleId: 'landmark_banner' };
  if (ctx.landmark === 'search')
    return { role: 'navigation', precision: 0.9, ruleId: 'landmark_search' };
  if (ctx.landmark === 'form')
    return { role: 'form', precision: 0.9, ruleId: 'landmark_form' };
  if (
    ctx.pinned !== 'no' &&
    CONSENT_TEXT_RE.test(ctx.shortText) &&
    ctx.buttonTexts.some((t) => CONSENT_BUTTON_RE.test(t))
  ) {
    return { role: 'consent_banner', precision: 0.92, ruleId: 'consent_text' };
  }
  const iab = isIabSize(ctx.width, ctx.height);
  if (AD_LABEL_RE.test(ctx.labelText.trim())) {
    return {
      role: 'promo_ad',
      precision: iab ? 0.95 : 0.9,
      ruleId: 'ad_label',
    };
  }
  if (iab && hasAdClass(el))
    return { role: 'promo_ad', precision: 0.93, ruleId: 'iab_size_ad_class' };
  // Below the decision threshold: evidence for page analysis, not a decision.
  if (iab) return { role: 'promo_ad', precision: 0.7, ruleId: 'iab_size' };
  if (hasAdClass(el))
    return { role: 'promo_ad', precision: 0.6, ruleId: 'ad_class' };
  if (RECS_HEADING_RE.test(ctx.labelText)) {
    return { role: 'recommendations', precision: 0.75, ruleId: 'recs_heading' };
  }
  return null;
}
