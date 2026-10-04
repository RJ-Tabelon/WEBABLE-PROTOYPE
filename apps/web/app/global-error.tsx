'use client';

import '@webable/tokens/fonts.css';
import '@webable/tokens/tokens.css';
import '@webable/tokens/base.css';
import '@webable/ui/styles.css';
import '../components/shell/shell.css';
import './globals.css';

import { Button, IndexRule, Wordmark } from '@webable/ui';
import { useEffect } from 'react';
import { applyFitUi, readFitUi } from '../components/shell/fit-ui';
import { applyTheme, readTheme } from '../components/shell/theme';

/** Last-resort boundary: replaces the root layout, so it renders its own document. */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // This document replaces the root layout, so re-apply the person's theme and fit here.
  useEffect(() => {
    applyTheme(readTheme());
    applyFitUi(readFitUi());
  }, []);

  return (
    <html lang="en">
      <head>
        <title>Something went wrong · WebAble</title>
      </head>
      <body>
        <main id="main" className="wa-container wa-status-page">
          <p className="wa-status-page__brand">
            <Wordmark />
          </p>
          <IndexRule />
          <p className="wa-status-page__eyebrow">Something went wrong</p>
          <h1 className="wa-status-page__title">WebAble didn’t load.</h1>
          <p className="wa-status-page__deck">
            The problem is on our side. Your fit and your settings are safe.
            Reload to try again.
          </p>
          <div className="wa-status-page__actions">
            <Button
              variant="primary"
              iconStart="refresh-cw"
              onClick={() => retry()}
            >
              Try again
            </Button>
          </div>
          {error.digest ? (
            <p className="wa-status-page__code wa-mono">
              Reference {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
