// @vitest-environment happy-dom
// Round 10: the component library draws every kind with its semantics, puts the page's own links back at ⟦n⟧, and
// settles in once (never under reduced motion).
import { COMPOSE_ICONS, type ComposeBlock } from '@webable/core';
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineApi } from '../../../contracts';
import { Calm, type CalmCtx } from '../context';
import type { LinkPart } from '../model';
import { Composed, contactHref } from './Composed';
import { ICON_NODES, Icon, isComposeIcon } from './icons';

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function pageLink(text: string, href: string | null): LinkPart {
  const el = document.createElement('a');
  if (href) el.href = href;
  el.textContent = text;
  document.body.append(el);
  return { t: 'link', el, text, href, help: false };
}

function mount(blocks: ComposeBlock[], links: LinkPart[] = [], opts: { settle?: boolean; reduceMotion?: boolean } = {}): { host: HTMLElement; click: ReturnType<typeof vi.fn> } {
  const host = document.createElement('div');
  document.body.append(host);
  const click = vi.fn();
  const ctx = { api: {} as EngineApi, splitN: Infinity, groupSize: 8, reduceMotion: !!opts.reduceMotion, click } as unknown as CalmCtx;
  render(
    <Calm.Provider value={ctx}>
      <Composed id="g1" blocks={blocks} links={links} settle={opts.settle ?? false} />
    </Calm.Provider>,
    host,
  );
  return { host, click };
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('icons', () => {
  it('draws every catalog icon as a thin inline line icon', () => {
    for (const name of COMPOSE_ICONS) {
      expect(isComposeIcon(name)).toBe(true);
      expect(ICON_NODES[name]?.length, name).toBeGreaterThan(0);
      const host = document.createElement('div');
      render(<Icon name={name} />, host);
      const svg = host.querySelector('svg')!;
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.getAttribute('fill')).toBe('none');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.getAttribute('stroke-width')).toBe('1.75');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
      expect(svg.children.length).toBeGreaterThan(0);
    }
  });

  it('draws nothing for a name outside the catalog', () => {
    const host = document.createElement('div');
    render(<Icon name={'rocket' as never} />, host);
    expect(host.innerHTML).toBe('');
    expect(isComposeIcon('rocket')).toBe(false);
  });
});

describe('Composed', () => {
  it('marks the group and keeps the blocks in order', () => {
    const { host } = mount([
      { k: 'prose', src: ['u1'], text: 'First.' },
      { k: 'callout', src: ['u1'], tone: 'key', title: 'Main point', text: 'Second.', icon: null },
    ]);
    const root = host.querySelector('[data-wa-compose="g1"]')!;
    expect(root).not.toBeNull();
    expect(Array.from(root.children).map((c) => c.getAttribute('data-k'))).toEqual(['prose', 'callout']);
  });

  it('puts the page’s own link at each ⟦n⟧ and presses the original', () => {
    const a = pageLink("Where's My Refund", 'https://www.irs.gov/wheres-my-refund');
    const { host, click } = mount([{ k: 'prose', src: ['u1'], text: 'Use ⟦1⟧ to check.\n\nOr call ⟦2⟧.' }], [a]);
    const ps = host.querySelectorAll('.wa-cx-prose p.wa-p');
    expect(ps).toHaveLength(2);
    expect(text(ps[0])).toBe("Use Where's My Refund to check.");
    const link = ps[0]!.querySelector('a.wa-inline-link')!;
    expect(link.getAttribute('href')).toBe('https://www.irs.gov/wheres-my-refund');
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(click).toHaveBeenCalledWith(a.el);
    // A marker with no link draws nothing (never the raw marker).
    expect(text(ps[1])).toBe('Or call .');
    expect(host.textContent).not.toMatch(/[⟦⟧]/);
  });

  it('draws key facts as a list of terms and values, boxed only when there are more than three', () => {
    const rows = [
      { label: 'Phone', value: '800-829-1954', icon: 'phone' as const },
      { label: 'Refunds', value: 'Within 21 days', icon: 'circle-check' as const },
    ];
    const { host } = mount([{ k: 'keyfacts', src: ['u1'], title: 'At a glance', icon: 'info', rows }]);
    expect(host.querySelector('h3.wa-cx-head')?.textContent).toBe('At a glance');
    expect(host.querySelector('h3 svg[data-icon="info"]')).not.toBeNull();
    expect(Array.from(host.querySelectorAll('dl dt')).map(text)).toEqual(['Phone', 'Refunds']);
    expect(Array.from(host.querySelectorAll('dl dd')).map(text)).toEqual(['800-829-1954', 'Within 21 days']);
    expect(host.querySelector('.wa-cx-keyfacts')!.hasAttribute('data-card')).toBe(false);
    document.body.innerHTML = '';
    const four = mount([{ k: 'keyfacts', src: ['u1'], title: null, icon: null, rows: [...rows, ...rows] }]);
    expect(four.host.querySelector('.wa-cx-keyfacts')!.hasAttribute('data-card')).toBe(true);
    expect(four.host.querySelector('h3')).toBeNull();
  });

  it('draws steps as an ordered list with numbers, titles and details', () => {
    const { host } = mount([{
      k: 'steps', src: ['u1'], title: 'Check your refund', lead: 'You need your return:',
      steps: [{ title: 'Open the page', detail: null }, { title: 'Enter your details', detail: 'Use the exact refund amount.' }],
    }]);
    expect(host.querySelector('h3')?.textContent).toBe('Check your refund');
    expect(text(host.querySelector('.wa-cx-lead'))).toBe('You need your return:');
    const items = host.querySelectorAll('ol > li');
    expect(items).toHaveLength(2);
    expect(items[1]!.querySelector('.wa-cx-step__n')?.getAttribute('aria-hidden')).toBe('true');
    expect(text(items[1]!.querySelector('.wa-cx-step__n'))).toBe('2');
    expect(text(items[1]!.querySelector('.wa-cx-step__title'))).toBe('Enter your details');
    expect(text(items[1]!.querySelector('.wa-cx-step__detail'))).toBe('Use the exact refund amount.');
    expect(items[0]!.querySelector('.wa-cx-step__detail')).toBeNull();
  });

  it('draws number tiles with label, value and note', () => {
    const { host } = mount([{
      k: 'stats', src: ['u1'],
      tiles: [{ label: 'Score range', value: '300–850', note: 'most scores', icon: 'chart-column' }, { label: 'Bureaus', value: '3', note: null, icon: null }],
    }]);
    const tiles = host.querySelectorAll('dl.wa-cx-stats > .wa-cx-tile');
    expect(tiles).toHaveLength(2);
    expect(text(tiles[0]!.querySelector('dt'))).toBe('Score range');
    expect(tiles[0]!.querySelector('dt svg[data-icon="chart-column"]')).not.toBeNull();
    expect(text(tiles[0]!.querySelector('.wa-cx-tile__value'))).toBe('300–850');
    expect(text(tiles[0]!.querySelector('.wa-cx-tile__note'))).toBe('most scores');
    expect(tiles[1]!.querySelector('.wa-cx-tile__note')).toBeNull();
  });

  it('draws a comparison as a real table with column and row headers, and the same rows stacked', () => {
    const { host } = mount([{
      k: 'compare', src: ['u1'], title: null, columns: ['', 'FICO', 'VantageScore'],
      rows: [{ label: 'Range', cells: ['300 to 850', '300 to 850'] }, { label: 'History', cells: ['6 months', '1 month'] }],
    }]);
    const table = host.querySelector('table')!;
    expect(Array.from(table.querySelectorAll('thead th')).map((th) => th.getAttribute('scope'))).toEqual(['col', 'col', 'col']);
    expect(Array.from(table.querySelectorAll('tbody th[scope=row]')).map(text)).toEqual(['Range', 'History']);
    expect(Array.from(table.querySelectorAll('tbody tr:nth-child(2) td')).map(text)).toEqual(['6 months', '1 month']);
    const stacked = host.querySelectorAll('.wa-cx-stack > li');
    expect(stacked).toHaveLength(2);
    expect(Array.from(stacked[1]!.querySelectorAll('dt')).map(text)).toEqual(['FICO', 'VantageScore']);
  });

  it('gives a warning the warning icon whatever the model named, and other tones their own', () => {
    const { host } = mount([
      { k: 'callout', src: ['u1'], tone: 'warning', title: 'Deadline', text: 'File by April 15.', icon: 'star' },
      { k: 'callout', src: ['u1'], tone: 'tip', title: 'Tip', text: 'Use direct deposit.', icon: null },
      { k: 'callout', src: ['u1'], tone: 'important', title: 'Note', text: 'Keep a copy.', icon: 'file-text' },
    ]);
    const calls = host.querySelectorAll('.wa-cx-callout[role=note]');
    expect(calls).toHaveLength(3);
    expect(calls[0]!.getAttribute('data-tone')).toBe('warning');
    expect(calls[0]!.querySelector('h3 svg')?.getAttribute('data-icon')).toBe('triangle-alert');
    expect(text(calls[0]!.querySelector('h3'))).toBe('Deadline');
    expect(text(calls[0]!.querySelector('p'))).toBe('File by April 15.');
    expect(calls[1]!.querySelector('h3 svg')?.getAttribute('data-icon')).toBe('lightbulb');
    expect(calls[2]!.querySelector('h3 svg')?.getAttribute('data-icon')).toBe('file-text');
  });

  it('draws definitions as a description list', () => {
    const { host } = mount([{ k: 'definitions', src: ['u1'], title: null, items: [{ term: 'ITIN', meaning: 'A tax number for people without a Social Security number.' }] }]);
    expect(text(host.querySelector('dl dt'))).toBe('ITIN');
    expect(text(host.querySelector('dl dd'))).toBe('A tax number for people without a Social Security number.');
  });

  it('draws a quote as a blockquote with its exact words and who said it', () => {
    const { host } = mount([{ k: 'quote', src: ['u1'], text: 'Now we just wait.', who: 'Maria Lopez', role: 'Tampa resident' }]);
    expect(text(host.querySelector('figure blockquote'))).toBe('Now we just wait.');
    expect(text(host.querySelector('figure figcaption'))).toBe('— Maria Lopez, Tampa resident');
  });

  it('links a contact value only when it is exactly a phone number or an email address', () => {
    const { host } = mount([{
      k: 'contact', src: ['u1'], title: 'Contact',
      rows: [
        { kind: 'phone', label: 'Phone', value: '800-829-1954' },
        { kind: 'email', label: 'Email', value: 'help@example.org' },
        { kind: 'phone', label: 'Phone', value: 'Call 800-829-1954 after 7 a.m.' },
        { kind: 'hours', label: 'Hours', value: '7 a.m. to 7 p.m.' },
      ],
    }]);
    const hrefs = Array.from(host.querySelectorAll('dd a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['tel:8008291954', 'mailto:help@example.org']);
    expect(Array.from(host.querySelectorAll('dt')).map(text)).toEqual(['Phone', 'Email', 'Phone', 'Hours']);
    expect(Array.from(host.querySelectorAll('.wa-cx-fact > svg')).map((s) => s.getAttribute('data-icon'))).toEqual(['phone', 'mail', 'phone', 'clock']);
    expect(contactHref('phone', '+44 20 7946 0958')).toBe('tel:+442079460958');
    expect(contactHref('email', 'not an email')).toBeNull();
    expect(contactHref('phone', '12')).toBeNull();
  });

  it('draws points as a list with a title and a line each', () => {
    const { host } = mount([{
      k: 'points', src: ['u1'], title: null,
      items: [{ icon: 'calendar', title: 'Payment history', text: 'Paying on time.' }, { icon: null, title: 'Amounts owed', text: 'How much you use.' }],
    }]);
    const items = host.querySelectorAll('ul.wa-cx-pointgrid > li');
    expect(items).toHaveLength(2);
    expect(text(items[0]!.querySelector('h3'))).toBe('Payment history');
    expect(text(items[0]!.querySelector('p'))).toBe('Paying on time.');
    expect(items[0]!.querySelector('svg')?.getAttribute('data-icon')).toBe('calendar');
    expect(items[1]!.querySelector('svg')).toBeNull();
  });

  it('settles in once when asked, and never under reduced motion', () => {
    const blocks: ComposeBlock[] = [{ k: 'prose', src: ['u1'], text: 'A.' }, { k: 'prose', src: ['u2'], text: 'B.' }];
    const moving = mount(blocks, [], { settle: true }).host.querySelector('.wa-cx')!;
    expect(moving.hasAttribute('data-settle')).toBe(true);
    expect((moving.children[1] as HTMLElement).style.getPropertyValue('--cx-i')).toBe('1');
    document.body.innerHTML = '';
    expect(mount(blocks, [], { settle: false }).host.querySelector('.wa-cx')!.hasAttribute('data-settle')).toBe(false);
    document.body.innerHTML = '';
    expect(mount(blocks, [], { settle: true, reduceMotion: true }).host.querySelector('.wa-cx')!.hasAttribute('data-settle')).toBe(false);
    document.body.innerHTML = '';
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    expect(mount(blocks, [], { settle: true }).host.querySelector('.wa-cx')!.hasAttribute('data-settle')).toBe(false);
  });
});

describe("the page's own bold in components", () => {
  it('draws **…** as <strong>, a link inside bold staying a link', () => {
    const a = pageLink('the form', 'https://example.org/form');
    const { host } = mount([{ k: 'prose', src: ['u1'], text: '**Note:** bring **⟦1⟧ today** and your ID.' }], [a]);
    const strong = Array.from(host.querySelectorAll('.wa-cx-prose strong'));
    expect(strong.map((s) => text(s))).toEqual(['Note:', 'the form today']);
    expect(strong[1]!.querySelector('a.wa-inline-link')?.getAttribute('href')).toBe('https://example.org/form');
    expect(text(host.querySelector('.wa-cx-prose p'))).toBe('Note: bring the form today and your ID.');
  });

  it('draws an unbalanced ** as plain words without the asterisks', () => {
    const { host } = mount([{ k: 'callout', src: ['u1'], tone: 'important', title: 'Before you go', text: 'Bring **your ID and the form.', icon: null }]);
    expect(host.querySelector('.wa-cx-callout strong')).toBeNull();
    expect(text(host.querySelector('.wa-cx-callout__text'))).toBe('Bring your ID and the form.');
  });

  it('keeps tel: links working when the value is bold', () => {
    const { host } = mount([{ k: 'contact', src: ['u1'], title: null, rows: [{ kind: 'phone', label: 'Phone', value: '**800-829-1040**' }] }]);
    expect(host.querySelector('a.wa-inline-link')?.getAttribute('href')).toBe('tel:8008291040');
    expect(text(host.querySelector('a.wa-inline-link'))).toBe('800-829-1040');
  });
});
