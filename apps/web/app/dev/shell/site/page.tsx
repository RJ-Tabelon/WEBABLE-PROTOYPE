import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SiteShellPreviewView } from './SiteShellPreviewView';

export const metadata: Metadata = { title: 'Site shell preview' };

export default function SiteShellPreview() {
  return (
    <Suspense fallback={null}>
      <SiteShellPreviewView />
    </Suspense>
  );
}
