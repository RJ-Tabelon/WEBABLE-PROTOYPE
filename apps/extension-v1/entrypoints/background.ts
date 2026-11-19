import { defineBackground } from 'wxt/utils/define-background';

import { startServiceWorker } from '@/lib/sw/main';

/**
 * WebAble's service worker: the only component that holds a session, talks
 * to the network, and owns learning state. See lib/sw/main.ts.
 */
export default defineBackground({
  type: 'module',
  main() {
    startServiceWorker();
  },
});
