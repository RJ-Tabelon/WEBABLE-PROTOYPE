// Owner: C. Inline SVG icons (no url(), no network). All decorative: aria-hidden.
import type { JSX } from 'preact';

type P = { class?: string };
const base = (cls: string | undefined): JSX.SVGAttributes<SVGSVGElement> => ({
  class: cls,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 2,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
  focusable: 'false',
});

export const ChevronDown = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}><path d="M6 9l6 6 6-6" /></svg>
);
export const ChevronRight = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}><path d="M9 6l6 6-6 6" /></svg>
);
export const Check = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)} stroke-width={3}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const Search = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
);
export const Close = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const Phone = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}>
    <path d="M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 6.3 6.3l1.4-2.2L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z" />
  </svg>
);
export const Mail = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M4 7l8 6 8-6" /></svg>
);
export const Help = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.8M12 17.2h.01" /></svg>
);
export const Alert = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5h.01" /></svg>
);
export const Shield = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" /></svg>
);
export const Play = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}><circle cx="12" cy="12" r="9" /><path d="M10 8.5l5.5 3.5-5.5 3.5z" /></svg>
);
export const Lock = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>
);
export const Copy = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></svg>
);
export const CheckCircle = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}><circle cx="12" cy="12" r="9.5" /><path d="M7.8 12.4l2.9 2.9 5.6-6" /></svg>
);
export const Chat = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z" /></svg>
);
export const Spark = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}><path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" /><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></svg>
);
export const ArrowLeft = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
);
export const Print = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}><path d="M7 9V4h10v5M7 17H5.5A1.5 1.5 0 0 1 4 15.5v-5A1.5 1.5 0 0 1 5.5 9h13a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17" /><rect x="7" y="14" width="10" height="6" rx="1" /></svg>
);
export const Bookmark = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}><path d="M7 4h10v16l-5-3.5L7 20z" /></svg>
);
export const Speaker = ({ class: c }: P): JSX.Element => (
  <svg {...base(c)}><path d="M5 9.5h3l4.5-4v13L8 14.5H5z" /><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" /></svg>
);
