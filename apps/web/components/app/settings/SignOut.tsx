'use client';

import { Actions, Button } from '@webable/ui';
import { type FormEvent, useState } from 'react';

import { SIGN_OUT_PATH } from '../../../lib/auth/routes';
import { clearFitUi } from '../../shell/fit-ui';

type Scope = 'local' | 'global';

/**
 * Sign out of this browser, or everywhere (every session, including WebAble in
 * other browsers). One plain form post to the sign-out route, so it works
 * before hydration: the pressed button sends its own `scope`. The UI fit this
 * browser wore is forgotten on the way out.
 */
export function SignOut() {
  const [pending, setPending] = useState<Scope | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const scope =
      submitter instanceof HTMLButtonElement && submitter.value === 'global'
        ? 'global'
        : 'local';
    setPending(scope);
    clearFitUi();
  }

  return (
    <ul role="list" className="wa-rows">
      <li>
        <form
          method="post"
          action={SIGN_OUT_PATH}
          className="wa-row wa-row--split wa-row--compact"
          onSubmit={onSubmit}
        >
          <div>
            <p className="wa-row__label">Sign out</p>
            <p className="wa-row__detail">
              Everywhere ends every session, including WebAble in your other
              browsers.
            </p>
          </div>
          <div className="wa-row__actions">
            <Actions>
              <Button
                type="submit"
                name="scope"
                value="local"
                variant="secondary"
                size="md"
                busy={pending === 'local'}
                busyLabel="Signing out…"
              >
                Sign out
              </Button>
              <Button
                type="submit"
                name="scope"
                value="global"
                variant="secondary"
                size="md"
                busy={pending === 'global'}
                busyLabel="Signing out…"
              >
                Sign out everywhere
              </Button>
            </Actions>
          </div>
        </form>
      </li>
    </ul>
  );
}
