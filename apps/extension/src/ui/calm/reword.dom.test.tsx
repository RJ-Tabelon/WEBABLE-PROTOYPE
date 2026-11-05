// @vitest-environment happy-dom
// Round 9 on the simplified page: a paragraph rewritten for the person is read as one block and drawn from the rewrite
// (lead, list, the page's own links) with the thin mark that switches it back to the page's own words.
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineApi, RewordView } from '../../contracts';
import { FlowView } from './Blocks';
import { Calm, type CalmCtx } from './context';
import { type FlowBlock, newCtx, readBlocks } from './model';

afterEach(() => {
  document.body.innerHTML = '';
});

/** A paragraph as the engine leaves it after swapping a rewrite in: mark, lead, a list inside the paragraph. */
function rewrittenPara(): { p: HTMLParagraphElement; a: HTMLAnchorElement } {
  const root = document.createElement('main');
  const p = document.createElement('p');
  p.setAttribute('data-wa-rw', 'w3');
  const mark = document.createElement('span');
  mark.setAttribute('data-wa-rw-mark', '');
  mark.textContent = 'Rewritten';
  const a = document.createElement('a');
  a.href = 'https://www.irs.gov/wheres-my-refund';
  a.textContent = "Where's My Refund";
  const ul = document.createElement('ul');
  for (const t of ['Wait 21 days after you file online.', 'Have your Social Security number ready.']) {
    const li = document.createElement('li');
    li.textContent = t;
    ul.append(li);
  }
  p.append(mark, 'Check your refund with ', a, '.', ul);
  root.append(p);
  document.body.append(root);
  return { p, a };
}

function view(a: HTMLAnchorElement, showing: RewordView['showing']): RewordView {
  return {
    id: 'w3', kind: 'list', showing, ordered: true,
    lead: [{ t: 'text', text: 'Check your refund with ' }, { t: 'link', el: a, text: "Where's My Refund", href: a.href }, { t: 'text', text: '.' }],
    items: [[{ t: 'text', text: 'Wait 21 days after you file online.' }], [{ t: 'text', text: 'Have your Social Security number ready.' }]],
  };
}

function mount(b: FlowBlock, api: Partial<EngineApi>): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const ctx = { api: api as EngineApi, splitN: Infinity, groupSize: 8, reduceMotion: true, click: vi.fn() } as unknown as CalmCtx;
  render(
    <Calm.Provider value={ctx}>
      <FlowView b={b} />
    </Calm.Provider>,
    host,
  );
  return host;
}

describe('rewritten paragraphs on the simplified page', () => {
  it('reads a rewritten paragraph as one block whose source is the paragraph, without the mark', () => {
    const { p } = rewrittenPara();
    const blocks = readBlocks(p.parentElement!, newCtx());
    expect(blocks).toHaveLength(1);
    const f = blocks[0] as FlowBlock;
    expect(f.b).toBe('flow');
    expect(f.src).toBe(p);
    expect(f.text).not.toContain('Rewritten');
    expect(f.text).toContain('Wait 21 days');
    expect(f.parts.filter((x) => x.t === 'link')).toHaveLength(1);
  });

  it('draws the lead, the numbered steps and the page link, with a green mark that switches the paragraph', () => {
    const { p, a } = rewrittenPara();
    const f = readBlocks(p.parentElement!, newCtx())[0] as FlowBlock;
    const toggleParagraph = vi.fn();
    const host = mount(f, { rewordFor: (n) => (n === p ? view(a, 'new') : null), toggleParagraph });
    expect(host.querySelector('.wa-rw p')?.textContent).toBe("Check your refund with Where's My Refund.");
    const items = Array.from(host.querySelectorAll('ol.wa-list > li')).map((li) => li.textContent);
    expect(items).toEqual(['Wait 21 days after you file online.', 'Have your Social Security number ready.']);
    expect(host.querySelector('a.wa-inline-link')?.getAttribute('href')).toBe('https://www.irs.gov/wheres-my-refund');
    const mark = host.querySelector<HTMLButtonElement>('button.wa-rw-mark')!;
    expect(mark.getAttribute('data-showing')).toBe('new');
    expect(mark.title).toBe('Rewritten for you by WebAble. Click to see the original.');
    mark.click();
    expect(toggleParagraph).toHaveBeenCalledWith('w3');
    // Drawn once: the paragraph's words appear a single time.
    expect(host.textContent!.split('Wait 21 days').length - 1).toBe(1);
  });

  it("shows the page's own words with a hollow mark that switches back", () => {
    document.body.innerHTML = '<main><p id="q">The IRS issues most refunds in less than 21 calendar days.</p></main>';
    const q = document.getElementById('q')!;
    const f = readBlocks(q.parentElement!, newCtx())[0] as FlowBlock;
    const toggleParagraph = vi.fn();
    const rv: RewordView = { id: 'w1', kind: 'plain', showing: 'original', ordered: false, lead: [{ t: 'text', text: 'Most refunds come in 3 weeks.' }], items: [] };
    const host = mount(f, { rewordFor: (n) => (q.contains(n) ? rv : null), toggleParagraph });
    expect(host.textContent).toContain('less than 21 calendar days');
    expect(host.textContent).not.toContain('3 weeks');
    const mark = host.querySelector<HTMLButtonElement>('button.wa-rw-mark')!;
    expect(mark.getAttribute('data-showing')).toBe('original');
    mark.click();
    expect(toggleParagraph).toHaveBeenCalledWith('w1');
  });

  it('draws a paragraph with no rewrite exactly as before', () => {
    document.body.innerHTML = '<main><p>Plain words stay plain.</p></main>';
    const f = readBlocks(document.querySelector('main')!, newCtx())[0] as FlowBlock;
    const host = mount(f, { rewordFor: () => null });
    expect(host.querySelector('.wa-rw-mark')).toBeNull();
    expect(host.querySelector('p.wa-p')?.textContent).toBe('Plain words stay plain.');
  });
});
