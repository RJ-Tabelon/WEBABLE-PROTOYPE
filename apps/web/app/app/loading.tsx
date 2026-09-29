/**
 * Shown inside the app frame while a page's data loads. Static shapes only (no
 * shimmer): motion is reserved for things that change. The status text is the
 * accessible message.
 */
export default function AppLoading() {
  return (
    <div className="wa-loading" aria-busy="true">
      <p className="sr-only" role="status">
        Loading…
      </p>
      <span
        className="wa-loading__bar wa-loading__bar--title"
        aria-hidden="true"
      />
      <span
        className="wa-loading__bar wa-loading__bar--line"
        aria-hidden="true"
      />
      <div className="wa-loading__rows" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
