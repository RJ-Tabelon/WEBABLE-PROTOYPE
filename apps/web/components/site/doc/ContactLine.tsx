import { TextLink } from '@webable/ui';
import { CONTACT } from '../contact';

/** The one contact link, used on every document page. */
export function ContactLine({ lead }: { lead?: string }) {
  return (
    <p>
      {lead ? `${lead} ` : null}
      <TextLink href={CONTACT.href}>{CONTACT.label}</TextLink>
      {CONTACT.kind === 'email' ? '.' : null}
    </p>
  );
}

/** When the site's documents were last changed. */
export const DOCS_UPDATED = '29 September 2026';
