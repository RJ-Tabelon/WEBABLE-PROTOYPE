import type { PlannedOp } from '@webable/core/policy/types';

import type { TextFact } from '../types';
import { median, round, weightedMedian } from '../util/buckets';
import { avgCharWidth, lineHeightPx, xHeightRatio } from '../extract/text';
import {
  composedContains,
  composedParent,
  directText,
  directTextLength,
  isIconFont,
  isOurs,
  landmarkOf,
  SKIP_TAGS,
} from '../util/dom';
import { area, boxOf, intersection } from '../util/geometry';
import {
  classSignature,
  controlCeiling,
  groupCache,
  isControlText,
  isRecordGroup,
  isRepeated,
  overflowOf,
  regionResolver,
  regionRootsOf,
  sizeGroup,
  templateKey,
  visuallyHidden,
  type GroupCache,
} from '../verify/checks';
import { tok } from './css';
import type { OpCss } from './layer';
import { tokenOp, tokensOf } from './marks';
import { rankRange, solveRanks, SIZE_EPS, type RankPoint } from './rank';
import { notNeeded, type OpEnv, type OpImpl, type Prepared } from './types';

/** Digits, a no-break space, then the unit (design-final.md 13.1 rule 3). */
export const px = (n: number): string => `${Math.round(n)} px`;
export const ch = (n: number): string => `${Math.round(n)} characters`;

/** Text the reading ops never restyle: code, form fields, editors. */
const NO_TEXT_OPS =
  'pre, code, kbd, samp, textarea, select, option, input, [contenteditable="true"], [contenteditable=""]';
const RUNNING_TEXT =
  /^(p|li|dd|dt|blockquote|figcaption|td|th|div|section|article|span|label|small|em|strong|a)$/;
const BLOCK_DISPLAY = /^(block|list-item|flow-root|table-cell)$/;

function liveText(env: OpEnv): TextFact[] {
  return env.facts.text.filter(
    (t) => t.el.isConnected && !t.icon && !t.el.closest(NO_TEXT_OPS),
  );
}

/** Text facts inside the op's scope: plan regions, else main content, else the page. */
function scopedText(env: OpEnv, scope: PlannedOp['scope']): TextFact[] {
  const all = liveText(env);
  const roots =
    scope === 'page'
      ? env.facts.main
        ? [env.facts.main]
        : []
      : env.resolve(scope);
  if (roots.length === 0) return all;
  return all.filter((t) => roots.some((r) => composedContains(r, t.el)));
}

function inViewportFirst(env: OpEnv, els: Element[]): Element[] {
  const vh = env.view.innerHeight;
  const scored = els.slice(0, 200).map((el) => {
    const r = el.getBoundingClientRect();
    return { el, s: r.bottom > 0 && r.top < vh ? 0 : 1 };
  });
  return scored.sort((a, b) => a.s - b.s).map((x) => x.el);
}

/**
 * The roots text_floor works in (docs/10 §5.2, "main region only"): the plan's
 * regions, else the main content, else the body with every landmark that is
 * not content (banner, navigation, footer, asides) left alone.
 */
export function textScope(
  env: Pick<OpEnv, 'doc' | 'facts' | 'resolve'>,
  scope: PlannedOp['scope'],
): { roots: Element[]; body: boolean } {
  if (scope !== 'page') {
    const els = env.resolve(scope).filter((el) => el.isConnected);
    const roots = els.filter(
      (el) => !els.some((o) => o !== el && composedContains(o, el)),
    );
    if (roots.length) return { roots, body: false };
  }
  const main = env.facts.main;
  if (
    main?.isConnected &&
    main !== env.doc.body &&
    main !== env.doc.documentElement
  ) {
    // Main found as one root of a component that repeats (one card of a
    // row): the others hold the same fields, which take the same sizes.
    const roots = [main];
    for (const list of env.facts.regions.values()) {
      if (list.length < 2 || !list.some((f) => f.el === main)) continue;
      for (const f of list)
        if (
          f.el.isConnected &&
          !roots.some(
            (r) => composedContains(r, f.el) || composedContains(f.el, r),
          )
        )
          roots.push(f.el);
    }
    return { roots, body: false };
  }
  return { roots: [env.doc.body], body: true };
}

// ---------------------------------------------------------------------------
// text_floor: one order-preserving map over main content (docs/10 §5.2)
// ---------------------------------------------------------------------------

/*
 * The policy's level is the effective px the person reads running text at;
 * at the tab's zoom z (the person's own zoom times WebAble's page scale) the
 * op aims for F = level / z CSS px. Body size b is the
 * character-weighted median of the running text it may resize, r = F / b the
 * residual scale (not needed at r <= 1.05), and every size s in scope maps
 * through one monotone compressive curve, log-linear around b and fitted to
 * iOS Dynamic Type and Android 14 (research: discovery 07 §4.1):
 *
 *   s >= b         F (s/b)^cHigh     cHigh = max(0.2, 1 - 0.48 log2 r)
 *   sLo <= s < b   F                 running text all reaches F
 *   s < sLo        F (s/sLo)^cLow    cLow  = max(0.7, 1 - 0.35 log2 r)
 *
 * and never below s. sLo is the smallest running text (at least 0.75 b), so
 * headings grow less than body text and small labels stay below it. Other
 * roles (bylines, buttons, badges, timestamps) keep their rank against
 * running text and headings: below body size they follow F (s/b)^cLow, so a
 * 12 px label stays below body text, and above it never pass f(body) unless
 * a running text or heading natively no larger went higher.
 *
 * Decisions are per template field (tag + classes + the parent's): every
 * instance gets the same size. A class where any instance can cut text off
 * (ellipsis, a line clamp, a clipping or fixed-height box within three
 * ancestors, text over a picture, a full no-wrap row) is excluded as a class;
 * text in a control whose box is fixed grows only as far as it fits, and
 * one-line rows of a template only as far as none of them wraps. A field
 * that would grow by less than 6% is held. Then size order per region
 * (ops/rank.ts): every field ranks with every text of the regions its
 * instances are in, whatever holds that text (navigation, chips, pinned
 * boxes, excluded or held fields, other ops' scope). A field never passes a
 * text natively larger than it (a tie at most), and in a record stays under
 * one that keeps its size by the compressed native ratio, except that a
 * control's label is no ceiling for running text and a glyph label (a "+"
 * button, an icon) none for any text (controlCeiling); one size per
 * template, also across atomic-CSS fields that differ past a third class;
 * an inline field (a link in a paragraph) never outgrows its paragraph, and
 * inline text with no field of its own (code) is pinned where it would pass
 * a larger text of its region. Navigation, banners, footers, chips, fixed or
 * sticky boxes and overlays are never touched. The verifier then checks the
 * page per region; a failure rolls the whole op back, never one element.
 */

const LH_BUCKETS = [1.35, 1.5, 1.65, 1.8] as const;
/** Growth below this is noise beside the layout risk: the field is held. */
const MIN_GROWTH = 0.06;
/** Sizes are written in quarter pixels: one token per distinct size. */
const QUARTERS = 4;
const quarter = (n: number): number => Math.round(n * QUARTERS);
/** Instances read per class, and in total. */
const MAX_PER_CLASS = 1500;
const MAX_INSTANCES = 6000;
/** Instances whose clip risk is read per class (in view first). */
const RISK_SAMPLE = 40;
/** Texts read as ranked neighbours (fixed points), and one-line rows measured. */
const MAX_RANKED = 5000;
const MAX_ROW_LINES = 600;
/** Instances per field read for inline fields inside it. */
const FOLLOWER_SAMPLE = 24;
/** Inline texts without a field of their own checked against their region. */
const MAX_FOLLOWERS = 3000;
/** Share of a class's instances that must be one-line rows for the row rule. */
const ROW_MAJORITY = 0.6;

type Role = 'running' | 'heading' | 'other';
type Risk =
  | 'ellipsis'
  | 'clamp'
  | 'clip'
  | 'fixed_height'
  | 'overlay'
  | 'crowded_row'
  | 'wide_nowrap'
  | 'dropped';

interface Field {
  cls: string;
  /** Native size, px (quarter-pixel precision). */
  s: number;
  role: Role;
  /** Size it is written at, px (s when held). */
  t: number;
  held: 'excluded' | 'small' | null;
}

interface ClassInfo {
  role: Role;
  risk: Risk | null;
  /** Measured and verified in a batch, or first seen in later content. */
  origin: 'batch' | 'runtime';
}

/** One applied text_floor decision, kept for content that arrives later. */
interface TextPlan {
  roots: Element[];
  body: boolean;
  /** Target for running text, CSS px. */
  F: number;
  b: number;
  sLo: number;
  cHigh: number;
  cLow: number;
  /** Native sizes of resized running text and headings, ascending. */
  anchors: number[];
  classes: Map<string, ClassInfo>;
  fields: Map<string, Field>;
  byClass: Map<string, Field[]>;
  /** The region each text ranks in (the extraction's regions, by key). */
  regionOf: (el: Element) => string;
  /** Settled points per region, for fields first seen in later content. */
  points: Map<
    string,
    Array<{
      s: number;
      after: number;
      fixed: boolean;
      control?: RankPoint['control'];
    }>
  >;
  /** Native sizes closer than this are tied: half an effective pixel, CSS px. */
  eps: number;
  /** Quarter-pixel sizes with a rule in the block. */
  quarters: Set<number>;
  running: WeakSet<Element>;
  /** Held text inside resized text, written at its own size. */
  pinned: WeakSet<Element>;
}

const PLANS = new WeakMap<Prepared, TextPlan>();

/**
 * A fixed (px) line-height would make enlarged text overlap itself: loosen
 * it to at least 1.35, keeping the page's own ratio when that was larger.
 */
function lineHeightToken(
  lh: number | null,
  size: number,
  target: number,
): string | null {
  if (lh === null || lh >= 1.2 * target) return null;
  const want = Math.max(1.35, lh / size);
  const bucket = LH_BUCKETS.find((b) => b >= want - 0.01) ?? 1.8;
  return `tflh${Math.round(bucket * 100)}`;
}

/** The op's block: one rule per size in use, plus every line-height bucket. */
function textCss(plan: TextPlan): OpCss {
  const rules = [...plan.quarters]
    .sort((a, b) => a - b)
    .map(
      (q) => `${tok(`tfs${q}`)} { font-size: ${q / QUARTERS}px !important; }`,
    );
  for (const b of LH_BUCKETS)
    rules.push(
      `${tok(`tflh${Math.round(b * 100)}`)} { line-height: ${b} !important; }`,
    );
  rules.push(`${tok('tfa')} { font-size-adjust: 0.5 !important; }`);
  return { doc: rules.join('\n') };
}

/**
 * The curve, before caps and ranks. Never shrinks. Running text and
 * headings follow it as is. Other roles keep their native rank against
 * them: their own curve F (s/b)^cLow below body size (a 12 px label stays
 * below 14 px body text), F above it, and always between the running text
 * and headings natively just below and just above them.
 */
function mapSize(plan: TextPlan, s: number, role: Role): number {
  const { F, b, sLo, cHigh, cLow } = plan;
  const f = (v: number): number =>
    v >= b ? F * (v / b) ** cHigh : v >= sLo ? F : F * (v / sLo) ** cLow;
  if (role !== 'other') return Math.max(s, f(s));
  const own = s >= b ? Math.min(F, f(s)) : F * (s / b) ** cLow;
  let lo = 0;
  let hi = Infinity;
  for (const a of plan.anchors) {
    if (a <= s - plan.eps) lo = f(a);
    else if (a >= s + plan.eps) {
      hi = f(a);
      break;
    }
  }
  return Math.max(s, Math.min(hi, Math.max(lo, own)));
}

/** A size written as a token: whole quarter pixels, never above `t`. */
const floorQuarter = (t: number): number => Math.floor(t * QUARTERS) / QUARTERS;

function addField(plan: TextPlan, f: Field): void {
  plan.fields.set(`${f.cls}@${quarter(f.s)}`, f);
  const list = plan.byClass.get(f.cls);
  if (list) list.push(f);
  else plan.byClass.set(f.cls, [f]);
}

/**
 * A coarser template key for consistency (tag and three classes, the
 * parent's too): atomic-CSS sites give one visual template fields that
 * differ only in a fourth class, and they must still end at one size.
 */
function coarseKey(cls: string): string {
  return cls
    .split('<')
    .map((part) => part.split('.').slice(0, 4).join('.'))
    .join('<');
}

/** The grown field a text inherits its size from (inline code in a paragraph). */
function hostField(
  el: Element,
  fieldOf: ReadonlyMap<Element, Field>,
  cache: Map<Element, Field | null>,
): Field | null {
  const chain: Element[] = [];
  let out: Field | null = null;
  for (
    let n = composedParent(el), i = 0;
    n && i < 10;
    n = composedParent(n), i++
  ) {
    const hit = cache.get(n);
    if (hit !== undefined) {
      out = hit;
      break;
    }
    const f = fieldOf.get(n);
    if (f) {
      out = f;
      break;
    }
    chain.push(n);
  }
  for (const n of chain) cache.set(n, out);
  return out;
}

const HEADING_TAG = /^h[1-6]$/;
/** Blocks that hold running text by markup. */
const RUNNING_TAGS = new Set([
  'p',
  'blockquote',
  'figcaption',
  'caption',
  'dd',
]);
/** Blocks that hold running text when they hold prose (td prose, list items). */
const PROSE_TAGS = new Set(['li', 'td', 'dt']);
const CONTROL_TAGS = new Set([
  'a',
  'button',
  'label',
  'summary',
  'legend',
  'select',
  'option',
]);
const CONTROL_ROLE =
  /^(button|link|tab|menuitem|option|switch|checkbox|radio)$/;
/** Never resized: navigation, menus, tab and tool bars, overlays. */
const NEVER_SELECTOR = [
  'nav',
  '[role="navigation"]',
  '[role="menubar"]',
  '[role="menu"]',
  '[role="tablist"]',
  '[role="tab"]',
  '[role="toolbar"]',
  '[role="listbox"]',
  '[role="tooltip"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  'dialog',
  '[popover]',
].join(',');
const CHIP_CLASS = /(?:^|[\s_-])(?:chips?|pills?)(?:$|[\s_-])/i;
/** Items of a list or table: the rows the one-line rule keeps on one line. */
const ROW_ITEM = /^(li|tr|dt|dd)$/;
const ROW_ROLE = /^(listitem|row|option|menuitem|treeitem)$/;
/** Boxes a label sits in as a control: past their fixed size, text spills out. */
const CONTROL_BOX =
  'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], label, summary';
const MEDIA_SELECTOR = 'img, picture, video, canvas, svg, [role="img"]';
const SIZE_KEYWORD = /^(auto|none|fit-content|min-content|max-content)$/;

function classSelector(el: Element): string {
  const esc = (s: string): string =>
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(s)
      : s.replace(/[^\w-]/g, '\\$&');
  const classes = classSignature(el);
  return (
    esc(el.localName) +
    (classes
      ? classes
          .split('.')
          .map((c) => `.${esc(c)}`)
          .join('')
      : '')
  );
}

/** Our own sizes apply to `el` (on it or inherited): native reads need measure mode. */
function underOwnSize(el: Element): boolean {
  for (
    let n: Element | null = el, i = 0;
    n && i < 12;
    n = composedParent(n), i++
  )
    if (tokensOf(n).some((t) => tokenOp(t) === 'text_floor')) return true;
  return false;
}

/** Cached reads for one decision pass (styles are live; nothing is written). */
class Reader {
  readonly groups: GroupCache = groupCache();
  private readonly styles = new Map<Element, CSSStyleDeclaration>();
  private readonly avoided = new Map<Element, string | null>();
  private readonly fixed = new Map<Element, boolean>();
  private readonly proseBlocks = new Map<Element, boolean>();
  private readonly hiddenText = new Map<Element, boolean>();
  private readonly ceilings = new Map<Element, RankPoint['control']>();

  constructor(
    readonly view: Window,
    readonly roots: readonly Element[],
    readonly body: boolean,
    /** Target for running text, CSS px: how far no-wrap text may have to grow. */
    readonly floorPx: number,
  ) {}

  style(el: Element): CSSStyleDeclaration {
    let cs = this.styles.get(el);
    if (!cs) this.styles.set(el, (cs = this.view.getComputedStyle(el)));
    return cs;
  }

  rootOf(el: Element): Element | null {
    return this.roots.find((r) => r === el || composedContains(r, el)) ?? null;
  }

  key(el: Element): string {
    return templateKey(el, this.groups.sig);
  }

  /** A control's label as a ceiling for the text beside it (controlCeiling). */
  ceiling(el: Element): RankPoint['control'] {
    let hit = this.ceilings.get(el);
    if (hit === undefined)
      this.ceilings.set(
        el,
        (hit = controlCeiling(el, (n) => this.style(n)) ?? undefined),
      );
    return hit;
  }

  /** Why `el` is never resized (navigation, banner, chip, pinned, field), or null. */
  avoid(el: Element, root: Element): string | null {
    const chain: Element[] = [];
    let reason: string | null = null;
    for (let n: Element | null = el; n; n = composedParent(n)) {
      if (n === root) break;
      const hit = this.avoided.get(n);
      if (hit !== undefined) {
        reason = hit;
        break;
      }
      chain.push(n);
      const own = this.ownAvoid(n);
      if (own) {
        reason = own;
        break;
      }
      if (chain.length > 48) break;
    }
    for (const n of chain) this.avoided.set(n, reason);
    return reason;
  }

  private ownAvoid(n: Element): string | null {
    if (n.matches(NO_TEXT_OPS)) return 'field';
    if (n.matches(NEVER_SELECTOR)) return 'navigation';
    const landmark = landmarkOf(n);
    if (
      landmark === 'banner' ||
      landmark === 'contentinfo' ||
      landmark === 'navigation' ||
      landmark === 'dialog'
    )
      return 'page chrome';
    if (this.body && landmark === 'complementary') return 'aside';
    const pos = this.style(n).position;
    if (pos === 'fixed' || pos === 'sticky') return 'pinned';
    if (CHIP_CLASS.test(n.getAttribute('class') ?? '')) return 'chip';
    return null;
  }

  private prose(block: Element, min: number): boolean {
    let hit = this.proseBlocks.get(block);
    if (hit === undefined) {
      const text = (block.textContent ?? '')
        .slice(0, 600)
        .replace(/\s+/g, ' ')
        .trim();
      hit = text.length >= min && text.split(' ').length >= 3;
      this.proseBlocks.set(block, hit);
    }
    return hit;
  }

  /** Running text, a heading, or another role (label, badge, meta, control). */
  role(el: Element): Role {
    for (
      let n: Element | null = el, i = 0;
      n && i < 5;
      n = composedParent(n), i++
    )
      if (HEADING_TAG.test(n.localName) || n.getAttribute('role') === 'heading')
        return 'heading';
    // Inline content takes the role of the box it flows in.
    let block = el;
    for (
      let n: Element | null = el, i = 0;
      n && i < 6;
      n = composedParent(n), i++
    ) {
      const d = this.style(n).display;
      if (d !== 'inline' && d !== 'contents') {
        block = n;
        break;
      }
    }
    const tag = block.localName;
    if (
      CONTROL_TAGS.has(tag) ||
      CONTROL_ROLE.test(block.getAttribute('role') ?? '')
    )
      return 'other';
    if (RUNNING_TAGS.has(tag)) return 'running';
    if (PROSE_TAGS.has(tag)) return this.prose(block, 24) ? 'running' : 'other';
    return directTextLength(block) >= 60 ? 'running' : 'other';
  }

  /** The box has a definite height (or max-height): growing text cannot stretch it. */
  private fixedSize(n: Element, cs: CSSStyleDeclaration): boolean {
    let hit = this.fixed.get(n);
    if (hit !== undefined) return hit;
    hit = false;
    if (/^table/.test(cs.display)) hit = false;
    else if (cs.maxHeight !== 'none') hit = true;
    else {
      // Computed (not resolved) values: 'auto' stays 'auto'.
      const map = (
        n as Element & { computedStyleMap?: () => StylePropertyMapReadOnly }
      ).computedStyleMap?.();
      try {
        const h = map?.get('height')?.toString();
        hit = h !== undefined && !SIZE_KEYWORD.test(h);
      } catch {
        hit = false;
      }
    }
    this.fixed.set(n, hit);
    return hit;
  }

  /** A box's own width or height is set (or capped), so it does not grow with its text. */
  private definite(
    n: Element,
    cs: CSSStyleDeclaration,
    prop: 'width' | 'height',
  ): boolean {
    if (/^table/.test(cs.display)) return false;
    if ((prop === 'width' ? cs.maxWidth : cs.maxHeight) !== 'none') return true;
    const map = (
      n as Element & { computedStyleMap?: () => StylePropertyMapReadOnly }
    ).computedStyleMap?.();
    try {
      const v = map?.get(prop)?.toString();
      return v !== undefined && !SIZE_KEYWORD.test(v) && !v.endsWith('%');
    } catch {
      return false;
    }
  }

  /** Screen-reader-only text (a 1 px clipped box) or text placed off screen. */
  hidden(el: Element): boolean {
    let hit = this.hiddenText.get(el);
    if (hit === undefined) {
      hit = visuallyHidden(el, this.view, (n) => this.style(n));
      this.hiddenText.set(el, hit);
    }
    return hit;
  }

  /**
   * The most `el` can grow inside the control it labels when the control's
   * box does not grow with it (a set height; a set width on one line): past
   * that it spills out of the button (B6: Meta's "Shop all"). Infinity when
   * the nearest control box sizes to its content.
   */
  controlFit(el: Element): number {
    const t = el.getBoundingClientRect();
    if (t.width < 1 || t.height < 1) return Infinity;
    for (
      let n: Element | null = el, i = 0;
      n && i < 8;
      n = composedParent(n), i++
    ) {
      if (n.localName === 'body' || n.localName === 'html') break;
      if (!n.matches(CONTROL_BOX)) continue;
      const cs = this.style(n);
      if (cs.display === 'inline' || cs.display === 'contents') continue;
      const fixedH = this.definite(n, cs, 'height');
      const fixedW = this.definite(n, cs, 'width');
      if (!fixedH && !fixedW) return Infinity;
      const box = n.getBoundingClientRect();
      const px = (v: string): number => parseFloat(v) || 0;
      const innerH =
        box.height -
        px(cs.paddingTop) -
        px(cs.paddingBottom) -
        px(cs.borderTopWidth) -
        px(cs.borderBottomWidth);
      const innerW =
        box.width -
        px(cs.paddingLeft) -
        px(cs.paddingRight) -
        px(cs.borderLeftWidth) -
        px(cs.borderRightWidth);
      const own = this.style(el);
      const size = parseFloat(own.fontSize) || t.height;
      let k = Infinity;
      if (fixedH) k = Math.min(k, innerH / Math.max(t.height, 1.2 * size));
      const nowrap =
        /^(nowrap|pre)$/.test(own.whiteSpace) ||
        own.getPropertyValue('text-wrap-mode') === 'nowrap';
      if (fixedW && (nowrap || fixedH)) k = Math.min(k, innerW / t.width);
      return Math.max(1, k);
    }
    return Infinity;
  }

  /**
   * One-line text in a row of a repeated template (a list of links, a
   * column of names): how wide its line is and how much room the line has.
   * Growing past the room wraps some rows and not others (B6: NN/g's list
   * rows went from 33 px each to 36-72 px).
   */
  rowLine(el: Element): { w: number; room: number } | null {
    let block = el;
    for (
      let n: Element | null = el, i = 0;
      n && i < 6;
      n = composedParent(n), i++
    ) {
      const d = this.style(n).display;
      if (d !== 'inline' && d !== 'contents') {
        block = n;
        break;
      }
    }
    const cs = this.style(block);
    if (!/^(block|list-item|flow-root|table-cell)$/.test(cs.display))
      return null;
    const r = block.getBoundingClientRect();
    const size = parseFloat(cs.fontSize) || 16;
    const lh = lineHeightPx(cs) ?? size * 1.2;
    const px = (v: string): number => parseFloat(v) || 0;
    const inner =
      r.height -
      px(cs.paddingTop) -
      px(cs.paddingBottom) -
      px(cs.borderTopWidth) -
      px(cs.borderBottomWidth);
    if (r.width < 1 || r.height < 1 || inner > 1.6 * lh) return null;
    // A row: a list item, table row or option that repeats (within three
    // ancestors). Paragraphs of an article repeat too, but are no rows.
    let row = false;
    for (
      let n: Element | null = block, i = 0;
      n && i < 3 && !row;
      n = n.parentElement, i++
    )
      row =
        ROW_ITEM.test(n.localName) ||
        ROW_ROLE.test(n.getAttribute('role') ?? '')
          ? isRepeated(n, this.groups) &&
            (n.parentElement?.childElementCount ?? 0) >= 4
          : false;
    if (!row) return null;
    const range = block.ownerDocument.createRange();
    range.selectNodeContents(block);
    const w = range.getBoundingClientRect().width;
    range.detach();
    const room =
      r.width -
      (parseFloat(cs.paddingLeft) || 0) -
      (parseFloat(cs.paddingRight) || 0) -
      (parseFloat(cs.borderLeftWidth) || 0) -
      (parseFloat(cs.borderRightWidth) || 0);
    return w > 0 && room > 0 ? { w, room } : null;
  }

  /** Text sits on a picture: a badge over a thumbnail or an icon. */
  private overMedia(n: Element): boolean {
    const cb = (n as HTMLElement).offsetParent ?? n.parentElement;
    if (!cb) return false;
    const box = boxOf(n.getBoundingClientRect());
    if (area(box) < 1) return false;
    const media = cb.querySelectorAll(MEDIA_SELECTOR);
    for (let i = 0; i < Math.min(media.length, 24); i++) {
      const m = media[i] as Element;
      if (n.contains(m)) continue;
      const mb = boxOf(m.getBoundingClientRect());
      if (mb.right - mb.left < 8 || mb.bottom - mb.top < 8) continue;
      if (intersection(box, mb) >= 0.25 * Math.min(area(box), area(mb)))
        return true;
    }
    return false;
  }

  /** No-wrap text in a flex row with no room left: growth overflows the row. */
  private crowdedRow(el: Element): boolean {
    for (
      let n = composedParent(el), i = 0;
      n && i < 3;
      n = composedParent(n), i++
    ) {
      const cs = this.style(n);
      if (!/flex$/.test(cs.display)) continue;
      if (cs.flexDirection.startsWith('column') || cs.flexWrap !== 'nowrap')
        return false;
      const width = (n as HTMLElement).clientWidth;
      if (width <= 0) return false;
      let used = 0;
      let k = 0;
      for (
        let c = n.firstElementChild;
        c && k < 40;
        c = c.nextElementSibling, k++
      )
        used += c.getBoundingClientRect().width;
      used += (parseFloat(cs.columnGap) || 0) * Math.max(0, k - 1);
      return used >= width - Math.max(8, 0.08 * width);
    }
    return false;
  }

  /**
   * No-wrap text that would no longer fit beside its start at the target
   * size (a long label, a no-wrap table cell): it would push the page wider.
   */
  private tooWide(el: Element, cs: CSSStyleDeclaration): boolean {
    const parent = composedParent(el);
    if (!parent) return false;
    const box = el.getBoundingClientRect();
    if (box.width < 1) return false;
    const s = parseFloat(cs.fontSize);
    const grow = Math.max(1, this.floorPx / (s > 0 ? s : this.floorPx)) * 1.1;
    const pr = parent.getBoundingClientRect();
    const pcs = this.style(parent);
    const right = pr.right - (parseFloat(pcs.paddingRight) || 0);
    const left = pr.left + (parseFloat(pcs.paddingLeft) || 0);
    // Inline boxes can move to the next line; blocks start where they are.
    const room = cs.display.startsWith('inline')
      ? right - left
      : right - box.left;
    return box.width * grow > room + 1;
  }

  /**
   * Whether this instance can cut its text off or spill over its neighbours
   * when it grows (docs/10 §5.2): ellipsis, a line clamp, a clipping or
   * fixed-height box within three ancestors, a box over a picture, a full
   * no-wrap row. One risky instance excludes its whole class.
   */
  risk(el: Element): Risk | null {
    const own = this.style(el);
    const nowrap =
      /^(nowrap|pre)$/.test(own.whiteSpace) ||
      own.getPropertyValue('text-wrap-mode') === 'nowrap';
    for (
      let n: Element | null = el, i = 0;
      n && i <= 3;
      n = composedParent(n), i++
    ) {
      if (n.localName === 'body' || n.localName === 'html') break;
      const cs = this.style(n);
      if (cs.textOverflow === 'ellipsis') return 'ellipsis';
      const clamp =
        cs.getPropertyValue('-webkit-line-clamp') ||
        cs.getPropertyValue('line-clamp');
      if (clamp && clamp !== 'none') return 'clamp';
      if (cs.display !== 'inline') {
        const h = n as HTMLElement;
        const kind = overflowOf(cs);
        const pane =
          kind === 'scroll' && h.clientHeight >= 200 && h.clientWidth >= 200;
        if (kind !== 'visible' && !pane) {
          if (
            nowrap ||
            h.scrollHeight > h.clientHeight + 1 ||
            h.scrollWidth > h.clientWidth + 1 ||
            this.fixedSize(n, cs)
          )
            return 'clip';
        } else if (kind === 'visible' && this.fixedSize(n, cs))
          return 'fixed_height';
      }
      if (cs.position === 'absolute' && this.overMedia(n)) return 'overlay';
    }
    if (nowrap && this.crowdedRow(el)) return 'crowded_row';
    if (nowrap && this.tooWide(el, own)) return 'wide_nowrap';
    return null;
  }
}

/** Up to `n` instances to read for risk: those in view first, then spread out. */
function riskSample(
  list: readonly Element[],
  view: Window,
  n: number,
): Element[] {
  if (list.length <= n) return [...list];
  const vh = view.innerHeight;
  const inView: Element[] = [];
  for (const el of list) {
    if (inView.length >= n / 2) break;
    const r = el.getBoundingClientRect();
    if (r.bottom > 0 && r.top < vh && r.width > 0) inView.push(el);
  }
  const out = new Set(inView);
  const step = list.length / (n - out.size);
  for (let i = 0; out.size < n && i < list.length; i += step)
    out.add(list[Math.floor(i)] as Element);
  return [...out];
}

interface Instance {
  el: Element;
  cls: string;
  s: number;
  chars: number;
  root: Element;
}

/** Held text inside resized text keeps its own size (an em-sized badge in a paragraph). */
function grownAncestor(el: Element, grown: (n: Element) => boolean): boolean {
  for (
    let n = composedParent(el), i = 0;
    n && i < 10;
    n = composedParent(n), i++
  )
    if (grown(n)) return true;
  return false;
}

export const textFloor: OpImpl = {
  id: 'text_floor',
  prepare(env, level, scope) {
    const zoom = env.zoom > 0.25 ? env.zoom : 1;
    const F = level / zoom;
    const { roots, body } = textScope(env, scope);
    const rd = new Reader(env.view, roots, body, F);
    const held = env.held('text_floor');

    // 1. Template classes in scope, then every instance of each (a walk can
    //    stop early; late content of a known class must match it).
    const byClass = new Map<string, Element[]>();
    const known = new Set<Element>();
    for (const t of env.facts.text) {
      const el = t.el;
      if (t.icon || known.has(el) || !el.isConnected) continue;
      const root = rd.rootOf(el);
      if (!root || rd.avoid(el, root)) continue;
      const cls = rd.key(el);
      const list = byClass.get(cls);
      if (list) list.push(el);
      else byClass.set(cls, [el]);
      known.add(el);
    }
    let total = known.size;
    for (const [cls, list] of byClass) {
      if (total >= MAX_INSTANCES) break;
      const seed = list[0] as Element;
      const tree = seed.getRootNode();
      const scopes: ParentNode[] =
        tree instanceof ShadowRoot
          ? [tree]
          : roots.filter((r) => r.isConnected);
      const selector = classSelector(seed);
      for (const q of scopes) {
        let found: NodeListOf<Element>;
        try {
          found = q.querySelectorAll(selector);
        } catch {
          continue;
        }
        for (let i = 0; i < found.length && list.length < MAX_PER_CLASS; i++) {
          const el = found[i] as Element;
          if (known.has(el) || directTextLength(el) === 0) continue;
          if (rd.key(el) !== cls) continue;
          const root = rd.rootOf(el);
          if (!root || rd.avoid(el, root)) continue;
          list.push(el);
          known.add(el);
          if (++total >= MAX_INSTANCES) break;
        }
      }
    }

    // 2. Role, risk and room per class. Screen-reader-only instances (a
    //    1 px clipped box) neither show nor cut anything off: they never make
    //    a class risky, and grow with it.
    const info = new Map<string, ClassInfo>();
    const fits = new Map<string, number>();
    const lines = new Map<string, Array<{ w: number; room: number }>>();
    let lineBudget = MAX_ROW_LINES;
    for (const [cls, list] of byClass) {
      const votes = list.slice(0, 3).map((el) => rd.role(el));
      const role =
        (['running', 'heading', 'other'] as const).find(
          (r) => votes.filter((v) => v === r).length * 2 > votes.length,
        ) ??
        votes[0] ??
        'other';
      let risk: Risk | null = held.has(cls) ? 'dropped' : null;
      let fit = Infinity;
      const rows: Array<{ w: number; room: number }> = [];
      let read = 0;
      if (!risk)
        for (const el of riskSample(list, env.view, RISK_SAMPLE)) {
          if (rd.hidden(el)) continue;
          risk = rd.risk(el);
          if (risk) break;
          fit = Math.min(fit, rd.controlFit(el));
          if (lineBudget > 0 && role !== 'heading') {
            lineBudget--;
            read++;
            const line = rd.rowLine(el);
            if (line) rows.push(line);
          }
        }
      info.set(cls, { role, risk, origin: 'batch' });
      if (!risk && fit < Infinity) fits.set(cls, fit);
      // A template of one-line rows: most of what was read sits on one line
      // in a row (a list of links). Paragraphs of an article, mostly several
      // lines long, are no rows even when a short one fits on one line.
      if (!risk && rows.length >= 3 && rows.length >= ROW_MAJORITY * read)
        lines.set(cls, rows);
    }

    // 3. Instances at their native sizes (this runs in measure mode).
    const instances: Instance[] = [];
    for (const [cls, list] of byClass)
      for (const el of list) {
        const cs = rd.style(el);
        const s = parseFloat(cs.fontSize);
        if (!Number.isFinite(s) || s <= 0) continue;
        const chars = directTextLength(el);
        if (chars <= 4 && isIconFont(cs.fontFamily, directText(el, 8)))
          continue;
        const root = rd.rootOf(el);
        if (root) instances.push({ el, cls, s, chars, root });
      }

    // 4. Body size from the running text it may resize, and the curve.
    const ok = (i: Instance): boolean => !info.get(i.cls)?.risk;
    const included = instances.filter(ok);
    if (included.length === 0)
      return notNeeded(
        instances.length
          ? 'text here sits in boxes that would cut it off'
          : 'no text in the main content',
      );
    const roleOf = (i: Instance): Role => info.get(i.cls)?.role ?? 'other';
    const running = included.filter((i) => roleOf(i) === 'running');
    const pool = running.length
      ? running
      : included.filter((i) => roleOf(i) !== 'heading');
    const b =
      weightedMedian(
        (pool.length ? pool : included).map(
          (i) => [i.s, Math.max(1, i.chars)] as const,
        ),
      ) ?? F;
    const r = F / b;
    if (r <= 1.05) return notNeeded('text here is already at this size');
    let sLo = b;
    for (const i of running) if (i.chars >= 20 && i.s < sLo) sLo = i.s;
    sLo = Math.min(b, Math.max(sLo, 0.75 * b));
    const lg = Math.log2(r);
    const plan: TextPlan = {
      roots,
      body,
      F,
      b,
      sLo,
      cHigh: Math.max(0.2, 1 - 0.48 * lg),
      cLow: Math.max(0.7, 1 - 0.35 * lg),
      anchors: [
        ...new Set(
          included
            .filter((i) => roleOf(i) !== 'other')
            .map((i) => quarter(i.s) / QUARTERS),
        ),
      ].sort((x, y) => x - y),
      classes: info,
      fields: new Map(),
      byClass: new Map(),
      regionOf: regionResolver(regionRootsOf(env.facts.regions)),
      points: new Map(),
      eps: SIZE_EPS / zoom,
      quarters: new Set(),
      running: new WeakSet(),
      pinned: new WeakSet(),
    };

    // 5. Fields: one decision per template field and native size, as the
    //    curve wants it, capped by the room its control and its row leave.
    const fieldOf = new Map<Element, Field>();
    for (const i of instances) {
      const ci = info.get(i.cls) as ClassInfo;
      const s = quarter(i.s) / QUARTERS;
      let f = plan.fields.get(`${i.cls}@${quarter(s)}`);
      if (!f) {
        f = {
          cls: i.cls,
          s,
          role: ci.role,
          t: ci.risk ? s : mapSize(plan, s, ci.role),
          held: ci.risk ? 'excluded' : null,
        };
        addField(plan, f);
      }
      fieldOf.set(i.el, f);
    }
    for (const f of plan.fields.values()) {
      if (f.held) continue;
      let r = Math.min(f.t / f.s, fits.get(f.cls) ?? Infinity);
      const rows = lines.get(f.cls);
      if (rows) {
        // Some rows would wrap and others not: grow only as far as none does.
        const wraps = rows.filter((l) => l.w * r > l.room + 1).length;
        if (wraps > 0 && wraps < rows.length)
          r = Math.min(r, ...rows.map((l) => l.room / l.w));
      }
      f.t = f.s * Math.max(1, r);
    }

    // 6. Size order per region (ops/rank.ts): each field ranks with every
    //    text in the regions its instances are in, whatever keeps that text
    //    at its size; inline fields never outgrow the text they sit in.
    //    A control's label caps no running text, and a glyph ("+") no text
    //    (ops/rank.ts); a point several texts share caps as the hardest.
    const units = [...plan.fields.values()];
    const unitOf = new Map<Field, number>(units.map((f, k) => [f, k]));
    const regionPoints = new Map<string, Map<string, RankPoint>>();
    const growing = new Set<string>();
    const point = (
      s: number,
      unit: number | null,
      el: Element,
      heading?: boolean,
    ): RankPoint => {
      const control = rd.ceiling(el);
      const running = unit !== null && units[unit]?.role === 'running';
      return {
        s,
        unit,
        ...(heading ? { heading } : {}),
        ...(control ? { control } : {}),
        ...(running ? { running } : {}),
      };
    };
    const putPoint = (
      m: Map<string, RankPoint>,
      key: string,
      p: RankPoint,
    ): void => {
      const had = m.get(key);
      if (!had) m.set(key, p);
      else if (had.control && had.control !== p.control) {
        if (p.control === 'label') had.control = 'label';
        else if (!p.control) delete had.control;
      }
    };
    const addPoint = (
      region: string,
      s: number,
      unit: number | null,
      el: Element,
    ): void => {
      let m = regionPoints.get(region);
      if (!m) regionPoints.set(region, (m = new Map()));
      const q = quarter(s);
      putPoint(m, `${unit ?? '-'}@${q}`, point(q / QUARTERS, unit, el));
    };
    // Records (a row, a card) rank their own texts more strictly: the gap
    // under a text that keeps its size stays visible.
    const recordPoints = new Map<Element, Map<string, RankPoint>>();
    for (const i of instances) {
      const f = fieldOf.get(i.el) as Field;
      const region = plan.regionOf(i.el);
      const unit = unitOf.get(f) ?? null;
      if (!f.held) growing.add(region);
      addPoint(region, f.s, unit, i.el);
      if (isControlText(i.el)) continue;
      const g = sizeGroup(i.el, i.root, rd.groups);
      if (g === i.root || !isRecordGroup(g, rd.groups)) continue;
      let m = recordPoints.get(g);
      if (!m) recordPoints.set(g, (m = new Map()));
      const key = `${unit ?? '-'}@${quarter(f.s)}`;
      if (m.has(key) || m.size < 60)
        putPoint(m, key, point(f.s, unit, i.el, f.role === 'heading'));
    }
    // A heading and the text it introduces (the rest of its parent): the
    // text never outgrows the heading at one native size (GitHub's "About"
    // over its description), and the gap under a heading that keeps its
    // size stays visible.
    const sections = new Map<Element, Map<string, RankPoint>>();
    for (const i of instances) {
      const f = fieldOf.get(i.el) as Field;
      if (f.role !== 'heading' || sections.size >= 200) continue;
      // The heading element (the text may be a span inside an h2), then
      // the box it heads.
      let h: Element | null = i.el;
      let found = false;
      for (let d = 0; h && d < 5 && !found; d++) {
        found =
          HEADING_TAG.test(h.localName) || h.getAttribute('role') === 'heading';
        if (!found) h = composedParent(h);
      }
      const parent = found && h ? composedParent(h) : null;
      if (!parent || parent === i.root) continue;
      if (!sections.has(parent)) sections.set(parent, new Map());
    }
    if (sections.size)
      for (const i of instances) {
        for (
          let n = composedParent(i.el), d = 0;
          n && d < 6 && n !== i.root;
          n = composedParent(n), d++
        ) {
          const m = sections.get(n);
          if (!m) continue;
          const f = fieldOf.get(i.el) as Field;
          const unit = unitOf.get(f) ?? null;
          const key = `${unit ?? '-'}@${quarter(f.s)}`;
          if (m.has(key) || m.size < 60)
            putPoint(m, key, point(f.s, unit, i.el, f.role === 'heading'));
          break;
        }
      }
    const hosts = new Map<Element, Field | null>();
    let ranked = 0;
    for (const t of env.facts.text) {
      if (ranked >= MAX_RANKED) break;
      const el = t.el;
      if (t.icon || fieldOf.has(el) || !el.isConnected) continue;
      const region = plan.regionOf(el);
      if (!growing.has(region)) continue;
      ranked++;
      const s = parseFloat(rd.style(el).fontSize);
      if (!Number.isFinite(s) || s <= 0) continue;
      // Text inside a field's instances grows with it, or is pinned under
      // its region's bound once the ranks are settled (below): no point.
      const host = hostField(el, fieldOf, hosts);
      if (host && !host.held) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || rd.hidden(el)) continue;
      addPoint(region, s, null, el);
    }
    // Inline fields of their own inside a field's instances (a link, bold
    // words in a paragraph) never grow past the text they sit in: a held
    // paragraph keeps its links at its size and a grown one takes them
    // along. A sample of each field's instances is read.
    const byField = new Map<Field, Instance[]>();
    for (const i of instances) {
      const f = fieldOf.get(i.el) as Field;
      const list = byField.get(f);
      if (list) list.push(i);
      else byField.set(f, [i]);
    }
    const under = new Map<string, [number, number]>();
    for (const [f, list] of byField) {
      const unit = unitOf.get(f) as number;
      const step = Math.max(1, Math.floor(list.length / FOLLOWER_SAMPLE));
      for (let k = 0; k < list.length; k += step) {
        const i = list[k] as Instance;
        let seen = 0;
        const stack: Array<[Element, number]> = [...i.el.children].map(
          (c) => [c, 1] as [Element, number],
        );
        while (stack.length && seen < 12) {
          const [c, depth] = stack.pop() as [Element, number];
          if (SKIP_TAGS.has(c.localName)) continue;
          seen++;
          const inner = fieldOf.get(c);
          if (inner) {
            const v = unitOf.get(inner) as number;
            if (v !== unit && rd.style(c).display === 'inline')
              under.set(`${v}<${unit}`, [v, unit]);
            continue;
          }
          if (depth < 3) for (const g of c.children) stack.push([g, depth + 1]);
        }
      }
    }
    // One size per template field, also across fields that differ only past
    // their third class (atomic CSS), at one native size.
    const consistent = new Map<string, number[]>();
    units.forEach((f, k) => {
      const key = `${coarseKey(f.cls)}@${Math.round(f.s * 2)}`;
      const list = consistent.get(key);
      if (list) list.push(k);
      else consistent.set(key, [k]);
    });
    const regions = [
      ...[...regionPoints.values()].map((m) => ({ points: [...m.values()] })),
      ...[...recordPoints.values()]
        .filter((m) => m.size > 1)
        .map((m) => ({ points: [...m.values()], compress: true, lift: true })),
      ...[...sections.values()]
        .filter((m) => m.size > 1)
        .map((m) => ({ points: [...m.values()], lift: true })),
    ];
    const groups = [...consistent.values()].filter((g) => g.length > 1);
    const fixedUnits = new Set<number>();
    units.forEach((f, k) => {
      if (f.held) fixedUnits.add(k);
    });
    // Sizes are written in whole quarter pixels below the solved size; a
    // field that then grows too little is held and the ranks solved again.
    let solved = solveRanks({
      regions,
      want: units.map((f) => f.t / f.s),
      groups,
      c: plan.cLow,
      minGrowth: MIN_GROWTH,
      held: fixedUnits,
      eps: plan.eps,
      under: [...under.values()],
    });
    for (let round = 0; round < 3; round++) {
      let more = false;
      solved.r.forEach((r, k) => {
        const f = units[k] as Field;
        if (solved.held[k] || fixedUnits.has(k)) return;
        if (floorQuarter(f.s * r) < f.s * (1 + MIN_GROWTH)) {
          fixedUnits.add(k);
          more = true;
        }
      });
      if (!more) break;
      solved = solveRanks({
        regions,
        want: units.map((f) => f.t / f.s),
        groups,
        c: plan.cLow,
        minGrowth: MIN_GROWTH,
        held: fixedUnits,
        eps: plan.eps,
        under: [...under.values()],
      });
    }
    units.forEach((f, k) => {
      if (f.held) return;
      const t = floorQuarter(f.s * (solved.r[k] as number));
      if (solved.held[k] || t < f.s * (1 + MIN_GROWTH)) {
        f.t = f.s;
        f.held = 'small';
      } else f.t = t;
    });
    for (const [region, m] of regionPoints)
      plan.points.set(
        region,
        [...m.values()].map((p) => {
          const f = p.unit === null ? null : (units[p.unit] as Field);
          return {
            s: p.s,
            after: f && !f.held ? p.s * (f.t / f.s) : p.s,
            fixed: !f || f.held !== null,
            ...(p.control ? { control: p.control } : {}),
          };
        }),
      );

    // 7. Marks: one size token per instance, consistent per field.
    const marks: Array<[Element, string]> = [];
    const grown = new Set<Element>();
    const shownRunning: Element[] = [];
    const shownOther: Element[] = [];
    const targets: number[] = [];
    for (const i of instances) {
      const f = fieldOf.get(i.el) as Field;
      if (f.held) continue;
      const cs = rd.style(i.el);
      const q = quarter(f.t);
      plan.quarters.add(q);
      marks.push([i.el, `tfs${q}`]);
      grown.add(i.el);
      const lh = lineHeightToken(lineHeightPx(cs), i.s, f.t);
      if (lh) marks.push([i.el, lh]);
      if (f.role === 'running') {
        plan.running.add(i.el);
        shownRunning.push(i.el);
        targets.push(f.t);
        // font-size-adjust aware: small x-height families read at a 0.5 aspect.
        if (i.el.childElementCount === 0) {
          const aspect = xHeightRatio(env.doc, cs.fontFamily, cs.fontWeight);
          if (aspect !== null && aspect < 0.47) marks.push([i.el, 'tfa']);
        }
      } else shownOther.push(i.el);
    }
    if (grown.size === 0)
      return notNeeded('no text here can grow without breaking its layout');
    for (const i of instances) {
      const f = fieldOf.get(i.el) as Field;
      if (!f.held || !grownAncestor(i.el, (n) => grown.has(n))) continue;
      const q = quarter(i.s);
      plan.quarters.add(q);
      marks.push([i.el, `tfs${q}`]);
      plan.pinned.add(i.el);
    }
    // Inline text that is no field (code, kbd in a paragraph) inherits its
    // paragraph's growth, but never past a text its region keeps larger
    // (GitHub's 13.6 px "Code - OSS" beside the 14 px "main"): it is pinned
    // there instead, and the paragraph still grows.
    let followers = 0;
    for (const i of instances) {
      const f = fieldOf.get(i.el) as Field;
      if (f.held || i.el.childElementCount === 0) continue;
      const ratio = f.t / f.s;
      const stack: Array<[Element, number]> = [...i.el.children].map(
        (c) => [c, 1] as [Element, number],
      );
      let seen = 0;
      while (stack.length && seen < 12 && followers < MAX_FOLLOWERS) {
        const [c, depth] = stack.pop() as [Element, number];
        if (SKIP_TAGS.has(c.localName) || fieldOf.has(c)) continue;
        seen++;
        if (depth < 3) for (const g of c.children) stack.push([g, depth + 1]);
        if (directTextLength(c) === 0) continue;
        followers++;
        const s = parseFloat(rd.style(c).fontSize);
        if (!Number.isFinite(s) || s <= 0) continue;
        const { hi } = rankRange(
          s,
          plan.points.get(plan.regionOf(c)) ?? [],
          plan.eps,
        );
        if (ratio <= hi + 1e-9) continue;
        const q = quarter(Math.max(s, floorQuarter(s * hi)));
        plan.quarters.add(q);
        marks.push([c, `tfs${q}`]);
        plan.pinned.add(c);
      }
    }
    const after =
      median(
        targets.length
          ? targets
          : [...grown].map((el) => fieldOf.get(el)?.t ?? F),
      ) ?? F;
    const prepared: Prepared = {
      status: 'ready',
      css: textCss(plan),
      marks,
      count: grown.size,
      fit: { before: px(b * zoom), after: px(after * zoom) },
      show: inViewportFirst(env, [...shownRunning, ...shownOther]),
      covers: (el) =>
        roots.some((root) => root === el || composedContains(root, el)),
      classOf: (el) => templateKey(el),
      droppable: (cls) => plan.classes.get(cls)?.origin === 'runtime',
    };
    PLANS.set(prepared, plan);
    return prepared;
  },
  afterApply(env, applied) {
    const plan = PLANS.get(applied.prepared);
    const marked = env.marks
      .elementsFor('text_floor')
      .filter((el) => el.isConnected && !plan?.pinned.has(el));
    const running = marked.filter((el) => plan?.running.has(el));
    const sizes = (running.length ? running : marked)
      .slice(0, 80)
      .map((el) => parseFloat(env.view.getComputedStyle(el).fontSize))
      .filter(Number.isFinite);
    const m = median(sizes);
    if (m !== null && applied.prepared.fit)
      applied.prepared.fit = {
        ...applied.prepared.fit,
        after: px(m * env.zoom),
      };
    applied.prepared.count = marked.length;
  },
  retoken(env, applied, roots) {
    const plan = PLANS.get(applied.prepared);
    if (!plan) return [];
    const rd = new Reader(env.view, plan.roots, plan.body, plan.F);
    const held = env.held('text_floor');
    const cands: Element[] = [];
    const seen = new Set<Element>();
    collect: for (const root of roots) {
      if (!root.isConnected) continue;
      const all = [root, ...root.querySelectorAll('*')].slice(0, 400);
      for (const el of all) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (SKIP_TAGS.has(el.localName) || isOurs(el)) continue;
        if (directTextLength(el) === 0 || !rd.rootOf(el)) continue;
        cands.push(el);
        if (cands.length >= 1200) break collect;
      }
    }
    if (cands.length === 0) return [];
    const quarters = plan.quarters.size;

    // Native reads: anything under our own sizes is read with them removed,
    // and classes first seen here are judged on the site's own layout.
    interface Row {
      s: number;
      lh: number | null;
      family: string;
      weight: string;
      cls: string;
      skip: boolean;
    }
    const read = (): Row[] =>
      cands.map((el) => {
        const cs = env.view.getComputedStyle(el);
        const s = parseFloat(cs.fontSize);
        const root = rd.rootOf(el) as Element;
        const cls = rd.key(el);
        const chars = directTextLength(el);
        const skip =
          !Number.isFinite(s) ||
          s <= 0 ||
          cs.display === 'none' ||
          rd.avoid(el, root) !== null ||
          (chars <= 4 && isIconFont(cs.fontFamily, directText(el, 8)));
        if (!skip && !plan.classes.has(cls))
          plan.classes.set(cls, {
            role: rd.role(el),
            risk: held.has(cls) ? 'dropped' : rd.risk(el),
            origin: 'runtime',
          });
        return {
          s,
          lh: lineHeightPx(cs),
          family: cs.fontFamily,
          weight: cs.fontWeight,
          cls,
          skip,
        };
      });
    const rows = cands.some(underOwnSize) ? env.measured(read) : read();

    const pin = (el: Element, s: number): string[] => {
      const grown = grownAncestor(
        el,
        (n) =>
          !plan.pinned.has(n) &&
          tokensOf(n).some((t) => tokenOp(t) === 'text_floor'),
      );
      if (!grown) return [];
      const q = quarter(s);
      plan.quarters.add(q);
      plan.pinned.add(el);
      return [`tfs${q}`];
    };
    const out: Array<[Element, string[]]> = [];
    cands.forEach((el, idx) => {
      const row = rows[idx] as Row;
      if (row.skip) {
        // Inline text pinned under its region's bound keeps its pin.
        out.push([
          el,
          plan.pinned.has(el)
            ? tokensOf(el).filter((t) => tokenOp(t) === 'text_floor')
            : [],
        ]);
        return;
      }
      const ci = plan.classes.get(row.cls);
      if (!ci || ci.risk || held.has(row.cls)) {
        out.push([el, pin(el, row.s)]);
        return;
      }
      const s = quarter(row.s) / QUARTERS;
      let f = plan.fields.get(`${row.cls}@${quarter(s)}`);
      if (!f) {
        // A size this page view has not ranked yet: rank it with the points
        // its region already settled, as the batch would have.
        const region = plan.regionOf(el);
        const points = plan.points.get(region) ?? [];
        const { lo, hi } = rankRange(
          s,
          points,
          plan.eps,
          ci.role === 'running',
        );
        const want = Math.min(
          mapSize(plan, s, ci.role) / s,
          rd.controlFit(el),
          hi,
        );
        // Text natively smaller already reaching past this size forces it up
        // (as far as larger text allows); otherwise growth under 6% is held.
        const r = Math.max(1, Math.min(Math.max(want, lo), hi));
        const t = floorQuarter(s * r);
        const keep = lo <= 1 + 1e-9 && t < s * (1 + MIN_GROWTH);
        f = {
          cls: row.cls,
          s,
          role: ci.role,
          t: keep || t <= s ? s : t,
          held: keep || t <= s ? 'small' : null,
        };
        addField(plan, f);
        const control = rd.ceiling(el);
        points.push({
          s,
          after: f.t,
          fixed: f.held !== null,
          ...(control ? { control } : {}),
        });
        plan.points.set(region, points);
      }
      if (f.held) {
        out.push([el, pin(el, row.s)]);
        return;
      }
      const q = quarter(f.t);
      plan.quarters.add(q);
      const toks = [`tfs${q}`];
      const lh = lineHeightToken(row.lh, row.s, f.t);
      if (lh) toks.push(lh);
      if (f.role === 'running') {
        plan.running.add(el);
        if (el.childElementCount === 0) {
          const aspect = xHeightRatio(env.doc, row.family, row.weight);
          if (aspect !== null && aspect < 0.47) toks.push('tfa');
        }
      }
      plan.pinned.delete(el);
      out.push([el, toks]);
    });
    if (plan.quarters.size !== quarters) applied.prepared.css = textCss(plan);
    return out;
  },
  incremental(env, applied, roots) {
    const out: Array<[Element, string]> = [];
    for (const [el, toks] of textFloor.retoken?.(env, applied, roots) ?? [])
      for (const t of toks) out.push([el, t]);
    return out;
  },
};

/** For tests: the curve's parameters for an applied text_floor. */
export function textPlanSummary(prepared: Prepared): {
  floorPx: number;
  bodyPx: number;
  lowPx: number;
  cHigh: number;
  cLow: number;
  excluded: number;
  held: number;
  grown: number;
} | null {
  const plan = PLANS.get(prepared);
  if (!plan) return null;
  const fields = [...plan.fields.values()];
  return {
    floorPx: round(plan.F, 2),
    bodyPx: round(plan.b, 2),
    lowPx: round(plan.sLo, 2),
    cHigh: round(plan.cHigh, 3),
    cLow: round(plan.cLow, 3),
    excluded: [...plan.classes.values()].filter((c) => c.risk).length,
    held: fields.filter((f) => f.held === 'small').length,
    grown: fields.filter((f) => !f.held).length,
  };
}

// ---------------------------------------------------------------------------
// line_spacing: running text in main content (engine.md 3.4.2)
// ---------------------------------------------------------------------------

/** Word spacing that accompanies each line-height level (never above WCAG's 0.16em). */
export function wordSpacingFor(lineHeight: number): number {
  if (lineHeight >= 2) return 0.16;
  if (lineHeight >= 1.8) return 0.12;
  if (lineHeight >= 1.6) return 0.08;
  return 0.06;
}

/** Running text never sits in navigation, menus, controls or page headers. */
const NOT_RUNNING =
  'nav, [role="navigation"], [role="menu"], [role="tablist"], a, button, label, header';

function isRunningText(env: OpEnv, t: TextFact, minChars: number): boolean {
  if (t.chars < minChars) return false;
  const tag = t.el.localName;
  if (/^h[1-6]$/.test(tag)) return false;
  if (!RUNNING_TEXT.test(tag)) return false;
  if (t.el.closest(NOT_RUNNING)) return false;
  const d = env.view.getComputedStyle(t.el).display;
  return BLOCK_DISPLAY.test(d);
}

export const lineSpacing: OpImpl = {
  id: 'line_spacing',
  prepare(env, target, scope) {
    const marks: Array<[Element, string]> = [];
    const before: Array<[number, number]> = [];
    for (const t of scopedText(env, scope)) {
      if (!isRunningText(env, t, 40)) continue;
      const cs = env.view.getComputedStyle(t.el);
      const size = parseFloat(cs.fontSize);
      const ratio = (lineHeightPx(cs) ?? size * 1.2) / size;
      if (!Number.isFinite(ratio) || ratio >= target - 0.02) continue;
      marks.push([t.el, 'ls']);
      before.push([ratio, t.chars]);
    }
    if (marks.length === 0) return notNeeded('running text already spaced');
    const b = weightedMedian(before) ?? 1.2;
    return {
      status: 'ready',
      css: {
        doc: `${tok('ls')} { line-height: ${target} !important; word-spacing: ${wordSpacingFor(target)}em !important; }`,
      },
      marks,
      count: marks.length,
      fit: { before: String(round(b, 1)), after: String(target) },
      show: inViewportFirst(
        env,
        marks.map(([el]) => el),
      ),
    };
  },
  incremental(env, applied, roots) {
    // A main region the page replaced no longer bounds anything.
    const main = env.facts.main?.isConnected ? env.facts.main : null;
    const out: Array<[Element, string]> = [];
    const seen = new Set<Element>();
    for (const root of roots) {
      if (
        main &&
        !composedContains(main, root) &&
        !composedContains(root, main)
      )
        continue;
      for (const el of [
        root,
        ...root.querySelectorAll('p, li, dd, blockquote, figcaption'),
      ].slice(0, 200)) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (main && !composedContains(main, el)) continue;
        if (!RUNNING_TEXT.test(el.localName) || /^h[1-6]$/.test(el.localName))
          continue;
        if (el.closest(NO_TEXT_OPS) || el.closest(NOT_RUNNING)) continue;
        if ((el.textContent ?? '').trim().length < 40) continue;
        const cs = env.view.getComputedStyle(el);
        if (!BLOCK_DISPLAY.test(cs.display)) continue;
        const size = parseFloat(cs.fontSize);
        const ratio = (lineHeightPx(cs) ?? size * 1.2) / size;
        if (ratio < applied.value - 0.02) out.push([el, 'ls']);
      }
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// line_length: cap the measure of main-content paragraphs (engine.md 3.4.4)
// ---------------------------------------------------------------------------

function charsPerLine(env: OpEnv, el: Element): number | null {
  const cs = env.view.getComputedStyle(el);
  const avg = avgCharWidth(el, cs);
  if (!avg) return null;
  const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const width =
    (el as HTMLElement).clientWidth - (Number.isFinite(pad) ? pad : 0);
  return width > 0 ? width / avg : null;
}

export const lineLength: OpImpl = {
  id: 'line_length',
  prepare(env, maxCh, scope) {
    const marks: Array<[Element, string]> = [];
    const before: number[] = [];
    for (const t of scopedText(env, scope)) {
      if (!isRunningText(env, t, 80)) continue;
      const cs = env.view.getComputedStyle(t.el);
      if (cs.float !== 'none') continue;
      const parent = t.el.parentElement;
      if (parent) {
        const pd = env.view.getComputedStyle(parent).display;
        if (/flex|grid/.test(pd)) continue;
      }
      const cpl = charsPerLine(env, t.el);
      if (cpl === null || cpl <= maxCh + 5 || t.chars < maxCh) continue;
      marks.push([t.el, 'll']);
      before.push(cpl);
    }
    if (marks.length === 0)
      return notNeeded('lines already within the measure');
    return {
      status: 'ready',
      css: { doc: `${tok('ll')} { max-inline-size: ${maxCh}ch !important; }` },
      marks,
      count: marks.length,
      fit: { before: ch(median(before) ?? maxCh), after: ch(maxCh) },
      show: inViewportFirst(
        env,
        marks.map(([el]) => el),
      ),
    };
  },
  afterApply(env, applied) {
    const after = env.marks
      .elementsFor('line_length')
      .slice(0, 30)
      .map((el) => charsPerLine(env, el))
      .filter((v): v is number => v !== null);
    const m = median(after);
    if (m !== null && applied.prepared.fit)
      applied.prepared.fit = { ...applied.prepared.fit, after: ch(m) };
  },
};
