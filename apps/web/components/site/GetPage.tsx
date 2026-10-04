import { Button, TextLink } from '@webable/ui';

export interface GetPageProps {
  /** The Chrome Web Store listing, or null when this build has none. */
  storeUrl: string | null;
}

/**
 * /get: add the extension, signed out, in one activation. The store button is the
 * one decision on the page; the three rows say what happens next, and Tune is
 * offered as optional. Without a store listing, the button becomes install
 * instructions (Help).
 */
export function GetPage({ storeUrl }: GetPageProps) {
  return (
    <div className="wa-container ws-get">
      <header className="ws-get__head">
        <h1 className="ws-get__title">Add WebAble to Chrome.</h1>
        <p className="ws-get__deck">
          It works on the first page you open. Tune it later for your own fit.
        </p>
        <div className="ws-get__actions">
          {storeUrl ? (
            <Button href={storeUrl} variant="primary" arrow="external">
              Add to Chrome
            </Button>
          ) : (
            <Button href="/help#setup" variant="secondary">
              Install instructions
            </Button>
          )}
        </div>
      </header>

      <ol role="list" className="ws-get__steps">
        <li className="ws-get__step">
          <span className="ws-get__num" aria-hidden="true">
            1
          </span>
          <span className="ws-get__text">Add WebAble to Chrome</span>
        </li>
        <li className="ws-get__step">
          <span className="ws-get__num" aria-hidden="true">
            2
          </span>
          <span className="ws-get__text">
            Allow it on sites
            <span className="ws-get__note"> · from its welcome page</span>
          </span>
        </li>
        <li className="ws-get__step">
          <span className="ws-get__num" aria-hidden="true">
            3
          </span>
          <span className="ws-get__text">
            Tune it to you
            <span className="ws-get__note">
              {' · optional, about 6\u00a0minutes'}
            </span>
          </span>
          <TextLink href="/tune" kind="standalone" className="ws-get__link">
            Start tuning
          </TextLink>
        </li>
      </ol>

      <p className="ws-get__meta">WebAble runs in Chrome on a computer.</p>
    </div>
  );
}
