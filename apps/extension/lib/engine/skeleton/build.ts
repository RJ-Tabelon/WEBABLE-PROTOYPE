import {
  SKEL_MAX_EXEMPLAR_NODES,
  type SkelFlag,
} from '@webable/core/skeleton/constants';

import { revealTargets } from '../extract/hover';
import {
  AD_MARKUP_SELECTOR,
  CMP_SELECTOR,
  iframeKindOfHost,
} from '../extract/rules';
import { fontWeightNum } from '../extract/text';
import { directTextLength, iframeHost } from '../util/dom';
import { adMarked, isAdRecord } from './ads';
import {
  groupRuns,
  qualifyRun,
  runArea,
  runTemplate,
  type QualifiedRun,
} from './collections';
import {
  composedKids,
  composedParentOf,
  SKEL_SKIP,
  shadowOf,
  type OpenClosed,
} from './dom';
import { capExemplar } from './lod';
import { hrefKind, isIdentityProvider } from './media';
import { accessibleName } from './name';
import { isSensitiveField, PAYMENT_FRAME_SELECTOR } from './privacy';
import { countNodes, forEachNode, type Box, type RawNode } from './raw';
import {
  CONTROL_ROLES,
  explicitRole,
  headingLevel,
  INPUT_ROLES,
  inputTypeOf,
  isButtonInput,
  LANDMARK_ROLES,
  roleOf,
  skelRole,
  skelTag,
} from './roles';
import { cutLabel, normalizeSpace, SHORT_TEXT_MAX, textPatterns } from './text';
import { isSrOnly, isVisible, visibleText } from './visible';

/**
 * Builds the raw skeleton tree (docs/10 §4, ported and hardened from the
 * probe extractor). Walks the composed tree (open and closed shadow roots,
 * slots) and keeps only what Fit view and the planner need:
 *
 *   landmarks, headings, controls, inputs, media (including
 *   background-image boxes), text blocks (shape only), data tables
 *   (summary), groups with two or more kept children, and collections
 *   (runs of >= 3 similar siblings) with one exemplar subtree.
 *
 * Single-child wrappers are flattened and their flags bubble down. Hidden,
 * visually-hidden and off-canvas boxes are skipped, except hover-only record
 * actions, which are kept as slots flagged 'hoveronly'.
 *
 * The builder is a generator: it yields when its time slice is used up so
 * the caller can give the main thread back (and leave measure mode) between
 * slices. The main content is read first, then the banner; when the total
 * budget is spent, the rest of the page is summarised one node per
 * remaining subtree, but a read inside main or the banner goes on (in
 * slices) until a hard limit, so a slow page loses its sidebars and footer,
 * never its results or its article.
 */

type Gen<T> = Generator<undefined, T, undefined>;

interface Ctx {
  /** Building a collection member: its element. */
  record: Element | null;
  /** Inside a hover-only subtree (visibility checks relaxed). */
  hover: boolean;
  /** Box for hover-only nodes with no layout box (display:none until hover). */
  hoverBox: Box | null;
  depth: number;
}

export interface BuilderOptions {
  openClosed?: OpenClosed;
  regionKeys?: ReadonlyMap<Element, string>;
  /** Busy time per slice before yielding, ms. */
  sliceMs: number;
  now: () => number;
}

const MEDIA_TAGS: ReadonlySet<string> = new Set([
  'img',
  'picture',
  'video',
  'audio',
  'canvas',
  'iframe',
  'svg',
  'object',
  'embed',
]);
/** Replaced elements: a tiny one has no children worth reading. */
const REPLACED: ReadonlySet<string> = new Set([
  ...MEDIA_TAGS,
  'input',
  'select',
  'textarea',
  'hr',
  'progress',
  'meter',
]);
/** Inline content: an element holding only these is one text block. */
const PHRASING: ReadonlySet<string> = new Set([
  'a',
  'abbr',
  'acronym',
  'b',
  'bdi',
  'bdo',
  'big',
  'cite',
  'code',
  'data',
  'del',
  'dfn',
  'em',
  'font',
  'i',
  'ins',
  'kbd',
  'label',
  'mark',
  'math',
  'nobr',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'svg',
  'time',
  'tt',
  'u',
  'var',
  'img',
  'picture',
]);
/** Text containers: a short or long text inside these is a text node. */
const PARA_TAGS: ReadonlySet<string> = new Set([
  'p',
  'blockquote',
  'pre',
  'dd',
  'dt',
  'figcaption',
  'li',
  'td',
  'th',
  'label',
  'span',
  'small',
  'time',
  'em',
  'strong',
  'b',
  'i',
  'cite',
  'code',
  'address',
  'caption',
  'legend',
]);
/** Composite widgets: their role is meaning, so they are never flattened away. */
const KEEP_ROLES: ReadonlySet<string> = new Set([
  'toolbar',
  'tablist',
  'menu',
  'menubar',
  'feed',
  'tabpanel',
  'radiogroup',
  'listbox',
  'tree',
  'grid',
  'treegrid',
]);
const HEADING_BREAK =
  'select, input, button, textarea, [role="combobox"], [role="button"], [role="tablist"]';
const ACTION_SELECTOR =
  'a[href], button, [role="button"], [role="link"], [role="menuitem"], [role="checkbox"], [role="switch"], input, select, [tabindex]';
const INTERACTIVE =
  'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [role="menuitem"], [tabindex]';
const EDITOR_ROOT =
  '.ProseMirror, .ql-editor, .DraftEditor-root, .cke_editable, .monaco-editor, .cm-editor, .CodeMirror';
const CONSENT_RE =
  /cookie|consent|gdpr|onetrust|(?:^|[\s_-])cmp(?:[\s_-]|$)|privacy-banner|cookiebanner/i;

const round1 = (v: number): number => Math.round(v * 10) / 10;

export class SkeletonBuilder {
  readonly shadowRoots = new Set<ShadowRoot>();
  /** A password or payment field was met: the read must return null. */
  sensitive = false;
  /** The time budget ran out: what is outside main and the banner is summarised. */
  stopped = false;
  /** The hard limit ran out: everything left is summarised. */
  exhausted = false;
  /** Something was left out or summarised. */
  truncated = false;
  /** Start of the running slice (set by the driver). */
  sliceStart = 0;

  private readonly view: Window;
  private readonly sx: number;
  private readonly sy: number;
  private readonly docW: number;
  readonly vw: number;
  readonly vh: number;
  private readonly pageUrl: string;
  private readonly base: string;
  private readonly oc: OpenClosed | undefined;
  private readonly ads = new Set<Element>();
  private readonly consent = new Set<Element>();
  private readonly phrasing = new WeakMap<Element, boolean>();
  private hoverTargets: string[] | null = null;
  private calls = 0;
  private summaries = 0;
  /** Inside a subtree read first (main, the banner): the time budget does not stop it. */
  private precious = 0;
  /** Subtrees read ahead of the walk, by their root element. */
  private readonly prebuilt = new Map<Element, RawNode[]>();

  constructor(
    private readonly doc: Document,
    private readonly opts: BuilderOptions,
  ) {
    const view = doc.defaultView;
    if (!view) throw new Error('skeleton: document has no view');
    this.view = view;
    this.sx = view.scrollX;
    this.sy = view.scrollY;
    this.vw = view.innerWidth;
    this.vh = view.innerHeight;
    this.docW = Math.max(doc.documentElement.scrollWidth, this.vw);
    this.pageUrl = doc.URL;
    this.base = doc.baseURI;
    this.oc = opts.openClosed;
    this.indexScope(doc);
  }

  /** Ad and consent markup in one scope, matched once instead of per element. */
  private indexScope(scope: Document | ShadowRoot): void {
    try {
      for (const el of scope.querySelectorAll(AD_MARKUP_SELECTOR))
        this.ads.add(el);
      for (const el of scope.querySelectorAll(CMP_SELECTOR))
        this.consent.add(el);
    } catch {
      // A scope without querySelectorAll support: nothing to index.
    }
  }

  private noteShadow(sr: ShadowRoot): void {
    if (this.shadowRoots.has(sr)) return;
    this.shadowRoots.add(sr);
    this.indexScope(sr);
  }

  /** The page's root node (body), as one tree. */
  *root(): Gen<RawNode> {
    const body = this.doc.body as HTMLElement;
    const ctx: Ctx = { record: null, hover: false, hoverBox: null, depth: 0 };
    // Main and the banner first: the walk below splices them in where they sit.
    for (const el of this.preciousRoots()) {
      this.precious++;
      try {
        this.prebuilt.set(el, yield* this.build(el, ctx));
      } finally {
        this.precious--;
      }
    }
    const nodes = yield* this.build(body, ctx);
    const docH = Math.max(
      this.doc.documentElement.scrollHeight,
      body.scrollHeight,
      this.vh,
    );
    const box: Box = [0, 0, Math.round(this.docW), Math.round(docH)];
    const only = nodes.length === 1 ? nodes[0] : undefined;
    if (only && only.el === body) {
      only.box = box;
      return only;
    }
    return {
      el: body,
      tag: 'body',
      role: null,
      kind: 'group',
      box,
      flags: new Set(),
      kids: nodes,
    };
  }

  /** The largest visible main landmark, then the page's banner (outside content), not nested. */
  private preciousRoots(): Element[] {
    const largest = (
      sel: string,
      ok: (el: Element) => boolean = () => true,
    ): Element | null => {
      let best: Element | null = null;
      let bestArea = 0;
      let seen = 0;
      for (const el of this.doc.querySelectorAll(sel)) {
        if (++seen > 24) break;
        if (!ok(el)) continue;
        const r = el.getBoundingClientRect();
        const a = r.width * r.height;
        if (a > bestArea && isVisible(el)) {
          best = el;
          bestArea = a;
        }
      }
      return best;
    };
    const main = largest('main, [role="main"]');
    const banner = largest(
      'header, [role="banner"]',
      (el) =>
        !el.parentElement?.closest(
          'main, [role="main"], article, [role="article"], aside, section',
        ),
    );
    const out: Element[] = [];
    for (const el of [main, banner])
      if (el && !out.some((o) => o.contains(el) || el.contains(o)))
        out.push(el);
    return out;
  }

  /** `el` is an ancestor of a subtree read ahead (the walk must reach it). */
  private holdsPrebuilt(el: Element): boolean {
    for (const p of this.prebuilt.keys()) if (el.contains(p)) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // Visibility gate
  // ---------------------------------------------------------------------------

  *build(el: Element, ctx: Ctx): Gen<RawNode[]> {
    if (
      (++this.calls & 7) === 0 &&
      this.opts.now() - this.sliceStart >= this.opts.sliceMs
    )
      yield undefined;
    if (this.sensitive) return [];
    const pre = this.prebuilt.get(el);
    if (pre) {
      this.prebuilt.delete(el);
      return pre;
    }
    const tag = el.localName;
    if (SKEL_SKIP.has(tag) || ctx.depth > 160) return [];
    if (
      this.stopped &&
      (this.exhausted || this.precious === 0) &&
      !this.holdsPrebuilt(el)
    )
      return this.summary(el);
    if (!el.isConnected) return [];
    const cs = this.view.getComputedStyle(el);
    if (cs.display === 'none') {
      return ctx.record && !ctx.hover
        ? yield* this.hoverHidden(el, cs, ctx, true)
        : [];
    }
    if (cs.display === 'contents') return yield* this.flatKids(el, ctx);
    if (!ctx.hover && !isVisible(el)) {
      const faded = cs.opacity === '0';
      const invisible = cs.visibility !== 'visible';
      if (ctx.record && (faded || invisible))
        return yield* this.hoverHidden(el, cs, ctx, false);
      // visibility:hidden can be undone by a descendant; opacity cannot.
      if (invisible && !faded) return yield* this.flatKids(el, ctx);
      return [];
    }
    const r = el.getBoundingClientRect();
    let box: Box;
    if (ctx.hover && r.width < 1 && r.height < 1) {
      box = ctx.hoverBox ?? [0, 0, 0, 0];
    } else {
      if (r.width < 2 || r.height < 2) {
        if (isSrOnly(cs, r)) return [];
        const clips = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
        if (r.width < 1 && r.height < 1 && clips) return [];
        if (REPLACED.has(tag)) return [];
        // A collapsed wrapper whose children overflow it (floats, absolutes).
        return yield* this.flatKids(el, ctx);
      }
      if (isSrOnly(cs, r)) return [];
      if (
        r.right + this.sx <= 0 ||
        r.bottom + this.sy <= 0 ||
        r.left + this.sx >= this.docW + 40
      )
        return []; // off-canvas: skip links, closed drawers
      box = [
        Math.round(r.left + this.sx),
        Math.round(r.top + this.sy),
        Math.round(r.width),
        Math.round(r.height),
      ];
    }
    const out = yield* this.buildVisible(el, cs, r, box, ctx);
    const ck = this.opts.regionKeys?.get(el);
    if (ck && out.length === 1) {
      const only = out[0] as RawNode;
      if (only.el === el || !only.ck) only.ck = ck;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Classification
  // ---------------------------------------------------------------------------

  private *buildVisible(
    el: Element,
    cs: CSSStyleDeclaration,
    r: DOMRect,
    box: Box,
    ctx: Ctx,
  ): Gen<RawNode[]> {
    const tag = el.localName;
    const role = roleOf(el);
    const flags = this.flagsOf(el, cs, role, ctx);
    const sub: Ctx = { ...ctx, depth: ctx.depth + 1 };
    const sr = shadowOf(el, this.oc);
    if (sr) this.noteShadow(sr);

    if (MEDIA_TAGS.has(tag)) return this.media(el, r, box, role, flags);

    if (
      role === 'heading' &&
      !el.querySelector(HEADING_BREAK) &&
      !sr?.querySelector(HEADING_BREAK)
    )
      return this.heading(el, cs, box, flags);

    if (
      (tag === 'table' ||
        role === 'table' ||
        role === 'grid' ||
        role === 'treegrid') &&
      isDataTable(el)
    )
      return this.table(el, cs, box, role, flags);

    if (this.isInput(el, tag, role))
      return this.input(el, cs, box, role, flags);

    if (this.isControl(el, cs, tag, role, r))
      return yield* this.control(el, cs, r, box, role, flags, sub);

    if (!sr && tag !== 'body' && this.phrasingOnly(el)) {
      const t = this.text(el, cs, box, role, flags, ctx);
      if (t === 'empty') return [];
      if (t) return [t];
    }

    return yield* this.group(el, cs, r, box, role, flags, sub);
  }

  private flagsOf(
    el: Element,
    cs: CSSStyleDeclaration,
    role: string | null,
    ctx: Ctx,
  ): Set<SkelFlag> {
    const f = new Set<SkelFlag>();
    if (cs.position === 'fixed') f.add('fixed');
    else if (cs.position === 'sticky') f.add('sticky');
    const cls = el.getAttribute('class') ?? '';
    const idcls = `${el.id} ${cls} ${el.getAttribute('data-component-type') ?? ''}`;
    if (this.ads.has(el) || adMarked(el)) f.add('adhint');
    if (this.consent.has(el) || CONSENT_RE.test(idcls)) f.add('consenthint');
    const attr = (n: string): string | null => el.getAttribute(n);
    if (
      attr('aria-disabled') === 'true' ||
      (el as HTMLButtonElement).disabled === true
    )
      f.add('disabled');
    const current = attr('aria-current');
    if (
      attr('aria-selected') === 'true' ||
      attr('aria-checked') === 'true' ||
      (current !== null && current !== 'false') ||
      ((el as HTMLInputElement).checked === true && el.localName === 'input')
    )
      f.add('selected');
    if (attr('aria-pressed') === 'true') f.add('pressed');
    if (
      attr('aria-expanded') === 'true' ||
      (el.localName === 'details' && (el as HTMLDetailsElement).open)
    )
      f.add('expanded');
    const pop = attr('aria-haspopup');
    if (pop !== null && pop !== 'false') f.add('popup');
    else if (role === 'combobox') f.add('popup');
    if (
      attr('aria-required') === 'true' ||
      (el as HTMLInputElement).required === true
    )
      f.add('required');
    if (ctx.hover) f.add('hoveronly');
    return f;
  }

  /** Text in a box that clips: ellipsis, line clamp, or hidden overflow on nowrap or capped height. */
  private clipRisk(el: Element, cs: CSSStyleDeclaration): boolean {
    const check = (s: CSSStyleDeclaration): boolean => {
      const hiddenX = s.overflowX === 'hidden' || s.overflowX === 'clip';
      const hiddenY = s.overflowY === 'hidden' || s.overflowY === 'clip';
      if (s.textOverflow === 'ellipsis' && hiddenX) return true;
      const clamp = s.getPropertyValue('-webkit-line-clamp');
      if (clamp && clamp !== 'none' && (hiddenX || hiddenY)) return true;
      if ((hiddenX || hiddenY) && s.whiteSpace === 'nowrap') return true;
      return hiddenY && s.maxHeight !== 'none';
    };
    if (check(cs)) return true;
    if (!cs.display.startsWith('inline')) return false;
    const p = el.parentElement;
    return p ? check(this.view.getComputedStyle(p)) : false;
  }

  /**
   * Font size and weight of the text a node shows (read from the element
   * that holds it: a sender's bold span inside its cell), and clip risk.
   */
  private textStyle(n: RawNode, el: Element, cs: CSSStyleDeclaration): RawNode {
    const host = textHost(el);
    const hs = host === el ? cs : this.view.getComputedStyle(host);
    const px = parseFloat(hs.fontSize);
    if (Number.isFinite(px) && px > 0) n.fontPx = round1(px);
    n.weight = fontWeightNum(hs);
    if (this.clipRisk(el, cs) || (host !== el && this.clipRisk(host, hs)))
      n.flags.add('cliprisk');
    return n;
  }

  private media(
    el: Element,
    r: DOMRect,
    box: Box,
    role: string | null,
    flags: Set<SkelFlag>,
  ): RawNode[] {
    const tag = el.localName;
    if (tag === 'svg' && (r.width < 48 || r.height < 48)) return [];
    if (tag === 'img' && (r.width < 20 || r.height < 20)) return [];
    let label = '';
    let b = box;
    switch (tag) {
      case 'img':
        label = el.getAttribute('alt') ?? '';
        break;
      case 'picture': {
        const img = el.querySelector('img');
        label = img?.getAttribute('alt') ?? '';
        const ir = img?.getBoundingClientRect();
        if (ir && ir.width * ir.height > r.width * r.height)
          b = [
            Math.round(ir.left + this.sx),
            Math.round(ir.top + this.sy),
            Math.round(ir.width),
            Math.round(ir.height),
          ];
        break;
      }
      case 'iframe': {
        if (el.matches(PAYMENT_FRAME_SELECTOR)) {
          this.sensitive = true;
          return [];
        }
        label = el.getAttribute('title') ?? '';
        let path = '';
        try {
          path = new URL(el.getAttribute('src') ?? '', this.base).pathname;
        } catch {
          path = '';
        }
        if (iframeKindOfHost(iframeHost(el, this.base), path) === 'ad_network')
          flags.add('adhint');
        break;
      }
      case 'video': {
        const v = el as HTMLVideoElement;
        const active = (
          navigator as Navigator & { userActivation?: { isActive: boolean } }
        ).userActivation?.isActive;
        if (!v.paused && !v.ended && !active) flags.add('playing');
        label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '';
        break;
      }
      default:
        label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '';
    }
    const n: RawNode = {
      el,
      tag: skelTag(el),
      role: skelRole(role),
      kind: 'media',
      box: b,
      flags,
      kids: [],
    };
    const l = cutLabel(label);
    if (l) n.label = l;
    return [n];
  }

  private heading(
    el: Element,
    cs: CSSStyleDeclaration,
    box: Box,
    flags: Set<SkelFlag>,
  ): RawNode[] {
    const vis = visibleText(el, { max: 400, openClosed: this.oc });
    const name = vis || accessibleName(el, this.oc);
    if (!name) return [];
    const n: RawNode = {
      el,
      tag: skelTag(el),
      role: 'heading',
      kind: 'heading',
      box,
      level: headingLevel(el),
      flags,
      kids: [],
      label: cutLabel(name),
    };
    if (vis) {
      const pat = vis.length <= SHORT_TEXT_MAX ? textPatterns(vis) : [];
      n.text = pat.length ? { chars: vis.length, pat } : { chars: vis.length };
    }
    const link = el.querySelector('a[href]') ?? el.closest('a[href]');
    if (link) {
      flags.add('headlink');
      n.href = hrefKind(link.getAttribute('href'), this.pageUrl);
    }
    return [this.textStyle(n, el, cs)];
  }

  private table(
    el: Element,
    cs: CSSStyleDeclaration,
    box: Box,
    role: string | null,
    flags: Set<SkelFlag>,
  ): RawNode[] {
    const chars = normalizeSpace(
      (el.textContent ?? '').slice(0, 100_000),
    ).length;
    const links = el.querySelectorAll('a[href]').length;
    const n: RawNode = {
      el,
      tag: skelTag(el),
      role: skelRole(role) ?? 'table',
      kind: 'table',
      box,
      flags,
      kids: [],
    };
    if (chars || links) n.text = links ? { chars, links } : { chars };
    const caption = el.querySelector(':scope > caption');
    const name =
      el.getAttribute('aria-label') ??
      (caption ? visibleText(caption, { max: 200 }) : '');
    if (name) n.label = cutLabel(name);
    const px = parseFloat(cs.fontSize);
    if (Number.isFinite(px) && px > 0) n.fontPx = round1(px);
    return [n];
  }

  private isInput(el: Element, tag: string, role: string | null): boolean {
    if (tag === 'select' || tag === 'textarea') return true;
    // A submit button given a radio or checkbox role (a swatch drawn over
    // its picture) is that input to people and assistive technology.
    if (tag === 'input')
      return !isButtonInput(el) || (role !== null && INPUT_ROLES.has(role));
    if (role && INPUT_ROLES.has(role)) return true;
    return isEditableRoot(el);
  }

  private input(
    el: Element,
    cs: CSSStyleDeclaration,
    box: Box,
    role: string | null,
    flags: Set<SkelFlag>,
  ): RawNode[] {
    if (isSensitiveField(el)) {
      this.sensitive = true;
      return [];
    }
    const editable = isEditableRoot(el);
    if (editable) flags.add('editable');
    const n: RawNode = {
      el,
      tag: skelTag(el),
      role: skelRole(role) ?? (editable ? 'textbox' : null),
      kind: 'input',
      box,
      flags,
      kids: [],
      inputType: editable && !role ? 'textarea' : inputTypeOf(el, role),
    };
    if (el.localName === 'select')
      n.options = (el as HTMLSelectElement).options.length;
    const name = accessibleName(el, this.oc);
    if (name) n.label = cutLabel(name);
    return [this.textStyle(n, el, cs)];
  }

  private isControl(
    el: Element,
    cs: CSSStyleDeclaration,
    tag: string,
    role: string | null,
    r: DOMRect,
  ): boolean {
    if (role && CONTROL_ROLES.has(role)) return true;
    if (tag === 'body' || tag === 'html') return false;
    if (role && (LANDMARK_ROLES.has(role) || KEEP_ROLES.has(role)))
      return false;
    const big = r.width * r.height > 0.4 * this.vw * this.vh;
    if (big) return false;
    const ti = el.getAttribute('tabindex');
    if (ti !== null && Number(ti) >= 0) return true;
    if (cs.cursor !== 'pointer') return false;
    // Inherited pointer (a link's inner span) or a pointer card around real
    // controls is not a control of its own.
    const p = composedParentOf(el, this.oc);
    if (p && this.view.getComputedStyle(p).cursor === 'pointer') return false;
    return !el.querySelector(INTERACTIVE);
  }

  private *control(
    el: Element,
    cs: CSSStyleDeclaration,
    r: DOMRect,
    box: Box,
    role: string | null,
    flags: Set<SkelFlag>,
    ctx: Ctx,
  ): Gen<RawNode[]> {
    const tag = el.localName;
    const inner = REPLACED.has(tag) ? [] : yield* this.flatKids(el, ctx);
    const name = accessibleName(el, this.oc);
    const vis = visibleText(el, { max: 400, openClosed: this.oc });
    const media = inner.flatMap((n) =>
      n.kind === 'media' ? [n] : n.kids.filter((k) => k.kind === 'media'),
    );
    const hasMedia = media.length > 0;
    // A thumbnail link: an image covering half the control or more, whatever
    // text is drawn over it (a video's duration, a "New" badge).
    const thumb = media.some(
      (m) => m.box[2] * m.box[3] >= 0.5 * r.width * r.height,
    );
    const n: RawNode = {
      el,
      tag: skelTag(el),
      role: skelRole(role),
      kind: 'control',
      box,
      flags,
      kids: [],
    };
    if (name) n.label = cutLabel(name);
    if (el.closest('[aria-hidden="true"]')) n.ariaHidden = true;
    if (vis) {
      const pat = vis.length <= SHORT_TEXT_MAX ? textPatterns(vis) : [];
      n.text = pat.length ? { chars: vis.length, pat } : { chars: vis.length };
    }
    if (thumb || (!vis && hasMedia)) flags.add('imgctrl');
    else if (!vis && !isButtonInput(el)) flags.add('icon');
    const href = el.getAttribute('href');
    if (role === 'link' || href !== null) {
      n.href = hrefKind(href, this.pageUrl);
      if (n.href === 'other' && isIdentityProvider(href, this.pageUrl))
        n.idp = true;
    }
    // Keep the parts of a card-like control, and anything actionable inside.
    const card =
      inner.length >= 2 &&
      (r.width * r.height >= 100 * 60 ||
        inner.some((k) => k.kind === 'heading' || k.kind === 'media'));
    const nested = inner.some(
      (k) =>
        k.kind === 'control' || k.kind === 'input' || k.kind === 'collection',
    );
    if (card || nested || thumb) n.kids = inner;
    this.textStyle(n, el, cs);
    return [n];
  }

  /** Every element child is inline content (memoised per element). */
  private phrasingOnly(el: Element): boolean {
    const memo = this.phrasing.get(el);
    if (memo !== undefined) return memo;
    let ok = true;
    for (const c of el.children) {
      const t = c.localName;
      if (SKEL_SKIP.has(t)) continue;
      if (t === 'img' || t === 'picture') {
        const img = (
          t === 'img' ? c : c.querySelector('img')
        ) as HTMLImageElement | null;
        // A large image is content of its own, not an inline glyph.
        if (img && (img.width >= 64 || img.height >= 64)) {
          ok = false;
          break;
        }
        continue;
      }
      if (t === 'svg' || t === 'math') continue;
      // An inline element with a widget role (a star toggle, a checkbox
      // span) is a control inside the text, so the text is not one block.
      const r = explicitRole(c);
      if (
        (r && (INPUT_ROLES.has(r) || (CONTROL_ROLES.has(r) && r !== 'link'))) ||
        c.hasAttribute('contenteditable')
      ) {
        ok = false;
        break;
      }
      const inlineCustom =
        t.includes('-') &&
        !shadowOf(c, this.oc) &&
        this.view.getComputedStyle(c).display.startsWith('inline');
      if ((!PHRASING.has(t) && !inlineCustom) || !this.phrasingOnly(c)) {
        ok = false;
        break;
      }
    }
    this.phrasing.set(el, ok);
    return ok;
  }

  /** A text block, null when the element is not one, 'empty' when nothing of it is visible. */
  private text(
    el: Element,
    cs: CSSStyleDeclaration,
    box: Box,
    role: string | null,
    flags: Set<SkelFlag>,
    ctx: Ctx,
  ): RawNode | 'empty' | null {
    const tag = el.localName;
    const raw = el.textContent ?? '';
    const len = normalizeSpace(
      raw.length > 100_000 ? raw.slice(0, 100_000) : raw,
    ).length;
    if (!len) return null;
    const isPara =
      PARA_TAGS.has(tag) || tag.includes('-') || directTextLength(el) > 0;
    if (!isPara && len > SHORT_TEXT_MAX) return null;
    if (!isPara || ctx.record) {
      // Separate pieces ("1.2M views", "3 days ago"; a subject and its
      // snippet in a record) stay separate fields; a price drawn in pieces
      // ("CAD" "18." "41") is one.
      let pieces = 0;
      for (const c of el.children)
        if (/\S/.test(c.textContent ?? '') && ++pieces >= 2) break;
      if (
        pieces >= 2 &&
        !isPriceAtom(visibleText(el, { max: 60, openClosed: this.oc }))
      )
        return null;
    }
    const anchors = el.querySelectorAll('a[href]');
    let linkTxt = 0;
    for (const a of anchors)
      linkTxt += normalizeSpace(a.textContent ?? '').length;
    // Link lists and single links are controls, not text.
    if (anchors.length >= 2 && linkTxt / len > 0.7) return null;
    if (anchors.length === 1 && linkTxt / len > 0.9) return null;
    let chars = len;
    let shown = '';
    if (len <= 2 * SHORT_TEXT_MAX) {
      shown = visibleText(el, { max: 200, openClosed: this.oc });
      // Separator glyphs ("•", "|", "›") between pieces are not text of their own.
      if (!shown || separatorsOnly(shown)) return 'empty';
      chars = shown.length;
    }
    const short = chars <= SHORT_TEXT_MAX;
    const n: RawNode = {
      el,
      tag: skelTag(el),
      role: skelRole(role),
      kind: short ? 'stext' : 'text',
      box,
      flags,
      kids: [],
      text: { chars },
    };
    if (anchors.length) (n.text as { links?: number }).links = anchors.length;
    if (short) {
      n.label = cutLabel(shown);
      const pat = textPatterns(shown);
      if (pat.length) (n.text as { pat?: typeof pat }).pat = pat;
    }
    if (el.closest('[aria-hidden="true"]')) n.ariaHidden = true;
    return this.textStyle(n, el, cs);
  }

  private *group(
    el: Element,
    cs: CSSStyleDeclaration,
    r: DOMRect,
    box: Box,
    role: string | null,
    flags: Set<SkelFlag>,
    ctx: Ctx,
  ): Gen<RawNode[]> {
    const tag = el.localName;
    let inner = dedupeAriaHidden(yield* this.flatKids(el, ctx));
    // A background-image box (thumbnail, hero) is media of its own.
    const bg = cs.backgroundImage;
    if (
      !ctx.hover &&
      bg &&
      bg !== 'none' &&
      bg.includes('url(') &&
      r.width >= 120 &&
      r.height >= 80 &&
      tag !== 'body' &&
      tag !== 'html' &&
      !(
        cs.backgroundRepeat.startsWith('repeat') &&
        /^auto(?: auto)?$/.test(cs.backgroundSize)
      )
    ) {
      inner = [
        {
          el,
          tag: skelTag(el),
          role: null,
          kind: 'media',
          box,
          flags: new Set(),
          kids: [],
          label: cutLabel(el.getAttribute('aria-label') ?? '') || undefined,
        },
        ...inner,
      ];
    }
    const own = directTextLength(el);
    const landmark = role !== null && LANDMARK_ROLES.has(role);
    const keep = landmark || (role !== null && KEEP_ROLES.has(role));
    if (inner.length === 0) {
      if (own === 0) return [];
      // Mixed content whose element children are all hidden: a text block.
      const shown = visibleText(el, { max: 4000, openClosed: this.oc });
      if (!shown || separatorsOnly(shown)) return [];
      const short = shown.length <= SHORT_TEXT_MAX;
      const t: RawNode = {
        el,
        tag: skelTag(el),
        role: skelRole(role),
        kind: short ? 'stext' : 'text',
        box,
        flags,
        kids: [],
        text: { chars: shown.length },
      };
      if (short) {
        t.label = cutLabel(shown);
        const pat = textPatterns(shown);
        if (pat.length) (t.text as { pat?: typeof pat }).pat = pat;
      }
      return [this.textStyle(t, el, cs)];
    }
    if (inner.length === 1 && !keep && own === 0) {
      const only = inner[0] as RawNode;
      for (const f of flags) only.flags.add(f);
      return [only];
    }
    const n: RawNode = {
      el,
      tag: skelTag(el),
      role: skelRole(role),
      kind: landmark ? 'landmark' : 'group',
      box,
      flags,
      kids: inner,
    };
    if (own > 0) {
      n.text = { chars: own };
      this.textStyle(n, el, cs);
    }
    if (
      keep &&
      (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby'))
    ) {
      const name = accessibleName(el, this.oc);
      if (name) n.label = cutLabel(name);
    }
    return [n];
  }

  // ---------------------------------------------------------------------------
  // Children, collections, hover-only actions
  // ---------------------------------------------------------------------------

  private *flatKids(el: Element, ctx: Ctx): Gen<RawNode[]> {
    const sr = shadowOf(el, this.oc);
    if (sr) this.noteShadow(sr);
    const ch = composedKids(el, this.oc).filter(
      (c) => !SKEL_SKIP.has(c.localName),
    );
    if (ch.length === 0) return [];
    const starts = new Map<number, QualifiedRun>();
    const inRun = new Set<number>();
    // Inside a record every child is a distinct field: no nested collections.
    const reading = !this.stopped || (this.precious > 0 && !this.exhausted);
    if (!ctx.record && !ctx.hover && ch.length >= 3 && reading) {
      const found: Array<{ idx: number[]; run: QualifiedRun }> = [];
      for (const idx of groupRuns(ch)) {
        const run = qualifyRun(
          idx.map((i) => ch[i] as Element),
          {
            vw: this.vw,
            vh: this.vh,
            kids: (e) => composedKids(e, this.oc),
            openClosed: this.oc,
          },
        );
        if (run) found.push({ idx, run });
      }
      // Interleaved runs (items and their separators): the larger one wins.
      found.sort((a, b) => runArea(b.run) - runArea(a.run));
      const kept: Array<{ idx: number[]; run: QualifiedRun }> = [];
      for (const f of found) {
        const lo = f.idx[0] as number;
        const hi = f.idx[f.idx.length - 1] as number;
        const clash = kept.some(
          (k) =>
            lo <= (k.idx[k.idx.length - 1] as number) &&
            hi >= (k.idx[0] as number),
        );
        if (!clash) kept.push(f);
      }
      for (const k of kept) {
        starts.set(k.idx[0] as number, k.run);
        for (const i of k.idx) inRun.add(i);
      }
    }
    const out: RawNode[] = [];
    for (let i = 0; i < ch.length; i++) {
      const run = starts.get(i);
      if (run) {
        out.push(...(yield* this.collection(el, run, ctx)));
        continue;
      }
      if (inRun.has(i)) continue;
      out.push(...(yield* this.build(ch[i] as Element, ctx)));
    }
    return out;
  }

  private *collection(
    container: Element,
    run: QualifiedRun,
    ctx: Ctx,
  ): Gen<RawNode[]> {
    // Candidates: the first six members that are not ads (ads are skipped,
    // never the exemplar, unless the run holds nothing else).
    const built: Built[] = [];
    const ads: Built[] = [];
    let scanned = 0;
    for (const m of run.members) {
      if (built.length >= 6 || scanned >= 12) break;
      scanned++;
      const ad = isAdRecord(m);
      if (ad && ads.length >= 1) {
        if (hasSensitiveInside(m)) {
          this.sensitive = true;
          return [];
        }
        continue;
      }
      const nodes = yield* this.build(m, {
        record: m,
        hover: false,
        hoverBox: null,
        depth: ctx.depth + 1,
      });
      if (nodes.length === 0) continue;
      const n =
        nodes.length === 1 ? (nodes[0] as RawNode) : this.wrap(m, nodes);
      const b: Built = { m, n, size: countNodes(n), shape: shapeOf(n) };
      if (ad || n.flags.has('adhint')) ads.push(b);
      else built.push(b);
    }
    if (this.sensitive) return [];
    // Members not built may still hold a password or payment field.
    for (const m of run.members.slice(scanned)) {
      if (hasSensitiveInside(m)) {
        this.sensitive = true;
        return [];
      }
    }
    const pool = built.length ? built : ads;
    if (pool.length === 0) return [];
    const best = medoid(pool);
    const ex = best.n;
    capExemplar(ex, SKEL_MAX_EXEMPLAR_NODES);
    forEachNode(ex, (n) => {
      n.slot = true;
    });
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const r of run.rects) {
      x0 = Math.min(x0, r.left);
      y0 = Math.min(y0, r.top);
      x1 = Math.max(x1, r.right);
      y1 = Math.max(y1, r.bottom);
    }
    const role = roleOf(container);
    return [
      {
        el: container,
        tag: skelTag(container),
        role: skelRole(role),
        kind: 'collection',
        box: [
          Math.round(x0 + this.sx),
          Math.round(y0 + this.sy),
          Math.round(x1 - x0),
          Math.round(y1 - y0),
        ],
        flags: new Set(),
        kids: [],
        list: {
          container,
          members: run.members,
          sig: runTemplate(run.members),
          exemplar: ex,
          exemplarEl: best.m,
          itemTag: skelTag(best.m),
        },
      },
    ];
  }

  /** A member that produced several top-level nodes, as one group. */
  private wrap(m: Element, nodes: RawNode[]): RawNode {
    const r = m.getBoundingClientRect();
    return {
      el: m,
      tag: skelTag(m),
      role: skelRole(roleOf(m)),
      kind: 'group',
      box: [
        Math.round(r.left + this.sx),
        Math.round(r.top + this.sy),
        Math.round(r.width),
        Math.round(r.height),
      ],
      flags: new Set(),
      kids: nodes,
    };
  }

  /**
   * A hidden part of a record: kept, flagged 'hoveronly', when it holds an
   * action and is revealed by hover or focus (opacity or visibility toggled,
   * or a :hover/:focus-within rule that shows it).
   */
  private *hoverHidden(
    el: Element,
    cs: CSSStyleDeclaration,
    ctx: Ctx,
    displayNone: boolean,
  ): Gen<RawNode[]> {
    if (!el.matches(ACTION_SELECTOR) && !el.querySelector(ACTION_SELECTOR))
      return [];
    if (displayNone && !this.revealedOnHover(el)) return [];
    const r = el.getBoundingClientRect();
    let hoverBox: Box;
    if (r.width >= 1 || r.height >= 1) {
      hoverBox = [
        Math.round(r.left + this.sx),
        Math.round(r.top + this.sy),
        Math.round(r.width),
        Math.round(r.height),
      ];
    } else {
      let a = composedParentOf(el, this.oc);
      let ar = a?.getBoundingClientRect();
      for (let i = 0; a && ar && ar.width < 1 && ar.height < 1 && i < 8; i++) {
        a = composedParentOf(a, this.oc);
        ar = a?.getBoundingClientRect();
      }
      hoverBox = ar
        ? [Math.round(ar.left + this.sx), Math.round(ar.top + this.sy), 0, 0]
        : [0, 0, 0, 0];
    }
    const hctx: Ctx = { ...ctx, hover: true, hoverBox, depth: ctx.depth + 1 };
    const nodes = yield* this.buildVisible(
      el,
      cs,
      r,
      hctx.hoverBox as Box,
      hctx,
    );
    return pruneToActions(nodes);
  }

  private revealedOnHover(el: Element): boolean {
    if (!this.hoverTargets) {
      const sheets: CSSStyleSheet[] = [...this.doc.styleSheets];
      const adopted = (root: Document | ShadowRoot): CSSStyleSheet[] =>
        (root as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ??
        [];
      sheets.push(...adopted(this.doc));
      for (const sr of this.shadowRoots)
        sheets.push(...sr.styleSheets, ...adopted(sr));
      this.hoverTargets = revealTargets(sheets);
    }
    for (const sel of this.hoverTargets) {
      try {
        if (el.matches(sel)) return true;
      } catch {
        // An unsupported selector in a stylesheet: ignore it.
      }
    }
    return false;
  }

  /** Out of time: one summarised node per remaining subtree. */
  private summary(el: Element): RawNode[] {
    this.truncated = true;
    if (this.summaries >= 300) return [];
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || !isVisible(el)) return [];
    this.summaries++;
    const role = roleOf(el);
    const tag = el.localName;
    const box: Box = [
      Math.round(r.left + this.sx),
      Math.round(r.top + this.sy),
      Math.round(r.width),
      Math.round(r.height),
    ];
    const kind = MEDIA_TAGS.has(tag)
      ? 'media'
      : role && CONTROL_ROLES.has(role)
        ? 'control'
        : role && LANDMARK_ROLES.has(role)
          ? 'landmark'
          : 'group';
    const n: RawNode = {
      el,
      tag: skelTag(el),
      role: skelRole(role),
      kind,
      box,
      flags: new Set(),
      kids: [],
      collapsed: kind === 'group' || kind === 'landmark',
    };
    if (kind === 'control') {
      const name = accessibleName(el, this.oc);
      if (name) n.label = cutLabel(name);
    }
    if (kind !== 'media') {
      const chars = normalizeSpace(
        (el.textContent ?? '').slice(0, 20_000),
      ).length;
      const links = el.getElementsByTagName('a').length;
      if (chars || links) n.text = links ? { chars, links } : { chars };
    }
    return [n];
  }
}

interface Built {
  m: Element;
  n: RawNode;
  size: number;
  /** Paths of kind/tag/role from the member root (structure, not text). */
  shape: Set<string>;
}

/**
 * A built member's structure: the kind, tag and role path of every node,
 * counted (a row with an extra badge span differs from one without).
 */
function shapeOf(root: RawNode): Set<string> {
  const out = new Set<string>();
  const seen = new Map<string, number>();
  const walk = (n: RawNode, path: string, d: number): void => {
    const p = `${path}/${n.kind}:${n.tag}:${n.role ?? ''}`;
    const k = (seen.get(p) ?? 0) + 1;
    seen.set(p, k);
    out.add(`${p}#${k}`);
    if (d < 8) for (const c of n.kids) walk(c, p, d + 1);
  };
  walk(root, '', 0);
  return out;
}

/**
 * The exemplar: the most typical member, the one whose structure agrees
 * best with the others' (ties: the richer one). One odd member (a promoted
 * slot, a row with an extra badge) never sets the slots for the rest.
 */
function medoid(pool: readonly Built[]): Built {
  let best = pool[0] as Built;
  let bestScore = -1;
  for (const a of pool) {
    let score = 0;
    for (const b of pool) {
      if (a === b) continue;
      let inter = 0;
      for (const x of a.shape) if (b.shape.has(x)) inter++;
      score += inter / (a.shape.size + b.shape.size - inter || 1);
    }
    if (
      score > bestScore + 1e-9 ||
      (Math.abs(score - bestScore) <= 1e-9 && a.size > best.size)
    ) {
      best = a;
      bestScore = score;
    }
  }
  return best;
}

/** Text made only of punctuation and separator glyphs ("•", "·", "|", "›", "—"). */
export function separatorsOnly(s: string): boolean {
  return /^[\p{P}\p{Sm}\s]+$/u.test(s) && !/[\p{L}\p{N}]/u.test(s);
}

/** The element that holds a node's text: down single text-bearing children, at most 4 levels. */
function textHost(el: Element): Element {
  let cur = el;
  for (let i = 0; i < 4; i++) {
    if (directTextLength(cur) > 0) return cur;
    let only: Element | null = null;
    for (const c of cur.children) {
      if (!/\S/.test(c.textContent ?? '')) continue;
      if (only) return cur;
      only = c;
    }
    if (!only) return cur;
    cur = only;
  }
  return cur;
}

/** contenteditable roots and known rich-editor roots. */
export function isEditableRoot(el: Element): boolean {
  const ce = el.getAttribute('contenteditable');
  if (ce !== null && ce.toLowerCase() !== 'false') {
    const p = el.parentElement;
    return !(p && (p as HTMLElement).isContentEditable);
  }
  return el.matches(EDITOR_ROOT);
}

function hasSensitiveInside(m: Element): boolean {
  for (const el of m.querySelectorAll('input, iframe'))
    if (isSensitiveField(el)) return true;
  return false;
}

/**
 * Data tables are summarised; a table of interactive rows with no headers
 * (an inbox, a file list) is a list of records and is read as one.
 */
export function isDataTable(el: Element): boolean {
  const rows = el.querySelectorAll(
    ':scope > tbody > tr, :scope > thead > tr, :scope > tr, :scope > [role="rowgroup"] > [role="row"], :scope > [role="row"]',
  );
  if (rows.length < 2) return false;
  const headers =
    el.querySelector(
      ':scope > caption, :scope > thead th, :scope > tbody > tr > th, :scope > tr > th, [role="columnheader"], [role="rowheader"]',
    ) !== null;
  let interactive = 0;
  let n = 0;
  for (const row of rows) {
    if (++n > 60) break;
    if (row.querySelector(INTERACTIVE) || row.matches(INTERACTIVE))
      interactive++;
  }
  const share = interactive / Math.min(rows.length, 60);
  if (!headers) return share < 0.5;
  // Headed tables are data, unless every row is an actionable record of a grid.
  const grid = /^(?:grid|treegrid)$/.test(el.getAttribute('role') ?? '');
  return !(grid && share >= 0.8);
}

/**
 * One price and nothing else ("CAD18.41", "$ 1,299.00", "18,41 €"): a price
 * the site draws in pieces (currency, whole, raised cents) reads as one text.
 */
export function isPriceAtom(s: string): boolean {
  const t = normalizeSpace(s);
  return (
    t.length > 0 &&
    t.length <= 20 &&
    PRICE_ATOM.test(t) &&
    textPatterns(t).includes('price')
  );
}
const PRICE_ATOM =
  /^(?:[A-Z]{2,3}\$?|[$€£¥₹₩₽₺₪₫฿])?\s?\d[\d.,\s]*(?:\s?(?:[A-Z]{3}|[$€£¥₹₩₽₺₪₫฿]))?$/u;

/**
 * Drop aria-hidden copies of a sibling control: short texts that only repeat
 * its name, and a custom drawn dropdown that stands in front of a native
 * select (the select is the control people and assistive technology use).
 */
function dedupeAriaHidden(nodes: RawNode[]): RawNode[] {
  if (nodes.length < 2) return nodes;
  const names = new Set<string>();
  let select = false;
  for (const o of nodes) {
    if ((o.kind === 'control' || o.kind === 'input') && o.label)
      names.add(o.label.toLowerCase());
    if (o.kind === 'input' && o.el.localName === 'select') select = true;
  }
  if (names.size === 0) return nodes;
  return nodes.filter((n) => {
    if (!n.ariaHidden) return true;
    if (n.kind === 'stext')
      return !(n.label && names.has(n.label.toLowerCase()));
    // A hidden, unfocusable control beside a native select is its drawing.
    return !(select && n.kind === 'control' && !focusable(n.el));
  });
}

function focusable(el: Element): boolean {
  const ti = el.getAttribute('tabindex');
  return ti !== null && Number(ti) >= 0;
}

/** Keep only actions (controls, inputs) and the groups that hold them. */
function pruneToActions(nodes: RawNode[]): RawNode[] {
  const out: RawNode[] = [];
  for (const n of nodes) {
    if (n.kind === 'control' || n.kind === 'input') {
      out.push(n);
      continue;
    }
    const kids = pruneToActions(n.kids);
    if (kids.length === 0) continue;
    if (kids.length === 1) {
      const only = kids[0] as RawNode;
      for (const f of n.flags) only.flags.add(f);
      out.push(only);
      continue;
    }
    n.kids = kids;
    out.push(n);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Passes over the finished tree
// -----------------------------------------------------------------------------

const TEXTISH = new Set(['stext', 'text', 'heading', 'control']);

/** 'overlay': text drawn on top of an image, video or background-image box. */
export function markOverlay(root: RawNode): void {
  const media: RawNode[] = [];
  const texts: RawNode[] = [];
  forEachNode(root, (n) => {
    if (n.kind === 'media' && n.box[2] * n.box[3] > 0) media.push(n);
    else if (TEXTISH.has(n.kind) && n.text && n.box[2] * n.box[3] > 0)
      texts.push(n);
  });
  if (!media.length || !texts.length) return;
  for (const t of texts) {
    const [tx, ty, tw, th] = t.box;
    const area = tw * th;
    for (const m of media) {
      // A control drawn around its own thumbnail is not on top of it.
      if (m.el === t.el || t.el.contains(m.el)) continue;
      const [mx, my, mw, mh] = m.box;
      if (mw * mh <= area) continue;
      const ix = Math.min(tx + tw, mx + mw) - Math.max(tx, mx);
      const iy = Math.min(ty + th, my + mh) - Math.max(ty, my);
      if (ix > 0 && iy > 0 && (ix * iy) / area >= 0.6) {
        t.flags.add('overlay');
        break;
      }
    }
  }
}

/** 'bold': text rendered bold (>= 600) where its sibling texts are not. */
export function markBold(root: RawNode): void {
  forEachNode(root, (n) => {
    if (n.kids.length < 2) return;
    const texts = n.kids.filter(
      (k) =>
        (k.kind === 'stext' || k.kind === 'text' || k.kind === 'control') &&
        typeof k.weight === 'number',
    );
    if (texts.length < 2) return;
    const heavy = texts.filter((k) => (k.weight as number) >= 600);
    if (heavy.length === 0 || heavy.length === texts.length) return;
    for (const k of heavy) k.flags.add('bold');
  });
}

/** 'focus': the deepest kept node that holds the focused element. */
export function markFocus(
  root: RawNode,
  active: Element | null,
  openClosed?: OpenClosed,
): void {
  if (!active) return;
  const byEl = new Map<Element, RawNode>();
  forEachNode(root, (n) => {
    if (n !== root) byEl.set(n.el, n);
  });
  for (
    let e: Element | null = active, i = 0;
    e && i < 200;
    e = composedParentOf(e, openClosed), i++
  ) {
    const n = byEl.get(e);
    if (n) {
      n.flags.add('focus');
      return;
    }
  }
}
