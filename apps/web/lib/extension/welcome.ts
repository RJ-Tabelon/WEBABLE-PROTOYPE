'use client';

import { useCallback, useState } from 'react';

import { extension } from './bridge';

export interface OpenWelcome {
  /** Ask the extension to focus or open its welcome page at "Allow on all sites". */
  open: () => Promise<boolean>;
  pending: boolean;
  /** Plain words when the extension couldn't open it, else null. */
  error: string | null;
}

export const OPEN_WELCOME_FAILED =
  'WebAble didn’t open its welcome page. Choose WebAble in the toolbar, then Allow on all sites.';

/**
 * Chrome lets only the extension's own page ask for access to every site, so
 * this page can't ask itself: it asks the extension to show that page
 * (`wa:open-welcome`). The person allows it there, once.
 */
export function useOpenWelcome(): OpenWelcome {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = useCallback(async () => {
    setPending(true);
    setError(null);
    const result = await extension.openWelcome();
    setPending(false);
    if (!result.ok) {
      setError(OPEN_WELCOME_FAILED);
      return false;
    }
    return true;
  }, []);
  return { open, pending, error };
}
