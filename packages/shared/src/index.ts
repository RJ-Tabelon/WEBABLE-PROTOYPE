import { z } from 'zod';

const countSchema = z.number().int().nonnegative();

export const headingSchema = z.object({
  level: z.number().int().min(1).max(6),
  text: z.string(),
});

export const pageRulePreferencesSchema = z.object({
  minimumTextSize: z.boolean(),
  textSpacing: z.boolean(),
  enhancedFocus: z.boolean(),
  reduceMotion: z.boolean(),
  contrastMode: z.enum(['unchanged', 'high', 'dark']),
});

export const defaultPageRulePreferences = {
  minimumTextSize: false,
  textSpacing: false,
  enhancedFocus: false,
  reduceMotion: false,
  contrastMode: 'unchanged',
} as const satisfies PageRulePreferences;

export const pageSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  capturedAt: z.iso.datetime(),
  url: z.url(),
  title: z.string(),
  language: z.string(),
  text: z.object({
    excerpt: z.string(),
    wordCount: countSchema,
    truncated: z.boolean(),
    visibleElements: countSchema,
    belowMinimumSize: countSchema,
  }),
  headingCount: countSchema,
  headings: z.array(headingSchema),
  links: z.object({
    total: countSchema,
    sameOrigin: countSchema,
    external: countSchema,
  }),
  controls: z.object({
    buttons: countSchema,
    inputs: countSchema,
    selects: countSchema,
    textareas: countSchema,
  }),
  images: z.object({
    total: countSchema,
    withAlt: countSchema,
    withoutAlt: countSchema,
  }),
  landmarks: z.array(z.string()),
  layout: z.object({
    viewportWidth: countSchema,
    viewportHeight: countSchema,
    documentWidth: countSchema,
    documentHeight: countSchema,
    hasHorizontalOverflow: z.boolean(),
    fixedOrStickyElements: countSchema,
  }),
  domRevision: countSchema,
});

export type PageRulePreferences = z.infer<typeof pageRulePreferencesSchema>;
export type PageSnapshot = z.infer<typeof pageSnapshotSchema>;

export type ReaderRequest =
  | { type: 'webable:read' }
  | { type: 'webable:get-preferences' }
  | {
      type: 'webable:apply-rules';
      preferences: PageRulePreferences;
    };

export type PageUpdatedMessage = {
  type: 'webable:page-updated';
  revision: number;
};
