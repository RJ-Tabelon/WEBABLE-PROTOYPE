import { SectionHeader } from '@webable/ui';
import type { ReactNode } from 'react';
import { DocToc, type TocEntry } from './DocToc';

export type { TocEntry };

export interface DocPageProps {
  /** A fact above the title, for example the date the page was last changed. */
  eyebrow?: ReactNode;
  title: ReactNode;
  deck?: ReactNode;
  /** Sections for the "On this page" list, in order. Each needs a `DocSection` with the same id. */
  toc: readonly TocEntry[];
  /**
   * Keep a note column right of the text at ≥80em, for sources beside their
   * block (the research page). Section rules and tables span it; running text
   * keeps the reading measure.
   */
  notes?: boolean;
  children: ReactNode;
}

/**
 * A document page in Reading density (design-final §14). One text edge: at ≥64em
 * the header (eyebrow, h1, deck) and every section sit in the second column, and
 * "On this page" sits in the first, sticky, marking the section being read. Below
 * 64em the list folds into one closed row above the text. Nothing in the text is
 * collapsed, so find-in-page and help always reach it.
 */
export function DocPage({
  eyebrow,
  title,
  deck,
  toc,
  notes = false,
  children,
}: DocPageProps) {
  return (
    <article
      aria-labelledby="doc-title"
      className={`wa-container ws-doc${notes ? ' ws-doc--notes' : ''}`}
    >
      <header className="ws-doc-head">
        {eyebrow ? <p className="ws-doc-head__eyebrow">{eyebrow}</p> : null}
        <h1 id="doc-title" className="ws-doc-head__title">
          {title}
        </h1>
        {deck ? <p className="ws-doc-head__deck">{deck}</p> : null}
      </header>
      <DocToc entries={toc} />
      <div className="ws-doc__content">{children}</div>
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
