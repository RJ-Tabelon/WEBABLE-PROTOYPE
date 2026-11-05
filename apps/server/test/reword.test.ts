// Round 9: the reader import and paragraph rewrites, without network (no keys: both fail closed).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReaderProfile } from '@webable/core';
import { createApp } from '../src/app';
import { CONDITION_RE, cleanPoints, quotedFrom } from '../src/routes/reader';
import { tidyOut } from '../src/routes/reword';
import { rewordInput } from '../src/prompts';

const ANSWER =
  'You are very comfortable with graphic design and photography. Taxes and paperwork in the US are new to you. You often reply "shorter please" when my answer is long. Short numbered steps work best for you.';

const READER: ReaderProfile = {
  v: 'reader.1', createdAt: '2026-10-25T00:00:00Z', source: 'ChatGPT', headline: 'Short steps.', level: 'plain', length: 'shorter',
  shape: 'steps', answerFirst: false,
  points: [{ id: 'r1', kind: 'new_to', says: 'US tax words are new to you.', evidence: 'Taxes and paperwork in the US are new to you.', support: 0.97, on: true }],
};
const PAGE = { title: 'Refunds', host: 'www.irs.gov', purpose: null };

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

const post = (path: string, body: unknown) =>
  createApp().request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Host: '127.0.0.1:41741' }, body: JSON.stringify(body) });

describe('reader import: code checks on the model points', () => {
  it('keeps a point only when its quote is in the answer', () => {
    expect(quotedFrom(ANSWER, 'Short numbered steps work best for you.')).toBe(true);
    expect(quotedFrom(ANSWER, '“shorter please”')).toBe(true);
    expect(quotedFrom(ANSWER, 'Taxes and paperwork ... are new to you')).toBe(true);
    expect(quotedFrom(ANSWER, 'You like long, detailed answers.')).toBe(false);
    expect(quotedFrom(ANSWER, 'ok')).toBe(false);
  });
  it('never keeps a point that names a condition, and numbers the rest r1..', () => {
    expect(CONDITION_RE.test('You have dyslexia, so short lines help.')).toBe(true);
    expect(CONDITION_RE.test('You like conditions spelled out.')).toBe(false);
    const pts = cleanPoints(ANSWER, [
      { kind: 'knows', says: 'You know graphic design and photography well.', evidence: 'very comfortable with graphic design and photography' },
      { kind: 'language', says: 'Your ADHD makes long paragraphs hard.', evidence: 'Short numbered steps work best for you.' },
      { kind: 'format', says: 'You like short numbered steps.', evidence: 'Short numbered steps work best for you.' },
      { kind: 'format', says: 'You like short numbered steps.', evidence: 'Short numbered steps work best for you.' },
      { kind: 'length', says: 'You like detail.', evidence: 'you love detail' },
    ]);
    expect(pts.map((p) => [p.id, p.kind])).toEqual([['r1', 'knows'], ['r2', 'format']]);
  });
});

describe('writer output', () => {
  it('tidies list marks and keeps items only for a list', () => {
    expect(tidyOut('list', { lead: '**Do this:**', items: ['1. Sign it.', '- Mail it.'], ordered: true })).toEqual({ lead: 'Do this:', items: ['Sign it.', 'Mail it.'], ordered: true });
    expect(tidyOut('plain', { lead: 'One.', items: ['Two.'], ordered: true })).toEqual({ lead: 'One. Two.', items: [], ordered: false });
  });
  it('the writer sees the reader, the level, the change, the paragraph and the link words', () => {
    const input = rewordInput('BRIEF', 'plain', PAGE, 'list', 'To fix errors, ⟦1⟧.', undefined, { '⟦1⟧': 'file an amended return' });
    expect(input).toMatch(/READER\nBRIEF[\s\S]*LEVEL\nplain[\s\S]*CHANGE\nLIST[\s\S]*PARAGRAPH\nTo fix errors[\s\S]*⟦1⟧ shows: file an amended return/);
  });
});

describe('routes fail closed without keys', () => {
  it('POST /v1/reader: 503 with a plain message; a short answer is a 400', async () => {
    const r = await post('/v1/reader', { req: { text: ANSWER, source: 'ChatGPT' } });
    expect(r.status).toBe(503);
    expect((await r.json()).message).toMatch(/Couldn't read your AI's answer/);
    expect((await post('/v1/reader', { req: { text: 'too short' } })).status).toBe(400);
  });
  it('POST /v1/reword/write: every item ok:false with the reason', async () => {
    const r = await post('/v1/reword/write', { req: { reader: READER, page: PAGE, items: [{ id: 'w1', text: 'Some paragraph text.', links: 0, kind: 'plain' }] } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.results).toEqual([expect.objectContaining({ id: 'w1', ok: false, out: null, reason: 'llm_unavailable' })]);
  });
  it('POST /v1/reword/score: no paragraphs is an empty answer; no Jev key is a 503; bad ids are a 400', async () => {
    const empty = await post('/v1/reword/score', { req: { reader: READER, page: PAGE, paras: [] } });
    expect((await empty.json()).scores).toEqual([]);
    const noJev = await post('/v1/reword/score', { req: { reader: READER, page: PAGE, paras: [{ id: 'w1', text: 'Text.', links: 0 }] } });
    expect(noJev.status).toBe(503);
    expect((await post('/v1/reword/score', { req: { reader: READER, page: PAGE, paras: [{ id: 'p1', text: 'Text.', links: 0 }] } })).status).toBe(400);
  });
  it('GET / lists the new routes', async () => {
    const r = await createApp().request('/', { headers: { Host: '127.0.0.1:41741' } });
    expect((await r.json()).routes).toEqual(expect.arrayContaining(['POST /v1/reader', 'POST /v1/reword/score', 'POST /v1/reword/write']));
  });
});
