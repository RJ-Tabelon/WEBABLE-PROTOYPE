import { defineContentScript } from 'wxt/utils/define-content-script';

import { createFitViewRuntime } from '@/lib/engine/fitview';
import { createLive } from '@/lib/engine/fitview/live';
import {
  FITVIEW_RUNTIME_KEY,
  type FitViewRuntime,
} from '@/lib/engine/fitview/types';

/**
 * Fit view (docs/10 §4.3). Output: content-scripts/fitview.js. Not registered
 * on every page: the service worker injects it with
 * chrome.scripting.executeScript({ files }) the first time Fit view opens in
 * a document, into the same isolated world as engine.js, so the engine that
 * runs everywhere stays small.
 *
 * It registers the runtime under globalThis[FITVIEW_RUNTIME_KEY]; the engine
 * adapter calls open() with the worker's reply, the skeleton and its registry.
 * A second injection into the same document keeps the running runtime unless
 * its extension context is gone (the extension was reloaded), in which case
 * the old view closes and a fresh runtime replaces it.
 */

/** Liveness of the context that created a runtime. */
const ALIVE = Symbol.for('webable.fitview.alive');

type Slot = {
  [FITVIEW_RUNTIME_KEY]?: FitViewRuntime & { [ALIVE]?: () => boolean };
};

export default defineContentScript({
  registration: 'runtime',
  noScriptStartedPostMessage: true,
  main(ctx) {
    if (!(document instanceof HTMLDocument)) return;
    const slot = globalThis as unknown as Slot;
    const running = slot[FITVIEW_RUNTIME_KEY];
    if (running?.[ALIVE]?.()) return;
    if (running?.isOpen()) running.close('paused');
    const runtime = Object.assign(createFitViewRuntime({ createLive }), {
      [ALIVE]: () => ctx.isValid,
    });
    slot[FITVIEW_RUNTIME_KEY] = runtime;
    ctx.onInvalidated(() => {
      // The extension was reloaded or removed: give the page back as it was.
      runtime.close('paused');
      if (slot[FITVIEW_RUNTIME_KEY] === runtime)
        delete slot[FITVIEW_RUNTIME_KEY];
    });
  },
});
