import { assertEquals } from 'jsr:@std/assert@1';

import { envFrom } from '../_shared/supabase.ts';
import {
  composeDisabled,
  OPENAI_RESPONSES_URL,
  PLANNER_TIMEOUT_MS,
  plannerConfigFromEnv,
} from './config.ts';

Deno.test(
  'a key makes the planner ready with the fixed endpoint and deadline',
  () => {
    assertEquals(plannerConfigFromEnv(envFrom({ OPENAI_API_KEY: ' sk-x ' })), {
      status: 'ready',
      settings: {
        apiKey: 'sk-x',
        endpoint: OPENAI_RESPONSES_URL,
        timeoutMs: PLANNER_TIMEOUT_MS,
      },
    });
    assertEquals(OPENAI_RESPONSES_URL, 'https://api.openai.com/v1/responses');
    assertEquals(PLANNER_TIMEOUT_MS, 12_000);
  },
);

Deno.test('no key (or a blank one) is unconfigured', () => {
  for (const value of [undefined, '', '   ']) {
    assertEquals(plannerConfigFromEnv(envFrom({ OPENAI_API_KEY: value })), {
      status: 'unconfigured',
      reason: 'no_key',
    });
  }
});

Deno.test(
  'the kill switch reads 1/true/yes/on, anything else leaves it off',
  () => {
    for (const value of ['1', 'true', 'TRUE', ' yes ', 'on'])
      assertEquals(
        composeDisabled(envFrom({ COMPOSE_DISABLED: value })),
        true,
        value,
      );
    for (const value of [undefined, '', '0', 'false', 'off', 'disabled'])
      assertEquals(
        composeDisabled(envFrom({ COMPOSE_DISABLED: value })),
        false,
        String(value),
      );
  },
);
