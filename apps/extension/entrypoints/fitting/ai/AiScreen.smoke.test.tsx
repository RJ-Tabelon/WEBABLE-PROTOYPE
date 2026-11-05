// @vitest-environment happy-dom
// Smoke run of fitting.html#ai (round 9) with the background mocked: ask, reading, what WebAble took from it, saved,
// done; the saved-answer screen (switches save at once, Remove with a confirm); plain-word errors; the Results card
// and the way back to Results; the test hook. Nothing a person sees names the machinery.
import { AI_ASK_URLS, AI_PROMPT, DEMO_FITS, type BgRequest, type ReaderProfile } from '@webable/core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BusError } from '../../../src/engine/bus';

const calls: BgRequest[] = [];
const replies: { readerImport: () => Promise<unknown> } = { readerImport: () => Promise.resolve(READER) };

vi.mock('../../../src/engine/bus', async (orig) => {
  const real = await orig<typeof import('../../../src/engine/bus')>();
  return {
    ...real,
    ask: (req: BgRequest) => {
      calls.push(req);
      if (req.type === 'readerImport') return replies.readerImport();
      if (req.type === 'setReader') return Promise.resolve(req.reader);
      return Promise.reject(new real.BusError('network', 'not in this test'));
    },
  };
});

const READER: ReaderProfile = {
  v: 'reader.1',
  createdAt: '2026-10-25T10:00:00.000Z',
  source: 'ChatGPT',
  headline: 'Short answers, steps, and plain words for money and law.',
  points: [
    { id: 'r1', kind: 'knows', says: 'You know software and data well.', evidence: 'You debug TypeScript daily', support: 0.93, on: true },
    { id: 'r2', kind: 'new_to', says: 'Tax and legal words are new to you.', evidence: 'asked what an amended return is', support: 0.88, on: true },
    { id: 'r3', kind: 'format', says: 'You like steps, with the answer first.', evidence: 'just give me the steps', support: 0.9, on: true },
  ],
  level: 'everyday',
  length: 'shorter',
  shape: 'steps',
  answerFirst: true,
};

const ANSWER = `   You like short, direct answers with the main point first. You work in software, so technical words are fine,
but tax and legal terms are new to you: last month you asked me twice what an amended return is. You prefer numbered steps.   `;

const BANNED = /reword|profile|score|probabilit|confidence|calibration|\bpx\b|pixel/i;
const tick = (ms = 0) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

async function mount(hash: string): Promise<HTMLElement> {
  history.replaceState(null, '', `/fitting.html${hash}`);
  const { App } = await import('../App');
  const root = document.createElement('div');
  document.body.appendChild(root);
  // Links to other sites never navigate in the test; their own click handlers still run.
  root.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a')) e.preventDefault();
  });
  await act(() => render(<App />, root));
  await tick(20);
  return root;
}

function q<T extends Element = HTMLElement>(root: HTMLElement, sel: string): T {
  const el = root.querySelector<T>(sel);
  expect(el, sel).toBeTruthy();
  return el!;
}

async function click(root: HTMLElement, sel: string): Promise<void> {
  const el = q<HTMLElement>(root, sel);
  await act(() => el.click());
  await tick(5);
  // The #ai screens (Results has a sports "score" of its own).
  const ai = root.querySelector<HTMLElement>('.ai');
  if (ai) expect(visible(ai)).not.toMatch(BANNED);
}

async function type(root: HTMLElement, text: string): Promise<void> {
  const box = q<HTMLTextAreaElement>(root, 'textarea.ai-answer');
  await act(() => {
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await tick(5);
}

function visible(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.visually-hidden').forEach((n) => n.remove());
  return copy.textContent ?? '';
}

const switches = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('[role="switch"]')];

beforeEach(() => {
  calls.length = 0;
  replies.readerImport = () => Promise.resolve(READER);
  localStorage.clear();
  document.body.innerHTML = '';
});
afterEach(() => {
  history.replaceState(null, '', '/fitting.html');
});

describe('fitting.html#ai', () => {
  it('asks, reads, shows what it took, saves, and offers real pages', async () => {
    let release: (v: ReaderProfile) => void = () => {};
    replies.readerImport = () => new Promise((r) => (release = r));
    const root = await mount('#ai');

    expect(q(root, 'h1').textContent).toBe('Let pages explain things the way you like');
    expect(visible(root)).toContain('Your AI assistant already knows how you like things explained.');
    const chatgpt = q<HTMLAnchorElement>(root, '[data-answer="ask-chatgpt"]');
    expect(chatgpt.getAttribute('href')).toBe(AI_ASK_URLS.ChatGPT);
    expect(chatgpt.getAttribute('target')).toBe('_blank');
    expect(q<HTMLAnchorElement>(root, '[data-answer="ask-claude"]').getAttribute('href')).toBe(AI_ASK_URLS.Claude);
    expect(q(root, '.ai-question').textContent).toBe(AI_PROMPT);
    expect(q(root, '[data-answer="copy-question"]').textContent).toBe('Copy the question');

    // Continue waits for a real answer.
    const cont = () => q<HTMLButtonElement>(root, '[data-answer="continue"]');
    expect(cont().disabled).toBe(true);
    await type(root, 'Short.');
    expect(cont().disabled).toBe(true);
    await type(root, ANSWER);
    expect(cont().disabled).toBe(false);

    // The button they used is remembered and sent as the source; the answer goes trimmed.
    await click(root, '[data-answer="ask-chatgpt"]');
    await click(root, '[data-answer="continue"]');
    expect(q(root, 'h1').textContent).toBe('Reading what your AI said…');
    expect(visible(root)).not.toMatch(/%/);
    const sent = calls.find((c) => c.type === 'readerImport');
    expect(sent).toEqual({ type: 'readerImport', req: { text: ANSWER.trim(), source: 'ChatGPT' } });

    await act(() => release(READER));
    await tick(5);
    expect(q(root, '.ai-eyebrow').textContent).toBe('What WebAble took from it');
    expect(q(root, 'h1').textContent).toBe(READER.headline);
    const rows = [...root.querySelectorAll('.ai-point')];
    expect(rows).toHaveLength(3);
    expect(rows[0]?.querySelector('.ai-says')?.textContent).toBe('You know software and data well.');
    expect(rows[1]?.querySelector('.ai-quote')?.textContent).toBe('From ChatGPT: ‘asked what an amended return is’');
    expect(switches(root).map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true']);
    expect(switches(root)[0]?.getAttribute('aria-label')).toBe('You know software and data well.');

    // A switch turns a point off before saving; nothing is saved until Save.
    await act(() => switches(root)[0]!.click());
    await tick(5);
    expect(switches(root)[0]?.getAttribute('aria-checked')).toBe('false');
    expect(calls.some((c) => c.type === 'setReader')).toBe(false);
    await click(root, '[data-answer="save"]');
    const saved = calls.find((c) => c.type === 'setReader') as Extract<BgRequest, { type: 'setReader' }>;
    expect(saved.reader?.points.map((p) => p.on)).toEqual([false, true, true]);

    expect(q(root, 'h1').textContent).toBe('Done. Pages will now explain things the way you like.');
    expect(visible(root)).toContain('See it on a real page');
    const pages = [...root.querySelectorAll<HTMLAnchorElement>('a.ai-page')];
    expect(pages.map((a) => a.getAttribute('href'))).toEqual([
      'https://www.irs.gov/refunds',
      'https://www.cnn.com/2026/10/24/health/gen-z-stare-wellness',
    ]);
    expect(pages.map((a) => a.querySelector('.ai-page-label')?.textContent)).toEqual([
      'Where’s my refund, on the IRS site',
      'A health story on CNN',
    ]);
    for (const a of pages) expect(a.getAttribute('target')).toBe('_blank');
    expect(q(root, '[data-answer="close"]').textContent).toBe('Close');
  });

  it('says what went wrong in plain words and keeps the answer', async () => {
    const root = await mount('#ai');
    await type(root, ANSWER);

    replies.readerImport = () => Promise.reject(new BusError('network', 'The WebAble server could not be reached'));
    await click(root, '[data-answer="copy-question"]');
    await click(root, '[data-answer="continue"]');
    await tick(5);
    expect(q(root, '[role="alert"]').textContent).toBe('Couldn’t read that right now. Try again in a moment.');
    expect(q<HTMLTextAreaElement>(root, 'textarea.ai-answer').value).toBe(ANSWER);
    // Copy the question: no source is claimed.
    expect(calls.find((c) => c.type === 'readerImport')).toEqual({ type: 'readerImport', req: { text: ANSWER.trim() } });

    replies.readerImport = () => Promise.reject(new BusError('refused', 'The answer is too short', 422));
    await click(root, '[data-answer="continue"]');
    await tick(5);
    expect(q(root, '[role="alert"]').textContent).toBe('That answer is very short. Paste the whole reply.');

    // Nothing the answer supports reads as a cut-off paste too.
    replies.readerImport = () => Promise.resolve({ ...READER, points: [] });
    await click(root, '[data-answer="continue"]');
    await tick(5);
    expect(q(root, '[role="alert"]').textContent).toBe('That answer is very short. Paste the whole reply.');
  });

  it('opens on what is saved: switches save at once, and Remove asks first', async () => {
    localStorage.setItem('webable.dev.reader', JSON.stringify({ ...READER, source: 'Claude' }));
    const root = await mount('#ai');
    expect(q(root, '.ai-eyebrow').textContent).toBe('How you like things explained');
    expect(q(root, 'h1').textContent).toBe(READER.headline);
    expect(visible(root)).toContain('From Claude: ‘just give me the steps’');

    await act(() => switches(root)[2]!.click());
    await tick(5);
    const first = calls.find((c) => c.type === 'setReader') as Extract<BgRequest, { type: 'setReader' }>;
    expect(first.reader?.points.map((p) => p.on)).toEqual([true, true, false]);
    expect(switches(root)[2]?.getAttribute('aria-checked')).toBe('false');

    await click(root, '[data-answer="remove"]');
    expect(visible(root)).toContain('Remove this? Pages go back to their own words.');
    await click(root, '[data-answer="remove-no"]');
    expect(calls.filter((c) => c.type === 'setReader')).toHaveLength(1);
    await click(root, '[data-answer="remove"]');
    await click(root, '[data-answer="remove-yes"]');
    expect(calls.at(-1)).toEqual({ type: 'setReader', reader: null });
    expect(q(root, 'h1').textContent).toBe('Let pages explain things the way you like');
  });

  it('puts back what was saved when a new answer is read and then dropped', async () => {
    const old = { ...READER, headline: 'The one saved before.' };
    localStorage.setItem('webable.dev.reader', JSON.stringify(old));
    const root = await mount('#ai');
    await click(root, '[data-answer="paste-new"]');
    expect(q(root, '[data-answer="back"]').textContent).toBe('Back');
    await type(root, ANSWER);
    await click(root, '[data-answer="continue"]');
    await tick(5);
    expect(q(root, 'h1').textContent).toBe(READER.headline);
    await click(root, '[data-answer="paste-again"]');
    expect(calls.at(-1)).toEqual({ type: 'setReader', reader: old });
    expect(q<HTMLTextAreaElement>(root, 'textarea.ai-answer').value).toBe('');
  });

  it('is reached from the Results card and goes back there', async () => {
    localStorage.setItem('webable.dev.fit', JSON.stringify(DEMO_FITS.rosa));
    const root = await mount('#settings');
    const card = q(root, '.rs-ai');
    expect(card.querySelector('.rs-problem')?.textContent).toBe('Pages can explain things the way you like');
    expect(card.querySelector('.rs-evidence')?.textContent).toBe(
      'Bring what your AI assistant already knows about how you like things explained.',
    );
    // After the struggle cards.
    const cards = q(root, '.rs-cards');
    expect(cards.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await click(root, '[data-answer="reader"]');
    expect(location.hash).toBe('#ai');
    expect(q(root, 'h1').textContent).toBe('Let pages explain things the way you like');
    await click(root, '[data-answer="back"]');
    expect(root.querySelector('.rs-ai')).toBeTruthy();

    // Saved through the test hook: the card shows the headline and where it came from.
    const hook = (globalThis as unknown as { __reader: { load(t: string, s?: string): Promise<ReaderProfile>; get(): Promise<unknown> } })
      .__reader;
    let got: ReaderProfile | null = null;
    await act(async () => {
      got = await hook.load(ANSWER, 'ChatGPT');
    });
    await tick(5);
    expect(got).toEqual(READER);
    expect(q(root, '.rs-ai .rs-problem').textContent).toBe(READER.headline);
    expect(q(root, '.rs-ai .rs-evidence').textContent).toBe('From ChatGPT. Switch off anything that’s wrong.');
    expect(q(root, '[data-answer="reader"]').textContent).toBe('Change');
  });

  it('is the onboarding’s last step: ask, paste, Continue starts the read; or skip', async () => {
    const { ContextTask } = await import('../tasks/Context');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const imported: Array<[string, string | null]> = [];
    let done = 0;
    let skipped = 0;
    await act(() =>
      render(
        <ContextTask onImport={(t, s) => imported.push([t, s])} onDone={() => done++} onSkip={() => skipped++} />,
        root,
      ),
    );
    expect(root.textContent).toContain('Ask the AI you use most');
    expect(q(root, '[data-answer="continue"]').hasAttribute('disabled')).toBe(true);
    await act(() => {
      q<HTMLAnchorElement>(root, '[data-answer="ask-claude"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await type(root, ANSWER);
    await click(root, '[data-answer="continue"]');
    expect(imported).toEqual([[ANSWER, 'Claude']]);
    expect(done).toBe(1);
    await click(root, '[data-answer="back"]');
    expect(skipped).toBe(1);
    // Nothing learned shows in the step itself.
    expect(root.textContent).not.toContain(READER.headline);
    root.remove();
  });
});
