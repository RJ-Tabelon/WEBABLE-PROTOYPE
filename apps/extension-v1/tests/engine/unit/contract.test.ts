import * as core from '@webable/core/page/types';
import { describe, expect, it } from 'vitest';

import {
  countToBucket,
  ENUMS,
  isPageContext,
  isRegionEvidence,
  PAGE_CATEGORIES,
  PAGE_SIGNALS,
  PROTECTED_ROLES,
} from '../../../lib/engine/contract';

/**
 * The content script validates evidence without zod (bundle size). These tests
 * keep the zod-free mirror identical to the core schemas: enum lists compared
 * one by one, and both validators run over valid and mutated payloads.
 */

const shape = core.regionEvidenceSchema.shape;
const optionsOf = (s: unknown): readonly string[] =>
  (s as { options: readonly string[] }).options;

describe('contract mirror', () => {
  it('matches the core enum lists', () => {
    expect([...PAGE_CATEGORIES]).toEqual([...core.PAGE_CATEGORIES]);
    expect([...PAGE_SIGNALS]).toEqual([...core.PAGE_SIGNALS]);
    expect([...PROTECTED_ROLES]).toEqual([...core.PROTECTED_ROLES]);
    expect(ENUMS.zone).toEqual(optionsOf(shape.zone));
    expect(ENUMS.width).toEqual(optionsOf(shape.width));
    expect(ENUMS.height).toEqual(optionsOf(shape.height));
    expect(ENUMS.pinned).toEqual(optionsOf(shape.pinned));
    expect(ENUMS.landmark).toEqual(optionsOf(shape.landmark));
    expect(ENUMS.tag).toEqual(optionsOf(shape.tag));
    expect(ENUMS.dom_position).toEqual(optionsOf(shape.dom_position));
    expect(ENUMS.count).toEqual(optionsOf(shape.links));
    expect(ENUMS.link_density).toEqual(optionsOf(shape.link_density));
    expect(ENUMS.text_amount).toEqual(optionsOf(shape.text_amount));
    expect(ENUMS.repeated_cards).toEqual(optionsOf(shape.repeated_cards));
    expect(ENUMS.iframe_kind).toEqual(optionsOf(shape.iframe_kind));
    expect(ENUMS.motion).toEqual(optionsOf(shape.motion));
    const page = core.pageContextSchema.shape;
    expect(ENUMS.found_by).toEqual(optionsOf(page.main.shape.found_by));
    expect(ENUMS.page_text_amount).toEqual(
      optionsOf(page.counts.shape.text_amount),
    );
    expect(ENUMS.viewport).toEqual(optionsOf(page.layout.shape.viewport));
    expect(ENUMS.page_height).toEqual(optionsOf(page.layout.shape.page_height));
    expect(ENUMS.pinned_bars).toEqual(optionsOf(page.layout.shape.pinned_bars));
    for (const n of [0, 1, 2, 3, 4, 10, 11, 30, 31, 100, 101, 5000])
      expect(countToBucket(n)).toBe(core.countToBucket(n));
  });

  const region: core.RegionEvidence = {
    zone: 'right_rail',
    width: '15-30%',
    height: '1-3 screens',
    pinned: 'no',
    landmark: 'complementary',
    tag: 'aside',
    dom_position: 'after_main',
    links: '11-30',
    link_density: 'high',
    text_amount: '500-2k chars',
    buttons: '0',
    inputs: '0',
    required_fields: false,
    repeated_cards: '4-8',
    images: '4-10',
    video: false,
    iframe_kind: 'none',
    motion: 'none',
    class_words: ['sidebar', 'related'],
    heading_words: 'most popular',
    control_words: ['read more', '· notes'],
  };

  const page: core.PageContext = {
    signals: ['og_type_article', 'readerable'],
    main: { found_by: 'readability', zone: 'center_column', width: '30-60%' },
    counts: {
      regions: '4-10',
      links: '31-100',
      buttons: '4-10',
      text_inputs: '1',
      forms: '1',
      required_fields: '0',
      headings: '11-30',
      images: '4-10',
      videos: '0',
      text_amount: '10k-50k chars',
    },
    layout: {
      viewport: 'desktop',
      page_height: '3-10 screens',
      pinned_bars: '2',
    },
  };

  const regionMutations: Array<(r: Record<string, unknown>) => void> = [
    (r) => (r.zone = 'sidebar'),
    (r) => (r.extra = 1),
    (r) => delete r.motion,
    (r) => (r.class_words = ['Caden']),
    (r) =>
      (r.class_words = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x) => x + x)),
    (r) => (r.heading_words = 'Welcome back, Caden'),
    (r) => (r.heading_words = 'a '.repeat(80)),
    (r) => (r.control_words = ['ok', 'ok', 'ok', 'ok', 'ok']),
    (r) => (r.control_words = ['https://example.com']),
    (r) => (r.required_fields = 'no'),
    (r) => (r.links = 12),
    (r) => (r.iframe_kind = 'doubleclick.net'),
    (r) => (r.class_words = 'sidebar'),
  ];

  it('agrees with zod on valid and mutated region evidence', () => {
    expect(isRegionEvidence(region)).toBe(true);
    expect(core.regionEvidenceSchema.safeParse(region).success).toBe(true);
    for (const m of regionMutations) {
      const r = structuredClone(region) as unknown as Record<string, unknown>;
      m(r);
      expect(isRegionEvidence(r), JSON.stringify(r)).toBe(
        core.regionEvidenceSchema.safeParse(r).success,
      );
      expect(isRegionEvidence(r)).toBe(false);
    }
  });

  const pageMutations: Array<(p: Record<string, unknown>) => void> = [
    (p) => ((p.main as Record<string, unknown>).zone = 'unknown'),
    (p) => ((p.main as Record<string, unknown>).found_by = 'jev'),
    (p) => (p.signals = ['readerable', 'url_has_article']),
    (p) => ((p.counts as Record<string, unknown>).links = '100-300'),
    (p) => ((p.layout as Record<string, unknown>).pinned_bars = '4'),
    (p) => (p.title = 'Quillon'),
    (p) => delete (p.counts as Record<string, unknown>).videos,
  ];

  it('agrees with zod on valid and mutated page context', () => {
    expect(isPageContext(page)).toBe(true);
    for (const m of pageMutations) {
      const p = structuredClone(page) as unknown as Record<string, unknown>;
      m(p);
      expect(isPageContext(p), JSON.stringify(p)).toBe(
        core.pageContextSchema.safeParse(p).success,
      );
    }
  });
});
