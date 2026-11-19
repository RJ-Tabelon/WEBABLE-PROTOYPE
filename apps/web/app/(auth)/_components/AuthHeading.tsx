import type { ReactNode } from 'react';

export interface AuthHeadingProps {
  /** A fact, not a category. Optional. */
  eyebrow?: ReactNode;
  title: ReactNode;
  deck?: ReactNode;
}

/** The page's one h1 with its deck (Task density: h1 32/44, body 18). */
export function AuthHeading({ eyebrow, title, deck }: AuthHeadingProps) {
  return (
    <header className="wa-auth-head">
      {eyebrow ? <p className="wa-auth-head__eyebrow">{eyebrow}</p> : null}
      <h1 className="wa-auth-title">{title}</h1>
      {deck ? <p className="wa-auth-deck">{deck}</p> : null}
    </header>
  );
}

export interface AuthNoticeProps {
  children: ReactNode;
  icon?: ReactNode;
}

/** A neutral notice above a form ("You're signed out."). Not an error. */
export function AuthNotice({ children, icon }: AuthNoticeProps) {
  return (
    <div className="wa-auth-notice" role="status">
      {icon}
      <div>{children}</div>
    </div>
  );
}
