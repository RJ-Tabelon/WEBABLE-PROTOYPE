/** First tab stop on every page (design-final §7.8). Targets `<main id="main">`. */
export function SkipLink({ target = 'main' }: { target?: string }) {
  return (
    <a className="wa-skip" href={`#${target}`}>
      Skip to content
    </a>
  );
}
