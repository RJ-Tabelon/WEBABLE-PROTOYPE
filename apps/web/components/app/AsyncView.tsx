'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';

import { useDataVersion } from '../../lib/data/refresh';

/** Thrown from a view's render to send the person somewhere else. */
export class Redirect extends Error {
  readonly to: string;
  constructor(to: string) {
    super(`Redirect to ${to}`);
    this.name = 'Redirect';
    this.to = to;
  }
}

/** Like next/navigation's redirect(), for an AsyncView's render. */
export function redirectTo(to: string): never {
  throw new Redirect(to);
}

type State = { node: ReactNode } | { error: unknown } | null;

/**
 * Shows what an async `render` resolves to. The site is a static export, so
 * per-person pages read Supabase in the browser: `fallback` shows until the
 * first render resolves, and the view renders again (keeping what it shows
 * meanwhile) whenever refreshData() is called. A thrown error goes to the
 * nearest error boundary; redirectTo() replaces the route. `render` must be
 * stable (a module function, or memoized on its inputs).
 */
export function AsyncView({
  render,
  fallback = null,
}: {
  render: () => Promise<ReactNode>;
  fallback?: ReactNode;
}) {
  const router = useRouter();
  const version = useDataVersion();
  const [state, setState] = useState<State>(null);

  useEffect(() => {
    let live = true;
    render().then(
      (node) => {
        if (live) setState({ node });
      },
      (error: unknown) => {
        if (!live) return;
        if (error instanceof Redirect) router.replace(error.to);
        else setState({ error });
      },
    );
    return () => {
      live = false;
    };
  }, [render, version, router]);

  if (state && 'error' in state) throw state.error;
  return state ? state.node : fallback;
}
