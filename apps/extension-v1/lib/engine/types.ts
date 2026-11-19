import type {
  PageSignals,
  RegionEvidence,
  RegionRole,
  Zone,
} from '@webable/core/page/types';

import type { PageEvidence } from '../protocol';
import type { RuleHit } from './extract/rules';
import type { MainFoundBy } from './extract/main';
import type { RGBA } from './util/color';
import type { Box } from './util/geometry';
import type { TreeScope } from './util/dom';

/**
 * Local measurement cache kept by the engine between extraction and apply.
 * Holds element references and exact numbers; it never leaves the tab.
 */

export interface TextFact {
  el: Element;
  chars: number;
  fontPx: number;
  /** null when line-height is `normal`. */
  lineHeightPx: number | null;
  weight: number;
  family: string;
  inMain: boolean;
  icon: boolean;
}

export interface TargetFact {
  id: number;
  el: Element;
  /** Document coordinates at measure time. */
  box: Box;
  inline: boolean;
  minSide: number;
}

export interface PinnedFact {
  el: Element;
  position: 'fixed' | 'sticky';
  /** Viewport coordinates at measure time. */
  box: Box;
}

export interface ContrastSample {
  el: Element;
  ratio: number;
  fg: RGBA;
  bg: RGBA;
  inViewport: boolean;
}

export interface RegionFact {
  key: string;
  el: Element;
  /** Document coordinates. */
  box: Box;
  zone: Zone;
  areaPct: number;
  pinned: 'fixed' | 'sticky' | 'no';
  landmark: RegionEvidence['landmark'];
  rule: RuleHit | null;
  hasRequiredFields: boolean;
  containsFocus: boolean;
  containsMain: boolean;
  motion: RegionEvidence['motion'];
  iframeKind: RegionEvidence['iframe_kind'];
}

export interface PageFacts {
  doc: Document;
  scopes: TreeScope[];
  main: Element | null;
  mainFoundBy: MainFoundBy;
  mainCandidates: Element[];
  text: TextFact[];
  targets: TargetFact[];
  pinned: PinnedFact[];
  /** Component key -> region records (a key can match several elements). */
  regions: Map<string, RegionFact[]>;
  hoverMenus: Element[];
  carousels: Element[];
  videos: HTMLVideoElement[];
  gifs: HTMLImageElement[];
  contrast: ContrastSample[];
  measuredAt: number;
}

export interface ExtractPerf {
  /** Main-thread busy time of the whole extraction, ms. */
  busyMs: number;
  /** Wall-clock time including yields, ms. */
  wallMs: number;
  nodes: number;
  truncated: boolean;
  /** Busy time per phase (walk, main, text, contrast, targets, ...), ms. */
  phases: Record<string, number>;
}

export interface Extraction {
  signals: PageSignals;
  evidence: PageEvidence;
  facts: PageFacts;
  perf: ExtractPerf;
}

export interface VocabPort {
  /** Keep only vocabulary words; runs of dropped tokens become one '·'. */
  vocabFilter(text: string, max?: number): string[];
}

export type { RegionRole };
