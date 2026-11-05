// Owner: C, U; round 8: Lucius (one quiet button). The frosted top bar of the simplified page: the site's short name,
// the page's help link on task pages, and "Original page". The page's own search, account and cart sit in a small row
// under the task (SubStrip). Round 8: no "New layout ready" line: the simplified page never shifts once it is shown.
import type { JSX } from 'preact';
import type { EngineApi } from '../../contracts';
import { Logo } from '../Logo';
import { proxyInput, proxySubmit } from '../proxy';
import { PillButton } from './Blocks';
import { useCalm } from './context';
import * as I from './icons';
import { useLive } from './live';
import type { Block, ControlBlock, FieldBlock } from './model';
import type { CalmPlan } from './plan';
import { leaves } from './sections/layouts';

function StripLink({ b, cls = 'wa-btn' }: { b: ControlBlock; cls?: string }): JSX.Element {
  const ctx = useCalm();
  const press = (e: MouseEvent): void => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    ctx.click(b.el);
  };
  const body = (
    <>
      {b.help && b.href?.startsWith('tel:') ? <I.Phone /> : b.help ? <I.Help /> : null}
      <span>{b.text}</span>
    </>
  );
  return b.href ? (
    <a class={cls} href={b.href} onClick={press}>
      {body}
    </a>
  ) : (
    <button type="button" class={cls} onClick={() => ctx.click(b.el)}>
      {body}
    </button>
  );
}

function SearchPill({ field, submit }: { field: FieldBlock; submit: ControlBlock | null }): JSX.Element | null {
  const ctx = useCalm();
  const live = useLive(field.el);
  if (live.kind !== 'text') return null;
  return (
    <form
      class="wa-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (submit) ctx.click(submit.el);
        else proxySubmit(field.el);
      }}
    >
      <label class="wa-search__field">
        <span class="wa-sr">{field.label || 'Search'}</span>
        <I.Search />
        <input
          type="search"
          value={live.value}
          placeholder={field.label && field.label.length <= 22 ? field.label : 'Search'}
          onInput={(e) => proxyInput(field.el, (e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      {submit && (
        <button type="submit" class="wa-btn">
          {submit.text}
        </button>
      )}
    </form>
  );
}

function StripItem({ blocks, skip, skipText }: { blocks: Block[]; skip: Element | null; skipText: string }): JSX.Element {
  const ls = leaves(blocks);
  const field = ls.find((b): b is FieldBlock => b.b === 'field');
  const controls = ls.filter((b): b is ControlBlock => b.b === 'control' && b.el !== skip && b.text.trim().toLowerCase() !== skipText);
  if (field) {
    const submit = controls.find((c) => c.role === 'button') ?? null;
    const others = controls.filter((c) => c !== submit);
    return (
      <>
        <SearchPill field={field} submit={submit} />
        {others.map((c) => (
          <span key={c.key} class="wa-strip__item">
            {c.role === 'link' ? <StripLink b={c} /> : <PillButton b={c} />}
          </span>
        ))}
      </>
    );
  }
  return (
    <>
      {controls.slice(0, 3).map((c) => (
        <span key={c.key} class="wa-strip__item">
          {c.role === 'link' ? <StripLink b={c} /> : <PillButton b={c} />}
        </span>
      ))}
    </>
  );
}

/** The page's own search, account and cart controls (under the task, unless the task is to search or find a page). */
export function SubStrip({ plan }: { plan: CalmPlan | null }): JSX.Element | null {
  if (!plan?.strip.length) return null;
  const skip = plan.helpLink?.el ?? null;
  const helpText = plan.helpLink?.text.trim().toLowerCase() ?? '';
  // The same link twice (a header "Contact Us" and a footer one) is shown once.
  const seen = new Set<string>();
  const items = plan.strip.filter((s) => {
    const ls = leaves(s.blocks).filter((b) => !(b.b === 'control' && (b.el === skip || b.text.trim().toLowerCase() === helpText)));
    const names = ls.filter((b): b is ControlBlock => b.b === 'control').map((c) => c.text.trim().toLowerCase()).filter(Boolean);
    const fresh = ls.some((b) => b.b === 'field') || (names.length > 0 && names.some((n) => !seen.has(n)));
    names.forEach((n) => seen.add(n));
    return fresh;
  });
  if (!items.length) return null;
  return (
    <nav class="wa-band wa-band--tight wa-substrip" aria-label="From the top of this page">
      {items.map((s) => (
        <StripItem key={s.key} blocks={s.blocks} skip={skip} skipText={helpText} />
      ))}
    </nav>
  );
}

/**
 * Round 8: the simplified page's top bar is quiet. The site's name, the page's own help link when it has a short
 * one, and one "Original page" button (closing the simplified page; WebAble remembers it for the site when the page
 * was simplified by itself). Text size, "What changed" and Pause live in WebAble's one button, as on every page.
 */
export function Strip(props: { api: EngineApi; plan: CalmPlan | null }): JSX.Element {
  const { api, plan } = props;
  const name = plan?.siteName ?? location.hostname.replace(/^www\./, '');
  // The page's help link only where the person has a task to finish (a form, a purchase): on a page to read it is noise.
  const task = !!plan && (!!plan.form || plan.kind === 'form' || !!plan.primary);
  const help = task && plan?.helpLink && plan.helpLink.text.trim().length <= 24 ? plan.helpLink : null;
  return (
    <header class="wa-strip" data-level="0">
      <div class="wa-strip__in">
        <div class="wa-brand">
          <Logo size={24} />
          <span class="wa-brand__name" title={name}>
            {name}
          </span>
        </div>
        <div class="wa-strip__tools">
          {help && (
            <span class="wa-strip__help">
              <StripLink b={help} cls="wa-btn wa-btn--quiet wa-btn--helplink" />
            </span>
          )}
          <button type="button" class="wa-btn wa-btn--quiet wa-strip__orig" onClick={() => api.closeCalm()}>
            Original page
          </button>
        </div>
      </div>
    </header>
  );
}
