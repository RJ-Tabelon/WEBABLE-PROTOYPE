// Round 10: the WebAble page as components. Tidy, validate, flatten, the code checks and Jev's check. No network.
import { describe, expect, it } from 'vitest';
import { flatten, groupText, keepPageBold, layoutText, tidyBlocks, validateBlocks } from '../../src/compose/blocks';
import { checkConditions, checkLinks, checkQuotes, composeChecks, newNumbers, plainIsBetter } from '../../src/compose/check';
import {
  COMPOSE_CHECK, GENERAL_READER_BRIEF, betterId, buildComposeCheckCall, composeAddedId, composeBrief, composeDroppedId, composeLeaning,
  composeLinkWords, parseComposeCheck, verdictFailure,
} from '../../src/compose/jev';
import type { JevResponse } from '../../src/jev/api';
import type { ComposeBlock, ComposeGroupIn, ReaderProfile } from '../../src/types';

const resp = (answers: JevResponse['answers']): JevResponse => ({ model: 'jev-1.14.0', answers, usage: { input_tokens: 10, output_tokens: 0 } });

const GROUP: ComposeGroupIn = {
  id: 'gabc123',
  heading: 'When to expect your refund',
  units: [
    { id: 'u1', kind: 'para', text: 'The typical time to receive your refund depends on how you filed your taxes:' },
    { id: 'u2', kind: 'list', text: '• E-filed return - 3 weeks from the date you e-filed\n• Mailed return - 6 or more weeks from the date we received your mailed return' },
    { id: 'u3', kind: 'para', text: '⟦1⟧ can happen when a tax return needs corrections or further review. Do not call us before then.' },
  ],
  linkTexts: ['Delays'],
};

const GOOD: ComposeBlock[] = [
  { k: 'prose', src: ['u1'], text: 'How long your refund takes depends on how you filed your taxes.' },
  {
    k: 'keyfacts', src: ['u2'], title: null, icon: 'clock',
    rows: [
      { label: 'E-filed return', value: '3 weeks from the date you e-filed', icon: null },
      { label: 'Mailed return', value: '6 or more weeks from the date we received your mailed return', icon: null },
    ],
  },
  { k: 'callout', src: ['u3'], tone: 'important', title: 'Delays happen', text: '⟦1⟧ can happen when a tax return needs corrections or further review. Do not call us before then.', icon: null },
];

const READER: ReaderProfile = {
  v: 'reader.1', createdAt: '2026-10-25T00:00:00Z', source: 'ChatGPT', headline: 'Short steps.', level: 'plain', length: 'shorter',
  shape: 'steps', answerFirst: true,
  points: [{ id: 'r1', kind: 'new_to', says: 'US tax words are new to you.', evidence: 'Taxes are new to you.', support: 0.97, on: true }],
};

describe('tidy', () => {
  it('cleans markdown, empties optional text to null, gives warnings the warning icon and puts blocks in page order', () => {
    const raw = [
      { k: 'callout', src: ['u3'], tone: 'warning', title: '**Delays**', text: '⟦1⟧ can happen.', icon: 'info' },
      { k: 'steps', src: ['u1'], title: '', lead: '', steps: [{ title: '1. File', detail: '' }, { title: '- Wait', detail: 'Three weeks.' }] },
      { k: 'nonsense', src: ['u2'] },
    ];
    const t = tidyBlocks(GROUP, raw);
    expect(t.map((b) => b.k)).toEqual(['steps', 'callout']);
    expect(t[0]).toMatchObject({ title: null, lead: null, steps: [{ title: 'File', detail: null }, { title: 'Wait', detail: 'Three weeks.' }] });
    expect(t[1]).toMatchObject({ title: 'Delays', icon: 'triangle-alert' });
  });
  it('keeps a key callout first only when the model put it first', () => {
    const key = { k: 'callout', src: ['u1'], tone: 'key', title: 'Main point', text: 'It depends on how you filed.', icon: null };
    expect(tidyBlocks(GROUP, [key, ...GOOD]).map((b) => b.k)[0]).toBe('callout');
    expect(tidyBlocks(GROUP, [...GOOD.slice(0, 1), key, ...GOOD.slice(1)]).at(-1)).toMatchObject({ tone: 'key' });
  });
  it('prose with empty text keeps the page words of paragraph units; a forgotten paragraph is added as the page has it', () => {
    const t = tidyBlocks(GROUP, [{ k: 'prose', src: ['u1'], text: '' }, GOOD[1]]);
    expect(t[0]).toMatchObject({ k: 'prose', text: GROUP.units[0]!.text });
    expect(t.at(-1)).toMatchObject({ k: 'prose', src: ['u3'], text: GROUP.units[2]!.text });
    expect(validateBlocks(GROUP, t).covered).toBe(true);
    // A list cannot be kept as page words: the text stays empty and validation says why.
    const list = tidyBlocks(GROUP, [{ k: 'prose', src: ['u2'], text: '' }]);
    expect(validateBlocks(GROUP, list).problems.join(' ')).toMatch(/only paragraphs can be kept/);
  });
  it('joins prose next to prose (one block per paragraph would pass the block limit)', () => {
    const g: ComposeGroupIn = { ...GROUP, units: Array.from({ length: 9 }, (_, i) => ({ id: `u${i + 1}`, kind: 'para' as const, text: `Paragraph ${i + 1}.` })) };
    const t = tidyBlocks(g, g.units.map((u) => ({ k: 'prose', src: [u.id], text: '' })));
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ k: 'prose', src: g.units.map((u) => u.id), text: g.units.map((u) => u.text).join('\n\n') });
    expect(validateBlocks(g, t).ok).toBe(true);
  });
  it('joins a split list and turns a single step into prose', () => {
    const t = tidyBlocks(GROUP, [
      { k: 'points', src: ['u2'], title: 'Times', items: [{ icon: null, title: 'E-filed', text: '3 weeks from the date you e-filed' }] },
      { k: 'points', src: ['u2'], title: null, items: [{ icon: null, title: 'Mailed', text: '6 or more weeks from the date we received your mailed return' }] },
      { k: 'steps', src: ['u3'], title: null, lead: null, steps: [{ title: 'Wait', detail: 'Do not call us before then.' }] },
    ]);
    expect(t.find((b) => b.k === 'points')).toMatchObject({ items: [{ title: 'E-filed' }, { title: 'Mailed' }] });
    expect(t.find((b) => b.src.includes('u3'))).toMatchObject({ k: 'prose', text: 'Wait. Do not call us before then.' });
  });
});

describe('validate', () => {
  it('passes a good layout', () => {
    expect(validateBlocks(GROUP, GOOD)).toEqual({ ok: true, covered: true, uncovered: [], problems: [] });
  });
  it('a key callout does not cover a unit; unknown src ids, bad icons, compare cells and two keys are named', () => {
    const blocks: ComposeBlock[] = [
      GOOD[0]!, GOOD[1]!,
      { k: 'callout', src: ['u3'], tone: 'key', title: 'Main point', text: 'It depends.', icon: null },
      { k: 'callout', src: ['u9'], tone: 'key', title: 'Again', text: 'Twice.', icon: 'rocket' as never },
      { k: 'compare', src: ['u2'], title: null, columns: ['Return', 'Time'], rows: [{ label: 'E-filed', cells: ['3 weeks', 'x'] }, { label: 'Mailed', cells: ['6 weeks'] }] },
    ];
    const v = validateBlocks(GROUP, blocks);
    expect(v.covered).toBe(false);
    expect(v.uncovered).toEqual(['u3']);
    const p = v.problems.join(' ');
    expect(p).toMatch(/unit u9, which is not in this group/);
    expect(p).toMatch(/icon that is not in the list/);
    expect(p).toMatch(/row 1 has 2 cells; it needs 1/);
    expect(p).toMatch(/at most one main-point/);
  });
  it('a key callout may not hold link markers; titles stay short', () => {
    const v = validateBlocks(GROUP, [
      ...GOOD,
      { k: 'callout', src: ['u3'], tone: 'key', title: 'This title is far too long to be a title at all', text: 'See ⟦1⟧.', icon: null },
    ]);
    expect(v.problems.join(' ')).toMatch(/may not hold link markers/);
    expect(v.problems.join(' ')).toMatch(/title is longer than 8 words/);
  });
});

describe('text', () => {
  it('flatten labels each block and numbers steps; layoutText has no labels or step numbers', () => {
    const steps: ComposeBlock = { k: 'steps', src: ['u1'], title: 'Check it', lead: null, steps: [{ title: 'Sign in', detail: null }, { title: 'Look', detail: 'At the status.' }] };
    const flat = flatten([steps, GOOD[1]!, GOOD[2]!]);
    expect(flat).toContain('[Steps: Check it]\n1. Sign in\n2. Look At the status.');
    expect(flat).toContain('[Key facts]\n- E-filed return: 3 weeks from the date you e-filed');
    expect(flat).toContain('[Important: Delays happen]');
    expect(layoutText([steps])).toBe('Check it\nSign in\nLook\nAt the status.');
  });
});

describe('code checks', () => {
  it('a good layout passes every check', () => {
    const c = composeChecks(GROUP, GOOD);
    expect(c.failure).toBeNull();
    expect(c).toMatchObject({ covered: true, numbersKept: true, noNewNumbers: true, linksKept: true, quotesKept: true, conditionsKept: true });
  });
  it('a dropped number fails, and the note names it', () => {
    const blocks = structuredClone(GOOD);
    (blocks[1] as Extract<ComposeBlock, { k: 'keyfacts' }>).rows[1]!.value = 'several weeks from the date we received your mailed return';
    const c = composeChecks(GROUP, blocks);
    expect(c.failure).toBe('numbers');
    expect(c.note).toMatch(/missing: 6/);
  });
  it('an invented number fails (digits or a number word), the page\'s own numbers do not', () => {
    expect(newNumbers(groupText(GROUP), 'Most refunds come in 21 days.')).toEqual(['21']);
    expect(newNumbers(groupText(GROUP), 'There are two ways to file.')).toEqual(['2']);
    expect(newNumbers('Call 800-829-1954 by 4:30 p.m.', 'Call 800-829-1954 by 4:30')).toEqual([]);
    expect(newNumbers('Your first year filing.', 'Your 1st year filing.')).toEqual([]);
    const blocks = structuredClone(GOOD);
    blocks.push({ k: 'callout', src: ['u1'], tone: 'key', title: 'Main point', text: 'Most refunds take 3 weeks, at most 10.', icon: null });
    expect(composeChecks(GROUP, blocks).failure).toBe('new_numbers');
  });
  it('each link marker exactly once, never in the key callout, never with its words written beside it', () => {
    const twice = structuredClone(GOOD);
    (twice[0] as Extract<ComposeBlock, { k: 'prose' }>).text += ' See ⟦1⟧.';
    expect(checkLinks(GROUP, twice)).toMatchObject({ ok: false, repeated: [1] });
    const gone = structuredClone(GOOD);
    (gone[2] as Extract<ComposeBlock, { k: 'callout' }>).text = 'Delays can happen when a tax return needs corrections or further review. Do not call us before then.';
    expect(checkLinks(GROUP, gone)).toMatchObject({ ok: false, missing: [1] });
    expect(composeChecks(GROUP, gone).note).toMatch(/missing ⟦1⟧/);
    const group = { ...GROUP, linkTexts: ['Refund delays'] };
    const said = structuredClone(GOOD);
    (said[2] as Extract<ComposeBlock, { k: 'callout' }>).text = 'Refund delays ⟦1⟧ can happen when a tax return needs corrections or further review. Do not call us before then.';
    expect(checkLinks(group, said).wordsRepeated).toBe(true);
    // A title or a defined term may name the link's words.
    const titled = structuredClone(GOOD);
    (titled[2] as Extract<ComposeBlock, { k: 'callout' }>).title = 'Refund delays';
    expect(checkLinks(group, titled).ok).toBe(true);
  });
  it('quotes are word for word with the speaker named on the page; a link holding a quotation mark still pairs up', () => {
    const g: ComposeGroupIn = {
      id: 'gq', heading: null, linkTexts: ['“The Gen Z Stare'],
      units: [{ id: 'u1', kind: 'para', text: 'Butterick, author of ⟦1⟧: Coaching Gen Z,” said older people should “remember how Gen Z was raised” first.' }],
    };
    const quote = (text: string, who = 'Betsy Butterick'): ComposeBlock[] => [
      { k: 'prose', src: ['u1'], text: 'Butterick, author of ⟦1⟧: Coaching Gen Z,” said older people should remember how Gen Z was raised.' },
      { k: 'quote', src: ['u1'], text, who, role: null },
    ];
    expect(checkQuotes(g, quote('remember how Gen Z was raised'))).toBe(true);
    expect(checkQuotes(g, quote('remember how Gen Z grew up'))).toBe(false);
    expect(checkQuotes(g, quote('remember how Gen Z was raised', 'Jane Smith'))).toBe(false);
    expect(checkQuotes(g, [{ k: 'prose', src: ['u1'], text: 'Butterick says people should “remember how Gen Z grew up.”' }])).toBe(false);
  });
  it('strict condition words never go; a soft one may move into a list', () => {
    const g: ComposeGroupIn = {
      id: 'gc', heading: null, linkTexts: [],
      units: [{ id: 'u1', kind: 'para', text: 'If you filed on paper, wait 6 weeks. If you e-filed, wait 3 weeks. Do not call before then.' }],
    };
    const steps = (last: string): ComposeBlock[] => [
      { k: 'keyfacts', src: ['u1'], title: null, icon: null, rows: [{ label: 'Paper', value: 'wait 6 weeks', icon: null }, { label: 'E-filed', value: 'wait 3 weeks', icon: null }] },
      { k: 'callout', src: ['u1'], tone: 'important', title: 'Calling', text: last, icon: null },
    ];
    expect(checkConditions(g, steps('Do not call before then.')).ok).toBe(true);
    expect(checkConditions(g, steps('Call after then.'))).toMatchObject({ ok: false, lost: expect.arrayContaining(['not']) });
  });
  it('prose that copies the page is plain_is_better; plainer prose is not', () => {
    const copy: ComposeBlock[] = [{ k: 'prose', src: ['u1', 'u3'], text: `${GROUP.units[0]!.text} ${GROUP.units[2]!.text}` }, GOOD[1]!];
    expect(plainIsBetter(GROUP, copy)).toBe(false); // keyfacts too
    const g1: ComposeGroupIn = { ...GROUP, units: [GROUP.units[0]!] };
    expect(plainIsBetter(g1, [{ k: 'prose', src: ['u1'], text: GROUP.units[0]!.text }])).toBe(true);
    expect(composeChecks(g1, [{ k: 'prose', src: ['u1'], text: '' }].map((b) => tidyBlocks(g1, [b])[0]!)).failure).toBe('plain_is_better');
    expect(plainIsBetter(g1, [{ k: 'prose', src: ['u1'], text: 'How long your refund takes depends on how you sent in your taxes.' }])).toBe(false);
  });
});

describe('Jev check', () => {
  it('one call: better, dropped and added per group, page text and layout inside each question, the reader in state', () => {
    const call = buildComposeCheckCall('BRIEF', { title: 'Refunds', host: 'www.irs.gov', purpose: 'info_guide' }, [
      { id: 'g1', heading: 'H', source: 'S1', layout: 'L1', links: composeLinkWords(GROUP) },
      { id: 'g2', heading: null, source: 'S2', layout: 'L2', links: null },
    ]);
    expect(Object.keys(call.questions)).toEqual([betterId('g1'), composeDroppedId('g1'), composeAddedId('g1'), betterId('g2'), composeDroppedId('g2'), composeAddedId('g2')]);
    expect(call.state).toMatchObject({ reader: 'BRIEF', page: { site: 'www.irs.gov', kind: 'info_guide' } });
    expect(call.questions.better_g1).toMatchObject({ type: 'noul', instructions: { page_text: 'S1', new_layout: 'L1', heading: 'H', link_words: { '⟦1⟧': 'Delays' } } });
    expect(call.questions.dropped_g2).toMatchObject({ instructions: { original: 'S2', new_version: 'L2' } });
  });
  it('parses verdicts and fails closed on missing answers; thresholds pick the reason', () => {
    const v = parseComposeCheck(['g1', 'g2'], resp({ better_g1: { type: 'noul', noul: 0.8 }, dropped_g1: { type: 'noul', noul: 0.1 }, added_g1: { type: 'noul', noul: 0.2 } }));
    expect(v.g1).toEqual({ better: 0.8, dropped: 0.1, added: 0.2 });
    expect(v.g2).toEqual({ better: 0, dropped: 1, added: 1 });
    expect(verdictFailure(v.g1!)).toBeNull();
    expect(verdictFailure(v.g2!)).toBe('dropped');
    expect(verdictFailure({ better: 0.9, dropped: 0.1, added: COMPOSE_CHECK.addedMax })).toBe('added');
    expect(verdictFailure({ better: COMPOSE_CHECK.betterMin - 0.01, dropped: 0.1, added: 0.1 })).toBe('plain_is_better');
  });
  it('a general reader without an AI answer; a newcomer leans to steps and definitions, an expert to prose', () => {
    expect(composeBrief(null)).toBe(GENERAL_READER_BRIEF);
    expect(composeBrief(READER)).toContain('US tax words are new to you.');
    expect(composeLeaning(READER)).toMatch(/steps.*definitions/);
    expect(composeLeaning({ ...READER, level: 'expert', shape: 'prose' })).toMatch(/Expert reader.*prose/);
    expect(composeLeaning(null)).toMatch(/General reader/);
  });
});

describe("the page's own bold", () => {
  const BOLD: ComposeGroupIn = {
    ...GROUP,
    units: [
      { id: 'u1', kind: 'para', text: '**Note:** the typical time to receive your refund depends on how you filed your taxes:' },
      GROUP.units[1]!,
      { id: 'u3', kind: 'para', text: '⟦1⟧ can happen when a tax return needs corrections or further review. **Do not call us before then.**' },
    ],
  };

  it('keeps ** only on words the page shows in bold, and drops bold the model adds', () => {
    const raw = [
      { k: 'prose', src: ['u1'], text: '**Note:** how long your **refund** takes depends on how you **filed** your taxes.' },
      { k: 'keyfacts', src: ['u2'], title: '**When**', icon: null, rows: [{ label: 'E-filed return', value: '**3 weeks** from the date you e-filed', icon: null }, { label: 'Mailed return', value: '6 or more weeks from the date we received your mailed return', icon: null }] },
      { k: 'callout', src: ['u3'], tone: 'important', title: 'Delays happen', text: '⟦1⟧ can happen when a tax return needs corrections or further review. **Do not call us** before then. **Stray', icon: null },
    ];
    const t = tidyBlocks(BOLD, raw);
    expect(t[0]).toMatchObject({ k: 'prose', text: '**Note:** how long your refund takes depends on how you filed your taxes.' });
    expect(t[1]).toMatchObject({ title: 'When', rows: [{ value: '3 weeks from the date you e-filed' }, {}] });
    // Part of a bold run stays bold; an unbalanced mark goes.
    expect(t[2]).toMatchObject({ text: '⟦1⟧ can happen when a tax return needs corrections or further review. **Do not call us** before then. Stray' });
  });

  it('keeps the page bold of prose the server fills with the page words', () => {
    const t = tidyBlocks(BOLD, [{ k: 'prose', src: ['u1'], text: '' }, ...GOOD.slice(1)]);
    expect(t[0]).toMatchObject({ k: 'prose', text: BOLD.units[0]!.text });
  });

  it('reads every check and Jev text without the marks, so the checks are unchanged', () => {
    const blocks: ComposeBlock[] = [
      { k: 'prose', src: ['u1'], text: '**Note:** how long your refund takes depends on how you filed your taxes.' },
      GOOD[1]!,
      { k: 'callout', src: ['u3'], tone: 'important', title: 'Delays happen', text: '⟦1⟧ can happen when a tax return needs corrections or further review. **Do not call us before then.**', icon: null },
    ];
    expect(groupText(BOLD)).not.toContain('**');
    expect(layoutText(blocks)).not.toContain('**');
    expect(flatten(blocks)).not.toContain('**');
    const plainGroup: ComposeGroupIn = { ...BOLD, units: BOLD.units.map((u) => ({ ...u, text: u.text.replace(/\*\*/g, '') })) };
    const plainBlocks = JSON.parse(JSON.stringify(blocks).replace(/\*\*/g, '')) as ComposeBlock[];
    const a = composeChecks(BOLD, blocks);
    expect(a.failure).toBeNull();
    expect(a).toEqual(composeChecks(plainGroup, plainBlocks));
    expect(checkConditions(BOLD, blocks)).toEqual(checkConditions(plainGroup, plainBlocks));
    expect(checkQuotes(BOLD, blocks)).toBe(true);
    expect(plainIsBetter(BOLD, [{ k: 'prose', src: ['u1', 'u3'], text: groupText(BOLD) }])).toBe(true);
  });

  it('compares bold by whole words: a short word inside a bold phrase elsewhere is not bold', () => {
    expect(keepPageBold('call **us** now', ['do not call us before then'])).toBe('call **us** now');
    expect(keepPageBold('**ca** now', ['do not call us before then'])).toBe('ca now');
    expect(keepPageBold('** Note: **then', ['note'])).toBe(' **Note:** then');
  });
});
