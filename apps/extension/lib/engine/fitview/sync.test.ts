import type { Skeleton } from '@webable/core';
import { afterEach, describe, expect, it } from 'vitest';

import { isHashRoute, SYNC_COPY, unavailableCopy } from './sync';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isHashRoute', () => {
  it('treats a fragment naming no element as a route (Gmail #inbox/...)', () => {
    document.body.innerHTML = '<h2 id="reviews">Reviews</h2><a name="top"></a>';
    expect(isHashRoute(document, '#inbox')).toBe(true);
    expect(isHashRoute(document, '#inbox/FMfcgz')).toBe(true);
    expect(isHashRoute(document, '')).toBe(true);
    expect(isHashRoute(document, '#reviews')).toBe(false);
    expect(isHashRoute(document, '#top')).toBe(false);
  });
});

describe('unavailableCopy', () => {
  const skeleton = (nodes: Skeleton['nodes']): Skeleton =>
    ({
      viewport: { width: 1000, height: 800, zoom: 1 },
      nodes,
    }) as unknown as Skeleton;

  it('says videos play best on the original page for a video player', () => {
    const s = skeleton([
      {
        id: 'e1',
        parent: null,
        depth: 0,
        tag: 'video',
        role: null,
        kind: 'media',
        box: [0, 0, 800, 450],
        flags: [],
      },
    ]);
    expect(unavailableCopy('not_representable', s)).toBe(SYNC_COPY.video);
  });

  it('asks to answer a blocking overlay first, and says less otherwise', () => {
    expect(unavailableCopy('blocked_overlay', null)).toBe(SYNC_COPY.answer);
    expect(unavailableCopy('not_representable', skeleton([]))).toBe(
      SYNC_COPY.original,
    );
  });
});
