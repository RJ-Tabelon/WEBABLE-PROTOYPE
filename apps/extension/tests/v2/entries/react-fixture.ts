/**
 * React fixture for the live layer (WP6): the framework behaviours proxies
 * must survive, bundled from the extension's own react/react-dom.
 *
 *   - A controlled search input whose Enter is handled in onKeyDown by
 *     keyCode/which (closure-style code that needs the key bridge).
 *   - A controlled note input in a form with only onSubmit (Enter falls back
 *     to form.requestSubmit(), exactly once).
 *   - A list with one delegated onClick on the <ul>; rows can be reordered or
 *     renamed by the test (window.__react).
 *
 * Mounted into #app; uses the live harness's data attributes.
 */
import { createElement as h, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

interface Row {
  id: string;
  title: string;
}

interface ReactProbe {
  log: string[];
  submits: number;
  shuffle(): void;
  rename(id: string, title: string): void;
  duplicate(): void;
}

const probe: ReactProbe = {
  log: [],
  submits: 0,
  shuffle: () => undefined,
  rename: () => undefined,
  duplicate: () => undefined,
};
(window as unknown as { __react: ReactProbe }).__react = probe;

function App(): ReactElement {
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState('');
  const [rows, setRows] = useState<Row[]>([
    { id: 'a', title: 'Alpha report' },
    { id: 'b', title: 'Bravo invoice' },
    { id: 'c', title: 'Charlie notes' },
    { id: 'd', title: 'Delta plan' },
  ]);
  probe.shuffle = () => setRows((r) => [...r].reverse());
  probe.rename = (id, title) =>
    setRows((r) => r.map((x) => (x.id === id ? { ...x, title } : x)));
  probe.duplicate = () =>
    setRows((r) => [...r, { id: 'b2', title: 'Bravo invoice' }]);

  return h(
    'div',
    null,
    h(
      'form',
      {
        'data-scope': '',
        'data-id': 'e1',
        onSubmit: (e: Event) => {
          e.preventDefault();
          probe.log.push(`submit-search:${q}`);
        },
      },
      h('input', {
        'data-id': 'e2',
        'data-proxy': 'input',
        'aria-label': 'Search',
        value: q,
        onChange: (e: { target: HTMLInputElement }) => setQ(e.target.value),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.keyCode === 13 && e.which === 13) {
            e.preventDefault();
            probe.log.push(`search:${q}`);
          }
        },
      }),
    ),
    h('output', { id: 'echo' }, q),
    h(
      'form',
      {
        'data-scope': '',
        'data-id': 'e3',
        onSubmit: (e: Event) => {
          e.preventDefault();
          probe.submits++;
          probe.log.push(`note:${note}`);
          setSaved(note);
        },
      },
      h('input', {
        'data-id': 'e4',
        'data-proxy': 'input',
        'aria-label': 'Note',
        value: note,
        onChange: (e: { target: HTMLInputElement }) => setNote(e.target.value),
      }),
      h('output', { id: 'saved' }, saved ? `Saved: ${saved}` : ''),
    ),
    h(
      'ul',
      {
        'data-list': 'e10',
        onClick: (e: { target: Element }) => {
          const button = e.target.closest('button');
          const li = e.target.closest('li');
          if (button && li)
            probe.log.push(
              `${button.dataset.slot ?? ''}:${li.dataset.key ?? ''}`,
            );
        },
      },
      rows.map((r) =>
        h(
          'li',
          { key: r.id, 'data-key': r.id },
          h('span', { 'data-slot': 'title' }, r.title),
          h(
            'button',
            { type: 'button', 'data-slot': 'archive', 'data-proxy': 'button' },
            'Archive',
          ),
        ),
      ),
    ),
  );
}

const mount = document.getElementById('app');
if (mount) createRoot(mount).render(h(App));
