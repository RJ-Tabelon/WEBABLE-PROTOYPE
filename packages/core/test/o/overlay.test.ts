// Round 2, package O: the overlay close-control questions, the overlay plan and the offer choice against the fit.
import { describe, expect, it } from 'vitest';
import type { JevAnswer, JevResponse } from '../../src/jev/api';
import { emptyJevMetrics } from '../../src/jev/api';
import {
  MAX_CLOSE_CANDIDATES, OV_CLOSE_FWD, OV_CLOSE_REV, Q_OV_CLOSE, buildOverlayCloseCall, closeRefusal, closeVeto,
  ovSideId, parseOverlayClose,
} from '../../src/jev/overlay';
import { planOverlays } from '../../src/policy';
import type { OverlayFacts } from '../../src/policy';
import { chooseOfferForFit } from '../../src/signals';
import { DEMO_FITS } from '../../src/fit/derive';
import type { Offer, OverlayButtonEvidence, OverlayEvidence } from '../../src/types';

const CHAT: OverlayEvidence = {
  id: 'n90', kind_hint: 'chat', label: 'Ally, virtual assistant', position: 'bottom right corner, floating',
  size: '360 x 282 px, covers 25% of the screen', opened_by_itself: true, class_words: ['chat', 'panel'],
};

function b(id: string, label: string, text: string, extra: Partial<OverlayButtonEvidence> = {}): OverlayButtonEvidence {
  return { id, tag: 'button', label, visible_text: text, position_in_overlay: 'top right corner', size: '24 x 24 px', class_words: [], ...extra };
}

const BUTTONS: OverlayButtonEvidence[] = [
  b('n91', 'Minimize chat', '–', { class_words: ['chat', 'min'] }),
  b('n92', 'Refill status', 'Refill status', { position_in_overlay: 'middle' }),
  b('n93', 'Send message', '', { form_submit: true, position_in_overlay: 'bottom right' }),
  b('n94', 'End chat', 'End chat'),
  b('n95', 'Close and save 20%', 'Close and save 20%', { tag: 'a', link_target: 'another website' }),
];

function choice(probs: Record<string, number>): JevAnswer {
  const choice = Object.entries(probs).sort((x, y) => y[1] - x[1])[0]![0];
  return { type: 'choice', choice, probabilities: probs, confidence: 0.9 };
}

function resp(answers: Record<string, JevAnswer>): JevResponse {
  return { model: 'jev-1.14.0', answers, usage: { input_tokens: 2800, output_tokens: 0 } };
}

describe('buildOverlayCloseCall (design B, both option orders)', () => {
  it('asks the close question in both orders with none last, and side Nouls only for unvetoed buttons', () => {
    const call = buildOverlayCloseCall(CHAT, BUTTONS);
    const fwd = call.questions[OV_CLOSE_FWD]!;
    const rev = call.questions[OV_CLOSE_REV]!;
    expect(fwd.type).toBe('choice');
    expect(rev.type).toBe('choice');
    if (fwd.type !== 'choice' || rev.type !== 'choice') return;
    expect(Object.keys(fwd.criteria)).toEqual(['n91', 'n92', 'n93', 'n94', 'n95', 'none']);
    expect(Object.keys(rev.criteria)).toEqual(['n95', 'n94', 'n93', 'n92', 'n91', 'none']);
    expect((fwd.instructions as { question: string }).question).toBe(Q_OV_CLOSE);
    // Evidence sits inside the question; the shared state says nothing about the page.
    expect(JSON.stringify(call.state)).not.toContain('Ally');
    expect(call.questions[ovSideId('n91')]?.type).toBe('noul');
    expect(call.questions[ovSideId('n92')]?.type).toBe('noul');
    expect(call.questions[ovSideId('n93')]).toBeUndefined(); // submit
    expect(call.questions[ovSideId('n94')]).toBeUndefined(); // "End chat"
    expect(call.questions[ovSideId('n95')]).toBeUndefined(); // link
  });

  it('caps candidates at 8 and drops duplicates', () => {
    const many = Array.from({ length: 12 }, (_, i) => b(`n${i + 1}`, `Button ${i + 1}`, ''));
    const call = buildOverlayCloseCall(CHAT, [...many, many[0]!]);
    const fwd = call.questions[OV_CLOSE_FWD]!;
    if (fwd.type !== 'choice') throw new Error('choice expected');
    expect(Object.keys(fwd.criteria)).toHaveLength(MAX_CLOSE_CANDIDATES + 1);
  });

  it('never asks about a consent notice', () => {
    expect(() => buildOverlayCloseCall({ ...CHAT, kind_hint: 'consent' }, BUTTONS)).toThrow(/consent/);
  });

  it('refuses an empty candidate list', () => {
    expect(() => buildOverlayCloseCall(CHAT, [])).toThrow();
  });
});

describe('closeVeto', () => {
  it('vetoes links, submits and names that send, end, answer or leave', () => {
    expect(closeVeto(BUTTONS[0]!)).toBeNull();
    expect(closeVeto(BUTTONS[2]!)).toMatch(/submits/);
    expect(closeVeto(BUTTONS[3]!)).toMatch(/end/);
    expect(closeVeto(BUTTONS[4]!)).toMatch(/link/);
    expect(closeVeto(b('x', 'No thanks', 'No thanks'))).not.toBeNull();
    expect(closeVeto(b('x', 'Accept all', 'Accept all'))).not.toBeNull();
    expect(closeVeto(b('x', 'Pop out chat', ''))).not.toBeNull();
    expect(closeVeto(b('x', 'Hide calendar', ''))).toBeNull(); // word-start anchored
    expect(closeVeto(b('x', 'Close survey invitation', '×'))).toBeNull();
  });
});

describe('parseOverlayClose gate', () => {
  const m = emptyJevMetrics();

  it('accepts the same pick in both orders at >= 0.90 with a low side effect', () => {
    const r = parseOverlayClose(resp({
      [OV_CLOSE_FWD]: choice({ n91: 0.99, n92: 0.0, none: 0.01 }),
      [OV_CLOSE_REV]: choice({ n91: 0.97, none: 0.03 }),
      [ovSideId('n91')]: { type: 'noul', noul: 0.04 },
    }), CHAT, BUTTONS, m);
    expect(r).toMatchObject({ pick: 'n91', pFwd: 0.99, pRev: 0.97, sideEffect: 0.04, accept: true });
    expect(closeRefusal(r, BUTTONS)).toBeNull();
  });

  it('rejects a pick below 0.90 in either order (the "Continue in browser" case)', () => {
    const r = parseOverlayClose(resp({
      [OV_CLOSE_FWD]: choice({ n92: 0.63, none: 0.37 }),
      [OV_CLOSE_REV]: choice({ n92: 0.43, none: 0.57 }),
      [ovSideId('n92')]: { type: 'noul', noul: 0.1 },
    }), CHAT, BUTTONS, m);
    expect(r.accept).toBe(false);
    expect(closeRefusal(r, BUTTONS)).toMatch(/not sure enough/);
  });

  it('rejects when the two orders disagree', () => {
    const r = parseOverlayClose(resp({
      [OV_CLOSE_FWD]: choice({ n91: 0.95, n92: 0.05 }),
      [OV_CLOSE_REV]: choice({ n92: 0.92, n91: 0.08 }),
      [ovSideId('n91')]: { type: 'noul', noul: 0.02 },
    }), CHAT, BUTTONS, m);
    expect(r.accept).toBe(false);
  });

  it('rejects a high side-effect Noul and a missing one (fail closed)', () => {
    const hi = parseOverlayClose(resp({
      [OV_CLOSE_FWD]: choice({ n91: 0.99 }), [OV_CLOSE_REV]: choice({ n91: 0.99 }), [ovSideId('n91')]: { type: 'noul', noul: 0.35 },
    }), CHAT, BUTTONS, m);
    expect(hi.accept).toBe(false);
    const missing = parseOverlayClose(resp({ [OV_CLOSE_FWD]: choice({ n91: 0.99 }), [OV_CLOSE_REV]: choice({ n91: 0.99 }) }), CHAT, BUTTONS, m);
    expect(missing.accept).toBe(false);
    expect(missing.sideEffect).toBe(1);
  });

  it('rejects a vetoed pick whatever Jev says, and `none`', () => {
    const veto = parseOverlayClose(resp({
      [OV_CLOSE_FWD]: choice({ n94: 0.96 }), [OV_CLOSE_REV]: choice({ n94: 0.95 }), [ovSideId('n94')]: { type: 'noul', noul: 0.05 },
    }), CHAT, BUTTONS, m);
    expect(veto.accept).toBe(false);
    expect(closeRefusal(veto, BUTTONS)).toMatch(/refused/);
    const none = parseOverlayClose(resp({ [OV_CLOSE_FWD]: choice({ none: 0.92 }), [OV_CLOSE_REV]: choice({ none: 0.87 }) }), CHAT, BUTTONS, m);
    expect(none).toMatchObject({ pick: 'none', accept: false });
  });

  it('never accepts for a consent notice and fails closed on a malformed body', () => {
    const r = parseOverlayClose(resp({
      [OV_CLOSE_FWD]: choice({ n91: 0.99 }), [OV_CLOSE_REV]: choice({ n91: 0.99 }), [ovSideId('n91')]: { type: 'noul', noul: 0.01 },
    }), { ...CHAT, kind_hint: 'consent' }, BUTTONS, m);
    expect(r.accept).toBe(false);
    expect(parseOverlayClose({ model: 'x', answers: {}, usage: { input_tokens: 0, output_tokens: 0 } }, CHAT, BUTTONS, m).accept).toBe(false);
  });
});

function facts(id: string, over: Partial<OverlayFacts>): OverlayFacts {
  return {
    id, kind: 'other', coverage: 0, blocks: false, selfOpened: true, touched: false, choices: 0, toggles: false, wall: false,
    modal: false, folded: false, task: 0, alertdialog: false, advertising: 0, edge: 'center', heightShare: 0, launcher: false,
    leave: false, actions: 0, ...over,
  };
}

describe('planOverlays (Alderra at 150%: 56% covered)', () => {
  it('docks the cookie notice and minimises the self-opened chat', () => {
    const plan = planOverlays([
      facts('cookie', { kind: 'consent', coverage: 0.31, choices: 3, edge: 'bottom' }),
      facts('chat', { kind: 'chat', coverage: 0.25, launcher: true, edge: 'side' }),
    ]);
    expect(plan.map((p) => p.plan)).toEqual(['dock', 'minimise']);
  });

  it('keeps a warning in front, never acts on what the person opened or is using', () => {
    const plan = planOverlays([
      facts('timeout', { kind: 'warning', coverage: 1, alertdialog: true, task: 0.81, wall: true, modal: true }),
      facts('mine', { kind: 'chat', coverage: 0.3, launcher: true, selfOpened: false }),
      facts('typing', { kind: 'chat', coverage: 0.3, launcher: true, touched: true }),
    ]);
    expect(plan.map((p) => p.plan)).toEqual(['keep', 'none', 'none']);
    expect(planOverlays([facts('x', { kind: 'other', coverage: 0.5, task: 0.75, folded: true })])[0]!.plan).toBe('keep');
  });

  it('tucks a folded survey at any coverage, but not before Jev folds it', () => {
    expect(planOverlays([facts('s', { kind: 'survey', coverage: 0, folded: true })])[0]!.plan).toBe('tuck');
    expect(planOverlays([facts('s', { kind: 'survey', coverage: 0.3 })])[0]!.plan).toBe('none');
  });

  it('leaves consent walls, toggles and too many choices for the person', () => {
    const p = planOverlays([
      facts('a', { kind: 'consent', coverage: 0.7, choices: 3, wall: true }),
      facts('b', { kind: 'consent', coverage: 0.2, choices: 3, toggles: true }),
      facts('c', { kind: 'consent', coverage: 0.2, choices: 6 }),
      facts('d', { kind: 'consent', coverage: 0.05, choices: 2 }),
    ]);
    expect(p.map((x) => x.plan)).toEqual(['keep', 'keep', 'keep', 'none']);
  });

  it('acts on smaller overlays when all together cover >= 25%, largest first until under 15%', () => {
    const p = planOverlays([
      facts('a', { kind: 'chat', coverage: 0.1, launcher: true }),
      facts('b', { kind: 'consent', coverage: 0.09, choices: 2 }),
      facts('c', { kind: 'chat', coverage: 0.08, launcher: false }),
    ]);
    expect(p.map((x) => x.plan)).toEqual(['minimise', 'dock', 'none']);
  });

  it('respects the 30-day leave memory and the two-action limit; modals are only offered', () => {
    const p = planOverlays([
      facts('a', { kind: 'consent', coverage: 0.3, choices: 3, leave: true }),
      facts('b', { kind: 'chat', coverage: 0.3, launcher: true, actions: 2 }),
      facts('c', { kind: 'modal', coverage: 0.9, modal: true, wall: true }),
      facts('d', { kind: 'newsletter', coverage: 0.9, modal: true, folded: true }),
    ]);
    expect(p.map((x) => x.plan)).toEqual(['none', 'none', 'offer', 'offer']);
  });

  it('unpins a top promo bar and a tall header; tucks a bottom promo bar', () => {
    const p = planOverlays([
      facts('a', { kind: 'promo_bar', coverage: 0.05, advertising: 0.95, edge: 'top' }),
      facts('b', { kind: 'promo_bar', coverage: 0.05, advertising: 0.95, edge: 'bottom' }),
      facts('c', { kind: 'header', coverage: 0.24, heightShare: 0.24, edge: 'top' }),
      facts('d', { kind: 'header', coverage: 0.12, heightShare: 0.12, edge: 'top' }),
    ]);
    expect(p.map((x) => x.plan)).toEqual(['unpin', 'tuck', 'unpin', 'none']);
  });
});

describe('chooseOfferForFit', () => {
  const bigger: Offer = { kind: 'bigger_targets', question: 'Make buttons bigger on this page?', fact: '3 of the last 8 clicks here needed a second try.', why: 'Jev: 0.86.', p: 0.86 };

  it('offers the Calm view instead of bigger buttons when the fit already makes them 56 px', () => {
    const o = chooseOfferForFit(bigger, DEMO_FITS.rosa, { targetsApplied: true, busy: true, calmOpen: false });
    expect(o?.kind).toBe('calm_view');
    expect(o?.why).toMatch(/56 px/);
  });

  it('offers nothing on a calm page, and keeps the offer for the typical fit', () => {
    expect(chooseOfferForFit(bigger, DEMO_FITS.rosa, { targetsApplied: true, busy: false, calmOpen: false })).toBeNull();
    expect(chooseOfferForFit(bigger, DEMO_FITS.typical, { targetsApplied: false, busy: true, calmOpen: false })).toBe(bigger);
  });

  it('passes other offers through', () => {
    const steady: Offer = { ...bigger, kind: 'steady_clicks' };
    expect(chooseOfferForFit(steady, DEMO_FITS.rosa, { targetsApplied: true, busy: true, calmOpen: false })).toBe(steady);
  });
});
