import type {
  CardStyle,
  FieldRole,
  FieldShow,
  FitLayout,
  FitStructure,
  Importance,
  ItemKind,
  LeadMode,
  Locator,
  MediaShape,
  PageSpec,
  PageType,
  SectionKind,
  SectionLayout,
  Skeleton,
  SkeletonNode,
  SkelFlag,
  SkelKind,
  SkelRole,
  SkelTag,
  SpecEnvelope,
} from '@webable/core';

import { heuristicSpec } from '@webable/core/compose/heuristic';
import { validateSpec } from '@webable/core/compose/validate';
import { solveFitLayout } from '@webable/core/fit/solver';
import { typeRamp } from '@webable/core/fit/typeramp';
import { defaultFitProfile } from '@webable/core/profile/defaults';
import { FIT_SOLVER_VERSION } from '@webable/core/versions';

import { installKeyBridge } from '../../../entrypoints/keybridge.content';
import type {
  ContentReplies,
  ContentToWorker,
  FitViewEvent,
  FitViewOpenReply,
} from '../../../lib/protocol';
import { HOST_TAG } from '../../../lib/engine/util/dom';
import { installFirewall } from '../../../lib/engine/fitview/firewall';
import {
  createFitViewRuntime,
  type FitViewInspect,
} from '../../../lib/engine/fitview/index';
import { createLive } from '../../../lib/engine/fitview/live';
import {
  measureSurface,
  templateMismatches,
} from '../../../lib/engine/fitview/metrics';
import type {
  CreateLive,
  EngineApi,
  FitViewOpenInput,
  FitViewRuntime,
  LiveLayer,
  MediaInfo,
  ProxyTarget,
  SkeletonRegistry,
} from '../../../lib/engine/fitview/types';
import { readSkeleton } from '../../../lib/engine/skeleton';

/**
 * Fit view harness (tests/v2/fitview.spec.ts), served at /__v2/fitview.js.
 *
 *   - A small stand-in skeleton reader for the fixture pages (WP3a's reader
 *     is tested on its own; this one only has to produce a valid Skeleton and
 *     a live SkeletonRegistry for the renderer).
 *   - Specs written with CSS selectors, turned into node ids here, so tests do
 *     not depend on id numbering.
 *   - A fake EngineApi that records freeze() calls and messages, and a fake
 *     live layer that records every bound ProxyTarget.
 *   - A FitLayout builder following docs/10 §4.2.
 *   - openReal(): the production pipeline end to end, as fitview.js runs it:
 *     the real skeleton reader (engine/skeleton), the core heuristic spec and
 *     validator the worker uses, the fit solver, and the real live layer
 *     (fitview/live.ts) behind the input firewall and the key bridge.
 */

// ---------------------------------------------------------------------------
// Stand-in reader
// ---------------------------------------------------------------------------

const SKIP = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'head',
  'meta',
  'link',
  'title',
  'base',
  'br',
  'wbr',
  HOST_TAG,
]);
const TAGS = new Set<string>([
  'a',
  'article',
  'aside',
  'audio',
  'blockquote',
  'body',
  'button',
  'canvas',
  'code',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'em',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'iframe',
  'img',
  'input',
  'label',
  'legend',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'picture',
  'pre',
  'section',
  'select',
  'small',
  'span',
  'strong',
  'summary',
  'svg',
  'table',
  'td',
  'textarea',
  'th',
  'time',
  'tr',
  'ul',
  'video',
]);
const LANDMARK_TAG: Record<string, SkelRole> = {
  header: 'banner',
  nav: 'navigation',
  main: 'main',
  aside: 'complementary',
  footer: 'contentinfo',
  form: 'form',
};
const LANDMARK_ROLES = new Set([
  'banner',
  'navigation',
  'main',
  'complementary',
  'contentinfo',
  'search',
  'region',
  'form',
  'dialog',
]);
const CONTROL_ROLES = new Set([
  'button',
  'link',
  'tab',
  'menuitem',
  'checkbox',
  'switch',
  'radio',
  'option',
]);
const INLINE = new Set([
  'a',
  'abbr',
  'b',
  'cite',
  'code',
  'em',
  'i',
  'kbd',
  'mark',
  'q',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'br',
  'img',
]);

interface Raw {
  el: Element;
  kind: SkelKind;
  role: SkelRole | null;
  flags: SkelFlag[];
  children: Raw[];
  members?: Element[];
  exemplar?: Raw;
  slot?: boolean;
}

const vis = (el: Element): boolean => {
  const e = el as Element & {
    checkVisibility?: (o?: Record<string, boolean>) => boolean;
  };
  return e.checkVisibility
    ? e.checkVisibility({ visibilityProperty: true, opacityProperty: true })
    : true;
};

const clean = (s: string | null | undefined): string =>
  (s ?? '').replace(/\s+/g, ' ').trim();

function srOnly(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width <= 1 && r.height <= 1;
}

function clipped(el: Element): boolean {
  const r = el.getBoundingClientRect();
  for (
    let p = el.parentElement;
    p && p !== document.body;
    p = p.parentElement
  ) {
    const cs = getComputedStyle(p);
    if (cs.overflowY === 'hidden' || cs.overflowY === 'clip') {
      const pr = p.getBoundingClientRect();
      if (r.top >= pr.bottom - 1 || r.bottom <= pr.top + 1) return true;
    }
  }
  return false;
}

function visibleText(el: Element): string {
  let out = '';
  const walk = (n: Node): void => {
    if (n.nodeType === 3) {
      out += n.nodeValue ?? '';
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    if (SKIP.has(e.localName) && e.localName !== 'br') return;
    if (e.localName === 'br') {
      out += ' ';
      return;
    }
    if (!vis(e) || (e.childNodes.length && srOnly(e)) || clipped(e)) return;
    if (e.localName === 'img') return;
    for (const c of Array.from(e.childNodes)) walk(c);
    if (!INLINE.has(e.localName)) out += ' ';
  };
  walk(el);
  return clean(out);
}

function accName(el: Element): string {
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (clean(t)) return clean(t);
  }
  const al = el.getAttribute('aria-label');
  if (clean(al)) return clean(al);
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  ) {
    const l = Array.from(el.labels ?? [])
      .map((x) => x.textContent)
      .join(' ');
    if (clean(l)) return clean(l);
    if (el instanceof HTMLInputElement && /^(submit|button)$/.test(el.type))
      return clean(el.value);
    return clean(el.getAttribute('title'));
  }
  if (el.localName === 'img') return clean(el.getAttribute('alt'));
  const t = visibleText(el);
  if (t) return t;
  const img = el.querySelector('img[alt]');
  if (img) return clean(img.getAttribute('alt'));
  return clean(el.getAttribute('title'));
}

function roleOf(el: Element): SkelRole | null {
  const r = el.getAttribute('role');
  if (r) return r as SkelRole;
  const t = el.localName;
  if (LANDMARK_TAG[t]) return LANDMARK_TAG[t] as SkelRole;
  if (t === 'a' && el.hasAttribute('href')) return 'link';
  if (t === 'button' || t === 'summary') return 'button';
  if (/^h[1-6]$/.test(t)) return 'heading';
  if (t === 'input') {
    const ty = (el as HTMLInputElement).type;
    if (ty === 'checkbox') return 'checkbox';
    if (ty === 'radio') return 'radio';
    if (ty === 'search') return 'searchbox';
    if (/^(submit|button|reset|image)$/.test(ty)) return 'button';
    return 'textbox';
  }
  if (t === 'select') return 'combobox';
  if (t === 'textarea') return 'textbox';
  if (t === 'ul' || t === 'ol') return 'list';
  if (t === 'li') return 'listitem';
  if (t === 'img') return 'img';
  return null;
}

function kindOf(el: Element): SkelKind | null {
  const t = el.localName;
  const role = el.getAttribute('role') ?? '';
  if (t === 'input') {
    const ty = (el as HTMLInputElement).type;
    if (ty === 'hidden') return null;
    if (/^(submit|button|reset|image)$/.test(ty)) return 'control';
    return 'input';
  }
  if (t === 'select' || t === 'textarea') return 'input';
  if (
    (t === 'a' && el.hasAttribute('href')) ||
    t === 'button' ||
    t === 'summary' ||
    CONTROL_ROLES.has(role)
  )
    return 'control';
  if (/^h[1-6]$/.test(t) || role === 'heading') return 'heading';
  if (t === 'img') {
    const r = el.getBoundingClientRect();
    return r.width >= 20 && r.height >= 20 ? 'media' : null;
  }
  if (t === 'picture' || t === 'video' || t === 'iframe' || t === 'canvas')
    return 'media';
  if (t === 'table') return 'table';
  return null;
}

/** Same template: tag, role and the first class token (state classes vary). */
function sig(el: Element): string {
  const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/)[0] ?? '';
  return `${el.localName}|${cls}|${el.getAttribute('role') ?? ''}`;
}

function isLandmark(el: Element): boolean {
  if (LANDMARK_TAG[el.localName]) return true;
  const r = el.getAttribute('role');
  if (r && LANDMARK_ROLES.has(r)) return true;
  return el.localName === 'section' && el.hasAttribute('aria-label');
}

function directText(el: Element): number {
  let n = 0;
  for (const c of Array.from(el.childNodes))
    if (c.nodeType === 3) n += clean(c.nodeValue).length;
  return n;
}

function inlineOnly(el: Element): boolean {
  return Array.from(el.children).every((c) => INLINE.has(c.localName));
}

function flagsOf(el: Element): SkelFlag[] {
  const f: SkelFlag[] = [];
  const cs = getComputedStyle(el);
  if (cs.position === 'fixed') f.push('fixed');
  if (cs.position === 'sticky') f.push('sticky');
  if (el.closest('[data-hover-only]')) f.push('hoveronly');
  if (el.getAttribute('aria-haspopup')) f.push('popup');
  if (
    el.getAttribute('aria-current') ||
    el.getAttribute('aria-selected') === 'true'
  )
    f.push('selected');
  if (el.getAttribute('aria-pressed') === 'true') f.push('pressed');
  if (/\bad\b|sponsor/i.test(`${el.id} ${el.getAttribute('class') ?? ''}`))
    f.push('adhint');
  if (Number(cs.fontWeight) >= 600) f.push('bold');
  if ((el as HTMLInputElement).required) f.push('required');
  if (el.querySelector('img') && !clean(el.textContent)) f.push('imgctrl');
  return f;
}

function build(el: Element, inSlot: boolean): Raw[] {
  if (SKIP.has(el.localName)) return [];
  if (!vis(el)) return [];
  if (srOnly(el) && el.localName !== 'input') return [];
  const kind = kindOf(el);
  const raw = (k: SkelKind, children: Raw[] = []): Raw => ({
    el,
    kind: k,
    role: roleOf(el),
    flags: flagsOf(el),
    children,
    slot: inSlot,
  });
  if (kind === 'heading') {
    const link = el.querySelector('a[href]');
    const kids = link && vis(link) ? build(link, inSlot) : [];
    return [raw('heading', kids)];
  }
  if (kind) return [raw(kind)];
  const kids = Array.from(el.children);
  // A run of >= 3 same-signature children is a collection.
  if (kids.length >= 3) {
    const counts = new Map<string, Element[]>();
    for (const k of kids) {
      if (!vis(k) || SKIP.has(k.localName)) continue;
      const s = sig(k);
      const list = counts.get(s) ?? [];
      list.push(k);
      counts.set(s, list);
    }
    const best = [...counts.values()].sort((a, b) => b.length - a.length)[0];
    const shown = kids.filter((k) => vis(k) && !SKIP.has(k.localName)).length;
    if (best && best.length >= 3 && best.length === shown) {
      const first = best[0] as Element;
      const exKind =
        kindOf(first) ??
        (directText(first) > 0 &&
        inlineOnly(first) &&
        !first.querySelector('a[href],button')
          ? visibleText(first).length > 40
            ? 'text'
            : 'stext'
          : null);
      const exChildren = exKind
        ? []
        : Array.from(first.children).flatMap((c) => build(c, true));
      const exemplar: Raw = {
        el: first,
        kind: exKind ?? 'group',
        role: roleOf(first),
        flags: flagsOf(first),
        children: exChildren,
        slot: true,
      };
      const n = raw('collection');
      n.members = best;
      n.exemplar = exemplar;
      return [n];
    }
  }
  const childRaw = kids.flatMap((c) => build(c, inSlot));
  if (isLandmark(el)) return [raw('landmark', childRaw)];
  if (directText(el) > 0 && inlineOnly(el)) {
    const t = visibleText(el);
    if (!t) return [];
    const links = el.querySelectorAll('a[href]').length;
    if (links && el.localName !== 'a') {
      const n = raw(t.length > 40 ? 'text' : 'stext');
      return [n];
    }
    return [raw(t.length > 40 ? 'text' : 'stext')];
  }
  if (!childRaw.length) {
    const t = visibleText(el);
    if (t && inlineOnly(el)) return [raw(t.length > 40 ? 'text' : 'stext')];
    return [];
  }
  if (childRaw.length >= 2 && el !== document.body)
    return [raw('group', childRaw)];
  return childRaw;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function pathFrom(root: Element, el: Element): number[] | null {
  const steps: number[] = [];
  for (let n: Element | null = el; n && n !== root; n = n.parentElement) {
    const p = n.parentElement;
    if (!p) return null;
    steps.unshift(Array.prototype.indexOf.call(p.children, n));
  }
  return steps;
}

function follow(root: Element, steps: number[]): Element | null {
  let n: Element | null = root;
  for (const i of steps) n = n?.children[i] ?? null;
  return n;
}

const PAT: Array<[RegExp, 'price' | 'duration' | 'date' | 'rating' | 'count']> =
  [
    [/[$€£]\s?\d/, 'price'],
    [/^\d{1,2}:\d{2}(:\d{2})?$/, 'duration'],
    [
      /\bago\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d/i,
      'date',
    ],
    [/out of 5|★/, 'rating'],
    [/\d\s?[KM]?\s*(views|ratings|reviews|comments)/i, 'count'],
  ];

export interface Reading {
  skeleton: Skeleton;
  registry: SkeletonRegistry;
  idOf: Map<Element, string>;
  elOf: Map<string, Element>;
}

let extraction = 0;

export function read(): Reading {
  const t0 = performance.now();
  const extractionId = `x${++extraction}`;
  const roots = build(document.body, false);
  const nodes: SkeletonNode[] = [];
  const idOf = new Map<Element, string>();
  const elOf = new Map<string, Element>();
  const lists = new Map<
    string,
    {
      container: Element;
      sig: string;
      exemplar: Element;
      slots: Map<string, number[]>;
    }
  >();
  const add = (
    r: Raw,
    parent: string | null,
    depth: number,
    listId: string | null,
  ): void => {
    const id = `e${nodes.length + 1}`;
    const el = r.el;
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const tag = (
      TAGS.has(el.localName)
        ? el.localName
        : el.localName.includes('-')
          ? 'custom'
          : 'other'
    ) as SkelTag;
    const node: SkeletonNode = {
      id,
      parent,
      depth,
      tag,
      role: r.role,
      kind: r.kind,
      box: [
        Math.round(rect.left + scrollX),
        Math.round(rect.top + scrollY),
        Math.round(rect.width),
        Math.round(rect.height),
      ],
      flags: r.flags,
    };
    if (
      r.kind === 'heading' ||
      r.kind === 'text' ||
      r.kind === 'stext' ||
      r.kind === 'control'
    ) {
      node.fontPx = parseFloat(cs.fontSize);
      node.weight = Number(cs.fontWeight) || 400;
    }
    if (r.kind === 'heading') {
      const m = /^h([1-6])$/.exec(el.localName);
      node.level = m
        ? Number(m[1])
        : Number(el.getAttribute('aria-level') ?? 2);
    }
    if (r.kind === 'input') {
      const ty =
        el instanceof HTMLSelectElement
          ? 'select'
          : el instanceof HTMLTextAreaElement
            ? 'textarea'
            : (el as HTMLInputElement).type;
      node.inputType = (
        [
          'text',
          'search',
          'email',
          'tel',
          'url',
          'number',
          'password',
          'checkbox',
          'radio',
          'range',
          'date',
          'file',
          'select',
          'textarea',
        ].includes(ty)
          ? ty
          : 'other'
      ) as SkeletonNode['inputType'];
      if (el instanceof HTMLSelectElement) node.options = el.options.length;
    }
    if (
      r.kind !== 'landmark' &&
      r.kind !== 'group' &&
      r.kind !== 'collection'
    ) {
      const label =
        r.kind === 'control' || r.kind === 'input' || r.kind === 'media'
          ? accName(el)
          : visibleText(el);
      if (label) node.label = label.slice(0, 80);
      const text = visibleText(el);
      if (text) {
        const pat = PAT.filter(([re]) => re.test(text)).map(([, p]) => p);
        node.text = { chars: text.length };
        if (pat.length) node.text.pat = pat;
        const links = el.querySelectorAll('a[href]').length;
        if (links && r.kind !== 'control') node.text.links = links;
      }
    }
    if (el.localName === 'a') {
      const href = el.getAttribute('href') ?? '';
      node.href = href.startsWith('#') ? 'fragment' : 'same';
    }
    if (r.slot) node.slot = true;
    nodes.push(node);
    idOf.set(el, id);
    elOf.set(id, el);
    if (r.kind === 'collection' && r.exemplar && r.members) {
      const ex = r.exemplar;
      node.collection = {
        count: r.members.length,
        itemTag: (TAGS.has(ex.el.localName)
          ? ex.el.localName
          : 'other') as SkelTag,
        exemplar: `e${nodes.length + 1}`,
      };
      lists.set(id, {
        container: el,
        sig: sig(ex.el),
        exemplar: ex.el,
        slots: new Map(),
      });
      add(ex, id, depth + 1, id);
      return;
    }
    if (listId) {
      const list = lists.get(listId);
      const p = list ? pathFrom(list.exemplar, el) : null;
      if (list && p) list.slots.set(id, p);
    }
    for (const c of r.children) add(c, id, depth + 1, listId);
  };
  const top: Raw = {
    el: document.body,
    kind: 'landmark',
    role: null,
    flags: [],
    children: roots,
  };
  add(top, null, 0, null);

  const registry: SkeletonRegistry = {
    extractionId,
    element: (id) => {
      const el = elOf.get(id);
      return el?.isConnected ? el : null;
    },
    members: (listId) => {
      const l = lists.get(listId);
      if (!l?.container.isConnected) return [];
      return Array.from(l.container.children).filter(
        (c) => sig(c) === l.sig && vis(c),
      );
    },
    slot: (listId, member, slotId) => {
      const l = lists.get(listId);
      const p = l?.slots.get(slotId);
      if (!l || !p) return null;
      const el = follow(member, p);
      const ex = elOf.get(slotId);
      return el && ex && el.localName === ex.localName ? el : null;
    },
    text: (el) => visibleText(el),
    name: (el) => accName(el),
    media: (el): MediaInfo => {
      const img =
        el instanceof HTMLImageElement
          ? el
          : (el.querySelector('img') as HTMLImageElement | null);
      if (img) {
        const src = img.currentSrc || img.getAttribute('src') || null;
        const r = img.getBoundingClientRect();
        return {
          src: src ? new URL(src, location.href).href : null,
          srcset: img.getAttribute('srcset'),
          width:
            Number(img.getAttribute('width')) || img.naturalWidth || r.width,
          height:
            Number(img.getAttribute('height')) || img.naturalHeight || r.height,
          alt: clean(img.getAttribute('alt')),
        };
      }
      const r = el.getBoundingClientRect();
      return {
        src: null,
        srcset: null,
        width: r.width,
        height: r.height,
        alt: '',
      };
    },
    href: (el) => {
      const a = el.closest('a[href]') as HTMLAnchorElement | null;
      if (!a) return null;
      return /^(https?|mailto|tel):$/.test(a.protocol) ? a.href : null;
    },
    recordKey: (_listId, member) =>
      member.id ||
      member.getAttribute('data-key') ||
      `h${hash(visibleText(member))}`,
    fingerprint: (_listId, member) => hash(visibleText(member)),
    // The reader's ad rule (adhint): ad or sponsored markings on the record.
    isAd: (_listId, member) =>
      /\bad\b|sponsor/i.test(
        `${member.id} ${member.getAttribute('class') ?? ''}`,
      ) || member.querySelector('[class*="sponsor"]') !== null,
    locator: (id): Locator => {
      const node = nodes.find((n) => n.id === id);
      const el = elOf.get(id);
      const path = el ? (pathFrom(document.body, el) ?? []).map(String) : [];
      return { path, kind: node?.kind ?? 'group' };
    },
    resolve: (loc) => follow(document.body, loc.path.map(Number)),
  };
  const skeleton: Skeleton = {
    v: 1,
    version: 'skel-1.0.0',
    extractionId,
    viewport: { width: innerWidth, height: innerHeight, zoom: 1 },
    doc: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    },
    lang: 'en',
    nodes,
    truncated: false,
    structure: hash(nodes.map((n) => `${n.tag}${n.kind}${n.depth}`).join()),
    typed: [],
    perf: { ms: Math.round(performance.now() - t0), nodes: nodes.length },
  };
  return { skeleton, registry, idOf, elOf };
}

// ---------------------------------------------------------------------------
// Layout (docs/10 §4.2)
// ---------------------------------------------------------------------------

export interface LayoutOpts {
  F?: number;
  T?: number;
  scheme?: 'light' | 'dark';
  contrast?: 'standard' | 'more' | 'max';
  font?: 'atkinson' | 'system';
  inlineMax?: number;
  tertiary?: 'collapsed' | 'expanded';
  groupEvery?: number;
  motion?: 'reduce' | 'allow';
  /** docs/11 structure settings (level 0 and no restructure by default). */
  structure?: Partial<FitStructure>;
}

export function makeLayout(o: LayoutOpts = {}): FitLayout {
  const F = o.F ?? 18;
  const T = o.T ?? 44;
  const unit = Math.round(F * 0.75);
  const cardPad = unit;
  return {
    v: 1,
    version: FIT_SOLVER_VERSION,
    type: {
      // The solver's own ramp (docs/12 §4.2): headings 600, body 400.
      ...typeRamp(F, 400),
      lineHeight: 1.5,
      wordSpacingEm: 0.04,
      letterSpacingEm: 0,
      maxLineCh: 66,
      minLineCh: 13,
      font: o.font ?? 'system',
    },
    target: {
      minPx: T,
      gapPx: Math.max(8, Math.round(T * 0.2)),
      controlPx: Math.max(T, Math.round(F * 2.2)),
    },
    space: {
      unitPx: unit,
      groupGapPx: Math.round(unit * 2.5),
      sectionGapPx: Math.round(unit * 3),
      cardPadPx: cardPad,
      pagePadPx: Math.max(16, unit),
      maxContentPx: 1200,
    },
    grid: {
      card_media: { minWidthPx: Math.round(11 * F + 2 * cardPad), maxCols: 4 },
      card_text: { minWidthPx: Math.round(16 * F), maxCols: 3 },
      row: { minWidthPx: 0, maxCols: 1 },
    },
    groupEvery: o.structure?.groupEvery ?? o.groupEvery ?? 6,
    structure: {
      level: 0,
      listFirst: null,
      splitSentences: null,
      outline: false,
      sectionsOpen: null,
      ...o.structure,
      groupEvery: o.structure?.groupEvery ?? o.groupEvery ?? 6,
    },
    nav: { inlineMax: o.inlineMax ?? 8 },
    tertiary: o.tertiary ?? 'collapsed',
    palette: {
      scheme: o.scheme ?? 'light',
      contrast: o.contrast ?? 'standard',
    },
    motion: o.motion ?? 'allow',
  };
}

// ---------------------------------------------------------------------------
// Spec by selectors
// ---------------------------------------------------------------------------

export interface SectionSel {
  kind: SectionKind;
  importance?: Importance;
  nodes: string[];
  heading?: string;
  /** Default: the kind's layout (docs/12 §6.1). */
  layout?: SectionLayout;
}
export interface CollectionSel {
  list: string;
  item_kind: ItemKind;
  /** Relative to the first member. */
  open?: string;
  fields: Array<{ slot: string; role: FieldRole; show?: FieldShow }>;
  /** Default: the item kind's card and media shape (docs/12 §6.2); no lead. */
  card?: CardStyle;
  media?: MediaShape;
  lead?: LeadMode;
}

/**
 * Each kind's layout (docs/12 §6.1). Kinds the table gives no layout keep
 * the plain one-column rendering ('reading', the old 'single_column').
 */
const LAYOUT_FOR: Partial<Record<SectionKind, SectionLayout>> = {
  page_heading: 'hero',
  promo_hero: 'hero',
  product_detail: 'buy_box',
  main_list: 'card_grid',
  related: 'card_grid',
  comments: 'row_list',
  secondary_nav: 'row_list',
  tabs: 'chip_bar',
  filters: 'chip_bar',
  sort_and_view: 'chip_bar',
  breadcrumbs: 'chip_bar',
  pagination: 'chip_bar',
  article: 'reading',
  feature_blocks: 'spotlight',
  footer: 'link_grid',
  legal: 'link_grid',
  form: 'form_panel',
  media: 'as_is',
  ads: 'as_is',
  clutter: 'as_is',
  overlay_modal: 'as_is',
  toolbar: 'as_is',
};

/** Each item kind's card and media shape (docs/12 §6.2). */
const CARD_FOR: Record<ItemKind, [CardStyle, MediaShape]> = {
  product: ['tile', 'square'],
  feature: ['tile', 'landscape'],
  video: ['media', 'landscape'],
  image: ['media', 'square'],
  article_card: ['story', 'landscape'],
  post: ['story', 'none'],
  event: ['story', 'none'],
  search_result: ['row', 'none'],
  reference: ['row', 'none'],
  file: ['row', 'none'],
  comment: ['row', 'none'],
  other: ['row', 'none'],
  message: ['message', 'none'],
  person: ['person', 'square'],
  tab: ['chip', 'none'],
  chip: ['chip', 'none'],
  filter_option: ['chip', 'none'],
  nav_link: ['link', 'none'],
};
export interface OpenOpts {
  sections: SectionSel[];
  collections?: CollectionSel[];
  primary?: number;
  /** 'auto' (default): every node outside the sections; [] leaves things out on purpose. */
  rest?: 'auto' | string[];
  layout?: LayoutOpts;
  zoom?: number;
  secure?: boolean;
  label?: string;
  font?: string;
  shadow?: 'open' | 'closed';
  live?: boolean;
  source?: 'heuristic' | 'planner';
  pageType?: PageType;
  /** reply.alwaysHere and reply.intro (docs/11 §2). */
  alwaysHere?: boolean;
  intro?: boolean;
}

function idFor(r: Reading, sel: string, within?: Element): string {
  const el = (within ?? document).querySelector(sel);
  if (!el) throw new Error(`no element for ${sel}`);
  const id = r.idOf.get(el);
  if (!id) throw new Error(`no node for ${sel}`);
  return id;
}

function subtree(nodes: SkeletonNode[], id: string): Set<string> {
  const out = new Set([id]);
  for (const n of nodes) if (n.parent && out.has(n.parent)) out.add(n.id);
  return out;
}

export function specFor(r: Reading, o: OpenOpts): SpecEnvelope {
  const sections = o.sections.map((s) => ({
    kind: s.kind,
    importance: s.importance ?? 'secondary',
    node_ids: s.nodes.map((sel) => idFor(r, sel)),
    heading_ref: s.heading ? idFor(r, s.heading) : null,
    layout: s.layout ?? LAYOUT_FOR[s.kind] ?? 'reading',
  }));
  const collections = (o.collections ?? []).map((c) => {
    const listId = idFor(r, c.list);
    const node = r.skeleton.nodes.find((n) => n.id === listId);
    const ex = node?.collection?.exemplar;
    const exEl = ex ? r.elOf.get(ex) : null;
    if (!exEl) throw new Error(`${c.list} is not a collection`);
    const rel = (sel: string): string =>
      sel === ':scope' ? (ex as string) : idFor(r, sel, exEl);
    const [card, media] = CARD_FOR[c.item_kind];
    return {
      list_id: listId,
      item_kind: c.item_kind,
      open_slot: c.open ? rel(c.open) : null,
      card: c.card ?? card,
      media: c.media ?? media,
      lead: c.lead ?? 'none',
      fields: c.fields.map((f) => ({
        slot_id: rel(f.slot),
        role: f.role,
        show: f.show ?? 'always',
      })),
    };
  });
  // A list of text records is a grouped row list, not a card grid.
  const VISUAL: ReadonlySet<CardStyle> = new Set(['tile', 'media', 'story']);
  sections.forEach((s, i) => {
    if (o.sections[i]?.layout || s.layout !== 'card_grid') return;
    const inside = new Set(
      s.node_ids.flatMap((id) => [...subtree(r.skeleton.nodes, id)]),
    );
    const own = collections.filter((c) => inside.has(c.list_id));
    if (own.length && !own.some((c) => VISUAL.has(c.card)))
      s.layout = 'row_list';
  });
  const primary = o.primary ?? 0;
  sections.forEach((s, i) => {
    s.importance =
      i === primary
        ? 'primary'
        : s.importance === 'primary'
          ? 'secondary'
          : s.importance;
  });
  let rest: string[] = [];
  if (Array.isArray(o.rest)) rest = o.rest.map((sel) => idFor(r, sel));
  else {
    const covered = new Set<string>();
    for (const s of sections) {
      for (const id of [
        ...s.node_ids,
        ...(s.heading_ref ? [s.heading_ref] : []),
      ])
        for (const x of subtree(r.skeleton.nodes, id)) covered.add(x);
    }
    const ancestorOfCovered = new Set<string>();
    for (const id of covered) {
      for (
        let p = r.skeleton.nodes.find((n) => n.id === id)?.parent ?? null;
        p;
        p = r.skeleton.nodes.find((n) => n.id === p)?.parent ?? null
      )
        ancestorOfCovered.add(p);
    }
    const inRest = new Set<string>();
    for (const n of r.skeleton.nodes) {
      if (n.slot || covered.has(n.id) || ancestorOfCovered.has(n.id)) continue;
      if (n.parent && inRest.has(n.parent)) {
        inRest.add(n.id);
        continue;
      }
      inRest.add(n.id);
      rest.push(n.id);
    }
  }
  const spec: PageSpec = {
    v: 1,
    page_type: o.pageType ?? 'other',
    primary_task: 'other',
    sections,
    collections,
  };
  return {
    source: o.source ?? 'heuristic',
    extractionId: r.skeleton.extractionId,
    validated: { spec, primary, rest, repairs: [] },
    createdAt: Date.now() + Math.random(),
  };
}

// ---------------------------------------------------------------------------
// Fake engine and live layer
// ---------------------------------------------------------------------------

const events: FitViewEvent[] = [];
const messages: ContentToWorker[] = [];
const frozen: boolean[] = [];
const bound: ProxyTarget[] = [];
let nextReply: FitViewOpenReply | null = null;
let current: Reading | null = null;

/** openReal(): the reader, spec and live layer are the production ones. */
let real: { opts: RealOpts; live: LiveLayer | null } | null = null;
/** Controls handed to the real live layer's proxies. */
let boundEls = new WeakSet<HTMLElement>();

const engine: EngineApi = {
  async skeleton() {
    if (real) return readSkeleton(document);
    current = read();
    return { skeleton: current.skeleton, registry: current.registry };
  },
  freeze(on) {
    frozen.push(on);
  },
  async send<T extends ContentToWorker>(
    msg: T,
  ): Promise<ContentReplies[T['type']]> {
    messages.push(msg);
    if (msg.type === 'cs:fitview-event') {
      events.push(
        (msg as Extract<ContentToWorker, { type: 'cs:fitview-event' }>).event,
      );
      return { ok: true } as ContentReplies[T['type']];
    }
    if (msg.type === 'cs:fitview-request') {
      // The worker's heuristic path for the skeleton it was sent.
      if (real) {
        const m = msg as Extract<
          ContentToWorker,
          { type: 'cs:fitview-request' }
        >;
        return realReply(m.skeleton, real.opts) as ContentReplies[T['type']];
      }
      const r = nextReply ?? { ok: false as const, why: 'error' as const };
      return r as ContentReplies[T['type']];
    }
    return { ok: true } as unknown as ContentReplies[T['type']];
  },
  onRoute(cb) {
    if (!real) return () => undefined;
    const on = (): void => cb();
    addEventListener('popstate', on);
    addEventListener('hashchange', on);
    return () => {
      removeEventListener('popstate', on);
      removeEventListener('hashchange', on);
    };
  },
  measured<T>(fn: () => T): T {
    return fn();
  },
};

// ---------------------------------------------------------------------------
// The production pipeline (openReal)
// ---------------------------------------------------------------------------

export interface RealOpts {
  /** A harness layout; the fit solver's default-profile layout otherwise. */
  layout?: LayoutOpts;
  zoom?: number;
  shadow?: 'open' | 'closed';
}

/** What the worker answers for a skeleton on the heuristic path. */
function realReply(
  skeleton: Skeleton,
  o: RealOpts,
):
  | Extract<FitViewOpenReply, { ok: true }>
  | { ok: false; why: 'not_representable' } {
  const spec = heuristicSpec(skeleton);
  const validated = validateSpec(spec, skeleton, {
    siteHost: location.hostname,
  });
  if (!validated) return { ok: false, why: 'not_representable' };
  return {
    ok: true,
    envelope: {
      source: 'heuristic',
      extractionId: skeleton.extractionId,
      validated,
      createdAt: Date.now(),
    },
    layout: o.layout
      ? makeLayout(o.layout)
      : solveFitLayout(defaultFitProfile()),
    zoom: o.zoom ?? 1,
    site: { label: location.hostname, secure: location.protocol === 'https:' },
    plannerPending: false,
  };
}

/** The real live layer, with every bind recorded. */
const recordingLive: CreateLive = (surface, input) => {
  const live = createLive(surface, input);
  const bind = live.proxies.bind.bind(live.proxies);
  // Patched on the instance: the runtime still sees the live layer's own
  // methods (showOnPage).
  live.proxies.bind = (control, target) => {
    boundEls.add(control);
    bound.push(target);
    bind(control, target);
  };
  if (real) real.live = live;
  return live;
};

async function openReal(o: RealOpts = {}): Promise<{
  sections: string[];
  collections: number;
  repairs: number;
}> {
  // As engine.js and keybridge.js install them at document_start.
  installFirewall(window);
  installKeyBridge(window);
  if (runtime?.isOpen()) runtime.close('original');
  real = { opts: o, live: null };
  boundEls = new WeakSet();
  const r = await readSkeleton(document);
  if (!r) throw new Error('the page cannot be read');
  const reply = realReply(r.skeleton, o);
  if (!reply.ok) throw new Error('no representable spec for this page');
  runtime = createFitViewRuntime({
    shadowMode: o.shadow ?? 'closed',
    createLive: recordingLive,
  });
  lastOpts = null;
  await runtime.open({
    reply,
    skeleton: r.skeleton,
    registry: r.registry,
    engine,
    reason: 'popup',
  });
  const v = reply.envelope.validated;
  return {
    sections: v.spec.sections.map((s) => `${s.kind}:${s.importance}`),
    collections: v.spec.collections.length,
    repairs: v.repairs.length,
  };
}

/** What a person can operate inside the view. */
const OPERABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"]';

/**
 * WebAble's own controls: its strip and disclosures (fern), the skip link,
 * and "Use this on the page" and its quiet line ("3 videos · Watch on the
 * page"): they show the original; they drive nothing.
 */
function ownControl(el: Element): boolean {
  return (
    el.classList.contains('fv-wa') ||
    el.classList.contains('fv-skip') ||
    el.closest('.fv-onpage, .fv-quiet') !== null
  );
}

/** Operable view controls that drive nothing on the page (should be none). */
function unboundControls(): string[] {
  const out: string[] = [];
  for (const el of Array.from(root().querySelectorAll<HTMLElement>(OPERABLE))) {
    if (ownControl(el) || boundEls.has(el)) continue;
    // A checkbox or radio inside a bound whole-row toggle acts through it.
    const row = el.closest('label');
    if (row && boundEls.has(row as HTMLElement)) continue;
    out.push(
      `<${el.localName} class="${el.className}"> ${clean(el.textContent).slice(0, 40)}`,
    );
  }
  return out;
}

const fakeLive: CreateLive = () => ({
  proxies: {
    bind(_control, target) {
      bound.push(target);
    },
    actions: () => 0,
    dispose: () => undefined,
  },
  rebind: () => undefined,
  setZoom: () => undefined,
  dispose: () => undefined,
});

let runtime: (FitViewRuntime & FitViewInspect) | null = null;
let lastOpts: OpenOpts | null = null;

function replyFor(
  r: Reading,
  o: OpenOpts,
): Extract<FitViewOpenReply, { ok: true }> {
  return {
    ok: true,
    envelope: specFor(r, o),
    layout: makeLayout(o.layout),
    zoom: o.zoom ?? 1,
    site: { label: o.label ?? '127.0.0.1', secure: o.secure ?? false },
    plannerPending: false,
    font: o.font,
    ...(o.alwaysHere !== undefined ? { alwaysHere: o.alwaysHere } : {}),
    ...(o.intro ? { intro: true } : {}),
  };
}

async function open(o: OpenOpts): Promise<void> {
  if (runtime?.isOpen()) runtime.close('original');
  real = null;
  runtime = createFitViewRuntime({
    shadowMode: o.shadow ?? 'closed',
    createLive: o.live === false ? undefined : fakeLive,
  });
  lastOpts = o;
  current = read();
  const input: FitViewOpenInput = {
    reply: replyFor(current, o),
    skeleton: current.skeleton,
    registry: current.registry,
    engine,
    reason: 'popup',
  };
  await runtime.open(input);
}

function root(): ShadowRoot {
  const s = runtime?.surface();
  if (!s) throw new Error('Fit view is not open');
  return s.root;
}

const api = {
  read: () => {
    current = read();
    return { nodes: current.skeleton.nodes.length };
  },
  open,
  openReal,
  /** openReal(): operable controls in the view that are not bound to an original. */
  unbound: unboundControls,
  /** openReal(): proxied actions the live layer has taken. */
  actions: () => real?.live?.proxies.actions() ?? 0,
  close: (reason: 'original' | 'route' = 'original') => runtime?.close(reason),
  isOpen: () => runtime?.isOpen() ?? false,
  root,
  q: (sel: string): Element[] => Array.from(root().querySelectorAll(sel)),
  texts: (sel: string): string[] =>
    Array.from(root().querySelectorAll(sel)).map((e) => clean(e.textContent)),
  /** Centre of the first match in viewport coordinates (for page.mouse). */
  center: (sel: string, index = 0): { x: number; y: number } | null => {
    const el = root().querySelectorAll(sel)[index];
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  },
  /** Centre of the first match whose text is `text` (for page.mouse). */
  centerText: (sel: string, text: string): { x: number; y: number } | null => {
    const el = Array.from(root().querySelectorAll(sel)).find(
      (e) => clean(e.textContent) === text,
    );
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  },
  state: () => ({
    open: runtime?.isOpen() ?? false,
    bound: runtime?.bound() ?? 0,
    health: runtime?.health() ?? null,
    conservation: runtime?.conservation() ?? null,
    layout: runtime?.layout() ?? null,
    events: [...events],
    messages: messages.map((m) => m.type),
    frozen: [...frozen],
    targets: bound.length,
  }),
  targets: () => [...bound],
  resetLog: () => {
    events.length = 0;
    messages.length = 0;
    frozen.length = 0;
    bound.length = 0;
  },
  setZoom: (z: number) => runtime?.setZoom(z),
  offer: (source: 'planner' | 'heuristic' = 'planner') => {
    if (!current || !lastOpts) return;
    const env = specFor(current, { ...lastOpts, source });
    // The switch re-reads the page: the worker answers for that extraction.
    nextReply = null;
    runtime?.offerSpec(env);
    return env.createdAt;
  },
  /** The next cs:fitview-request reply: the last open options as a planner spec for a fresh read. */
  armSwitch: () => {
    if (!lastOpts) return;
    const o = lastOpts;
    const orig = engine.skeleton.bind(engine);
    engine.skeleton = async () => {
      const s = await orig();
      if (s && current)
        nextReply = {
          ...replyFor(current, o),
          envelope: specFor(current, { ...o, source: 'planner' }),
        };
      engine.skeleton = orig;
      return s;
    };
  },
  surface: () => runtime?.surface() ?? null,
  /** What a node id is, for failure messages. */
  node: (id: string) => {
    const el = current?.elOf.get(id);
    const n = current?.skeleton.nodes.find((x) => x.id === id);
    return el && n
      ? `${n.kind} <${el.localName} class="${el.getAttribute('class') ?? ''}"> ${clean(el.textContent).slice(0, 60)}`
      : null;
  },
  makeLayout,
  /** The docs/11 scorecard of the page itself, or of the open view. */
  measure: (
    which: 'page' | 'view',
    F?: number,
    T?: number,
    explain?: boolean,
  ) =>
    measureSurface(
      which === 'page' ? document : root(),
      { width: innerWidth, height: innerHeight },
      // Fit view's own strip controls are counted apart (docs/11 §4).
      { F, T, explain, own: which === 'view' ? '.fv-wa-controls' : undefined },
    ),
  templateMismatches,
  idOf: (sel: string) => (current ? idFor(current, sel) : null),
  /** A ProxyTarget for a page element, for driving surface.status / sheet. */
  targetFor: (sel: string): ProxyTarget | null => {
    if (!current) return null;
    const id = idFor(current, sel);
    return {
      role: 'button',
      id,
      locator: current.registry.locator(id),
      scopeId: null,
    };
  },
};

declare global {
  interface Window {
    __fv: typeof api;
  }
}
window.__fv = api;
