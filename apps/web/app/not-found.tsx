import { Actions, Button, IndexRule } from '@webable/ui';
import type { Metadata } from 'next';
import { SiteShell } from '../components/shell/SiteShell';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false },
};

export default function NotFound() {
  return (
    <SiteShell>
      <section
        className="wa-container wa-status-page"
        aria-labelledby="not-found-title"
      >
        <IndexRule />
        <p className="wa-status-page__eyebrow">Error 404</p>
        <h1 id="not-found-title" className="wa-status-page__title">
          This page isn’t here.
        </h1>
        <p className="wa-status-page__deck">
          The link may be out of date, or the address may have a typo. Your fit
          and your settings are unchanged.
        </p>
        <Actions className="wa-status-page__actions">
          <Button href="/" variant="primary" arrow="forward">
            Go to the home page
          </Button>
          <Button href="/help" variant="secondary">
            Get help
          </Button>
        </Actions>
      </section>
    </SiteShell>
  );
}
