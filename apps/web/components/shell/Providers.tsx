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

/** "/" and "" both mean the site root; a trailing slash never matters. */
function samePath(path: string, pathname: string | null): boolean {
  const clean = (p: string) => p.replace(/\/+$/, '') || '/';
  return path === '' || (pathname !== null && clean(path) === clean(pathname));
}

/**
 * Next.js client-side navigation for every WebAble link and link-button. A
 * link to a fragment of the page already open ("/#how" on "/") stays a native
 * anchor, so the browser moves the sequential focus starting point to the
 * target as well as scrolling to it.
 */
function RouterLink({ href, ref, ...rest }: LinkComponentProps) {
  const pathname = usePathname();
  const hash = href.indexOf('#');
  if (hash >= 0 && !href.slice(0, hash).includes('?')) {
    if (samePath(href.slice(0, hash), pathname))
      return <a href={href} ref={ref} {...rest} />;
  }
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
