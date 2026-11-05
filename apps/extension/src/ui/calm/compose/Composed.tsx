// Round 10: draws one group's checked components, in order. Pure: blocks and the page's own links in, Preact out. Every
// word is the block's text; ⟦n⟧ becomes the page's link n (pressed through like any other page link) and **…** the
// page's own bold (<strong>; the server keeps it only on words the page bolds). Semantic HTML
// (h3, ol, dl, table with th, blockquote) in the order it is seen. Styles: compose.css.ts (adopted here if the view's
// sheet does not carry them yet).
import type { ComposeBlock, ComposeIcon } from '@webable/core';
import { Fragment, type ComponentChildren, type JSX } from 'preact';
import { useContext, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { InlineLink } from '../Blocks';
import { Calm } from '../context';
import type { LinkPart } from '../model';
import { composeCss } from './compose.css';
import { Icon, isComposeIcon } from './icons';
import type { ComposedProps } from './types';

type Of<K extends ComposeBlock['k']> = Extract<ComposeBlock, { k: K }>;

const MARK_RE = /⟦(\d{1,3})⟧/g;
const BOLD_RE = /\*\*([^*\n]+?)\*\*/g;

/** Words with ⟦n⟧ markers: the page's link n at each marker. A marker with no link draws nothing (its words are the link's). */
function withLinks(text: string, links: LinkPart[], out: ComponentChildren[], key: string): void {
  let last = 0;
  for (const m of text.matchAll(MARK_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const link = links[Number(m[1]) - 1];
    if (link) out.push(<InlineLink key={`${key}l${at}`} p={link} />);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
}

/**
 * Text with ⟦n⟧ markers and the page's **bold**: links at the markers (a link inside bold stays a link), bold runs as
 * <strong>. A ** with no partner draws as nothing (its words stay, plain).
 */
export function Txt({ text, links }: { text: string | null | undefined; links: LinkPart[] }): JSX.Element | null {
  if (!text) return null;
  if (!text.includes('⟦') && !text.includes('**')) return <Fragment>{text}</Fragment>;
  const out: ComponentChildren[] = [];
  const plain = (s: string, key: string): void => withLinks(s.replace(/\*\*/g, ''), links, out, key);
  let last = 0;
  for (const m of text.matchAll(BOLD_RE)) {
    const at = m.index ?? 0;
    if (at > last) plain(text.slice(last, at), `p${at}`);
    const inner: ComponentChildren[] = [];
    withLinks(m[1]!, links, inner, `b${at}`);
    out.push(<strong key={`b${at}`}>{inner}</strong>);
    last = at + m[0].length;
  }
  if (last < text.length) plain(text.slice(last), 'end');
  return <Fragment>{out}</Fragment>;
}

/** A component's own small heading: one line icon, then the title. */
function Head({ icon, title, links }: { icon: ComposeIcon | null; title: string | null; links: LinkPart[] }): JSX.Element | null {
  if (!title) return null;
  return (
    <h3 class="wa-cx-head">
      <Icon name={icon} class="wa-cx-head__ic" />
      <span class="wa-cx-head__t"><Txt text={title} links={links} /></span>
    </h3>
  );
}

function Prose({ b, links }: { b: Of<'prose'>; links: LinkPart[] }): JSX.Element {
  const paras = b.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div class="wa-cx-prose">
      {paras.map((p, i) => (
        <p key={i} class="wa-p"><Txt text={p} links={links} /></p>
      ))}
    </div>
  );
}

function KeyFacts({ b, links }: { b: Of<'keyfacts'>; links: LinkPart[] }): JSX.Element {
  return (
    <section class="wa-cx-keyfacts" data-card={b.rows.length > 3 ? '' : undefined}>
      <Head icon={b.icon} title={b.title} links={links} />
      <dl class="wa-cx-facts">
        {b.rows.map((r, i) => (
          <div key={i} class="wa-cx-fact" data-icon={isComposeIcon(r.icon) ? '' : undefined}>
            <Icon name={r.icon} class="wa-cx-fact__ic" />
            <dt class="wa-cx-fact__label"><Txt text={r.label} links={links} /></dt>
            <dd class="wa-cx-fact__value"><Txt text={r.value} links={links} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Steps({ b, links }: { b: Of<'steps'>; links: LinkPart[] }): JSX.Element {
  return (
    <section class="wa-cx-steps">
      <Head icon={null} title={b.title} links={links} />
      {b.lead && <p class="wa-p wa-cx-lead"><Txt text={b.lead} links={links} /></p>}
      <ol class="wa-cx-steplist">
        {b.steps.map((s, i) => (
          <li key={i} class="wa-cx-step">
            <span class="wa-cx-step__n" aria-hidden="true">{i + 1}</span>
            <div class="wa-cx-step__body">
              <p class="wa-cx-step__title"><Txt text={s.title} links={links} /></p>
              {s.detail && <p class="wa-cx-step__detail"><Txt text={s.detail} links={links} /></p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Stats({ b, links }: { b: Of<'stats'>; links: LinkPart[] }): JSX.Element {
  return (
    <dl class="wa-cx-stats" data-n={Math.min(4, b.tiles.length)}>
      {b.tiles.map((t, i) => (
        <div key={i} class="wa-cx-tile">
          <dt class="wa-cx-tile__label">
            <span><Txt text={t.label} links={links} /></span>
            <Icon name={t.icon} class="wa-cx-tile__ic" />
          </dt>
          <dd class="wa-cx-tile__value"><Txt text={t.value} links={links} /></dd>
          {t.note && <dd class="wa-cx-tile__note"><Txt text={t.note} links={links} /></dd>}
        </div>
      ))}
    </dl>
  );
}

/** A real table; in a narrow column (or at large text) the same rows stacked as labelled lists (only one is shown). */
function Compare({ b, links }: { b: Of<'compare'>; links: LinkPart[] }): JSX.Element {
  const cols = b.columns;
  return (
    <section class="wa-cx-compare" data-wide={cols.length >= 5 ? '' : undefined}>
      <Head icon={null} title={b.title} links={links} />
      <div class="wa-cx-table">
        <table>
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={i} scope="col"><Txt text={c} links={links} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i}>
                <th scope="row"><Txt text={r.label} links={links} /></th>
                {cols.slice(1).map((_, j) => (
                  <td key={j}><Txt text={r.cells[j] ?? ''} links={links} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul class="wa-cx-stack">
        {b.rows.map((r, i) => (
          <li key={i} class="wa-cx-stack__row">
            <p class="wa-cx-stack__title"><Txt text={r.label} links={links} /></p>
            <dl>
              {cols.slice(1).map((c, j) => (
                <div key={j} class="wa-cx-stack__cell">
                  <dt><Txt text={c} links={links} /></dt>
                  <dd><Txt text={r.cells[j] ?? ''} links={links} /></dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

const TONE_ICON: Record<Of<'callout'>['tone'], ComposeIcon> = {
  warning: 'triangle-alert', important: 'info', tip: 'lightbulb', key: 'sparkles',
};

function Callout({ b, links }: { b: Of<'callout'>; links: LinkPart[] }): JSX.Element {
  // Warnings always get the warning icon; the others keep the model's icon when it named one.
  const icon = b.tone === 'warning' ? 'triangle-alert' : isComposeIcon(b.icon) ? b.icon : TONE_ICON[b.tone];
  return (
    <div class="wa-cx-callout" data-tone={b.tone} role="note">
      <Head icon={icon} title={b.title} links={links} />
      <p class="wa-cx-callout__text"><Txt text={b.text} links={links} /></p>
    </div>
  );
}

function Definitions({ b, links }: { b: Of<'definitions'>; links: LinkPart[] }): JSX.Element {
  return (
    <section class="wa-cx-defs">
      <Head icon={null} title={b.title} links={links} />
      <dl>
        {b.items.map((d, i) => (
          <div key={i} class="wa-cx-def">
            <dt class="wa-cx-def__term"><Txt text={d.term} links={links} /></dt>
            <dd class="wa-cx-def__meaning"><Txt text={d.meaning} links={links} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function QuoteView({ b, links }: { b: Of<'quote'>; links: LinkPart[] }): JSX.Element {
  return (
    <figure class="wa-cx-quote">
      <blockquote class="wa-cx-quote__text"><p><Txt text={b.text} links={links} /></p></blockquote>
      {b.who && (
        <figcaption class="wa-cx-quote__who">
          {'— '}<Txt text={b.who} links={links} />{b.role ? <Fragment>{', '}<Txt text={b.role} links={links} /></Fragment> : null}
        </figcaption>
      )}
    </figure>
  );
}

const CONTACT_ICON: Record<Of<'contact'>['rows'][number]['kind'], ComposeIcon> = {
  phone: 'phone', email: 'mail', address: 'map-pin', hours: 'clock', web: 'globe', other: 'message-circle',
};

const PHONE_RE = /^\+?[\d\s().-]{7,24}$/;
const EMAIL_RE = /^[^\s@⟦⟧]+@[^\s@⟦⟧]+\.[a-z]{2,}$/i;

/** tel: or mailto: only when the value is exactly a phone number or an email address (and holds no page link). */
export function contactHref(kind: string, value: string): string | null {
  const v = value.trim();
  if (kind === 'phone' && PHONE_RE.test(v)) {
    const digits = v.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) return `tel:${v.startsWith('+') ? '+' : ''}${digits}`;
  }
  if (kind === 'email' && EMAIL_RE.test(v)) return `mailto:${v}`;
  return null;
}

function Contact({ b, links }: { b: Of<'contact'>; links: LinkPart[] }): JSX.Element {
  return (
    <section class="wa-cx-contact">
      <Head icon={null} title={b.title} links={links} />
      <dl class="wa-cx-facts">
        {b.rows.map((r, i) => {
          const href = contactHref(r.kind, r.value.replace(/\*\*/g, ''));
          return (
            <div key={i} class="wa-cx-fact" data-icon="">
              <Icon name={CONTACT_ICON[r.kind] ?? 'message-circle'} class="wa-cx-fact__ic" />
              <dt class="wa-cx-fact__label"><Txt text={r.label} links={links} /></dt>
              <dd class="wa-cx-fact__value">
                {href ? <a class="wa-inline-link" href={href}>{r.value.replace(/\*\*/g, '')}</a> : <Txt text={r.value} links={links} />}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function Points({ b, links }: { b: Of<'points'>; links: LinkPart[] }): JSX.Element {
  // Point titles sit one level under the block's own title, or under the page's heading when there is none.
  const Title = b.title ? 'h4' : 'h3';
  const icons = b.items.some((p) => isComposeIcon(p.icon));
  return (
    <section class="wa-cx-points">
      <Head icon={null} title={b.title} links={links} />
      <ul class="wa-cx-pointgrid">
        {b.items.map((p, i) => (
          <li key={i} class="wa-cx-point" data-icon={icons ? '' : undefined}>
            {icons && <Icon name={p.icon} class="wa-cx-point__ic" />}
            <div class="wa-cx-point__body">
              <Title class="wa-cx-point__title"><Txt text={p.title} links={links} /></Title>
              <p class="wa-cx-point__text"><Txt text={p.text} links={links} /></p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BlockView({ b, links }: { b: ComposeBlock; links: LinkPart[] }): JSX.Element | null {
  switch (b.k) {
    case 'prose': return <Prose b={b} links={links} />;
    case 'keyfacts': return <KeyFacts b={b} links={links} />;
    case 'steps': return <Steps b={b} links={links} />;
    case 'stats': return <Stats b={b} links={links} />;
    case 'compare': return <Compare b={b} links={links} />;
    case 'callout': return <Callout b={b} links={links} />;
    case 'definitions': return <Definitions b={b} links={links} />;
    case 'quote': return <QuoteView b={b} links={links} />;
    case 'contact': return <Contact b={b} links={links} />;
    case 'points': return <Points b={b} links={links} />;
    default: return null;
  }
}

let sheet: CSSStyleSheet | null | undefined;
function composeSheet(): CSSStyleSheet | null {
  if (sheet !== undefined) return sheet;
  try {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(composeCss);
  } catch {
    sheet = null;
  }
  return sheet;
}

/**
 * The components' stylesheet in whatever root the group is drawn in, once per root. Inside the WebAble page the view's
 * own sheet already carries it (live.ts calmSheetCss, in its cascade order), so this is for previews and tests.
 */
function useComposeStyles(ref: { current: HTMLElement | null }, inView: boolean): void {
  useLayoutEffect(() => {
    if (inView) return;
    const root = ref.current?.getRootNode() as ShadowRoot | Document | undefined;
    const s = composeSheet();
    if (!root || !s || !('adoptedStyleSheets' in root)) return;
    try {
      if (!root.adoptedStyleSheets.includes(s)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, s];
    } catch {
      /* the view's own sheet may carry the rules */
    }
  }, []);
}

function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function Composed({ blocks, links, settle, id }: ComposedProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const calm = useContext(Calm);
  useComposeStyles(ref, calm !== null);
  // One settle-in, decided when the group is first drawn as components; a later re-render never replays or cuts it.
  const [moving] = useState(() => settle && !calm?.reduceMotion && !prefersReducedMotion());
  return (
    <div ref={ref} class="wa-cx" data-wa-compose={id} data-settle={moving ? '' : undefined}>
      {blocks.map((b, i) => (
        <div key={i} class="wa-cx-block" data-k={b.k} style={moving ? { '--cx-i': String(i) } : undefined}>
          <BlockView b={b} links={links} />
        </div>
      ))}
    </div>
  );
}
