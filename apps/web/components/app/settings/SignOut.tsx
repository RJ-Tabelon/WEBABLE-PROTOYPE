'use client';

import { Actions, Button } from '@webable/ui';
import { type FormEvent, useState } from 'react';

import { signOut } from '../../../lib/auth/actions';
import { withBase } from '../../../lib/base-path';
import { clearFitUi } from '../../shell/fit-ui';

type Scope = 'local' | 'global';

/**
 * Sign out of this browser, or everywhere (every session, including WebAble in
 * other browsers). The pressed button says which. The UI fit this browser wore
 * is forgotten on the way out, and the page reloads on sign-in so nothing of
 * the account stays in memory.
 */
export function SignOut() {
  const [pending, setPending] = useState<Scope | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const scope: Scope =
      submitter instanceof HTMLButtonElement && submitter.value === 'global'
        ? 'global'
        : 'local';
    setPending(scope);
    clearFitUi();
    // supabase-js clears this browser's session even when the call fails.
    await signOut({ scope }).catch(() => undefined);
    window.location.assign(withBase('/sign-in/?signed_out=1'));
  }

  return (
    <ul role="list" className="wa-rows">
      <li>
        <form
          className="wa-row wa-row--split wa-row--compact"
          onSubmit={(event) => void onSubmit(event)}
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
