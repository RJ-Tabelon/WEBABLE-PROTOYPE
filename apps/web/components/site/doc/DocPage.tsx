import { SectionHeader } from '@webable/ui';
import type { ReactNode } from 'react';

export interface TocEntry {
  id: string;
  title: string;
}

export interface DocPageProps {
  /** A fact above the title, for example the date the page was last changed. */
  eyebrow?: ReactNode;
  title: ReactNode;
  deck?: ReactNode;
  /** Sections for the "On this page" list, in order. Each needs a `DocSection` with the same id. */
  toc: readonly TocEntry[];
  children: ReactNode;
}

/**
 * A document page in Reading density (design-final §14): h1 and deck, an
 * "On this page" list, then sections with index-rule headers at the reading
 * measure. Nothing is collapsed, so find-in-page and help always reach the text.
 */
export function DocPage({ eyebrow, title, deck, toc, children }: DocPageProps) {
  return (
    <article aria-labelledby="doc-title">
      <header className="wa-container ws-doc-head">
        {eyebrow ? <p className="ws-doc-head__eyebrow">{eyebrow}</p> : null}
        <h1 id="doc-title" className="ws-doc-head__title">
          {title}
        </h1>
        {deck ? <p className="ws-doc-head__deck">{deck}</p> : null}
      </header>
      <div className="wa-container ws-doc">
        <nav className="ws-toc" aria-labelledby="doc-toc">
          <p id="doc-toc" className="ws-toc__head">
            On this page
          </p>
          <ul role="list" className="ws-toc__list">
            {toc.map((entry) => (
              <li key={entry.id}>
                <a className="ws-toc__link" href={`#${entry.id}`}>
                  {entry.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ws-doc__content">{children}</div>
      </div>
    </article>
  );
}

export interface DocSectionProps {
  id: string;
  title: ReactNode;
  /** A fact, not a category. */
  eyebrow?: ReactNode;
  deck?: ReactNode;
  children: ReactNode;
}

/** One section of a document: an index-rule header (h2) and running text. */
export function DocSection({
  id,
  title,
  eyebrow,
  deck,
  children,
}: DocSectionProps) {
  const titleId = `${id}-title`;
  return (
    <section id={id} className="ws-doc-section" aria-labelledby={titleId}>
      <SectionHeader
        title={title}
        titleId={titleId}
        eyebrow={eyebrow}
        deck={deck}
      />
      <div className="ws-prose">{children}</div>
    </section>
  );
}

export interface FactProps {
  term: ReactNode;
  children: ReactNode;
  /** Where it is kept and for how long (meta line). */
  meta?: ReactNode;
}

/** One row of a key–value list inside `<dl className="ws-facts">`. */
export function Fact({ term, children, meta }: FactProps) {
  return (
    <div className="ws-facts__row">
      <dt>{term}</dt>
      <dd>
        {children}
        {meta ? <span className="ws-facts__meta">{meta}</span> : null}
      </dd>
    </div>
  );
}
