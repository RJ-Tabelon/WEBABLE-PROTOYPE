// Owner: C. Cards for single page elements: a popup the page keeps open (session about to end), an alert, a cookie
// question; the chat row; the site's own progress rail; the success panel after the main action.
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Blocks, InlineLink, PillButton } from './Blocks';
import { useCalm } from './context';
import { Disclosure } from './Disclosure';
import * as I from './icons';
import { type Block, type ControlBlock, nameOf } from './model';
import type { CalmPlan, PlanCard, Portal } from './plan';
import type { Outcome } from './outcome';
import { HelpCard, leaves } from './sections/layouts';

/** A flow that is only a link ("Report food loss"): drawn as an underlined link with a chevron. */
function loneLink(b: Block): ControlBlock | null {
  if (b.b === 'control' && b.role === 'link') return b;
  if (b.b === 'flow') {
    const links = b.parts.filter((p) => p.t === 'link');
    const words = b.parts.filter((p) => p.t === 'text').map((p) => (p as { text: string }).text).join('').trim();
    if (links.length === 1 && !words) {
      const l = links[0] as Extract<typeof links[number], { t: 'link' }>;
      return { b: 'control', el: l.el, role: 'link', text: l.text, href: l.href, primary: false, help: l.help, selected: false, popup: false, key: b.key, src: b.src };
    }
  }
  return null;
}

function NoticeLink({ c }: { c: ControlBlock }): JSX.Element {
  const ctx = useCalm();
  const press = (e: MouseEvent): void => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    ctx.click(c.el);
  };
  const body = (
    <>
      <span>{c.text}</span>
      <I.ChevronRight />
    </>
  );
  return c.href ? (
    <a class="wa-notice__link" href={c.href} onClick={press}>
      {body}
    </a>
  ) : (
    <button type="button" class="wa-notice__link" onClick={() => ctx.click(c.el)}>
      {body}
    </button>
  );
}

/**
 * One source element as one card. Every choice the page offers is kept, all the same size, none highlighted; a
 * one-sentence notice has no title; pictures inside notices (icons) are left out.
 */
export function NoticeCard({ card }: { card: PlanCard }): JSX.Element | null {
  const ls = leaves(card.blocks).filter((b) => b.b !== 'image');
  const title = card.title;
  const body: Block[] = [];
  const links: ControlBlock[] = [];
  const buttons: ControlBlock[] = [];
  for (const b of ls) {
    if (b.b === 'heading' && b.text === title) continue;
    const lone = loneLink(b);
    if (lone) {
      links.push(lone);
      continue;
    }
    if (b.b === 'control') {
      buttons.push(b);
      continue;
    }
    body.push(b);
  }
  if (!body.length && !buttons.length && !links.length && !title) return null;
  const consent = card.kind === 'consent';
  if (consent) {
    // A cookie question stays small: one line, the site's own choices, the full text one press away. Never answered.
    return (
      <section class="wa-notice wa-notice--consent" aria-label="Cookies">
        <span class="wa-notice__icon" aria-hidden="true">
          <I.Shield />
        </span>
        <div class="wa-notice__body">
          <p class="wa-notice__title">This site asks about cookies.</p>
          {buttons.length > 0 && <ButtonsRow buttons={buttons} />}
          {(body.length > 0 || links.length > 0) && (
            <Disclosure title="Read the notice" headingLevel={3} quiet>
              <Blocks blocks={body} />
              {links.map((l) => (
                <NoticeLink key={l.key} c={l} />
              ))}
            </Disclosure>
          )}
        </div>
      </section>
    );
  }
  return (
    <section class={`wa-notice${consent ? ' wa-notice--consent' : ''}`} aria-label={title ?? (consent ? 'Cookies' : 'Notice from the page')} role={card.kind === 'popup' ? 'alertdialog' : undefined}>
      <span class="wa-notice__icon" aria-hidden="true">
        {consent ? <I.Shield /> : <I.Alert />}
      </span>
      <div class="wa-notice__body">
        {title && <h2 class="wa-notice__title">{title}</h2>}
        {card.kind === 'popup' && buttons.length > 0 && body.length > 1 ? (
          <>
            <Blocks blocks={body.slice(0, 1)} />
            <ButtonsRow buttons={buttons} />
            <Blocks blocks={body.slice(1)} />
          </>
        ) : (
          <>
            <Blocks blocks={body} />
            {buttons.length > 0 && <ButtonsRow buttons={buttons} />}
          </>
        )}
        {links.map((l) => (
          <NoticeLink key={l.key} c={l} />
        ))}
      </div>
    </section>
  );
}

function ButtonsRow({ buttons }: { buttons: ControlBlock[] }): JSX.Element {
  return (
    <div class="wa-equal">
      {buttons.map((c) => (
        <PillButton key={c.key} b={c} />
      ))}
    </div>
  );
}

/** The site's chat folds into one row at the end: it opens the chat on the page itself. */
export function ChatRow({ el }: { el: Element }): JSX.Element {
  const ctx = useCalm();
  const launcher =
    Array.from(el.querySelectorAll('button,[role=button],a[href]')).find((b) => /chat|assistant|message|help/i.test(`${nameOf(b)} ${b.getAttribute('class') ?? ''}`)) ?? el;
  return (
    <section class="wa-band wa-band--tight" aria-label="Chat with the site">
      <div class="wa-rows">
        <button type="button" class="wa-row" onClick={() => ctx.peek(launcher)}>
          <span class="wa-row__icon" aria-hidden="true">
            <I.Chat />
          </span>
          <span class="wa-row__main">
            <span class="wa-row__title">Chat with the site</span>
            <span class="wa-meta">Opens the site's own chat on the page.</span>
          </span>
          <I.ChevronRight class="wa-row__chev" />
        </button>
      </div>
    </section>
  );
}

/** The site's own progress through a multi-page flow, behind "Your application". Only what the page states. */
export function ProgressCard({ progress }: { progress: NonNullable<CalmPlan['progress']> }): JSX.Element {
  return (
    <section class="wa-band wa-band--tight" aria-label="Your application">
      <Disclosure title="Your application" sub={progress.stepText} quiet>
        <div class="wa-stack">
          <Blocks blocks={progress.blocks} />
        </div>
      </Disclosure>
    </section>
  );
}

/** After the main action: the page's confirmation, its reference number with Copy, the next steps, then help. */
export function SuccessPanel({ outcome, help }: { outcome: Outcome; help: Block[] }): JSX.Element {
  const ref = useRef<HTMLHeadingElement>(null);
  const ctx = useCalm();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'center', behavior: ctx.reduceMotion ? 'auto' : 'smooth' });
    ref.current?.focus({ preventScroll: true });
  }, [outcome.el]);
  const links = Array.from(outcome.el.querySelectorAll('a[href]')).slice(0, 2);
  const copy = (): void => {
    if (!outcome.ref) return;
    try {
      void navigator.clipboard?.writeText(outcome.ref).then(() => setCopied(true)).catch(() => undefined);
    } catch {
      /* clipboard not available */
    }
  };
  const linkTexts = new Set(links.map((a) => nameOf(a)));
  const lines = outcome.lines.filter((l) => !linkTexts.has(l) && (!outcome.ref || !l.includes(outcome.ref) || l.length > outcome.ref.length + 30));
  return (
    <section class="wa-band wa-band--first" aria-label="Done">
      <div class="wa-success" role="status">
        <span class="wa-success__icon" aria-hidden="true">
          <I.CheckCircle />
        </span>
        <h2 class="wa-h-section" tabIndex={-1} ref={ref}>
          {outcome.heading}
        </h2>
        {outcome.ref && (
          <div class="wa-success__ref">
            <span class="wa-success__refno">{outcome.ref}</span>
            <button type="button" class="wa-btn wa-btn--soft" onClick={copy}>
              <I.Copy />
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        )}
        {lines.map((l, i) => (
          <p key={i} class="wa-p">
            {l}
          </p>
        ))}
        {links.length > 0 && (
          <div class="wa-actions">
            {links.map((a, i) => (
              <InlineLink key={i} p={{ t: 'link', el: a, text: nameOf(a), href: (a as HTMLAnchorElement).href || null, help: false }} />
            ))}
          </div>
        )}
      </div>
      {help.length > 0 && (
        <div class="wa-band--tight">
          <HelpCard blocks={help} />
        </div>
      )}
    </section>
  );
}

/** The page's own error summary, at the top of the form. Each link goes to the step that holds the field. */
export function ErrorCard({ outcome }: { outcome: Outcome }): JSX.Element {
  const ctx = useCalm();
  const items = Array.from(outcome.el.querySelectorAll('a[href]')).map((a) => ({ el: a, text: nameOf(a) })).filter((x) => x.text);
  const title = outcome.heading && !items.some((i) => i.text === outcome.heading) ? outcome.heading : 'Please check these';
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'center', behavior: ctx.reduceMotion ? 'auto' : 'smooth' });
    ref.current?.focus({ preventScroll: true });
  }, [outcome.el]);
  return (
    <div class="wa-notice wa-notice--error" role="alert" tabIndex={-1} ref={ref}>
      <span class="wa-notice__icon" aria-hidden="true">
        <I.Alert />
      </span>
      <div class="wa-notice__body">
        <h2 class="wa-notice__title">{title}</h2>
        {items.length > 0 ? (
          <ul class="wa-errlist">
            {items.map((x, i) => (
              <li key={i}>
                <button type="button" class="wa-inline-link" onClick={() => ctx.click(x.el)}>
                  {x.text}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          outcome.lines.map((l, i) => (
            <p key={i} class="wa-p">
              {l}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

/** "Main links on this page": up to five rows, each the page's own link text, a short line from the page, a chevron. */
export function PortalLinks({ portal }: { portal: Portal }): JSX.Element {
  const ctx = useCalm();
  return (
    <section class="wa-band wa-band--task" aria-label="Main links on this page">
      <h2 class="wa-h-title wa-portal__title">Main links on this page</h2>
      <div class="wa-rows wa-portal">
        {portal.rows.map((r) => {
          const press = (e: MouseEvent): void => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            ctx.click(r.el);
          };
          const inner = (
            <>
              <span class="wa-row__main">
                <span class="wa-row__title">{r.text}</span>
                {r.blurb && <span class="wa-meta">{r.blurb}</span>}
              </span>
              <I.ChevronRight class="wa-row__chev" />
            </>
          );
          return r.href ? (
            <a key={r.key} class="wa-row" href={r.href} onClick={press}>
              {inner}
            </a>
          ) : (
            <button key={r.key} type="button" class="wa-row" onClick={() => ctx.click(r.el)}>
              {inner}
            </button>
          );
        })}
      </div>
    </section>
  );
}
