import type { ReactNode } from 'react';

export interface SectionIntroProps {
  title: ReactNode;
  titleId: string;
  deck?: ReactNode;
  /**
   * `center`: title and deck centred above the content. `split`: title on the
   * left, deck on the right at wide widths. `start`: both on the text edge.
   */
  align?: 'center' | 'split' | 'start';
  /** Buttons or a link under the deck. */
  actions?: ReactNode;
  className?: string;
}

/** A section's h2 and its one or two sentences of deck. */
export function SectionIntro({
  title,
  titleId,
  deck,
  align = 'center',
  actions,
  className,
}: SectionIntroProps) {
  return (
    <header
      className={['wm-intro', `wm-intro--${align}`, className]
        .filter(Boolean)
        .join(' ')}
    >
      <h2 id={titleId} className="wm-h2">
        {title}
      </h2>
      {deck || actions ? (
        <div className="wm-intro__side">
          {deck ? <div className="wm-intro__deck">{deck}</div> : null}
          {actions ? <div className="wm-intro__actions">{actions}</div> : null}
        </div>
      ) : null}
    </header>
  );
}
