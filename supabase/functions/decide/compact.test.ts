// compact() lives in the bundle (_shared/core-entry.ts); these tests pin its
// contract from the function's side: probabilities only, wire-valid or null.

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';

import {
  buildQuestions,
  compact,
  decideResponseSchema,
  mockJevAnswer,
  JEV_PINNED_MODEL,
  type JevResponse,
} from '../_shared/core.bundle.js';
import { decideRequest } from './fixtures.ts';

function answerFor() {
  const built = buildQuestions(decideRequest());
  const jev = mockJevAnswer({
    model: JEV_PINNED_MODEL,
    state: built.state,
    questions: built.questions,
  });
  return { built, jev };
}

Deno.test('drops confidence, legend and the choice echo', () => {
  const { built, jev } = answerFor();
  assert(JSON.stringify(jev).includes('confidence'), 'the raw answer has them');
  const out = compact(built, jev, { jev: 100, edge: 110 });
  assert(out);
  const text = JSON.stringify(out);
  for (const key of ['confidence', 'legend', '"choice"', 'answers', 'usage']) {
    assertFalse(text.includes(key), key);
  }
  assert(decideResponseSchema.safeParse(out).success);
  assertEquals(out.ms, { jev: 100, edge: 110 });
  assertEquals(out.inputTokens, jev.usage.input_tokens);
});

Deno.test('strips fields Jev might add in the future', () => {
  const { built, jev } = answerFor();
  const extended = {
    ...jev,
    answers: Object.fromEntries(
      Object.entries(jev.answers).map(([k, a]) => [
        k,
        { ...a, rationale: 'because' },
      ]),
    ),
    trace: { spans: [] },
  } as unknown as JevResponse;
  const text = JSON.stringify(compact(built, extended, { jev: 1, edge: 2 }));
  assertFalse(text.includes('rationale'));
  assertFalse(text.includes('trace'));
});

Deno.test(
  'returns null rather than an answer the wire schema would reject',
  () => {
    const { jev } = answerFor();
    const role = jev.answers.role_r1;
    const task = jev.answers.task_r1;
    assert(role && task);
    // Region ids must look like r<n>; a malformed id cannot reach the client.
    const out = compact(
      {
        questions: {
          role_bad: { type: 'choice', criteria: {} },
          task_bad: { type: 'noul' },
        },
      },
      { ...jev, answers: { role_bad: role, task_bad: task } },
      { jev: 1, edge: 1 },
    );
    assertEquals(out, null);
  },
);
