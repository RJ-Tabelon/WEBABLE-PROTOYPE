'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { getUser } from '../../../lib/data/session';

/** On the sign-in and sign-up pages: someone already signed in goes to `next`. */
export function useSignedInRedirect(next: string) {
  const router = useRouter();
  useEffect(() => {
    let live = true;
    void getUser().then((user) => {
      if (live && user) router.replace(next);
    });
    return () => {
      live = false;
    };
  }, [next, router]);
}
