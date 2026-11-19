import type { PageContext, RegionEvidence } from '@webable/core/page/types';

import { countToBucket, isPageContext, isRegionEvidence } from '../contract';

import type { RegionFact, VocabPort } from '../types';
import {
  heightBucket,
  linkDensityBucket,
  regionTextBucket,
  repeatedCardsBucket,
  widthBucket,
} from '../util/buckets';
import { tagBucket } from '../util/dom';
import { sanitizedTokens } from '../util/hash';
import { linkDensity, normText } from './main';

/**
 * Page-analysis evidence: the only structure that can leave the device
 * (ai-architecture.md 3.2). Every string is either an enum value or a word
 * that passed vocabFilter() from @webable/core; everything is validated with
 * the page contract (lib/engine/contract.ts, kept identical to the core zod
 * schemas) before it is returned. Nothing here reads form values.
 */

const VOCAB_WORD = /^[a-z]{2,20}$/;

/** vocabFilter that fails closed: any error yields no words. */
export function safeVocab(
  port: VocabPort,
  text: string,
  max: number,
): string[] {
  if (!text.trim()) return [];
  let raw: unknown;
  try {
    raw = port.vocabFilter(text, max);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  // Defence in depth: re-check the shape of every entry and the word cap.
  const out: string[] = [];
  let words = 0;
  for (const w of raw) {
    if (w === '·') {
      if (out[out.length - 1] !== '·' && words < max) out.push(w);
    } else if (typeof w === 'string' && VOCAB_WORD.test(w)) {
      if (words >= max) break;
      out.push(w);
      words++;
    }
  }
  return out;
}

/** Words joined by spaces, with a leading/trailing-only '·' run trimmed to one. */
export function vocabPhrase(
  port: VocabPort,
  text: string,
  max: number,
  maxLen = 140,
): string {
  const words = safeVocab(port, text, max);
  if (!words.some((w) => w !== '·')) return '';
  let s = words.join(' ');
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/\s+\S*$/, '');
  return s;
}

const CONTROL_SELECTOR =
  'a[href], button, [role="button"], [role="link"], input[type="submit"], input[type="button"], input[type="reset"], summary';
const INPUT_SELECTOR =
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea, [contenteditable="true"]';
const BUTTON_SELECTOR =
  'button, [role="button"], input[type="submit"], input[type="button"], input[type="reset"]';

function labelledByText(el: Element): string {
  const ids = el.getAttribute('aria-labelledby');
  if (!ids) return '';
  const doc = el.ownerDocument;
  return ids
    .split(/\s+/)
    .map((id) => doc.getElementById(id)?.textContent ?? '')
    .join(' ');
}

/**
 * Approximate accessible name of a control, read locally. Uses attributes and
 * text only; the `value` of a text field is never read (only the static
 * `value` attribute of submit/button/reset, which is the button's label).
 */
export function controlName(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  const lb = labelledByText(el);
  if (lb.trim()) return lb;
  if (el.localName === 'input') {
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'reset')
      return el.getAttribute('value') ?? type;
    return '';
  }
  const text = normText(el);
  if (text) return text.slice(0, 80);
  const img = el.querySelector('img[alt]');
  if (img) return img.getAttribute('alt') ?? '';
  return el.getAttribute('title') ?? '';
}

function headingText(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  const lb = labelledByText(el);
  if (lb.trim()) return lb;
  const h = el.querySelector(
    'h1, h2, h3, h4, h5, h6, [role="heading"], legend, caption',
  );
  return h ? normText(h).slice(0, 120) : '';
}

/** Largest group of >= 2 sibling elements sharing tag and class signature that hold a link or image. */
export function repeatedCards(root: Element, cap = 400): number {
  let best = 0;
  let visited = 0;
  const stack: Element[] = [root];
  while (stack.length && visited < cap) {
    const el = stack.pop() as Element;
    visited++;
    const kids = el.children;
    if (kids.length >= 2) {
      const groups = new Map<string, number>();
      for (const k of kids) {
        if (!k.querySelector('a[href], img') && !k.matches('a[href]')) continue;
        const sig = `${k.localName}|${sanitizedTokens(typeof k.className === 'string' ? k.className : '', '').join('.')}`;
        groups.set(sig, (groups.get(sig) ?? 0) + 1);
      }
      for (const n of groups.values()) best = Math.max(best, n);
    }
    for (let i = kids.length - 1; i >= 0; i--) {
      const k = kids[i];
      if (k) stack.push(k);
    }
  }
  return best;
}

function domPosition(
  el: Element,
  main: Element | null,
): RegionEvidence['dom_position'] {
  if (!main || el === main || el.contains(main)) return 'unknown';
  if (main.contains(el)) return 'inside_main';
  const pos = el.compareDocumentPosition(main);
  if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return 'before_main';
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 'after_main';
  return 'unknown';
}

export interface EvidenceContext {
  vocab: VocabPort;
  main: Element | null;
  viewportW: number;
  viewportH: number;
}

/** Build and validate one region's evidence. Returns null if it fails validation. */
export function regionEvidence(
  fact: RegionFact,
  ctx: EvidenceContext,
): RegionEvidence | null {
  const el = fact.el;
  const w = fact.box.right - fact.box.left;
  const h = fact.box.bottom - fact.box.top;
  const first = el.firstElementChild;
  const classSource = [
    typeof el.className === 'string' ? el.className : '',
    el.id,
    first && typeof first.className === 'string' ? first.className : '',
    first?.id ?? '',
  ].join(' ');
  const classWords = safeVocab(ctx.vocab, classSource, 12)
    .filter((word) => word !== '·')
    .filter((word, i, all) => all.indexOf(word) === i)
    .slice(0, 6);
  const controls = [...el.querySelectorAll(CONTROL_SELECTOR)].slice(0, 4);
  // The region's text once: its amount and its link share (eval M9).
  const chars = normText(el).length;
  const controlWords = controls
    .map((c) => vocabPhrase(ctx.vocab, controlName(c), 4, 100))
    .filter((s) => s.length > 0)
    .slice(0, 4);
  const hasVideo =
    el.localName === 'video' ||
    el.querySelector('video') !== null ||
    fact.iframeKind === 'video_host';

  const ev: RegionEvidence = {
    zone: fact.zone,
    width: widthBucket((w / Math.max(1, ctx.viewportW)) * 100),
    height: heightBucket(h / Math.max(1, ctx.viewportH)),
    pinned: fact.pinned,
    landmark: fact.landmark,
    tag: tagBucket(el),
    dom_position: domPosition(el, ctx.main),
    links: countToBucket(
      el.querySelectorAll('a[href]').length + (el.matches('a[href]') ? 1 : 0),
    ),
    link_density: linkDensityBucket(linkDensity(el, chars, 0.6)),
    text_amount: regionTextBucket(chars),
    buttons: countToBucket(el.querySelectorAll(BUTTON_SELECTOR).length),
    inputs: countToBucket(el.querySelectorAll(INPUT_SELECTOR).length),
    required_fields: fact.hasRequiredFields,
    repeated_cards: repeatedCardsBucket(repeatedCards(el)),
    images: countToBucket(
      el.querySelectorAll('img').length + (el.localName === 'img' ? 1 : 0),
    ),
    video: hasVideo,
    iframe_kind: fact.iframeKind,
    motion: fact.motion,
    class_words: classWords,
    heading_words: vocabPhrase(ctx.vocab, headingText(el), 6),
    control_words: controlWords,
  };
  return isRegionEvidence(ev) ? ev : null;
}

export function validatePageContext(ctx: PageContext): PageContext | null {
  return isPageContext(ctx) ? ctx : null;
}
