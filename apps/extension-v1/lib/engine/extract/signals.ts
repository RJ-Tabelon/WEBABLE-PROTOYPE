import type { PageSignal } from '@webable/core/page/types';

import { PAGE_SIGNALS } from '../contract';

/**
 * Structural page signals (the fixed PAGE_SIGNALS list). Metadata such as
 * JSON-LD and og:type is parsed locally; only the derived flag is kept.
 */

export interface SignalInput {
  doc: Document;
  main: Element | null;
  readerable: boolean;
  hasPassword: boolean;
  hasPayment: boolean;
  repeatedCardsInMain: number;
  viewportArea: number;
  visible: (el: Element) => boolean;
}

function jsonLdTypes(doc: Document): Set<string> {
  const types = new Set<string>();
  const visit = (node: unknown, depth: number): void => {
    if (depth > 6 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node.slice(0, 50)) visit(n, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    const t = obj['@type'];
    for (const v of Array.isArray(t) ? t : [t])
      if (typeof v === 'string') types.add(v.toLowerCase());
    if (obj['@graph']) visit(obj['@graph'], depth + 1);
    if (obj['mainEntity']) visit(obj['mainEntity'], depth + 1);
  };
  let n = 0;
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    if (++n > 10) break;
    const text = s.textContent ?? '';
    if (text.length > 200_000) continue;
    try {
      visit(JSON.parse(text), 0);
    } catch {
      // Malformed JSON-LD is common; ignore it.
    }
  }
  return types;
}

const ARTICLE_TYPES = [
  'article',
  'newsarticle',
  'blogposting',
  'report',
  'scholarlyarticle',
  'techarticle',
];

export function computeSignals(input: SignalInput): Set<PageSignal> {
  const { doc, main } = input;
  const out = new Set<PageSignal>();
  const ld = jsonLdTypes(doc);
  if (ARTICLE_TYPES.some((t) => ld.has(t))) out.add('jsonld_article');
  if (ld.has('product')) out.add('jsonld_product');
  if (ld.has('videoobject')) out.add('jsonld_video');
  const og = (
    doc.querySelector('meta[property="og:type"]')?.getAttribute('content') ?? ''
  ).toLowerCase();
  if (og === 'article') out.add('og_type_article');
  if (og.startsWith('video')) out.add('og_type_video');
  if (input.readerable) out.add('readerable');
  if (doc.querySelector('[role="feed"]')) out.add('role_feed');
  if (
    doc.querySelector(
      '[data-infinite-scroll], .infinite-scroll, [class*="infinite-scroll"], [class*="InfiniteScroll"]',
    )
  ) {
    out.add('infinite_scroll');
  }
  const search = doc.querySelector(
    'input[type="search"], [role="search"], search, form[action*="search" i], input[name="q"], input[name="query"]',
  );
  if (search) out.add('has_site_search');
  if (search && input.repeatedCardsInMain >= 5 && !input.readerable)
    out.add('search_results_pattern');
  if (input.hasPassword) out.add('has_password_field');
  if (input.hasPayment) out.add('has_payment_fields');
  if (
    doc.querySelector(
      '[aria-current="step"], form [role="progressbar"], form progress, [class*="stepper" i], [class*="checkout-step" i]',
    )
  ) {
    out.add('multi_step_form');
  }
  if (
    doc.querySelector('#comments, .comments, #disqus_thread, [id*="comment" i]')
  )
    out.add('has_comments_section');
  if (main) {
    for (const v of main.querySelectorAll('video, iframe')) {
      const r = v.getBoundingClientRect();
      if (r.width * r.height >= 0.25 * input.viewportArea && input.visible(v)) {
        if (
          v.localName === 'video' ||
          /youtube|vimeo|player|video/i.test(v.getAttribute('src') ?? '')
        ) {
          out.add('large_video_in_main');
          break;
        }
      }
    }
  }
  if (
    doc.querySelector(
      '.leaflet-container, .mapboxgl-map, .mapboxgl-canvas, .gm-style, iframe[src*="/maps"]',
    )
  ) {
    out.add('map_container');
  }
  if (
    doc.querySelector(
      '.ProseMirror, .ql-editor, .DraftEditor-root, .cke_editable, .tox-edit-area, [contenteditable="true"][role="textbox"], [contenteditable=""][role="textbox"]',
    )
  ) {
    out.add('rich_text_editor');
  }
  if (
    doc.querySelector(
      '[role="grid"], [role="treegrid"], .ag-root, .ag-grid, .slick-grid, [class*="data-grid" i]',
    )
  ) {
    out.add('data_grid');
  }
  let code = 0;
  for (const p of doc.querySelectorAll('pre, pre code')) {
    if ((p.textContent ?? '').length >= 40 && p.localName === 'pre') code++;
    if (code >= 2) {
      out.add('code_blocks');
      break;
    }
  }
  let tables = 0;
  for (const t of doc.querySelectorAll('table')) {
    if (t.querySelectorAll('tr').length >= 3 && input.visible(t)) tables++;
    if (tables >= 3) {
      out.add('many_tables');
      break;
    }
  }
  return out;
}

/** Signals in the canonical PAGE_SIGNALS order (the serializer never reorders). */
export function orderedSignals(set: ReadonlySet<PageSignal>): PageSignal[] {
  return PAGE_SIGNALS.filter((s) => set.has(s));
}
