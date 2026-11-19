import { assert, assertEquals } from 'jsr:@std/assert@1';

import { decideRequest, evidence } from './fixtures.ts';
import {
  MAX_CONTROL_WORDS,
  MAX_HEADING_WORDS,
  SUPPORTED_CATALOGS,
  validateDecideRequest,
  vocabularyViolations,
} from './validate.ts';

Deno.test('accepts a clean request and returns the parsed value', () => {
  const result = validateDecideRequest(decideRequest());
  assert(result.ok);
  assertEquals(result.request.regions.length, 3);
});

Deno.test('the current catalog is supported', () => {
  assert(SUPPORTED_CATALOGS.has('wa-cat-1.0.0'));
});

Deno.test('non-object bodies are bad input', () => {
  for (const body of [undefined, null, 'x', 1, []]) {
    assertEquals(validateDecideRequest(body), {
      ok: false,
      reason: 'bad_input',
      stage: 'body',
    });
  }
});

Deno.test('another catalog is a mismatch, checked before the schema', () => {
  assertEquals(validateDecideRequest({ catalog: 'wa-cat-0.9.0' }), {
    ok: false,
    reason: 'catalog_mismatch',
  });
});

Deno.test(
  'schema issues are described by code and path, never by value',
  () => {
    const result = validateDecideRequest({
      ...decideRequest(),
      regions: [
        { rid: 'r1', ev: evidence({ zone: 'Welcome back Caden' as never }) },
      ],
    });
    assert(!result.ok && result.reason === 'bad_input');
    assertEquals(result.stage, 'schema');
    assertEquals(result.issue, 'invalid_value@regions.0.ev.zone');
  },
);

Deno.test('unrecognized keys do not echo the key names', () => {
  const result = validateDecideRequest({ ...decideRequest(), 'my secret': 1 });
  assert(!result.ok && result.reason === 'bad_input');
  assertEquals(result.issue, 'unrecognized_keys@(root)');
});

Deno.test(
  'vocabulary violations count unknown words and over-long phrases',
  () => {
    assertEquals(vocabularyViolations(evidence()), 0);
    assertEquals(
      vocabularyViolations(evidence({ class_words: ['zzqx', 'qqzz'] })),
      2,
    );
    assertEquals(
      vocabularyViolations(evidence({ heading_words: 'welcome back caden' })),
      1,
    );
    assertEquals(vocabularyViolations(evidence({ heading_words: '·' })), 0);
    assertEquals(
      vocabularyViolations(evidence({ heading_words: 'most · popular' })),
      0,
    );

    const six = 'the most popular story on site';
    assertEquals(six.split(' ').length, MAX_HEADING_WORDS);
    assertEquals(vocabularyViolations(evidence({ heading_words: six })), 0);
    assertEquals(
      vocabularyViolations(evidence({ heading_words: `${six} ·` })),
      0,
    );
    assertEquals(
      vocabularyViolations(evidence({ heading_words: `${six} now` })),
      1,
    );

    const four = 'sign in to your';
    assertEquals(four.split(' ').length, MAX_CONTROL_WORDS);
    assertEquals(vocabularyViolations(evidence({ control_words: [four] })), 0);
    assertEquals(
      vocabularyViolations(evidence({ control_words: [`${four} account`] })),
      1,
    );
  },
);

Deno.test('vocabulary is re-checked on main candidates too', () => {
  const result = validateDecideRequest(
    decideRequest({
      mainCandidates: [
        { cid: 'c1', ev: evidence({ control_words: ['zzqx'] }) },
        { cid: 'c2', ev: evidence() },
      ],
    }),
  );
  assertEquals(result, {
    ok: false,
    reason: 'bad_input',
    stage: 'vocabulary',
    count: 1,
  });
});
