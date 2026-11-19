'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { completeAuthLink } from '../../../lib/auth/complete';
import { AuthHeading } from './AuthHeading';

/** Supabase can also report a failed link in the fragment. */
function linkParams(): URLSearchParams {
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.slice(1));
  for (const key of ['error', 'error_code', 'error_description']) {
    const value = hash.get(key);
    if (value && !params.has(key)) params.set(key, value);
  }
  return params;
}

/**
 * Where email links land (/auth/callback and /auth/confirm). It finishes the
 * link in this browser, then replaces the page with where the person was
 * going, or with sign-in and a plain-language error.
 */
export function AuthComplete() {
  const router = useRouter();
  // A link's code works once: run it once even when effects run twice.
  const started = useRef<Promise<string> | null>(null);

  useEffect(() => {
    started.current ??= completeAuthLink(linkParams());
    let live = true;
    void started.current.then((to) => {
      if (live) router.replace(to);
    });
    return () => {
      live = false;
    };
  }, [router]);

  return (
    <div role="status">
      <AuthHeading title="Signing you in…" deck="This takes a moment." />
    </div>
  );
}
