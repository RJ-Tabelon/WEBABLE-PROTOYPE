import { beforeEach, describe, expect, it } from 'vitest';

import { composedKids, composedParentOf } from './dom';
import {
  domPath,
  matchPath,
  nameHash,
  parseStep,
  stepSig,
  suffixMatch,
} from './locator';

beforeEach(() => {
  document.body.innerHTML = `
    <header role="banner"><nav><a href="/">Home</a><a href="/b">B</a></nav></header>
    <main>
      <ul id="list"><li><a href="/1">One</a></li><li><a href="/2">Two</a></li><li><a href="/3">Three</a></li></ul>
      <section><button id="go">Go</button></section>
    </main>`;
});

describe('steps', () => {
  it('signature is tag plus explicit role', () => {
    expect(stepSig(document.querySelector('header') as Element)).toBe(
      'header[banner]',
    );
    expect(stepSig(document.querySelector('main') as Element)).toBe('main');
    expect(parseStep('li:2')).toEqual({ sig: 'li', index: 2 });
    expect(parseStep('header[banner]')).toEqual({
      sig: 'header[banner]',
      index: null,
    });
  });

  it('paths index same-signature siblings only when there are several', () => {
    const two = document.querySelectorAll('#list a')[1] as Element;
    expect(domPath(two, document.body)).toEqual(['main', 'ul', 'li:1', 'a']);
    const go = document.getElementById('go') as Element;
    expect(domPath(go, document.body)).toEqual(['main', 'section', 'button']);
    expect(domPath(document.body, go)).toBeNull();
  });
});

describe('matchPath', () => {
  it('finds the element again, and only it', () => {
    const path = domPath(
      document.getElementById('go') as Element,
      document.body,
    );
    expect(matchPath(document.body, path as string[])).toEqual([
      document.getElementById('go'),
    ]);
  });

  it('survives an inserted sibling of another signature', () => {
    const two = document.querySelectorAll('#list a')[1] as Element;
    const path = domPath(two, document.body) as string[];
    document.querySelector('main')?.prepend(document.createElement('div'));
    expect(matchPath(document.body, path)).toEqual([two]);
  });

  it('reports ambiguity instead of guessing', () => {
    expect(matchPath(document.body, ['main', 'ul', 'li', 'a'])).toHaveLength(2);
    expect(matchPath(document.body, [])).toEqual([]);
  });

  it('matches a path tail inside a scope when ancestors changed', () => {
    const go = document.getElementById('go') as Element;
    const path = domPath(go, document.body) as string[];
    const wrap = document.createElement('div');
    go.parentElement?.replaceWith(wrap);
    wrap.appendChild(go.parentElement ?? document.createElement('section'));
    const section = document.querySelector('section') ?? wrap;
    section.appendChild(go);
    expect(matchPath(document.body, path)).toEqual([]);
    expect(suffixMatch(document.body, path, () => true, 2)).toBe(go);
  });
});

describe('matchPath: a leading optional sibling (eval B5)', () => {
  it('the subject, not the label badge that took its index', () => {
    document.body.innerHTML = `
      <table><tbody>
        <tr><td class="sj"><span class="bog">Plain subject</span><span class="y2"> - snippet</span></td></tr>
        <tr><td class="sj"><span class="badge">Work</span><span class="bog">Labelled subject</span><span class="y2"> - snippet</span></td></tr>
      </tbody></table>`;
    const rows = document.querySelectorAll('tr');
    const plain = rows[0] as Element;
    const labelled = rows[1] as Element;
    const subject = plain.querySelector('.bog') as Element;
    const steps = domPath(subject, plain) as string[];
    expect(steps).toEqual(['td', 'span:0']);
    // Unvetted, the indexed sibling wins: the badge.
    expect(matchPath(labelled, steps)[0]?.className).toBe('badge');
    // Vetted by the slot's classes, the subject is found.
    const hits = matchPath(labelled, steps, undefined, 2, 4000, (el) =>
      el.classList.contains('bog'),
    );
    expect(hits).toEqual([labelled.querySelector('.bog')]);
  });
});

describe('composed tree', () => {
  it('walks shadow roots and slots', () => {
    const host = document.createElement('x-card');
    host.innerHTML = '<span slot="title">T</span><p>body</p>';
    document.body.appendChild(host);
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML =
      '<h3><slot name="title"></slot></h3><div><slot></slot></div>';
    const kids = composedKids(host);
    expect(kids.map((k) => k.localName)).toEqual(['h3', 'div']);
    const h3 = kids[0] as Element;
    expect(composedKids(h3).map((k) => k.localName)).toEqual(['span']);
    const span = host.querySelector('span') as Element;
    expect(composedParentOf(span)).toBe(h3);
    const path = domPath(span, document.body) as string[];
    expect(path).toEqual(['x-card', 'h3', 'span']);
    expect(matchPath(document.body, path)).toEqual([span]);
  });
});

describe('nameHash', () => {
  it('hashes names, folding digits and case', () => {
    expect(nameHash('Inbox (3)')).toBe(nameHash('inbox (17)'));
    expect(nameHash('Archive')).not.toBe(nameHash('Delete'));
    expect(nameHash('   ')).toBeUndefined();
  });
});
