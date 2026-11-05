// Round 9: the reader brief, Jev's paragraph questions and the code checks on a rewrite. No network.
import { describe, expect, it } from 'vitest';
import {
  GROUND_MIN_SUPPORT, REWORD_PICK, SCORE_SPLIT_AT, buildGroundCall, buildRewriteCheckCall, buildScoreCall, linkWords,
  paraFacts, parseGround, parseRewriteCheck, parseScore, pickChange,
} from '../../src/reword/jev';
import {
  changeShare, conditionsKept, linkWordsRepeated, linksKept, markersIn, outText, quotesKept, rewordNumbersKept,
} from '../../src/reword/check';
import { READER_BRIEF_MAX_CHARS, readerBrief } from '../../src/reword/brief';
import type { JevResponse } from '../../src/jev/api';
import type { ReaderProfile, RewordOut, RewordPara } from '../../src/types';

const out = (lead: string, items: string[] = [], ordered = false): RewordOut => ({ lead, items, ordered });
const resp = (answers: JevResponse['answers']): JevResponse => ({ model: 'jev-1.14.0', answers, usage: { input_tokens: 10, output_tokens: 0 } });

const READER: ReaderProfile = {
  v: 'reader.1', createdAt: '2026-10-25T00:00:00Z', source: 'ChatGPT', headline: 'Short steps, plain words.',
  level: 'plain', length: 'shorter', shape: 'steps', answerFirst: true,
  points: [
    { id: 'r1', kind: 'length', says: 'You like answers that are only a few lines long.', evidence: 'shorter please', support: 0.95, on: true },
    { id: 'r2', kind: 'knows', says: 'You know graphic design and photography well.', evidence: 'kerning', support: 0.98, on: true },
    { id: 'r3', kind: 'new_to', says: 'US tax words are new to you.', evidence: 'first year filing', support: 0.97, on: true },
    { id: 'r4', kind: 'avoid', says: 'You dislike idioms.', evidence: 'ballpark figure', support: 0.9, on: false },
  ],
};

const OFFSET =
  'Your refund may also be reduced to pay a past due debt such as child support, federal agency nontax debt or state income tax. The Bureau of the Fiscal Service (BFS), which issues IRS refunds, will mail a notice about the debt offset. The details of the offset aren’t provided to the IRS.';

describe('reader brief', () => {
  it('says the level, shape and answer-first, lists points that are on, knows first', () => {
    const b = readerBrief(READER);
    expect(b).toContain('Level: plain');
    expect(b).toContain('numbered steps');
    expect(b).toContain('main point or answer first');
    expect(b.indexOf('graphic design')).toBeLessThan(b.indexOf('US tax'));
    expect(b).not.toContain('idioms'); // off
    expect(b.length).toBeLessThanOrEqual(READER_BRIEF_MAX_CHARS);
  });
  it('leaves length out for the writer', () => {
    const b = readerBrief(READER, { forWriter: true });
    expect(b).not.toContain('few lines');
    expect(b).not.toContain('Length:');
  });
  it('stays under the cap with many long points', () => {
    const many = { ...READER, points: Array.from({ length: 10 }, (_, i) => ({ ...READER.points[1]!, id: `r${i + 1}`, says: `You know field number ${i} very well and use its words every day at work.` })) };
    expect(readerBrief(many).length).toBeLessThanOrEqual(READER_BRIEF_MAX_CHARS);
  });
});

describe('paragraph facts and the pick', () => {
  it('counts in code', () => {
    const f = paraFacts(OFFSET);
    expect(f.sentences).toBe(3);
    expect(f.words).toBeGreaterThan(45);
    expect(f.joins).toBeGreaterThanOrEqual(1);
    expect(paraFacts('Use ⟦1⟧ or ⟦2⟧ to check your refund.').links).toBe(2);
    expect(paraFacts('Use ⟦1⟧ or ⟦2⟧ to check your refund.').numbers).toBe(0);
  });
  const how = (h: Partial<Record<'keep' | 'plain' | 'list' | 'shorter' | 'point_first', number>>) => ({ keep: 0, plain: 0, list: 0, shorter: 0, point_first: 0, ...h });
  it('needs high need, a change that beats keep, enough words', () => {
    const f = paraFacts(OFFSET);
    expect(pickChange(0.8, how({ plain: 0.6, keep: 0.2 }), f)).toBe('plain');
    expect(pickChange(REWORD_PICK.needMin - 0.01, how({ plain: 0.9 }), f)).toBeNull();
    expect(pickChange(0.9, how({ plain: 0.3, keep: 0.5 }), f)).toBeNull();
    expect(pickChange(0.9, how({ plain: 0.3, shorter: 0.3, keep: 0.1 }), f)).toBeNull(); // under kindMin
    expect(pickChange(0.9, how({ plain: 0.9 }), paraFacts('A short note that stays as it is.'))).toBeNull();
  });
  it('a list only when there are items to split; else the next best change', () => {
    const one = paraFacts('This review of your claim and the signature on the cancelled check can take a long time to complete for most people who ask.');
    expect(pickChange(0.9, how({ list: 0.6, plain: 0.38 }), one)).toBe('plain');
    expect(pickChange(0.9, how({ list: 0.6, plain: 0.38 }), paraFacts(OFFSET))).toBe('list');
  });
});

describe("Jev's questions", () => {
  const paras: RewordPara[] = Array.from({ length: 26 }, (_, i) => ({ id: `w${i + 1}`, text: `${OFFSET} (${i})`, links: 0 }));
  it('design B: each paragraph inside its own two questions; split past 20', () => {
    const calls = buildScoreCall('brief', { title: 'Refunds', host: 'www.irs.gov', purpose: null }, paras);
    expect(calls).toHaveLength(2);
    expect(Object.keys(calls[0]!.questions)).toHaveLength(26);
    const q = calls[0]!.questions.need_w1!;
    expect(q.type).toBe('noul');
    expect(JSON.stringify(q.instructions)).toContain('past due debt');
    const how = calls[0]!.questions.how_w1!;
    expect(how.type === 'choice' && Object.keys(how.criteria)).toEqual(['keep', 'plain', 'list', 'shorter', 'point_first']);
    expect(JSON.stringify(calls[0]!.state)).not.toContain('past due debt');
    expect(buildScoreCall('b', { title: '', host: '', purpose: null }, paras.slice(0, SCORE_SPLIT_AT))).toHaveLength(1);
  });
  it('link words go inside the question when known', () => {
    const p = { id: 'w1', text: 'To correct any errors, ⟦1⟧ within 3 years of filing your original return.', links: 1, linkTexts: ['file an amended return'] };
    expect(linkWords(p)).toEqual({ '⟦1⟧': 'file an amended return' });
    const [call] = buildScoreCall('b', { title: '', host: '', purpose: null }, [p]);
    expect(JSON.stringify(call!.questions.need_w1)).toContain('file an amended return');
  });
  it('parses scores and fails closed on missing answers', () => {
    const p = paras.slice(0, 2);
    const r = resp({
      need_w1: { type: 'noul', noul: 0.9 },
      how_w1: { type: 'choice', choice: 'plain', probabilities: { keep: 0.1, plain: 0.7, list: 0.1, shorter: 0.05, point_first: 0.05 }, confidence: 0.7 },
    });
    const s = parseScore(p, [r]);
    expect(s[0]).toMatchObject({ id: 'w1', need: 0.9, pick: 'plain' });
    expect(s[1]).toMatchObject({ id: 'w2', need: 0, pick: null });
    expect(s[1]!.how.keep).toBe(1);
  });
  it('ground and rewrite checks: one question per point, two per rewrite; missing answers fail', () => {
    const g = buildGroundCall('the answer', [{ id: 'r1', says: 'You like steps.', evidence: 'steps' }]);
    expect(Object.keys(g.questions)).toEqual(['support_r1']);
    expect(parseGround(['r1', 'r2'], resp({ support_r1: { type: 'noul', noul: 0.8 } }))).toEqual({ r1: 0.8, r2: 0 });
    expect(GROUND_MIN_SUPPORT).toBe(0.5);
    const c = buildRewriteCheckCall([{ id: 'w1', original: 'a', rewrite: 'b' }]);
    expect(Object.keys(c.questions)).toEqual(['dropped_w1', 'added_w1']);
    expect(parseRewriteCheck(['w1'], resp({ dropped_w1: { type: 'noul', noul: 0.1 } }))).toEqual({ w1: { dropped: 0.1, added: 1 } });
  });
});

describe('code checks on a rewrite', () => {
  it('links: each marker exactly once, none new', () => {
    const t = 'Use ⟦1⟧ or call ⟦2⟧.';
    expect(markersIn(t)).toEqual([1, 2]);
    expect(linksKept(t, out('Call ⟦2⟧.', ['Or use ⟦1⟧.']))).toBe(true);
    expect(linksKept(t, out('Use ⟦1⟧.'))).toBe(false);
    expect(linksKept(t, out('Use ⟦1⟧ or ⟦1⟧ or call ⟦2⟧.'))).toBe(false);
    expect(linksKept(t, out('Use ⟦1⟧, ⟦2⟧ or ⟦3⟧.'))).toBe(false);
    expect(linksKept('No links here.', out('Still none.'))).toBe(true);
  });
  it('link words written out next to the marker are caught', () => {
    const t = 'If you received a refund you aren’t entitled to, you must promptly ⟦1⟧.';
    expect(linkWordsRepeated(t, out('You must promptly ⟦1⟧ if you got a refund you are not entitled to.'), ['return the erroneous refund'])).toBe(false);
    expect(linkWordsRepeated(t, out('You must promptly return the erroneous refund ⟦1⟧ if you got a refund you are not entitled to.'), ['return the erroneous refund'])).toBe(true);
  });
  it('numbers: kept, and a marker never counts as a number', () => {
    const t = 'This review can take up to 6 weeks. See ⟦2⟧.';
    expect(rewordNumbersKept(t, out('It can take up to 6 weeks. See ⟦2⟧.'))).toBe(true);
    expect(rewordNumbersKept(t, out('It can take up to 8 weeks. See ⟦2⟧.'))).toBe(false);
    expect(rewordNumbersKept('Wait 2 days.', out('Wait a few days. ⟦2⟧'))).toBe(false);
  });
  it('conditions: strict words never fewer; a list may carry if/or in its items', () => {
    const t = 'If you filed on paper or you mailed a check, allow 4 weeks unless we ask you for more information.';
    expect(conditionsKept(t, out('How long to wait:', ['Paper return: allow 4 weeks.', 'Mailed check: allow 4 weeks.', 'Unless we ask you for more information.']), 'list')).toBe(true);
    expect(conditionsKept(t, out('Allow 4 weeks:', ['Paper return.', 'Mailed check.']), 'list')).toBe(false); // unless dropped
    expect(conditionsKept('Do not send cash.', out('Send cash.'), 'plain')).toBe(false);
    expect(conditionsKept('You can only do this once.', out('You can do this once.'), 'shorter')).toBe(false);
    expect(conditionsKept('You will never get a call.', out('You will not get a call.'), 'plain')).toBe(true); // same group
    expect(conditionsKept('If you filed early or late, call.', out('Call if you filed early. Call if you filed late.'), 'plain')).toBe(true);
  });
  it('quotes: never changed; dropped quote marks must not keep the speaker’s "we"', () => {
    const t = '“Gen Z values the peer relationship most,” Butterick said.';
    expect(quotesKept(t, out('“Gen Z values the peer relationship most,” Butterick said.'))).toBe(true);
    expect(quotesKept(t, out('“Gen Z cares about friends most,” Butterick said.'))).toBe(false);
    expect(quotesKept(t, out('Butterick said that Gen Z values the peer relationship most.'))).toBe(true);
    expect(quotesKept('“We are very quick to judge,” she said.', out('We are very quick to judge, she said.'))).toBe(false);
  });
  it('change share: a near copy is low, a rewrite is high', () => {
    expect(changeShare(OFFSET, out(OFFSET))).toBe(0);
    expect(changeShare(OFFSET, out(OFFSET.replace('issues', 'sends')))).toBeLessThan(0.1);
    expect(changeShare(OFFSET, out('Your refund may be made smaller to pay a debt you owe. BFS sends refunds and will write to you about it. The IRS does not get the details.'))).toBeGreaterThan(0.4);
    expect(outText(out('Lead', ['a', 'b']))).toBe('Lead\na\nb');
  });
});
