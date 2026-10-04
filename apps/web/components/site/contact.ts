/**
 * How to reach the WebAble team. Help and contact are never hidden (WCAG 3.2.6),
 * so every document page links here.
 *
 * Contact is the team's support address, NEXT_PUBLIC_CONTACT_EMAIL, as a mailto
 * link. Only in development and tests, when no address is set, does it fall back
 * to the project's issue tracker. A production build without a valid address
 * fails loudly instead of shipping a page with no way to reach anyone.
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

export class ContactConfigError extends Error {
  constructor() {
    super(
      'NEXT_PUBLIC_CONTACT_EMAIL must be set to a valid address in production. ' +
        'The site links to it from Help, Privacy and the accessibility statement.',
    );
    this.name = 'ContactConfigError';
  }
}

/**
 * Resolve the contact channel from a configured address (validated). Outside
 * production, a missing or invalid address falls back to the issue tracker; in
 * production it throws.
 */
export function resolveContact(
  configured: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): Contact {
  const email = configured?.trim();
  if (email && EMAIL.test(email)) {
    return { kind: 'email', href: `mailto:${email}`, label: email };
  }
  if (nodeEnv === 'production') throw new ContactConfigError();
  return {
    kind: 'issues',
    href: ISSUES_URL,
    label: 'Write to the team on GitHub',
  };
}

export const CONTACT: Contact = resolveContact(
  process.env.NEXT_PUBLIC_CONTACT_EMAIL,
);
