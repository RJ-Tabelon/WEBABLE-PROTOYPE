// Round 4 package P: Jev attribution questions (zoom_reason, miss_reason, pause_reason). No network.
import { describe, expect, test } from 'vitest';
import type { AttributionQuestion } from '../../src/types';
import type { JevResponse } from '../../src/jev/api';
import { emptyJevMetrics } from '../../src/jev/api';
import {
  ATTRIBUTION_OPTIONS, attributionEvidence, attributionWeight, buildAttributionCall, fallbackMissWeight, fallbackZoomWeight,
  parseAttribution,
} from '../../src/jev/attribution';

const zoomQ: AttributionQuestion = {
  kind: 'zoom_reason',
  evidence: {
    centre_kind: 'paragraph text', zoom_to_pct: 150, zoom_from_pct: 100, page_kind: 'article', centre_text_px: 14,
    page_body_px: 14, centre_contrast: 3.9, image_share_pct: 8, url: 'https://example.com/secret', note: 'Call Jane Smith at 555-0100',
  },
};

function answer(kind: string, fwd: Record<string, number>, rev: Record<string, number>): JevResponse {
  const top = (p: Record<string, number>) => Object.entries(p).sort((a, b) => b[1] - a[1])[0]![0];
  return {
    model: 'jev-1.14.0',
    usage: { input_tokens: 900, output_tokens: 0 },
    answers: {
      [`${kind}_fwd`]: { type: 'choice', choice: top(fwd), probabilities: fwd, confidence: 0.9 },
      [`${kind}_rev`]: { type: 'choice', choice: top(rev), probabilities: rev, confidence: 0.9 },
    },
  };
}

describe('attribution questions', () => {
  test('one Choice in both option orders; evidence is known keys only, in a fixed order', () => {
    const call = buildAttributionCall(zoomQ);
    expect(Object.keys(call.questions)).toEqual(['zoom_reason_fwd', 'zoom_reason_rev']);
    const fwd = call.questions.zoom_reason_fwd!;
    const rev = call.questions.zoom_reason_rev!;
    expect(fwd.type).toBe('choice');
    if (fwd.type !== 'choice' || rev.type !== 'choice') throw new Error('choice expected');
    expect(Object.keys(fwd.criteria)).toEqual([...ATTRIBUTION_OPTIONS.zoom_reason]);
    expect(Object.keys(rev.criteria)).toEqual([...ATTRIBUTION_OPTIONS.zoom_reason].reverse());
    const ev = attributionEvidence(zoomQ);
    expect(Object.keys(ev)).toEqual(['page_kind', 'zoom_from_pct', 'zoom_to_pct', 'centre_kind', 'centre_text_px', 'page_body_px', 'centre_contrast', 'image_share_pct']);
    expect(JSON.stringify(call)).not.toMatch(/secret|example\.com|Jane|555/);
  });

  test('questions are about the page and what happened on it, never about the person', () => {
    for (const kind of ['zoom_reason', 'miss_reason', 'pause_reason'] as const) {
      const q: AttributionQuestion = { kind, evidence: { page_kind: 'form', misses: 3, clicks: 20, words_in_view: 40 } };
      const text = JSON.stringify(buildAttributionCall(q));
      expect(text).not.toMatch(/tremor|parkinson|disab|impair|vision|elderly|\bage\b|dyslex|adhd|diagnos|condition|health/i);
    }
  });

  test('the weight is P(text) averaged over both orders', () => {
    const resp = answer('zoom_reason', { text: 0.8, image: 0.1, layout: 0.05, other: 0.05 }, { other: 0.05, layout: 0.05, image: 0.2, text: 0.7 });
    const a = parseAttribution(resp, 'zoom_reason', emptyJevMetrics());
    expect(a.top).toBe('text');
    expect(a.probs.text).toBeCloseTo(0.75, 3);
    expect(a.agree).toBe(true);
    expect(attributionWeight(a, 0.5)).toBeCloseTo(0.75, 3);
  });

  test('when the two orders disagree the weight is held at 0.5 or less; a missing answer throws (callers fall back)', () => {
    const resp = answer('miss_reason', { slip: 0.9, site: 0.1 }, { site: 0.55, slip: 0.45 });
    const a = parseAttribution(resp, 'miss_reason', emptyJevMetrics());
    expect(a.agree).toBe(false);
    expect(attributionWeight(a, 0.9)).toBe(0.5);
    expect(() => parseAttribution({ model: 'x', usage: { input_tokens: 0, output_tokens: 0 }, answers: {} }, 'miss_reason', emptyJevMetrics())).toThrow();
    expect(attributionWeight(null, 0.62)).toBe(0.62);
  });

  test('code-only fallbacks: text in view counts, a picture hardly; misses after a layout shift count less', () => {
    expect(fallbackZoomWeight({ centre_kind: 'paragraph text', image_share_pct: 5 })).toBe(0.8);
    expect(fallbackZoomWeight({ centre_kind: 'image', image_share_pct: 70 })).toBe(0.15);
    expect(fallbackZoomWeight({ centre_kind: 'paragraph text', image_share_pct: 60 })).toBe(0.3);
    expect(fallbackMissWeight({ misses: 4, misses_after_layout_shift: 0, misses_on_small_targets: 0 })).toBe(0.85);
    expect(fallbackMissWeight({ misses: 4, misses_after_layout_shift: 4 })).toBeCloseTo(0.25, 3);
  });

  test('a news page with headlines beside pictures still reads as text when most centre points are text', () => {
    const headlines = { centre_kind: 'image', centre_text_points: 5, centre_media_points: 3, image_share_pct: 55 };
    expect(fallbackZoomWeight(headlines)).toBeGreaterThanOrEqual(0.7);
    const photo = { centre_kind: 'image', centre_text_points: 1, centre_media_points: 8, image_share_pct: 80 };
    expect(fallbackZoomWeight(photo)).toBeLessThanOrEqual(0.3);
    const call = buildAttributionCall({ kind: 'zoom_reason', evidence: { ...headlines, page_kind: 'news index' } });
    const fwd = call.questions.zoom_reason_fwd!;
    const ev = (fwd.instructions as Record<string, unknown>).zoom as Record<string, unknown>;
    expect(ev.centre_text_points).toBe(5);
    expect(ev.centre_media_points).toBe(3);
  });

  test('an unknown kind or empty evidence is refused', () => {
    expect(() => buildAttributionCall({ kind: 'zoom_reason', evidence: { secret: 'x' } })).toThrow();
    expect(() => buildAttributionCall({ kind: 'mood' as never, evidence: { page_kind: 'x' } })).toThrow();
  });
});
