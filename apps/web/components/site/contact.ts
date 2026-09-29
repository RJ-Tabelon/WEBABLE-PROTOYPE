/**
 * How to reach the WebAble team. Help and contact are never hidden (WCAG 3.2.6),
 * so every document page links here.
 *
 * Set NEXT_PUBLIC_CONTACT_EMAIL to the team's support address. Until it is set,
 * contact goes to the project's issue tracker, which the team reads.
 */

const EMAIL = /^[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}$/i;

/** The team's repository issue tracker (read-only git remote, `origin`). */
export const ISSUES_URL =
  'https://github.com/RJ-Tabelon/WEBABLE-PROTOYPE/issues';

export interface Contact {
  kind: 'email' | 'issues';
  /** Link target: a mailto: address or the issue tracker. */
  href: string;
  /** Visible text for the link. */
  label: string;
}

/** Resolve the contact channel from a configured address (validated), else the tracker. */
export function resolveContact(configured: string | undefined): Contact {
  const email = configured?.trim();
  if (email && EMAIL.test(email)) {
    return { kind: 'email', href: `mailto:${email}`, label: email };
  }
  return {
    kind: 'issues',
    href: ISSUES_URL,
    label: 'Write to the team on GitHub',
  };
}

export const CONTACT: Contact = resolveContact(
  process.env.NEXT_PUBLIC_CONTACT_EMAIL,
);
