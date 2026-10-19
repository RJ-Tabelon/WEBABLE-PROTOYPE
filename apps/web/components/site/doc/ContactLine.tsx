import { TextLink } from '@webable/ui';
import { CONTACT } from '../contact';

/**
 * The one contact link, used on every document page. No full stop after an email
 * address, so copying it never picks one up.
 */
export function ContactLine({ lead }: { lead?: string }) {
  return (
    <p>
      {lead ? `${lead} ` : null}
      <TextLink href={CONTACT.href}>{CONTACT.label}</TextLink>
    </p>
  );
}

/** When the site's documents were last changed. */
export const DOCS_UPDATED = '29 September 2026';

/** When the privacy policy last changed (Fit view layouts and page scale, docs/10 §8). */
export const PRIVACY_UPDATED = '15 October 2026';
