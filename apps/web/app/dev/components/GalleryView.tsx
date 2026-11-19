'use client';

import { useSearchParams } from 'next/navigation';

import { Gallery } from './Gallery';

/** `?section=` shows one section of the gallery. */
export function GalleryView() {
  return <Gallery only={useSearchParams().get('section')} />;
}
