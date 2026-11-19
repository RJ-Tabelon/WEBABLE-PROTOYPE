import { Button, TextLink } from '@webable/ui';

export interface GetPageProps {
  /** The Chrome Web Store listing, or null when this build has none. */
  storeUrl: string | null;
}

/**
 * /get: add the extension, signed out, in one activation. The store button is the
 * one decision on the page; three numbered cards say what happens next, and
 * Tune is offered as optional. Without a store listing, the button becomes
 * install instructions (Help).
 */
export function GetPage({ storeUrl }: GetPageProps) {
  return (
    <div className="wm-get">
      <header className="wa-container wm-get__head">
        <h1 className="wm-display wm-get__title">Add WebAble to Chrome.</h1>
        <p className="wm-hero__deck">
          It works on the first page you open. Tune it later for your own fit.
        </p>
        <div className="wm-actions wm-actions--center">
          {storeUrl ? (
            <Button
              href={storeUrl}
              variant="primary"
              arrow="external"
              className="wm-btn"
            >
              Add to Chrome
            </Button>
          ) : (
            <Button
              href="/help#setup"
              variant="secondary"
              className="wm-btn wm-btn--soft"
            >
              Install instructions
            </Button>
          )}
        </div>
        <p className="wm-hero__meta">WebAble runs in Chrome on a computer.</p>
      </header>

      <div className="wa-container">
        <div className="wm-get__stage">
          <div className="wm-hero__backdrop" aria-hidden="true" />
          <ol role="list" className="wm-get__steps">
            <li className="wm-get__step">
              <p className="wm-step__n" aria-hidden="true">
                01
              </p>
              <h2 className="wm-h3">Add it to Chrome</h2>
              <p className="wm-step__text">
                From the Chrome Web Store. Chrome asks you to confirm.
              </p>
            </li>
            <li className="wm-get__step">
              <p className="wm-step__n" aria-hidden="true">
                02
              </p>
              <h2 className="wm-h3">Allow it on sites</h2>
              <p className="wm-step__text">
                From its welcome page. You can pause it on any site later.
              </p>
            </li>
            <li className="wm-get__step">
              <p className="wm-step__n" aria-hidden="true">
                03
              </p>
              <h2 className="wm-h3">Tune it to you</h2>
              <p className="wm-step__text">
                Optional, about 6&nbsp;minutes. You can skip any part.
              </p>
              <TextLink href="/tune" kind="standalone" className="wm-get__link">
                Start tuning
              </TextLink>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
