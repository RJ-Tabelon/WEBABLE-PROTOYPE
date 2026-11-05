// Owner: X (round 7). Structured content read from the page stays on the device: strip it from anything sent out.

/** Outline node ids look like 'n12'. */
const NODE_ID = /^n\d{1,5}$/;

function looksLikeOutlineNode(o: Record<string, unknown>): boolean {
  return typeof o.id === 'string' && NODE_ID.test(o.id) && typeof o.kind === 'string';
}

/** A copy of an outline without any node's `data` (ExtractedData). */
export function stripOutlineData<T extends { nodes: ReadonlyArray<object> }>(outline: T): T {
  return {
    ...outline,
    nodes: outline.nodes.map((n) => {
      if (!n || typeof n !== 'object' || !('data' in n)) return n;
      const { data: _drop, ...rest } = n as Record<string, unknown>;
      return rest;
    }),
  };
}

/**
 * A copy of any request body with `data` removed from every outline-node-like object in it (an `id` like 'n12' and a
 * `kind`), at any depth. Everything else is left as it is. Defence in depth for every call to the server.
 */
export function stripLocalData<T>(body: T): T {
  const seen = new WeakMap<object, unknown>();
  const walk = (x: unknown, depth: number): unknown => {
    if (x === null || typeof x !== 'object' || depth > 12) return x;
    const have = seen.get(x);
    if (have !== undefined) return have;
    if (Array.isArray(x)) {
      const out: unknown[] = [];
      seen.set(x, out);
      for (const y of x) out.push(walk(y, depth + 1));
      return out;
    }
    const o = x as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    seen.set(x, out);
    const strip = looksLikeOutlineNode(o);
    for (const [k, v] of Object.entries(o)) {
      if (strip && k === 'data') continue;
      out[k] = walk(v, depth + 1);
    }
    return out;
  };
  return walk(body, 0) as T;
}
