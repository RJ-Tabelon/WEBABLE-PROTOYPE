'use client';

import { type ExtensionStatus, StatusGlyph, TextLink } from '@webable/ui';

import { connectView } from '../../lib/extension/state';
import { useExtension } from '../../lib/extension/useExtension';

interface Line {
  state: ExtensionStatus;
  text: string;
  link?: { href: string; label: string };
}

/**
 * One quiet line about WebAble in this browser, read from the extension over the
 * bridge. It links to /connect whenever something is left to do.
 */
export function BrowserStatus({ email }: { email: string | null }) {
  const { state } = useExtension();
  const view = connectView(state, email);

  let line: Line;
  switch (view.view) {
    case 'checking':
      line = { state: 'checking', text: 'Checking this browser…' };
      break;
    case 'install':
      line = {
        state: 'cant-run',
        text: 'WebAble isn’t installed in this browser.',
        link: { href: '/connect', label: 'Add WebAble' },
      };
      break;
    case 'connect':
      line = {
        state: 'cant-run',
        text: view.otherEmail
          ? 'This browser is connected to a different account.'
          : 'This browser isn’t connected yet.',
        link: { href: '/connect', label: 'Connect this browser' },
      };
      break;
    case 'connected':
      line = !view.enabled
        ? { state: 'paused', text: 'WebAble is turned off in this browser.' }
        : view.allSites
          ? { state: 'on', text: 'WebAble is on in this browser.' }
          : {
              state: 'attention',
              text: 'WebAble is connected, but can’t change sites yet.',
              link: { href: '/connect', label: 'Finish setup' },
            };
      break;
    case 'error':
      line = {
        state: 'attention',
        text: 'Couldn’t check WebAble in this browser.',
        link: { href: '/connect', label: 'See what’s wrong' },
      };
      break;
  }

  return (
    <p className="wa-browser-status" aria-live="polite">
      <span className="wa-browser-status__text">
        <StatusGlyph state={line.state} />
        {line.text}
      </span>
      {line.link ? (
        <TextLink href={line.link.href} kind="standalone">
          {line.link.label}
        </TextLink>
      ) : null}
    </p>
  );
}
