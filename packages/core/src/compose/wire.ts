import { z } from 'zod';

import { SKEL_ID_PATTERN, SKEL_ID_PATTERN_SOURCE } from '../skeleton/constants';
import { wireSkeletonSchema } from '../skeleton/wire';
import { COMPOSE_SCHEMA_VERSION } from '../versions';
import {
  CARD_STYLES,
  FIELD_ROLES,
  FIELD_SHOW,
  IMPORTANCE,
  ITEM_KINDS,
  LEAD_MODES,
  MEDIA_SHAPES,
  PAGE_TYPES,
  PRIMARY_TASKS,
  SECTION_KINDS,
  SECTION_LAYOUTS,
  SPEC_MAX_COLLECTIONS,
  SPEC_MAX_FIELDS,
  SPEC_MAX_NODE_IDS,
  SPEC_MAX_SECTIONS,
} from './constants';
import type { PageSpec } from './spec';

/**
 * The compose contract (extension <-> `compose` Edge Function <-> OpenAI).
 * docs/10 §6. Inbound wire is strict; the spec schema mirrors the strict JSON
 * Schema the model is decoded against, so the two cannot drift
 * (`wire.test.ts` checks them against each other).
 */

const id = z.string().regex(SKEL_ID_PATTERN);

export const specSectionSchema = z.object({
  kind: z.enum(SECTION_KINDS),
  importance: z.enum(IMPORTANCE),
  node_ids: z.array(id).min(1).max(SPEC_MAX_NODE_IDS),
  heading_ref: id.nullable(),
  layout: z.enum(SECTION_LAYOUTS),
});

export const specFieldSchema = z.object({
  slot_id: id,
  role: z.enum(FIELD_ROLES),
  show: z.enum(FIELD_SHOW),
});

export const specCollectionSchema = z.object({
  list_id: id,
  item_kind: z.enum(ITEM_KINDS),
  open_slot: id.nullable(),
  card: z.enum(CARD_STYLES),
  media: z.enum(MEDIA_SHAPES),
  lead: z.enum(LEAD_MODES),
  fields: z.array(specFieldSchema).max(SPEC_MAX_FIELDS),
});

/** Outbound/parse schema: z.object strips unknown keys on re-parse. */
export const pageSpecSchema = z.object({
  v: z.literal(1),
  page_type: z.enum(PAGE_TYPES),
  primary_task: z.enum(PRIMARY_TASKS),
  sections: z.array(specSectionSchema).min(1).max(SPEC_MAX_SECTIONS),
  collections: z.array(specCollectionSchema).max(SPEC_MAX_COLLECTIONS),
}) satisfies z.ZodType<PageSpec>;

const idJson = { type: 'string', pattern: SKEL_ID_PATTERN_SOURCE } as const;
const enumJson = (values: readonly string[]) =>
  ({ type: 'string', enum: [...values] }) as const;

/**
 * Strict JSON Schema for OpenAI Structured Outputs (`text.format`). Every
 * field is required, `additionalProperties` is false, and every string is an
 * enum or an id pattern: the model has no free-text channel.
 */
export const PAGE_SPEC_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['v', 'page_type', 'primary_task', 'sections', 'collections'],
  properties: {
    v: { type: 'integer', enum: [1] },
    page_type: enumJson(PAGE_TYPES),
    primary_task: enumJson(PRIMARY_TASKS),
    sections: {
      type: 'array',
      minItems: 1,
      maxItems: SPEC_MAX_SECTIONS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'importance', 'node_ids', 'heading_ref', 'layout'],
        properties: {
          kind: enumJson(SECTION_KINDS),
          importance: enumJson(IMPORTANCE),
          node_ids: {
            type: 'array',
            minItems: 1,
            maxItems: SPEC_MAX_NODE_IDS,
            items: idJson,
          },
          heading_ref: { anyOf: [idJson, { type: 'null' }] },
          layout: enumJson(SECTION_LAYOUTS),
        },
      },
    },
    collections: {
      type: 'array',
      maxItems: SPEC_MAX_COLLECTIONS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'list_id',
          'item_kind',
          'open_slot',
          'card',
          'media',
          'lead',
          'fields',
        ],
        properties: {
          list_id: idJson,
          item_kind: enumJson(ITEM_KINDS),
          open_slot: { anyOf: [idJson, { type: 'null' }] },
          card: enumJson(CARD_STYLES),
          media: enumJson(MEDIA_SHAPES),
          lead: enumJson(LEAD_MODES),
          fields: {
            type: 'array',
            maxItems: SPEC_MAX_FIELDS,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['slot_id', 'role', 'show'],
              properties: {
                slot_id: idJson,
                role: enumJson(FIELD_ROLES),
                show: enumJson(FIELD_SHOW),
              },
            },
          },
        },
      },
    },
  },
} as const;

/** Request: extension -> Edge Function. Strict (unknown keys rejected). */
export const composeRequestSchema = z.strictObject({
  v: z.literal(1),
  schema: z.literal(COMPOSE_SCHEMA_VERSION),
  skeleton: wireSkeletonSchema,
});
export type ComposeRequest = z.infer<typeof composeRequestSchema>;

export const COMPOSE_DEGRADED_REASONS = [
  'unconfigured',
  'quota',
  'timeout',
  'model_error',
  'invalid_output',
  'refused',
  'disabled',
] as const;
export type ComposeDegradedReason = (typeof COMPOSE_DEGRADED_REASONS)[number];

/** Response: Edge Function -> extension. Usage and cache counts are never returned. */
export const composeResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    v: z.literal(1),
    schema: z.literal(COMPOSE_SCHEMA_VERSION),
    model: z.string().regex(/^[a-z0-9.-]{3,40}$/),
    spec: pageSpecSchema,
  }),
  z.object({
    ok: z.literal(false),
    degraded: z.enum(COMPOSE_DEGRADED_REASONS),
    retryAfterMs: z.number().int().min(0).max(86_400_000).optional(),
  }),
]);
export type ComposeResponse = z.infer<typeof composeResponseSchema>;
