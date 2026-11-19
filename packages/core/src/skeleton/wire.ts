import { z } from 'zod';

import {
  SKEL_COUNT_BUCKETS,
  SKEL_FLAGS,
  SKEL_HREF_KINDS,
  SKEL_ID_PATTERN,
  SKEL_INPUT_TYPES,
  SKEL_KINDS,
  SKEL_LENGTH_BUCKETS,
  SKEL_MAX_COORD,
  SKEL_MAX_DEPTH,
  SKEL_MAX_LABEL_WORDS,
  SKEL_MAX_NODES,
  SKEL_PATTERNS,
  SKEL_ROLES,
  SKEL_TAGS,
} from './constants';

/**
 * What leaves the device for layout planning (docs/10 §6): a typed node list.
 * Every field is an enum, a bounded number, an id, or a public-vocabulary
 * word. The Edge Function re-parses it with this strict schema and re-checks
 * every word against VOCAB_V1 before it writes the outline the model reads,
 * so nothing page-supplied reaches the prompt unvalidated.
 *
 * Built from a Skeleton by `skeleton/to-wire.ts` (service worker), which drops
 * labels inside records, keeps at most six vocabulary words elsewhere, strips
 * typed and URL-query tokens, rounds boxes to 8 px and buckets counts.
 */

const id = z.string().regex(SKEL_ID_PATTERN);
const coord = z.number().int().min(0).max(SKEL_MAX_COORD);

/** One public-vocabulary word (re-checked against VOCAB_V1 server-side) or the dropped mark. */
export const wireWordSchema = z.union([
  z.string().regex(/^[a-z]{2,20}$/),
  z.literal('·'),
]);

export const wireNodeSchema = z.strictObject({
  id,
  /** Parent id; null only for the root. */
  p: id.nullable(),
  t: z.enum(SKEL_TAGS),
  r: z.enum(SKEL_ROLES).nullable(),
  k: z.enum(SKEL_KINDS),
  /** [x, y, w, h], rounded to 8 CSS px. */
  b: z.tuple([coord, coord, coord, coord]),
  fs: z.number().int().min(4).max(200).optional(),
  /** Weight bucket: 400 regular, 600 bold. */
  w: z.literal([400, 600]).optional(),
  lv: z.number().int().min(1).max(6).optional(),
  f: z.array(z.enum(SKEL_FLAGS)).max(SKEL_FLAGS.length).optional(),
  it: z.enum(SKEL_INPUT_TYPES).optional(),
  o: z.enum(SKEL_COUNT_BUCKETS).optional(),
  /** Label as public-vocabulary words; absent inside records. */
  l: z.array(wireWordSchema).min(1).max(SKEL_MAX_LABEL_WORDS).optional(),
  /** Text shape: length bucket, patterns, inline-link count bucket. */
  sh: z
    .strictObject({
      len: z.enum(SKEL_LENGTH_BUCKETS),
      pat: z.array(z.enum(SKEL_PATTERNS)).max(SKEL_PATTERNS.length).optional(),
      ln: z.enum(SKEL_COUNT_BUCKETS).optional(),
    })
    .optional(),
  hr: z.enum(SKEL_HREF_KINDS).optional(),
  /** Collection: item count bucket, item tag, exemplar root id. */
  n: z.enum(SKEL_COUNT_BUCKETS).optional(),
  itm: z.enum(SKEL_TAGS).optional(),
  ex: id.optional(),
  /** Slot inside a collection exemplar. */
  s: z.literal(true).optional(),
});
export type WireNode = z.infer<typeof wireNodeSchema>;

export const wirePageSchema = z.strictObject({
  /** Viewport and document size in CSS px at the read zoom, rounded to 8. */
  vw: coord,
  vh: coord,
  dw: coord,
  dh: coord,
  /** Two-letter language subtag or ''. */
  lang: z.string().regex(/^([a-z]{2})?$/),
});
export type WirePage = z.infer<typeof wirePageSchema>;

export const wireSkeletonSchema = z
  .strictObject({
    page: wirePageSchema,
    nodes: z.array(wireNodeSchema).min(1).max(SKEL_MAX_NODES),
  })
  .superRefine((sk, ctx) => {
    // Ids unique, parents precede children, depth bounded.
    const depth = new Map<string, number>();
    for (const [i, n] of sk.nodes.entries()) {
      if (depth.has(n.id)) {
        ctx.addIssue({
          code: 'custom',
          message: 'duplicate id',
          path: ['nodes', i, 'id'],
        });
        continue;
      }
      if (n.p === null) {
        if (i !== 0) {
          ctx.addIssue({
            code: 'custom',
            message: 'only the first node may be the root',
            path: ['nodes', i, 'p'],
          });
        }
        depth.set(n.id, 0);
        continue;
      }
      const pd = depth.get(n.p);
      if (pd === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'parent must precede child',
          path: ['nodes', i, 'p'],
        });
        continue;
      }
      if (pd + 1 > SKEL_MAX_DEPTH) {
        ctx.addIssue({
          code: 'custom',
          message: 'too deep',
          path: ['nodes', i],
        });
      }
      depth.set(n.id, pd + 1);
    }
  });
export type WireSkeleton = z.infer<typeof wireSkeletonSchema>;
