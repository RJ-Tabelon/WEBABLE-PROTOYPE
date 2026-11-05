// Owner: C, D (round 4: page kinds, the news index, the article header). Turns a FitSpec (enums and ids only) plus the
// live page into what the Calm view draws.
// Guarantees enforced here, whatever the spec says:
// - nothing is deleted: every placed part renders open, in place behind a disclosure, or in "More on this page";
//   top-level outline nodes no section placed go to the end drawer too;
// - help stays visible: help links inside folded parts are lifted into an always-open help band;
// - popups that matter (a session about to end) come first as their own card; other alerts follow, one card each;
// - chat widgets never mix into the task: they fold into one "Chat with the site" row;
// - the primary action renders exactly once.
// Round 4 adds the page's kind, read from the page itself whatever layout was picked (design.md §2): an article (kicker ·
// date, title, dek, byline once, lead picture with its caption), a news index (the page's most prominent story with its
// picture, six more as rows with thumbnails, then the page's own sections), a form, a product, a portal or a page.
import {
  type ElementDecision, type ExtractedData, type FineRole, type FitSection, type FitSpec, type PageMeaning, type PageOutline,
  type PagePurpose, PURPOSE_MIN_P, type PurposeTemplate, type SectionLabel, hrefKey, isKickerText, isTimeText, storyScore,
} from '@webable/core';
import { isResultsUrl } from './context';
import { contentRoot, coverContent } from './meaning';
import { type EndPart, Seen, findListen, normText, scrubBlocks, sortEnd } from './tidy';
import {
  type Block, type CardLinkBlock, type ControlBlock, type FlowBlock, type ImageBlock, type Inline, type LinkPart, TOOL_RE,
  CAPTION_SEL, chatContainer, clean, controlFor, flatten, imageFor, isGone, isProgressRail, isRewritten, keepImage, keyOf, nameOf, newCtx,
  pageLeadImage, readBlocks, recordsOf, safeHref, siteName, siteStepText, splitParts, splitSentences, storyFromLink, textOf,
} from './model';

export type Layout = FitSection['layout'];

export interface PlanStep { label: string; blocks: Block[]; synthetic: boolean }

/** One placed element of a section whose elements are not alike (a promo bar, a menu, a product rail). */
export interface PlanPart { key: string; blocks: Block[]; records: Block[][] | null; before: Block[]; after: Block[] }

/** A card for one source element: a popup the page keeps open, an alert, or a cookie question. */
export interface PlanCard { key: string; el: Element; blocks: Block[]; kind: 'popup' | 'alert' | 'consent'; title: string | null }

export interface PlanSection {
  key: string;
  index: number;
  sec: FitSection;
  layout: Layout;
  label: SectionLabel;
  title: string | null;
  titleSize: 'page' | 'section';
  state: 'open' | 'collapsed' | 'end_drawer';
  hoist: boolean;
  /** How a hoisted section is drawn: a warning the page shows (alert, task-relevant popup) or a consent question. */
  notice: 'alert' | 'consent' | null;
  lead: boolean;
  isPrimary: boolean;
  blocks: Block[];
  records: Block[][] | null;
  before: Block[];
  after: Block[];
  parts: PlanPart[] | null;
  steps: PlanStep[] | null;
  count: number;
  showFirst: number; // 0 = all
  /** Hoisted sections: one card per source element. */
  cards: PlanCard[] | null;
}

export interface DrawerPart { key: string; label: string; blocks: Block[]; section: PlanSection | null }

/** The first band: the page's caption, title and its own first sentence; the rest of its intro behind "About this page". */
export interface Lead {
  /** The section the title and intro were taken from. */
  from: string;
  eyebrow: string | null;
  title: string | null;
  titleSize: 'page' | 'section';
  orient: Inline[] | null;
  pinned: Inline[] | null;
  about: Block[];
}

/** How the page's form is shown: all at once (one card per fieldset) or one step at a time. */
export interface FormPlan {
  sectionKey: string;
  mode: 'single' | 'steps';
  questions: number;
  steps: PlanStep[] | null;
  /** The page's own running summary near the action ("1 prescription selected · $4.00"): shown in the dock. */
  context: Element | null;
}

/** A home page or portal: up to five main links as rows; every other link stays in "All links (N)". */
export interface Portal {
  rows: Array<{ key: string; el: Element; text: string; href: string | null; blurb: string | null }>;
  total: number;
}

export type PageKind = 'article' | 'index' | 'form' | 'product' | 'portal' | 'page';

/** One piece of structured content a purpose component draws (round 7), with the part's own links beside it. */
export interface MeaningItem {
  key: string;
  data: ExtractedData;
  /** The part of the page it was read from (left out of the sections: the component shows it). */
  el: Element | null;
  /** The part's links that are not content ("Full box score", a table's row buttons): drawn with the component. */
  links: ControlBlock[];
}

/** What the purpose template draws before the page's own sections (round 7, meaning first). */
export interface MeaningPlan {
  template: PurposeTemplate;
  purpose: PagePurpose | null;
  items: MeaningItem[];
  /** A status lookup's main action ("Use refund tracker"), drawn right under the title as the one filled button. */
  action: ControlBlock | null;
  /** The page's own orientation drawn above that action: its heading and first sentence (and the list it introduces). */
  orient: { title: string | null; blocks: Block[] } | null;
  /** The template draws the page's title itself (a recipe card): no separate title band. */
  hideLead: boolean;
}

/** One of the page's own sections on a news index: its title, its first stories, and the rest behind "More in X (n)". */
export interface IndexSection {
  key: string;
  title: string | null;
  first: CardLinkBlock[];
  rest: CardLinkBlock[];
  /** Everything else the section holds (never dropped: drawn inside "More in X"). */
  other: Block[];
}

/** A news index (design.md §2): the lead story, six top stories, then the page's sections in page order. */
export interface IndexPlan {
  lead: CardLinkBlock | null;
  top: CardLinkBlock[];
  sections: IndexSection[];
  total: number;
}

/** An article's header in the page's own words: kicker · date, the dek, the byline (each name once), the lead picture. */
export interface ArticleHead {
  kicker: string | null;
  date: string | null;
  dek: string | null;
  byline: { prefix: string | null; names: LinkPart[]; text: string } | null;
  lead: ImageBlock | null;
}

export interface CalmPlan {
  siteName: string;
  /** What kind of page this is, from the page itself (sets the Calm view's arrangement). */
  kind: PageKind;
  /** Round 7: the purpose template and the content it draws first (null without Jev's page model or page content). */
  meaning: MeaningPlan | null;
  index: IndexPlan | null;
  article: ArticleHead | null;
  /** Home pages and portals: the main links first. */
  portal: Portal | null;
  strip: Array<{ key: string; blocks: Block[] }>;
  /** The page's help link for the top bar (one). */
  helpLink: ControlBlock | null;
  hoisted: PlanSection[];
  popups: PlanCard[];
  alerts: PlanCard[];
  consents: PlanCard[];
  main: PlanSection[];
  lead: Lead | null;
  form: FormPlan | null;
  drawer: DrawerPart[];
  help: Block[];
  primary: Element | null;
  /** A chat widget the page shows: one row at the end. */
  chat: Element | null;
  /** The site's progress rail for a multi-page flow, and its "Step 2 of 5". */
  progress: { el: Element; blocks: Block[]; stepText: string | null } | null;
  /** Every element the view placed (sections, strip, lifted help, folded parts): new page content inside them shows in place. */
  roots: Element[];
  drawerLabels: string[];
  stats: { sections: number; blocks: number; ms: number; folded: number; lifted: number; leftovers: number };
  /** Round 8b: a page to read (an article, a record, a recipe): the site's chrome is left out of it. */
  reading: boolean;
  /** Round 8b: related stories with real titles, de-duplicated, drawn as "More from {site}" (reading pages). */
  more: CardLinkBlock[];
  /** Round 8b: the site's menu and footer links, de-duplicated, in one closed "Site links (N)" at the very end. */
  siteLinks: ControlBlock[];
  /** Round 8b: the article's own "Listen" control, pressed by "Listen to this article" under the byline. */
  listen: Element | null;
}

export interface PlanInput {
  spec: FitSpec;
  outline: PageOutline;
  elementFor: (id: string) => Element | null;
  decisions: ElementDecision[];
  listFirst: number;
  /** Most questions on one page before the form is shown a step at a time (structure level 2: 5, level 1: 8). */
  stepMax?: number;
  /** Stories per section on a news index before "More in X (n)" (the fit's group size). */
  groupSize?: number;
  /** Round 7: what the page is for, from Jev's page model v2 and the content read on the device. */
  meaning?: PageMeaning | null;
}

const FIELDISH = 'input:not([type=hidden]),select,textarea,[role=checkbox],[role=radio],[role=switch],[role=textbox],[role=combobox]';

function within(root: Element, el: Element): boolean {
  return root === el || root.contains(el);
}

function dedupe(els: Array<Element | null>): Element[] {
  const list = els.filter((e): e is Element => !!e);
  const uniq = Array.from(new Set(list));
  return uniq.filter((e) => !uniq.some((o) => o !== e && o.contains(e)));
}

/** Small strip parts only: a control, or a little group (search form) with few controls and few words. */
function stripWorthy(el: Element): boolean {
  const tag = el.localName;
  if (['a', 'button', 'input', 'select'].includes(tag) || el.getAttribute('role') === 'button') return true;
  const controls = el.querySelectorAll('a[href],button,input:not([type=hidden]),select').length;
  return controls >= 1 && controls <= 3 && textOf(el).length <= 80;
}

function titleSizeOf(el: Element | null, layout: Layout): 'page' | 'section' {
  if (layout === 'hero') return 'page';
  if (!el) return 'section';
  return el.localName === 'h1' || el.getAttribute('aria-level') === '1' ? 'page' : 'section';
}

/* ------------------------------------------------------------------ */
/* Fields and questions                                                */
/* ------------------------------------------------------------------ */

const FIELD_UNITS = new Set(['choices', 'field', 'select']);

export function fieldCount(b: Block): number {
  if (b.b === 'choices') return b.items.length;
  if (b.b === 'field' || b.b === 'select') return 1;
  if (b.b === 'peek') return b.why === 'sensitive' || b.why === 'file' ? 1 : 0;
  if (b.b === 'group') return b.blocks.reduce((a, x) => a + fieldCount(x), 0);
  if (b.b === 'list') return b.items.reduce((a, it) => a + it.reduce((c, x) => c + fieldCount(x), 0), 0);
  if (b.b === 'rtable') return b.rows.reduce((a, r) => a + r.cells.reduce((c, cell) => c + cell.reduce((d, x) => d + fieldCount(x), 0), 0), 0);
  return 0;
}

export function isFieldUnit(b: Block): boolean {
  return FIELD_UNITS.has(b.b) || fieldCount(b) > 0;
}

/**
 * Questions the person answers (GOV.UK counts questions, not inputs): a text field or a menu is one, a set of radios is
 * one, a set of checkboxes inside a fieldset is one ("Which prescriptions?"), a lone checkbox is one.
 */
export function questionCount(blocks: Block[], inGroup = false): number {
  let n = 0;
  for (const b of blocks) {
    if (b.b === 'field' || b.b === 'select') n++;
    else if (b.b === 'peek') n += b.why === 'sensitive' || b.why === 'file' ? 1 : 0;
    else if (b.b === 'choices') n += b.type === 'radio' || inGroup ? 1 : b.items.length;
    else if (b.b === 'choice') n++;
    else if (b.b === 'group') {
      const inner = b.blocks.filter(isFieldUnit);
      n += inner.length && inner.every((x) => x.b === 'choices') ? 1 : questionCount(b.blocks, true);
    } else if (b.b === 'list') n += b.items.reduce((a, it) => a + questionCount(it, inGroup), 0);
    else if (b.b === 'rtable') n += fieldCount(b);
  }
  return n;
}

const CONSENT_FIELD = /\b(certify|agree|accept|confirm that|terms|declare|true to the best)\b/i;

/** A lone "I certify / I agree" checkbox: it belongs with "Check your answers", not in a step of its own. */
function isConsentBox(bs: Block[]): boolean {
  const fs = flatten(bs).filter((b) => b.b === 'choice' || b.b === 'field' || b.b === 'select');
  return fs.length === 1 && fs[0]!.b === 'choice' && CONSENT_FIELD.test((fs[0] as Extract<Block, { b: 'choice' }>).title);
}

function pageWords(b: Block | undefined): string | null {
  if (!b) return null;
  const t = b.b === 'group' ? b.legend : b.b === 'heading' ? b.text : '';
  return t && t.length <= 60 ? t : null;
}

const MAX_STEPS = 6;

/**
 * One step per fieldset, in page order (GOV.UK: one thing per page). Loose fields between fieldsets form a step of
 * their own; headings and short text before a fieldset go with it; a lone consent checkbox and everything after the
 * last field go to the final "Check your answers" step with the page's primary action. At most six steps.
 */
export function buildSteps(blocks: Block[]): PlanStep[] | null {
  const lastField = blocks.reduce((a, b, i) => (isFieldUnit(b) ? i : a), -1);
  if (lastField < 0) return null;
  const body = blocks.slice(0, lastField + 1);
  const trailing = blocks.slice(lastField + 1);

  interface Draft { label: string | null; blocks: Block[]; fields: number }
  const drafts: Draft[] = [];
  let pending: Block[] = [];
  let loose: Draft | null = null;
  for (const b of body) {
    if (!isFieldUnit(b)) {
      if (b.b === 'heading') loose = null;
      pending.push(b);
      continue;
    }
    if (b.b === 'group') {
      const head = pending.find((x) => x.b === 'heading');
      drafts.push({ label: pageWords(b) ?? pageWords(head), blocks: [...pending, b], fields: fieldCount(b) });
      pending = [];
      loose = null;
      continue;
    }
    if (!loose) {
      loose = { label: pageWords(pending.find((x) => x.b === 'heading')), blocks: [], fields: 0 };
      drafts.push(loose);
    }
    loose.blocks.push(...pending, b);
    loose.fields += fieldCount(b);
    pending = [];
  }
  const tail: Block[] = [...pending];
  // A consent checkbox at the end joins "Check your answers".
  while (drafts.length > 1 && isConsentBox(drafts[drafts.length - 1]!.blocks)) tail.unshift(...drafts.pop()!.blocks);
  // Too many steps: merge the smallest neighbours.
  while (drafts.length > MAX_STEPS) {
    let best = 0;
    let size = Infinity;
    for (let i = 0; i < drafts.length - 1; i++) {
      const n = drafts[i]!.fields + drafts[i + 1]!.fields;
      if (n < size) {
        size = n;
        best = i;
      }
    }
    const a = drafts[best]!;
    const b = drafts[best + 1]!;
    drafts.splice(best, 2, { label: a.label ?? b.label, blocks: [...a.blocks, ...b.blocks], fields: a.fields + b.fields });
  }
  if (drafts.length < 2) return null;
  const used = new Set<string>();
  const steps: PlanStep[] = drafts.map((d, i) => {
    let label = d.label ?? (d.blocks.some((b) => flatten([b]).some((x) => x.b === 'choice')) ? 'Choose' : 'Your details');
    if (used.has(label)) label = `${label} (${i + 1})`;
    used.add(label);
    return { label, blocks: d.blocks, synthetic: false };
  });
  steps.push({ label: 'Check your answers', blocks: [...tail, ...trailing], synthetic: true });
  return steps;
}

/* ------------------------------------------------------------------ */
/* The first band                                                      */
/* ------------------------------------------------------------------ */

const PIN_RE = /(\$\d|\d+\s?(hour|day|week|month)s?\b|deadline|\bmust\b|required|warning|expire|\bby [A-Z][a-z]+ \d)/i;
const STEP_RE = /\bstep\s+\d+\s+of\s+\d+\b/i;
const MAX_ORIENT = 140;

function inlineText(parts: Inline[]): string {
  return parts.map((p) => (p.t === 'text' ? p.text : p.t === 'link' ? p.text : ' ')).join('').replace(/\s+/g, ' ').trim();
}

function flowOf(parts: Inline[], src: Node, key: string): FlowBlock {
  return { b: 'flow', parts, text: inlineText(parts), help: false, key, src };
}

function isCaption(f: FlowBlock): boolean {
  return f.text.length <= 70 && !/[.!?:]$/.test(f.text) && !f.parts.some((p) => p.t === 'link');
}

/**
 * Take the page's title, caption and intro from the start of a section. Only the page's own words are used: the first
 * sentence (when short) orients; one more sentence stays when it carries a time, money, a deadline or a rule; the rest
 * waits behind "About this page".
 */
const GENERIC_TITLE = /^(home|homepage|home page|welcome|official site|official website|index|main|untitled|default)$/i;

/**
 * A title band from the document title when the page has no heading to lead with: its own part ("Pay your bill |
 * FPL" → "Pay your bill"); on a home page whose title is only the site's name ("WCJB | TV20", "FPL | Homepage"),
 * that name ("WCJB TV20", "FPL"). Never words of our own.
 */
function titleLead(): Lead | null {
  const brand = siteName().toLowerCase();
  const host = location.hostname.replace(/^www\./, '').toLowerCase();
  const brandish = (t: string): boolean => {
    const l = t.toLowerCase();
    const flat = l.replace(/[^a-z0-9]+/g, '');
    return l === brand || l === host || (flat.length >= 2 && host.replace(/[^a-z0-9]+/g, '').startsWith(flat)) || /^(tv|channel|radio)\s?\d+$/i.test(t);
  };
  const og = clean(document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content);
  let fallback: string | null = null;
  for (const raw of [clean(document.title), og]) {
    const parts = raw.split(/\s*[|–—·•]\s*|\s+-\s+/).map(clean).filter((t) => t.length >= 2 && !GENERIC_TITLE.test(t));
    const own = parts.find((t) => t.length >= 3 && t.length <= 70 && !brandish(t));
    if (own) return { from: '', eyebrow: null, title: own, titleSize: 'page', orient: null, pinned: null, about: [] };
    if (!fallback && parts.length) fallback = parts.join(' ').slice(0, 60);
  }
  const name = fallback ?? siteName();
  return name && name !== 'This page' ? { from: '', eyebrow: null, title: name, titleSize: 'page', orient: null, pinned: null, about: [] } : null;
}

function takeLead(p: PlanSection, article: boolean, protectedEls: Set<Element>): Lead | null {
  let title = p.title;
  let titleSize = p.titleSize;
  const bs = p.blocks;
  let i = 0;
  const before: FlowBlock[] = [];
  const intro: FlowBlock[] = [];
  let eyebrow: string | null = null;
  // Caption and title.
  if (!title) {
    let j = 0;
    while (j < bs.length && bs[j]!.b === 'flow' && j < 2) j++;
    const h = bs[j];
    if (h?.b === 'heading' && (h.level <= 2 || j === 0)) {
      for (let k = 0; k < j; k++) before.push(bs[k] as FlowBlock);
      title = h.text;
      titleSize = h.level <= 1 ? 'page' : 'section';
      i = j + 1;
    }
  }
  if (!title) return null;
  for (const f of before) {
    if (!eyebrow && isCaption(f) && !STEP_RE.test(f.text)) eyebrow = f.text;
    else intro.push(f);
  }
  // Intro paragraphs right after the title (never past a field, a list or a control).
  // A paragraph rewritten for the person stays whole in the body (it is never split into the orientation line).
  while (i < bs.length && bs[i]!.b === 'flow' && !isRewritten(bs[i]!) && intro.length < 4) {
    const f = bs[i] as FlowBlock;
    i++;
    if (STEP_RE.test(f.text) && f.text.length <= 80) continue; // "Step 2 of 5": shown with the site's progress
    intro.push(f);
  }
  p.blocks = bs.slice(i);
  p.title = null;
  if (titleSize === 'page' && title.length > 56) titleSize = 'section';
  if (article) {
    // Articles keep their words in the reading sheet; only the title moves up.
    p.blocks = [...intro, ...p.blocks];
    return { from: p.key, eyebrow, title, titleSize, orient: null, pinned: null, about: [] };
  }
  // Sentences in order, with whether their paragraph is protected (help, safety text, Jev's "keep in view").
  const sents: Array<{ s: Inline[]; t: string; f: FlowBlock; first: boolean; keep: boolean }> = [];
  intro.forEach((f, fi) => {
    const srcEl = f.src instanceof Element ? f.src : f.src.parentElement;
    const keep = !!srcEl && (protectedEls.has(srcEl) || (!!srcEl.parentElement && protectedEls.has(srcEl.parentElement)));
    splitParts(f.parts, 1).forEach((s, si) => {
      const t = inlineText(s);
      if (t) sents.push({ s, t, f, first: fi === 0 && si === 0, keep });
    });
  });
  const orientAt = sents[0]?.first && sents[0].t.length <= MAX_ORIENT ? 0 : -1;
  // "Fields marked with * are required": the view says "(required)" itself and shows no asterisks.
  const pinnable = (x: { t: string }): boolean => x.t.length <= 220 && !/marked with|\*/i.test(x.t);
  // A sentence the page marks as a status or warning stays too (Jev's "keep in view" covers whole intros, so it is not enough).
  let pinAt = sents.findIndex((x, i) => i !== orientAt && pinnable(x) && PIN_RE.test(x.t));
  if (pinAt < 0) pinAt = sents.findIndex((x, i) => i !== orientAt && pinnable(x) && x.keep && !!(x.f.src instanceof Element ? x.f.src : x.f.src.parentElement)?.closest('[role=alert],[role=status],[class*="warning" i],[class*="important" i]'));
  // Help links stay in view: a sentence that carries one is never folded behind "About this page".
  const helpAt = new Set(sents.map((x, i) => (x.s.some((part) => part.t === 'link' && part.help) ? i : -1)).filter((i) => i >= 0 && i !== orientAt));
  let pinParts: Inline[] | null = pinAt >= 0 ? sents[pinAt]!.s : null;
  for (const i of helpAt) {
    if (i === pinAt) continue;
    pinParts = pinParts ? [...pinParts, { t: 'text', text: ' ' }, ...sents[i]!.s] : sents[i]!.s;
  }
  const about: FlowBlock[] = [];
  sents.forEach((x, i) => {
    if (i === orientAt || i === pinAt || helpAt.has(i)) return;
    const last = about[about.length - 1];
    if (last && last.key === `${x.f.key}a`) {
      last.parts = [...last.parts, { t: 'text', text: ' ' }, ...x.s];
      last.text = inlineText(last.parts);
    } else about.push(flowOf(x.s, x.f.src, `${x.f.key}a`));
  });
  return { from: p.key, eyebrow, title, titleSize, orient: orientAt >= 0 ? sents[orientAt]!.s : null, pinned: pinParts, about };
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

const HELP_LINK_RE = /^(help|get help|help center|help & support|contact( us)?|support|customer (service|support)|call us|need help\??)$/i;

export function buildPlan(o: PlanInput): CalmPlan {
  const t0 = performance.now();
  const el = (id: string | null | undefined): Element | null => {
    if (!id) return null;
    try {
      const e = o.elementFor(id);
      return e && e.isConnected ? e : null;
    } catch {
      return null;
    }
  };
  const ids = new Set(o.outline.nodes.map((n) => n.id));
  const primary = el(o.spec.primary_action);

  // Help and protected parts, from the outline and Jev's decisions.
  const help = new Set<Element>();
  const protectedEls = new Set<Element>();
  for (const n of o.outline.nodes) {
    const e = el(n.id);
    if (!e) continue;
    if (n.jevRole === 'help_contact') help.add(e);
    if (n.protected) protectedEls.add(e);
  }
  for (const d of o.decisions) {
    const e = el(d.id);
    if (!e) continue;
    if (d.verdict === 'protect') protectedEls.add(e);
    if (d.verdict === 'protect' && d.judgment.role === 'help_contact') help.add(e);
  }

  // Chat widgets and the site's progress rail are drawn on their own; nothing else reads them.
  const placed = new Map<Element, string>();
  // Only floating parts can be chat widgets: the reader zones them as overlays (or marks them as dialogs).
  const chats = dedupe(o.outline.nodes.map((n) => {
    if (!(n.zone ?? '').startsWith('overlay') && n.landmark !== 'dialog') return null;
    const e = el(n.id);
    return e ? chatContainer(e) : null;
  }));
  for (const c of chats) placed.set(c, 'chat');
  const inChat = (e: Element): boolean => chats.some((c) => within(c, e));
  let progressEl: Element | null = null;
  for (const n of o.outline.nodes) {
    const e = el(n.id);
    if (!e || inChat(e) || !isProgressRail(e) || isGone(e)) continue;
    progressEl = e;
    break;
  }
  if (progressEl) placed.set(progressEl, 'progress');
  const special = (e: Element): boolean => inChat(e) || (!!progressEl && within(progressEl, e));

  // Round 7, meaning first: the content a purpose component draws (a scoreboard, the record, a table, a recipe) was read
  // from the page itself; the page elements that hold only that content are left out of the sections (the component
  // shows them) and the part's own links ("Full box score") go with the component. Everything else stays in place.
  const m = o.meaning ?? null;
  const tpl: PurposeTemplate | null = m?.template ?? null;
  const meaningEls: Element[] = [];
  const pending: Array<{ key: string; data: ExtractedData; el: Element | null; links: Element[] }> = [];
  if (m) {
    for (const d of m.data) {
      const start = el(d.id);
      if (!start || special(start)) continue;
      let root = start;
      let cov: { covered: Element[]; links: Element[] } = { covered: [], links: [] };
      try {
        root = contentRoot(start, d.data);
        cov = coverContent(root, d.data);
      } catch {
        /* the component still draws it; the page part also stays in its section */
      }
      for (const c of cov.covered) {
        if (special(c) || (primary && within(c, primary)) || placed.has(c)) continue;
        placed.set(c, 'meaning');
        meaningEls.push(c);
      }
      const links = cov.links.filter((l) => !placed.has(l) && !special(l) && l !== primary);
      for (const l of links) placed.set(l, 'meaning');
      pending.push({ key: keyOf(root, `m${pending.length}`), data: d.data, el: root, links });
    }
  }
  const inMeaning = (e: Element): boolean => meaningEls.some((c) => within(c, e));
  const readingTemplate = tpl === 'record_stats' || tpl === 'recipe' || tpl === 'article' || tpl === 'news_index' || tpl === 'status_lookup';
  // A status lookup ("Where's my refund?") leads with its main action, right under the title.
  let actionEl: Element | null = m && tpl === 'status_lookup' ? statusAction(m, o, el) : null;
  if (actionEl && (special(actionEl) || inMeaning(actionEl) || placed.has(actionEl))) actionEl = null;
  if (actionEl) placed.set(actionEl, 'meaning');

  // Placement: strip first, then sections in order; an element renders in exactly one place.
  const stripRoots = dedupe(o.spec.strip.map(el)).filter((e) => !special(e) && !inMeaning(e) && stripWorthy(e)).slice(0, 6);
  for (const e of stripRoots) placed.set(e, 'strip');
  const secs = o.spec.sections.map((sec, i) => {
    const hEl = el(sec.heading_ref);
    return { sec, i, hEl, roots: dedupe(sec.nodes.map(el)).filter((r) => r !== hEl && !special(r) && !inMeaning(r) && r !== actionEl) };
  });
  // On a results page the results are the page (Jev may call them recommendations): a "related" part inside another
  // part stays there in page order (title, address, snippet together), and any other one opens in place.
  const resultsPage = o.spec.page_type === 'search_results' || isResultsUrl();
  if (resultsPage) {
    // A result's title link and its snippet split across parts come back together: the link's part takes the
    // result's own box (the largest ancestor holding no other result), with the snippet the other part had in it.
    const rel = secs.filter((s) => s.sec.role === 'related');
    const relRoots = rel.flatMap((s) => s.roots);
    const others = secs.filter((s) => s.sec.role !== 'related');
    for (const s of rel) {
      s.roots = s.roots.map((r) => {
        let box: Element = r;
        for (let x = r.parentElement, n = 0; x && n < 5 && x !== document.body; x = x.parentElement, n++) {
          if (relRoots.some((q) => q !== r && x.contains(q))) break;
          if (x.querySelector(FIELDISH) || others.some((o) => o.hEl && x.contains(o.hEl))) break;
          box = x;
        }
        if (box === r) return r;
        for (const o of others) o.roots = o.roots.filter((q) => !box.contains(q));
        return box;
      });
    }
    const hosts = secs.filter((s) => !['related', 'navigation', 'ads', 'promo', 'legal'].includes(s.sec.role)).flatMap((s) => s.roots);
    for (const s of secs) if (s.sec.role === 'related') s.roots = s.roots.filter((r) => !hosts.some((h) => h !== r && h.contains(r)));
  }
  for (const s of secs) for (const r of s.roots) if (!placed.has(r)) placed.set(r, `s${s.i}`);
  for (const s of secs) s.roots = s.roots.filter((r) => placed.get(r) === `s${s.i}`);

  // The form owns its primary action (it renders in the last step, or in the dock).
  const stepFieldEls = o.spec.form_steps.flatMap((st) => st.fields.map(el)).filter((x): x is Element => !!x);
  const formSec =
    secs.find((s) => s.sec.layout === 'form_steps' && s.roots.length) ??
    (stepFieldEls.length ? secs.find((s) => s.roots.some((r) => stepFieldEls.some((f) => within(r, f)))) : undefined) ??
    (primary ? secs.find((s) => s.sec.role === 'primary' && s.roots.some((r) => r.matches(FIELDISH) || !!r.querySelector(FIELDISH))) : undefined);
  if (primary && formSec && placed.get(primary) !== `s${formSec.i}`) {
    const owner = placed.get(primary);
    if (owner && owner !== 'strip') {
      placed.delete(primary);
      for (const s of secs) s.roots = s.roots.filter((r) => r !== primary);
    }
  }

  // Popups that affect the task (Jev keep_popup, e.g. a session-timeout warning) are shown first, like alerts: only
  // while they show (Allrecipes keeps its "Ingredients" panel closed until its button is tapped).
  const keepPopups = o.decisions
    .filter((d) => d.verdict === 'keep_popup')
    .map((d) => el(d.id))
    .filter((x): x is Element => !!x && !isGone(x));
  // A part is the popup when it sits inside it, or holds little more than it: never a whole recipe or story that
  // happens to contain one somewhere.
  const isPopupPart = (r: Element, k: Element): boolean =>
    within(k, r) || (within(r, k) && textOf(r).length <= 1.5 * textOf(k).length + 40);

  // Effective state.
  const eff = secs.map((s) => {
    const role = s.sec.role;
    const popupAlert = s.roots.some((r) => keepPopups.some((k) => isPopupPart(r, k)));
    const notice: 'alert' | 'consent' | null = role === 'alert' || popupAlert ? 'alert' : role === 'consent' ? 'consent' : null;
    const hoist = notice !== null;
    let state = s.sec.state;
    if (hoist || role === 'help' || role === 'primary' || s === formSec) state = 'open';
    if (primary && s.roots.some((r) => within(r, primary))) state = 'open';
    if (resultsPage && role === 'related') state = 'open';
    return { hoist, notice, state };
  });

  // Folded parts keep protected things visible: lift help, open sections holding fields, notices or safety text.
  let lifted = 0;
  const liftedEls: Element[] = [];
  secs.forEach((s, i) => {
    const e = eff[i]!;
    if (e.state === 'open') return;
    for (const r of s.roots) {
      if (help.has(r)) {
        e.state = 'open';
        return;
      }
      for (const p of protectedEls) {
        if (!within(r, p) || help.has(p)) continue;
        // On a page that is for reading or looking something up (a record, a recipe, an article), a filled filter in a
        // rail of other content does not pull that rail open; notices still do.
        const field = p.matches(FIELDISH) || !!p.querySelector(FIELDISH);
        if (field && readingTemplate && e.state === 'end_drawer') continue;
        if (field || p.matches('[role=alert],[role=status],[aria-live]')) {
          e.state = 'open';
          return;
        }
      }
    }
    for (const r of s.roots) {
      const cands = Array.from(help).filter((h) => h !== r && r.contains(h));
      r.querySelectorAll('a[href^="tel:"],a[href^="mailto:"]').forEach((a) => cands.push(a));
      for (const h of cands) {
        if (placed.has(h) || liftedEls.some((x) => within(x, h)) || special(h)) continue;
        placed.set(h, 'help');
        liftedEls.push(h);
        lifted++;
      }
    }
  });

  // Jev-folded distractions inside open parts move to the end drawer (never protected, help or the primary action).
  const folded = new Set<Element>();
  const foldLabel = new Map<Element, SectionLabel>();
  const placedRoots = Array.from(placed.keys());
  const consider = (e: Element, label: SectionLabel): void => {
    if (placed.has(e) || folded.has(e) || special(e)) return;
    if (primary && within(e, primary)) return;
    for (const p of protectedEls) if (within(e, p)) return;
    for (const h of help) if (within(e, h)) return;
    for (const r of placedRoots) if (e.contains(r)) return;
    if (e.matches(FIELDISH) || e.querySelector('input:not([type=hidden]),select,textarea')) return;
    folded.add(e);
    foldLabel.set(e, label);
  };
  for (const d of o.decisions) {
    if (d.verdict !== 'fold') continue;
    const e = el(d.id);
    if (e) consider(e, d.judgment.role === 'advertising' ? 'Sponsored' : 'Offers');
  }
  // On a results page links Jev calls recommendations stay in place too (ads still fold).
  for (const n of o.outline.nodes) {
    if (n.protected || (n.jevRole !== 'advertising' && n.jevRole !== 'recommendations')) continue;
    if (resultsPage && n.jevRole === 'recommendations') continue;
    const e = el(n.id);
    if (e) consider(e, n.jevRole === 'advertising' ? 'Sponsored' : 'Related items');
  }
  // Round 7: parts Jev's page model calls a teaser for other content, an ad, an upsell or a newsletter box go to the end
  // drawer even when Jev's older "keep in view" covers them (only help, fields, alerts and the main action stay).
  if (m) {
    for (const id of [...m.drawer, ...m.chrome]) {
      const e = el(id);
      if (!e || placed.has(e) || folded.has(e) || special(e) || inMeaning(e)) continue;
      if (primary && within(e, primary)) continue;
      if (Array.from(help).some((h) => within(e, h))) continue;
      if (placedRoots.some((r) => e.contains(r))) continue;
      if (e.matches(FIELDISH) || e.querySelector('input:not([type=hidden]),select,textarea,[role=alert]')) continue;
      folded.add(e);
      foldLabel.set(e, drawerLabelOf(m.fine[id]));
    }
  }

  // Logos that identify something on the page (a team's mark next to its name) are content, not the site's chrome.
  const keepLogos = new Set<Element>();
  if (m) for (const id of m.logos) {
    const e = el(id);
    if (e) keepLogos.add(e);
  }
  const ctx = newCtx({ placed, primary, help, folded, keepLogos });
  const items: MeaningItem[] = pending.map((x) => ({
    key: x.key, data: x.data, el: x.el,
    // Round 8b: each address once, and never a placeholder label ("Links", "Related card") or a share button.
    links: scrubBlocks(x.links.map((l) => controlFor(l, ctx)).filter((b): b is ControlBlock => !!b && !!b.text), { reading: true })
      .filter((b): b is ControlBlock => b.b === 'control'),
  }));
  let action: ControlBlock | null = null;
  if (actionEl) {
    action = controlFor(actionEl, ctx);
    if (action) {
      action.primary = false;
      if (actionEl === primary) ctx.primarySeen = true;
    }
  }
  const read = (key: string, roots: Element[], foldOn: boolean): Block[] => {
    ctx.current = key;
    const keep = ctx.folded;
    if (!foldOn) ctx.folded = new Set();
    const out = roots.flatMap((r) => readBlocks(r, ctx));
    ctx.folded = keep;
    return out;
  };
  for (const s of secs) if (s.hEl) ctx.skip.add(s.hEl);

  // An article's byline, date and dek are read once, into its header: the body never repeats them.
  // Jev's page purpose decides when it is sure: a record, a recipe or a status check is never drawn as an article.
  const notArticle = tpl === 'record_stats' || tpl === 'recipe' || tpl === 'status_lookup' || tpl === 'form_task' || tpl === 'search_results';
  const articleish = !formSec && !notArticle && o.spec.page_type !== 'product_detail' && (tpl === 'article' || o.spec.page_type === 'article' || o.spec.task === 'read' || articleLike());
  const artDom = articleish ? articleDom() : null;
  if (artDom) for (const e of artDom.skip) {
    ctx.skip.add(e);
    ctx.elsewhere.add(e);
  }

  // Read sections (open ones first, so Jev folds inside them are collected before the drawer is built).
  const order = secs.map((_, i) => i).sort((a, b) => Number(eff[a]!.state !== 'open') - Number(eff[b]!.state !== 'open') || a - b);
  const built = new Map<number, PlanSection>();
  for (const i of order) {
    const s = secs[i]!;
    const e = eff[i]!;
    const key = `s${i}`;
    const foldOn = e.state === 'open' && !['promo', 'ads', 'related', 'consent'].includes(s.sec.role);
    let title: string | null = s.hEl ? textOf(s.hEl) || null : null;
    let titleEl: Element | null = s.hEl;
    let blocks: Block[] = [];
    let records: Block[][] | null = null;
    let before: Block[] = [];
    let afterB: Block[] = [];
    const layout = s.sec.layout;
    let parts: PlanPart[] | null = null;
    let cards: PlanCard[] | null = null;
    if (e.hoist) {
      // One card per source element; hidden or empty ones are skipped (a validation slot with nothing in it).
      cards = [];
      for (const r of s.roots) {
        if (isGone(r) || !textOf(r)) continue;
        const bs = read(key, [r], false);
        if (!bs.length) continue;
        const popup =
          keepPopups.some((k) => within(r, k) || within(k, r)) || r.matches('[role=alertdialog],[aria-modal=true],dialog[open]') ||
          !!r.querySelector('[role=alertdialog],[aria-modal=true]');
        const heading = flatten(bs).find((b): b is Extract<Block, { b: 'heading' }> => b.b === 'heading');
        const label = r.getAttribute('aria-label');
        cards.push({
          key: keyOf(r, 'c'), el: r, blocks: bs, kind: e.notice === 'consent' ? 'consent' : popup ? 'popup' : 'alert',
          title: heading?.text ?? (label && label.length <= 60 ? label : null),
        });
      }
    } else if ((layout === 'card_grid' || layout === 'row_list' || layout === 'facts') && s.roots.length) {
      const split = recordsOf(s.roots);
      if (split.heading && !title) {
        title = textOf(split.heading) || null;
        titleEl = split.heading;
        ctx.skip.add(split.heading);
      }
      if (split.uniform) {
        const recs = split.records.map((r) => read(key, [r], foldOn)).filter((b) => b.length);
        if (recs.length >= 2 || (recs.length === 1 && s.roots.length === 1 && split.records[0] !== s.roots[0])) {
          records = recs;
          const head = split.heading && split.heading !== titleEl ? [split.heading] : [];
          before = read(key, [...head, ...split.before], foldOn);
          afterB = read(key, split.after, foldOn);
        } else {
          blocks = recs.flat();
        }
      } else if (s.roots.length >= 2) {
        // Unlike parts: each keeps its own shape; a part that is itself a list of alike records stays a collection.
        parts = s.roots
          .map((r): PlanPart => {
            const sp = recordsOf([r]);
            if (sp.uniform && sp.records.length >= 3) {
              const recs = sp.records.map((x) => read(key, [x], foldOn)).filter((b) => b.length);
              return {
                key: keyOf(r, 'p'), blocks: [], records: recs,
                before: read(key, [...(sp.heading ? [sp.heading] : []), ...sp.before], foldOn), after: read(key, sp.after, foldOn),
              };
            }
            return { key: keyOf(r, 'p'), blocks: read(key, [r], foldOn), records: null, before: [], after: [] };
          })
          .filter((pt) => pt.blocks.length || pt.records?.length || pt.before.length || pt.after.length);
      } else {
        blocks = read(key, s.roots, foldOn);
      }
    } else {
      blocks = read(key, s.roots, foldOn);
    }
    if (!title && !records && !cards && blocks[0]?.b === 'heading') {
      const h = blocks.shift() as Extract<Block, { b: 'heading' }>;
      title = h.text;
      titleEl = h.el;
    }
    const count = records ? records.length : parts ? parts.length : flatten(blocks).filter((b) => b.b === 'control' || b.b === 'cardlink').length;
    built.set(i, {
      key, index: i, sec: s.sec, layout, label: s.sec.label, title, titleSize: titleSizeOf(titleEl, layout),
      state: e.state, hoist: e.hoist, notice: e.notice, lead: s.sec.emphasis === 'lead' || s.sec.role === 'primary' || s === formSec,
      isPrimary: s.sec.role === 'primary' || (!!primary && s.roots.some((r) => within(r, primary))) || s === formSec,
      blocks, records, before, after: afterB, parts, steps: null, count, cards,
      showFirst: s.sec.show_first || (records && records.length > o.listFirst ? o.listFirst : 0),
    });
  }

  // The primary action renders exactly once: if no section reached it, add it to the form or the primary part.
  if (primary && !ctx.primarySeen) {
    const b = controlFor(primary, ctx);
    if (b) {
      b.primary = true;
      const host =
        (formSec && built.get(formSec.i)) ??
        Array.from(built.values()).find((p) => p.sec.role === 'primary') ??
        Array.from(built.values()).find((p) => p.state === 'open' && !p.hoist);
      if (host?.records) host.after.push(b);
      else if (host) host.blocks.push(b);
    }
  }

  const sections = secs
    .map((s) => built.get(s.i)!)
    .filter((p) => (p.cards ? p.cards.length > 0 : !!(p.blocks.length || p.records?.length || p.parts?.length || p.before.length || p.after.length)));
  const main = sections.filter((p) => !p.hoist && p.state !== 'end_drawer');

  // The first band: title, caption and intro of the first open part that has the page's title (else the task's part).
  const article = articleish || o.spec.page_type === 'article' || o.spec.task === 'read';
  // Only the page's own title (an h1) leads; without one, a form or main part may lead with its own heading.
  const leadSec =
    main.find((p) => p.state === 'open' && !p.cards && (p.titleSize === 'page' || p.blocks.slice(0, 3).some((b) => b.b === 'heading' && b.level <= 1))) ??
    main.find((p) => p.isPrimary && p.state === 'open' && (p.sec === formSec?.sec || o.spec.page_type === 'form' || o.spec.page_type === 'product_detail')) ?? null;
  // No heading to lead with (a news or utility home page): the page's own title, without the site's name.
  const lead = (leadSec ? takeLead(leadSec, article || leadSec.layout === 'reading', protectedEls) : null) ?? titleLead();

  // A status lookup: the part that holds the main action gives its heading and first sentence (with the list it
  // introduces) as the orientation drawn above the action ("Where's my refund? Your refund status is available: ...").
  let orient: MeaningPlan['orient'] = null;
  if (action && actionEl) {
    const host = main.find((p) => p.state === 'open' && !p.cards && (secs[p.index]?.roots ?? []).some((r) => within(r, actionEl!)));
    if (host && host.key !== lead?.from) {
      const bs = host.blocks;
      const take: Block[] = [];
      let i = 0;
      while (i < bs.length && take.length < 2) {
        const b = bs[i]!;
        if (b.b !== 'flow' || b.text.length > 240) break;
        take.push(b);
        i++;
        if (/:\s*$/.test(b.text) && bs[i]?.b === 'list') {
          take.push(bs[i]!);
          i++;
          break;
        }
      }
      if (take.length) {
        orient = { title: host.title, blocks: take };
        host.blocks = bs.slice(i);
        host.title = null;
      }
    }
  }

  // The form: all at once when it is short (or already one page of a site's own steps), else one step at a time.
  let form: FormPlan | null = null;
  const formBuilt = formSec ? built.get(formSec.i) : undefined;
  if (formBuilt && sections.includes(formBuilt)) {
    const all = allBlocks(formBuilt);
    const questions = questionCount(all);
    const stepMax = o.stepMax ?? 5;
    const siteFlow = !!progressEl || !!siteStepText();
    const single = questions <= stepMax || (siteFlow && questions <= 2 * stepMax) || o.spec.page_type === 'product_detail';
    const steps = single ? null : buildSteps(formBuilt.blocks);
    formBuilt.steps = steps;
    form = { sectionKey: formBuilt.key, mode: steps ? 'steps' : 'single', questions, steps, context: dockContext(all) };
  }

  // The dock carries the page's main action only when it is an action: a button, or a short link on a task page
  // (a long headline Jev picked on a news page is not dressed up as a big blue button).
  let primaryOut = primary;
  if (primary) {
    const label = nameOf(primary);
    const button = primary.matches('button,input[type=submit],input[type=button],input[type=image],[role=button]');
    const words = label.split(/\s+/).filter(Boolean).length;
    const taskPage = !!form || ['buy', 'book', 'pay', 'sign_in', 'fill_form', 'contact'].includes(o.spec.task) || o.spec.page_type === 'product_detail';
    const dock = label.length <= 48 && words <= 7 && (button || taskPage) && o.spec.page_type !== 'article' && !action;
    if (!dock) {
      primaryOut = null;
      for (const p of sections) for (const b of flatten(allBlocks(p))) if (b.b === 'control' && b.primary) b.primary = false;
    }
  }

  // One page-size title in the column (the lead's); everything else is section size.
  for (const p of sections) if (p.titleSize === 'page' && (lead?.titleSize === 'page' || (p.title?.length ?? 0) > 56)) p.titleSize = 'section';

  const strip = stripRoots.map((r) => ({ key: keyOf(r, 'strip'), blocks: read('strip', [r], false) })).filter((x) => x.blocks.length);
  const helpBlocks = liftedEls.length ? read('help', liftedEls, false) : [];

  // The page's help link for the top bar: from the strip, the lifted help or a help section.
  const helpCands: ControlBlock[] = [
    ...strip.flatMap((s) => flatten(s.blocks)),
    ...flatten(helpBlocks),
    ...sections.filter((p) => p.sec.role === 'help').flatMap((p) => flatten(allBlocks(p))),
  ].filter((b): b is ControlBlock => b.b === 'control' && b.help && !special(b.el));
  const helpLink = helpCands.find((c) => HELP_LINK_RE.test(c.text.trim())) ?? helpCands.find((c) => c.text.length <= 28) ?? null;

  // Drawer: end_drawer sections, Jev-folded parts, then anything no section placed.
  let drawer: DrawerPart[] = sections
    .filter((p) => p.state === 'end_drawer')
    .map((p) => ({ key: p.key, label: p.title ?? p.label, blocks: [], section: p }));
  const hitsByLabel = new Map<SectionLabel, Element[]>();
  for (const h of Array.from(new Set(ctx.foldedHits))) {
    const label = foldLabel.get(h) ?? 'Offers';
    const g = hitsByLabel.get(label);
    if (g) g.push(h);
    else hitsByLabel.set(label, [h]);
  }
  let foldedCount = 0;
  for (const [label, els] of hitsByLabel) {
    const blocks = read(`fold-${label}`, els, false);
    foldedCount += els.length;
    if (blocks.length) drawer.push({ key: `fold-${label}`, label, blocks, section: null });
  }
  const allPlaced = [...Array.from(placed.keys()), ...Array.from(folded)];
  const leftoverEls = o.outline.nodes
    .filter((n) => !n.parent || !ids.has(n.parent))
    .map((n) => el(n.id))
    .filter((e): e is Element => !!e && !e.closest('webable-ui'))
    .filter((e) => !allPlaced.some((r) => within(r, e)) && !allPlaced.some((r) => e.contains(r)));
  const leftovers = leftoverEls.length ? read('left', dedupe(leftoverEls), false) : [];
  if (leftovers.length) drawer.push({ key: 'left', label: 'More on this page', blocks: leftovers, section: null });

  // The page's kind, read from the page itself whatever layout was picked.
  const promoted = o.decisions.filter((d) => d.verdict === 'promote').map((d) => el(d.id)).filter((x): x is Element => !!x);
  let kind: PageKind = form ? 'form' : o.spec.page_type === 'product_detail' ? 'product' : articleish ? 'article' : 'page';
  let index: IndexPlan | null = null;
  // A news index or a portal is drawn only when the page is one: Jev's purpose says so, or it has none to give. A
  // record page with a "Related news" rail is not a news page (round 7: the Gators opponent history).
  const sure = m && m.purpose && m.purposeP >= PURPOSE_MIN_P ? m.purpose : null;
  const allowIndex = !m || tpl === 'news_index' || (tpl === 'page' && (!sure || sure === 'home_portal' || sure === 'other'));
  if (kind === 'page' && allowIndex && o.spec.page_type !== 'form' && o.spec.page_type !== 'docs') {
    index = indexOf(main, promoted, o.groupSize ?? 4);
    if (index) {
      kind = 'index';
      // Words in an untitled part (a sign-in link, a promo line) stay reachable in "More on this page".
      for (const sec of index.sections) {
        if (sec.title || !sec.other.length) continue;
        drawer.push({ key: `idx-${sec.key}`, label: 'More on this page', blocks: sec.other, section: null });
        sec.other = [];
      }
    }
  }
  let articleHead: ArticleHead | null = null;
  if (kind === 'article') {
    articleHead = articleHeadOf(artDom, lead, main);
    // Share, save, print and listen: in "More on this page", not between the title and the story.
    const tools = main.flatMap((p) => pluck(p, (b) => b.b === 'control' && !b.primary && TOOL_RE.test(b.text.trim())));
    // The site's menu the outline did not mark as one (a cloud of short links after the story): folded too.
    const clouds = main.flatMap((p) => [...pluck(p, isLinkCloud), ...pluckLinkRuns(p, 6)]);
    if (clouds.length) drawer.push({ key: 'clouds', label: 'Site links', blocks: clouds, section: null });
    // A part left with nothing to show (it held only a menu) is not drawn as an empty band.
    for (let i = main.length - 1; i >= 0; i--) {
      const p = main[i]!;
      if (!p.isPrimary && p.key !== form?.sectionKey && !p.cards && !allBlocks(p).length) main.splice(i, 1);
    }
    if (tools.length) drawer.push({ key: 'tools', label: 'Share and save', blocks: tools, section: null });
  }

  // Round 8b (SIMPLIFIED.md): the site's chrome never shows as content. On a page to read (an article, a record, a
  // recipe) menus and link clouds, share and follow bars, account and app links, ads and newsletter boxes leave the
  // page; related stories become "More from {site}" and the menu and footer links one closed "Site links (N)".
  // Machine labels and placeholders are never shown, on any page (rules 1–3).
  const reading = kind === 'article' || (kind !== 'index' && kind !== 'form' && kind !== 'product' && (tpl === 'article' || tpl === 'record_stats' || tpl === 'recipe'));
  if (reading && kind !== 'article') {
    const clouds = main.filter((p) => !p.isPrimary && p.key !== form?.sectionKey).flatMap((p) => [...pluck(p, isLinkCloud), ...pluckLinkRuns(p, 6)]);
    if (clouds.length) drawer.push({ key: 'clouds', label: 'Site links', blocks: clouds, section: null });
  }
  const chromeOut: Block[] = [];
  // Captions the page shows with its pictures: a second copy as a line of its own is dropped (rule 3).
  const captions = [articleHead?.lead?.caption ?? '', ...main.flatMap((p) => flatten(allBlocks(p))).map((b) => (b.b === 'image' ? b.caption : ''))]
    .map(normText).filter((c) => c.length >= 20);
  for (const p of main) if (p.key !== form?.sectionKey) scrubSection(p, reading, chromeOut, captions);
  let more: CardLinkBlock[] = [];
  let siteLinks: ControlBlock[] = [];
  if (reading) {
    const ends: EndPart[] = [{ key: 'chrome', label: 'Site links', blocks: chromeOut, chrome: true }];
    for (let i = main.length - 1; i >= 0; i--) {
      const p = main[i]!;
      const role = p.sec.role;
      if (p.isPrimary || p.lead || p.key === lead?.from || p.key === form?.sectionKey || p.cards) continue;
      // Readers' comments: their words in one closed "Comments" at the end, without the reply and report buttons.
      const comments = isCommentThread(p);
      if (!comments && !CHROME_ROLES.has(role) && role !== 'related') continue;
      main.splice(i, 1);
      ends.splice(1, 0, {
        key: p.key, label: comments ? 'Comments' : (p.title ?? p.label), blocks: allBlocks(p), chrome: !comments && CHROME_ROLES.has(role),
      });
    }
    // A comment widget inside the story's own part goes with them.
    const thread = main.flatMap((p) => pluck(p, inComments));
    if (thread.length) ends.splice(1, 0, { key: 'comments', label: 'Comments', blocks: thread, chrome: false });
    for (const d of drawer) {
      const role = d.section?.sec.role ?? '';
      const chrome = d.key === 'clouds' || d.key === 'tools' || ['Site links', 'Sponsored', 'Offers', 'Navigation', 'Legal', 'Account', 'Search'].includes(d.label) || CHROME_ROLES.has(role);
      ends.push({ key: d.key, label: d.section ? d.section.title ?? d.section.label : d.label, blocks: d.section ? allBlocks(d.section) : d.blocks, chrome });
    }
    // A story the page already shows is not listed again under "More from".
    const shown = new Seen();
    for (const p of main) for (const b of flatten(allBlocks(p))) if (b.b === 'cardlink') shown.fresh(b.href, b.title);
    const end = sortEnd(ends, shown);
    more = end.stories;
    siteLinks = end.links;
    drawer = end.rest.map((r) => ({ key: r.key, label: r.label === 'Other' ? 'More on this page' : r.label, blocks: r.blocks, section: null }));
  } else {
    for (const d of drawer) {
      if (d.section) scrubSection(d.section, false);
      else d.blocks = scrubBlocks(d.blocks, { reading: false });
    }
    drawer = drawer.filter((d) => (d.section ? allBlocks(d.section).length > 0 : d.blocks.length > 0));
  }
  // A part left with nothing to show is not drawn as an empty band.
  for (let i = main.length - 1; i >= 0; i--) {
    const p = main[i]!;
    if (!p.isPrimary && p.key !== form?.sectionKey && !p.cards && !allBlocks(p).length) main.splice(i, 1);
  }
  const listen = kind === 'article' ? findListen(artDom?.h1 ?? null) : null;

  const labels: string[] = [];
  for (const d of drawer) {
    const l = d.section ? d.section.label : d.label;
    if (l && l !== 'More on this page' && l !== 'Other' && !labels.includes(l)) labels.push(l);
  }

  // Cards: popups the page keeps first, then alerts, then cookie questions (after the task).
  const cards = sections.filter((p) => p.hoist).flatMap((p) => p.cards ?? []);
  const progress = progressEl ? { el: progressEl, blocks: read('progress', [progressEl], false), stepText: siteStepText() } : null;
  const chat = chats[0] ?? null;

  const portal = kind === 'page' && allowIndex && !form && !primaryOut ? portalOf(o, main, promoted) : null;
  if (portal) kind = 'portal';

  const totalBlocks = sections.reduce((a, p) => a + flatten(allBlocks(p)).length, 0);
  return {
    siteName: siteName(),
    kind,
    meaning: m && tpl ? { template: tpl, purpose: m.purpose, items, action, orient, hideLead: tpl === 'recipe' && items.some((x) => x.data.kind === 'recipe') } : null,
    index,
    article: articleHead,
    portal,
    // A page to read has no search box or account links to show (rule 1); its own help link still reaches the top bar.
    strip: reading ? [] : strip,
    helpLink,
    hoisted: sections.filter((p) => p.hoist),
    popups: cards.filter((c) => c.kind === 'popup'),
    alerts: cards.filter((c) => c.kind === 'alert'),
    consents: cards.filter((c) => c.kind === 'consent'),
    main,
    lead,
    form,
    drawer,
    help: helpBlocks,
    primary: primaryOut,
    chat,
    progress: progress && progress.blocks.length ? progress : null,
    roots: [...Array.from(placed.keys()), ...Array.from(folded), ...leftoverEls],
    drawerLabels: labels.slice(0, 4),
    stats: { sections: sections.length, blocks: totalBlocks, ms: Math.round(performance.now() - t0), folded: foldedCount, lifted, leftovers: leftoverEls.length },
    reading,
    more,
    siteLinks,
    listen,
  };
}

/** Section roles that hold the site's own chrome (menus, the legal footer, ads, promos). */
const CHROME_ROLES = new Set<string>(['navigation', 'legal', 'ads', 'promo']);

const COMMENTS_TITLE = /^(comments?|conversation|join the conversation|discussion|reader comments)\b/i;
/** A comment widget's box ("comments", not "commentary": an opinion column is not a comment thread). */
const COMMENTS_SEL = '[class*="comments" i],[id*="comments" i],[class*="viafoura" i],[class*="disqus" i],[id*="disqus" i]';

/** A block drawn from inside a comment widget (AP News: Viafoura's "Conversation" in the story's own part). */
function inComments(b: Block): boolean {
  const e = b.src instanceof Element ? b.src : b.src.parentElement;
  return !!e?.closest(COMMENTS_SEL);
}

/** A readers' comment thread as a part of its own: by its title, else where its words come from. */
function isCommentThread(p: PlanSection): boolean {
  if (p.label === 'Comments' || (p.title && COMMENTS_TITLE.test(p.title.trim()))) return true;
  const bs = flatten(allBlocks(p));
  return bs.length >= 4 && bs.filter(inComments).length >= 0.6 * bs.length;
}

/** Rules 1–3 inside one placed part (SIMPLIFIED.md): see tidy.scrubBlocks. */
function scrubSection(p: PlanSection, reading: boolean, chrome?: Block[], captions?: string[]): void {
  const seen = new Seen();
  const s = (bs: Block[]): Block[] => scrubBlocks(bs, { reading, seen, chrome, captions });
  const recs = (rs: Block[][] | null): Block[][] | null => (rs ? rs.map(s).filter((r) => r.length) : null);
  p.before = s(p.before);
  p.blocks = s(p.blocks);
  p.records = recs(p.records);
  if (p.parts) {
    for (const pt of p.parts) {
      pt.before = s(pt.before);
      pt.blocks = s(pt.blocks);
      pt.records = recs(pt.records);
      pt.after = s(pt.after);
    }
    p.parts = p.parts.filter((pt) => pt.blocks.length || pt.records?.length || pt.before.length || pt.after.length);
  }
  p.after = s(p.after);
  p.count = p.records ? p.records.length : p.parts ? p.parts.length : flatten(p.blocks).filter((b) => b.b === 'control' || b.b === 'cardlink').length;
}

/* ------------------------------------------------------------------ */
/* Articles                                                            */
/* ------------------------------------------------------------------ */

const OUTSIDE_ARTICLE = 'nav,footer,aside,header nav,[role=navigation],[role=contentinfo],[role=complementary],webable-ui';

/** A picture's caption or credit, or anything inside a figure: never the story's running text, dek or byline. */
const PICTURE_TEXT = `figure,${CAPTION_SEL}`;

/**
 * Running text the page shows: paragraphs of at least 80 characters outside menus, footers, side rails and picture
 * captions (AP News: a long caption in the lead gallery is not the story's first paragraph).
 */
function runningParagraphs(): Element[] {
  const out: Element[] = [];
  for (const p of Array.from(document.querySelectorAll('p')).slice(0, 600)) {
    if (p.closest(OUTSIDE_ARTICLE) || p.closest(PICTURE_TEXT)) continue;
    const t = clean(p.textContent);
    if (t.length < 80) continue;
    const r = p.getBoundingClientRect();
    if (r.width < 200 || r.height < 10) continue;
    out.push(p);
  }
  return out;
}

/** An article: one visible page title and at least 1500 characters of running text in five or more paragraphs. */
function articleLike(): boolean {
  const h1s = Array.from(document.querySelectorAll('h1')).filter((h) => !h.closest('webable-ui') && h.getBoundingClientRect().height > 0);
  if (h1s.length !== 1) return false;
  const paras = runningParagraphs();
  const chars = paras.reduce((a, p) => a + clean(p.textContent).length, 0);
  const fields = document.querySelectorAll('main input:not([type=hidden]):not([type=search]),main select,main textarea').length;
  return paras.length >= 5 && chars >= 1500 && fields < 2;
}

interface ArticleDom { h1: Element | null; byline: Element | null; date: Element | null; dek: Element | null; kicker: string | null; skip: Element[] }

const AUTHOR_SEL = '[class*="author" i],[rel="author"],[itemprop="author"]';
const BYLINE_SEL = '[class*="byline" i],[rel="author"],[itemprop="author"],[class*="author" i],[data-testid*="byline" i],address';
const DATE_SEL = 'time,[class*="timestamp" i],[class*="date" i],[itemprop="datePublished"],[itemprop="dateModified"]';
const DEK_SEL = '[class*="dek" i],[class*="standfirst" i],[class*="subhead" i],[class*="sub-head" i],[class*="subtitle" i],[class*="sub-title" i],[class*="summary" i],[class*="description" i],[class*="lowertext" i],h2';
const GALLERY_TEXT_SEL =
  '[class*="slide" i][class*="desc" i],[class*="slide" i][class*="count" i],[class*="carousel" i][class*="desc" i],' +
  '[class*="gallery" i][class*="desc" i],[class*="gallery" i][class*="count" i]';
const COMMENT_COUNT_SEL = '[class*="comment" i][class*="count" i]';
const KICKER_SEL = '[class*="kicker" i],[class*="eyebrow" i],[class*="overline" i],[class*="rubric" i],[class*="category" i],[class*="section-name" i],[class*="label" i],[class*="breadcrumb" i]';

/** Outermost matches only (a byline wrapper, not each name inside it). */
function outermost(els: Element[]): Element[] {
  return els.filter((e) => !els.some((o) => o !== e && o.contains(e)));
}

/**
 * The header parts around the article's title, from the page: the byline nearest the title (each name once), its
 * date, a dek right under the title and a kicker right above it. These are read into the header and skipped in the
 * body. Elements far from the title (an author box at the end) are left where they are.
 */
function articleDom(): ArticleDom {
  const h1 = Array.from(document.querySelectorAll('h1')).find((h) => !h.closest('webable-ui') && h.getBoundingClientRect().height > 0) ?? null;
  const out: ArticleDom = { h1, byline: null, date: null, dek: null, kicker: null, skip: [] };
  if (!h1) return out;
  const hr = h1.getBoundingClientRect();
  const near = (e: Element, below = 1.4 * window.innerHeight): boolean => {
    const r = e.getBoundingClientRect();
    return r.height > 0 && r.width > 0 && r.top >= hr.top - 240 && r.top <= hr.bottom + below && !e.closest(OUTSIDE_ARTICLE);
  };
  const first = runningParagraphs()[0] ?? null;
  // Before the first paragraph of the story (an author box after the story stays where it is).
  const beforeBody = (e: Element): boolean => !first || !!(e.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING);
  const bylines = outermost(
    Array.from(document.querySelectorAll(BYLINE_SEL)).filter((e) => {
      if (e.contains(h1) || h1.contains(e) || !near(e) || !beforeBody(e)) return false;
      const t = clean(textOf(e));
      return t.length >= 3 && t.length <= 320 && !e.querySelector('p,h1,h2,h3,input,form');
    }),
  );
  out.byline = bylines[0] ?? null;
  const dates = Array.from(document.querySelectorAll(DATE_SEL)).filter((e) => {
    if (e.contains(h1) || !near(e) || !beforeBody(e)) return false;
    const t = clean(textOf(e));
    return t.length >= 4 && t.length <= 90 && (isTimeText(t) || /\b(updated|published|posted|\d{4}|ago)\b/i.test(t)) && !e.querySelector('p,h1,h2,a[href]');
  });
  out.date = outermost(dates)[0] ?? null;
  const box = h1.parentElement?.parentElement?.parentElement ?? h1.parentElement;
  if (box) {
    const deks = Array.from(box.querySelectorAll(DEK_SEL)).filter((e) => {
      if (e.contains(h1) || h1.contains(e) || !near(e, 420) || e.closest(PICTURE_TEXT)) return false;
      if (!(h1.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
      if (out.byline && (out.byline.contains(e) || e.contains(out.byline))) return false;
      const t = clean(textOf(e));
      return t.length >= 30 && t.length <= 320 && !e.querySelector('a[href],img,input');
    });
    out.dek = outermost(deks)[0] ?? null;
    const kick = Array.from(box.querySelectorAll(KICKER_SEL)).find((e) => {
      if (e.contains(h1) || h1.contains(e)) return false;
      if (!(e.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
      const r = e.getBoundingClientRect();
      return r.height > 0 && isKickerText(clean(textOf(e)));
    });
    if (kick) {
      out.kicker = clean(textOf(kick));
      out.skip.push(kick);
    }
  }
  for (const e of [out.byline, out.date, out.dek]) if (e) out.skip.push(e);
  // A comment count by the byline (AP News: "15" beside Share) is not a line of the story.
  for (const e of Array.from(document.querySelectorAll(COMMENT_COUNT_SEL))) {
    if (near(e) && beforeBody(e) && /^\d{1,5}$/.test(clean(textOf(e)))) out.skip.push(e);
  }
  // The lead gallery's other captions and its "1 of 2" counters (AP News): the lead picture carries its own caption.
  for (const e of Array.from(document.querySelectorAll(GALLERY_TEXT_SEL))) {
    if (near(e) && beforeBody(e) && !e.contains(h1)) out.skip.push(e);
  }
  return out;
}

/** The first picture before the article's second long paragraph, taken out of the body to lead it. */
function takeLeadPicture(main: PlanSection[]): ImageBlock | null {
  for (const p of main.slice(0, 3)) {
    let paras = 0;
    for (const list of [p.before, p.blocks]) {
      for (let i = 0; i < list.length; i++) {
        const b = list[i]!;
        if (b.b === 'flow' && b.text.length >= 80) paras++;
        if (paras >= 2) return null;
        if (b.b === 'image' && keepImage(b, true) && Math.max(b.w, b.h) >= 240) {
          list.splice(i, 1);
          return { ...b, important: true };
        }
      }
    }
  }
  return null;
}

function articleHeadOf(dom: ArticleDom | null, lead: Lead | null, main: PlanSection[]): ArticleHead {
  let byline: ArticleHead['byline'] = null;
  if (dom?.byline) {
    const text = clean(textOf(dom.byline));
    const seen = new Set<string>();
    const names: LinkPart[] = [];
    // The names come from the authors' own part when the byline has one (AP News also puts "Leer en español" there).
    const authors = dom.byline.matches(AUTHOR_SEL) ? dom.byline : (dom.byline.querySelector(AUTHOR_SEL) ?? dom.byline);
    for (const a of Array.from(authors.querySelectorAll('a[href]'))) {
      const t = clean(textOf(a));
      if (!t || t.length > 60 || isTimeText(t) || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      names.push({ t: 'link', el: a, text: t, href: safeHref(a), help: false });
    }
    const dateText = dom.date && dom.byline.contains(dom.date) ? clean(textOf(dom.date)) : '';
    const rest = clean(text.replace(dateText, ''));
    byline = { prefix: /^by\b/i.test(rest) ? rest.slice(0, 2) : null, names, text: rest.replace(/^by\s+/i, '') };
  }
  const date = dom?.date ? clean(textOf(dom.date)) : null;
  const leadPic = takeLeadPicture(main) ?? pageLeadImage();
  return {
    kicker: dom?.kicker ?? lead?.eyebrow ?? null,
    date: date && byline?.text.includes(date) ? null : date,
    dek: dom?.dek ? clean(textOf(dom.dek)) : null,
    byline: byline && (byline.names.length || byline.text) ? byline : null,
    lead: leadPic,
  };
}

/**
 * A cloud of short links: a list or group whose words are almost all links of a few words (a site menu or footer
 * that the outline did not mark as one), with at least eight of them.
 */
function isLinkCloud(b: Block): boolean {
  if (b.b !== 'list' && b.b !== 'group') return false;
  const leaves = flatten([b]).filter((x) => x.b !== 'list' && x.b !== 'group');
  const links = leaves.filter((x) => x.b === 'control' && x.role === 'link' && !x.primary && !x.help && x.text.length <= 40);
  const heads = leaves.filter((x) => x.b === 'heading' || (x.b === 'flow' && x.text.length <= 32));
  return links.length >= 8 && links.length + heads.length >= 0.9 * leaves.length;
}

const MENU_OPENER_RE = /^((open|close|show|hide|toggle)( the)? )?((main|site|primary) )?(menu|navigation|nav)( (icon|button))?$/i;

/** Remove runs of `min` or more short links in a row (a menu written as bare links) from a section and return them. */
function pluckLinkRuns(p: PlanSection, min: number): Block[] {
  const out: Block[] = [];
  const shortLink = (b: Block): boolean => b.b === 'control' && b.role === 'link' && !b.primary && !b.help && b.text.length <= 40;
  // The site menu's own opener ("Open Menu Icon") goes with the menu.
  const opener = (b: Block): boolean => b.b === 'control' && !b.primary && MENU_OPENER_RE.test(b.text.trim());
  const walk = (bs: Block[]): Block[] => {
    const keep: Block[] = [];
    let run: Block[] = [];
    const flush = (): void => {
      if (run.length >= min) out.push(...run);
      else keep.push(...run);
      run = [];
    };
    for (const b of bs) {
      if (shortLink(b)) {
        run.push(b);
        continue;
      }
      flush();
      if (opener(b)) {
        out.push(b);
        continue;
      }
      if (b.b === 'group') b.blocks = walk(b.blocks);
      keep.push(b);
    }
    flush();
    return keep;
  };
  p.before = walk(p.before);
  p.blocks = walk(p.blocks);
  p.after = walk(p.after);
  if (p.parts) for (const pt of p.parts) {
    pt.before = walk(pt.before);
    pt.blocks = walk(pt.blocks);
    pt.after = walk(pt.after);
  }
  return out;
}

/** Remove the blocks that match from a section (at any depth) and return them. */
function pluck(p: PlanSection, pred: (b: Block) => boolean): Block[] {
  const out: Block[] = [];
  const walk = (bs: Block[]): Block[] =>
    bs.filter((b) => {
      if (pred(b)) {
        out.push(b);
        return false;
      }
      if (b.b === 'group') b.blocks = walk(b.blocks);
      else if (b.b === 'list') b.items = b.items.map(walk).filter((it) => it.length);
      return true;
    });
  p.before = walk(p.before);
  p.blocks = walk(p.blocks);
  p.after = walk(p.after);
  if (p.records) p.records = p.records.map(walk).filter((r) => r.length);
  if (p.parts) for (const pt of p.parts) {
    pt.before = walk(pt.before);
    pt.blocks = walk(pt.blocks);
    pt.after = walk(pt.after);
    if (pt.records) pt.records = pt.records.map(walk).filter((r) => r.length);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* News index                                                          */
/* ------------------------------------------------------------------ */

/** The page's body text size: the median size of its running paragraphs (16 when it has none). */
function pageBodyPx(): number {
  const sizes = runningParagraphs().slice(0, 40).map((p) => parseFloat(getComputedStyle(p).fontSize)).filter((n) => n > 0).sort((a, b) => a - b);
  if (sizes.length) return sizes[Math.floor(sizes.length / 2)]!;
  return parseFloat(getComputedStyle(document.body).fontSize) || 16;
}

/** A story: a card link with a headline, or a headline link (four or more words) that is not help. */
function storyOf(b: Block): CardLinkBlock | null {
  if (b.b === 'cardlink') return b.title ? b : null;
  if (b.b === 'control' && b.role === 'link' && !b.help && !b.primary) {
    const t = b.text.trim();
    if (t.length >= 24 && t.split(/\s+/).length >= 4 && !TOOL_RE.test(t)) return storyFromLink(b);
  }
  return null;
}

/** Leaves of a section in order: lists, groups and records opened up. */
function leafBlocks(bs: Block[]): Block[] {
  const out: Block[] = [];
  const walk = (xs: Block[]): void => {
    for (const b of xs) {
      if (b.b === 'list') b.items.forEach(walk);
      else if (b.b === 'group' && !b.blocks.some((x) => x.b === 'choices' || x.b === 'field' || x.b === 'select')) {
        if (b.legend) out.push({ b: 'heading', level: 3, text: b.legend, el: b.src as Element, key: `${b.key}l`, src: b.src });
        walk(b.blocks);
      } else out.push(b);
    }
  };
  walk(bs);
  return out;
}

/**
 * A news index (design.md §2, F3): at least 8 stories, 3 of them with pictures. The lead is the story the page itself
 * makes most prominent (largest picture in the first 1.5 screens, a large headline, the first screen, Jev's pick);
 * the next six most prominent are the top stories, in page order; every other story stays in its own section, the
 * first `groupSize` shown and the rest behind "More in X (n)".
 */
function indexOf(main: PlanSection[], promoted: Element[], groupSize: number): IndexPlan | null {
  const content = main.filter((p) => p.state !== 'end_drawer' && !p.hoist && p.sec.role !== 'navigation' && p.sec.role !== 'help');
  const seen = new Set<string>();
  const per: Array<{ p: PlanSection; stories: CardLinkBlock[]; other: Block[] }> = [];
  const all: Array<{ s: CardLinkBlock; i: number }> = [];
  for (const p of content) {
    const stories: CardLinkBlock[] = [];
    const other: Block[] = [];
    for (const b of leafBlocks(allBlocks(p))) {
      const s = storyOf(b);
      if (!s) {
        other.push(b);
        continue;
      }
      const k = s.href ? hrefKey(s.href) : '';
      const t = s.title.toLowerCase();
      if ((k && seen.has(k)) || seen.has(t)) continue;
      if (k) seen.add(k);
      seen.add(t);
      stories.push(s);
      all.push({ s, i: all.length });
    }
    per.push({ p, stories, other });
  }
  const pictured = (s: CardLinkBlock): boolean => !!s.image && keepImage(s.image, true);
  if (all.length < 8 || all.filter((x) => pictured(x.s)).length < 3) return null;
  const screenH = window.innerHeight || 900;
  const area = (s: CardLinkBlock): number => (s.image ? s.image.w * s.image.h : 0);
  const early = all.filter((x) => pictured(x.s) && x.s.top < 1.5 * screenH);
  const largest = early.reduce((m, x) => Math.max(m, area(x.s)), 0);
  const bodyPx = pageBodyPx();
  const scored = all.map((x) => ({
    ...x,
    score: storyScore({
      largestEarlyPicture: largest > 0 && pictured(x.s) && x.s.top < 1.5 * screenH && area(x.s) === largest,
      headPx: x.s.headPx, bodyPx, top: x.s.top, screenH,
      promoted: promoted.some((e) => e === x.s.el || e.contains(x.s.el) || x.s.el.contains(e)),
      hasPicture: pictured(x.s),
    }),
  }));
  const byScore = (a: { score: number; i: number }, b: { score: number; i: number }): number => b.score - a.score || a.i - b.i;
  const leadX = scored.filter((x) => pictured(x.s)).sort(byScore)[0] ?? null;
  const topX = scored.filter((x) => x !== leadX).sort(byScore).slice(0, 6).sort((a, b) => a.i - b.i);
  const used = new Set<CardLinkBlock>([...(leadX ? [leadX.s] : []), ...topX.map((x) => x.s)]);
  const sections: IndexSection[] = per
    .map(({ p, stories, other }) => {
      const rest = stories.filter((s) => !used.has(s));
      return { key: p.key, title: p.title, first: rest.slice(0, groupSize), rest: rest.slice(groupSize), other };
    })
    .filter((x) => x.first.length || x.other.length);
  return { lead: leadX?.s ?? null, top: topX.map((x) => x.s), sections, total: all.length };
}

const TASK_VERB = /\b(apply|check|report|renew|find|pay|status|log ?in|sign ?in|start|stop|outage|bill|account|manage|track|schedule|refill|get help)\b/i;

/**
 * A home page or portal (many links, little running text, no form, no main button): the five most useful links,
 * scored 3·Jev's main pick + 2·a task verb + main column − 2·menu or footer, then shown in the page's order.
 */
function portalOf(o: PlanInput, main: PlanSection[], promoted: Element[]): Portal | null {
  if (['article', 'product_detail', 'form', 'docs'].includes(o.spec.page_type) || o.spec.task === 'read') return null;
  const content = main.filter((p) => p.state === 'open' && p.sec.role !== 'navigation' && p.sec.role !== 'help');
  const all = content.flatMap((p) => flatten(allBlocks(p)));
  const links = all.filter((b): b is ControlBlock | CardLinkBlock => (b.b === 'control' && b.role === 'link' && !b.help) || b.b === 'cardlink');
  const flowChars = all.reduce((a, b) => a + (b.b === 'flow' ? b.text.length : 0), 0);
  if (links.length < 10 || flowChars > 2500) return null;
  const seen = new Set<string>();
  const scored = links
    .map((b, i) => {
      const text = b.b === 'cardlink' ? b.title : b.text;
      const t = text.trim().toLowerCase();
      if (!t || t.length < 3 || seen.has(t)) return null;
      seen.add(t);
      let score = 0;
      if (promoted.some((p) => p === b.el || p.contains(b.el) || b.el.contains(p))) score += 3;
      if (TASK_VERB.test(text)) score += 2;
      if (b.b === 'cardlink') score += 1;
      // A one-word section link ("NEWS", "SPORTS") is a menu entry, not a destination.
      if (text.trim().split(/\s+/).length === 1 && text.length <= 12) score -= 1;
      if (b.el.closest('main,[role=main]')) score += 1;
      if (b.el.closest('nav,footer,[role=navigation],[role=contentinfo]')) score -= 2;
      let blurb: string | null = null;
      if (b.b === 'cardlink') blurb = b.lines[0] ?? null;
      else {
        // The words around the link in its own box, without the text of any link or button in it.
        const box = b.el.closest('li,p,article') ?? b.el.parentElement;
        let rest = '';
        if (box && box !== document.body) {
          const c = box.cloneNode(true) as Element;
          c.querySelectorAll('a,button,[role=button],script,style').forEach((x) => x.remove());
          rest = clean(c.textContent);
        }
        blurb = rest ? splitSentences(rest)[0] ?? null : null;
      }
      if (blurb && (blurb.length > 100 || blurb.length < 6)) blurb = blurb.length > 100 ? `${blurb.slice(0, 97).replace(/\s+\S*$/, '')}…` : null;
      return { i, key: `${b.key}m`, el: b.el, text, href: b.href, blurb, score };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const top = [...scored].sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 5).sort((a, b) => a.i - b.i);
  if (top.length < 3) return null;
  return { rows: top.map(({ key, el, text, href, blurb }) => ({ key, el, text, href, blurb })), total: links.length };
}

/** The page's live summary next to its main action (an order total, "2 selected"): a short live flow with a price or a count. */
function dockContext(blocks: Block[]): Element | null {
  const flows = flatten(blocks).filter((b): b is FlowBlock => b.b === 'flow');
  for (const f of flows.reverse()) {
    const e = f.src instanceof Element ? f.src : f.src.parentElement;
    if (!e || f.text.length > 90) continue;
    const live = e.closest('[aria-live],[role=status]');
    if (live && /(\$\s?\d|\d+\s+(selected|items?|prescriptions?))/i.test(f.text)) return live;
  }
  return null;
}

/** Every block of a section, in order (parts and records opened up). */
export function allBlocks(p: Pick<PlanSection, 'before' | 'blocks' | 'records' | 'after' | 'parts'>): Block[] {
  return [
    ...p.before,
    ...p.blocks,
    ...(p.records ?? []).flat(),
    ...(p.parts ?? []).flatMap((pt) => [...pt.before, ...pt.blocks, ...(pt.records ?? []).flat(), ...pt.after]),
    ...p.after,
  ];
}

/** Pull the primary action and the buttons beside it out of a step, so the step ends with them. */
export function splitActions(blocks: Block[]): { rest: Block[]; primary: ControlBlock | null; secondary: ControlBlock[] } {
  const idx = blocks.findIndex((b) => b.b === 'control' && b.primary);
  if (idx < 0) return { rest: blocks, primary: null, secondary: [] };
  const primary = blocks[idx] as ControlBlock;
  const row = primary.el.parentElement;
  const secondary: ControlBlock[] = [];
  const rest: Block[] = [];
  blocks.forEach((b, i) => {
    if (i === idx) return;
    if (b.b === 'control' && !b.help && row && (b.el.parentElement === row || row.contains(b.el) || b.el.parentElement?.parentElement === row.parentElement) && Math.abs(i - idx) <= 3) {
      secondary.push(b);
      return;
    }
    rest.push(b);
  });
  return { rest, primary, secondary };
}

/* ------------------------------------------------------------------ */
/* Meaning first (round 7)                                             */
/* ------------------------------------------------------------------ */

function drawerLabelOf(f: FineRole | undefined): SectionLabel {
  if (f === 'advertising' || f === 'sponsored') return 'Sponsored';
  if (f === 'legal_footer' || f === 'site_nav') return 'Site links';
  if (f === 'upsell_promo' || f === 'newsletter_signup') return 'Offers';
  return 'Related items';
}

const ACTION_SEL = 'a[href],button,[role=button],[role=link],input[type=submit],input[type=button]';

/**
 * A status lookup's main action: the button Jev promoted (main pick >= 0.90), else the control Jev's page model calls
 * the primary action, inside what the page exists to show (its main region or most important part) first, then the one
 * Jev thinks most likely the main action, then the more important; else the layout's primary action.
 */
function statusAction(m: PageMeaning, o: PlanInput, el: (id: string | null | undefined) => Element | null): Element | null {
  const promoted = o.decisions.find((d) => d.verdict === 'promote');
  const pe = promoted ? el(promoted.id) : null;
  if (pe && pe.matches(ACTION_SEL)) return pe;
  const asControl = (e: Element | null): Element | null => {
    if (!e) return null;
    if (e.matches(ACTION_SEL)) return e;
    const inner = e.querySelectorAll(ACTION_SEL);
    return inner.length === 1 ? inner[0]! : null;
  };
  const leadEls = (m.main.length ? m.main.slice(0, 1) : m.lead.ids).map(el).filter((x): x is Element => !!x);
  const order = new Map(o.outline.nodes.map((n, i) => [n.id, i] as const));
  const cands = Object.entries(m.fine)
    .filter(([, f]) => f === 'primary_action')
    .map(([id]) => ({ id, e: asControl(el(id)) }))
    .filter((x): x is { id: string; e: Element } => !!x.e && !x.e.closest('header,footer,nav,[role=banner],[role=contentinfo],[role=navigation]'))
    .map((x) => ({ ...x, inLead: leadEls.some((l) => within(l, x.e)), main: m.mainP[x.id] ?? 0, imp: m.importance[x.id] ?? 2, ord: order.get(x.id) ?? 0 }))
    .sort((a, b) => Number(b.inLead) - Number(a.inLead) || b.main - a.main || b.imp - a.imp || a.ord - b.ord);
  if (cands[0]) return cands[0].e;
  return asControl(el(o.spec.primary_action));
}

