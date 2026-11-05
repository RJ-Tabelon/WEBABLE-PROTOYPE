// Owner: A2.
// Shared outline helpers for the layout spec repairer and the heuristic layout: an index over the outline
// tree, the protected-node rules, primary-action picking, fit limits and spec coverage.
//
// Placement semantics (for the renderer and the content-loss check): a node listed in a section or the
// strip brings its subtree, EXCEPT descendants that are listed elsewhere, which render only where they are
// listed. A container (region or list) with children is covered when all of its children are covered.
import type { FitSpec, FitSummaryForModel, OutlineKind, OutlineNode, PageOutline, Role, SectionLabel } from '../types';

export const FIELD_KINDS: ReadonlySet<OutlineKind> = new Set<OutlineKind>(['field', 'select', 'checkbox', 'radio']);
export const ACTION_KINDS: ReadonlySet<OutlineKind> = new Set<OutlineKind>(['button', 'link']);
export const CONTROL_KINDS: ReadonlySet<OutlineKind> = new Set<OutlineKind>(['button', 'link', 'field', 'select', 'checkbox', 'radio']);
export const CONTAINER_KINDS: ReadonlySet<OutlineKind> = new Set<OutlineKind>(['region', 'list']);

/* ------------------------------------------------------------------ */
/* Vocabulary (labels are allowlisted interface words, '·' elsewhere)  */
/* ------------------------------------------------------------------ */

export const RE = {
  help: /\b(help|contact|support|chat|feedback|customer service|call|questions\?|ask)\b/,
  consent: /\b(cookie|cookies|consent|privacy choices|your privacy|tracking)\b/,
  safety: /\b(warning|warnings|safety|important|caution|danger|side effects|allerg\w*)\b/,
  search: /\bsearch\b/,
  account: /\b(sign in|signin|log in|login|account|my account|profile|sign out)\b/,
  cart: /\b(cart|basket|bag|trolley)\b/,
  action: /\b(add to cart|add to bag|add to basket|buy|buy now|submit|continue|next|book|apply|pay|pay now|send|sign in|log in|confirm|place order|checkout|check out|order|refill|register|sign up|save|start|get started|request|schedule|reserve|renew|search|finish|done)\b/,
  notAction: /\b(continue shopping|keep shopping|learn more|see more|view all|show more|read more|cancel|back|close|dismiss|no thanks|maybe later|skip|shop now|see details|details|share|print|edit|remove|clear)\b/,
  buy: /\b(add to cart|add to bag|add to basket|buy|buy now|add)\b/,
  submitLike: /\b(submit|confirm|continue|next|send|apply|register|sign up|request|refill|book|schedule|pay|place order|finish|save)\b/,
  ad: /\b(sponsored|advertisement|advert|ad|ads|promoted)\b/,
  promo: /\b(offer|offers|deal|deals|sale|promo|promotion|membership|member|join|upgrade|limited time|special|coupon|rewards?|flu shot|free shipping|% off|discount|subscribe|newsletter)\b/,
  related: /\b(also viewed|you may also like|you might also like|related|recommended|recommendations|customers also|similar|more like this|trending|popular|frequently bought)\b/,
  nav: /\b(menu|navigation|breadcrumb|breadcrumbs|categories|departments|skip to)\b/,
  legal: /\b(terms|privacy|legal|copyright|cookie policy|accessibility statement|©)\b/,
  consentField: /\b(agree|terms|consent|privacy|accept|confirm that|certify)\b/,
  /** Chat widgets and their controls (only counted inside overlays: a "Chat with a caseworker" link in a page stays help). */
  chat: /\b(chat|chats|chatbot|live chat|virtual assistant|assistant|live agent|messenger|send message|message us|talk to us)\b/,
  /** Popups that matter for the task (a session about to end), as opposed to surveys and promotions. */
  warning: /\b(session|time ?out|timed out|expir\w*|warning|error|errors|signed out|sign you out|security|urgent|emergency|alert)\b/,
  /** Fields that sign up for mail or search the site: never the page's main form. */
  newsletter: /\b(newsletter|newsletters|subscribe|subscription|inbox|deals|tips|updates|sign up for|stay in touch|stay informed)\b/,
  logo: /\blogo\b/,
} as const;

export const lower = (s: string | undefined): string => (s ?? '').toLowerCase();

/* ------------------------------------------------------------------ */
/* Index                                                               */
/* ------------------------------------------------------------------ */

export interface OutlineIndex {
  nodes: Map<string, OutlineNode>;
  order: Map<string, number>;
  children: Map<string, string[]>;
  roots: string[];
  parent(id: string): string | null;
  ancestors(id: string): string[]; // nearest first
  isAncestor(anc: string, desc: string): boolean;
  descendants(id: string): string[]; // DOM order
  kind(id: string): OutlineKind | undefined;
  label(id: string): string; // lower case
}

export function indexOutline(outline: PageOutline): OutlineIndex {
  const nodes = new Map<string, OutlineNode>();
  const order = new Map<string, number>();
  outline.nodes.forEach((n, i) => {
    if (!n || typeof n.id !== 'string' || nodes.has(n.id)) return;
    nodes.set(n.id, n);
    order.set(n.id, i);
  });
  const parentRaw = (id: string): string | null => {
    const p = nodes.get(id)?.parent;
    return p && p !== id && nodes.has(p) ? p : null;
  };
  // Break parent cycles: a node whose ancestor chain loops back is treated as a root.
  const parentOf = new Map<string, string | null>();
  for (const id of nodes.keys()) {
    const seen = new Set<string>([id]);
    let p = parentRaw(id);
    let ok = true;
    while (p) {
      if (seen.has(p)) { ok = false; break; }
      seen.add(p);
      p = parentRaw(p);
    }
    parentOf.set(id, ok ? parentRaw(id) : null);
  }
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const id of nodes.keys()) {
    const p = parentOf.get(id) ?? null;
    if (p) {
      const list = children.get(p);
      if (list) list.push(id); else children.set(p, [id]);
    } else roots.push(id);
  }
  const ancCache = new Map<string, string[]>();
  const ancestors = (id: string): string[] => {
    const hit = ancCache.get(id);
    if (hit) return hit;
    const out: string[] = [];
    let p = parentOf.get(id) ?? null;
    while (p) { out.push(p); p = parentOf.get(p) ?? null; }
    ancCache.set(id, out);
    return out;
  };
  const descendants = (id: string): string[] => {
    const out: string[] = [];
    const walk = (x: string): void => {
      for (const c of children.get(x) ?? []) { out.push(c); walk(c); }
    };
    walk(id);
    return out;
  };
  return {
    nodes,
    order,
    children,
    roots,
    parent: (id) => parentOf.get(id) ?? null,
    ancestors,
    isAncestor: (anc, desc) => ancestors(desc).includes(anc),
    descendants,
    kind: (id) => nodes.get(id)?.kind,
    label: (id) => lower(nodes.get(id)?.label),
  };
}

/* ------------------------------------------------------------------ */
/* Protection                                                          */
/* ------------------------------------------------------------------ */

export type Protection = 'help' | 'consent' | 'alert' | 'field' | 'safety' | 'protected';

/** Why a node must stay open (null when it may be folded). */
export function outlineProtection(ix: OutlineIndex, id: string, roles: Record<string, Role> = {}): Protection | null {
  const n = ix.nodes.get(id);
  if (!n) return null;
  const role = roles[id] ?? n.jevRole;
  const label = lower(n.label);
  const control = CONTROL_KINDS.has(n.kind);
  if (role === 'consent_notice' || (RE.consent.test(label) && looksLikeBanner(n))) return 'consent';
  // A chat widget is one help channel: the widget stays reachable, its own controls (minimise, send) are never lifted.
  const chat = chatRoot(ix, id);
  if (chat) return chat === id ? 'help' : null;
  // Inside a survey, promotion or picker overlay nothing is protected by itself (the overlay's own role decides).
  const ov = overlayRoot(ix, id);
  const plainOverlay = !!ov && !isWarningOverlay(ix, ov, roles) && !consentOverlay(ix, ov, roles);
  if (plainOverlay && role !== 'help_contact') return null;
  if (role === 'help_contact' || (ACTION_KINDS.has(n.kind) && RE.help.test(label))) return 'help';
  if (n.kind === 'notice') return emptyNotice(ix, id) ? null : 'alert';
  if (FIELD_KINDS.has(n.kind) && n.protected) return 'field';
  if (!control && RE.safety.test(label)) return 'safety';
  if (!control && underSafetyHeading(ix, id)) return 'safety';
  if (n.protected) {
    // Header, footer and menu containers are "protected" only because a help link sits inside; that link
    // carries its own protection, so the container may fold.
    const zone = n.zone ?? '';
    const lm = lower(n.landmark);
    const chrome = zone === 'header_band' || zone === 'footer_band' || lm === 'navigation' || lm === 'contentinfo' || lm === 'banner';
    if (chrome) return null;
    return 'protected';
  }
  return null;
}

function consentOverlay(ix: OutlineIndex, root: string, roles: Record<string, Role>): boolean {
  const n = ix.nodes.get(root);
  if (!n) return false;
  if ((roles[root] ?? n.jevRole) === 'consent_notice') return true;
  return RE.consent.test(subtreeLabels(ix, root, 12));
}

/** A notice with no words of its own and nothing inside (an empty live region, a hidden validation slot). */
function emptyNotice(ix: OutlineIndex, id: string): boolean {
  const n = ix.nodes.get(id);
  if (!n) return true;
  const words = (s: string): boolean => /[a-z0-9]/i.test(s.replace(/·/g, ''));
  if (words(n.label) || n.shape) return false;
  return !ix.descendants(id).some((d) => {
    const x = ix.nodes.get(d);
    return !!x && (words(x.label) || !!x.shape || x.kind !== 'text');
  });
}

/**
 * Cookie wording counts as a consent notice only on banners, notices and their controls, not in articles. A region
 * counts by its name only when the name is about cookie choices ("Cookie settings", "We use cookies", "Consent"), so a
 * recipe called "Best Chocolate Chip Cookies" is never taken for a cookie banner; Jev's fine role decides when it has one.
 */
function looksLikeBanner(n: OutlineNode): boolean {
  if (n.fine) return n.fine === 'consent_notice';
  const zone = n.zone ?? '';
  if (zone.startsWith('overlay') || n.kind === 'notice') return true;
  if (n.kind !== 'region') return false;
  const l = lower(n.label);
  return /\bconsent\b|\bwe use cookies\b|\bcookies? (settings|preferences|policy|notice|choices|banner|consent)\b|\b(manage|accept|reject|allow)( all)? cookies\b/.test(l);
}

/** True when one of the two nearest ancestors holds form fields (the control sits in a form). */
export function inFormContext(ix: OutlineIndex, id: string): boolean {
  return ix.ancestors(id).slice(0, 2).some((a) => ix.descendants(a).some((d) => FIELD_KINDS.has(ix.kind(d) as OutlineKind)));
}

/** The outermost ancestor-or-self that sits in an overlay zone (a dialog, a corner widget, a bottom banner). */
export function overlayRoot(ix: OutlineIndex, id: string): string | null {
  let top: string | null = null;
  for (const x of [id, ...ix.ancestors(id)]) {
    if ((ix.nodes.get(x)?.zone ?? '').startsWith('overlay') || lower(ix.nodes.get(x)?.landmark) === 'dialog') top = x;
  }
  return top;
}

function subtreeLabels(ix: OutlineIndex, id: string, max = 60): string {
  return [id, ...ix.descendants(id).slice(0, max)].map((d) => ix.label(d)).join(' · ');
}

/** The chat widget a node belongs to (the overlay that holds a chat), or null. */
export function chatRoot(ix: OutlineIndex, id: string): string | null {
  const root = overlayRoot(ix, id);
  if (!root) return null;
  const n = ix.nodes.get(root);
  if (!n) return null;
  if (ACTION_KINDS.has(n.kind) || n.kind === 'media') return RE.chat.test(ix.label(root)) ? root : null;
  return RE.chat.test(subtreeLabels(ix, root)) ? root : null;
}

/** An overlay that warns about the task (session about to end, an error), so it must stay in view. */
export function isWarningOverlay(ix: OutlineIndex, root: string, roles: Record<string, Role> = {}): boolean {
  const n = ix.nodes.get(root);
  if (!n) return false;
  const role = roles[root] ?? n.jevRole;
  if (role === 'consent_notice' || role === 'advertising' || role === 'recommendations') return false;
  if (chatRoot(ix, root) === root) return false;
  // The overlay's own name, its headings and its notices say what it is about.
  const named = [root, ...ix.descendants(root).filter((d) => ix.kind(d) === 'heading' || ix.kind(d) === 'notice')];
  return RE.warning.test(named.map((d) => ix.label(d)).join(' · '));
}

/** Field that searches the site or signs up for mail (never the page's main form). */
export function isSideField(ix: OutlineIndex, id: string, roles: Record<string, Role> = {}): boolean {
  const n = ix.nodes.get(id);
  if (!n || !FIELD_KINDS.has(n.kind)) return false;
  const role = roles[id] ?? n.jevRole;
  if (role === 'search' || RE.search.test(lower(n.label)) || /\bsearch\b/.test(lower(n.shape)) || lower(n.landmark) === 'search') return true;
  if (chatRoot(ix, id)) return true;
  const near = [id, ...ix.ancestors(id).slice(0, 3)].map((a) => ix.label(a)).join(' · ');
  if (RE.newsletter.test(near)) return true;
  const zone = n.zone ?? '';
  return zone === 'footer_band' || zone === 'header_band';
}

/** Nearest region or list holding a field (its fieldset), else its parent. */
export function fieldGroup(ix: OutlineIndex, id: string): string | null {
  for (const a of ix.ancestors(id)) if (CONTAINER_KINDS.has(ix.kind(a) as OutlineKind)) return a;
  return ix.parent(id);
}

/** Text that follows a Warnings / Safety / Important heading among its siblings, until the next heading. */
function underSafetyHeading(ix: OutlineIndex, id: string): boolean {
  const n = ix.nodes.get(id);
  if (!n || n.kind === 'heading') return false;
  const p = ix.parent(id);
  const sibs = p ? ix.children.get(p) ?? [] : ix.roots;
  const at = sibs.indexOf(id);
  for (let i = at - 1; i >= 0; i--) {
    const s = ix.nodes.get(sibs[i] as string);
    if (s?.kind === 'heading') return RE.safety.test(lower(s.label));
  }
  return false;
}

/** Search, sign in / account and cart controls: never folded; they belong in the strip. */
export function isUtility(ix: OutlineIndex, id: string, roles: Record<string, Role> = {}): boolean {
  const n = ix.nodes.get(id);
  if (!n || !CONTROL_KINDS.has(n.kind)) return false;
  const role = roles[id] ?? n.jevRole;
  const label = lower(n.label);
  return role === 'search' || role === 'account_utility' || RE.search.test(label) || RE.account.test(label) || RE.cart.test(label);
}

/* ------------------------------------------------------------------ */
/* Primary action                                                      */
/* ------------------------------------------------------------------ */

const OFF_TASK_ROLES: ReadonlySet<Role> = new Set<Role>([
  'navigation', 'advertising', 'recommendations', 'consent_notice', 'help_contact', 'account_utility', 'legal_footer', 'popup_overlay', 'search',
]);

/** Score a node as the page's primary action; null when it cannot be one. */
export function primaryActionScore(ix: OutlineIndex, id: string, roles: Record<string, Role> = {}): number | null {
  const n = ix.nodes.get(id);
  if (!n || !ACTION_KINDS.has(n.kind)) return null;
  const role = roles[id] ?? n.jevRole;
  if (role && OFF_TASK_ROLES.has(role)) return null;
  const chain = ix.ancestors(id);
  for (const a of chain) {
    const ar = roles[a] ?? ix.nodes.get(a)?.jevRole;
    if (ar === 'advertising' || ar === 'recommendations' || ar === 'navigation' || ar === 'consent_notice' || ar === 'legal_footer' || ar === 'popup_overlay') return null;
    const al = ix.label(a);
    if (RE.ad.test(al) || RE.related.test(al)) return null;
  }
  const zone = n.zone ?? '';
  if (zone === 'header_band' || zone === 'footer_band' || zone.startsWith('overlay')) return null;
  const lm = lower(n.landmark);
  if (lm === 'banner' || lm === 'navigation' || lm === 'contentinfo') return null;
  const label = lower(n.label);
  if (RE.help.test(label) || RE.consent.test(label)) return null;
  let s = 0;
  // A headline that happens to contain "save" or "apply" is not an action: action words count on short labels only.
  const short = label.split(/\s+/).filter(Boolean).length <= 6;
  if (role === 'action_button') s += 2;
  if (RE.action.test(label) && short) s += 3;
  if (!short && n.kind === 'link') s -= 2;
  if (RE.notAction.test(label)) s -= 4;
  if (n.kind === 'button') s += 1;
  if (zone === 'center_column' || zone === 'full_width_mid' || lm === 'main') s += 1;
  if (inFormContext(ix, id)) s += 1;
  return s;
}

/**
 * The control most likely to complete the page's main task: Jev's action role and the action vocabulary
 * ("Confirm", "Add to cart", "Submit" …) count; "Continue shopping", "Learn more" and off-task regions do not.
 * Ties go to the later control in a form (the submit sits after the fields), else the earlier one.
 */
export function pickPrimaryAction(
  ix: OutlineIndex,
  roles: Record<string, Role> = {},
  opts: { allow?: (id: string) => boolean; minScore?: number } = {},
): string | null {
  const min = opts.minScore ?? 3;
  let best: { id: string; s: number; inForm: boolean } | null = null;
  for (const id of ix.nodes.keys()) {
    if (opts.allow && !opts.allow(id)) continue;
    const s = primaryActionScore(ix, id, roles);
    if (s == null || s < min) continue;
    const inForm = inFormContext(ix, id);
    if (!best || s > best.s || (s === best.s && inForm && best.inForm)) best = { id, s, inForm };
  }
  return best?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Fit limits                                                          */
/* ------------------------------------------------------------------ */

export interface LayoutLimits {
  /** Open content sections (orient, alert, consent and help do not count). */
  openSectionsMax: number;
  /** Records shown first in lists (0 = all). */
  listFirst: 0 | 3 | 4 | 6 | 8 | 12;
  /** Fields per form step (the schema caps a step at 8). */
  formStepMaxFields: number;
  /** Step a form only when it has more fields than this. */
  stepFormsOver: number;
}

/** research-fitting §8.18 and research-redesign §5 (team defaults). */
export function layoutLimits(fit?: FitSummaryForModel | null): LayoutLimits {
  const level = fit?.structure_level ?? 1;
  if (level >= 2) return { openSectionsMax: 3, listFirst: 4, formStepMaxFields: 5, stepFormsOver: 1 };
  if (level === 1) return { openSectionsMax: 4, listFirst: 12, formStepMaxFields: 8, stepFormsOver: 1 };
  return { openSectionsMax: 12, listFirst: 0, formStepMaxFields: 8, stepFormsOver: 12 };
}

export const SHOW_FIRST_VALUES = [0, 3, 4, 6, 8, 12] as const;

/** The largest allowed show_first value ≤ n (3 when n < 3). */
export function snapShowFirst(n: number): 0 | 3 | 4 | 6 | 8 | 12 {
  let best: 0 | 3 | 4 | 6 | 8 | 12 = 3;
  for (const v of SHOW_FIRST_VALUES) if (v > 0 && v <= n) best = v;
  return best;
}

/* ------------------------------------------------------------------ */
/* Section labels from page words                                      */
/* ------------------------------------------------------------------ */

const LABEL_RULES: Array<[RegExp, SectionLabel]> = [
  [/\b(sponsor\w*|advert\w*)\b/, 'Sponsored'],
  [/\b(also viewed|you may also like|you might also like|related|recommended|customers also|similar)\b/, 'Related items'],
  [/\b(review|reviews|ratings?)\b/, 'Reviews'],
  [/\b(questions|faq|q&a|answers)\b/, 'Questions'],
  [/\b(deliver\w*|shipping|pick ?up|returns?|collection)\b/, 'Delivery and returns'],
  [/\b(specifications?|specs|dimensions|technical)\b/, 'Specifications'],
  [/\b(safety|warnings?|important|side effects|caution)\b/, 'Safety information'],
  [/\b(help|contact|support)\b/, 'Help'],
  [/\b(options?|sizes?|colou?rs?|choose|select|prescriptions?|items to)\b/, 'Choose options'],
  [/\b(date of birth|birth ?date|dob|your name|first name|last name|full name)\b/, 'Your details'],
  // "Email address" and "web address" are not a postal address.
  [/(?<!\b(?:e-?mail|web|ip|internet)\s)\baddress\b|\b(postcode|zip|street|city|apartment)\b/, 'Address'],
  [/\b(date|time|schedule|appointment)\b/, 'Date'],
  [/\b(payment|billing|card)\b/, 'Billing'],
  [/\b(your details|personal|about you|contact details|your information)\b/, 'Your details'],
  [/\b(review and submit|summary|confirm)\b/, 'Review and submit'],
  [/\b(results?)\b/, 'Results'],
  [/\b(filters?|refine|sort)\b/, 'Filters'],
  [/\b(comments?)\b/, 'Comments'],
  [/\b(offers?|deals?|promo\w*|membership|save)\b/, 'Offers'],
  [/\b(what you need|you will need|requirements|before you start|eligib\w*)\b/, 'What you need'],
  [/\b(account|sign in)\b/, 'Account'],
  [/\b(search)\b/, 'Search'],
  [/\b(legal|terms|privacy)\b/, 'Legal'],
  [/\b(media|videos?|photos?|gallery|images?)\b/, 'Media'],
  [/\b(article|story|news)\b/, 'Article'],
  [/\b(details|description|about|overview|information|info)\b/, 'Details'],
];

export function labelFromWords(words: string, fallback: SectionLabel = 'Details'): SectionLabel {
  const w = lower(words);
  for (const [re, label] of LABEL_RULES) if (re.test(w)) return label;
  return fallback;
}

/* ------------------------------------------------------------------ */
/* Coverage                                                            */
/* ------------------------------------------------------------------ */

/** Every outline node that the spec places: listed, inside a listed node, or a container whose children all are. */
export function coveredIds(spec: Pick<FitSpec, 'strip' | 'sections'>, ix: OutlineIndex): Set<string> {
  const placed = new Set<string>([...spec.strip, ...spec.sections.flatMap((s) => s.nodes)].filter((id) => ix.nodes.has(id)));
  const covered = new Set<string>();
  for (const id of ix.nodes.keys()) {
    if (placed.has(id) || ix.ancestors(id).some((a) => placed.has(a))) covered.add(id);
  }
  // Containers whose children are all covered (deepest first).
  const containers = [...ix.nodes.keys()]
    .filter((id) => !covered.has(id) && CONTAINER_KINDS.has(ix.kind(id) as OutlineKind) && (ix.children.get(id)?.length ?? 0) > 0)
    .sort((a, b) => ix.ancestors(b).length - ix.ancestors(a).length);
  for (const id of containers) {
    if ((ix.children.get(id) ?? []).every((c) => covered.has(c))) covered.add(id);
  }
  return covered;
}

/** Share of outline nodes the spec places (1.0 is required), and the ids it misses. */
export function specCoverage(spec: Pick<FitSpec, 'strip' | 'sections'>, outline: PageOutline): { coverage: number; missing: string[] } {
  const ix = indexOutline(outline);
  if (!ix.nodes.size) return { coverage: 1, missing: [] };
  const covered = coveredIds(spec, ix);
  const missing = [...ix.nodes.keys()].filter((id) => !covered.has(id));
  return { coverage: (ix.nodes.size - missing.length) / ix.nodes.size, missing };
}

/** Where each listed id renders: 'strip' or the index of its section. */
export function placementMap(spec: Pick<FitSpec, 'strip' | 'sections'>): Map<string, 'strip' | number> {
  const m = new Map<string, 'strip' | number>();
  spec.strip.forEach((id) => { if (!m.has(id)) m.set(id, 'strip'); });
  spec.sections.forEach((s, i) => s.nodes.forEach((id) => { if (!m.has(id)) m.set(id, i); }));
  return m;
}

/**
 * The outline ids a section renders, in the section's order (each listed node, then its subtree in DOM
 * order): its listed nodes and their subtrees, minus descendants
 * listed elsewhere (they render where they are listed). Renderers may use this directly.
 */
export function sectionRenderIds(spec: Pick<FitSpec, 'strip' | 'sections'>, outline: PageOutline, sectionIndex: number): string[] {
  const ix = indexOutline(outline);
  const where = placementMap(spec);
  const sec = spec.sections[sectionIndex];
  if (!sec) return [];
  const out: string[] = [];
  const walk = (id: string): void => {
    out.push(id);
    for (const c of ix.children.get(id) ?? []) {
      const w = where.get(c);
      if (w !== undefined && w !== sectionIndex) continue;
      if (w === sectionIndex && sec.nodes.includes(c)) continue; // listed itself; walked from the list
      walk(c);
    }
  };
  for (const id of sec.nodes) if (ix.nodes.has(id)) walk(id);
  return out;
}
