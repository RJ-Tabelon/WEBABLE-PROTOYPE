import type { Context } from 'hono';
import type { z } from 'zod';
import { HttpError } from '../util';
import { zodIssues } from '../schemas';

/** Parse and validate a JSON body. Errors name the field at fault, never its value. */
export async function readBody<T>(c: Context, schema: z.ZodType<T, unknown>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, 'bad_json', 'The request body is not valid JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, 'invalid_body', 'The request body does not match the contract.', zodIssues(parsed.error));
  return parsed.data;
}

/** `X-WebAble-Fresh: 1` skips the answer cache (used by the demo to show a live call). */
export function wantsFresh(c: Context): boolean {
  return c.req.header('x-webable-fresh') === '1';
}
