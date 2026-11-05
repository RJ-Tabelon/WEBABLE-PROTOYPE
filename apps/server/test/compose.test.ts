// Round 10: POST /v1/compose without network (no keys: every group fails closed), the planner's input and schema.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMPOSE_ICONS } from '@webable/core';
import type { ComposeGroupIn } from '@webable/core';
import { createApp } from '../src/app';
import { COMPOSE_INSTRUCTIONS, COMPOSE_SCHEMA, composeInput } from '../src/prompts';
import { oversize } from '../src/routes/compose';

const PAGE = { title: 'Refunds', host: 'www.irs.gov', purpose: 'info_guide' };
const GROUP: ComposeGroupIn = {
  id: 'gabc123',
  heading: 'When to expect your refund',
  units: [
    { id: 'u1', kind: 'para', text: 'The typical time to receive your refund depends on how you filed your taxes:' },
    { id: 'u2', kind: 'list', text: '• E-filed return - 3 weeks\n• Mailed return - 6 or more weeks' },
  ],
  linkTexts: ['Delays'],
};

let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = { o: process.env.OPENAI_API_KEY, t: process.env.TYPESAFE_API_KEY };
  delete process.env.OPENAI_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
});
afterEach(() => {
  if (saved.o !== undefined) process.env.OPENAI_API_KEY = saved.o;
  if (saved.t !== undefined) process.env.TYPESAFE_API_KEY = saved.t;
});

const post = (body: unknown) =>
  createApp().request('/v1/compose', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: '127.0.0.1:41741' }, body: JSON.stringify(body) });

describe('POST /v1/compose', () => {
  it('no keys: every group ok:false with a reason, never an error', async () => {
    const r = await post({ req: { reader: null, page: PAGE, groups: [GROUP, { ...GROUP, id: 'gdef456' }] } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.model).toBe('gpt-5.4-mini');
    expect(body.results).toEqual([
      expect.objectContaining({ id: 'gabc123', ok: false, blocks: null, better: null, reason: 'llm_unavailable' }),
      expect.objectContaining({ id: 'gdef456', ok: false, reason: 'llm_unavailable' }),
    ]);
  });
  it('no groups is an empty answer; bad ids and more than 4 groups are a 400', async () => {
    expect((await (await post({ req: { reader: null, page: PAGE, groups: [] } })).json()).results).toEqual([]);
    expect((await post({ req: { reader: null, page: PAGE, groups: [{ ...GROUP, id: 'x1' }] } })).status).toBe(400);
    expect((await post({ req: { reader: null, page: PAGE, groups: [GROUP, GROUP, GROUP, GROUP, GROUP] } })).status).toBe(400);
  });
  it('a group over the size limit is invalid on its own', () => {
    expect(oversize(GROUP)).toBe(false);
    expect(oversize({ ...GROUP, units: Array.from({ length: 11 }, (_, i) => ({ id: `u${i + 1}`, kind: 'para' as const, text: 'Short.' })) })).toBe(true);
    expect(oversize({ ...GROUP, units: [{ id: 'u1', kind: 'para', text: 'x'.repeat(3_001) }] })).toBe(true);
  });
  it('GET / lists the route', async () => {
    const r = await createApp().request('/', { headers: { Host: '127.0.0.1:41741' } });
    expect((await r.json()).routes).toContain('POST /v1/compose');
  });
});

describe('planner input and schema', () => {
  it('the planner sees the reader, the leaning, the level, the page, the heading, the units and the link words', () => {
    const input = composeInput('BRIEF', 'LEAN', 'plain', PAGE, GROUP, 'Units u2 missing.');
    expect(input).toMatch(/READER\nBRIEF[\s\S]*LEANING\nLEAN[\s\S]*LEVEL\nplain[\s\S]*PAGE\nRefunds \(www.irs.gov\), info guide[\s\S]*HEADING\nWhen to expect[\s\S]*\[u1, paragraph\][\s\S]*\[u2, list\][\s\S]*⟦1⟧ shows: Delays[\s\S]*YOUR LAST TRY WAS NOT USED\nUnits u2 missing\./);
  });
  it('the catalog names every kind and lists only bundled icons; the schema is strict with a k discriminator', () => {
    for (const k of ['prose', 'keyfacts', 'steps', 'stats', 'compare', 'callout', 'definitions', 'quote', 'contact', 'points']) {
      expect(COMPOSE_INSTRUCTIONS).toContain(`- ${k}:`);
    }
    const defs = COMPOSE_SCHEMA.$defs as { icon: { anyOf: Array<{ enum?: string[] }> } };
    expect(defs.icon.anyOf[0]!.enum).toEqual([...COMPOSE_ICONS]);
    const variants = (COMPOSE_SCHEMA.properties as Record<string, { items: { anyOf: Array<Record<string, unknown>> } }>).blocks!.items.anyOf;
    expect(variants).toHaveLength(10);
    for (const v of variants) {
      expect(v.additionalProperties).toBe(false);
      expect(v.required).toEqual(Object.keys(v.properties as object));
    }
  });
});
