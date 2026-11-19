import type { Metadata } from 'next';
import { Suspense } from 'react';

import { GalleryView } from './GalleryView';

export const metadata: Metadata = {
  title: 'Components',
  description:
    'Every WebAble component in every state, in both themes. For design review.',
  robots: { index: false, follow: false },
};

export default function ComponentsPage() {
  return (
    <Suspense fallback={null}>
      <GalleryView />
    </Suspense>
  );
}
