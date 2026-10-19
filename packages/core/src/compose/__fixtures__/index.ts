import type { Skeleton } from '../../skeleton/types';
import { amazon } from './amazon';
import { govuk } from './govuk';
import { inbox } from './inbox';
import { meta } from './meta';
import { news } from './news';
import { wikipedia } from './wikipedia';
import { youtube } from './youtube';

export { buildSkeleton, textPatterns, type FxNode, type FxPage } from './build';
export { amazon, govuk, inbox, meta, news, wikipedia, youtube };

/**
 * Skeleton fixtures for the compose tests and evaluation: four real pages
 * converted from the v2 probe (YouTube, Amazon, Meta, Wikipedia) and three
 * hand-written ones (a webmail inbox, a GOV.UK-style guide, a news article
 * with ads). No personal data: labels are public page chrome, public titles
 * or invented.
 */
export const SKELETON_FIXTURES = {
  youtube,
  amazon,
  meta,
  wikipedia,
  inbox,
  govuk,
  news,
} as const satisfies Record<string, Skeleton>;

export type FixtureName = keyof typeof SKELETON_FIXTURES;

export const FIXTURE_NAMES = Object.keys(SKELETON_FIXTURES) as FixtureName[];
