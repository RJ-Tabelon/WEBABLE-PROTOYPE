import { assert, assertEquals } from 'jsr:@std/assert@1';

import {
  isVocabWord,
  type ComposeRequest,
  type PageSpec,
  type WireNode,
} from '../_shared/core.bundle.js';
import { composeRequest, fixtureWords, NEWS, YOUTUBE } from './fixtures.ts';
import {
  checkPlannerOutput,
  describeIssue,
  recordWordNodes,
  specIds,
  unknownLabelWords,
  validateComposeRequest,
} from './validate.ts';

const node = (
  patch: Partial<WireNode> & Pick<WireNode, 'id' | 'p'>,
): WireNode => ({
  t: 'div',
  r: null,
  k: 'group',
  b: [0, 0, 8, 8],
  ...patch,
});

Deno.test('fixtures are what a correct extension sends', () => {
  for (const sk of [YOUTUBE, NEWS]) {
    const req = composeRequest(sk);
    for (const word of fixtureWords(req))
      assert(word === '·' || isVocabWord(word), word);
    assertEquals(recordWordNodes(sk.nodes), 0);
    const result = validateComposeRequest(req);
    assert(result.ok);
    assertEquals(result.request.skeleton.nodes.length, sk.nodes.length);
  }
});

Deno.test('non-object bodies are bad input', () => {
  for (const body of [undefined, null, 'x', 1, []]) {
    assertEquals(validateComposeRequest(body), {
      ok: false,
      reason: 'bad_input',
      stage: 'body',
    });
  }
});

Deno.test(
  'another schema version is a mismatch, checked before the schema',
  () => {
    assertEquals(validateComposeRequest({ schema: 'wa-compose-0.9.0' }), {
      ok: false,
      reason: 'schema_mismatch',
    });
  },
);

Deno.test(
  'schema issues name a code and schema keys, never values or indices',
  () => {
    const req = composeRequest() as unknown as {
      skeleton: { nodes: Array<Record<string, unknown>> };
    };
    req.skeleton.nodes[7] = {
      ...req.skeleton.nodes[7],
      t: 'Welcome back Caden',
    };
    const result = validateComposeRequest(req);
    assert(!result.ok && result.reason === 'bad_input');
    assertEquals(result.stage, 'schema');
    assertEquals(result.issue, 'invalid_value@skeleton.nodes.t');
  },
);

Deno.test('unrecognized keys do not echo the key names', () => {
  const result = validateComposeRequest({
    ...composeRequest(),
    'my secret': 1,
  });
  assert(!result.ok && result.reason === 'bad_input');
  assertEquals(result.issue, 'unrecognized_keys@(root)');
});

Deno.test('describeIssue drops numeric and symbol path parts', () => {
  assertEquals(
    describeIssue({ code: 'too_big', path: ['skeleton', 'nodes', 3, 'l', 1] }),
    'too_big@skeleton.nodes.l',
  );
  assertEquals(
    describeIssue({ code: 'custom', path: [Symbol('x')] }),
    'custom@(root)',
  );
});

Deno.test('unknownLabelWords counts every non-vocabulary word', () => {
  assertEquals(
    unknownLabelWords([
      node({ id: 'e1', p: null, l: ['search', '·', 'zzqx'] }),
      node({ id: 'e2', p: 'e1', l: ['caden', 'qqzz'] }),
      node({ id: 'e3', p: 'e1' }),
    ]),
    3,
  );
});

Deno.test(
  'recordWordNodes finds words on text and anywhere inside records',
  () => {
    const nodes: WireNode[] = [
      node({ id: 'e1', p: null }),
      node({ id: 'e2', p: 'e1', k: 'text', l: ['open'] }),
      node({ id: 'e3', p: 'e1', k: 'stext', l: ['open'] }),
      // A collection's own label is fine; everything under it is a record.
      node({
        id: 'e4',
        p: 'e1',
        k: 'collection',
        n: '6-10',
        ex: 'e5',
        l: ['results'],
      }),
      node({ id: 'e5', p: 'e4', s: true }),
      node({ id: 'e6', p: 'e5', k: 'control', l: ['open'] }),
      node({ id: 'e7', p: 'e4', k: 'control', l: ['open'] }),
      // An exemplar placed away from its collection is still a record.
      node({ id: 'e8', p: 'e1', k: 'collection', n: '3-5', ex: 'e10' }),
      node({ id: 'e9', p: 'e1' }),
      node({ id: 'e10', p: 'e9', l: ['open'] }),
      node({ id: 'e11', p: 'e10', k: 'control', l: ['open'] }),
      // A control outside any record keeps its words.
      node({ id: 'e12', p: 'e9', k: 'control', l: ['open'] }),
    ];
    assertEquals(recordWordNodes(nodes), 6);
  },
);

const SPEC: PageSpec = {
  v: 1,
  page_type: 'listing_grid',
  primary_task: 'browse_and_choose',
  sections: [
    {
      kind: 'header',
      importance: 'secondary',
      node_ids: ['e3'],
      heading_ref: null,
      layout: 'chip_bar',
    },
    {
      kind: 'main_list',
      importance: 'primary',
      node_ids: ['e23'],
      heading_ref: 'e30',
      layout: 'card_grid',
    },
  ],
  collections: [
    {
      list_id: 'e51',
      item_kind: 'video',
      open_slot: 'e56',
      card: 'media',
      media: 'landscape',
      lead: 'none',
      fields: [
        { slot_id: 'e53', role: 'thumbnail', show: 'always' },
        { slot_id: 'e56', role: 'title', show: 'always' },
      ],
    },
  ],
};

Deno.test('specIds lists every reference in order', () => {
  assertEquals(specIds(SPEC), ['e3', 'e23', 'e30', 'e51', 'e56', 'e53', 'e56']);
});

Deno.test('checkPlannerOutput accepts a spec over the request ids', () => {
  const result = checkPlannerOutput(JSON.stringify(SPEC), composeRequest());
  assert(result.ok);
  assertEquals(result.spec, SPEC);
});

Deno.test('checkPlannerOutput rejects by stage', () => {
  const req: ComposeRequest = composeRequest();
  assertEquals(checkPlannerOutput('{"v":1', req), { ok: false, stage: 'json' });
  assertEquals(checkPlannerOutput('', req), { ok: false, stage: 'json' });
  const wrong = checkPlannerOutput(
    JSON.stringify({ ...SPEC, sections: [] }),
    req,
  );
  assertEquals(wrong, {
    ok: false,
    stage: 'schema',
    issue: 'too_small@sections',
  });
  const free = checkPlannerOutput(
    JSON.stringify({
      ...SPEC,
      sections: [{ ...SPEC.sections[0], heading_ref: 'Latest videos' }],
    }),
    req,
  );
  assert(!free.ok && free.stage === 'schema');
  const unknown = checkPlannerOutput(
    JSON.stringify({
      ...SPEC,
      collections: [
        { ...SPEC.collections[0], open_slot: 'e700', list_id: 'e701' },
      ],
    }),
    req,
  );
  assertEquals(unknown, { ok: false, stage: 'unknown_id', count: 2 });
  // A v1 answer: an old layout, and collections without card, media and lead.
  const v1 = checkPlannerOutput(
    JSON.stringify({
      ...SPEC,
      sections: [{ ...SPEC.sections[0], layout: 'compact_row' }],
    }),
    req,
  );
  assertEquals(v1, {
    ok: false,
    stage: 'schema',
    issue: 'invalid_value@sections.layout',
  });
  const { card: _card, ...noCard } = SPEC.collections[0]!;
  const bare = checkPlannerOutput(
    JSON.stringify({ ...SPEC, collections: [noCard] }),
    req,
  );
  assertEquals(bare, {
    ok: false,
    stage: 'schema',
    issue: 'invalid_value@collections.card',
  });
});

Deno.test('checkPlannerOutput strips keys outside the spec', () => {
  const result = checkPlannerOutput(
    JSON.stringify({
      ...SPEC,
      note: 'Inbox for Caden',
      sections: [{ ...SPEC.sections[0], title: 'x' }],
    }),
    composeRequest(),
  );
  assert(result.ok);
  assertEquals('note' in result.spec, false);
  assertEquals('title' in (result.spec.sections[0] as object), false);
});
