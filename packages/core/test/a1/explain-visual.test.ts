import { describe, expect, it } from 'vitest';
import { conditionWordsKept, numbersKept, splitIntoSentences } from '../../src/jev/explain-check';
import { VisualInputError, buildVisualCall, parseVisual } from '../../src/jev/visual';
import { JEV_IMAGES_HEADER, emptyJevMetrics } from '../../src/jev/api';
import { box, noul, response } from './fixtures';

const FINE_PRINT =
  'By selecting Confirm refill, you authorize the pharmacy to bill your insurance on file. Your copay may differ from the estimate shown. Refills of controlled substances may require pharmacist review and can be delayed up to 1 business day. Orders placed after 6 PM are processed the next business day. Prices shown are estimates and do not include applicable taxes. Generic substitution may occur unless your prescriber indicates otherwise.';

describe('explain check', () => {
  it('splits the fine print into its 6 sentences', () => {
    const s = splitIntoSentences(FINE_PRINT);
    expect(s).toHaveLength(6);
    expect(s[5]).toBe('Generic substitution may occur unless your prescriber indicates otherwise.');
    expect(splitIntoSentences('See e.g. the terms. Then pay $4.50 now.')).toHaveLength(2);
  });

  it('numbersKept: every number and placeholder survives', () => {
    expect(numbersKept('Delayed up to 1 business day after 6 PM.', 'It can take up to 1 business day. After 6 PM it waits.')).toBe(true);
    expect(numbersKept('Delayed up to 1 business day.', 'It can take up to 3 business days.')).toBe(false);
    expect(numbersKept('Up to 1,000 points.', 'You can get up to 1000 points.')).toBe(true);
    expect(numbersKept('Ready at 4:30 PM.', 'It will be ready at 4:30 PM.')).toBe(true);
    expect(numbersKept('Pay within thirty days.', 'Pay within 30 days.')).toBe(true);
    expect(numbersKept('Your copay is [amount] for [medication].', 'You pay [amount].')).toBe(false);
  });

  it('conditionWordsKept: conditions never get fewer', () => {
    expect(conditionWordsKept('Refunds are given only if the box is unopened.', 'You get a refund if the box is unopened.')).toBe(false);
    expect(conditionWordsKept('Refunds are given only if the box is unopened.', 'You get money back only if the box is still closed.')).toBe(true);
    expect(conditionWordsKept('Your copay may differ.', 'What you pay might be different.')).toBe(true);
    expect(conditionWordsKept('Prices do not include taxes.', "Prices don't include taxes.")).toBe(true);
    expect(conditionWordsKept('Generic substitution may occur unless your prescriber indicates otherwise.', 'You may get a generic version.')).toBe(false);
    expect(conditionWordsKept('You must sign within 30 days.', 'You have to sign within 30 days.')).toBe(true);
    expect(conditionWordsKept('Bring at least 2 forms of ID.', 'Bring 2 forms of ID.')).toBe(false);
  });
});

/** A base64 PNG whose IHDR says width x height (enough for the size check; the API is never called here). */
function png(width: number, height: number): string {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b.toString('base64');
}

describe('visual verify', () => {
  const req = { before: png(1280, 800), after: png(1280, 800), controls: ['Confirm refill', 'In-store pickup'], help: ['Call your pharmacist'], mainLabel: 'Confirm refill' };

  it('builds assets in the documented format with fresh refs used in state', () => {
    const call = buildVisualCall(req);
    const st = call.state as { before: string; after: string };
    expect(st.before).not.toBe(st.after);
    expect(Object.keys(call.assets).sort()).toEqual([st.after, st.before].sort());
    expect(call.assets[st.before]).toEqual({ type: 'image', format: 'png', data_base64: req.before });
    expect(Object.keys(call.questions)).toEqual(['keeps_controls', 'keeps_help', 'clipped', 'faint', 'main_visible', 'main_box']);
    expect(call.questions.main_box!.type).toBe('box');
    expect(String(call.questions.keeps_controls!.instructions)).toBe(
      'Does `after` still show every form control that `before` shows: "Confirm refill" and "In-store pickup"?',
    );
    expect(JEV_IMAGES_HEADER).toEqual({ 'TypeSafe-Danger-Zone-Images': 'true' });
    const again = buildVisualCall(req);
    expect((again.state as { before: string }).before).not.toBe(st.before);
  });

  it('accepts data URLs and rejects images outside 280-1568 px', () => {
    expect(() => buildVisualCall({ ...req, before: `data:image/png;base64,${png(1280, 800)}` })).not.toThrow();
    expect(() => buildVisualCall({ ...req, after: png(200, 800) })).toThrow(VisualInputError);
    expect(() => buildVisualCall({ ...req, after: png(2560, 1600) })).toThrow(VisualInputError);
    expect(() => buildVisualCall({ ...req, after: 'bm90IGFuIGltYWdlIGF0IGFsbCwganVzdCB0ZXh0Lg==' })).toThrow(VisualInputError);
  });

  it('skips list questions when there is nothing to list', () => {
    const call = buildVisualCall({ ...req, controls: [], help: [], mainLabel: null });
    expect(Object.keys(call.questions)).toEqual(['clipped', 'faint']);
  });

  it('rolls back on clipped/faint >= 0.70 or keeps <= 0.30, and passes the clean case', () => {
    const clean = parseVisual(response({ keeps_controls: noul(0.95), keeps_help: noul(0.93), clipped: noul(0.04), faint: noul(0.03), main_visible: noul(1), main_box: box(0.55, 0.63, 0.2, 0.8) }), emptyJevMetrics());
    expect(clean.rollback).toBe(false);
    expect(clean.mainBox).toEqual({ top: 0.55, bottom: 0.63, left: 0.2, right: 0.8 });
    const broken = parseVisual(response({ keeps_controls: noul(0.02), keeps_help: noul(0.01), clipped: noul(1), faint: noul(0.97) }), emptyJevMetrics());
    expect(broken.rollback).toBe(true);
    expect(parseVisual(response({ clipped: noul(0.7) }), emptyJevMetrics()).rollback).toBe(true);
    expect(parseVisual(response({ keeps_help: noul(0.3) }), emptyJevMetrics()).rollback).toBe(true);
    expect(parseVisual(response({ keeps_help: noul(0.31), clipped: noul(0.69) }), emptyJevMetrics()).rollback).toBe(false);
    const none = parseVisual(response({}), emptyJevMetrics());
    expect(none).toMatchObject({ rollback: false, mainVisible: null, mainBox: null });
  });
});
