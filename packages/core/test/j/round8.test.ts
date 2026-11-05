// Round 8 package J: the finer vocabulary (125 fine roles, 32 purposes), the role guide carried once in the fine calls'
// state, and the two optional questions ("live?" and "paid as a story?"). No network.
import { describe, expect, it } from 'vitest';
import type { ElementEvidence, FineRole, PageDigest } from '../../src/types';
import {
  FINE_CRITERIA, FINE_FAMILY, FINE_ROLES, FINE_TAIL_FLOOR, MAX_LIVE_CANDIDATES, MAX_PAID_CANDIDATES, MAX_SUBJECTS_PER_SPLIT_CALL, PAGE_PURPOSES,
  PURPOSE_CRITERIA, ROLE_GUIDE_NOTE, buildPageCalls, coarseFromFine, fineGuide, liveCandidate, paidCandidate, parsePageAnswers,
} from '../../src/jev/page';
import type { JevAnswer, JevQuestion } from '../../src/jev/api';
import { emptyJevMetrics } from '../../src/jev/api';
import { POLICY, isLive, isLiveBadge, isPaidAsStory } from '../../src/policy';
import { ALDERRA, choice, noul, response, score } from '../a1/fixtures';

const ev = (id: string, extra: Partial<ElementEvidence> = {}): ElementEvidence => ({
  id, tag: 'div', role_hint: 'region', label: 'Item', zone: 'center_column', landmark: 'main', size: '300 x 120 px', position: 'middle',
  fixed: false, class_words: [], visual_weight: 'medium', ...extra,
});

function digestOf(elements: ElementEvidence[]): PageDigest {
  return { ...ALDERRA, elements, mainCandidates: elements.filter((e) => e.tag === 'button').map((e) => e.id) };
}

const isChoice = (q: JevQuestion): q is Extract<JevQuestion, { type: 'choice' }> => q.type === 'choice';
const questionIds = (calls: Array<{ questions: Record<string, JevQuestion> }>, kind: string): string[] =>
  calls.flatMap((c) => Object.keys(c.questions)).filter((k) => k.endsWith(`__${kind}`));

describe('the finer vocabulary', () => {
  it('has 125 fine roles and 32 purposes, each with a description, and keeps every round 7 name', () => {
    expect(FINE_ROLES.length).toBe(125);
    expect(PAGE_PURPOSES.length).toBe(32);
    for (const r of FINE_ROLES) expect(FINE_CRITERIA[r], r).toBeTruthy();
    for (const p of PAGE_PURPOSES) expect(PURPOSE_CRITERIA[p], p).toBeTruthy();
    for (const old of ['page_title', 'byline', 'scoreboard', 'form_field', 'primary_action', 'site_nav', 'consent_notice', 'popup', 'upsell_promo', 'carousel', 'other'] as FineRole[]) {
      expect(FINE_ROLES).toContain(old);
    }
    for (const p of ['course_lesson', 'course_overview', 'live_blog', 'product_listing', 'game_detail']) expect(PAGE_PURPOSES).toContain(p);
  });

  it('puts new roles in the family that keeps the policy thresholds meaningful', () => {
    // protected families: never folded
    expect(FINE_FAMILY.live_badge).toBe('main_content');
    expect(FINE_FAMILY.breaking_banner).toBe('main_content');
    expect(FINE_FAMILY.add_to_cart).toBe('action_button');
    expect(FINE_FAMILY.product_options).toBe('form_field');
    expect(FINE_FAMILY.payment_field).toBe('form_field');
    expect(FINE_FAMILY.chat_widget).toBe('help_contact');
    expect(FINE_FAMILY.skip_link).toBe('navigation');
    expect(FINE_FAMILY.login_prompt).toBe('account_utility');
    // foldable: ads, teasers and popups
    for (const r of ['ad_disclosure', 'app_install_banner', 'paywall_prompt', 'betting_odds'] as FineRole[]) expect(FINE_FAMILY[r]).toBe('advertising');
    for (const r of ['related_links', 'testimonial'] as FineRole[]) expect(FINE_FAMILY[r]).toBe('recommendations');
    // neutral: urgency and tickers are neither protected nor folded
    for (const r of ['countdown_timer', 'stock_warning', 'ticker'] as FineRole[]) expect(FINE_FAMILY[r]).toBe('other');
    expect(coarseFromFine({ related_links: 0.5, teaser_other_content: 0.4, live_badge: 0.1 })).toEqual({ recommendations: 0.9, main_content: 0.1 });
  });

  it('counts a fine role at 0.02 or less as zero when summing families (tails of 125 options must not reach the 0.05 protect line)', () => {
    expect(FINE_TAIL_FLOOR).toBe(0.02);
    // an ad Jev is sure about, with 0.01-0.02 left on a dozen unrelated roles: no protected-family mass
    const tails = Object.fromEntries(['body_text', 'secondary_action', 'site_nav', 'form_field', 'help_link', 'account_utility'].map((r) => [r, 0.02]));
    expect(coarseFromFine({ upsell_promo: 0.88, ...tails })).toEqual({ advertising: 0.88 });
    // 0.03 is real mass and still counts
    expect(coarseFromFine({ upsell_promo: 0.88, body_text: 0.03, secondary_action: 0.02 })).toEqual({ advertising: 0.88, main_content: 0.03 });
  });
});

describe('the role guide', () => {
  it('rides once in the fine calls state; the fine options are names only and no other call carries the guide', () => {
    const els = Array.from({ length: 30 }, (_, i) => ev(`n${i + 1}`, { label: `Item ${i + 1}` }));
    const calls = buildPageCalls(digestOf(els));
    const fine = calls.filter((c) => c.fineOnly);
    const rest = calls.filter((c) => !c.fineOnly);
    expect(fine.length).toBe(2); // 30 subjects, at most 24 per call
    for (const c of fine) {
      const st = c.state as Record<string, unknown>;
      expect(st.role_guide).toEqual(fineGuide());
      expect(st.how_to_pick_a_role).toBe(ROLE_GUIDE_NOTE);
      expect(c.elementIds).toEqual([]);
      expect(c.fineIds!.length).toBeLessThanOrEqual(MAX_SUBJECTS_PER_SPLIT_CALL);
      for (const q of Object.values(c.questions)) {
        expect(isChoice(q)).toBe(true);
        const opts = (q as Extract<JevQuestion, { type: 'choice' }>).criteria;
        expect(Object.keys(opts)).toEqual([...FINE_ROLES]);
        expect(Object.values(opts).every((v) => v === null)).toBe(true);
      }
    }
    for (const c of rest) {
      expect(Object.keys(c.state as object)).not.toContain('role_guide');
      expect(Object.keys(c.questions).some((k) => k.endsWith('__fine'))).toBe(false);
    }
    // every element has exactly one fine question and one task question, in different calls
    expect(questionIds(calls, 'fine').sort()).toEqual(els.map((e) => `${e.id}__fine`).sort());
    expect(questionIds(calls, 'task').sort()).toEqual(els.map((e) => `${e.id}__task`).sort());
  });

  it('leaves the task, help, main and importance prompts byte-identical to the round 7 shape (the measured thresholds)', () => {
    const split = buildPageCalls(ALDERRA);
    const inline = buildPageCalls(ALDERRA, { guideInState: false });
    const all = (calls: typeof split): Record<string, JevQuestion> => Object.assign({}, ...calls.map((c) => c.questions));
    const a = all(split);
    const b = all(inline);
    for (const k of ['task', 'help', 'main', 'importance']) {
      for (const id of questionIds(inline, k)) expect(JSON.stringify(a[id]), id).toBe(JSON.stringify(b[id]));
    }
    // the states of those calls are the round 7 states (no guide), and so is the page call's
    expect(JSON.stringify(split.find((c) => !c.fineOnly && c.elementIds.length)!.state)).toBe(JSON.stringify(inline[0]!.state));
    expect(Object.keys(split[split.length - 1]!.state as object)).not.toContain('role_guide');
  });

  it('can still put the criteria inside each fine question (the round 7 shape)', () => {
    const calls = buildPageCalls(ALDERRA, { guideInState: false });
    expect(calls.some((c) => c.fineOnly)).toBe(false);
    const q = calls[0]!.questions.n1__fine as Extract<JevQuestion, { type: 'choice' }>;
    expect(JSON.stringify(q.criteria)).toBe(JSON.stringify(FINE_CRITERIA));
  });

  it('joins a subject fine answer from the fine call with its other answers from the other call', () => {
    const els = [ev('n1', { tag: 'span', label: 'Live', class_words: ['live', 'badge'], size: '40 x 18 px' }), ev('n2', { tag: 'p', label: 'Some text' })];
    const d = digestOf(els);
    const calls = buildPageCalls(d);
    const responses = calls.map((c) => {
      const a: Record<string, JevAnswer> = {};
      for (const q of Object.keys(c.questions)) {
        const [id, kind] = q.split('__') as [string, string];
        if (kind === 'fine') a[q] = choice(id === 'n1' ? { live_badge: 0.95, status_message: 0.05 } : { body_text: 1 });
        else if (kind === 'task') a[q] = noul(0.6);
        else if (kind === 'help') a[q] = noul(0.01);
        else if (kind === 'importance') a[q] = score(3, 5);
        else if (kind === 'live') a[q] = noul(0.9);
      }
      return response(a, 1000);
    });
    const u = parsePageAnswers(d, calls, responses, emptyJevMetrics());
    expect(u.elements.map((e) => e.id).sort()).toEqual(['n1', 'n2']);
    const n1 = u.elements.find((e) => e.id === 'n1')!;
    expect(n1).toMatchObject({ fine: 'live_badge', fineP: 0.95, role: 'main_content', task: 0.6, importance: 3, liveP: 0.9 });
    expect(u.elements.find((e) => e.id === 'n2')!.fine).toBe('body_text');
    // a missing fine answer leaves that element out (fail closed); the others stay
    const noFine = responses.map((r) => ({ ...r, answers: Object.fromEntries(Object.entries(r.answers).filter(([k]) => k !== 'n2__fine')) }));
    expect(parsePageAnswers(d, calls, noFine, emptyJevMetrics()).elements.map((e) => e.id)).toEqual(['n1']);
  });
});

describe('the optional questions', () => {
  it('flags live candidates from the evidence only: a Live word, a clock, a live class, a time tag', () => {
    expect(liveCandidate(ev('n1', { label: 'Live' }))).toBe(true);
    expect(liveCandidate(ev('n1', { label: 'Watch Live' }))).toBe(true);
    expect(liveCandidate(ev('n1', { label: 'Sale ends in 02:14:09' }))).toBe(true);
    expect(liveCandidate(ev('n1', { label: 'Updated 3 minutes ago' }))).toBe(true);
    expect(liveCandidate(ev('n1', { class_words: ['countdown', 'timer'] }))).toBe(true);
    expect(liveCandidate(ev('n1', { tag: 'time', role_hint: 'time' }))).toBe(true);
    expect(liveCandidate(ev('n1', { label: 'Shop now' }))).toBe(false);
    expect(liveCandidate(ev('n1', { label: 'Delivered to your door' }))).toBe(false);
    expect(liveCandidate(ev('n1', { label: 'Privacy policy', class_words: ['legal', 'footer'] }))).toBe(false);
  });

  it('flags paid-as-story candidates: paid words, ad-network frames, headline-length links to another site; never the header or footer', () => {
    expect(paidCandidate(ev('n1', { class_words: ['sponsored', 'content'] }))).toBe(true);
    expect(paidCandidate(ev('n1', { label: 'PROMOTED 80-ton boulder comes crashing down' }))).toBe(true);
    expect(paidCandidate(ev('n1', { tag: 'iframe', role_hint: 'none', iframe_kind: 'other_site' }))).toBe(true);
    expect(paidCandidate(ev('n1', { tag: 'a', role_hint: 'link', label: 'Doctors hate this one simple trick for sleeping', link_target: 'another website' }))).toBe(true);
    expect(paidCandidate(ev('n1', { tag: 'a', role_hint: 'link', label: 'About us', link_target: 'another website' }))).toBe(false);
    expect(paidCandidate(ev('n1', { tag: 'a', role_hint: 'link', label: 'Doctors hate this one simple trick for sleeping', link_target: 'this website' }))).toBe(false);
    expect(paidCandidate(ev('n1', { class_words: ['sponsored'], zone: 'footer_band' }))).toBe(false);
    expect(paidCandidate(ev('n1', { label: 'Refill prescriptions', tag: 'h1' }))).toBe(false);
  });

  it('asks them of candidates only, in the calls without the role guide, and no more than the caps', () => {
    const live = Array.from({ length: 20 }, (_, i) => ev(`n${i + 1}`, { label: `Live game ${i + 1}`, class_words: ['live'] }));
    const paid = Array.from({ length: 20 }, (_, i) => ev(`n${i + 100}`, { label: `Story ${i}`, class_words: ['sponsored'] }));
    const plain = Array.from({ length: 10 }, (_, i) => ev(`n${i + 200}`, { label: `Paragraph ${i}`, tag: 'p', role_hint: 'text' }));
    const calls = buildPageCalls(digestOf([...live, ...paid, ...plain]));
    const liveQ = questionIds(calls, 'live');
    const paidQ = questionIds(calls, 'paid');
    expect(liveQ).toHaveLength(MAX_LIVE_CANDIDATES);
    expect(paidQ).toHaveLength(MAX_PAID_CANDIDATES);
    expect(liveQ.some((k) => k.startsWith('n2') && Number(k.slice(1, 4)) >= 200)).toBe(false); // plain paragraphs are never asked
    for (const c of calls) {
      if (!c.fineOnly) continue;
      expect(Object.keys(c.questions).some((k) => /__(live|paid)$/.test(k))).toBe(false);
    }
    const q = calls.flatMap((c) => Object.values(c.questions)).find((x) => (x.instructions as Record<string, unknown>).question?.toString().includes('live or updating')) as Extract<JevQuestion, { type: 'noul' }>;
    expect(q.type).toBe('noul');
    expect(Object.keys(q.criteria!)).toEqual(['true', 'false']);
    expect(questionIds(buildPageCalls(digestOf([...live, ...paid]), { optionalQuestions: false }), 'live')).toEqual([]);
  });

  it('puts the probabilities on the judgment when asked, and leaves the field unset (not the element) when an answer is missing', () => {
    const els = [ev('n1', { label: 'Live', class_words: ['live'] }), ev('n2', { label: 'Story', class_words: ['sponsored'] }), ev('n3', { label: 'Live score', class_words: ['live'] })];
    const d = digestOf(els);
    const calls = buildPageCalls(d);
    const responses = calls.map((c) => {
      const a: Record<string, JevAnswer> = {};
      for (const q of Object.keys(c.questions)) {
        const [id, kind] = q.split('__') as [string, string];
        if (kind === 'fine') a[q] = choice({ other: 1 });
        else if (kind === 'task') a[q] = noul(0.1);
        else if (kind === 'help') a[q] = noul(0.01);
        else if (kind === 'importance') a[q] = score(2, 5);
        else if (kind === 'live' && id !== 'n3') a[q] = noul(0.82);
        else if (kind === 'paid') a[q] = noul(0.7);
      }
      return response(a, 1000);
    });
    const u = parsePageAnswers(d, calls, responses, emptyJevMetrics());
    expect(u.elements).toHaveLength(3);
    expect(u.elements.find((e) => e.id === 'n1')).toMatchObject({ liveP: 0.82 });
    expect(u.elements.find((e) => e.id === 'n1')!.paidAsStoryP).toBeUndefined(); // not a paid candidate: not asked
    expect(u.elements.find((e) => e.id === 'n2')).toMatchObject({ paidAsStoryP: 0.7 });
    expect(u.elements.find((e) => e.id === 'n3')!.liveP).toBeUndefined(); // asked, answer missing
  });
});

describe('what the policy does with them', () => {
  const j = (extra: Record<string, unknown>) => ({ id: 'n1', role: 'other' as const, roleP: 1, roleProbs: {}, task: 0, main: 0, help: 0, ...extra });

  it('calls something live at 0.60 or a confident live badge, and paid-as-story at 0.60 or confident sponsored content', () => {
    expect(POLICY.liveAccept).toBe(0.6);
    expect(isLive(j({ liveP: 0.6 }))).toBe(true);
    expect(isLive(j({ liveP: 0.59 }))).toBe(false);
    expect(isLive(j({ fine: 'live_badge', fineP: 0.9 }))).toBe(true);
    expect(isLiveBadge(j({ fine: 'live_badge', fineP: 0.4 }))).toBe(false); // fine roles count at 0.50
    expect(isLive(null)).toBe(false);
    expect(isPaidAsStory(j({ paidAsStoryP: 0.6 }))).toBe(true);
    expect(isPaidAsStory(j({ paidAsStoryP: 0.3 }))).toBe(false);
    expect(isPaidAsStory(j({ fine: 'sponsored', fineP: 0.8 }))).toBe(true);
    expect(isPaidAsStory(undefined)).toBe(false);
  });
});
