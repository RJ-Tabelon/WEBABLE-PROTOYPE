import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { FIXTURE_NAMES, SKELETON_FIXTURES } from './__fixtures__';
import {
  FIELD_ROLES,
  IMPORTANCE,
  ITEM_KINDS,
  SECTION_KINDS,
  SPEC_MAX_COLLECTIONS,
  SPEC_MAX_FIELDS,
  SPEC_MAX_NODE_IDS,
  SPEC_MAX_SECTIONS,
} from './constants';
import { heuristicSpec } from './heuristic';
import { PAGE_SPEC_JSON_SCHEMA, pageSpecSchema } from './wire';

/**
 * The JSON Schema the planner is decoded against and the zod schema every
 * spec is parsed with must describe the same language: same enums, same id
 * pattern, same bounds, same nullability. Strict decoding also needs every
 * string to be an enum or a pattern (no free-text channel, docs/10 §4.1).
 */

type Json = Record<string, unknown>;

/** Visit every subschema with its path. */
function walk(
  schema: unknown,
  visit: (s: Json, path: string) => void,
  path = '$',
): void {
  if (!schema || typeof schema !== 'object') return;
  const s = schema as Json;
  visit(s, path);
  if (s.properties) {
    for (const [k, v] of Object.entries(s.properties as Json))
      walk(v, visit, `${path}.${k}`);
  }
  if (s.items) walk(s.items, visit, `${path}[]`);
  if (Array.isArray(s.anyOf))
    s.anyOf.forEach((v, i) => walk(v, visit, `${path}|${i}`));
}

/**
 * A canonical form both schemas reduce to: objects by their properties and
 * required keys, arrays by bounds and items, nullable unions, string enums
 * (sorted) and patterns, and numeric literals.
 */
function canon(schema: unknown): unknown {
  const s = schema as Json;
  if (Array.isArray(s.anyOf)) {
    const parts = s.anyOf as Json[];
    const nonNull = parts.filter((p) => p.type !== 'null');
    if (nonNull.length === 1 && parts.length === 2)
      return { nullable: canon(nonNull[0]) };
    return { anyOf: parts.map(canon) };
  }
  if (s.type === 'object') {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries((s.properties ?? {}) as Json))
      props[k] = canon(v);
    return {
      object: props,
      required: [...((s.required as string[]) ?? [])].sort(),
    };
  }
  if (s.type === 'array') {
    return {
      array: canon(s.items),
      min: (s.minItems as number | undefined) ?? 0,
      max: s.maxItems as number | undefined,
    };
  }
  if (s.type === 'string') {
    if (Array.isArray(s.enum))
      return { enum: [...(s.enum as string[])].sort() };
    return { pattern: s.pattern };
  }
  if (s.type === 'integer' || s.type === 'number') {
    if ('const' in s) return { literal: s.const };
    if (Array.isArray(s.enum) && s.enum.length === 1)
      return { literal: s.enum[0] };
    return { number: true };
  }
  return { unknown: s };
}

/** A validator for exactly the JSON Schema subset PAGE_SPEC_JSON_SCHEMA uses. */
function jsonValid(schema: unknown, value: unknown): boolean {
  const s = schema as Json;
  if (Array.isArray(s.anyOf))
    return (s.anyOf as unknown[]).some((x) => jsonValid(x, value));
  switch (s.type) {
    case 'null':
      return value === null;
    case 'string':
      if (typeof value !== 'string') return false;
      if (Array.isArray(s.enum) && !s.enum.includes(value)) return false;
      if (typeof s.pattern === 'string' && !new RegExp(s.pattern).test(value))
        return false;
      return true;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return false;
      return !Array.isArray(s.enum) || s.enum.includes(value);
    case 'array': {
      if (!Array.isArray(value)) return false;
      if (typeof s.minItems === 'number' && value.length < s.minItems)
        return false;
      if (typeof s.maxItems === 'number' && value.length > s.maxItems)
        return false;
      return value.every((v) => jsonValid(s.items, v));
    }
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
      const props = (s.properties ?? {}) as Json;
      const v = value as Json;
      for (const k of (s.required as string[]) ?? [])
        if (!(k in v)) return false;
      if (s.additionalProperties === false) {
        for (const k of Object.keys(v)) if (!(k in props)) return false;
      }
      return Object.entries(props).every(
        ([k, p]) => !(k in v) || jsonValid(p, v[k]),
      );
    }
    default:
      return false;
  }
}

const zodJson = z.toJSONSchema(pageSpecSchema, { io: 'input' });

describe('PAGE_SPEC_JSON_SCHEMA', () => {
  it('has no free-text channel: every string is an enum or a pattern', () => {
    const free: string[] = [];
    walk(PAGE_SPEC_JSON_SCHEMA, (s, path) => {
      if (
        s.type === 'string' &&
        !Array.isArray(s.enum) &&
        typeof s.pattern !== 'string'
      )
        free.push(path);
    });
    expect(free).toEqual([]);
  });

  it('meets strict structured-output rules: closed objects, every property required, bounded arrays', () => {
    walk(PAGE_SPEC_JSON_SCHEMA, (s, path) => {
      if (s.type === 'object') {
        expect(s.additionalProperties, path).toBe(false);
        expect([...(s.required as string[])].sort(), path).toEqual(
          Object.keys(s.properties as Json).sort(),
        );
      }
      if (s.type === 'array') expect(typeof s.maxItems, path).toBe('number');
    });
  });

  it('describes the same language as the zod schema', () => {
    expect(canon(PAGE_SPEC_JSON_SCHEMA)).toEqual(canon(zodJson));
  });

  it('uses the shared bounds and vocabularies', () => {
    const c = canon(PAGE_SPEC_JSON_SCHEMA) as {
      object: {
        sections: {
          array: {
            object: Record<
              string,
              { enum?: string[]; array?: unknown; max?: number }
            >;
          };
          max: number;
        };
        collections: {
          array: { object: Record<string, unknown> };
          max: number;
        };
      };
    };
    expect(c.object.sections.max).toBe(SPEC_MAX_SECTIONS);
    expect(c.object.collections.max).toBe(SPEC_MAX_COLLECTIONS);
    const section = c.object.sections.array.object;
    expect(section.kind!.enum).toEqual([...SECTION_KINDS].sort());
    expect(section.importance!.enum).toEqual([...IMPORTANCE].sort());
    expect(section.node_ids!.max).toBe(SPEC_MAX_NODE_IDS);
    const coll = c.object.collections.array.object as Record<
      string,
      {
        enum?: string[];
        max?: number;
        array?: { object: Record<string, { enum?: string[] }> };
      }
    >;
    expect(coll.item_kind!.enum).toEqual([...ITEM_KINDS].sort());
    expect(coll.fields!.max).toBe(SPEC_MAX_FIELDS);
    expect(coll.fields!.array!.object.role!.enum).toEqual(
      [...FIELD_ROLES].sort(),
    );
  });

  it('accepts every heuristic spec, as zod does', () => {
    for (const name of FIXTURE_NAMES) {
      const spec = heuristicSpec(SKELETON_FIXTURES[name]);
      expect(jsonValid(PAGE_SPEC_JSON_SCHEMA, spec), name).toBe(true);
      expect(pageSpecSchema.safeParse(spec).success, name).toBe(true);
    }
  });

  it('agrees with zod on mutated specs (unknown keys aside, which zod strips)', () => {
    let a = 20261015 >>> 0;
    const rand = (): number => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const bad: unknown[] = [
      '',
      'Free text',
      'e',
      'e12345',
      'E1',
      'e1 ',
      7,
      1.5,
      null,
      true,
      [],
      {},
    ];
    const mutate = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        const r = rand();
        if (r < 0.15) return [];
        if (r < 0.3) return [...value, ...value, ...value, ...value, ...value];
        if (value.length === 0) return value;
        const i = Math.floor(rand() * value.length);
        const out = [...value];
        out[i] = mutate(out[i]);
        return out;
      }
      if (value && typeof value === 'object') {
        const keys = Object.keys(value);
        const k = keys[Math.floor(rand() * keys.length)]!;
        const out = { ...(value as Json) };
        if (rand() < 0.1) delete out[k];
        else out[k] = mutate(out[k]);
        return out;
      }
      return rand() < 0.7 ? bad[Math.floor(rand() * bad.length)] : value;
    };
    let disagreements = 0;
    let rejected = 0;
    for (let i = 0; i < 3000; i++) {
      const sk = SKELETON_FIXTURES[FIXTURE_NAMES[i % FIXTURE_NAMES.length]!];
      let spec: unknown = heuristicSpec(sk);
      for (let m = 0; m < 1 + Math.floor(rand() * 3); m++) spec = mutate(spec);
      const j = jsonValid(PAGE_SPEC_JSON_SCHEMA, spec);
      const zz = pageSpecSchema.safeParse(spec).success;
      if (j !== zz) disagreements++;
      if (!j) rejected++;
    }
    expect(disagreements).toBe(0);
    expect(rejected).toBeGreaterThan(1000);
  });

  it('rejects unknown keys while zod strips them on re-parse', () => {
    const spec = {
      ...heuristicSpec(SKELETON_FIXTURES.youtube),
      heading: 'Injected title',
    };
    expect(jsonValid(PAGE_SPEC_JSON_SCHEMA, spec)).toBe(false);
    const parsed = pageSpecSchema.parse(spec);
    expect('heading' in parsed).toBe(false);
  });
});
