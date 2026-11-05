import type { BgRequest } from '@webable/core';

const CONTENT_WORK = new Set<BgRequest['type']>([
  'understand', 'struggle', 'overlayClose', 'meaning', 'redesign', 'visualVerify', 'rewordScore', 'rewordWrite', 'compose',
]);

/** Count overlapping work, including failures, so the launcher never stops on the first completed request. */
export function createActivity(onChange: (pending: number) => void) {
  let pending = 0;
  return {
    isContentRequest: (req: BgRequest) => CONTENT_WORK.has(req.type),
    async run<T>(task: () => Promise<T>): Promise<T> {
      onChange(++pending);
      try {
        return await task();
      } finally {
        onChange(--pending);
      }
    },
  };
}
