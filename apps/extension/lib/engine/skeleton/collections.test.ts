import { describe, expect, it } from 'vitest';

import {
  cv,
  groupRuns,
  isProseBlock,
  jaccard,
  matchesTemplate,
  runTemplate,
  setJaccard,
  structureFingerprint,
} from './collections';

function kids(html: string): Element[] {
  const d = document.createElement('div');
  d.innerHTML = html;
  return [...d.children];
}

describe('similarity', () => {
  it('jaccard of class tokens', () => {
    expect(jaccard([], [])).toBe(1);
    expect(jaccard(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(jaccard(['a', 'b'], ['a', 'c'])).toBeCloseTo(1 / 3);
    expect(setJaccard(new Set(['x']), new Set(['y']))).toBe(0);
  });

  it('coefficient of variation', () => {
    expect(cv([10, 10, 10])).toBe(0);
    expect(cv([])).toBe(1);
    expect(cv([0, 0])).toBe(1);
    expect(cv([8, 12])).toBeCloseTo(0.2);
  });

  it('fingerprints descendant structure', () => {
    const [a, b] = kids(
      '<li><a><img><span></span></a></li><li><a><img><span></span></a></li>',
    ) as [Element, Element];
    const fa = structureFingerprint(a, (e) => [...e.children]);
    expect([...fa].sort()).toEqual(['0:a#', '1:img#', '1:span#']);
    expect(
      setJaccard(
        fa,
        structureFingerprint(b, (e) => [...e.children]),
      ),
    ).toBe(1);
  });
});

describe('groupRuns', () => {
  it('finds runs of three or more same-template siblings', () => {
    const ch = kids(
      '<h2>t</h2><div class="card">1</div><div class="card is-active">2</div><div class="card">3</div><p>x</p>',
    );
    expect(groupRuns(ch)).toEqual([[1, 2, 3]]);
  });

  it('allows one other sibling between members, not two', () => {
    const one = kids(
      '<li class="i">1</li><li class="i">2</li><div class="ad">x</div><li class="i">3</li>',
    );
    expect(groupRuns(one)).toEqual([[0, 1, 3]]);
    const two = kids(
      '<li class="i">1</li><li class="i">2</li><div>x</div><div>y</div><li class="i">3</li>',
    );
    expect(groupRuns(two)).toEqual([]);
  });

  it('treats read and unread rows as one template', () => {
    const rows = kids(
      '<table><tbody><tr class="zA zE"><td>a</td></tr><tr class="zA yO"><td>b</td></tr><tr class="zA yO"><td>c</td></tr><tr class="zA zE"><td>d</td></tr></tbody></table>',
    );
    const tbody = rows[0]?.querySelector('tbody') as Element;
    const trs = [...tbody.children];
    expect(groupRuns(trs)).toEqual([[0, 1, 2, 3]]);
    const t = runTemplate(trs);
    expect(t).toEqual({ key: 'tr|', cls: ['zA'] });
    expect(trs.every((r) => matchesTemplate(r, t))).toBe(true);
  });

  it('never groups prose or table cells, nor unrelated tags', () => {
    expect(groupRuns(kids('<p>a</p><p>b</p><p>c</p><p>d</p>'))).toEqual([]);
    expect(
      groupRuns(kids('<span>a</span><em>b</em><span>c</span><em>d</em>')),
    ).toEqual([]);
  });

  it('respects explicit roles in the template key', () => {
    const ch = kids(
      '<div role="tab">a</div><div role="tab">b</div><div role="tab">c</div><div>d</div>',
    );
    expect(groupRuns(ch)).toEqual([[0, 1, 2]]);
    const t = runTemplate(ch.slice(0, 3));
    expect(matchesTemplate(ch[3] as Element, t)).toBe(false);
  });
});

describe('isProseBlock', () => {
  const one = (html: string): Element => kids(html)[0] as Element;
  const para =
    'Officials said on Tuesday that the new rules would take effect next spring, after a consultation.';

  it('a paragraph block is prose; a titled record is not', () => {
    expect(isProseBlock(one(`<div class="tb"><p>${para}</p></div>`))).toBe(
      true,
    );
    // Inline links in running text stay prose.
    expect(
      isProseBlock(
        one(`<div><p>${para} See <a href="/x">the notice</a>.</p></div>`),
      ),
    ).toBe(true);
    // A title link followed by a snippet is a search result.
    expect(
      isProseBlock(
        one(
          `<div><a href="/r">A result title that leads</a><p>${para}</p></div>`,
        ),
      ),
    ).toBe(false);
    // Media or a control make a record.
    expect(isProseBlock(one(`<div><img alt=""><p>${para}</p></div>`))).toBe(
      false,
    );
    expect(isProseBlock(one('<div><p>Short line.</p></div>'))).toBe(false);
  });
});
