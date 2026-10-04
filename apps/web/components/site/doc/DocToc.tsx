'use client';

import { Icon } from '@webable/ui';
import { useEffect, useState } from 'react';

export interface TocEntry {
  id: string;
  title: string;
}

/**
 * The section, as a thin band a quarter of the way down the viewport: a section
 * is "where you are" while it crosses that band. Sections are contiguous, so at
 * most one crosses it at a time.
 */
const BAND = '-25% 0px -74% 0px';

/** The id of the section being read, from an IntersectionObserver (scroll-spy). */
function useActiveSection(idList: string): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const sections = idList
      .split(' ')
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0 || typeof IntersectionObserver === 'undefined')
      return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: BAND },
    );
    for (const section of sections) observer.observe(section);

    // A short last section may never reach the band: at the end of the page it is
    // the one being read. Above the first section, nothing is.
    const onScroll = () => {
      const end =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2;
      if (end) setActive(sections[sections.length - 1]!.id);
      else if (
        sections[0]!.getBoundingClientRect().top >
        window.innerHeight / 4
      )
        setActive(null);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, [idList]);

  return active;
}

function TocList({
  entries,
  active,
}: {
  entries: readonly TocEntry[];
  active: string | null;
}) {
  return (
    <ul role="list" className="ws-toc__list">
      {entries.map((entry) => (
        <li key={entry.id}>
          <a
            className="ws-toc__link"
            href={`#${entry.id}`}
            aria-current={entry.id === active ? 'location' : undefined}
          >
            {entry.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * "On this page". At ≥64em a sticky list in the document's first column, with the
 * section being read marked `aria-current="location"`. Below that, the same list
 * inside a closed `<details>`: one 48 px row above the text.
 */
export function DocToc({ entries }: { entries: readonly TocEntry[] }) {
  const active = useActiveSection(entries.map((e) => e.id).join(' '));
  return (
    <nav className="ws-toc" aria-label="On this page">
      <details className="ws-toc__details">
        <summary className="ws-toc__summary">
          On this page
          <Icon name="chevron-down" size={20} className="ws-toc__chevron" />
        </summary>
        <TocList entries={entries} active={active} />
      </details>
      <div className="ws-toc__rail">
        <p className="ws-toc__head" aria-hidden="true">
          On this page
        </p>
        <TocList entries={entries} active={active} />
      </div>
    </nav>
  );
}
