// Owner: L. Inline SVG icons for the Jev Lens (no url(), no external assets). All use currentColor.
import type { JSX } from 'preact';
import type { LensClass } from './display';
import type { FineFamily } from './words';

type P = { size?: number };

function Svg(props: P & { children: JSX.Element | JSX.Element[]; fill?: boolean; sw?: number }) {
  const s = props.size ?? 12;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill={props.fill ? 'currentColor' : 'none'}
      stroke={props.fill ? 'none' : 'currentColor'}
      stroke-width={props.sw ?? 2.4}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {props.children}
    </svg>
  );
}

export const IDiamond = (p: P) => (
  <Svg {...p} fill>
    <path d="M12 2.5 21.5 12 12 21.5 2.5 12z" />
  </Svg>
);
export const IStar = (p: P) => (
  <Svg {...p} fill>
    <path d="M12 2.8 14.8 8.7l6.4.7-4.8 4.4 1.4 6.4L12 17l-5.8 3.2 1.4-6.4-4.8-4.4 6.4-.7z" />
  </Svg>
);
export const IFold = (p: P) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const IShield = (p: P) => (
  <Svg {...p} sw={2.2}>
    <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6z" />
  </Svg>
);
export const IPopup = (p: P) => (
  <Svg {...p} sw={2.2}>
    <rect x="4" y="5" width="16" height="14" rx="2.5" />
    <path d="M4 9.5h16" />
  </Svg>
);
export const IQuestion = (p: P) => (
  <Svg {...p} sw={2.4}>
    <path d="M9.2 9.2a2.9 2.9 0 1 1 4.3 2.5c-.9.5-1.5 1.2-1.5 2.2v.4" />
    <path d="M12 18.2h.01" />
  </Svg>
);
export const IDot = (p: P) => (
  <Svg {...p} fill>
    <circle cx="12" cy="12" r="4" />
  </Svg>
);
export const IRule = (p: P) => (
  <Svg {...p} sw={2}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" stroke-dasharray="3 3" />
  </Svg>
);
export const IClose = (p: P) => (
  <Svg {...p} sw={2}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IChevronRight = (p: P) => (
  <Svg {...p} sw={2.2}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
export const IChevronDown = (p: P) => (
  <Svg {...p} sw={2.2}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const IArrowUp = (p: P) => (
  <Svg {...p} sw={2.2}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);
export const IArrowDown = (p: P) => (
  <Svg {...p} sw={2.2}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
);
export const ICopy = (p: P) => (
  <Svg {...p} sw={2}>
    <rect x="8" y="8" width="12" height="12" rx="2.5" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </Svg>
);
export const ICheck = (p: P) => (
  <Svg {...p} sw={2.4}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
/** Corner marks: the region that holds what the page is for. */
export const IRegion = (p: P) => (
  <Svg {...p} sw={2.2}>
    <path d="M9 4H5.5A1.5 1.5 0 0 0 4 5.5V9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15M15 20h3.5a1.5 1.5 0 0 0 1.5-1.5V15" />
  </Svg>
);

export function ClassIcon({ cls, size }: { cls: LensClass | 'rule' | 'page' | FineFamily; size?: number }) {
  switch (cls) {
    case 'main':
      return <IStar size={size} />;
    case 'folded':
      return <IFold size={size} />;
    case 'guarded':
      return <IShield size={size} />;
    case 'popup':
      return <IPopup size={size} />;
    case 'unsure':
      return <IQuestion size={size} />;
    case 'rule':
      return <IRule size={size} />;
    case 'page':
      return <IRegion size={size} />;
    default:
      return <IDot size={size} />;
  }
}
