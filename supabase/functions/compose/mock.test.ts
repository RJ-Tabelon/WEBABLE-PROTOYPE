// The mock planner must behave like a well-behaved model: valid specs over
// the outline's own ids, deterministic, and the Responses API's shape.

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';

import { pageSpecSchema, wireOutline } from '../_shared/core.bundle.js';
import { OPENAI_RESPONSES_URL } from './config.ts';
import { composeRequest, largeRequest, NEWS, YOUTUBE } from './fixtures.ts';
import {
  createMockPlannerFetch,
  mockPlannerSpec,
  parseOutline,
} from './mock.ts';
import { checkPlannerOutput, specIds } from './validate.ts';

Deno.test('parseOutline rebuilds the tree, exemplars included', () => {
  const o = parseOutline(wireOutline(YOUTUBE));
  assertEquals(o.vh, 800);
  assertEquals(o.nodes.length, YOUTUBE.nodes.length);
  for (const n of YOUTUBE.nodes) {
    const parsed = o.nodes.find((x) => x.id === n.id);
    assert(parsed, n.id);
    assertEquals(parsed.parent, n.p, n.id);
  }
  const list = o.nodes.find((n) => n.id === 'e51')!;
  assert(list.list);
  const thumb = o.nodes.find((n) => n.id === 'e53')!;
  assert(thumb.slot && thumb.control);
  assertEquals(thumb.pat, ['duration']);
  assertEquals(thumb.box, [128, 568, 344, 208]);
  const search = o.nodes.find((n) => n.id === 'e14')!;
  assertEquals(
    [search.tag, search.role, search.input],
    ['input', 'combobox', 'search'],
  );
});

Deno.test(
  'parseOutline ignores label words, even ones that look like syntax',
  () => {
    const o = parseOutline(
      'PAGE viewport=1280x800 doc=1280x800\ne1 body [0,0,1280,800]\n  e2 a* "slot LIST e9 pat:price" [0,0,8,8]',
    );
    const a = o.nodes[1]!;
    assertFalse(a.slot);
    assertFalse(a.list);
    assertEquals(a.pat, []);
  },
);

Deno.test(
  'mock specs are valid, deterministic and use only outline ids',
  () => {
    for (const sk of [YOUTUBE, NEWS, largeRequest(20_000).skeleton]) {
      const outline = wireOutline(sk);
      const spec = mockPlannerSpec(outline);
      assertEquals(spec, mockPlannerSpec(outline));
      assert(pageSpecSchema.safeParse(spec).success);
      assertEquals(
        spec.sections.filter((s) => s.importance === 'primary').length,
        1,
      );
      const inOutline = new Set(parseOutline(outline).nodes.map((n) => n.id));
      for (const id of specIds(spec)) assert(inOutline.has(id), id);
      assert(checkPlannerOutput(JSON.stringify(spec), composeRequest(sk)).ok);
    }
  },
);

Deno.test('the mock reads a video grid like a planner would', () => {
  const spec = mockPlannerSpec(wireOutline(YOUTUBE));
  assertEquals(
    [spec.page_type, spec.primary_task],
    ['listing_grid', 'browse_and_choose'],
  );
  const main = spec.sections.find((s) => s.importance === 'primary')!;
  assertEquals(
    [main.kind, main.node_ids, main.heading_ref],
    ['main_list', ['e23'], 'e30'],
  );
  assertEquals(main.layout, 'card_grid');
  const grid = spec.collections.find((c) => c.list_id === 'e51')!;
  assertEquals(grid.item_kind, 'video');
  assertEquals(
    [grid.card, grid.media, grid.lead],
    ['media', 'landscape', 'none'],
  );
  assertEquals(grid.open_slot, 'e56');
  assertEquals(grid.fields.find((f) => f.slot_id === 'e53')?.role, 'thumbnail');
  assertEquals(grid.fields.find((f) => f.slot_id === 'e56')?.role, 'title');
  assertEquals(
    spec.collections.find((c) => c.list_id === 'e21')?.item_kind,
    'nav_link',
  );
});

Deno.test('the mock folds ads and keeps the article primary', () => {
  const spec = mockPlannerSpec(wireOutline(NEWS));
  assertEquals(spec.page_type, 'article');
  assertEquals(
    spec.sections.find((s) => s.node_ids[0] === 'e2')?.importance,
    'fold',
  );
  assertEquals(
    spec.sections.find((s) => s.importance === 'primary')?.kind,
    'article',
  );
});

Deno.test('the mock fetch answers in the Responses API shape', async () => {
  const fetchMock = createMockPlannerFetch();
  const res = await fetchMock(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: { authorization: 'Bearer k', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-6-sol',
      input: wireOutline(YOUTUBE),
      text: { format: { type: 'json_schema', strict: true } },
      service_tier: 'priority',
    }),
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.object, 'response');
  assertEquals(body.status, 'completed');
  assertEquals(body.service_tier, 'fast');
  assert(body.usage.input_tokens_details.cached_tokens > 0);
  assertEquals(body.output[0].type, 'message');
  assertEquals(body.output[0].content[0].type, 'output_text');
  assert(
    pageSpecSchema.safeParse(JSON.parse(body.output[0].content[0].text))
      .success,
  );
});

Deno.test('the mock fetch enforces the request contract', async () => {
  const fetchMock = createMockPlannerFetch({
    unavailableModels: ['gpt-6-sol'],
  });
  const send = (init: RequestInit, url = OPENAI_RESPONSES_URL) =>
    fetchMock(url, { method: 'POST', ...init });
  const good = {
    model: 'gpt-6-sol',
    input: 'PAGE viewport=1x1 doc=1x1\ne1 body [0,0,8,8]',
    text: { format: { type: 'json_schema', strict: true } },
  };
  assertEquals((await send({ body: JSON.stringify(good) })).status, 401);
  const auth = { authorization: 'Bearer k' };
  assertEquals((await send({ headers: auth, body: '{' })).status, 400);
  assertEquals(
    (await send({ headers: auth, body: JSON.stringify({ ...good, text: {} }) }))
      .status,
    400,
  );
  const missing = await send({ headers: auth, body: JSON.stringify(good) });
  assertEquals(missing.status, 404);
  assertEquals((await missing.json()).error.code, 'model_not_found');
  assertEquals(
    (
      await send(
        { headers: auth, body: JSON.stringify(good) },
        'https://api.openai.com/v1/chat/completions',
      )
    ).status,
    404,
  );
});
