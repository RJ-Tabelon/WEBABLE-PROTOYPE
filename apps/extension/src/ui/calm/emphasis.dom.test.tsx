// @vitest-environment happy-dom
// The page's own emphasis on the WebAble page: bold and italic read from tags and from computed style, parts never
// merged across emphasis, drawn as <strong> / <em>, and sent to the layout planner as **…** (bold only).
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineApi } from '../../contracts';
import { FlowView } from './Blocks';
import { segmentBlocks } from './compose/composeGroups';
import { Calm, type CalmCtx } from './context';
import { type FlowBlock, type Inline, PLAIN, blockEmphasis, inlineEmphasis, newCtx, readBlocks, splitParts } from './model';

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

/**
 * The test DOM computes neither inline display nor font weights the way Chrome does: inline tags read as inline, and
 * the font weight and style are only an element's own inline style (else unknown, so the tags decide: the tag path).
 */
function chromeLikeStyles(): void {
  const real = window.getComputedStyle.bind(window);
  vi.stubGlobal('getComputedStyle', (el: Element) => {
    const cs = real(el);
    const inline = /^(a|b|strong|em|i|span|mark)$/.test(el.localName);
    const own = (el as HTMLElement).style;
    return new Proxy(cs, {
      get(t, k) {
        if (k === 'display') return inline ? 'inline' : t.display || 'block';
        if (k === 'fontWeight') return own?.fontWeight ?? '';
        if (k === 'fontStyle') return own?.fontStyle ?? '';
        const v: unknown = Reflect.get(t, k);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
  });
}

const style = (fontWeight: string, fontStyle = ''): { fontWeight: string; fontStyle: string } => ({ fontWeight, fontStyle });
const flags = (p: Inline): string => (p.t === 'br' ? 'br' : `${p.b ? 'b' : ''}${p.i ? 'i' : ''}`);

function read(html: string): FlowBlock[] {
  document.body.innerHTML = `<main>${html}</main>`;
  return readBlocks(document.querySelector('main')!, newCtx()).filter((b): b is FlowBlock => b.b === 'flow');
}

describe('emphasis from computed style', () => {
  it('counts an inline element at 600 or more as bold only while its block is under 600', () => {
    const body = blockEmphasis(style('400', 'normal'));
    expect(inlineEmphasis('span', style('700', 'normal'), body)).toMatchObject({ b: true, i: false });
    expect(inlineEmphasis('span', style('600'), body).b).toBe(true);
    expect(inlineEmphasis('span', style('500'), body).b).toBe(false);
    expect(inlineEmphasis('span', style('700'), blockEmphasis(style('700'))).b).toBe(false);
    expect(inlineEmphasis('span', style('bold'), body).b).toBe(true);
  });

  it('lets the computed weight win over the tag (a site that un-bolds its <b>)', () => {
    expect(inlineEmphasis('b', style('400', 'normal'), blockEmphasis(style('400', 'normal'))).b).toBe(false);
    // A word set back to normal weight inside a bold run is plain.
    const bold = inlineEmphasis('strong', style('700'), PLAIN);
    expect(inlineEmphasis('span', style('400'), bold).b).toBe(false);
  });

  it('reads italics from font-style, never inside an italic block', () => {
    const body = blockEmphasis(style('400', 'normal'));
    expect(inlineEmphasis('span', style('400', 'italic'), body).i).toBe(true);
    expect(inlineEmphasis('span', style('400', 'oblique'), body).i).toBe(true);
    expect(inlineEmphasis('em', style('400', 'italic'), blockEmphasis(style('400', 'italic'))).i).toBe(false);
  });

  it('falls back to the tags when no style is known, and keeps an outer run', () => {
    expect(inlineEmphasis('strong', style(''), PLAIN)).toMatchObject({ b: true, i: false });
    expect(inlineEmphasis('b', style(''), PLAIN).b).toBe(true);
    expect(inlineEmphasis('em', style(''), PLAIN)).toMatchObject({ b: false, i: true });
    expect(inlineEmphasis('i', style(''), PLAIN).i).toBe(true);
    expect(inlineEmphasis('span', style(''), inlineEmphasis('strong', style(''), PLAIN)).b).toBe(true);
    expect(inlineEmphasis('span', style(''), PLAIN)).toMatchObject({ b: false, i: false });
  });

  it('draws a highlight (<mark>) as bold', () => {
    expect(inlineEmphasis('mark', style('400', 'normal'), PLAIN).b).toBe(true);
  });
});

describe('emphasis in the page words', () => {
  beforeEach(chromeLikeStyles);
  const HTML = '<p><strong>Note:</strong> bring your <em>photo ID</em> and <b><a href="/form">the form</a></b>. <span style="font-weight:700">Do not</span> be late.</p>';

  it('reads bold lead-ins, italics, bold links and CSS-bold words as flags on the parts', () => {
    const [f] = read(HTML);
    const text = f!.parts.filter((p) => p.t === 'text').map((p) => [p.t === 'text' ? p.text.trim() : '', flags(p)]);
    expect(text).toContainEqual(['Note:', 'b']);
    expect(text).toContainEqual(['photo ID', 'i']);
    expect(text).toContainEqual(['Do not', 'b']);
    expect(text).toContainEqual(['bring your', '']);
    const link = f!.parts.find((p) => p.t === 'link');
    expect(link && flags(link)).toBe('b');
    expect(f!.text).toBe('Note: bring your photo ID and the form. Do not be late.');
  });

  it('never merges words with different emphasis, and merges the same', () => {
    const [f] = read('<p>One <b>two</b><b> three</b> four <i>five</i></p>');
    const texts = f!.parts.filter((p) => p.t === 'text');
    for (let k = 1; k < texts.length; k++) expect(flags(texts[k]!)).not.toBe(flags(texts[k - 1]!));
    expect(texts.map((p) => (p.t === 'text' ? p.text : ''))).toEqual(['One ', 'two three', ' four ', 'five']);
  });

  it('keeps the flags when a paragraph is split into sentences', () => {
    const parts: Inline[] = [{ t: 'text', text: 'First one. Second one is bold. Third.', b: true }];
    const paras = splitParts(parts, 1);
    expect(paras).toHaveLength(3);
    for (const ps of paras) expect(ps.every((p) => p.t !== 'text' || p.b)).toBe(true);
  });

  it('draws bold as <strong> and italics as <em>, a bold link staying a link', () => {
    const [f] = read(HTML);
    const host = document.createElement('div');
    document.body.append(host);
    const ctx = { api: { rewordFor: () => null } as unknown as EngineApi, splitN: Infinity, groupSize: 8, reduceMotion: true, click: vi.fn() } as unknown as CalmCtx;
    render(
      <Calm.Provider value={ctx}>
        <FlowView b={f!} />
      </Calm.Provider>,
      host,
    );
    const strong = Array.from(host.querySelectorAll('strong')).map((s) => s.textContent);
    expect(strong).toEqual(['Note:', 'the form', 'Do not']);
    expect(host.querySelector('em')?.textContent).toBe('photo ID');
    expect(host.querySelector('strong > a.wa-inline-link')?.getAttribute('href')).toMatch(/\/form$/);
    expect(host.querySelector('p.wa-p')?.textContent).toBe('Note: bring your photo ID and the form. Do not be late.');
    expect(host.textContent).not.toContain('Explain');
  });
});

describe('emphasis sent to the layout planner', () => {
  beforeEach(chromeLikeStyles);
  it('wraps bold runs (words and links) in ** with the spaces outside, and sends no italics', () => {
    const filler = 'Refunds are usually sent within the time the agency gives on this page for most people who file.';
    read(`<p><strong>Note: </strong>bring your <em>photo ID</em> and <b><a href="/form">the form</a></b>. ${filler}</p><p>${filler} ${filler}</p>`);
    const blocks = readBlocks(document.querySelector('main')!, newCtx());
    const g = segmentBlocks(blocks, { heading: null }).find((s) => s.k === 'group');
    expect(g?.k).toBe('group');
    const u1 = g!.k === 'group' ? g!.group.units[0]!.text : '';
    expect(u1.startsWith('**Note:** bring your photo ID and **⟦1⟧**.')).toBe(true);
    expect(u1).not.toContain('_');
  });

  it("never lets the page's own asterisks read as a bold mark", () => {
    const filler = 'Refunds are usually sent within the time the agency gives on this page for most people who file.';
    const blocks = read(`<p>Price** applies. ${filler}</p><p>${filler} ${filler}</p>`);
    const g = segmentBlocks(blocks, { heading: null }).find((s) => s.k === 'group');
    const u1 = g && g.k === 'group' ? g.group.units[0]!.text : '';
    expect(u1).toContain('Price∗∗ applies.');
    expect(u1).not.toContain('**');
  });
});
