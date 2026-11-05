// Welcome: one sentence of promise, how long it takes, and Start. The input type is inferred from how Start is
// pressed, never asked.

import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

function ReadIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <text x="16" y="22.5" text-anchor="middle" font-size="18" font-weight="600" fill="currentColor" font-family="system-ui, -apple-system, sans-serif">
        Aa
      </text>
    </svg>
  );
}

function PointIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" stroke-width="2" />
      <circle cx="16" cy="16" r="3.5" fill="currentColor" />
    </svg>
  );
}

function FindIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <circle cx="14" cy="14" r="8" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="m20 20 6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  );
}

export function Welcome(props: { onStart: (e: MouseEvent) => void; onSkip: () => void }): JSX.Element {
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    h.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section class="fl-welcome card">
      <div class="fl-welcome-mark" aria-hidden="true">
        <span />
      </div>
      <h1 class="fl-welcome-title" ref={h} tabIndex={-1}>
        Let’s set up the web for you.
      </h1>
      <p class="fl-welcome-deck">Three short parts: reading, pointing and finding. About two minutes. There are no wrong answers.</p>
      <ul class="fl-welcome-parts" aria-hidden="true">
        <li>
          <span class="fl-welcome-icon">
            <ReadIcon />
          </span>
          Reading
        </li>
        <li>
          <span class="fl-welcome-icon">
            <PointIcon />
          </span>
          Pointing
        </li>
        <li>
          <span class="fl-welcome-icon">
            <FindIcon />
          </span>
          Finding
        </li>
      </ul>
      <div class="fl-welcome-actions">
        <button type="button" class="btn btn-primary fl-btn-wide" onClick={props.onStart} data-answer="start">
          Start
        </button>
        <button type="button" class="btn-text" onClick={props.onSkip} data-answer="skip">
          Skip for now
        </button>
      </div>
      <p class="fl-welcome-note">Sit how you usually do, and wear your glasses if you use them.</p>
    </section>
  );
}
