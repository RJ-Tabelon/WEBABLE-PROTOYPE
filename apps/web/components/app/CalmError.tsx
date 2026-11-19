'use client';

import { Actions, Button, Disclosure } from '@webable/ui';
import { useEffect, useRef } from 'react';

export interface CalmErrorProps {
  error: Error & { digest?: string };
  retry: () => void;
}

/** Error state inside the calm frame (account pages, Connect). Focus moves to the heading. */
export function CalmError({ error, retry }: CalmErrorProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    console.error(error);
  }, [error]);

  return (
    <div className="wa-connect">
      <header className="wa-auth-head">
        <p className="wa-auth-head__eyebrow">Something went wrong</p>
        <h1 ref={headingRef} tabIndex={-1} className="wa-auth-title">
          This page didn’t load
        </h1>
        <p className="wa-auth-deck">
          The problem is on our side. Nothing changed. Try again, or come back
          in a minute.
        </p>
      </header>
      <Actions>
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
        <Disclosure title="Details" density="compact" headingLevel={2}>
          <p className="wa-mono">Reference {error.digest}</p>
        </Disclosure>
      ) : null}
    </div>
  );
}
