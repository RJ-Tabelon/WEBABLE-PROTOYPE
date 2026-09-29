'use client';

import { Button } from '@webable/ui';
import { useState } from 'react';

import { SIGN_OUT_PATH } from '../../../lib/auth/routes';
import { clearFitUi } from '../../shell/fit-ui';

/**
 * Sign out of this browser, or everywhere (every session, including WebAble in
 * other browsers). Plain form posts to the sign-out route, so they work before
 * hydration; the UI fit this browser wore is forgotten on the way out.
 */
export function SignOut() {
  const [pending, setPending] = useState<'local' | 'global' | null>(null);

  return (
    <div className="wa-rows">
      <form
        method="post"
        action={SIGN_OUT_PATH}
        className="wa-row wa-row--split"
        onSubmit={() => {
          setPending('local');
          clearFitUi();
        }}
      >
        <div>
          <p className="wa-row__label">Sign out of this browser</p>
          <p className="wa-row__detail">
            WebAble keeps working here with its own sign-in.
          </p>
        </div>
        <div className="wa-row__actions">
          <Button
            type="submit"
            variant="secondary"
            busy={pending === 'local'}
            busyLabel="Signing out…"
          >
            Sign out
          </Button>
        </div>
      </form>
      <form
        method="post"
        action={SIGN_OUT_PATH}
        className="wa-row wa-row--split"
        onSubmit={() => {
          setPending('global');
          clearFitUi();
        }}
      >
        <input type="hidden" name="scope" value="global" />
        <div>
          <p className="wa-row__label">Sign out everywhere</p>
          <p className="wa-row__detail">
            Ends every session, including WebAble in your other browsers.
          </p>
        </div>
        <div className="wa-row__actions">
          <Button
            type="submit"
            variant="secondary"
            busy={pending === 'global'}
            busyLabel="Signing out…"
          >
            Sign out everywhere
          </Button>
        </div>
      </form>
    </div>
  );
}
