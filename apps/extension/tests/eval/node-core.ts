/**
 * Real-site evaluation (scripts/eval): the core pieces the Node runner uses,
 * bundled by the runner with esbuild as one ESM module (platform node).
 *
 *   personas     defaultFitProfile + fitProfileSchema
 *   planner      the compose Edge Function's path, step for step: the
 *                request schema and vocabulary re-check, the outline the
 *                server writes, the request body, and the output checks
 *   benchmark    heuristic spec and validator on frozen skeletons
 *   page scale   the worker's zoom guard rules (lib/sw/zoom.ts)
 */
export { heuristicSpec } from '@webable/core/compose/heuristic';
export {
  PLANNER_INSTRUCTIONS,
  PLANNER_MAX_OUTPUT_TOKENS,
  plannerRequestBody,
} from '@webable/core/compose/prompt';
export {
  indexSkeleton,
  isRecordCollection,
  localMainContent,
  validateSpec,
} from '@webable/core/compose/validate';
export {
  composeRequestSchema,
  PAGE_SPEC_JSON_SCHEMA,
  pageSpecSchema,
} from '@webable/core/compose/wire';
export { PROTECTED_SECTION_KINDS } from '@webable/core/compose/constants';
export { solveFitLayout } from '@webable/core/fit/solver';
export { DROPPED_MARK, isVocabWord } from '@webable/core/page/vocab';
export { defaultFitProfile } from '@webable/core/profile/defaults';
export { fitProfileSchema } from '@webable/core/profile/schema';
export { outlineTokens, wireOutline } from '@webable/core/skeleton/outline';
export { toWireSkeleton, wireBytes } from '@webable/core/skeleton/to-wire';
export {
  COMPOSE_FALLBACK_MODEL,
  COMPOSE_PINNED_MODEL,
  COMPOSE_SCHEMA_VERSION,
  FIT_SOLVER_VERSION,
  SKELETON_VERSION,
  TRIAGE_VERSION,
} from '@webable/core/versions';
export { ZOOM_PRESETS } from '@webable/core/triage/triage';

export {
  GUARD_OVERFLOW_PX,
  guardVerdict,
  stepDown,
  zoomLevel,
} from '../../lib/sw/zoom';
