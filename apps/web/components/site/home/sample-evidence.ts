import type { RegionEvidence } from '@webable/core/page/types';

/**
 * What page analysis would send about one area of the sample page: its side column
 * ("Most read"). It follows the real contract (`regionEvidenceSchema`), and every
 * word comes from the public vocabulary; a unit test checks both. It is shown on
 * the home page and the privacy page exactly as it would travel.
 */
export const SAMPLE_REGION_EVIDENCE: RegionEvidence = {
  zone: 'right_rail',
  width: '15-30%',
  height: '1-3 screens',
  pinned: 'no',
  landmark: 'complementary',
  tag: 'aside',
  dom_position: 'after_main',
  links: '4-10',
  link_density: 'high',
  text_amount: '100-500 chars',
  buttons: '1',
  inputs: '1',
  required_fields: false,
  repeated_cards: '0',
  images: '0',
  video: false,
  iframe_kind: 'none',
  motion: 'none',
  class_words: ['sidebar', 'popular'],
  heading_words: 'most read',
  control_words: ['sign up'],
};

/** One line per field, `key: value`, as a reader-friendly rendering of the JSON. */
export function payloadLines(
  evidence: RegionEvidence,
): Array<{ key: string; value: string }> {
  return Object.entries(evidence).map(([key, value]) => ({
    key,
    value: JSON.stringify(value).replace(/,/g, ', '),
  }));
}
