// Owner: C. A labelled drawer with a count. Content renders only when open; nothing inside is ever deleted.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { ChevronDown } from './icons';

export function Disclosure(props: {
  title: string;
  count?: number | null;
  sub?: string | null;
  defaultOpen?: boolean;
  headingLevel?: 2 | 3;
  /** Opens the disclosure (and scrolls it into view) whenever this number changes. */
  openCall?: number;
  quiet?: boolean;
  children: ComponentChildren;
}): JSX.Element {
  const [open, setOpen] = useState(!!props.defaultOpen);
  const body = useId();
  const root = useRef<HTMLDivElement>(null);
  const first = useRef(props.openCall);
  useEffect(() => {
    if (props.openCall === undefined || props.openCall === first.current) return;
    setOpen(true);
    requestAnimationFrame(() => root.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }, [props.openCall]);
  const H = props.headingLevel === 3 ? 'h3' : 'h2';
  return (
    <div class={`wa-disc${props.quiet ? ' wa-disc--quiet' : ''}`} data-open={open || undefined} ref={root}>
      <H>
        <button type="button" class="wa-disc__sum" aria-expanded={open} aria-controls={body} onClick={() => setOpen(!open)}>
          <span class="wa-disc__text">
            <span class="wa-disc__title">{props.title}</span>
            {props.sub && <span class="wa-disc__sub">{props.sub}</span>}
          </span>
          {props.count != null && props.count > 0 && <span class="wa-chipcount">{props.count}</span>}
          <span class="wa-chev" aria-hidden="true">
            <ChevronDown />
          </span>
        </button>
      </H>
      {open && (
        <div class="wa-disc__body wa-fade" id={body}>
          {props.children}
        </div>
      )}
    </div>
  );
}

/** A disclosure that sits in running text ("About this page"): a quiet toggle, then a well card under the line. */
export function InlineDisclosure(props: { label: string; children: ComponentChildren }): JSX.Element {
  const [open, setOpen] = useState(false);
  const body = useId();
  return (
    <>
      <button type="button" class="wa-about" aria-expanded={open} aria-controls={body} onClick={() => setOpen(!open)}>
        <span>{props.label}</span>
        <ChevronDown class="wa-about__chev" />
      </button>
      {open && (
        <div class="wa-aboutwell wa-fade" id={body}>
          {props.children}
        </div>
      )}
    </>
  );
}
