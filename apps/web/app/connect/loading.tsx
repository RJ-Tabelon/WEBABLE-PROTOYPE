/** Shown in the calm frame while the handoff page checks who is signed in. */
export default function ConnectLoading() {
  return (
    <div className="wa-connect" aria-busy="true">
      <p className="sr-only" role="status">
        Loading…
      </p>
      <div className="wa-loading" aria-hidden="true">
        <span className="wa-loading__bar wa-loading__bar--title" />
        <span className="wa-loading__bar wa-loading__bar--line" />
      </div>
    </div>
  );
}
