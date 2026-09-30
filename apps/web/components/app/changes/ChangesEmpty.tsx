'use client';

import { Button, EmptyState } from '@webable/ui';

import { connectView } from '../../../lib/extension/state';
import { useExtension } from '../../../lib/extension/useExtension';

/**
 * No changes yet. The one action is the step that is actually missing: a fit
 * (Tune), then this browser (Connect). With both in place there is nothing to
 * do but browse, so there is no button.
 */
export function ChangesEmpty({
  hasFit,
  email,
}: {
  hasFit: boolean;
  email: string | null;
}) {
  const { state } = useExtension({ recheckOnFocus: false });
  const view = connectView(state, email).view;
  const action = !hasFit ? (
    <Button href="/tune" variant="primary" arrow="forward">
      Tune WebAble
    </Button>
  ) : view === 'install' || view === 'connect' ? (
    <Button href="/connect" variant="primary" arrow="forward">
      Connect this browser
    </Button>
  ) : null;
  return (
    <EmptyState title="No changes yet" action={action}>
      Changes show up here after WebAble adjusts a page for you.
    </EmptyState>
  );
}
