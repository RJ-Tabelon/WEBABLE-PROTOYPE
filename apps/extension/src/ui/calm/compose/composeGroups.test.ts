// @vitest-environment happy-dom
// Round 10: the WebAble page's groups. Headings split groups and stay the page's own; links become ⟦n⟧ in order with
// their words; long runs split under 10 units and 3,000 characters; short runs, bylines, captions, pictures,
// controls and link lists are never sent; the same content always gets the same id.
import { afterEach, describe, expect, it } from 'vitest';
import { type Block, type FlowBlock, newCtx, readBlocks } from '../model';
import { type GroupSeg, MAX_CHARS, MAX_UNITS, groupsOf, hashText, segmentBlocks } from './composeGroups';

afterEach(() => {
  document.body.innerHTML = '';
});

const words = (n: number, w = 'refund'): string => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');

function flow(text: string, key = text.slice(0, 12)): FlowBlock {
  const p = document.createElement('p');
  p.textContent = text;
  document.body.append(p);
  return { b: 'flow', parts: [{ t: 'text', text }], text, help: false, key, src: p };
}

function read(html: string): Block[] {
  document.body.innerHTML = `<main>${html}</main>`;
  return readBlocks(document.querySelector('main')!, newCtx());
}

const groupSegs = (segs: ReturnType<typeof segmentBlocks>): GroupSeg[] => segs.filter((s): s is GroupSeg => s.k === 'group');

describe('groups of the page', () => {
  it('splits at headings, keeps the heading on the page and passes its text', () => {
    const blocks = read(`
      <p>${words(20)} first paragraph.</p><p>${words(15, 'tax')} second.</p>
      <h2>Who can file</h2>
      <p>${words(18, 'file')} third.</p><ul><li>${words(8, 'one')}</li><li>${words(8, 'two')}</li></ul>`);
    const segs = segmentBlocks(blocks, { heading: 'Your refund' });
    const groups = groupsOf(segs);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.heading).toBe('Your refund');
    expect(groups[0]!.units.map((u) => u.kind)).toEqual(['para', 'para']);
    expect(groups[1]!.heading).toBe('Who can file');
    expect(groups[1]!.units.map((u) => u.kind)).toEqual(['para', 'list']);
    expect(groups[1]!.units[1]!.text.split('\n')).toEqual([`• ${words(8, 'one')}`, `• ${words(8, 'two')}`]);
    // The heading is drawn as it is, between the groups.
    expect(segs.map((s) => s.k)).toEqual(['group', 'blocks', 'group']);
    const between = segs[1]!.blocks;
    expect(between).toHaveLength(1);
    expect(between[0]!.b).toBe('heading');
    expect(groups[0]!.units.map((u) => u.id)).toEqual(['u1', 'u2']);
    expect(groups[0]!.id).toMatch(/^g[0-9a-z]+$/);
  });

  it('turns links into numbered markers in order, with their words, and keeps the page links for the view', () => {
    const blocks = read(`
      <p>${words(20)} use <a href="https://example.gov/status">Where's My Refund</a> or call
        <a href="tel:8008291954">800-829-1954</a> today.</p>
      <ol><li>${words(6)} see <a href="https://example.gov/forms">the forms page</a>.</li><li>${words(6, 'mail')}</li></ol>`);
    const [g] = groupSegs(segmentBlocks(blocks, { heading: null }));
    expect(g).toBeDefined();
    expect(g!.group.units[0]!.text).toContain('use ⟦1⟧ or call ⟦2⟧ today.');
    expect(g!.group.units[1]!.text).toContain('see ⟦3⟧.');
    expect(g!.group.linkTexts).toEqual(["Where's My Refund", '800-829-1954', 'the forms page']);
    expect(g!.links.map((l) => l.href)).toEqual(['https://example.gov/status', 'tel:8008291954', 'https://example.gov/forms']);
    expect(g!.links[0]!.el.isConnected).toBe(true);
  });

  it('writes a table one line per row, the header first, and reads a blockquote as a quote', () => {
    const blocks = read(`
      <p>${words(12)} the table below.</p>
      <table><tr><th>Plan</th><th>Price</th></tr><tr><td>Basic</td><td>$4</td></tr><tr><td>Plus</td><td>$9</td></tr></table>
      <blockquote><p>We will process every return filed by April 15 within 21 days, as we always have.</p></blockquote>`);
    const [g] = groupsOf(segmentBlocks(blocks, { heading: 'Prices' }));
    expect(g!.units.map((u) => u.kind)).toEqual(['para', 'table', 'quote']);
    expect(g!.units[1]!.text).toBe('Plan | Price\nBasic | $4\nPlus | $9');
  });

  it('never sends short runs, bylines, captions, pictures, controls or link lists; a picture ends a run', () => {
    const blocks = read(`
      <p>By Jane Doe</p>
      <p>${words(40)} long enough.</p>
      <figure><img src="https://example.com/a.jpg" width="600" height="400"><figcaption>A photo of the office, 2024</figcaption></figure>
      <p>Too short to lay out.</p>
      <ul><li><a href="/a">One</a></li><li><a href="/b">Two</a></li><li><a href="/c">Three</a></li></ul>
      <button>Print</button>`);
    const segs = segmentBlocks(blocks, { heading: null });
    const groups = groupsOf(segs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.units).toHaveLength(1);
    expect(groups[0]!.units[0]!.text).toContain('long enough');
    const sent = groups.flatMap((g) => g.units.map((u) => u.text)).join('\n');
    for (const t of ['Jane Doe', 'A photo', 'Too short', 'One', 'Print']) expect(sent).not.toContain(t);
    // Nothing is lost: every block is drawn, in page order.
    const drawn = segs.flatMap((s) => s.blocks);
    expect(drawn).toEqual(blocks);
  });

  it('splits a long run into groups of at most 10 units and 3,000 characters, about the same size', () => {
    const many = Array.from({ length: 23 }, (_, i) => flow(`${words(12, `p${i}x`)}.`, `k${i}`));
    const g1 = groupsOf(segmentBlocks(many, { heading: 'Long' }));
    expect(g1.length).toBe(3);
    for (const g of g1) {
      expect(g.units.length).toBeLessThanOrEqual(MAX_UNITS);
      expect(g.heading).toBe('Long');
    }
    expect(g1.map((g) => g.units.length).reduce((a, b) => a + b, 0)).toBe(23);
    const big = Array.from({ length: 6 }, (_, i) => flow(`${words(120, `b${i}w`)}.`, `b${i}`));
    const g2 = groupsOf(segmentBlocks(big, { heading: null }));
    for (const g of g2) expect(g.units.reduce((a, u) => a + u.text.length, 0)).toBeLessThanOrEqual(MAX_CHARS);
    expect(g2.map((g) => g.units.length).reduce((a, b) => a + b, 0)).toBe(6);
  });

  it('gives the same content the same id, and lays out repeated content once per page', () => {
    const a = groupsOf(segmentBlocks([flow(`${words(40)}.`, 'a')], { heading: 'X' }))[0]!;
    const b = groupsOf(segmentBlocks([flow(`${words(40)}.`, 'b')], { heading: 'Y' }))[0]!;
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(`g${hashText(`para:${words(40)}.\n`)}`);
    const seen = new Set<string>();
    const first = segmentBlocks([flow(`${words(40)}.`, 'c')], { heading: null, seen });
    const again = segmentBlocks([flow(`${words(40)}.`, 'd')], { heading: null, seen });
    expect(groupsOf(first)).toHaveLength(1);
    expect(groupsOf(again)).toHaveLength(0);
    expect(again[0]!.k).toBe('blocks');
  });

  it("keeps a paragraph's own words (and its id) after round 9 rewrites it in place", () => {
    const f = flow(`${words(40)} original words.`, 'rw');
    const before = groupsOf(segmentBlocks([f], { heading: null }))[0]!;
    (f.src as Element).setAttribute('data-wa-rw', 'w1');
    const rewritten: FlowBlock = { ...f, parts: [{ t: 'text', text: 'Shorter words for you.' }], text: 'Shorter words for you.' };
    const after = groupsOf(segmentBlocks([rewritten], { heading: null }))[0]!;
    expect(after.id).toBe(before.id);
    expect(after.units[0]!.text).toContain('original words');
  });
});
