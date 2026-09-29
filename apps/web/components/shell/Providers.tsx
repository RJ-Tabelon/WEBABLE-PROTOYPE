'use client';

import {
  LinkProvider,
  ToastProvider,
  type LinkComponentProps,
} from '@webable/ui';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { applyFitUi, readFitUi, subscribeFitUi } from './fit-ui';

/** Next.js client-side navigation for every WebAble link and link-button. */
function RouterLink({ href, ref, ...rest }: LinkComponentProps) {
  return <NextLink href={href} ref={ref} {...rest} />;
}

/** Keeps the UI fit in sync with other tabs (the boot script covers first paint). */
function FitUiSync() {
  useEffect(() => {
    applyFitUi(readFitUi());
    return subscribeFitUi(() => {});
  }, []);
  return null;
}

/**
 * Client providers for the whole web app: router links, one toast region (a page
 * change dismisses the current toast), and fit sync.
 */
export function ShellProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <LinkProvider component={RouterLink}>
      <ToastProvider resetKey={pathname}>{children}</ToastProvider>
      <FitUiSync />
    </LinkProvider>
  );
}
