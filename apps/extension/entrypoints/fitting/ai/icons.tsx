// Line icons for the AI answer screens and the Results card, in the results page's style: 1.75 strokes, round ends,
// drawn in currentColor.
import type { JSX } from 'preact';

/** A speech bubble with two lines of text: how things are explained. */
export function ExplainIcon(): JSX.Element {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M6 5.5h16a2.5 2.5 0 0 1 2.5 2.5v9a2.5 2.5 0 0 1-2.5 2.5h-8.5l-5 4v-4H6A2.5 2.5 0 0 1 3.5 17V8A2.5 2.5 0 0 1 6 5.5Z" />
      <path d="M8.5 10.5h11M8.5 14.5h7" />
    </svg>
  );
}
