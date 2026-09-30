'use client';

import { Icon } from '@webable/ui';

import { useExtension } from '../../../lib/extension/useExtension';

/**
 * "This list stays in this browser": said once WebAble is here, since the list
 * lives in the extension. Nothing to say when it isn't.
 */
export function SitesPrivacyLine() {
  const { state } = useExtension({ recheckOnFocus: false });
  if (state.phase === 'missing') return null;
  return (
    <p className="wa-app-meta wa-lock-line">
      <Icon name="lock" size={16} />
      <span>This list stays in this browser. It’s never sent to WebAble.</span>
    </p>
  );
}
