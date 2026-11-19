// Server-side entry into @webable/core for the Supabase Edge Functions.
//
// Deno cannot load the workspace TypeScript sources directly (bare `zod`
// imports, extensionless relative paths), so scripts/build-functions.mjs bundles
// this file, the core modules it names and zod into `core.bundle.js`: plain ESM
// with no imports, runnable in Deno and Node alike (the local Jev mock server
// and the local dev planner use it too). Types come from the hand-maintained `core.bundle.d.ts`;
// `pnpm build:functions --check` fails when the committed bundle is stale or
// the declarations drift from these exports.
//
// Keep this surface small. Everything here ships in every function.

import { z } from 'zod';

import { plannerRequestBody } from '@webable/core/compose/prompt';
import {
  composeRequestSchema,
  composeResponseSchema,
  pageSpecSchema,
} from '@webable/core/compose/wire';
import {
  buildQuestions,
  MAX_REGIONS_PER_CALL,
  MAX_REQUEST_TOKENS,
  toDecideResponse,
  type BuiltQuestions,
} from '@webable/core/decide/catalog';
import {
  decideRequestSchema,
  decideResponseSchema,
  type DecideResponse,
} from '@webable/core/decide/wire';
import { createMockJevFetch, mockJevAnswer } from '@webable/core/decide/mock';
import {
  JEV_ENDPOINT,
  JEV_REQUEST_ID_HEADER,
  type JevResponse,
} from '@webable/core/jev/api';
import { callJev } from '@webable/core/jev/client';
import { OP_IDS } from '@webable/core/ops/catalog';
import { PAGE_CATEGORIES, REGION_ROLES } from '@webable/core/page/types';
import {
  DROPPED_MARK,
  isVocabPhrase,
  isVocabWord,
  unknownEvidenceWords,
  VOCAB_V1,
} from '@webable/core/page/vocab';
import {
  MAX_CONTROL_WORDS,
  MAX_HEADING_WORDS,
  vocabularyViolations,
} from '@webable/core/page/vocab-check';
import { VERIFY_CODES } from '@webable/core/policy/types';
import { wireOutline } from '@webable/core/skeleton/outline';
import {
  CATALOG_VERSION,
  COMPOSE_FALLBACK_MODEL,
  COMPOSE_PINNED_MODEL,
  COMPOSE_SCHEMA_VERSION,
  JEV_PINNED_MODEL,
  OP_LIBRARY_VERSION,
} from '@webable/core/versions';

export {
  buildQuestions,
  callJev,
  CATALOG_VERSION,
  COMPOSE_FALLBACK_MODEL,
  COMPOSE_PINNED_MODEL,
  COMPOSE_SCHEMA_VERSION,
  composeRequestSchema,
  composeResponseSchema,
  createMockJevFetch,
  decideRequestSchema,
  decideResponseSchema,
  DROPPED_MARK,
  isVocabPhrase,
  isVocabWord,
  JEV_ENDPOINT,
  JEV_PINNED_MODEL,
  JEV_REQUEST_ID_HEADER,
  MAX_CONTROL_WORDS,
  MAX_HEADING_WORDS,
  MAX_REGIONS_PER_CALL,
  MAX_REQUEST_TOKENS,
  mockJevAnswer,
  OP_IDS,
  OP_LIBRARY_VERSION,
  PAGE_CATEGORIES,
  pageSpecSchema,
  plannerRequestBody,
  REGION_ROLES,
  unknownEvidenceWords,
  VERIFY_CODES,
  VOCAB_V1,
  vocabularyViolations,
  wireOutline,
};

type DecideOk = Extract<DecideResponse, { ok: true }>;

/**
 * Map a shape-checked Jev response to the wire answer the extension receives:
 * probabilities only. The mapped answer is then re-parsed with the wire schema,
 * whose object schemas strip unknown keys, so nothing Jev adds (`confidence`,
 * `legend`, the `choice` echo, future fields) can reach a client even if the
 * mapper changes. Returns null when the mapped answer is not wire-valid.
 */
export function compact(
  built: Pick<BuiltQuestions, 'questions'>,
  jev: JevResponse,
  ms: { jev: number; edge: number },
): DecideOk | null {
  const parsed = decideResponseSchema.safeParse(
    toDecideResponse(built, jev, ms),
  );
  return parsed.success && parsed.data.ok ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Opt-in product learning report (personalization.md 13.3, 14.2).
// ---------------------------------------------------------------------------

/** Most outcome cells one report may carry (contribution bounding). */
export const AGG_MAX_CELLS = 4;
/** Most AI-label rows one report may carry. */
export const AGG_MAX_AI = 2;
/** Most engine-reliability rows one report may carry (one per op at most). */
export const AGG_MAX_ENGINE = OP_IDS.length;

const bit = z.literal([0, 1]);

const aggCellSchema = z.strictObject({
  op: z.enum(OP_IDS),
  /** The need level for the op's own dimension only, never a profile vector. */
  need: z.literal([0, 1, 2]),
  cat: z.enum(PAGE_CATEGORIES),
  mode: z.enum(['auto', 'offer']),
  trigger: z.enum(['profile', 'friction', 'pinned']),
  /** Randomized-response bit (epsilon = ln 3). */
  y: bit,
});

const aggEngineSchema = z.strictObject({
  op: z.enum(OP_IDS),
  cat: z.enum(PAGE_CATEGORIES),
  vcode: z.enum(VERIFY_CODES),
  /** Clipped count. */
  c: z.literal([1, 2, 3]),
});

const aggAiSchema = z.strictObject({
  op: z.enum(OP_IDS),
  label: z.enum(['clear', 'likely', 'unsure']),
  y: bit,
});

/**
 * One device's report for one 4-week window. Everything is an enum, a bucket or
 * a randomized bit: no identifiers, no domains, no timestamps finer than the
 * window. Cells are unique per (op, need, cat, mode, trigger).
 */
export const aggReportSchema = z
  .strictObject({
    v: z.literal(1),
    /** 4-week window id, `YYYY-Www/4` (ISO week-year and the window's first ISO week). */
    window: z.string().regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])\/4$/),
    /** Op library version the outcomes were observed with. */
    libVer: z.string().regex(/^ops-\d{1,3}\.\d{1,3}\.\d{1,3}$/),
    /** Global-prior release the device started from. */
    priorRelease: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,39}$/),
    cells: z.array(aggCellSchema).max(AGG_MAX_CELLS),
    engine: z.array(aggEngineSchema).max(AGG_MAX_ENGINE).optional(),
    ai: z.array(aggAiSchema).max(AGG_MAX_AI).optional(),
  })
  .superRefine((report, ctx) => {
    const seen = new Set<string>();
    report.cells.forEach((c, i) => {
      const key = `${c.op}|${c.need}|${c.cat}|${c.mode}|${c.trigger}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cells', i],
          message: 'Duplicate cell.',
        });
      }
      seen.add(key);
    });
  });
