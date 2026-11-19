import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  Ephemeral,
  fieldSig,
  Positions,
  relocateField,
  resolveOriginal,
  seekRecord,
} from './locate';
import type { ProxyTarget, SkeletonRegistry } from './types';

/** A registry over data attributes, like the live harness's. */
function registry(): SkeletonRegistry {
  const text = (el: Element): string =>
    (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return {
    extractionId: 'x1',
    element: (id) => document.querySelector(`[data-id="${id}"]`),
    members: (listId) =>
      Array.from(
        document.querySelectorAll(`[data-list="${listId}"] > [data-key]`),
      ),
    slot: (_l, member, slotId) =>
      member.querySelector(`[data-slot="${slotId}"]`),
    text,
    name: (el) => el.getAttribute('aria-label') ?? text(el),
    media: () => ({ src: null, srcset: null, width: 0, height: 0, alt: '' }),
    href: () => null,
    recordKey: (_l, m) => (m as HTMLElement).dataset.key ?? '',
    fingerprint: (_l, m) =>
      Array.from(m.querySelectorAll('[data-slot]')).map(text).join('|'),
    locator: (id) => ({ path: [id], kind: 'control', name: id }),
    resolve: (loc, within) => {
      const all = (within ?? document).querySelectorAll(
        `[data-id="${loc.name ?? ''}"]`,
      );
      return all.length === 1 ? (all[0] as Element) : null;
    },
  };
}

const record = (
  key: string,
  fingerprint: string,
  slotId = 'act',
): ProxyTarget => ({
  role: 'button',
  id: 'e9',
  locator: { path: ['e9'], kind: 'control' },
  scopeId: null,
  record: { listId: 'l1', key, fingerprint, slotId },
});

function rows(...items: Array<[string, string]>): void {
  document.body.innerHTML = `<ul data-list="l1">${items
    .map(
      ([key, title]) =>
        `<li data-key="${key}"><span data-slot="title">${title}</span><button data-slot="act">Archive</button></li>`,
    )
    .join('')}</ul>`;
}

const keyOf = (r: ReturnType<typeof resolveOriginal>): string | null =>
  r.kind === 'ok'
    ? ((r.member as HTMLElement | null)?.dataset.key ?? null)
    : null;

describe('resolveOriginal: records', () => {
  let reg: SkeletonRegistry;
  beforeEach(() => {
    reg = registry();
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('finds the record by fingerprint wherever it moved (never by index)', () => {
    rows(['a', 'Alpha'], ['b', 'Bravo'], ['c', 'Charlie']);
    const target = record('b', 'Bravo|Archive');
    rows(['c', 'Charlie'], ['a', 'Alpha'], ['b', 'Bravo']);
    const r = resolveOriginal(reg, target);
    expect(r.kind).toBe('ok');
    expect(keyOf(r)).toBe('b');
    if (r.kind === 'ok') expect(r.el.textContent).toBe('Archive');
  });

  it('tells lookalikes apart by key', () => {
    rows(['a', 'Same'], ['b', 'Same']);
    expect(keyOf(resolveOriginal(reg, record('b', 'Same|Archive')))).toBe('b');
    expect(keyOf(resolveOriginal(reg, record('a', 'Same|Archive')))).toBe('a');
  });

  it('refuses lookalikes the key cannot tell apart', () => {
    rows(['x', 'Same'], ['y', 'Same']);
    expect(resolveOriginal(reg, record('z', 'Same|Archive')).kind).toBe(
      'ambiguous',
    );
  });

  it('reports a record whose content changed under the view', () => {
    rows(['a', 'Alpha'], ['b', 'Bravo (edited)']);
    const r = resolveOriginal(reg, record('b', 'Bravo|Archive'));
    expect(r.kind).toBe('changed');
  });

  it('reports a record that is not in the DOM as absent', () => {
    rows(['a', 'Alpha']);
    expect(resolveOriginal(reg, record('q', 'Quebec|Archive')).kind).toBe(
      'absent',
    );
  });

  it('reports a missing slot inside the right record', () => {
    rows(['a', 'Alpha']);
    const r = resolveOriginal(reg, record('a', 'Alpha|Archive', 'nope'));
    expect(r.kind).toBe('missing');
  });
});

describe('resolveOriginal: controls and ephemeral targets', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const control = (id: string, scopeId: string | null = null): ProxyTarget => ({
    role: 'button',
    id,
    locator: { path: [id], kind: 'control', name: id },
    scopeId,
  });

  it('uses the node while it is still inside its section', () => {
    document.body.innerHTML =
      '<section data-id="s1"><button data-id="e2">Save</button></section>';
    const r = resolveOriginal(registry(), control('e2', 's1'));
    expect(r.kind).toBe('ok');
  });

  it('re-finds a control by locator inside its section only', () => {
    const reg = registry();
    document.body.innerHTML =
      '<aside><button data-id="e2">Save</button></aside><section data-id="s1"><button data-id="e2">Save</button></section>';
    // The id lookup lands outside the section; the locator, inside it.
    const r = resolveOriginal(reg, control('e2', 's1'));
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.el.closest('section')).not.toBeNull();
  });

  it('reports a control that left the page', () => {
    document.body.innerHTML = '<section data-id="s1"></section>';
    const r = resolveOriginal(registry(), control('e2', 's1'));
    expect(r.kind).toBe('missing');
  });

  it('accepts an ephemeral element only while its label is unchanged and it is visible', () => {
    const reg = registry();
    const eph = new Ephemeral();
    document.body.innerHTML =
      '<div role="menu"><div role="menuitem">Mute</div></div>';
    const item = document.querySelector('[role="menuitem"]') as HTMLElement;
    Object.defineProperty(item, 'checkVisibility', { value: () => true });
    const t = eph.target(item, 'button', 'Mute');
    expect(Ephemeral.is(t.id)).toBe(true);
    expect(eph.target(item, 'button', 'Mute').id).toBe(t.id);
    expect(resolveOriginal(reg, t, eph).kind).toBe('ok');
    item.textContent = 'Unmute';
    expect(resolveOriginal(reg, t, eph).kind).toBe('changed');
    item.remove();
    expect(resolveOriginal(reg, t, eph).kind).toBe('missing');
  });
});

describe('two-phase seek', () => {
  it('gives up at once when there is nothing to estimate from', async () => {
    document.body.innerHTML = '<ul data-list="l1"></ul>';
    const r = await seekRecord({
      reg: registry(),
      target: record('k9', 'Nine|Archive'),
      order: [],
      positions: new Positions(),
      timeoutMs: 50,
    });
    expect(r.kind).toBe('absent');
  });

  it('remembers positions per list and key', () => {
    const p = new Positions();
    p.note('l1', 'a', 120);
    expect(p.get('l1', 'a')).toBe(120);
    expect(p.get('l2', 'a')).toBeUndefined();
    p.clear();
    expect(p.get('l1', 'a')).toBeUndefined();
  });
});

describe('a text field the site replaces (eval M8)', () => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  beforeEach(() => {
    // jsdom lays nothing out: every field counts as rendered.
    proto.checkVisibility = () => true;
  });
  afterEach(() => {
    delete proto.checkVisibility;
    document.body.innerHTML = '';
  });

  /** Wikipedia: the search box is swapped for a new one on focus. */
  const swap = (html: string): void => {
    const box = document.getElementById('p-search')!;
    box.innerHTML = html;
  };

  it('keeps what identifies a field: name, kind, name attribute, search landmark, form', () => {
    document.body.innerHTML =
      '<div id="p-search" role="search"><form><input id="q" type="search" name="search" aria-label="Search Wikipedia"></form></div><textarea aria-label="Note"></textarea><input type="checkbox">';
    const reg = registry();
    expect(fieldSig(reg, document.getElementById('q')!)).toMatchObject({
      name: 'Search Wikipedia',
      kind: 'text',
      nameAttr: 'search',
      search: true,
    });
    expect(fieldSig(reg, document.querySelector('textarea')!)).toMatchObject({
      kind: 'textarea',
      search: false,
      form: null,
    });
    expect(
      fieldSig(reg, document.querySelector('[type="checkbox"]')!),
    ).toBeNull();
  });

  it('finds the new field in the search landmark by role and accessible name', () => {
    document.body.innerHTML =
      '<div id="p-search" role="search"><form id="f1"><input id="q" type="search" name="search" aria-label="Search Wikipedia"></form></div><main><input aria-label="Filter"></main>';
    const reg = registry();
    const sig = fieldSig(reg, document.getElementById('q')!)!;
    swap(
      '<form class="cdx"><input class="cdx-input" type="search" name="search" aria-label="Search Wikipedia"><input type="hidden" name="title"></form>',
    );
    const found = relocateField(reg, document, sig, null);
    expect(found?.className).toBe('cdx-input');
  });

  it('takes the field that has focus there, then the only field there', () => {
    document.body.innerHTML =
      '<div id="p-search" role="search"><input id="q" type="search" aria-label="Search"></div>';
    const reg = registry();
    const sig = fieldSig(reg, document.getElementById('q')!)!;
    swap('<input id="a" placeholder="Find"><input id="b" aria-label="Go">');
    (document.getElementById('b') as HTMLInputElement).focus();
    expect(relocateField(reg, document, sig, null)?.id).toBe('b');
    swap('<input id="c" aria-label="Look up">');
    expect(relocateField(reg, document, sig, null)?.id).toBe('c');
  });

  it('falls back to the same form, and refuses to guess between two fields', () => {
    document.body.innerHTML =
      '<div id="p-search"></div><form id="f"><input id="q" name="q" aria-label="Find"><input name="zip" aria-label="Zip"></form>';
    const reg = registry();
    const sig = fieldSig(reg, document.getElementById('q')!)!;
    const form = document.getElementById('f')!;
    // Renamed and replaced, in the same form: found by its name attribute.
    form.querySelector('#q')!.replaceWith(
      Object.assign(document.createElement('input'), {
        id: 'q2',
        name: 'q',
      }),
    );
    expect(relocateField(reg, document, sig, null)?.id).toBe('q2');
    // Nothing tells two candidates apart: no match, never a guess.
    form.innerHTML = '<input name="a"><input name="b">';
    expect(relocateField(reg, document, sig, null)).toBeNull();
  });
});
