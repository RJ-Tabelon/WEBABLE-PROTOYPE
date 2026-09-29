import { SectionHeader } from '@webable/ui';
import type { ReactNode } from 'react';

export interface PageHeadProps {
  /** A fact, not a category ("Version 3 · saved Sep 29, 2026"). */
  eyebrow?: ReactNode;
  title: ReactNode;
  deck?: ReactNode;
  /** Status line or actions under the deck. */
  children?: ReactNode;
  titleId?: string;
  /** Let script move focus to the title (errors, finished steps). */
  focusable?: boolean;
}

/** An app page's title block: the page's one h1, at the h2 step (§7.9, §14). */
export function PageHead({
  eyebrow,
  title,
  deck,
  children,
  titleId,
  focusable,
}: PageHeadProps) {
  return (
    <header className="wa-page-head">
      {eyebrow ? <p className="wa-page-head__eyebrow">{eyebrow}</p> : null}
      <h1
        id={titleId}
        className="wa-page-title"
        tabIndex={focusable ? -1 : undefined}
      >
        {title}
      </h1>
      {deck ? <p className="wa-page-head__deck">{deck}</p> : null}
      {children}
    </header>
  );
}

export interface AppSectionProps {
  id: string;
  title: ReactNode;
  eyebrow?: ReactNode;
  deck?: ReactNode;
  link?: { href: string; label: ReactNode };
  children: ReactNode;
}

/** A document section: index rule, eyebrow fact, h2 and deck, then its rows. */
export function AppSection({
  id,
  title,
  eyebrow,
  deck,
  link,
  children,
}: AppSectionProps) {
  const titleId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={titleId} className="wa-app-section">
      <SectionHeader
        as="h2"
        titleId={titleId}
        title={title}
        eyebrow={eyebrow}
        deck={deck}
        link={link}
        className="wa-app-section-head"
      />
      <div className="wa-app-section__body">{children}</div>
    </section>
  );
}
