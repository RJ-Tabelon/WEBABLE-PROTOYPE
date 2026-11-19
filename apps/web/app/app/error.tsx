'use client';

import { Actions, Button, Disclosure } from '@webable/ui';
import { useEffect, useRef } from 'react';

import { PageHead } from '../../components/app/PageHead';

/** A page in the app failed to render. The frame and navigation stay usable. */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('h1')?.focus();
    console.error(error);
  }, [error]);

  return (
    <div className="wa-page" ref={ref}>
      <PageHead
        focusable
        eyebrow="Something went wrong"
        title="This page didn’t load"
        deck="The problem is on our side. Your fit and your settings are safe. Try again, or come back in a minute."
      >
        <Actions className="wa-page-head__actions">
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
      </PageHead>
      {error.digest ? (
        <Disclosure title="Details" density="compact" headingLevel={2}>
          <p className="wa-mono">Reference {error.digest}</p>
        </Disclosure>
      ) : null}
    </div>
  );
}
