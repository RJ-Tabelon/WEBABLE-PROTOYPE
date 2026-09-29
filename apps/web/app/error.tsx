'use client';

import { Actions, Button, Disclosure, IndexRule } from '@webable/ui';
import { useEffect, useRef } from 'react';
import { SiteShell } from '../components/shell/SiteShell';

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // Move focus to the explanation so it is announced first.
    headingRef.current?.focus();
    console.error(error);
  }, [error]);

  return (
    <SiteShell>
      <section
        className="wa-container wa-status-page"
        aria-labelledby="error-title"
      >
        <IndexRule />
        <p className="wa-status-page__eyebrow">Something went wrong</p>
        <h1
          id="error-title"
          ref={headingRef}
          tabIndex={-1}
          className="wa-status-page__title"
        >
          This page didn’t load.
        </h1>
        <p className="wa-status-page__deck">
          The problem is on our side. Your fit and your settings are safe. Try
          again, or come back in a minute.
        </p>
        <Actions className="wa-status-page__actions">
          <Button
            variant="primary"
            iconStart="refresh-cw"
            onClick={() => retry()}
          >
            Try again
          </Button>
          <Button href="/help" variant="secondary">
            Get help
          </Button>
        </Actions>
        {error.digest ? (
          <div className="wa-status-page__details">
            <Disclosure title="Details" density="compact" headingLevel={2}>
              <p className="wa-mono">Reference {error.digest}</p>
            </Disclosure>
          </div>
        ) : null}
      </section>
    </SiteShell>
  );
}
