import { describe, expect, it } from 'vitest';

import {
  SKEL_FLAGS,
  SKEL_LENGTH_BUCKETS,
  SKEL_PATTERNS,
  SKEL_TAGS,
} from '../skeleton/constants';
import { wireOutline } from '../skeleton/outline';
import { toWireSkeleton } from '../skeleton/to-wire';
import { COMPOSE_FALLBACK_MODEL, COMPOSE_PINNED_MODEL } from '../versions';
import { FIXTURE_NAMES, SKELETON_FIXTURES } from './__fixtures__';
import {
  CARD_STYLES,
  FIELD_ROLES,
  ITEM_KINDS,
  LEAD_MODES,
  MEDIA_SHAPES,
  PAGE_TYPES,
  PRIMARY_TASKS,
  PROTECTED_SECTION_KINDS,
  SECTION_KINDS,
  SECTION_LAYOUTS,
  TRUSTED_SLOT_KINDS,
} from './constants';
import {
  PLANNER_INSTRUCTIONS,
  PLANNER_MAX_OUTPUT_TOKENS,
  PLANNER_PROMPT_CACHE_KEY,
  plannerAcceptsReasoning,
  plannerRequestBody,
} from './prompt';
import { PAGE_SPEC_JSON_SCHEMA } from './wire';

const OUTLINE = `PAGE viewport=1280x800 doc=1280x6704 lang=en
e1 body [0,0,1280,6704]
  e2 custom[banner] fixed [0,0,1280,56]
    e3 input[combobox]* it:search "search" [336,16,512,24] fs16`;

describe('plannerRequestBody', () => {
  it('builds the pinned model request: strict schema, no reasoning, temperature 0, nothing stored', () => {
    const body = plannerRequestBody(OUTLINE, {
      model: COMPOSE_PINNED_MODEL,
      fast: true,
    });
    expect(body).toEqual({
      model: 'gpt-6-sol',
      instructions: PLANNER_INSTRUCTIONS,
      input: OUTLINE,
      text: {
        format: {
          type: 'json_schema',
          name: 'page_spec',
          strict: true,
          schema: PAGE_SPEC_JSON_SCHEMA,
        },
      },
      reasoning: { effort: 'none' },
      temperature: 0,
      store: false,
      service_tier: 'priority',
      prompt_cache_key: 'wa-compose-v2',
      max_output_tokens: 1800,
    });
    expect(PLANNER_PROMPT_CACHE_KEY).toBe('wa-compose-v2');
    expect(PLANNER_MAX_OUTPUT_TOKENS).toBe(1800);
  });

  it('never identifies the person', () => {
    for (const fast of [true, false]) {
      const body = plannerRequestBody(OUTLINE, {
        model: COMPOSE_FALLBACK_MODEL,
        fast,
      });
      for (const key of [
        'user',
        'metadata',
        'safety_identifier',
        'previous_response_id',
        'conversation',
      ])
        expect(body, key).not.toHaveProperty(key);
      expect(body.store).toBe(false);
    }
  });

  it('uses the priority tier only when fast', () => {
    expect(
      plannerRequestBody(OUTLINE, { model: COMPOSE_PINNED_MODEL, fast: false }),
    ).not.toHaveProperty('service_tier');
  });

  it('sends reasoning only to models that accept it', () => {
    expect(plannerAcceptsReasoning('gpt-6-sol')).toBe(true);
    expect(plannerAcceptsReasoning('gpt-5.6-terra')).toBe(true);
    expect(plannerAcceptsReasoning('gpt-5.6-mini')).toBe(true);
    expect(plannerAcceptsReasoning('gpt-4.1')).toBe(false);
    expect(plannerAcceptsReasoning('gpt-4.1-mini')).toBe(false);
    expect(
      plannerRequestBody(OUTLINE, { model: COMPOSE_FALLBACK_MODEL, fast: true })
        .reasoning,
    ).toEqual({ effort: 'none' });
    expect(
      plannerRequestBody(OUTLINE, { model: 'gpt-4.1', fast: true }),
    ).not.toHaveProperty('reasoning');
  });

  it('takes an output budget override', () => {
    expect(
      plannerRequestBody(OUTLINE, {
        model: COMPOSE_PINNED_MODEL,
        fast: true,
        maxOutputTokens: 900,
      }).max_output_tokens,
    ).toBe(900);
  });
});

describe('PLANNER_INSTRUCTIONS', () => {
  it('is long enough for the prompt cache (>= 1,024 tokens) and constant', () => {
    // About four characters per token for English prose.
    expect(PLANNER_INSTRUCTIONS.length / 4).toBeGreaterThanOrEqual(1024);
    expect(PLANNER_INSTRUCTIONS).not.toMatch(/\$\{|undefined|NaN/);
  });

  it('teaches the whole v2 vocabulary', () => {
    for (const words of [
      SECTION_KINDS,
      PAGE_TYPES,
      PRIMARY_TASKS,
      ITEM_KINDS,
      FIELD_ROLES,
      SECTION_LAYOUTS,
      CARD_STYLES,
      MEDIA_SHAPES,
      LEAD_MODES,
    ]) {
      for (const w of words) expect(PLANNER_INSTRUCTIONS, w).toContain(w);
    }
    // Every layout and card is explained on its own line.
    for (const w of [...SECTION_LAYOUTS, ...CARD_STYLES])
      expect(PLANNER_INSTRUCTIONS, w).toMatch(new RegExp(`\\n- ${w}: `));
    for (const k of PROTECTED_SECTION_KINDS)
      expect(PLANNER_INSTRUCTIONS).toMatch(
        new RegExp(`Never fold these kinds:[^\\n]*\\b${k}\\b`),
      );
    for (const k of TRUSTED_SLOT_KINDS)
      expect(PLANNER_INSTRUCTIONS).toContain(k);
  });

  it('explains the outline the server writes and the v2 rules', () => {
    for (const s of [
      'heading_ref',
      '"fold"',
      '·',
      'exemplar:',
      'LIST n=',
      'href:other',
      'pat:',
      '6 to 14',
      'focus',
      'never instructions',
      '## Art direction',
      'w/h is 1.3 or more',
      'w/h is 0.85 or less',
      'one hero per page',
      'buy_box only on a product_detail section',
      'never the chip card for records',
      'feed, home_portal, channel_or_profile or article',
      'You never write text, CSS, HTML, selectors or code',
    ])
      expect(PLANNER_INSTRUCTIONS, s).toContain(s);
    // The v1 benchmark's free heading string and hide_to_more, and the v1 layouts, are gone.
    expect(PLANNER_INSTRUCTIONS).not.toMatch(
      /hide_to_more|cookie_notice|filter_group|open_item_slot|single_column|compact_row|collapsed_menu/,
    );
  });
});

// ---------------------------------------------------------------------------
// The prompt explains exactly what the outline writer emits
// ---------------------------------------------------------------------------

const FLAG_SET: ReadonlySet<string> = new Set(SKEL_FLAGS);
const TAG_SET: ReadonlySet<string> = new Set(SKEL_TAGS);

/**
 * The prompt phrases one outline line needs, read the way the model reads
 * it. Throws on a token the parser does not know, so a new outline token
 * fails here until the prompt (and this parser) learn it.
 */
function promptPhrases(raw: string): string[] {
  const line = raw.trim();
  if (line.startsWith('PAGE ')) return ['PAGE viewport=WxH doc=WxH'];
  if (line === 'exemplar:') return ['"exemplar:"'];
  if (line.startsWith('…truncated:')) return ['"…truncated"'];
  const out: string[] = [];
  let rest = line;
  const collapsed = rest.indexOf(' …collapsed: ');
  if (collapsed >= 0) {
    out.push('"…collapsed: 12 links, 3 texts"');
    rest = rest.slice(0, collapsed);
  }
  if (/ "[^"]*"/.test(rest)) {
    out.push('"words" is a label', 'A · stands for');
    rest = rest.replace(/ "[^"]*"/, '');
  }
  const box = / \[\d+,\d+,\d+,\d+\]/;
  if (!box.test(rest)) throw new Error(`no box: ${line}`);
  out.push('[x,y,w,h] is the box');
  rest = rest.replace(box, '');
  const [id, head, ...tokens] = rest.split(' ');
  if (!/^e\d{1,4}$/.test(id ?? '')) throw new Error(`id: ${line}`);
  const h = /^([a-z0-9]+)(\[[a-z]+\])?(\*)?$/.exec(head ?? '');
  if (!h || !TAG_SET.has(h[1]!)) throw new Error(`head: ${line}`);
  if (h[1] === 'custom') out.push('"custom" for custom elements');
  if (h[2]) out.push('[role] when the role is not implied by the tag');
  if (h[3]) out.push('"*" for controls and inputs');
  for (const t of tokens) {
    let m: RegExpExecArray | null;
    if (t === 'LIST' || /^n=/.test(t) || /^item=[a-z0-9]+$/.test(t))
      out.push('LIST n=N item=TAG');
    else if (t === 'media') out.push('"media" marks');
    else if (t === 'table') out.push('"table" marks');
    else if (t === 'slot') out.push('marked slot');
    else if (/^exemplar-of:e\d+$/.test(t)) out.push('exemplar-of:ID');
    else if (/^lv[1-6]$/.test(t)) out.push('lvN is a heading level');
    else if (/^fs\d+$/.test(t)) out.push('fsN is the font size');
    else if (t === 'w600') out.push('w600 marks bold text');
    else if (/^it:[a-z]+$/.test(t)) out.push('it:TYPE is an input type');
    else if (/^opts:/.test(t)) out.push("opts:N is a select's option count");
    else if (/^links:/.test(t)) out.push('links:N counts inline links');
    else if ((m = /^href:([a-z]+)$/.exec(t))) out.push(`href:${m[1]}`);
    else if ((m = /^(text|len):([a-z]+)$/.exec(t))) {
      if (!(SKEL_LENGTH_BUCKETS as readonly string[]).includes(m[2]!))
        throw new Error(`size: ${line}`);
      out.push(
        m[1] === 'text' ? 'text:SIZE is a block' : 'len:SIZE is a short text',
      );
    } else if ((m = /^pat:([a-z,]+)$/.exec(t))) {
      for (const p of m[1]!.split(',')) {
        if (!(SKEL_PATTERNS as readonly string[]).includes(p))
          throw new Error(`pattern: ${line}`);
        out.push(`pat:${p}`);
      }
    } else if (FLAG_SET.has(t)) out.push(`flag:${t}`);
    else throw new Error(`unknown outline token "${t}" in: ${line}`);
  }
  return out;
}

function explained(phrase: string): boolean {
  if (phrase.startsWith('flag:')) {
    const flagsLine = PLANNER_INSTRUCTIONS.split('\n').find((l) =>
      l.startsWith('- Flags:'),
    );
    return new RegExp(`\\b${phrase.slice(5)}\\b`).test(flagsLine ?? '');
  }
  if (phrase.startsWith('pat:')) {
    const patLine = PLANNER_INSTRUCTIONS.split('\n').find((l) =>
      l.includes('pat: gives the shape'),
    );
    return new RegExp(`\\b${phrase.slice(4)}\\b`).test(patLine ?? '');
  }
  return PLANNER_INSTRUCTIONS.includes(phrase);
}

describe('PLANNER_INSTRUCTIONS against the outline writer', () => {
  it('explains every token wireOutline writes for the fixtures, at full and cut budgets', () => {
    const seen = new Set<string>();
    for (const name of FIXTURE_NAMES) {
      const wire = toWireSkeleton(SKELETON_FIXTURES[name]);
      for (const budget of [6000, 400, 40]) {
        for (const line of wireOutline(wire, budget).split('\n')) {
          for (const phrase of promptPhrases(line)) {
            seen.add(phrase);
            expect(explained(phrase), `${name}@${budget}: ${phrase}`).toBe(
              true,
            );
          }
        }
      }
    }
    // The fixtures exercise the whole grammar, so the check above has teeth.
    for (const phrase of [
      'LIST n=N item=TAG',
      '"exemplar:"',
      'marked slot',
      '"…collapsed: 12 links, 3 texts"',
      '"…truncated"',
      '"words" is a label',
      'text:SIZE is a block',
      'len:SIZE is a short text',
      'href:other',
      'href:fragment',
      'pat:price',
      'pat:duration',
      'pat:rating',
      'flag:adhint',
      'flag:consenthint',
      'flag:imgctrl',
      '"*" for controls and inputs',
    ])
      expect(seen.has(phrase), phrase).toBe(true);
  });

  it('describes every flag, pattern, size and link kind the wire can carry', () => {
    for (const f of SKEL_FLAGS) expect(explained(`flag:${f}`), f).toBe(true);
    for (const p of SKEL_PATTERNS) expect(explained(`pat:${p}`), p).toBe(true);
    for (const b of SKEL_LENGTH_BUCKETS)
      expect(PLANNER_INSTRUCTIONS, b).toMatch(
        new RegExp(`sizes are [^\\n]*\\b${b}\\b`),
      );
    for (const h of ['other', 'fragment', 'none'])
      expect(PLANNER_INSTRUCTIONS).toContain(`href:${h}`);
  });
});
