// Validation for `compose`, both directions (docs/10 §6).
//
// In: schema version, the strict wire schema, then a server-side re-check of
// every label word against VOCAB_V1 and of the record rule (no words on text
// nodes or anywhere inside a collection). A modified client therefore cannot
// use the planner to send page text: the only strings that reach the outline
// are enum values, ids and words from the public vocabulary.
//
// Out: the model's text must be JSON, parse as a PageSpec, and use only ids
// that were in the request. Anything else is rejected whole, never repaired
// here; the extension's validator (core/compose/validate.ts) repairs specs
// that are well-formed but structurally poor.
//
// Nothing here returns or logs offending values: only stages, zod issue codes
// with schema paths (indices removed), and counts.

import {
  COMPOSE_SCHEMA_VERSION,
  composeRequestSchema,
  DROPPED_MARK,
  isVocabWord,
  pageSpecSchema,
  type ComposeRequest,
  type PageSpec,
  type WireNode,
} from '../_shared/core.bundle.js';

export type RequestValidation =
  | { ok: true; request: ComposeRequest }
  | { ok: false; reason: 'schema_mismatch' }
  | {
      ok: false;
      reason: 'bad_input';
      stage: 'body' | 'schema' | 'vocabulary' | 'record_words';
      /** First schema issue as `code@path`, schema keys only (no indices, no values). */
      issue?: string;
      /** Number of offending words or nodes. */
      count?: number;
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `invalid_value@skeleton.nodes.l`: low-cardinality, never a value or an index. */
export function describeIssue(issue: {
  code: string;
  path: ReadonlyArray<PropertyKey>;
}): string {
  const path = issue.path.filter((p) => typeof p === 'string').join('.');
  return `${issue.code}@${path || '(root)'}`;
}

/** Label words that are neither VOCAB_V1 nor the dropped mark. */
export function unknownLabelWords(nodes: readonly WireNode[]): number {
  let count = 0;
  for (const n of nodes) {
    for (const word of n.l ?? []) {
      if (word !== DROPPED_MARK && !isVocabWord(word)) count += 1;
    }
  }
  return count;
}

/**
 * Nodes that carry words where the wire never has any (skeleton/to-wire.ts):
 * running and short text (only their shape is sent), and every node inside a
 * record (a slot, an exemplar, or anything under a collection or an exemplar).
 * Words from emails, results or products in lists never leave the device.
 */
export function recordWordNodes(nodes: readonly WireNode[]): number {
  const kinds = new Map(nodes.map((n) => [n.id, n.k] as const));
  const exemplars = new Set<string>();
  for (const n of nodes) if (n.k === 'collection' && n.ex) exemplars.add(n.ex);
  const inside = new Set<string>();
  let count = 0;
  for (const n of nodes) {
    const p = n.p;
    if (
      n.s === true ||
      exemplars.has(n.id) ||
      (p !== null && (inside.has(p) || kinds.get(p) === 'collection'))
    )
      inside.add(n.id);
    if (!n.l) continue;
    if (n.k === 'text' || n.k === 'stext' || inside.has(n.id)) count += 1;
  }
  return count;
}

export function validateComposeRequest(body: unknown): RequestValidation {
  if (!isPlainObject(body))
    return { ok: false, reason: 'bad_input', stage: 'body' };

  // An older or newer extension: say so precisely (409) rather than "bad input".
  if (
    typeof body.schema === 'string' &&
    body.schema !== COMPOSE_SCHEMA_VERSION
  ) {
    return { ok: false, reason: 'schema_mismatch' };
  }

  const parsed = composeRequestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      reason: 'bad_input',
      stage: 'schema',
      ...(first ? { issue: describeIssue(first) } : {}),
    };
  }

  const request = parsed.data;
  const unknown = unknownLabelWords(request.skeleton.nodes);
  if (unknown > 0)
    return {
      ok: false,
      reason: 'bad_input',
      stage: 'vocabulary',
      count: unknown,
    };
  const misplaced = recordWordNodes(request.skeleton.nodes);
  if (misplaced > 0)
    return {
      ok: false,
      reason: 'bad_input',
      stage: 'record_words',
      count: misplaced,
    };

  return { ok: true, request };
}

export type OutputCheck =
  | { ok: true; spec: PageSpec }
  | {
      ok: false;
      stage: 'json' | 'schema' | 'unknown_id';
      issue?: string;
      count?: number;
    };

/** Every id a spec refers to, in spec order. */
export function specIds(spec: PageSpec): string[] {
  const ids: string[] = [];
  for (const s of spec.sections) {
    ids.push(...s.node_ids);
    if (s.heading_ref !== null) ids.push(s.heading_ref);
  }
  for (const c of spec.collections) {
    ids.push(c.list_id);
    if (c.open_slot !== null) ids.push(c.open_slot);
    for (const f of c.fields) ids.push(f.slot_id);
  }
  return ids;
}

/**
 * Check the planner's output text against the request it answers. The parse
 * strips unknown keys, so only PageSpec fields survive.
 */
export function checkPlannerOutput(
  text: string,
  request: ComposeRequest,
): OutputCheck {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, stage: 'json' };
  }
  const parsed = pageSpecSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      stage: 'schema',
      ...(first ? { issue: describeIssue(first) } : {}),
    };
  }
  const known = new Set(request.skeleton.nodes.map((n) => n.id));
  const unknown = specIds(parsed.data).filter((id) => !known.has(id)).length;
  if (unknown > 0) return { ok: false, stage: 'unknown_id', count: unknown };
  return { ok: true, spec: parsed.data };
}
