'use client';

import { Button, EmptyState, useToast } from '@webable/ui';
import { useState } from 'react';

import type { ExtensionInstall } from '../../../lib/data/installs';
import { removeInstallAction } from '../../../lib/data/actions';
import { DATA_ERROR_MESSAGES } from '../../../lib/data/result';
import { extension } from '../../../lib/extension/bridge';
import { useExtension } from '../../../lib/extension/useExtension';
import { formatRelativeDay } from '../format';

function describe(install: ExtensionInstall): string {
  const browser = install.browser || 'Browser';
  return install.platform ? `${browser} on ${install.platform}` : browser;
}

function day(value: string): string {
  const shown = formatRelativeDay(value);
  return shown === 'Today' || shown === 'Yesterday'
    ? shown.toLowerCase()
    : shown;
}

/**
 * Browsers connected to this account (extension_installs). The one this page is
 * running in is marked, from the install id the extension reports. Removing it
 * also signs that extension out.
 */
export function Installs({ initial }: { initial: ExtensionInstall[] }) {
  const [installs, setInstalls] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const { state } = useExtension({ recheckOnFocus: false });
  const toast = useToast();
  const thisInstall = state.phase === 'ready' ? state.status.installId : null;

  async function remove(install: ExtensionInstall) {
    const before = installs;
    setPending(install.id);
    setInstalls((list) => list.filter((i) => i.id !== install.id));
    let message: string | null = null;
    try {
      const result = await removeInstallAction({ id: install.id });
      if (!result.ok && result.error.code !== 'not_found')
        message = result.error.message;
    } catch {
      message = DATA_ERROR_MESSAGES.unavailable;
    }
    setPending(null);
    if (message) {
      setInstalls(before);
      toast.show({
        message: `${describe(install)} wasn’t removed. ${message}`,
      });
      return;
    }
    const isThis = install.id === thisInstall;
    if (isThis) await extension.disconnect();
    toast.show({
      message: isThis
        ? 'Removed this browser and signed WebAble out here.'
        : `Removed ${describe(install)}. It stays signed in until it signs out.`,
    });
  }

  if (installs.length === 0) {
    return (
      <EmptyState
        title="No browsers connected"
        as="h3"
        action={
          <Button href="/connect" variant="secondary" arrow="forward">
            Connect this browser
          </Button>
        }
      >
        Connect a browser to use your fit there.
      </EmptyState>
    );
  }

  return (
    <ul role="list" className="wa-rows" aria-label="Connected browsers">
      {installs.map((install) => {
        const isThis = install.id === thisInstall;
        return (
          <li key={install.id} className="wa-row wa-row--split">
            <div>
              <p className="wa-row__label">
                {describe(install)}
                {isThis ? (
                  <span className="wa-row__tag"> · This browser</span>
                ) : null}
              </p>
              <p className="wa-row__detail">
                WebAble {install.extensionVersion} · connected{' '}
                {day(install.connectedAt)} · last seen {day(install.lastSeenAt)}
              </p>
            </div>
            <div className="wa-row__actions">
              <Button
                variant="ghost"
                size="md"
                busy={pending === install.id}
                busyLabel="Removing…"
                onClick={() => void remove(install)}
              >
                Remove
                <span className="sr-only"> {describe(install)}</span>
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
