// Line icons for the results page: 1.75 strokes, round ends, drawn in currentColor.
import type { JSX } from 'preact';
import type { StruggleId } from './needs';

const line = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.75,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const;

function Svg({ size = 28, children }: { size?: number; children: JSX.Element | JSX.Element[] }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false" {...line}>
      {children}
    </svg>
  );
}

/** One icon per struggle. */
export function StruggleIcon({ id }: { id: StruggleId }): JSX.Element {
  switch (id) {
    case 'text':
      // A large and a small letter A.
      return (
        <Svg>
          <path d="M3.5 22 9.75 6h.5L16.5 22" />
          <path d="M5.9 16.2h8.2" />
          <path d="M16.8 22l3.7-9.2h.5l3.7 9.2" />
          <path d="M18.2 18.8h4.6" />
        </Svg>
      );
    case 'faint':
      // Half light, half dark.
      return (
        <Svg>
          <circle cx="14" cy="14" r="9.25" />
          <path d="M14 4.75a9.25 9.25 0 0 1 0 18.5Z" fill="currentColor" />
        </Svg>
      );
    case 'buttons':
      // A button with a pointer on it.
      return (
        <Svg>
          <rect x="3.5" y="6" width="21" height="11" rx="5.5" />
          <path d="M14.5 13.5l6.2 2.4-2.7 1.1 2.6 3.4-1.5 1.1-2.6-3.4-1.6 2.5Z" fill="currentColor" stroke-width="1.25" />
        </Svg>
      );
    case 'slips':
      // A target with the dot in the middle.
      return (
        <Svg>
          <circle cx="14" cy="14" r="9.25" />
          <circle cx="14" cy="14" r="4.5" />
          <circle cx="14" cy="14" r="1.2" fill="currentColor" />
        </Svg>
      );
    case 'busy':
      // A crowded page.
      return (
        <Svg>
          <rect x="4.75" y="3.75" width="18.5" height="20.5" rx="3" />
          <path d="M8.5 8.5h11M8.5 12h4.5M8.5 15.5h4.5M8.5 19h11" />
          <rect x="15.5" y="11.25" width="4" height="5" rx="1" />
        </Svg>
      );
    case 'motion':
      // Something sliding past.
      return (
        <Svg>
          <rect x="9.5" y="7.5" width="14" height="13" rx="3" />
          <path d="M3.5 11h3M2.5 14h4M3.5 17h3" />
        </Svg>
      );
  }
}

/** The accent check before "WebAble fixes this:". */
export function CheckIcon(): JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...line} stroke-width={2.25}>
      <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
      <path d="M7.5 12.3l3 3 6-6.3" stroke="#fff" />
    </svg>
  );
}

/** Opens in a new tab. */
export function OutIcon(): JSX.Element {
  return (
    <Svg size={24}>
      <path d="M10 6.5h11.5V18" stroke-width="2" />
      <path d="M21 7 7 21" stroke-width="2" />
    </Svg>
  );
}

export function MinusIcon(): JSX.Element {
  return (
    <Svg size={24}>
      <path d="M7 14h14" stroke-width="2.25" />
    </Svg>
  );
}

export function PlusIcon(): JSX.Element {
  return (
    <Svg size={24}>
      <path d="M7 14h14M14 7v14" stroke-width="2.25" />
    </Svg>
  );
}
