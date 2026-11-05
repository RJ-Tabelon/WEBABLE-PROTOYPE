// The quiet frame around every step: the top bar with the Reading · Pointing · Finding ruler. Nothing in the frame
// tells the person a result while the flow runs (round 8c); what we learned is shown once, at the end.

import type { JSX } from 'preact';
import type { PartId } from '../logic/steps';
import { Logo } from '../../../src/ui/Logo';

export function CheckIcon(props: { size?: number }): JSX.Element {
  const s = props.size ?? 16;
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden="true" class="fl-check">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function Wordmark(): JSX.Element {
  return (
    <div class="fl-wordmark">
      <Logo />
      WebAble
    </div>
  );
}

export function TopBar(props: {
  parts: Array<{ id: PartId; label: string }> | null;
  current: PartId | null;
  done: ReadonlySet<PartId>;
  /** A soft check on the current part, just after an answer. */
  ticking: boolean;
  onSkip: (() => void) | null;
}): JSX.Element {
  return (
    <header class="fl-top">
      <Wordmark />
      {props.parts ? (
        <nav class="fl-ruler" aria-label="Progress">
          <ol>
            {props.parts.map((p, i) => {
              const done = props.done.has(p.id);
              const current = !done && p.id === props.current;
              const state = done ? 'is-done' : current ? 'is-current' : 'is-next';
              return (
                <>
                  {i > 0 ? <li class={`fl-rule ${done || current ? 'is-past' : ''}`} aria-hidden="true" /> : null}
                  <li class={`fl-seg ${state}`} aria-current={current ? 'step' : undefined}>
                    <span class={`fl-seg-mark ${current && props.ticking ? 'is-ticking' : ''}`} aria-hidden="true">
                      <span class="fl-seg-dot" />
                      <CheckIcon size={16} />
                    </span>
                    <span class="fl-seg-label">{p.label}</span>
                    {done ? <span class="visually-hidden">, done</span> : null}
                  </li>
                </>
              );
            })}
          </ol>
        </nav>
      ) : (
        <span />
      )}
      <div class="fl-top-end">
        {props.onSkip ? (
          <button type="button" class="btn-text fl-skip" onClick={props.onSkip} data-answer="skip-all">
            Skip for now
          </button>
        ) : null}
      </div>
    </header>
  );
}
