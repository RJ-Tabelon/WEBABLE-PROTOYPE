import type { RegionEvidence, Zone } from '@webable/core/page/types';

import type { PinnedFact, RegionFact } from '../types';
import { boxOf, type Box } from '../util/geometry';
import {
  HOST_TAG,
  iframeHost,
  isOurs,
  isRendered,
  LANDMARK_SELECTOR,
  landmarkOf,
} from '../util/dom';
import { componentKey, sanitizedTokens } from '../util/hash';
import { normText } from './main';
import type { MotionInventory } from './motion';
import {
  iframeKindOfHost,
  knownRoots,
  ruleFor,
  type KnownRoots,
} from './rules';

/**
 * Region segmentation (engine.md 2.11-2.12): landmarks, known third-party
 * roots, pinned layers, the blocks beside the main-content path, and headed
 * recommendation sections. Each region gets a zone, a rule verdict when a
 * high-precision rule fires, and a stable structural component key.
 */

export interface SegmentInput {
  doc: Document;
  main: Element | null;
  mainCandidates: readonly Element[];
  pinned: readonly PinnedFact[];
  motion: MotionInventory;
  maxRegions?: number;
}

const RECS_HEADING_RE =
  /recommended|you may also like|related|more from|trending|popular|most read/i;

/** Tag path from the nearest landmark (or body) down to `el`, at most 6 steps. */
export function tagPath(el: Element): string {
  const parts: string[] = [];
  let n: Element | null = el;
  while (n && parts.length < 6) {
    parts.unshift(n.localName);
    if (n.localName === 'body' || (n !== el && landmarkOf(n) !== 'none')) break;
    const parent: Element | null =
      n.parentElement ??
      (n.getRootNode() instanceof ShadowRoot
        ? (n.getRootNode() as ShadowRoot).host
        : null);
    n = parent;
  }
  return parts.join('>');
}

export function keyFor(el: Element): string {
  return componentKey({
    landmark: landmarkOf(el),
    tagPath: tagPath(el),
    tokens: sanitizedTokens(
      typeof el.className === 'string' ? el.className : '',
      el.id,
    ),
  });
}

/** Zone from document geometry and pinning (ai-architecture.md 3.2.2). */
export function zoneOf(
  box: Box,
  viewportBox: Box,
  pinned: 'fixed' | 'sticky' | 'no',
  vw: number,
  vh: number,
  docH: number,
): Zone {
  const w = box.right - box.left;
  const h = box.bottom - box.top;
  const cx = (box.left + box.right) / 2;
  if (pinned === 'fixed') {
    const vTop = viewportBox.top;
    const vBottom = viewportBox.bottom;
    if (w >= 0.5 * vw) {
      if (vTop <= 0.1 * vh && h < 0.6 * vh) return 'overlay_top';
      if (vBottom >= 0.9 * vh && h < 0.6 * vh) return 'overlay_bottom';
      return 'overlay_center';
    }
    const nearSide =
      viewportBox.left <= 0.15 * vw || viewportBox.right >= 0.85 * vw;
    const nearEdge = vTop <= 0.2 * vh || vBottom >= 0.8 * vh;
    return nearSide && nearEdge ? 'overlay_corner' : 'overlay_center';
  }
  if (box.top <= Math.max(0.1 * vh, 8) && w >= 0.6 * vw && h < 0.5 * vh)
    return 'header_band';
  if (box.bottom >= docH - Math.max(0.1 * vh, 8) && w >= 0.6 * vw && h < vh)
    return 'footer_band';
  if (w < 0.35 * vw && cx < 0.35 * vw) return 'left_rail';
  if (w < 0.35 * vw && cx > 0.65 * vw) return 'right_rail';
  if (w < 0.75 * vw) return 'center_column';
  return 'full_width_mid';
}

function iframeKindWithin(
  el: Element,
  base: string,
): RegionEvidence['iframe_kind'] {
  const frame = el.localName === 'iframe' ? el : el.querySelector('iframe');
  if (!frame) return 'none';
  const host = iframeHost(frame, base);
  let path = '';
  try {
    path = new URL(frame.getAttribute('src') ?? '', base).pathname;
  } catch {
    path = '';
  }
  return iframeKindOfHost(host, path);
}

function motionWithin(
  el: Element,
  m: MotionInventory,
): RegionEvidence['motion'] {
  const within = (list: readonly Element[]): boolean =>
    list.some((t) => el === t || el.contains(t));
  if (within(m.carouselEls)) return 'carousel';
  if (within(m.videos)) return 'autoplay_video';
  if (within(m.loopTargets)) return 'loop';
  if (within(m.animatedTargets)) return 'transition';
  return 'none';
}

function firstShortText(el: Element): string {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let steps = 0;
  for (
    let n = walker.nextNode();
    n && steps < 12;
    n = walker.nextNode(), steps++
  ) {
    const t = (n.nodeValue ?? '').trim();
    if (t) return t.length <= 24 ? t : '';
  }
  return '';
}

function headingOf(el: Element): string {
  const h = el.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
  return h ? normText(h).slice(0, 120) : '';
}

/** Collect region roots; order encodes priority for the cap. */
function candidates(input: SegmentInput, known: KnownRoots): Element[] {
  const { doc, main } = input;
  const out: Element[] = [];
  const seen = new Set<Element>();
  const add = (el: Element | null | undefined): void => {
    if (
      !el ||
      seen.has(el) ||
      isOurs(el) ||
      el === doc.body ||
      el === doc.documentElement
    )
      return;
    seen.add(el);
    out.push(el);
  };
  // 1. Known third-party roots (decided by rules), from the one sweep the
  //    rules read too (each selector list costs ~1-2 ms on a large page).
  for (const list of [known.cmp, known.chat, known.recs])
    for (const [el] of list) add(el);
  for (const [el] of known.ad) {
    // Mark the slot container, not the inner <ins>/<div> that has no box yet.
    const block =
      el.closest('aside, section, figure, [class*="ad" i], [id*="ad" i]') ?? el;
    add(block === doc.body ? el : block);
  }
  for (const f of doc.querySelectorAll('iframe')) add(f);
  // 2. Pinned layers.
  for (const p of input.pinned) add(p.el);
  // 3. Main content and its rivals.
  add(main);
  for (const c of input.mainCandidates) add(c);
  // 4. Landmarks.
  for (const el of doc.querySelectorAll(LANDMARK_SELECTOR)) add(el);
  // 5. Headed recommendation sections.
  let headings = 0;
  for (const h of doc.querySelectorAll('h2, h3, h4')) {
    if (++headings > 80) break;
    if (!RECS_HEADING_RE.test(h.textContent ?? '')) continue;
    add(h.closest('section, aside, div, ul') as Element | null);
  }
  // 6. Blocks beside the main-content path (siblings of main's ancestors).
  if (main) {
    for (
      let a: Element | null = main;
      a && a !== doc.body;
      a = a.parentElement
    ) {
      const parent: Element | null = a.parentElement;
      if (!parent) break;
      for (const sib of Array.from(parent.children) as Element[])
        if (sib !== a) add(sib);
    }
  } else if (doc.body) {
    for (const child of doc.body.children) {
      add(child);
      for (const grand of child.children) add(grand);
    }
  }
  return out;
}

export function segmentRegions(input: SegmentInput): RegionFact[] {
  const { doc, main } = input;
  const view = doc.defaultView;
  if (!view) return [];
  const vw = view.innerWidth;
  const vh = view.innerHeight;
  const vpArea = Math.max(1, vw * vh);
  const sx = view.scrollX;
  const sy = view.scrollY;
  const docH = Math.max(doc.documentElement.scrollHeight, vh);
  const active =
    doc.activeElement && doc.activeElement !== doc.body
      ? doc.activeElement
      : null;
  const pinnedOf = new Map(
    input.pinned.map((p) => [p.el, p.position] as const),
  );
  const known = knownRoots(doc);
  const facts: RegionFact[] = [];

  for (const el of candidates(input, known)) {
    if (
      el.localName === HOST_TAG ||
      el.localName === 'script' ||
      el.localName === 'style'
    )
      continue;
    if (!isRendered(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 16 || r.height < 16) continue;
    let pinned: 'fixed' | 'sticky' | 'no' = pinnedOf.get(el) ?? 'no';
    if (pinned === 'no') {
      const pos = view.getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') pinned = pos;
    }
    const landmark = landmarkOf(el);
    const iframeKind = iframeKindWithin(el, doc.baseURI);
    const hasRequiredFields =
      el.querySelector('[required], [aria-required="true"]') !== null;
    // Local text is read only where a rule needs it (pinned layers), never sent.
    const buttons =
      pinned === 'no'
        ? []
        : [...el.querySelectorAll('button, [role="button"], a[href]')].slice(
            0,
            6,
          );
    const rule = ruleFor(
      el,
      {
        width: r.width,
        height: r.height,
        pinned,
        iframeKind,
        landmark,
        labelText: headingOf(el) || firstShortText(el),
        shortText:
          pinned === 'no'
            ? ''
            : (el.textContent ?? '')
                .slice(0, 2000)
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 400),
        buttonTexts: buttons.map((b) => normText(b).slice(0, 40)),
        hasRequiredFields,
      },
      known,
    );
    const areaPct = ((r.width * r.height) / vpArea) * 100;
    // Unremarkable small blocks are not regions.
    if (!rule && pinned === 'no' && areaPct < 0.5 && el !== main) continue;
    const vBox = boxOf(r);
    const box: Box = {
      left: r.left + sx,
      top: r.top + sy,
      right: r.right + sx,
      bottom: r.bottom + sy,
    };
    facts.push({
      key: keyFor(el),
      el,
      box,
      zone: zoneOf(box, vBox, pinned, vw, vh, docH),
      areaPct: Math.round(areaPct * 10) / 10,
      pinned,
      landmark,
      rule,
      hasRequiredFields,
      containsFocus: active !== null && el.contains(active),
      containsMain: main !== null && el !== main && el.contains(main),
      motion: motionWithin(el, input.motion),
      iframeKind,
    });
    if (facts.length >= (input.maxRegions ?? 24)) break;
  }
  return facts;
}
